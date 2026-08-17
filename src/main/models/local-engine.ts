/**
 * Local models engine (v0.8.7): GGUF downloads with progress, bundled llama.cpp
 * server lifecycle, and `local` provider registration in openclaw.json.
 *
 * Windows-first (llama.cpp binary is fetched for win32-x64). On other platforms
 * downloads still work; engine start returns a clear error.
 */

import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'
import { spawn, ChildProcess } from 'node:child_process'
import type {
  LocalModelInfo,
  LocalEngineState,
  OpenClawConfig,
} from '../../shared/types.js'
import { getUserDataDir } from '../utils/paths.js'
import { IPC_LOCAL_PROGRESS } from '../../shared/ipc-channels.js'

export const LOCAL_ENGINE_PORT = 18788
export const LOCAL_PROVIDER_ID = 'local'

export interface LocalModelPreset {
  id: string
  name: string
  fileName: string
  url: string
  sizeBytes: number
  description: string
}

/** Three preinstalled GGUF picks (CPU-friendly sizes, stable HuggingFace URLs). */
export const LOCAL_MODEL_PRESETS: LocalModelPreset[] = [
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen 2.5 0.5B (Tiny)',
    fileName: 'qwen2.5-0.5b-instruct-q8_0.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q8_0.gguf',
    sizeBytes: 495_000_000,
    description: '~470 MB · fastest, runs on any PC',
  },
  {
    id: 'qwen2.5-1.5b',
    name: 'Qwen 2.5 1.5B (Small)',
    fileName: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    sizeBytes: 1_100_000_000,
    description: '~1.1 GB · balanced speed/quality',
  },
  {
    id: 'qwen2.5-3b',
    name: 'Qwen 2.5 3B (Medium)',
    fileName: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    sizeBytes: 1_950_000_000,
    description: '~1.9 GB · best quality on CPU',
  },
]

interface DownloadHandle {
  modelId: string
  req: import('node:http').ClientRequest | null
  cancelled: boolean
}

let sendProgress: ((channel: string, ...args: unknown[]) => void) | null = null
let activeDownload: DownloadHandle | null = null
let engineChild: ChildProcess | null = null
let engineState: LocalEngineState = { running: false, port: LOCAL_ENGINE_PORT, modelId: null }

export function setLocalProgressSender(
  fn: ((channel: string, ...args: unknown[]) => void) | null,
): void {
  sendProgress = fn
}

function emitProgress(payload: unknown): void {
  if (sendProgress) sendProgress(IPC_LOCAL_PROGRESS, payload)
}

function modelsDir(): string {
  const dir = path.join(getUserDataDir(), 'models')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function engineDir(): string {
  return path.join(getUserDataDir(), 'llama')
}

/** Scan downloaded GGUF files. */
export function listLocalModels(): LocalModelInfo[] {
  const dir = modelsDir()
  const out: LocalModelInfo[] = []
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gguf'))
    for (const f of files) {
      const full = path.join(dir, f)
      let size = 0
      try {
        size = fs.statSync(full).size
      } catch {
        /* ignore */
      }
      const preset = LOCAL_MODEL_PRESETS.find((p) => p.fileName === f)
      out.push({
        id: preset?.id ?? f.replace(/\.gguf$/i, ''),
        fileName: f,
        path: full,
        sizeBytes: size,
        downloaded: true,
        status: 'ready',
        progress: 1,
      })
    }
  } catch {
    /* ignore */
  }
  // Active download pseudo-entry
  if (activeDownload && !activeDownload.cancelled) {
    const preset = LOCAL_MODEL_PRESETS.find((p) => p.id === activeDownload!.modelId)
    if (preset && !out.some((m) => m.fileName === preset.fileName)) {
      out.push({
        id: preset.id,
        fileName: preset.fileName,
        path: path.join(dir, preset.fileName),
        sizeBytes: preset.sizeBytes,
        downloaded: false,
        status: 'downloading',
        progress: 0,
      })
    }
  }
  out.sort((a, b) => a.fileName.localeCompare(b.fileName))
  return out
}

export function getEngineState(): LocalEngineState {
  return { ...engineState }
}

// ─── Downloads ────────────────────────────────────────────────────────────────

function httpGetFollowRedirect(
  url: string,
  redirectsLeft: number,
): Promise<{ res: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(
      url,
      { headers: { 'User-Agent': 'OpenClaw-Desktop/0.8.7' } },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume()
          const next = new URL(res.headers.location, url).toString()
          httpGetFollowRedirect(next, redirectsLeft - 1)
            .then(resolve)
            .catch(reject)
          return
        }
        if (res.statusCode && res.statusCode >= 400) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          return
        }
        resolve({ res })
      },
    )
    req.on('error', reject)
  })
}

function formatBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} GB`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)} MB`
  return `${Math.max(0, Math.round(n / 1000))} KB`
}

/**
 * Download a GGUF with progress events. Resolves when the file is complete.
 */
export async function downloadLocalModel(modelId: string): Promise<LocalModelInfo> {
  const preset = LOCAL_MODEL_PRESETS.find((p) => p.id === modelId)
  if (!preset) throw new Error(`Unknown local model preset: ${modelId}`)
  if (activeDownload && !activeDownload.cancelled) {
    throw new Error('Another download is already running')
  }

  const dir = modelsDir()
  const target = path.join(dir, preset.fileName)
  const part = `${target}.part`
  if (fs.existsSync(target)) {
    throw new Error('Model is already downloaded')
  }

  const handle: DownloadHandle = { modelId, req: null, cancelled: false }
  activeDownload = handle
  emitProgress({
    modelId,
    fileName: preset.fileName,
    received: 0,
    total: preset.sizeBytes,
    progress: 0,
    stage: 'downloading',
  })

  try {
    const { res } = await httpGetFollowRedirect(preset.url, 5)
    const total = Number(res.headers['content-length'] ?? preset.sizeBytes)
    let received = 0
    const out = fs.createWriteStream(part)
    await new Promise<void>((resolve, reject) => {
      handle.req = res as unknown as import('node:http').ClientRequest
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        emitProgress({
          modelId,
          fileName: preset.fileName,
          received,
          total,
          progress: Math.min(1, received / total),
          stage: 'downloading',
        })
      })
      res.on('error', reject)
      out.on('error', reject)
      out.on('close', () => {
        if (handle.cancelled) {
          reject(new Error('Download cancelled'))
        } else {
          resolve()
        }
      })
      res.pipe(out)
    })
    fs.renameSync(part, target)
    const info = listLocalModels().find((m) => m.fileName === preset.fileName)!
    emitProgress({ modelId, fileName: preset.fileName, progress: 1, stage: 'done' })
    return info
  } catch (err) {
    try {
      if (fs.existsSync(part)) fs.unlinkSync(part)
    } catch {
      /* ignore */
    }
    emitProgress({ modelId, fileName: preset.fileName, stage: 'error' })
    throw err
  } finally {
    activeDownload = null
  }
}

export function cancelLocalDownload(): boolean {
  if (!activeDownload || activeDownload.cancelled) return false
  activeDownload.cancelled = true
  try {
    activeDownload.req?.destroy()
  } catch {
    /* ignore */
  }
  return true
}

// ─── llama.cpp engine ─────────────────────────────────────────────────────────

const LLAMA_ZIP_URL =
  'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest'

function getEngineServerPath(): string | null {
  if (process.platform !== 'win32') return null
  const exe = path.join(engineDir(), 'llama-server.exe')
  return fs.existsSync(exe) ? exe : null
}

/** Fetch latest llama.cpp release tag (Windows cpu build). */
async function fetchLatestLlamaTag(): Promise<string> {
  const { res } = await httpGetFollowRedirect(LLAMA_ZIP_URL, 3)
  let body = ''
  for await (const chunk of res) {
    body += chunk
  }
  const json = JSON.parse(body) as { tag_name?: string }
  if (!json.tag_name) throw new Error('Could not resolve latest llama.cpp release')
  return json.tag_name
}

/** Download + extract llama-server.exe (Windows x64). */
export async function ensureEngineBinary(): Promise<string> {
  const existing = getEngineServerPath()
  if (existing) return existing
  if (process.platform !== 'win32') {
    throw new Error(
      'Local engine is currently available on Windows only. Downloads still work on other platforms.',
    )
  }
  const dir = engineDir()
  fs.mkdirSync(dir, { recursive: true })
  const tag = await fetchLatestLlamaTag()
  const zipUrl = `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/llama-${tag}-bin-win-cpu-x64.zip`
  const zipPath = path.join(dir, 'llama.zip')
  emitProgress({ stage: 'engine-download', tag, progress: 0 })
  const { res } = await httpGetFollowRedirect(zipUrl, 5)
  const total = Number(res.headers['content-length'] ?? 0)
  let received = 0
  const out = fs.createWriteStream(zipPath)
  await new Promise<void>((resolve, reject) => {
    res.on('data', (c: Buffer) => {
      received += c.length
      emitProgress({
        stage: 'engine-download',
        tag,
        received,
        total,
        progress: total ? Math.min(1, received / total) : 0,
      })
    })
    res.on('error', reject)
    out.on('error', reject)
    out.on('close', resolve)
    res.pipe(out)
  })
  await extractZip(zipPath, dir)
  try {
    fs.unlinkSync(zipPath)
  } catch {
    /* ignore */
  }
  const exe = getEngineServerPath()
  if (!exe) {
    // llama-server.exe may sit in a subfolder (older builds) — search one level deep.
    const found = findLlamaServerExe(dir)
    if (!found) throw new Error('llama-server.exe not found in downloaded archive')
    return found
  }
  return exe
}

