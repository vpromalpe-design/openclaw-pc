/**
 * OpenClaw Feishu channel: `registerFull` re-runs on every inbound dispatch when
 * `api.registrationMode === "full"`, re-registering tools and spamming logs.
 * Guard once per process via globalThis (gateway child is one Node process).
 *
 * Upstream layouts:
 * - Older: dedicated `dist/feishu-*.js` chunks.
 * - Mid: Feishu inside hashed `dist/auth-profiles-*.js` bundles.
 * - Newer (e.g. 2026.3.31+): bundled channel at `dist/extensions/feishu/index.js`.
 *
 * Idempotent: safe to run after every download-openclaw / prepare-bundle.
 */
import { access, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

const GUARD_FLAG = '__openclawDesktopFeishuFullRegistered'

/** Matches `registerFull(api) { … registerFeishuSubagentHooks(api); … }` entry (first statement after `{`). */
const REGISTER_FULL_FEISHU_RE =
  /(registerFull\(api\)\s*\{)(\s*)(registerFeishuSubagentHooks\(api\);)/

async function tryPatchFeishuRegisterFullFile(
  filePath: string,
  label: string,
): Promise<boolean> {
  let raw = await readFile(filePath, 'utf8')
  if (raw.includes(GUARD_FLAG)) return false
  if (!raw.includes('registerFeishuSubagentHooks')) return false
  if (!REGISTER_FULL_FEISHU_RE.test(raw)) return false
  raw = raw.replace(REGISTER_FULL_FEISHU_RE, (_m, p1: string, p2: string, p3: string) => {
    return `${p1}${p2}if(globalThis.${GUARD_FLAG})return;globalThis.${GUARD_FLAG}=!0;${p3}`
  })
  await writeFile(filePath, raw, 'utf8')
  console.log(`  [patch-feishu] ${label}: registerFull guarded (once per process)`)
  return true
}

export async function patchOpenClawFeishuRegisterOnce(openclawRoot: string): Promise<void> {
  const dist = join(openclawRoot, 'dist')
  let names: string[]
  try {
    names = await readdir(dist)
  } catch {
    return
  }

  const candidatePaths = names
    .filter((n) => /^feishu-.*\.js$/.test(n) || /^auth-profiles-.*\.js$/.test(n))
    .map((n) => join(dist, n))

  const feishuExtIndex = join(dist, 'extensions', 'feishu', 'index.js')
  if (await fileExists(feishuExtIndex)) {
    candidatePaths.push(feishuExtIndex)
  }

  let patched = false
  for (const filePath of candidatePaths) {
    const label =
      filePath === feishuExtIndex ? 'extensions/feishu/index.js' : basename(filePath)
    const ok = await tryPatchFeishuRegisterFullFile(filePath, label)
    if (ok) patched = true
  }

  if (!patched && candidatePaths.length > 0) {
    let hasGuard = false
    let patternStillUnpatched = false
    for (const filePath of candidatePaths) {
      const raw = await readFile(filePath, 'utf8')
      if (raw.includes(GUARD_FLAG)) hasGuard = true
      if (
        raw.includes('registerFeishuSubagentHooks') &&
        REGISTER_FULL_FEISHU_RE.test(raw)
      ) {
        patternStillUnpatched = true
      }
    }
    if (patternStillUnpatched) {
      console.warn(
        '  [patch-feishu] registerFull+registerFeishuSubagentHooks pattern still present but patch did not apply',
      )
    } else if (!hasGuard) {
      console.warn(
        '  [patch-feishu] Feishu chunks present but registerFull+registerFeishuSubagentHooks pattern not found — upstream layout may have changed',
      )
    }
  }
}
