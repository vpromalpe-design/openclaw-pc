/**
 * Local task registry (v0.9.22).
 *
 * The gateway 2026.7.1 has no external "create task" RPC — `tasks.list` only
 * reads task records created *inside* agent runs (flow/subagent tools). A
 * `chat.send` from the shell therefore never shows up in the task ledger.
 *
 * This module is the shell-side registry for tasks the user dispatches from
 * the «Задачи» board. Each entry tracks the task text, the target agent, the
 * chat session it was sent to (`agent:<id>:tasks`) and its lifecycle:
 *
 *   running   → chat.send delivered, waiting for the agent's final answer
 *   waiting   → agent answered with a question → «Ждут вас» (approval needed)
 *   succeeded → agent answered, no question
 *   failed    → chat.send rejected / agent error
 *   scheduled → cron job created (cron.add), runs at a later time
 *   cancelled → user aborted
 *
 * Status transitions are driven by:
 *   - IPC handlers (dispatch / resume / cancel / setStatus)
 *   - the tasks monitor (final assistant message → succeeded|waiting)
 *
 * File: %APPDATA%\OpenClaw PC\tasks.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { APP_NAME, TASKS_STORE_FILE } from '../../shared/constants.js'
import { IPC_TASKS_LOCAL_CHANGED } from '../../shared/ipc-channels.js'
import { logWarn } from '../utils/logger.js'

export type LocalTaskStatus = 'running' | 'waiting' | 'succeeded' | 'failed' | 'scheduled' | 'cancelled'

export interface LocalTask {
  /** Shell-local task id (`lt-<ts>-<rand>`) */
  id: string
  /** Task text the user typed */
  text: string
  /** Target agent id */
  agentId: string
  status: LocalTaskStatus
  /** Chat session the task was sent to: `agent:<agentId>:tasks` */
  sessionKey: string
  /** runId returned by chat.send (present while running/awaiting) */
  runId?: string
  /** cron job id when the task is scheduled via cron.add */
  cronJobId?: string
  /** Frequency label from the dispatch footer ('once'|'hourly'|'daily'|'weekly'|'monthly') */
  freq?: string
  /** Epoch ms when a scheduled task should run */
  scheduledAt?: number
  /** Agent's final answer (terminal output) */
  answer?: string
  /** When waiting — the question the agent is asking the user */
  question?: string
  error?: string
  createdAt: number
  startedAt?: number
  endedAt?: number
  updatedAt: number
}

const MAX_TASKS = 200

let cache: LocalTask[] | null = null
let storePath: string | null = null

function getStorePath(): string {
  if (storePath) return storePath
  storePath = path.join(app.getPath('appData'), APP_NAME, TASKS_STORE_FILE)
  return storePath
}

function load(): LocalTask[] {
  if (cache) return cache
  const file = getStorePath()
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        cache = parsed
          .filter((t): t is LocalTask => t && typeof t === 'object' && typeof (t as LocalTask).id === 'string')
          .slice(0, MAX_TASKS)
        return cache
      }
    }
  } catch (err) {
    logWarn(`[tasks-store] read failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  cache = []
  return cache
}

function persist(): void {
  const file = getStorePath()
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(cache ?? [], null, 2), 'utf-8')
  } catch (err) {
    logWarn(`[tasks-store] write failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function broadcastChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_TASKS_LOCAL_CHANGED)
    }
  }
}

export function listLocalTasks(): LocalTask[] {
  return [...load()].sort((a, b) => b.createdAt - a.createdAt)
}

export function getLocalTask(id: string): LocalTask | undefined {
  return load().find((t) => t.id === id)
}

export function addLocalTask(input: Omit<LocalTask, 'id' | 'createdAt' | 'updatedAt'>): LocalTask {
  const task: LocalTask = {
    ...input,
    id: `lt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  const list = load()
  list.unshift(task)
  if (list.length > MAX_TASKS) list.length = MAX_TASKS
  persist()
  broadcastChanged()
  return task
}

export function updateLocalTask(
  id: string,
  patch: Partial<Pick<LocalTask, 'status' | 'runId' | 'cronJobId' | 'freq' | 'scheduledAt' | 'answer' | 'question' | 'error' | 'startedAt' | 'endedAt' | 'updatedAt'>>,
): LocalTask | null {
  const list = load()
  const task = list.find((t) => t.id === id)
  if (!task) return null
  Object.assign(task, patch, { updatedAt: Date.now() })
  persist()
  broadcastChanged()
  return task
}

export function removeLocalTask(id: string): boolean {
  const list = load()
  const idx = list.findIndex((t) => t.id === id)
  if (idx === -1) return false
  list.splice(idx, 1)
  persist()
  broadcastChanged()
  return true
}

export function removeLocalTaskByCronJobId(cronJobId: string): boolean {
  const list = load()
  const idx = list.findIndex((t) => t.cronJobId === cronJobId)
  if (idx === -1) return false
  list.splice(idx, 1)
  persist()
  broadcastChanged()
  return true
}

/** Running task awaiting its final assistant answer for a session (FIFO by creation).
 *  `waiting` tasks are excluded on purpose: their run already finished and they
 *  are blocked on the user — a stray final message must not clobber their question. */
export function findAwaitingTaskForSession(sessionKey: string): LocalTask | null {
  const candidates = load()
    .filter((t) => t.sessionKey === sessionKey && t.status === 'running')
    .sort((a, b) => a.createdAt - b.createdAt)
  return candidates[0] ?? null
}

export function localTasksCounts(): { waiting: number; running: number; failed: number; scheduled: number; done: number } {
  const counts = { waiting: 0, running: 0, failed: 0, scheduled: 0, done: 0 }
  for (const t of load()) {
    if (t.status === 'waiting') counts.waiting += 1
    else if (t.status === 'running') counts.running += 1
    else if (t.status === 'failed') counts.failed += 1
    else if (t.status === 'scheduled') counts.scheduled += 1
    else counts.done += 1
  }
  return counts
}
