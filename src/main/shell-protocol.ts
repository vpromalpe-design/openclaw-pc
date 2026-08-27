import { app, protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { logWarn } from './utils/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Custom scheme so the shell is not loaded via file:// (module/CORS/CSP edge cases on Windows). */
export const SHELL_CUSTOM_SCHEME = 'openclaw-shell' as const
export const SHELL_CUSTOM_HOST = 'renderer' as const

let rendererRootCache: string | null = null

/** Same candidate order as historical loadFile() — must match where index.html actually lives. */
export function listShellRendererIndexCandidates(): string[] {
  if (!app.isPackaged) {
    return [path.join(__dirname, '../renderer', 'index.html')]
  }
  return [
    path.join(process.resourcesPath, 'app.asar.unpacked', 'out', 'renderer', 'index.html'),
    path.join(app.getAppPath(), 'out', 'renderer', 'index.html'),
  ]
}

/**
 * Directory that contains the resolved index.html (unpacked preferred when that index exists).
 * Avoids choosing an empty `app.asar.unpacked/.../renderer` folder when only asar has the bundle.
 */
export function resolveShellRendererRoot(): string {
  if (!app.isPackaged) {
    return path.resolve(path.join(__dirname, '../renderer'))
  }
  for (const indexPath of listShellRendererIndexCandidates()) {
    const dir = path.dirname(indexPath)
    if (fs.existsSync(indexPath)) {
      return path.resolve(dir)
    }
  }
  const fallback = path.resolve(path.dirname(listShellRendererIndexCandidates()[0]))
  logWarn(
    `[OpenClaw] Shell index.html not found under unpacked or asar; serving from fallback: ${fallback}`,
  )
  return fallback
}

export function getShellRendererIndexPath(): string {
  return path.join(resolveShellRendererRoot(), 'index.html')
}

function getShellRendererRootCached(): string {
  if (!rendererRootCache) {
    rendererRootCache = resolveShellRendererRoot()
  }
  return rendererRootCache
}

/** Call before app 'ready' (Electron requirement). */
export function registerShellPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SHELL_CUSTOM_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

export function getShellIndexPageUrl(hash?: string): string {
  const base = `${SHELL_CUSTOM_SCHEME}://${SHELL_CUSTOM_HOST}/index.html`
  if (!hash) return base
  const h = hash.startsWith('#') ? hash : `#${hash}`
  return `${base}${h}`
}

export function isShellCustomProtocolUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    return u.protocol === `${SHELL_CUSTOM_SCHEME}:` && u.hostname.toLowerCase() === SHELL_CUSTOM_HOST
  } catch {
    return false
  }
}

/** Register after app 'ready', before creating BrowserWindows that load the shell. */
export function registerShellFileProtocol(): void {
  rendererRootCache = null
  protocol.registerFileProtocol(SHELL_CUSTOM_SCHEME, (request, callback) => {
    try {
      const parsed = new URL(request.url)
      if (parsed.protocol !== `${SHELL_CUSTOM_SCHEME}:`) {
        callback({ error: -2 })
        return
      }
      if (parsed.hostname.toLowerCase() !== SHELL_CUSTOM_HOST) {
        callback({ error: -10 })
        return
      }
      let pathname = decodeURIComponent(parsed.pathname)
      if (pathname === '/' || pathname === '') {
        pathname = '/index.html'
      }
      const relative = pathname.replace(/^\/+/, '').replace(/\\/g, '/')
      if (!relative || relative.includes('..') || relative.includes(':')) {
        callback({ error: -10 })
        return
      }
      const root = getShellRendererRootCached()
      const filePath = path.normalize(path.join(root, ...relative.split('/')))
      const rootResolved = path.resolve(root)
      const fileResolved = path.resolve(filePath)
      const relToRoot = path.relative(rootResolved, fileResolved)
      if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
        callback({ error: -10 })
        return
      }
      if (!fs.existsSync(fileResolved) || fs.statSync(fileResolved).isDirectory()) {
        callback({ error: -6 })
        return
      }
      callback({ path: fileResolved })
    } catch {
      callback({ error: -2 })
    }
  })
}
