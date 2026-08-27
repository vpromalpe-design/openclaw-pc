/**
 * Desktop-only post-step on bundled `dist/control-ui` (no OpenClaw repo / Vite config changes).
 * Vite output may keep TC39 decorators as raw `@`; embedded Chromium may not parse them yet.
 * esbuild lowers them for an older target.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { transformSync } from 'esbuild'

/** Align with older embedded Chromium; forces decorator + other cutting-edge syntax lowering. */
const EMBEDDED_CHROMIUM_TARGET = 'chrome130'

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const ent of entries) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) {
      out.push(...(await listFilesRecursive(p)))
    } else {
      out.push(p)
    }
  }
  return out
}

export async function transpileControlUiForElectronEmbedded(controlUiRoot: string): Promise<void> {
  const all = await listFilesRecursive(controlUiRoot)
  const scripts = all.filter((f) => {
    const lower = f.toLowerCase()
    return (
      (lower.endsWith('.js') || lower.endsWith('.mjs')) &&
      !lower.endsWith('.js.map') &&
      !lower.endsWith('.mjs.map')
    )
  })

  for (const abs of scripts) {
    const code = await readFile(abs, 'utf8')
    const result = transformSync(code, {
      loader: 'js',
      target: EMBEDDED_CHROMIUM_TARGET,
      format: 'esm',
      sourcefile: abs,
      legalComments: 'inline',
      minify: false,
    })
    if (result.code !== code) {
      await writeFile(abs, result.code, 'utf8')
    }
  }

  console.log(
    `  [control-ui] lowered ${scripts.length} script(s) for embedded Chromium (esbuild target=${EMBEDDED_CHROMIUM_TARGET})`,
  )
}
