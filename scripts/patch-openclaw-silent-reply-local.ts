/**
 * OpenClaw adds a "## Silent Replies" section to the system prompt instructing the
 * model to answer with ONLY "NO_REPLY" when it has nothing to say.
 *
 * Small local GGUF models (qwen etc.) follow the instruction literally and append
 * "NO_REPLY" to the end of normal replies ("Here's the file... NO_REPLY"), which
 * leaks into chat as visible noise. Cloud models (DeepSeek/OpenAI) handle it fine,
 * so we keep the section for them and suppress it only for the local provider
 * (models whose model id starts with "local/", e.g. "local/qwen2.5-0.5b-instruct-q8_0").
 *
 * The runtime silent-reply *mechanism* (exact "NO_REPLY" reply → message not sent)
 * stays intact; we only stop teaching local models the token.
 *
 * Idempotent: safe to run after every download-openclaw / prepare-bundle.
 *
 * Layouts (auto-detected):
 * - <=2026.7: `system-prompt-config-*.js`, push is
 *   `if (silentReplyPromptMode !== "none") lines.push("## Silent Replies" ...)`
 *   and the model id is read from `(params.model || "")`.
 * - 2026.8+ (2.0): `system-prompt-params-*.js`, the push gained an `!isMinimal &&`
 *   gate and lives inside `buildAgentSystemPrompt(params)` where the current model
 *   id is only reachable via `runtimeInfo?.model` (params.model is undefined there).
 *
 * Targets are anchored so each variant matches only its own layout (the V2 line
 * contains the legacy substring `silentReplyPromptMode !== "none") lines.push(...)`,
 * so V2 must be checked first with its `!isMinimal &&` prefix; the legacy target is
 * anchored with `if (` + `silentReplyPromptMode` which the V2 line cannot contain).
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const PATCHED_MARKER = '/* openclaw-pc: silent-reply section suppressed for local models */'

/** <=2026.7 builder (system-prompt-config-*.js): guard reads params.model directly. */
const LEGACY_TARGET = 'if (silentReplyPromptMode !== "none") lines.push("## Silent Replies"'
const LEGACY_REPLACEMENT =
  'if (silentReplyPromptMode !== "none" && !((params.model) || "").startsWith("local/")) lines.push("## Silent Replies"'

/** 2026.8+ (2.0): push gained `!isMinimal &&`; model id reachable via runtimeInfo?.model. */
const V2_TARGET =
  'if (!isMinimal && silentReplyPromptMode !== "none") lines.push("## Silent Replies"'
const V2_REPLACEMENT =
  'if (!isMinimal && silentReplyPromptMode !== "none" && !((runtimeInfo?.model) || "").startsWith("local/")) lines.push("## Silent Replies"'

async function tryPatchFile(filePath: string, label: string): Promise<void> {
  let raw = await readFile(filePath, 'utf8')
  if (raw.includes(PATCHED_MARKER)) return

  let patched = false
  let variant = ''
  if (raw.includes(V2_TARGET)) {
    raw = raw.replace(V2_TARGET, V2_REPLACEMENT)
    variant = '2.0 (runtimeInfo?.model)'
    patched = true
  } else if (raw.includes(LEGACY_TARGET)) {
    raw = raw.replace(LEGACY_TARGET, LEGACY_REPLACEMENT)
    variant = 'legacy (params.model)'
    patched = true
  }

  if (!patched) {
    console.warn(
      `  [patch-silent-reply] ${basename(filePath)}: no target found — layout may have changed`,
    )
    return
  }

  await writeFile(filePath, `// ${PATCHED_MARKER}\n` + raw, 'utf8')
  console.log(
    `  [patch-silent-reply] ${label}: NO_REPLY section suppressed for local/* models (${variant})`,
  )
}

export async function patchOpenClawSilentReplyLocal(openclawRoot: string): Promise<void> {
  const dist = join(openclawRoot, 'dist')
  let names: string[]
  try {
    names = await readdir(dist)
  } catch {
    return
  }

  const candidatePaths = names
    .filter((n) => /^system-prompt-(config|params)-.*\.js$/.test(n))
    .map((n) => join(dist, n))

  if (candidatePaths.length === 0) {
    console.warn(
      '  [patch-silent-reply] system-prompt-{config,params}-*.js not found — layout may have changed',
    )
    return
  }

  for (const filePath of candidatePaths) {
    await tryPatchFile(filePath, basename(filePath))
  }
}
