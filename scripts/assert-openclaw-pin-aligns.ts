/**
 * Release/CI: after download-openclaw, ensure npm bundle matches desktop pin so Linux Control UI (same pin) cannot pair with wrong gateway dist.
 * Usage: pnpm exec tsx scripts/assert-openclaw-pin-aligns.ts
 */

import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()

function norm(v: string): string {
  return v.trim().replace(/^v/i, '')
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const envPin = process.env.OPENCLAW_DESKTOP_BUNDLE_VERSION?.trim()
  const rawRoot = await readFile(join(root, 'package.json'), 'utf8')
  const rootPkg = JSON.parse(rawRoot) as {
    openclawBundleVersion?: string
  }
  const pkgPin = rootPkg.openclawBundleVersion?.trim()
  const expected = norm(envPin || pkgPin || '')
  if (!expected) {
    throw new Error(
      'Set package.json openclawBundleVersion (or OPENCLAW_DESKTOP_BUNDLE_VERSION) before merging Control UI.',
    )
  }
  if (envPin && pkgPin && norm(envPin) !== norm(pkgPin)) {
    throw new Error(
      `OPENCLAW_DESKTOP_BUNDLE_VERSION (${envPin}) disagrees with package.json openclawBundleVersion (${pkgPin}).`,
    )
  }

  const openclawDir = join(root, 'build', 'openclaw')
  const markerPath = join(openclawDir, '.openclaw-version')
  const openclawPkgPath = join(openclawDir, 'package.json')
  if (!(await exists(markerPath)) || !(await exists(openclawPkgPath))) {
    throw new Error('build/openclaw missing — run download-openclaw first.')
  }

  const marker = norm((await readFile(markerPath, 'utf8')).trim())
  const owPkg = JSON.parse(await readFile(openclawPkgPath, 'utf8')) as { version?: string }
  const npmVer = norm(owPkg.version ?? '')

  if (marker !== expected) {
    throw new Error(
      `OpenClaw .openclaw-version (${marker}) !== expected pin (${expected}). npm resolution may have drifted.`,
    )
  }
  if (npmVer !== expected) {
    throw new Error(
      `OpenClaw package.json version (${npmVer}) !== expected pin (${expected}).`,
    )
  }

  const entryJs = join(openclawDir, 'dist', 'entry.js')
  const entryMjs = join(openclawDir, 'dist', 'entry.mjs')
  if (!(await exists(entryJs)) && !(await exists(entryMjs))) {
    throw new Error('build/openclaw/dist/entry.(m)js missing — cannot merge Control UI.')
  }

  console.log(`  [ok] OpenClaw bundle aligns with pin ${expected}`)
}

main().catch((err) => {
  console.error(`\n  FAIL: assert-openclaw-pin-aligns: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
