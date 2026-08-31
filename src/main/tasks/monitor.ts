/**
 * Tasks monitor (v0.9.22).
 *
 * Finalizes shell-local tasks when the gateway reports the agent's final
 * assistant message for the task session (`session.message`, role=assistant,
 * `hasActiveRun !== true`). Called from the agent activity monitor
 * (src/main/agents/activity.ts), which owns the long-lived RPC subscription.
 *
 * Heuristic: a final answer that ends with «?» or asks for confirmation
 * (подтверди/одобри/ждёт вашего решения/…) moves the task to `waiting`
 * («Ждут вас») — the user must approve/continue it. Otherwise → `succeeded`.
 */

import { findAwaitingTaskForSession, updateLocalTask } from './store.js'

/** Last assistant text block (joined), without trailing whitespace. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  // Ends with a question mark (incl. CJK/emoji-friendly variants).
  if (/[?？]\s*[.。…]?\s*$/.test(t)) return true
  // Explicit approval/decision markers.
  return /подтверд|одобр|разреш|жд[еу]т\s+ваш|жду\s+ваш|нужн[оа]\s+(тво|ваш)|ожидаю\s+(от\s+вас|ваш)|соглас(уй|ование|уете)|продолж(ить|ать)\?|показать\s+результат|делать\?|ок\?|да\?/i.test(t)
}

/**
 * Called for every final assistant message on any session. Tasks are only
 * finalized for the dedicated task session (`agent:<id>:tasks`), so normal
 * chat conversations never touch the registry.
 */
export function notifyFinalAssistantMessage(sessionKey: string, text: string): void {
  if (!sessionKey || !/^agent:[^:]+:tasks$/.test(sessionKey)) return
  const task = findAwaitingTaskForSession(sessionKey)
  if (!task) return
  const isQuestion = looksLikeQuestion(text)
  updateLocalTask(task.id, {
    status: isQuestion ? 'waiting' : 'succeeded',
    answer: isQuestion ? undefined : text,
    question: isQuestion ? text : undefined,
    endedAt: Date.now(),
    runId: task.runId, // keep for history
  })
}
