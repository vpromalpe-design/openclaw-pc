/**
 * Auth profiles: list/save/delete/import/export (same store as auth-profile-writer, LLM API UI).
 */

import fs from 'node:fs'
import path from 'node:path'
import { getUserDataDir } from '../utils/paths.js'
import { normalizeAuthOrderEntry } from './provider-config.js'

const AUTH_STORE_VERSION = 1
const AUTH_PROFILE_FILENAME = 'auth-profiles.json'
const AGENT_AUTH_DIR = ['agents', 'main', 'agent']

interface ApiKeyCredential {
  type: 'api_key'
  provider: string
  key: string
}

interface TokenCredential {
  type: 'token'
  provider: string
  token: string
}

type AuthProfileCredential = ApiKeyCredential | TokenCredential

interface AuthProfileStore {
  version: number
  profiles: Record<string, AuthProfileCredential>
}

function resolveAgentAuthDir(): string {
  return path.join(getUserDataDir(), ...AGENT_AUTH_DIR)
}

function resolveAuthStorePath(): string {
  return path.join(resolveAgentAuthDir(), AUTH_PROFILE_FILENAME)
}

function resolveLegacyAuthStorePath(): string {
  return path.join(getUserDataDir(), 'credentials', AUTH_PROFILE_FILENAME)
}

/**
 * v0.8.25: atomic write (tmp + rename). A plain writeFileSync can leave a
 * truncated file on power loss / crash, and the next loadStore would silently
 * return an EMPTY store — the next save then destroys every provider's key.
 */
