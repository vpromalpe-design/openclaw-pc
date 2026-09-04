/**
 * Visible text helpers (v0.9.38).
 *
 * The gateway core (2026.7.1) instructs models to answer strictly inside
 * `<think>…</think><final>…</final>` tags. Transcripts store that raw text,
 * and only the content of `<final>` is meant to be shown to the user.
 * Our task registry used to persist the raw assistant text, so `<final>`
 * tags leaked into task answers and roy reports. These helpers strip the
 * model envelope so only the visible answer remains.
 */

const THINK_BLOCK_RE = /<think\b[^>]*>[\s\S]*?<\/think>/gi
const FINAL_BLOCK_RE = /<final\b[^>]*>([\s\S]*?)<\/final>/gi
const LONE_TAG_RE = /<\/?(?:final|think)\b[^>]*>/gi

/**
 * Extract the user-visible part of a raw assistant reply:
 *  1. drop `<think>` blocks entirely;
 *  2. if full `<final>…</final>` blocks exist, their (joined) content is the
 *     visible answer — any unwrapped text is discarded, matching core rules;
 *  3. otherwise just remove stray lone `<final>`/`<think>` tags (stream
 *     interruptions) and trim.
 */
export function visibleAssistantText(text: string | null | undefined): string {
  if (!text) return ''
  let t = text.replace(THINK_BLOCK_RE, '')
  const finals: string[] = []
  t = t.replace(FINAL_BLOCK_RE, (_m: string, inner: string) => {
    finals.push(inner)
    return ''
  })
  if (finals.length > 0) {
    return finals.join('\n').trim()
  }
  return t.replace(LONE_TAG_RE, '').trim()
}

/** True when the run died before the model produced a real answer. */
export function isRunFailureText(text: string): boolean {
  if (!text) return false
  return /the agent run failed|run failed before producing|failed to produce a reply/i.test(text)
}
