/**
 * models.providers, agents.defaults, auth.order — shared with LLM API UI.
 */

import type {
  OpenClawConfig,
  ModelProviderConfig,
  AgentDefaultsConfig,
  AuthConfig,
} from '../../shared/types.js'
import { PROVIDER_ENDPOINTS } from '../../shared/provider-catalog.js'

export interface ProviderSummary {
  providerId: string
  baseUrl?: string
  api?: string
  hasApiKey: boolean
  models?: Array<{ id: string; name?: string }>
}

export interface ModelDefaultsSummary {
  primary?: string
  fallbacks?: string[]
}

export interface ProvidersListResult {
  profiles: Array<{ profileId: string; provider: string; hasKey: boolean }>
  providers: ProviderSummary[]
  modelDefaults: ModelDefaultsSummary
  authOrder: Record<string, string[]>
}

function getProviderSummary(providerId: string, config: ModelProviderConfig): ProviderSummary {
  return {
    providerId,
    baseUrl: config.baseUrl,
    api: config.api,
    hasApiKey: Boolean(config.apiKey?.length),
    models: config.models,
  }
}

/**
 * Summary for UI (no raw secrets)
 */
export function getProvidersSummary(
  config: OpenClawConfig,
  profileItems: Array<{ profileId: string; provider: string; hasKey: boolean }>,
): ProvidersListResult {
  const providers: ProviderSummary[] = []
  const providersConfig = config?.models?.providers ?? {}
  for (const [id, p] of Object.entries(providersConfig)) {
    if (p && typeof p === 'object') {
      providers.push(getProviderSummary(id, p as ModelProviderConfig))
    }
  }

  let modelDefaults: ModelDefaultsSummary = {}
  const modelCfg = config?.agents?.defaults?.model
  if (typeof modelCfg === 'string') {
    modelDefaults = { primary: modelCfg }
  } else if (modelCfg && typeof modelCfg === 'object') {
    modelDefaults = {
      primary: modelCfg.primary,
      fallbacks: Array.isArray((modelCfg as { fallbacks?: string[] }).fallbacks)
        ? (modelCfg as { fallbacks: string[] }).fallbacks
        : undefined,
    }
  }

  const authOrder = (config?.auth?.order ?? {}) as Record<string, string[]>

  return {
    profiles: profileItems,
    providers,
    modelDefaults,
    authOrder,
  }
}

/**
 * Known non-builtin providers and their OpenAI-compatible endpoints. The
 * upstream gateway does not know about DeepSeek, so without an explicit
 * baseUrl it falls back to api.openai.com and the request 403s
 * (unsupported_country_region_territory from OpenAI). Full catalog lives in
 * shared/provider-catalog.ts (aligned with the wizard seeds).
 */
const PROVIDER_ENDPOINT_DEFAULTS = PROVIDER_ENDPOINTS

/**
 * Ensure model refs are present in the agent allowlist.
 *
 * v0.10.0 (OpenClaw 2.0): canonical allowlist = `agents.defaults.modelPolicy.allow`
 * (array of `provider/model` refs). Legacy `agents.defaults.models` map is still
 * read by the 2.0 kernel (migration source) and by our own readers, so we keep
 * BOTH in sync: every ref goes to `modelPolicy.allow` AND to `defaults.models`
 * (alias = short model id). Exact `provider/model` refs are valid in both.
 */
