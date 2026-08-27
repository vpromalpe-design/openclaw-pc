/**
 * Agent activity monitor (v0.9.12, Этап E3 — «лампочка активности как HDD»;
 * v0.9.13, Этап F — озвучка финальных ответов агента через `session.message`).
 *
 * A long-lived gateway RPC client that subscribes to gateway events and:
 *   1. broadcasts per-agent busy/idle state to the renderer
 *      (from `sessions.changed`, `phase === 'start'` → busy);
 *   2. speaks final assistant answers when TTS is enabled
 *      (from `session.message`, skipping streaming deltas).
 *
 * IMPORTANT (2026-08-26): the gateway does NOT deliver a `chat` event to
 * `sessions.subscribe` subscribers — that event only exists on the internal
 * node channel (`context.broadcast('chat', …)` inside chat.send). RPC
 * subscribers receive `session.message` and `sessions.changed` only. The
 * `session.message` payload is:
 *   { sessionKey, agentId?, message, messageId?, messageSeq?, sessionSnapshot }
 * where `message` is a projected chat message `{ role, content, id?, seq? }`
 * (no `state` field) and `sessionSnapshot.hasActiveRun` is `true` while the
 * run is streaming. We treat `hasActiveRun !== true` as the final state.
 *
 * `syncAgentActivityMonitor()` is called from a heartbeat timer in main;
 * it is idempotent and survives gateway restarts.
 */

import { BrowserWindow } from 'electron'
import { createGatewayRpcClientFromConfig, GatewayRpcClient } from '../gateway/rpc-client.js'
import { IPC_AGENTS_ACTIVITY } from '../../shared/ipc-channels.js'
import { logInfo, logWarn } from '../utils/logger.js'
import { speakAgentAnswer } from '../voice/voice.js'

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

/** Recent spoken message ids, to avoid double-speaking a repeated broadcast. */
const spokenMessageIds = new Set<string>()
const MAX_SPOKEN_IDS = 32

/** Join all text blocks of a projected chat message content. */
function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string' && text.trim()) parts.push(text.trim())
    }
  }
  return parts.join('\n')
}

function handleEvent(event: string, payload: unknown): void {
  // v0.9.13 (Этап F): speak the final assistant answer when TTS is enabled.
  // The gateway emits `session.message` for every transcript update (user and
  // assistant, streaming deltas included); `hasActiveRun === true` marks
  // in-flight streaming, so we only speak the final projected message.
  if (event === 'session.message') {
    const p = payload as
      | {
          message?: { role?: unknown; content?: unknown }
          messageId?: unknown
          sessionSnapshot?: { hasActiveRun?: boolean } | null
        }
      | null
    if (!p || typeof p !== 'object') return
    const snapshot = p.sessionSnapshot
    if (snapshot && snapshot.hasActiveRun === true) return
    const msg = p.message
    if (!msg || typeof msg !== 'object' || msg.role !== 'assistant') return
    const messageId = typeof p.messageId === 'string' ? p.messageId : null
    if (messageId) {
      if (spokenMessageIds.has(messageId)) return
      spokenMessageIds.add(messageId)
      if (spokenMessageIds.size > MAX_SPOKEN_IDS) {
        const first = spokenMessageIds.values().next().value
        if (typeof first === 'string') spokenMessageIds.delete(first)
      }
    }
    const text = extractAssistantText(msg.content)
    if (text) speakAgentAnswer(text)
    return
  }
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
  // Recreate a dead client: the gateway can drop our WebSocket (restart, or
  // another client with the same id connected) while `subscribed` still says
  // true. Without this check the monitor would silently stop receiving events.
  if (client && !client.isConnected) {
    try {
      client.close()
    } catch {
      /* ignore */
    }
    client = null
    subscribed = false
  }
  if (client && subscribed) return
  if (!client) {
    client = await createGatewayRpcClientFromConfig({ onEvent: handleEvent })
  }
  await client.connect()
  if (!subscribed) {
    const res = await client.request<{ subscribed?: boolean }>('sessions.subscribe', {})
    subscribed = Boolean(res?.subscribed)
    if (subscribed) logInfo('[activity] gateway sessions.subscribe OK')
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
    logWarn(`[activity] sync failed: ${lastError}`)
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