function saveStoreAtomic(storePath: string, store: AuthProfileStore): void {
  const dir = path.dirname(storePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmpPath = `${storePath}.tmp`
  const data = JSON.stringify(store, null, 2) + '\n'
  fs.writeFileSync(tmpPath, data, 'utf-8')
  try {
    fs.renameSync(tmpPath, storePath)
  } catch {
    fs.unlinkSync(storePath)
    fs.renameSync(tmpPath, storePath)
  }
}

/** v0.8.25: keep a recoverable copy of a corrupt store instead of wiping it. */
function backupCorruptStore(storePath: string): void {
  try {
    if (fs.existsSync(storePath)) {
      fs.copyFileSync(storePath, `${storePath}.bad-${Date.now()}`)
    }
  } catch {
    /* ignore */
  }
}

function loadStore(): AuthProfileStore {
  const storePath = resolveAuthStorePath()
  try {
    if (!fs.existsSync(storePath)) {
      const legacyPath = resolveLegacyAuthStorePath()
      if (fs.existsSync(legacyPath)) {
        const raw = fs.readFileSync(legacyPath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (
          parsed &&
          typeof parsed === 'object' &&
          parsed.profiles &&
          typeof parsed.profiles === 'object'
        ) {
          const store = {
            version: parsed.version ?? AUTH_STORE_VERSION,
            profiles: parsed.profiles,
          } as AuthProfileStore
          const agentAuthDir = resolveAgentAuthDir()
          fs.mkdirSync(agentAuthDir, { recursive: true })
          const { store: migrated } = migrateShorthandProfileKeys(store)
          saveStoreAtomic(storePath, migrated)
          return migrated
        }
      }
      return { version: AUTH_STORE_VERSION, profiles: {} }
    }
    const raw = fs.readFileSync(storePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.version === 'number' &&
      parsed.profiles &&
      typeof parsed.profiles === 'object'
    ) {
      const { store: migrated, changed } = migrateShorthandProfileKeys(parsed as AuthProfileStore)
      if (changed) {
        saveStore(migrated)
      }
      return migrated
    }
    return { version: AUTH_STORE_VERSION, profiles: {} }
  } catch {
    // v0.8.25: corrupt/unreadable store must NOT be silently treated as
    // empty — the next save would erase every credential. Back it up first.
    backupCorruptStore(storePath)
    return { version: AUTH_STORE_VERSION, profiles: {} }
  }
}

function saveStore(store: AuthProfileStore): void {
  saveStoreAtomic(resolveAuthStorePath(), store)
}

/**
 * Keys must match auth.order (e.g. openai:default). Shorthand keys (default) break credential lookup → 401.
 */
function migrateShorthandProfileKeys(store: AuthProfileStore): { store: AuthProfileStore; changed: boolean } {
  const profiles = { ...store.profiles }
  let changed = false
  for (const [profileId, cred] of Object.entries(profiles)) {
    if (profileId.includes(':')) continue
    const provider = cred.provider
    if (typeof provider !== 'string' || !provider.trim()) continue
    const canonical = normalizeAuthOrderEntry(provider, profileId)
    if (profiles[canonical]) {
      delete profiles[profileId]
      changed = true
      continue
    }
    profiles[canonical] = cred
    delete profiles[profileId]
    changed = true
  }
  // Legacy: minimax:default → minimax:global (OpenClaw / desktop wizard convention)
  if (profiles['minimax:default']) {
    if (!profiles['minimax:global']) {
      profiles['minimax:global'] = profiles['minimax:default']
    }
    delete profiles['minimax:default']
    changed = true
  }
  if (!changed) return { store, changed: false }
  return { store: { ...store, profiles }, changed: true }
}

function hasCredential(cred: AuthProfileCredential): boolean {
  if (cred.type === 'api_key') return Boolean(cred.key?.length)
  if (cred.type === 'token') return Boolean(cred.token?.length)
  return false
}

function getCredentialPreview(cred: AuthProfileCredential, mask: boolean): string | undefined {
  const val = cred.type === 'api_key' ? cred.key : cred.token
  if (!val?.length) return undefined
  return mask ? val.slice(0, 4) + '***' : val
}

export interface AuthProfileItem {
  profileId: string
  provider: string
  hasKey: boolean
  /** Masked key preview when maskKeys is true */
  keyPreview?: string
}

/**
 * List profiles with redacted secrets (api_key + token shapes)
 */
export function listAuthProfiles(maskKeys = true): AuthProfileItem[] {
  const store = loadStore()
  return Object.entries(store.profiles).map(([profileId, cred]) => {
    const preview = getCredentialPreview(cred, maskKeys)
    return {
      profileId,
      provider: cred.provider,
      hasKey: hasCredential(cred),
      ...(preview ? { keyPreview: preview } : {}),
    }
  })
}

/**
 * Return the raw credential for a profile (used by the plain-text chat
 * mode to call cloud APIs directly, bypassing the agent runtime).
 */
export function getAuthProfileCredential(
  profileId: string,
): { type: 'api_key' | 'token'; value: string } | undefined {
  const store = loadStore()
  const cred = store.profiles[profileId]
  if (!cred) return undefined
  if (cred.type === 'api_key' && cred.key) return { type: 'api_key', value: cred.key }
  if (cred.type === 'token' && cred.token) return { type: 'token', value: cred.token }
  return undefined
}

/**
 * Upsert api_key profile
 */
export function saveAuthProfile(profileId: string, provider: string, apiKey: string): void {
  const store = loadStore()
  store.profiles[profileId] = {
    type: 'api_key',
    provider,
    key: apiKey,
  }
  saveStore(store)
}

/**
 * Save token profile (e.g. copilot-proxy:local)
 */
export function saveAuthProfileToken(profileId: string, provider: string, token: string): void {
  const store = loadStore()
  store.profiles[profileId] = {
    type: 'token',
    provider,
    token,
  }
  saveStore(store)
}

/**
 * Delete profile by id
 */
export function deleteAuthProfile(profileId: string): void {
  const store = loadStore()
  delete store.profiles[profileId]
  saveStore(store)
}

export interface ExportAuthProfilesOptions {
  maskKeys?: boolean
}

/**
 * Serialize store to JSON
 */
export function exportAuthProfiles(opts: ExportAuthProfilesOptions = {}): string {
  const { maskKeys = true } = opts
  const store = loadStore()
  const out = {
    version: store.version,
    profiles: {} as Record<string, AuthProfileCredential>,
  }
  for (const [id, cred] of Object.entries(store.profiles)) {
    if (cred.type === 'api_key') {
      out.profiles[id] = {
        ...cred,
        key: maskKeys && cred.key ? cred.key.slice(0, 4) + '***' : cred.key,
      }
    } else {
      out.profiles[id] = {
        ...cred,
        token: maskKeys && cred.token ? cred.token.slice(0, 4) + '***' : cred.token,
      }
    }
  }
  return JSON.stringify(out, null, 2)
}

export interface ImportAuthProfilesResult {
  imported: number
  errors: string[]
}

/**
 * Import JSON into store (overwrites on conflict)
 */
export function importAuthProfiles(json: string): ImportAuthProfilesResult {
  const errors: string[] = []
  let imported = 0
  try {
    const parsed = JSON.parse(json) as AuthProfileStore
    if (!parsed || typeof parsed !== 'object' || !parsed.profiles || typeof parsed.profiles !== 'object') {
      errors.push('Invalid format: missing profiles object')
      return { imported: 0, errors }
    }
    const store = loadStore()
    for (const [profileId, cred] of Object.entries(parsed.profiles)) {
      if (!cred || typeof cred !== 'object' || typeof cred.provider !== 'string') continue
      if (
        cred.type === 'api_key' &&
        typeof cred.key === 'string' &&
        cred.key.length > 0 &&
        !cred.key.endsWith('***')
      ) {
        store.profiles[profileId] = cred
        imported++
      } else if (cred.type === 'token' && typeof cred.token === 'string' && cred.token.length > 0 && !cred.token.endsWith('***')) {
        store.profiles[profileId] = cred
        imported++
      } else if ((cred as ApiKeyCredential).key?.endsWith('***') || (cred as TokenCredential).token?.endsWith('***')) {
        errors.push(`Profile ${profileId}: cannot import masked credential, provide plain value`)
      }
    }
    saveStore(store)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }
  return { imported, errors }
}
