/**
 * v0.9.23 (B): «Загрузить модели провайдера» — GET /models с ключом
 * пользователя для OpenAI-совместимых и Anthropic-совместимых провайдеров,
 * плюс спец-обработка Google (generativelanguage) и Ollama (/api/tags).
 */

const FETCH_TIMEOUT_MS = 15_000

export interface FetchProviderModelsOpts {
  providerId: string
  baseUrl: string
  apiKey: string
  compatibility?: 'openai' | 'anthropic'
}

export interface FetchedModel {
  id: string
  name?: string
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function parseModelList(body: unknown): FetchedModel[] {
  if (!body || typeof body !== 'object') return []
  const obj = body as Record<string, unknown>

  // OpenAI style: { data: [{ id, object, owned_by }] }
  if (Array.isArray(obj.data)) {
    return (obj.data as unknown[])
      .map((m): FetchedModel | null => {
        if (!m || typeof m !== 'object') return null
        const mm = m as Record<string, unknown>
        if (typeof mm.id !== 'string' || !mm.id) return null
        const out: FetchedModel = { id: mm.id }
        if (typeof mm.name === 'string' && mm.name) out.name = mm.name
        return out
      })
      .filter((x): x is FetchedModel => x !== null)
  }

  // Anthropic style: { data: [{ type: 'model', id }] } / generic { models: [...] }
  if (Array.isArray(obj.models)) {
    return (obj.models as unknown[])
      .map((m): FetchedModel | null => {
        if (!m || typeof m !== 'object') return null
        const mm = m as Record<string, unknown>
        if (typeof mm.id !== 'string' || !mm.id) return null
        const out: FetchedModel = { id: mm.id }
        if (typeof mm.name === 'string' && mm.name) out.name = mm.name
        return out
      })
      .filter((x): x is FetchedModel => x !== null)
  }

  return []
}

export async function fetchProviderModels(opts: FetchProviderModelsOpts): Promise<FetchedModel[]> {
  const { providerId, apiKey } = opts
  const baseUrl = stripTrailingSlash(opts.baseUrl.trim())
  if (!baseUrl) throw new Error('baseUrl is required')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  const attempt = async (url: string, headers: Record<string, string>): Promise<FetchedModel[]> => {
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }
    const body: unknown = await response.json().catch(() => undefined)
    return parseModelList(body)
  }

  try {
    // Ollama: /api/tags
    if (providerId === 'ollama') {
      const body: unknown = await (await fetch(`${baseUrl}/api/tags`, { signal: controller.signal })).json().catch(() => undefined)
      const models = parseModelList(body)
      return models.length > 0
        ? models
        : parseModelList({ models: (body as { models?: Array<{ name?: string; model?: string }> })?.models?.map((m) => ({ id: m.model ?? m.name ?? '' })) ?? [] })
    }

    // Google Gemini (OpenAI-compat endpoint or native generativelanguage)
    if (providerId === 'google' && !baseUrl.includes('openai')) {
      const url = `${baseUrl}/models?key=${encodeURIComponent(apiKey)}`
      const body: unknown = await (await fetch(url, { signal: controller.signal })).json().catch(() => undefined)
      const list = Array.isArray((body as Record<string, unknown>)?.models)
        ? ((body as Record<string, unknown>).models as Array<Record<string, unknown>>)
        : []
      return list
        .map((m): FetchedModel | null => {
          const name = typeof m.name === 'string' ? m.name : ''
          const id = name.replace(/^models\//, '')
          if (!id) return null
          const out: FetchedModel = { id }
          if (typeof m.displayName === 'string' && m.displayName) out.name = m.displayName
          return out
        })
        .filter((x): x is FetchedModel => x !== null)
    }

    const isAnthropic = opts.compatibility === 'anthropic'
    const headers: Record<string, string> = isAnthropic
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { authorization: `Bearer ${apiKey}` }

    try {
      return await attempt(`${baseUrl}/models`, headers)
    } catch (err) {
      // Retry with /v1 prefix when the base URL has no version segment
      // (e.g. https://api.deepseek.com → https://api.deepseek.com/v1/models).
      const hasVersion = /\/v\d+(\/|$)/.test(baseUrl)
      if (!hasVersion) {
        try {
          return await attempt(`${baseUrl}/v1/models`, headers)
        } catch {
          /* fallthrough to original error */
        }
      }
      throw err
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
