/**
 * OpenClaw Feishu/Lark gateway extension loads `@larksuiteoapi/node-sdk`, which is not pulled in by the
 * published `openclaw` npm tarball. Install it into the bundled tree so desktop builds load the plugin.
 */

import { execSync } from 'node:child_process'
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PROJECT_ROOT = process.cwd()
/** Pinned via root package.json `openclawFeishuLarkSdkVersion` for reproducible installs. */
const DEFAULT_FEISHU_SDK_RANGE = '^1.60.0'

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function readFeishuSdkVersionSpec(): Promise<string> {
  try {
    const raw = await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { openclawFeishuLarkSdkVersion?: string }
    const v = pkg.openclawFeishuLarkSdkVersion?.trim()
    if (v) return v
  } catch {
    /* ignore */
  }
  return DEFAULT_FEISHU_SDK_RANGE
}

const SDK_MARKER_SEGMENTS = ['node_modules', '@larksuiteoapi', 'node-sdk', 'package.json'] as const

export function getOpenClawFeishuSdkPackageJsonPath(openclawRoot: string): string {
  return join(openclawRoot, ...SDK_MARKER_SEGMENTS)
}

export async function ensureOpenClawFeishuLarkSdk(openclawRoot: string): Promise<void> {
  const marker = getOpenClawFeishuSdkPackageJsonPath(openclawRoot)
  if (await fileExists(marker)) {
    console.log('  [feishu-sdk] @larksuiteoapi/node-sdk already present in bundled OpenClaw')
    return
  }

  const spec = await readFeishuSdkVersionSpec()
  const pkgArg = `@larksuiteoapi/node-sdk@${spec}`
  console.log(`  [feishu-sdk] npm install ${pkgArg} (cwd=${openclawRoot})...`)

  // The restored root manifest (OpenClaw 2026.7.1+) contains pnpm `workspace:*` refs that npm
  // cannot resolve; swap in a manifest that mirrors the real root dependencies (with
  // workspace refs rewritten to the vendored packages) so `npm install` re-prunes nothing.
  const manifestPath = join(openclawRoot, 'package.json')
  const hadManifest = await fileExists(manifestPath)
  const savedManifest = hadManifest ? await readFile(manifestPath, 'utf8') : null
  if (hadManifest) {
    const real = JSON.parse(savedManifest as string) as {
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    const stubDeps: Record<string, string> = {}
    for (const [dep, ver] of Object.entries(real.dependencies ?? {})) {
      stubDeps[dep] =
        typeof ver === 'string' && ver.startsWith('workspace:')
          ? `file:../packages/${dep.replace(/^@[^/]+\//, '')}`
          : ver
    }
    const stub: Record<string, unknown> = {
      name: 'openclaw-desktop-feishu-install',
      private: true,
      version: '0.0.0',
      dependencies: stubDeps,
    }
    if (real.optionalDependencies && Object.keys(real.optionalDependencies).length > 0) {
      stub.optionalDependencies = real.optionalDependencies
    }
    await writeFile(manifestPath, `${JSON.stringify(stub, null, 2)}\n`, 'utf8')
  }

  // Use execSync (shell on Windows) so `npm` resolves to npm.cmd; execFileSync('npm') → ENOENT.
  try {
    execSync(`npm install ${pkgArg} --no-save --no-audit --no-fund`, {
      cwd: openclawRoot,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: '' },
    })
  } finally {
    if (savedManifest !== null) {
      await writeFile(manifestPath, savedManifest, 'utf8')
    }
  }

  if (!(await fileExists(marker))) {
    throw new Error(`[feishu-sdk] install failed — missing ${marker}`)
  }
  console.log('  [feishu-sdk] OK')
}
