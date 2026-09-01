/**
 * Tasks monitor (v0.9.22 → v0.9.30 fix).
 *
 * Finalizes shell-local tasks when the gateway reports assistant messages for
 * the task session (`agent:<id>:tasks`). Called from the agent activity
 * monitor (src/main/agents/activity.ts), which owns the long-lived RPC
 * subscription.
 *
 * v0.9.30 (bugfix): the gateway emits a `session.message` for EVERY assistant
 * transcript update — including the model's first "reasoning" block, which
 * often contains no answer at all («I need to handle BOOTSTRAP.md first…»).
 * Naively finalizing on the first message stored the reasoning as the task
 * answer, so «Созданные файлы» and answer links never appeared.
 *
 * Fix:
 *  1. Debounce — finalize only after ~4s of silence following the LAST
 *     assistant message of the run (any session activity resets the timer).
 *  2. Same-wave overwrite — if a late final message arrives after the
 *     debounce already finalized the task (long tool pauses), overwrite the
 *     answer while the task still belongs to the same «wave» (no user message
 *     started a new task in between). `waiting` tasks are never clobbered.
 *
 * Heuristic (kept from v0.9.22): a final answer that ends with «?» or asks
 * for confirmation moves the task to `waiting` («Ждут вас»); otherwise →
 * `succeeded`.
 */

import { findAwaitingTaskForSession, getLocalTask, updateLocalTask } from './store.js'

const FINALIZE_DEBOUNCE_MS = 4000

interface SessionState {
  /** Bumped on every user message — a new task wave starts. */
  wave: number
  /** Task id finalized in the current wave (for late-message overwrite). */
  taskId: string | null
  /** Last assistant text seen in the current wave. */
  lastText: string
  timer: NodeJS.Timeout | null
}

const states = new Map<string, SessionState>()

function stateFor(sessionKey: string): SessionState {
  let s = states.get(sessionKey)
  if (!s) {
    s = { wave: 0, taskId: null, lastText: '', timer: null }
    states.set(sessionKey, s)
  }
  return s
}

/** Last assistant text block (joined), without trailing whitespace. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  // Ends with a question mark (incl. CJK/emoji-friendly variants).
  if (/[?？]\s*[.。…]?\s*$/.test(t)) return true
  // Explicit approval/decision markers.
  return /подтверд|одобр|разреш|жд[еу]т\s+ваш|жду\s+ваш|нужн[оа]\s+(тво|ваш)|ожидаю\s+(от\s+вас|ваш)|соглас(уй|ование|уете)|продолж(ить|ать)\?|показать\s+результат|делать\?|ок\?|да\?/i.test(t)
}

function finalize(sessionKey: string, text: string): void {
  if (!text.trim()) return
  const s = stateFor(sessionKey)
  // Prefer a task that is still running (awaiting its answer).
  const running = findAwaitingTaskForSession(sessionKey)
  let task = running
  if (!task && s.taskId) {
    // Same-wave overwrite: a late final message for a task we already
    // finalized (long tool pauses between reasoning and the real answer).
    const prev = getLocalTask(s.taskId)
    if (prev && prev.status === 'succeeded') task = prev
  }
  if (!task) return
  s.taskId = task.id
  const isQuestion = looksLikeQuestion(text)
  updateLocalTask(task.id, {
    status: isQuestion ? 'waiting' : 'succeeded',
    answer: isQuestion ? undefined : text,
    question: isQuestion ? text : undefined,
    endedAt: Date.now(),
    runId: task.runId, // keep for history
  })
}

/**
 * Called for every `session.message` on the task session (all roles).
 * - user     → a new task wave begins; clear pending state.
 * - assistant→ remember the text, reset the debounce timer.
 * - any other role (toolResult, …) → activity: push the finalize back.
 */
export function notifyTaskSessionActivity(sessionKey: string, role: string | null, text?: string): void {
  if (!sessionKey || !/^agent:[^:]+:tasks$/.test(sessionKey)) return
  const s = stateFor(sessionKey)
  if (s.timer) {
    clearTimeout(s.timer)
    s.timer = null
  }
  if (role === 'user') {
    s.wave += 1
    s.taskId = null
    s.lastText = ''
    return
  }
  if (role !== 'assistant') return // toolResult / deltas: just reset the timer
  if (!text || !text.trim()) return
  s.lastText = text
  s.timer = setTimeout(() => {
    s.timer = null
    finalize(sessionKey, s.lastText)
  }, FINALIZE_DEBOUNCE_MS)
}
