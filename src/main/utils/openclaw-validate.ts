import fs from 'node:fs'
import path from 'node:path'

export interface OpenClawValidationResult {
  ok: boolean
  missing: string[]
}

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function readEntryPath(openclawDir: string): string | null {
  const entryJs = path.join(openclawDir, 'dist', 'entry.js')
  const entryMjs = path.join(openclawDir, 'dist', 'entry.mjs')
  if (fileExists(entryJs)) return entryJs
  if (fileExists(entryMjs)) return entryMjs
  return null
}

function collectControlUiRefsFromHtml(html: string): string[] {
  const refs: string[] = []
  const scriptRe = /<script[^>]+src=["']([^"']+)["']/gi
  const preloadRe = /<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/gi
  const preloadRe2 = /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']modulepreload["']/gi
  let m: RegExpExecArray | null
  while ((m = scriptRe.exec(html))) {
    refs.push(m[1])
  }
  while ((m = preloadRe.exec(html))) {
    refs.push(m[1])
  }
  while ((m = preloadRe2.exec(html))) {
    refs.push(m[1])
  }
  return [...new Set(refs)]
}

function resolveControlUiRef(controlUiRoot: string, ref: string): string {
  const s = ref.trim()
  if (s.startsWith('/')) {
    return path.join(controlUiRoot, s.replace(/^\//, ''))
  }
  return path.join(controlUiRoot, s.replace(/^\.\//, ''))
}

/**
 * Catches mixed installers where index.html references a .js path but the file is HTML, UTF-16, or truncated garbage
 * (runtime symptom: Uncaught SyntaxError: Invalid or unexpected token in index-*.js).
 */
function inspectControlUiScriptFile(absPath: string): string | null {
  let buf: Buffer
  try {
    buf = fs.readFileSync(absPath)
  } catch {
    return 'read failed'
  }
  if (buf.length === 0) {
    return 'empty file'
  }
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 0xfe && buf[3] === 0xff) {
    return 'UTF-32 BE BOM'
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return 'UTF-16 LE BOM'
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    return 'UTF-16 BE BOM'
  }
  if (buf.includes(0)) {
    return 'contains null bytes'
  }
  const head = buf.subarray(0, Math.min(512, buf.length)).toString('utf8').trimStart()
  const lower = head.slice(0, 32).toLowerCase()
  if (lower.startsWith('<!doctype') || lower.startsWith('<html') || head.startsWith('<!--')) {
    return 'HTML or markup (not JavaScript)'
  }
  if (head.startsWith('<')) {
    return 'leading < (likely HTML/error page served as script)'
  }
  return null
}

function validateControlUiBundle(openclawDir: string): string[] {
  const missing: string[] = []
  const controlUiRoot = path.join(openclawDir, 'dist', 'control-ui')
  const indexPath = path.join(controlUiRoot, 'index.html')
  if (!fileExists(indexPath)) {
    missing.push('dist/control-ui/index.html')
    return missing
  }

  try {
    const html = fs.readFileSync(indexPath, 'utf-8')
    const refs = collectControlUiRefsFromHtml(html).filter((r) => r && !/^(https?:|data:)/i.test(r))
    if (refs.length === 0) {
      missing.push('dist/control-ui/index.html (no local script/modulepreload refs)')
      return missing
    }
    for (const ref of refs) {
      const pathNoQuery = ref.split('?')[0]
      const lower = pathNoQuery.toLowerCase()
      const abs = resolveControlUiRef(controlUiRoot, pathNoQuery)
      if (!fileExists(abs)) {
        missing.push(path.relative(openclawDir, abs).replace(/\\/g, '/'))
        continue
      }
      if (lower.endsWith('.js') || lower.endsWith('.mjs')) {
        const bad = inspectControlUiScriptFile(abs)
        if (bad) {
          missing.push(
            `${path.relative(openclawDir, abs).replace(/\\/g, '/')} (${bad})`,
          )
        }
      }
    }
  } catch {
    missing.push('dist/control-ui/index.html (read failed)')
  }

  return missing
}

export function validateOpenclawResources(openclawDir: string): OpenClawValidationResult {
  const missing: string[] = []

  if (!fileExists(path.join(openclawDir, 'openclaw.mjs'))) {
    missing.push('openclaw.mjs')
  }
  if (!fileExists(path.join(openclawDir, 'node_modules'))) {
    missing.push('node_modules/')
  }

  const entryPath = readEntryPath(openclawDir)
  if (!entryPath) {
    missing.push('dist/entry.(m)js')
    return { ok: false, missing }
  }

  try {
    const entryContent = fs.readFileSync(entryPath, 'utf-8')
    const importRegex = /\bimport\s+(?:[^'"]+from\s+)?['"](\.\/[^'"]+)['"]/g
    let match: RegExpExecArray | null
    while ((match = importRegex.exec(entryContent))) {
      const rel = match[1]
      if (!rel.startsWith('./')) continue
      const target = path.join(openclawDir, 'dist', rel.replace(/^\.\//, ''))
      if (!fileExists(target)) {
        missing.push(`dist/${rel.replace(/^\.\//, '')}`)
      }
    }
  } catch {
    missing.push('dist/entry.(m)js (read failed)')
  }

  missing.push(...validateControlUiBundle(openclawDir))

  return { ok: missing.length === 0, missing }
}
