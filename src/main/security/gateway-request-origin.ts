import { LOOPBACK_GATEWAY_HOSTS } from './gateway-response-headers.js'

function normalizeLoopbackHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
}

function resolveUrlPort(url: URL): number {
  if (url.port) return parseInt(url.port, 10)
  return url.protocol === 'https:' ? 443 : 80
}

/**
 * Electron's embedded iframe sometimes omits `Origin` or sends `Origin: null` on WebSocket upgrade.
 * Upstream OpenClaw rejects that before the loopback bypass in `checkBrowserOrigin`, breaking Control UI.
 * Set Origin to the request URL origin when targeting the desktop-managed gateway port on loopback.
 */
export function ensureLoopbackGatewayOriginHeader(
  rawUrl: string,
  requestHeaders: Record<string, string | string[] | undefined>,
  gatewayPort: number,
): Record<string, string | string[] | undefined> | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null
  }
  const host = normalizeLoopbackHostname(url.hostname)
  if (!LOOPBACK_GATEWAY_HOSTS.has(host) && host !== '::1') {
    return null
  }
  if (resolveUrlPort(url) !== gatewayPort) {
    return null
  }

  const pickOrigin = (): string | undefined => {
    for (const key of Object.keys(requestHeaders)) {
      if (key.toLowerCase() === 'origin') {
        const v = requestHeaders[key]
        const s = Array.isArray(v) ? v[0] : v
        return typeof s === 'string' ? s : undefined
      }
    }
    return undefined
  }
  const origin = pickOrigin()
  if (origin && origin.trim() !== '' && origin.trim().toLowerCase() !== 'null') {
    return null
  }

  const next: Record<string, string | string[] | undefined> = { ...requestHeaders }
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === 'origin') {
      delete next[key]
    }
  }
  next.Origin = `${url.protocol}//${url.host}`
  return next
}
