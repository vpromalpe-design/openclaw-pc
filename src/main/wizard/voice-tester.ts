/**
 * Voice (realtime talk) connectivity probe.
 *
 * Tries to reach the realtime provider's API with the supplied key:
 * - google: GET https://generativelanguage.googleapis.com/v1beta/models
 * - openai: GET https://api.openai.com/v1/models
 *
 * Distinguishes geo-blocking (RU IPs get 400 FAILED_PRECONDITION from Google)
 * from invalid keys and network failures, so the UI can show honest guidance.
 */

import type { VoiceTestResult } from '../../shared/types.js'

const REQUEST_TIMEOUT_MS = 12_000

interface ProbeTarget {
  url: string
  headers: Record<string, string>
}

function buildTarget(provider: string, apiKey: string): ProbeTarget | null {
  if (provider === 'google') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      headers: {},
    }
  }
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/models',
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  }
  return null
}

export async function testVoiceConnection(provider: string, apiKey: string): Promise<VoiceTestResult> {
  const key = (apiKey ?? '').trim()
  if (!key) {
    return { ok: false, status: 'missing-key', message: 'No API key provided' }
  }
  const target = buildTarget(provider, key)
  if (!target) {
    return { ok: false, status: 'network-error', message: `Unknown provider: ${provider}` }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(target.url, {
      method: 'GET',
      headers: target.headers,
      signal: controller.signal,
    })

    if (res.ok) {
      return { ok: true, status: 'ok', message: 'Connection succeeded' }
    }

    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = undefined
    }

    const raw = JSON.stringify(body ?? {})

    // Google geo-block: RU / unsupported regions return 400 FAILED_PRECONDITION.
    if (res.status === 400 && raw.includes('FAILED_PRECONDITION')) {
      return {
        ok: false,
        status: 'geo-blocked',
        message: 'User location is not supported for the API use',
      }
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: 'invalid-key', message: `HTTP ${res.status}` }
    }
    return { ok: false, status: 'network-error', message: `HTTP ${res.status}` }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, status: 'network-error', message: 'Timed out' }
    }
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('fetch failed') || message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
      return { ok: false, status: 'network-error', message: 'Network error' }
    }
    return { ok: false, status: 'network-error', message: `Connection failed: ${message}` }
  } finally {
    clearTimeout(timeoutId)
  }
}