function findLlamaServerExe(dir: string): string | null {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const nested = path.join(dir, entry.name, 'llama-server.exe')
        if (fs.existsSync(nested)) return nested
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Windows PowerShell Expand-Archive — always available on Windows.
    // Paths are passed via -EncodedCommand (UTF-16LE base64) so non-ASCII
    // user paths (e.g. C:\Users\Дамир\) survive the round-trip intact.
    const script =
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' ` +
      `-DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: 'ignore' },
    )
    ps.on('error', reject)
    ps.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Expand-Archive failed with code ${code}`))
    })
  })
}

function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const tryOnce = () => {
      if (Date.now() > deadline) {
        resolve(false)
        return
      }
      http
        .get(`http://127.0.0.1:${port}/health`, { timeout: 2000 }, (res) => {
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () => {
            try {
              const j = JSON.parse(body) as { status?: string }
              if (j.status === 'ok') {
                resolve(true)
                return
              }
            } catch {
              /* ignore */
            }
            setTimeout(tryOnce, 1500)
          })
        })
        .on('error', () => setTimeout(tryOnce, 1500))
    }
    tryOnce()
  })
}

/** Start llama-server with a downloaded GGUF; registers `local` provider in config. */
export async function startLocalEngine(
  modelId: string,
  currentConfig: OpenClawConfig,
  writeConfig: (c: OpenClawConfig) => void,
): Promise<LocalEngineState> {
  if (engineState.running) {
    return { ...engineState }
  }
  const model = listLocalModels().find(
    (m) => m.id === modelId || m.fileName.replace(/\.gguf$/i, '') === modelId,
  )
  if (!model) throw new Error(`Model not downloaded: ${modelId}`)
  if (process.platform !== 'win32') {
    throw new Error('Local engine is currently available on Windows only')
  }
  const serverPath = await ensureEngineBinary()

  // Register the `local` provider so the gateway can reach the engine.
  const next = JSON.parse(JSON.stringify(currentConfig)) as OpenClawConfig
  next.models = next.models ?? { providers: {} }
  next.models.providers = next.models.providers ?? {}
  next.models.providers.local = {
    baseUrl: `http://127.0.0.1:${LOCAL_ENGINE_PORT}/v1`,
    api: 'openai-completions',
    apiKey: '',
    models: [{ id: model.fileName.replace(/\.gguf$/i, ''), name: model.fileName }],
  }
  writeConfig(next)

  const child = spawn(
    serverPath,
    [
      '-m',
      model.path,
      '--host',
      '127.0.0.1',
      '--port',
      String(LOCAL_ENGINE_PORT),
      '--no-webui',
    ],
    { windowsHide: true, stdio: 'ignore' },
  )
  engineChild = child
  child.on('exit', () => {
    if (engineChild === child) {
      engineChild = null
      engineState = { running: false, port: LOCAL_ENGINE_PORT, modelId: null }
    }
  })
  child.on('error', (err) => {
    engineState = {
      running: false,
      port: LOCAL_ENGINE_PORT,
      modelId: null,
      error: err.message,
    }
  })

  const ok = await waitForHealth(LOCAL_ENGINE_PORT, 120_000)
  if (!ok) {
    stopLocalEngine()
    throw new Error('llama-server did not become healthy within 120s')
  }
  engineState = { running: true, port: LOCAL_ENGINE_PORT, modelId: model.id }
  return { ...engineState }
}

export function stopLocalEngine(): boolean {
  if (engineChild) {
    try {
      engineChild.kill()
    } catch {
      /* ignore */
    }
    engineChild = null
  }
  const wasRunning = engineState.running
  engineState = { running: false, port: LOCAL_ENGINE_PORT, modelId: null }
  return wasRunning
}

export { formatBytes }
