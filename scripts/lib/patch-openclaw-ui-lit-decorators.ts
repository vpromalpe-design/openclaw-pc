/**
 * OpenClaw Control UI uses Lit @property / @state on class fields. Vite's default TS/esbuild
 * settings emit "standard" decorator runtime that throws Unsupported decorator location: field
 * in Electron's embedded Chromium. Lit docs: experimentalDecorators + useDefineForClassFields: false.
 * @see https://lit.dev/docs/components/decorators/#typescript-decorators
 */
import { readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'

const VITE_PATCH_SENTINEL = 'openclaw-pc-lit-decorators'

const DEFAULT_UI_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    moduleResolution: 'bundler',
    experimentalDecorators: true,
    useDefineForClassFields: false,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    isolatedModules: true,
    resolveJsonModule: true,
  },
  include: ['src/**/*.ts'],
} as const

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function mergeUiTsconfig(uiDir: string): Promise<void> {
  const p = join(uiDir, 'tsconfig.json')
  let merged: Record<string, unknown>
  if (await fileExists(p)) {
    const raw = await readFile(p, 'utf8')
    merged = JSON.parse(raw) as Record<string, unknown>
    const co = (merged.compilerOptions as Record<string, unknown> | undefined) ?? {}
    merged.compilerOptions = {
      ...co,
      experimentalDecorators: true,
      useDefineForClassFields: false,
    }
  } else {
    merged = { ...DEFAULT_UI_TSCONFIG } as unknown as Record<string, unknown>
  }
  await writeFile(p, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}

/**
 * Inject root-level `esbuild.tsconfigRaw` into ui/vite.config.ts (first `return {` in file).
 * Idempotent via sentinel comment.
 */
export async function patchOpenClawUiViteForElectronLitDecorators(uiDir: string): Promise<void> {
  const viteConfigPath = join(uiDir, 'vite.config.ts')
  if (!(await fileExists(viteConfigPath))) {
    return
  }
  const raw = await readFile(viteConfigPath, 'utf8')
  if (raw.includes(VITE_PATCH_SENTINEL)) {
    return
  }
  const insertion = `// ${VITE_PATCH_SENTINEL}: Lit field decorators need legacy TS emit in Electron
  return {
    esbuild: {
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true,
          useDefineForClassFields: false,
        },
      },
    },`
  const patched = raw.replace(/return\s*\{/, insertion)
  if (patched === raw) {
    throw new Error(`patch-openclaw-ui: no "return {" found in ${viteConfigPath}`)
  }
  await writeFile(viteConfigPath, patched, 'utf8')
}

/** Call after copying OpenClaw ui/ from GitHub, before npm install + vite build. */
export async function applyOpenClawUiLitDecoratorCompatPatches(uiDir: string): Promise<void> {
  await mergeUiTsconfig(uiDir)
  await patchOpenClawUiViteForElectronLitDecorators(uiDir)
  console.log('  [control-ui] applied Lit/Electron decorator compat (tsconfig + vite esbuild tsconfigRaw)')
}
