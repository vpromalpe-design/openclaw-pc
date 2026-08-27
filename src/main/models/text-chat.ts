/**
 * Plain-text chat mode (v0.9.0): a single direct model call WITHOUT the agent
 * runtime — no tools, no memory, no compaction loop. Used by the
 * «Просто текст / Plain text» toggle next to the chat composer.
 *
 * The active model is resolved from the agent's primary model in openclaw.json
 * (local engine or cloud provider), so the mode follows what the user has
 * connected in the Models page.
 */

import type { OpenClawConfig } from '../../shared/types.js'
import { readOpenClawConfig } from '../config/openclaw-config.js'
import { getAuthProfileCredential } from '../providers/auth-profile-store.js'

export interface TextChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface TextChatRequest {
  text: string
  history?: TextChatMessage[]
}

export interface TextChatResponse {
  ok: boolean
  text?: string
  message?: string
  model?: string
  provider?: string
}

const REQUEST_TIMEOUT_MS = 180_000

/** Known OpenAI-compatible base URLs for providers without an explicit baseUrl. */
const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  'openai-codex': 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  xai: 'https://api.x.ai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  together: 'https://api.together.xyz/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  'moonshot-cn': 'https://api.moonshot.cn/v1',
  zai: 'https://api.z.ai/api/paas/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  huggingface: 'https://api-inference.huggingface.co/v1',
  'qwen-portal': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  venice: 'https://api.venice.ai/api/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  vllm: 'http://127.0.0.1:8000/v1',
  litellm: 'http://127.0.0.1:4000/v1',
}

interface ResolvedTarget {
  provider: string
  modelId: string
  baseUrl: string
  apiKey: string
  api: string
}

function resolvePrimaryModel(config: OpenClawConfig): string | null {
  const dm = config.agents?.defaults?.model
  if (typeof dm === 'string' && dm.trim()) return dm.trim()
  if (dm && typeof dm === 'object' && typeof dm.primary === 'string' && dm.primary.trim()) {
    return dm.primary.trim()
  }
  return null
}

function resolveTarget(config: OpenClawConfig): ResolvedTarget | null {
  const primary = resolvePrimaryModel(config)
  if (!primary) return null

  // Local engine: primary is `local/<modelId>`, served by our schema-fix
  // proxy on 18788 (OpenAI-compatible, no key).
  if (primary.startsWith('local/')) {
    const localProvider = config.models?.providers?.local
    const modelId =
      (Array.isArray(localProvider?.models) && localProvider.models[0]?.id) ||
      primary.slice('local/'.length)
    return {
      provider: 'local',
      modelId,
      baseUrl: localProvider?.baseUrl ?? 'http://127.0.0.1:18788/v1',
      apiKey: '',
      api: 'openai-completions',
    }
  }

  const slash = primary.indexOf('/')
  const providerId = slash > 0 ? primary.slice(0, slash) : primary
  const modelId = slash > 0 ? primary.slice(slash + 1) : ''
  if (!providerId || !modelId) return null

  const p = config.models?.providers?.[providerId]
  const baseUrl = p?.baseUrl?.trim() || DEFAULT_BASE_URLS[providerId]
  if (!baseUrl) return null

  let apiKey = p?.apiKey?.trim() ?? ''
  if (!apiKey) {
    // Cloud credentials often live in auth-profiles (e.g. openrouter:default).
    const cred = getAuthProfileCredential(`${providerId}:default`)
    if (cred?.type === 'api_key') apiKey = cred.value
  }
  if (!apiKey) return null

  return {
    provider: providerId,
    modelId,
    baseUrl,
    apiKey,
    api: p?.api ?? 'openai-completions',
  }
}

function extractText(provider: string, body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>
  if (Array.isArray(obj.choices)) {
    const choice = obj.choices[0] as Record<string, unknown> | undefined
    const msg = choice?.message as Record<string, unknown> | undefined
    if (msg && typeof msg.content === 'string') return msg.content
    const text = choice?.text
    if (typeof text === 'string') return text
  }
  if (Array.isArray(obj.content)) {
    const parts = (obj.content as unknown[]).map((b) => (b as Record<string, unknown>)?.text)
    const joined = parts.filter((x): x is string => typeof x === 'string').join('')
    if (joined) return joined
  }
  if (Array.isArray(obj.candidates)) {
    const cand = obj.candidates[0] as Record<string, unknown> | undefined
    const content = cand?.content as Record<string, unknown> | undefined
    if (Array.isArray(content?.parts)) {
      const parts = (content.parts as unknown[])
        .map((b) => (b as Record<string, unknown>)?.text)
        .filter((x): x is string => typeof x === 'string')
        .join('')
      if (parts) return parts
    }
  }
  return null
}

export async function sendTextChat(req: TextChatRequest): Promise<TextChatResponse> {
  const text = req.text?.trim()
  if (!text) return { ok: false, message: 'Empty message' }

  let config: OpenClawConfig
  try {
    config = readOpenClawConfig() ?? {}
  } catch {
    return { ok: false, message: 'Cannot read config' }
  }

  const target = resolveTarget(config)
  if (!target) {
    return {
      ok: false,
      message:
        'No active model. Connect a provider or start a local model in «Модели» first.',
    }
  }

  const messages: TextChatMessage[] = [
    ...(Array.isArray(req.history) ? req.history.slice(-10) : []),
    { role: 'user', content: text },
  ]

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    let url: string
    let headers: Record<string, string>
    let body: unknown

    if (target.api === 'anthropic') {
      url = `${target.baseUrl.replace(/\/+$/, '')}/v1/messages`
      headers = {
        'x-api-key': target.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      }
      body = {
        model: target.modelId,
        max_tokens: 2048,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }
    } else {
      // OpenAI-compatible (covers local engine + most cloud providers).
      const base = target.baseUrl.replace(/\/+$/, '')
      url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
      headers = {
        'content-type': 'application/json',
        ...(target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {}),
      }
      body = {
        model: target.modelId,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: 2048,
        temperature: 0.7,
        stream: false,
      }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      let detail = ''
      try {
        const errBody = (await res.json()) as Record<string, unknown>
        const e = errBody.error as Record<string, unknown> | undefined
        if (e && typeof e.message === 'string') detail = e.message
        else if (typeof errBody.message === 'string') detail = errBody.message
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        message: `HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
      }
    }

    const data = (await res.json()) as unknown
    const reply = extractText(target.provider, data)
    if (reply === null) {
      return { ok: false, message: 'Unexpected model response' }
    }
    return {
      ok: true,
      text: reply.trim(),
      model: target.modelId,
      provider: target.provider,
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      message: aborted ? 'Model timed out (180s)' : err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
