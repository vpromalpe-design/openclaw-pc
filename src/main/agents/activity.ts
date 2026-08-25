/**
 * Agent activity monitor (v0.9.12, Этап E3 — «лампочка активности как HDD»).
 *
 * A long-lived gateway RPC client that subscribes to `sessions.changed`
 * events and broadcasts per-agent busy/idle state to the renderer.
 *
 * The gateway delivers `sessions.changed` to subscribers with:
 *   { sessionKey, agentId?, phase: 'start' | 'end' | 'error', runId, ts, snapshot… }
 *
 * We treat `phase === 'start'` as busy and every other phase as idle.
 * `syncAgentActivityMonitor()` is called from a heartbeat timer in main;
 * it is idempotent and survives gateway restarts.
 */

import { BrowserWindow } from 'electron'
import { createGatewayRpcClientFromConfig, GatewayRpcClient } from '../gateway/rpc-client.js'
import { IPC_AGENTS_ACTIVITY } from '../../shared/ipc-channels.js'

let client: GatewayRpcClient | null = null
let subscribed = false
let lastError: string | null = null

function broadcast(payload: { agentId: string; busy: boolean }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_AGENTS_ACTIVITY, payload)
    }
  }
}

/** `agent:main:main` → `main`, anything else → null. */
function agentIdFromSessionKey(sessionKey: string | undefined): string | null {
  if (!sessionKey) return null
  const m = /^agent:([^:]+)/.exec(sessionKey)
  return m ? m[1] : null
}

function handleEvent(event: string, payload: unknown): void {
  if (event !== 'sessions.changed') return
  const p = payload as { agentId?: unknown; sessionKey?: unknown; phase?: unknown } | null
  if (!p || typeof p !== 'object') return
  const agentId =
    typeof p.agentId === 'string' && p.agentId
      ? p.agentId
      : agentIdFromSessionKey(typeof p.sessionKey === 'string' ? p.sessionKey : undefined)
  if (!agentId) return
  broadcast({ agentId, busy: p.phase === 'start' })
}

async function ensureSubscribed(): Promise<void> {
  if (client && subscribed) return
  if (!client) {
    client = await createGatewayRpcClientFromConfig({ onEvent: handleEvent })
  }
  await client.connect()
  if (!subscribed) {
    const res = await client.request<{ subscribed?: boolean }>('sessions.subscribe', {})
    subscribed = Boolean(res?.subscribed)
  }
}

/**
 * Idempotent heartbeat. While the gateway is up, ensure a connected,
 * subscribed RPC client exists; when it is down, drop the client so the
 * next heartbeat can reconnect cleanly after a gateway restart.
 */
export async function syncAgentActivityMonitor(gatewayRunning: boolean): Promise<void> {
  try {
    if (gatewayRunning) {
      await ensureSubscribed()
      lastError = null
    } else {
      if (client) {
        try {
          client.close()
        } catch {
          /* ignore */
        }
      }
      client = null
      subscribed = false
    }
  } catch (err) {
    // Gateway can be mid-restart or auth can briefly fail; drop the client
    // and let the next heartbeat retry.
    lastError = err instanceof Error ? err.message : String(err)
    if (client) {
      try {
        client.close()
      } catch {
        /* ignore */
      }
    }
    client = null
    subscribed = false
  }
}

/** Diagnostics only. */
export function getAgentActivityMonitorState(): {
  connected: boolean
  subscribed: boolean
  lastError: string | null
} {
  return { connected: Boolean(client), subscribed, lastError }
}