export function addModelsToAllowlist(
  next: OpenClawConfig,
  refs: Iterable<string>,
): void {
  // Copy-on-write at each level we modify (callers may pass a shallow copy).
  next.agents = { ...(next.agents ?? {}) }
  next.agents.defaults = { ...(next.agents.defaults ?? ({} as AgentDefaultsConfig)) }
  const defaults = next.agents.defaults

  const allow = Array.isArray(defaults.modelPolicy?.allow)
    ? [...defaults.modelPolicy.allow]
    : []
  const seen = new Set(allow.map((r) => r.trim()).filter(Boolean))
  const mapAdditions: Record<string, { alias: string }> = {}

  for (const raw of refs) {
    const ref = typeof raw === 'string' ? raw.trim() : ''
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    allow.push(ref)
    if (defaults.models?.[ref]) continue
    const slash = ref.indexOf('/')
    mapAdditions[ref] = { alias: slash >= 0 ? ref.slice(slash + 1) : ref }
  }

  if (allow.length > 0) defaults.modelPolicy = { allow }
  if (Object.keys(mapAdditions).length > 0) {
    defaults.models = { ...(defaults.models ?? {}), ...mapAdditions }
  }
}

/**
 * All allowlisted model refs: 2.0 `modelPolicy.allow` union legacy
 * `defaults.models` keys (a fresh 2.0 config may still carry the legacy map
 * until doctor persists the migration).
 */
export function getAllowlistedModelRefs(config: OpenClawConfig): string[] {
  const defaults = config?.agents?.defaults
  if (!defaults) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const ref of defaults.modelPolicy?.allow ?? []) {
    const t = typeof ref === 'string' ? ref.trim() : ''
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  for (const ref of Object.keys(defaults.models ?? {})) {
    if (!seen.has(ref)) {
      seen.add(ref)
      out.push(ref)
    }
  }
  return out
}

/**
 * Save one models.providers entry.
 *
 * Синхронизация видимости (v0.9.23, фикс «подключил провайдера — он не
 * виден в меню агентов / селекторе»): ядро показывает в `models.list` только
 * модели из allowlist (2.0: `agents.defaults.modelPolicy.allow`; legacy:
 * `agents.defaults.models`). Поэтому при сохранении провайдера мы
 * автоматически дописываем его модели в allowlist — и модель сразу появляется
 * в Control UI селекторе, меню агентов и таблице.
 */
export function saveProviderConfig(
  currentConfig: OpenClawConfig,
  providerId: string,
  config: Partial<ModelProviderConfig>,
): OpenClawConfig {
  const next = { ...currentConfig }
  next.models = next.models ?? { providers: {} }
  next.models.providers = next.models.providers ?? {}
  const existing = (next.models.providers[providerId] ?? {}) as ModelProviderConfig
  const endpointDefault = PROVIDER_ENDPOINT_DEFAULTS[providerId]
  const merged = {
    ...existing,
    ...config,
  } as ModelProviderConfig
  if (endpointDefault) {
    // Fill in endpoint fields one by one: baseUrl/api must never be empty or
    // invalid for non-builtin providers (missing api is rejected by the
    // gateway schema, e.g. api: "openai" is not a valid value).
    if (!merged.baseUrl) merged.baseUrl = endpointDefault.baseUrl
    if (!merged.api) merged.api = endpointDefault.api
  }
  next.models.providers[providerId] = merged

  // Allowlist sync: make every model of this provider visible everywhere.
  const modelList = Array.isArray(merged.models) ? merged.models : []
  if (modelList.length > 0) {
    const refs: string[] = []
    for (const m of modelList) {
      const id = typeof m?.id === 'string' && m.id.trim() ? m.id.trim() : ''
      if (!id) continue
      refs.push(`${providerId}/${id}`)
    }
    if (refs.length > 0) addModelsToAllowlist(next, refs)
    // v0.9.24 (Damir): НЕ назначаем первого провайдера primary автоматически.
    // Провайдер просто добавляется в allowlist (виден в меню агентов/селекторе)
    // «наряду со всеми»; основная модель меняется только явным выбором
    // (визард или кнопка «Подключить» в Моделях).
  }
  return next
}

/**
 * Set default model + fallbacks
 */
