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
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const PATCHED_MARKER = '/* openclaw-pc: silent-reply section suppressed for local models */'
const TARGET_SUBSTR = 'silentReplyPromptMode !== "none") lines.push("## Silent Replies"'
const REPLACEMENT =
  'silentReplyPromptMode !== "none" && !((params.model) || "").startsWith("local/")) lines.push("## Silent Replies"'

export async function patchOpenClawSilentReplyLocal(openclawRoot: string): Promise<void> {
  const dist = join(openclawRoot, 'dist')
  let names: string[]
  try {
    names = await readdir(dist)
  } catch {
    return
  }

  const candidatePaths = names
    .filter((n) => /^system-prompt-config-.*\.js$/.test(n))
    .map((n) => join(dist, n))

  if (candidatePaths.length === 0) {
    console.warn('  [patch-silent-reply] system-prompt-config-*.js not found — layout may have changed')
    return
  }

  for (const filePath of candidatePaths) {
    const raw = await readFile(filePath, 'utf8')
    if (raw.includes(PATCHED_MARKER)) continue

    if (!raw.includes(TARGET_SUBSTR)) {
      console.warn(
        `  [patch-silent-reply] ${basename(filePath)}: target not found — layout may have changed`,
      )
      continue
    }

    const patched = `// ${PATCHED_MARKER}\n` + raw.replace(TARGET_SUBSTR, REPLACEMENT)
    await writeFile(filePath, patched, 'utf8')
    console.log(`  [patch-silent-reply] ${basename(filePath)}: NO_REPLY section suppressed for local/* models`)
  }
}
