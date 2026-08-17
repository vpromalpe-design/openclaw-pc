/**
 * Models page (v0.8.7): build the provider/priority table and apply priority
 * changes with config backup + gateway restart (crash-loop safe).
 */

import fs from 'node:fs'
import path from 'node:path'
import type {
  ModelsViewResult,
  ModelTableEntry,
  OpenClawConfig,
} from '../../shared/types.js'
import { getUserDataDir } from '../utils/paths.js'

/** Providers shown in the table even when not yet configured (cloud, in wizard order). */
const KNOWN_CLOUD_PROVIDERS = [
  'deepseek',
  'anthropic',
  'openai',
  'openai-codex',
  'google',
  'openrouter',
  'opencode',
  'mistral',
  'minimax',
  'moonshot',
  'moonshot-cn',
  'zai',
  'venice',
  'groq',
  'xai',
  'cerebras',
  'huggingface',
  'github-copilot',
  'kilocode',
  'volcengine',
  'volcengine-plan',
  'byteplus',
  'byteplus-plan',
  'qianfan',
  'bedrock',
  'cloudflare-ai-gateway',
  'litellm',
  'together',
  'nvidia',
  'qwen-portal',
  'google-vertex',
  'google-gemini-cli',
  'ollama',
  'vllm',
  'lmstudio',
  'vercel-ai-gateway',
  'synthetic',
  'xiaomi',
  'kimi-coding',
  'chutes',
  'copilot-proxy',
  'kuae',
]

export function buildModelsView(config: OpenClawConfig): ModelsViewResult {
  const providers = config.models?.providers ?? {}
  const dm = config.agents?.defaults?.model
  const primary =
    typeof dm === 'string' ? dm : dm && typeof dm === 'object' ? dm.primary ?? null : null
  const fallbacks =
    dm && typeof dm === 'object' && Array.isArray(dm.fallbacks)
      ? dm.fallbacks.filter((x): x is string => typeof x === 'string')
      : []

  const chain = primary ? [primary, ...fallbacks] : [...fallbacks]

  const providerIds = new Set<string>([
    ...Object.keys(providers),
    ...KNOWN_CLOUD_PROVIDERS,
    'local',
  ])

  const entries: ModelTableEntry[] = []
  for (const providerId of providerIds) {
    const p = providers[providerId]
    const isLocal = providerId === 'local'
    const chainIndex = chain.findIndex((c) => c.startsWith(`${providerId}/`))
    const inChain = chainIndex >= 0
    const entry: ModelTableEntry = {
      providerId,
      label: providerId,
      modelId: '',
      hasConfig: Boolean(p),
      hasApiKey: Boolean(p?.apiKey),
      status: isLocal ? 'local' : inChain ? (chainIndex === 0 ? 'primary' : 'fallback') : 'available',
      priority: inChain ? chainIndex : null,
      isLocal,
    }
    if (inChain) {
      const modelPart = chain[chainIndex]!.slice(providerId.length + 1)
      if (modelPart) entry.modelId = modelPart
    } else if (p?.models && p.models.length > 0) {
      entry.modelId = p.models[0].id
    }
    entries.push(entry)
  }

  // Order: chain order first, then configured providers, then the rest.
  entries.sort((a, b) => {
    const pa = a.priority
    const pb = b.priority
    if (pa !== null && pb !== null) return pa - pb
    if (pa !== null) return -1
    if (pb !== null) return 1
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1
    if (a.hasConfig !== b.hasConfig) return a.hasConfig ? -1 : 1
    return a.providerId.localeCompare(b.providerId)
  })

  return {
    entries,
    primary,
    fallbacks,
    localModels: [],
    engineState: { running: false, port: 18788, modelId: null },
  }
}

/** Backup of openclaw.json kept right before a priority change. */
export function backupConfigForRollback(): string | null {
  try {
    const userData = getUserDataDir()
    const cfgPath = path.join(userData, 'openclaw.json')
    if (!fs.existsSync(cfgPath)) return null
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(userData, `openclaw.backup-${stamp}.json`)
    fs.copyFileSync(cfgPath, backupPath)
    return backupPath
  } catch {
    return null
  }
}

/**
 * Apply priority: write agents.defaults.model = { primary, fallbacks }.
 * Returns the backup path (for automatic rollback if the gateway fails to start).
 */
export function applyModelsPriority(
  currentConfig: OpenClawConfig,
  primary: string | null,
  fallbacks: string[],
): { config: OpenClawConfig; backupPath: string | null } {
  const backupPath = backupConfigForRollback()
  const next = JSON.parse(JSON.stringify(currentConfig)) as OpenClawConfig
  next.agents = next.agents ?? {}
  next.agents.defaults = next.agents.defaults ?? {}
  const prev = next.agents.defaults.model
  const model: { primary?: string; fallbacks?: string[] } =
    typeof prev === 'string' ? {} : { ...((prev as object) ?? {}) }
  if (primary === null) {
    delete model.primary
  } else {
    model.primary = primary
  }
  if (fallbacks.length === 0) {
    delete model.fallbacks
  } else {
    model.fallbacks = fallbacks
  }
  next.agents.defaults.model = model as never
  return { config: next, backupPath }
}

/** Restore a previously written backup file. */
export function restoreConfigBackup(backupPath: string): boolean {
  try {
    const userData = getUserDataDir()
    const cfgPath = path.join(userData, 'openclaw.json')
    fs.copyFileSync(backupPath, cfgPath)
    return true
  } catch {
    return false
  }
}
