/**
 * Gateway RPC client over WebSocket (not HTTP), compatible with upstream gateway protocol.
 */

import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { DEFAULT_GATEWAY_PORT } from '../../shared/constants.js'
import { readShellConfig, readOpenClawConfig } from '../config/index.js'

// Upstream gateway protocol version (packages/gateway-protocol/src/version.ts):
// MIN_CLIENT_PROTOCOL_VERSION = 4 — older versions are rejected with
// "protocol mismatch". Keep in sync when the bundled OpenClaw bumps it.
const PROTOCOL_VERSION = 4
// Use a gateway-approved client id: upstream validates `client.id` against
// GATEWAY_CLIENT_IDS (packages/gateway-protocol/src/client-info.ts).
// v0.10.0 (core 2026.8.1): 'openclaw-control-ui' is rejected without device
// identity ("control ui requires device identity"). Local loopback manager
// clients must present as 'gateway-client' + mode 'backend' to keep full
// operator scopes (skipLocalBackendSelfPairing path). Verified on staging.
// NOTE (2026.8.1, verified on staging 18999): the skip path additionally
// requires the connection to have NO browser-style Origin header — with
// Origin set, the 2.0 gateway treats the client as browser-origin, refuses
// skipLocalBackendSelfPairing, and silently cuts operator scopes (connect
// succeeds, every operator.read/admin RPC then fails FORBIDDEN). doConnect()
// therefore tries without Origin first and falls back to Origin once for
// legacy gateways (<=2026.7) that validated Origin against allowedOrigins.
const CLIENT_ID = 'gateway-client'
const CLIENT_VERSION = '0.1.2'

// ─── Errors ────────────────────────────────────────────────────────────────

export class GatewayRpcError extends Error {
  constructor(
    message: string,
    public readonly code: GatewayRpcErrorCode,
    public readonly retryable = false,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'GatewayRpcError'
  }
}

export type GatewayRpcErrorCode =
  | 'GATEWAY_UNREACHABLE'
  | 'GATEWAY_TIMEOUT'
  | 'GATEWAY_AUTH_FAILED'
  | 'GATEWAY_RPC_ERROR'
  | 'GATEWAY_NOT_CONNECTED'

// ─── Options ─────────────────────────────────────────────────────────────────

export interface GatewayRpcClientOptions {
  port: number
  token?: string
  /** Gateway password auth (`gateway.auth.mode === 'password'`); mutually exclusive with token in connect frame. */
  password?: string
  timeoutMs?: number
  maxRetries?: number
  /** Optional listener for gateway event frames (v0.9.12: agent activity via sessions.subscribe). */
  onEvent?: (event: string, payload: unknown) => void
}

// ─── Wire frames (upstream gateway protocol) ─────────────────────────────────

interface RequestFrame {
  type: 'req'
  id: string
  method: string
  params?: unknown
}

interface ResponseFrame {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: { code?: string; message?: string; retryable?: boolean }
}

interface EventFrame {
  type: 'event'
  event: string
  payload?: unknown
}

type GatewayFrame = RequestFrame | ResponseFrame | EventFrame

function isEventFrame(f: GatewayFrame): f is EventFrame {
  return (f as EventFrame).type === 'event'
}

function isResponseFrame(f: GatewayFrame): f is ResponseFrame {
  return (f as ResponseFrame).type === 'res'
}

// ─── GatewayRpcClient ───────────────────────────────────────────────────────

export class GatewayRpcClient {
  private ws: WebSocket | null = null
  private readonly port: number
  private readonly token?: string
  private readonly password?: string
  private readonly defaultTimeoutMs: number
  private readonly maxRetries: number
  private connectPromise: Promise<void> | null = null
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private connectNonce: string | null = null;
  private closed = false
  private readonly onEvent?: (event: string, payload: unknown) => void

