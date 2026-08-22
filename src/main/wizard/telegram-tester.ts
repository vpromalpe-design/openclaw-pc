/**
 * Telegram bot token probe — validates a BotFather token via getMe
 * and gives the user a clear, actionable error when the network
 * blocks Telegram (common in RU/CIS without VPN).
 *
 * Lesson from 0.8.5 field report (2026-08-17): the "bot is silent"
 * symptom was caused by the network blocking api.telegram.org while
 * the token itself was valid. The wizard now distinguishes:
 *   - invalid token      → "check the token"
 *   - network blocked    → "enable VPN / use an http(s) proxy"
 *   - socks5 proxy       → hint that socks5 is experimental in OpenClaw
 *
 * The probe is dependency-free: direct fetch, or an HTTP(S) CONNECT
 * tunnel via Node's built-in `http`/`tls` when a proxy is configured.
 */

import type { WizardTestTelegramResult } from '../../shared/types.js'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

const REQUEST_TIMEOUT_MS = 12_000

interface TelegramProbeInput {
  botToken?: string
  proxy?: string
}

interface TelegramGetMeResponse {
  ok?: boolean
  result?: { id?: number; username?: string; first_name?: string }
  description?: string
  _status?: number
}

function describeError(err: unknown): string {
  const code = (err as { code?: string; cause?: unknown })?.code
  const cause = (err as { cause?: unknown })?.cause as
    | { code?: string; message?: string }
    | undefined
  const raw = `${code ?? cause?.code ?? ''} ${cause?.message ?? String(err)}`.trim()
  if (/ENOTFOUND|UND_ERR_CONNECT|ECONNREFUSED|ETIMEDOUT|ECONNRESET|timeout/i.test(raw)) {
    return 'network'
  }
  if (/parse error|expected http\/|invalid header/i.test(raw)) {
    return 'network'
  }
  return 'unknown'
}

function parseProxyUrl(proxy: string): { host: string; port: number; secure: boolean } | null {
  try {
    const u = new URL(proxy)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
    return { host: u.hostname, port, secure: u.protocol === 'https:' }
  } catch {
    return null
  }
}

/**
 * getMe through an HTTP(S) proxy using a raw CONNECT tunnel.
 * Throws on network/proxy errors; resolves with the parsed JSON body.
 */
function getMeViaProxy(token: string, proxyUrl: string, timeoutMs: number): Promise<TelegramGetMeResponse> {
  return new Promise((resolve, reject) => {
    const parsed = parseProxyUrl(proxyUrl)
    if (!parsed) {
      reject(new Error('proxy-unsupported'))
      return
    }

    const targetHost = 'api.telegram.org'
    const targetPort = 443
    const proxyProto = parsed.secure ? https : http

    const req = proxyProto.request({
      host: parsed.host,
      port: parsed.port,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: { host: `${targetHost}:${targetPort}` },
      timeout: timeoutMs,
    })

    const fail = (err: unknown) => {
      req.destroy()
      reject(err)
    }

    req.on('connect', (res: { statusCode?: number }, socket: net.Socket) => {
      if (!res.statusCode || res.statusCode !== 200) {
        fail(new Error(`proxy-http-${res.statusCode}`))
        return
      }
      // v0.8.25: the tunnel socket is a PLAIN TCP pipe to the target in both
      // cases — `parsed.secure` describes the proxy scheme (https proxy = TLS
      // between client and proxy, terminated there), not the target. The target
      // (api.telegram.org:443) is always TLS, so the socket must ALWAYS be
      // wrapped in tls.connect. Before this fix, an http:// proxy handed
      // https.request a raw socket and Node sent plaintext HTTP into the TLS
      // port → "socket hang up" on every attempt (verified empirically).
      const tlsSocket = tls.connect({ socket, servername: targetHost })

      const getReq = https.request(
        {
          host: targetHost,
          port: targetPort,
          path: `/bot${token}/getMe`,
          method: 'GET',
          headers: { accept: 'application/json' },
          createConnection: () => tlsSocket as unknown as net.Socket,
        },
        (res2: http.IncomingMessage) => {
          const chunks: Buffer[] = []
          res2.on('data', (c: Buffer) => chunks.push(c))
          res2.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            try {
              resolve({ ...(JSON.parse(text) as object), _status: res2.statusCode } as TelegramGetMeResponse)
            } catch {
              reject(new Error('bad-response'))
            }
          })
        },
      )
      getReq.on('error', fail)
      getReq.setTimeout(timeoutMs, () => fail(new Error('timeout')))
      getReq.end()
    })

    req.on('error', fail)
    req.on('timeout', () => fail(new Error('timeout')))
    req.end()
  })
}

/**
 * Probe the bot token with getMe. Uses a direct fetch, or an HTTP(S)
 * CONNECT tunnel when `proxy` is set. SOCKS5 is reported as unsupported
 * with a clear hint (Node's built-in socks5 is experimental and was the
 * root cause of the "silent bot" incident on 2026-08-17).
 */
export async function testTelegramConnection(
  input: TelegramProbeInput,
): Promise<WizardTestTelegramResult> {
  const token = input.botToken?.trim()
  if (!token) {
    return { ok: false, message: 'missing-token' }
  }
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    return { ok: false, message: 'malformed-token' }
  }

  const proxy = input.proxy?.trim()
  const SOCKS5_HINT =
    'proxy-unsupported: only http/https proxies are reliable in OpenClaw; socks5 is experimental'

  if (proxy && !/^https?:\/\//i.test(proxy)) {
    return { ok: false, message: SOCKS5_HINT }
  }

  try {
    const body = proxy
      ? await getMeViaProxy(token, proxy, REQUEST_TIMEOUT_MS)
      : await fetchWithTimeout(`https://api.telegram.org/bot${token}/getMe`, REQUEST_TIMEOUT_MS)

    const status = body._status ?? 200
    if (status >= 200 && status < 300 && body.ok && body.result) {
      return {
        ok: true,
        botName: body.result.username
          ? `@${body.result.username}`
          : body.result.first_name ?? 'Telegram bot',
        botId: body.result.id != null ? String(body.result.id) : undefined,
      }
    }
    if (status === 401 || status === 400) {
      return { ok: false, message: 'invalid-token' }
    }
    return {
      ok: false,
      message: `http-${status}: ${body.description ?? 'unexpected response'}`,
    }
  } catch (err) {
    const msg = String(err)
    if (msg.includes('proxy-unsupported')) {
      return { ok: false, message: SOCKS5_HINT }
    }
    if (msg.startsWith('proxy-http-')) {
      return { ok: false, message: 'network-through-proxy' }
    }
    if (describeError(err) === 'network') {
      return {
        ok: false,
        message: proxy ? 'network-through-proxy' : 'network-blocked',
      }
    }
    return { ok: false, message: `error: ${msg}` }
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<TelegramGetMeResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json' },
      redirect: 'follow',
    })
    const body = (await res.json().catch(() => null)) as object | null
    return { ...(body ?? {}), _status: res.status } as TelegramGetMeResponse
  } finally {
    clearTimeout(timer)
  }
}
