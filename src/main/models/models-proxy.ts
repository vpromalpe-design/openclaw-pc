/**
 * Models list via RPC `models.list`, falling back to config parsing when gateway is down.
 */

import { createGatewayRpcClientFromConfig } from '../gateway/rpc-client.js'
import { GatewayRpcError } from '../gateway/rpc-client.js'
import type { OpenClawConfig } from '../../shared/types.js'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ModelListItem {
  id: string
  name?: string
  provider?: string
}

export interface ModelsListResult {
  models: ModelListItem[]
}

// ─── RPC shape (models.list) ─────────────────────────────────────────────────

interface ModelsListRpcPayload {
  models?: Array<{ id?: string; name?: string; provider?: string; [key: string]: unknown }>
}

// ─── Extract from config ─────────────────────────────────────────────────────

function extractModelsFromConfig(config: OpenClawConfig): ModelListItem[] {
  const providers = config?.models?.providers ?? {}
  const items: ModelListItem[] = []
  const seen = new Set<string>()

  const push = (id: string, providerId: string, name?: string) => {
    const key = `${providerId}/${id}`
    if (!id || seen.has(key)) return
    seen.add(key)
    items.push({ id, name, provider: providerId })
  }

  for (const [providerId, p] of Object.entries(providers)) {
    if (!p || typeof p !== 'object') continue
    const models = (p as { models?: Array<{ id: string; name?: string }> }).models ?? []
    for (const m of models) push(m.id ?? '', providerId, m.name)
  }

  // Allowlist entries (agents.defaults.models): catches models that live only
  // in the allowlist (e.g. local/<model> from the wizard) without a
  // models.providers record.
  const allowlist = config?.agents?.defaults?.models ?? {}
  for (const ref of Object.keys(allowlist)) {
    const slash = ref.indexOf('/')
    if (slash <= 0) continue
    const providerId = ref.slice(0, slash)
    const id = ref.slice(slash + 1)
    if (id && id !== 'auto') push(id, providerId)
  }

  return items.sort((a, b) => a.id.localeCompare(b.id))
}

// ─── Map RPC → UI rows ───────────────────────────────────────────────────────

function mapRpcModels(payload: ModelsListRpcPayload): ModelListItem[] {
  const raw = payload?.models ?? []
  return raw
    .map((m) => {
      const id = m.id ?? m.name ?? ''
      if (!id) return null
      return {
        id: String(id),
        name: typeof m.name === 'string' ? m.name : undefined,
        provider: typeof m.provider === 'string' ? m.provider : undefined,
      } as ModelListItem
    })
    .filter((x): x is ModelListItem => x !== null)
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * List models: RPC first, config fallback.
 *
 * v0.9.23 (C): RPC `models.list` возвращает ТОЛЬКО allowlist (agents.defaults.models).
 * Модели, подключённые в приложении (models.providers), в него не попадали —
 * поэтому объединяем RPC-результат с конфигом (dedupe по `provider/id`), чтобы
 * пикер и меню агентов показывали ВСЕ модели.
 */
export async function listModelsWithProxy(
  readOpenClawConfig: () => OpenClawConfig
): Promise<ModelsListResult> {
  let client: Awaited<ReturnType<typeof createGatewayRpcClientFromConfig>> | null = null

  const fromConfig = () => {
    const config = readOpenClawConfig()
    return extractModelsFromConfig(config)
  }

  const merge = (rpcModels: ModelListItem[], configModels: ModelListItem[]): ModelListItem[] => {
    const seen = new Set<string>()
    const out: ModelListItem[] = []
    for (const m of [...rpcModels, ...configModels]) {
      const key = m.provider ? `${m.provider}/${m.id}` : m.id
      if (seen.has(key)) continue
      seen.add(key)
      out.push(m)
    }
    return out
  }

  try {
    client = await createGatewayRpcClientFromConfig()
    const payload = await client.request<ModelsListRpcPayload>('models.list', {})
    client.close()
    client = null

    const models = merge(mapRpcModels(payload ?? {}), fromConfig())
    return { models }
  } catch (err) {
    if (client) {
      try {
        client.close()
      } catch {
        /* ignore */
      }
    }
    if (err instanceof GatewayRpcError) {
      if (
        err.code === 'GATEWAY_UNREACHABLE' ||
        err.code === 'GATEWAY_NOT_CONNECTED' ||
        err.code === 'GATEWAY_TIMEOUT'
      ) {
        return { models: fromConfig() }
      }
    }
    return { models: fromConfig() }
  }
}