  /** True while the underlying WebSocket is open (connection may still be mid-handshake). */
  get isConnected(): boolean {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN)
  }

  constructor(options: GatewayRpcClientOptions) {
    this.port = options.port
    this.token = options.token?.trim() || undefined
    this.password = options.password?.trim() || undefined
    this.defaultTimeoutMs = options.timeoutMs ?? 15_000
    this.maxRetries = Math.max(0, options.maxRetries ?? 3)
    this.onEvent = options.onEvent
  }

  /** Open WebSocket and finish connect handshake */
  async connect(): Promise<void> {
    if (this.closed) {
      throw new GatewayRpcError('client closed', 'GATEWAY_NOT_CONNECTED')
    }
    if (this.connectPromise) {
      return this.connectPromise
    }

    const url = `ws://127.0.0.1:${this.port}`
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        this.connectPromise = this.doConnect(url)
        await this.connectPromise
        return
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        const isRetryable =
          lastError instanceof GatewayRpcError && lastError.retryable
        if (!isRetryable || attempt >= this.maxRetries) {
          this.connectPromise = null
          throw lastError
        }
        const delayMs = Math.min(1000 * 2 ** attempt, 8000)
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }

    this.connectPromise = null
    throw lastError ?? new GatewayRpcError('connection failed', 'GATEWAY_UNREACHABLE', true)
  }

  private doConnect(url: string): Promise<void> {
    // Try the 2.0-correct shape first (loopback backend WITHOUT browser
    // Origin); legacy kernels that enforce allowedOrigins reject that
    // handshake, so fall back to the legacy Origin-mirroring shape once.
    return this.attemptConnect(url, false).catch((err: Error) => {
      const e = err as GatewayRpcError
      // Legacy kernels that enforce allowedOrigins reject the no-Origin
      // handshake fast (close/error), not via timeout. Skip the Origin
      // fallback for auth failures and timeouts to keep latency bounded.
      if (e.code === 'GATEWAY_AUTH_FAILED' || e.code === 'GATEWAY_TIMEOUT') throw err
      return this.attemptConnect(url, true)
    })
  }

  private attemptConnect(url: string, withOrigin: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      let connectResolved = false
      const controller = new AbortController()
      const timeout = setTimeout(() => {
        if (!connectResolved) {
          connectResolved = true
          controller.abort()
          ws.close()
          reject(new GatewayRpcError(`connect timeout after ${this.defaultTimeoutMs}ms`, 'GATEWAY_TIMEOUT', true))
        }
      }, this.defaultTimeoutMs)

      const ws = new WebSocket(
        url,
        withOrigin
          ? {
              handshakeTimeout: 10_000,
              headers: {
                // Legacy gateways (<=2026.7) validate the WebSocket Origin
                // against the Control UI host (gateway.controlUi.allowedOrigins).
                // Mirror the browser origin only for that fallback path — on
                // 2.0 (2026.8.x) this header marks the connection as
                // browser-origin and cuts operator scopes (see CLIENT_ID note).
                Origin: `http://127.0.0.1:${this.port}`,
              },
            }
          : { handshakeTimeout: 10_000 })

      ws.on('error', (err: Error) => {
        if (!controller.signal.aborted && !connectResolved) {
          connectResolved = true
          clearTimeout(timeout)
          reject(new GatewayRpcError(String(err), 'GATEWAY_UNREACHABLE', true, err))
        }
      })

      ws.on('close', (code: number, reason: Buffer) => {
        if (!connectResolved) {
          connectResolved = true
          clearTimeout(timeout)
          reject(
            new GatewayRpcError(
              `connection closed: ${code} ${reason.toString()}`,
              'GATEWAY_UNREACHABLE',
              true
            )
          )
        }
      })

      ws.on('message', (data: WebSocket.RawData) => {
        if (connectResolved) {
          this.handleMessage(data)
          return
        }

        try {
          const parsed = JSON.parse(data.toString()) as GatewayFrame
          if (isEventFrame(parsed) && parsed.event === 'connect.challenge') {
            const payload = parsed.payload as { nonce?: string } | undefined
            const nonce = payload?.nonce?.trim()
            if (!nonce) {
              connectResolved = true
              clearTimeout(timeout)
              reject(new GatewayRpcError('connect.challenge missing nonce', 'GATEWAY_RPC_ERROR'))
              ws.close()
              return
            }
            this.connectNonce = nonce
            this.sendConnect(ws)
            return
          }
          if (isResponseFrame(parsed) && parsed.id === 'connect-req') {
            connectResolved = true
            clearTimeout(timeout)
            if (parsed.ok) {
              this.ws = ws
              // v0.8.25: without a post-connect close handler a reused client
              // survives a gateway restart with a stale resolved connectPromise
              // and a dead ws — every later call fails GATEWAY_NOT_CONNECTED
              // forever. Clear cached state so the next connect() reconnects.
              ws.on('close', () => {
                if (this.ws === ws) {
                  this.ws = null
                }
                if (this.connectPromise) {
                  this.connectPromise = null
                }
              })
              ws.on('error', () => {
                if (this.ws === ws) {
                  this.ws = null
                }
                if (this.connectPromise) {
                  this.connectPromise = null
                }
              })
              resolve()
            } else {
              const msg = parsed.error?.message ?? 'connect failed'
              const code = parsed.error?.code === 'UNAUTHORIZED' ? 'GATEWAY_AUTH_FAILED' : 'GATEWAY_RPC_ERROR'
              reject(new GatewayRpcError(msg, code, false))
              ws.close()
            }
          }
        } catch (err) {
          if (!connectResolved) {
            connectResolved = true
            clearTimeout(timeout)
            reject(new GatewayRpcError(String(err), 'GATEWAY_RPC_ERROR', false, err))
            ws.close()
          }
        }
      })
    })
  }

  private sendConnect(ws: WebSocket): void {
    const auth = this.token
      ? { token: this.token }
      : this.password
        ? { password: this.password }
        : undefined
    const connectParams = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: CLIENT_ID,
        version: CLIENT_VERSION,
        platform: process.platform,
        mode: 'backend',
      },
      auth,
      role: 'operator',
      // Align with upstream Control UI operator scopes (gateway.ts CONTROL_UI_OPERATOR_SCOPES)
      scopes: [
        'operator.admin',
        'operator.read',
        'operator.write',
        'operator.approvals',
        'operator.pairing',
      ],
      caps: ['tool-events'],
    }
    const frame: RequestFrame = {
      type: 'req',
      id: 'connect-req',
      method: 'connect',
      params: connectParams,
    }
    ws.send(JSON.stringify(frame))
  }

  private handleMessage(data: WebSocket.RawData): void {
    try {
      const parsed = JSON.parse(data.toString()) as GatewayFrame
      if (isResponseFrame(parsed)) {
        const pending = this.pending.get(parsed.id)
        if (pending) {
          this.pending.delete(parsed.id)
          if (parsed.ok) {
            pending.resolve(parsed.payload)
          } else {
            const err = parsed.error
            const code = mapErrorCode(err?.code)
            const message = err?.message ?? 'RPC error'
            pending.reject(new GatewayRpcError(message, code, err?.retryable ?? false))
          }
        }
        return
      }
      if (isEventFrame(parsed) && this.onEvent) {
        try {
          this.onEvent(parsed.event, parsed.payload)
        } catch {
          // listener errors must not break the socket loop
        }
      }
    } catch {
      // ignore parse errors for unknown frames
    }
  }

  /** Send RPC request and await response */
  async request<T = unknown>(
    method: string,
    params?: unknown,
    opts?: { timeoutMs?: number }
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect()
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new GatewayRpcError('not connected', 'GATEWAY_NOT_CONNECTED')
    }

    const id = randomUUID()
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs

    const frame: RequestFrame = { type: 'req', id, method, params }
    this.ws.send(JSON.stringify(frame))

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new GatewayRpcError(`timeout after ${timeoutMs}ms`, 'GATEWAY_TIMEOUT', true))
        }
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
    })
  }

  /** Streaming stub: delegates to request; invokes onChunk once if provided */
  async stream(
    method: string,
    params?: unknown,
    onChunk?: (chunk: unknown) => void
  ): Promise<void> {
    const result = await this.request(method, params)
    if (onChunk && result !== undefined) {
      onChunk(result)
    }
  }

  close(): void {
    this.closed = true
    this.connectPromise = null
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    for (const [, { reject }] of this.pending) {
      reject(new GatewayRpcError('client closed', 'GATEWAY_NOT_CONNECTED'))
    }
    this.pending.clear()
  }
}