export function setModelDefaults(
  currentConfig: OpenClawConfig,
  opts: { primary?: string; fallbacks?: string[] },
): OpenClawConfig {
  const next = { ...currentConfig }
  next.agents = next.agents ?? {}
  next.agents.defaults = next.agents.defaults ?? ({} as AgentDefaultsConfig)
  const modelCfg = next.agents.defaults.model
  if (typeof modelCfg === 'string') {
    next.agents.defaults.model = {
      primary: opts.primary ?? modelCfg,
      fallbacks: opts.fallbacks,
    } as AgentModelDefaultsExt
  } else {
    next.agents.defaults.model = {
      ...(typeof modelCfg === 'object' && modelCfg ? modelCfg : {}),
      ...(opts.primary !== undefined && { primary: opts.primary }),
      ...(opts.fallbacks !== undefined && { fallbacks: opts.fallbacks }),
    } as AgentModelDefaultsExt
  }
  return next
}

/** Widen type for fallbacks */
interface AgentModelDefaultsExt {
  primary?: string
  fallbacks?: string[]
}

/**
 * Set model aliases (agents.defaults.models)
 */
export function setModelAliases(
  currentConfig: OpenClawConfig,
  aliases: Record<string, { alias?: string }>,
): OpenClawConfig {
  const next = { ...currentConfig }
  next.agents = next.agents ?? {}
  next.agents.defaults = next.agents.defaults ?? ({} as AgentDefaultsConfig)
  next.agents.defaults.models = aliases
  return next
}

/**
 * Canonical auth.order entry for a provider. OpenClaw expects full profile ids
 * (e.g. `anthropic:work`); older configs may use shorthand (`work` → `anthropic:work`).
 *
 * MiniMax: onboard-style configs list **`global`** under `auth.order.minimax` (resolves to `minimax:global`).
 * Legacy `minimax:default` maps to `minimax:global` — otherwise auth resolves a missing/wrong key → HTTP 401.
 */
export function normalizeAuthOrderEntry(providerId: string, entry: string): string {
  const t = entry.trim()
  if (!t) return t
  if (t.includes(':')) {
    const [pid, ...restParts] = t.split(':')
    const suffix = restParts.join(':')
    if (pid === 'minimax' && suffix.toLowerCase() === 'default') {
      return 'minimax:global'
    }
    return t
  }
  const suffix = providerId === 'minimax' && t.toLowerCase() === 'default' ? 'global' : t
  return `${providerId}:${suffix}`
}

/**
 * Reorder profiles in auth.order[provider]
 */
export function updateAuthOrder(
  currentConfig: OpenClawConfig,
  providerId: string,
  profileIds: string[],
): OpenClawConfig {
  const next = { ...currentConfig }
  next.auth = next.auth ?? ({} as AuthConfig)
  next.auth.order = { ...(next.auth.order ?? {}) }
  next.auth.order[providerId] = profileIds
  return next
}

/**
 * Ensure profileId is first in auth.order[providerId]
 */
export function addProfileToAuthOrder(
  currentConfig: OpenClawConfig,
  providerId: string,
  profileId: string,
): OpenClawConfig {
  const order = (currentConfig?.auth?.order ?? {}) as Record<string, string[]>
  const existing = order[providerId] ?? []
  const newEntry = normalizeAuthOrderEntry(providerId, profileId)
  const normalized = [...new Set(existing.map((e) => normalizeAuthOrderEntry(providerId, e)))]
  if (normalized.includes(newEntry)) return currentConfig
  return updateAuthOrder(currentConfig, providerId, [newEntry, ...normalized])
}

/**
 * Remove profileId from auth.order[providerId]
 */
export function removeProfileFromAuthOrder(
  currentConfig: OpenClawConfig,
  providerId: string,
  profileId: string,
): OpenClawConfig {
  const order = (currentConfig?.auth?.order ?? {}) as Record<string, string[]>
  const existing = order[providerId] ?? []
  const target = normalizeAuthOrderEntry(providerId, profileId)
  const filtered = existing.filter(
    (id) => normalizeAuthOrderEntry(providerId, id) !== target,
  )
  if (filtered.length === existing.length) return currentConfig
  return updateAuthOrder(currentConfig, providerId, filtered)
}
