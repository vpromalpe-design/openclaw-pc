/**
 * Remove generated content under build/ (Node bundle, OpenClaw extract, CI temp trees).
 * Keeps tracked `build/installer.nsh` (see .gitignore).
 * Windows: uses long-path rmdir for deep node_modules.
 * Usage: pnpm run clean-build
 */

import { existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const PROJECT_ROOT = process.cwd()
const BUILD_DIR = join(PROJECT_ROOT, 'build')
/** Only these names at build/ root are preserved */
const KEEP_NAMES = new Set(['installer.nsh'])

function rmLongPath(dir: string): void {
  if (!existsSync(dir)) return
  const winPath = dir.replace(/\//g, '\\')
  const longPath = winPath.startsWith('\\\\?\\') ? winPath : `\\\\?\\${winPath}`
  try {
    execSync(`cmd /c rmdir /s /q "${longPath}"`, { stdio: 'pipe' })
  } catch {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
    } catch (err) {
      console.warn(`  [warn] could not remove ${dir}: ${(err as Error).message}`)
    }
  }
}

function main(): void {
  console.log('\nclean-build: removing build/* except installer.nsh\n')
  if (!existsSync(BUILD_DIR)) {
    console.log('  [skip] build/ does not exist\n')
    return
  }

  let removed = 0
  for (const name of readdirSync(BUILD_DIR)) {
    if (KEEP_NAMES.has(name)) continue
    const p = join(BUILD_DIR, name)
    try {
      if (statSync(p).isDirectory()) {
        rmLongPath(p)
      } else {
        rmSync(p, { force: true })
      }
      removed++
      console.log(`  [ok] removed ${name}`)
    } catch (err) {
      console.warn(`  [warn] ${name}: ${(err as Error).message}`)
    }
  }

  if (removed === 0) {
    console.log('  [ok] nothing to remove (only kept files present)\n')
  } else {
    console.log(`\n  OK: clean-build removed ${removed} item(s); re-run download-node + download-openclaw before packaging.\n`)
  }
}

main()