function mapErrorCode(code?: string): GatewayRpcErrorCode {
  if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') return 'GATEWAY_AUTH_FAILED'
  if (code === 'TIMEOUT') return 'GATEWAY_TIMEOUT'
  if (code === 'UNAVAILABLE') return 'GATEWAY_UNREACHABLE'
  return 'GATEWAY_RPC_ERROR'
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Build client from shell + OpenClaw config (port from lastGatewayPort; token or password from gateway.auth).
 */
export async function createGatewayRpcClientFromConfig(
  overrides?: Partial<GatewayRpcClientOptions>
): Promise<GatewayRpcClient> {
  const shellConfig = readShellConfig()
  const openclawConfig = readOpenClawConfig()
  const port = overrides?.port ?? shellConfig.lastGatewayPort ?? DEFAULT_GATEWAY_PORT
  const gwAuth = openclawConfig.gateway?.auth
  let token = overrides?.token
  let password = overrides?.password
  if (token === undefined && password === undefined && gwAuth) {
    const t = gwAuth.token?.trim()
    const p = typeof gwAuth.password === 'string' ? gwAuth.password.trim() : ''
    if (gwAuth.mode === 'password') {
      if (p) password = p
    } else if (t) {
      token = t
    } else if (p) {
      password = p
    }
  }
  return new GatewayRpcClient({
    port,
    token,
    password,
    timeoutMs: 15_000,
    maxRetries: 3,
    ...overrides,
  })
}
