/**
 * Local models engine (v0.8.7): GGUF downloads with progress, bundled llama.cpp
 * server lifecycle, and `local` provider registration in openclaw.json.
 *
 * Windows-first (llama.cpp binary is fetched for win32-x64). On other platforms
 * downloads still work; engine start returns a clear error.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'
import { spawn, exec as execCb, ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execCb)
import type {
  LocalModelInfo,
  LocalEngineState,
  LocalEngineRuntimeInfo,
  OpenClawConfig,
} from '../../shared/types.js'
import { getUserDataDir } from '../utils/paths.js'
import { logInfo } from '../utils/logger.js'
import {
  readShellConfig,
  writeShellConfig,
} from '../config/shell-config.js'
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
  /** Overrides the default `compat.supportsTools: false` for this preset. */
  supportsTools?: boolean
}

/**
 * Preinstalled GGUF picks (CPU-friendly sizes, stable URLs):
 * Normal (Qwen 3.5 4B, runs on any PC) and Hard (Qwen 3.5 9B, best quality).
 * Both enable tool calling.
 *
 * Qwen 3.5 ships as Ollama manifests; the model layer blobs are plain GGUF
 * files, served straight from the Ollama registry (no login required).
 */
export const LOCAL_MODEL_PRESETS: LocalModelPreset[] = [
  {
    id: 'qwen3.5-4b',
    name: 'Qwen 3.5 4B (Normal)',
    fileName: 'Qwen3.5-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf?download=true',
    sizeBytes: 2_740_937_888,
    description: '~2.6 GB · fastest, runs on any PC',
    supportsTools: true,
  },
  {
    id: 'qwen3.5-9b',
    name: 'Qwen 3.5 9B (Hard)',
    fileName: 'Qwen3.5-9B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf?download=true',
    sizeBytes: 5_680_522_464,
    description: '~5.3 GB · best quality, tool calling enabled',
    supportsTools: true,
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

export function modelsDir(): string {
  const dir = path.join(getUserDataDir(), 'models')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function engineDir(): string {
  return path.join(getUserDataDir(), 'llama')
}

/** Scan downloaded GGUF files. */
export function listLocalModels(order?: string[]): LocalModelInfo[] {
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
        name: preset?.name ?? f.replace(/\.gguf$/i, ''),
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
        name: preset.name,
        fileName: preset.fileName,
        path: path.join(dir, preset.fileName),
        sizeBytes: preset.sizeBytes,
        downloaded: false,
        status: 'downloading',
        progress: 0,
      })
    }
  }
  const orderIndex = new Map((order ?? []).map((id, i) => [id, i]))
  const presetIndex = new Map(LOCAL_MODEL_PRESETS.map((p, i) => [p.id, i]))
  out.sort((a, b) => {
    const oa = orderIndex.get(a.id)
    const ob = orderIndex.get(b.id)
    if (oa !== undefined && ob !== undefined) return oa - ob
    if (oa !== undefined) return -1
    if (ob !== undefined) return 1
    const pa = presetIndex.get(a.id)
    const pb = presetIndex.get(b.id)
    if (pa !== undefined && pb !== undefined) return pa - pb
    if (pa !== undefined) return -1
    if (pb !== undefined) return 1
    return a.fileName.localeCompare(b.fileName)
  })
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
      { headers: { 'User-Agent': 'OpenClaw-PC/0.8.7' } },
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

export type LocalEngineMode = 'auto' | 'cpu' | 'gpu'
export type EngineVariant = 'cpu' | 'cuda' | 'vulkan'

interface GpuInfo {
  vendor: 'nvidia' | 'amd' | 'intel' | 'other' | 'none'
  name: string
}

let cachedGpu: GpuInfo | null = null
/** Detect the discrete GPU vendor via WMI (fast, no drivers queried). */
export async function detectGpu(): Promise<GpuInfo> {
  if (cachedGpu) return cachedGpu
  if (process.platform !== 'win32') {
    cachedGpu = { vendor: 'none', name: '' }
    return cachedGpu
  }
  try {
    const { execFile } = await import('node:child_process')
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(Get-CimInstance Win32_VideoController).Name',
        ],
        { windowsHide: true, timeout: 15_000 },
        (err, out) => (err ? reject(err) : resolve({ stdout: out })),
      )
    })
    const names = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ')
    const lower = names.toLowerCase()
    let vendor: GpuInfo['vendor'] = 'other'
    if (/nvidia/.test(lower)) vendor = 'nvidia'
    else if (/amd|radeon/.test(lower)) vendor = 'amd'
    else if (/intel/.test(lower)) vendor = 'intel'
    else if (!names) vendor = 'none'
    cachedGpu = { vendor, name: names }
  } catch {
    cachedGpu = { vendor: 'none', name: '' }
  }
  return cachedGpu
}

/** Map the user's CPU/GPU preference to an actual llama.cpp build variant. */
export function resolveEngineVariant(
  mode: LocalEngineMode,
  gpu: GpuInfo,
): EngineVariant {
  if (mode === 'cpu') return 'cpu'
  if (mode === 'gpu') {
    if (gpu.vendor === 'nvidia') return 'cuda'
    if (gpu.vendor === 'amd') return 'vulkan'
    return 'cpu'
  }
  // auto: prefer GPU, fall back to CPU when no supported GPU is present.
  if (gpu.vendor === 'nvidia') return 'cuda'
  if (gpu.vendor === 'amd') return 'vulkan'
  return 'cpu'
}

function getEngineServerPath(variant: EngineVariant): string | null {
  if (process.platform !== 'win32') return null
  const exe = path.join(engineDir(), variant, 'llama-server.exe')
  return fs.existsSync(exe) ? exe : null
}

/** Fetch latest llama.cpp release tag + asset names (cached). */
let cachedLlamaRelease: { tag: string; assets: string[] } | null = null

async function fetchLatestLlamaRelease(): Promise<{
  tag: string
  assets: string[]
}> {
  if (cachedLlamaRelease) return cachedLlamaRelease
  const { res } = await httpGetFollowRedirect(LLAMA_ZIP_URL, 3)
  let body = ''
  for await (const chunk of res) {
    body += chunk
  }
  const json = JSON.parse(body) as {
    tag_name?: string
    assets?: { name?: string }[]
  }
  const tag = json.tag_name
  if (!tag) throw new Error('Could not resolve latest llama.cpp release')
  cachedLlamaRelease = {
    tag,
    assets: (json.assets ?? [])
      .map((a) => a.name ?? '')
      .filter((n) => n.startsWith(`llama-${tag}-`)),
  }
  return cachedLlamaRelease
}

/**
 * Pick the release asset for a compute variant. llama.cpp renamed their
 * CUDA archives to include the CUDA toolkit version (e.g.
 * llama-b10502-bin-win-cuda-12.4-x64.zip), so exact-name matching fails.
 * Prefer the most compatible CUDA build (12.4), then 13.x, then any match.
 */
function resolveEngineAssetName(
  tag: string,
  variant: EngineVariant,
  assets: string[],
): string {
  const wanted = `bin-win-${variant}`
  const candidates = assets.filter(
    (n) => n.includes(wanted) && n.includes('x64') && !n.includes('arm64'),
  )
  if (candidates.length === 0) return ''
  if (variant === 'cuda') {
    const exact = candidates.find((n) => n.includes(`${wanted}-x64.zip`))
    const v124 = candidates.find((n) => n.includes(`${wanted}-12.4-x64.zip`))
    const v133 = candidates.find((n) => n.includes(`${wanted}-13.3-x64.zip`))
    return exact ?? v124 ?? v133 ?? candidates[0]
  }
  return candidates.find((n) => n.includes(`${wanted}-x64.zip`)) ?? candidates[0]
}

/** Download + extract llama-server.exe of the requested build variant (Windows x64). */
export async function ensureEngineBinary(
  variant: EngineVariant,
): Promise<string> {
  const existing = getEngineServerPath(variant)
  if (existing) return existing
  if (process.platform !== 'win32') {
    throw new Error(
      'Local engine is currently available on Windows only. Downloads still work on other platforms.',
    )
  }
  const dir = path.join(engineDir(), variant)
  fs.mkdirSync(dir, { recursive: true })
  const { tag, assets } = await fetchLatestLlamaRelease()
  const assetName = resolveEngineAssetName(tag, variant, assets)
  if (!assetName) {
    throw new Error(
      `No llama.cpp ${variant} build found in release ${tag} (assets: ${assets.length})`,
    )
  }
  const zipUrl = `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/${assetName}`
  const zipPath = path.join(dir, 'llama.zip')
  emitProgress({ stage: 'engine-download', tag, variant, progress: 0 })
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
        variant,
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
  if (variant === 'cuda') {
    // Official llama.cpp CUDA builds load cudart/cublas dynamically and die
    // with ExitCode 1 when the host has no CUDA Toolkit installed. Ship the
    // runtime next to the binary so the GPU build works on any machine with
    // an NVIDIA driver (no admin install required).
    await ensureCudaRuntime(dir)
  }
  const exe = getEngineServerPath(variant)
  if (!exe) {
    // llama-server.exe may sit in a subfolder (older builds) — search one level deep.
    const found = findLlamaServerExe(dir)
    if (!found) throw new Error('llama-server.exe not found in downloaded archive')
    return found
  }
  return exe
}

/**
 * Stable release tag on OUR repo hosting the CUDA 12.x runtime DLLs
 * (never force-pushed; independent from the app version tags).
 */
const CUDA_RUNTIME_TAG = 'cuda-runtime-v1'
const CUDA_RUNTIME_ASSET = 'llama-runtime-cuda12-win-x64.zip'
const CUDA_RUNTIME_DLLS = ['cudart64_12.dll', 'cublas64_12.dll', 'cublasLt64_12.dll']

/** Download + extract the CUDA runtime DLLs next to the engine binary. */
async function ensureCudaRuntime(dir: string): Promise<void> {
  const have = CUDA_RUNTIME_DLLS.every((dll) => fs.existsSync(path.join(dir, dll)))
  if (have) return
  const zipUrl = `https://github.com/vpromalpe-design/openclaw-pc/releases/download/${CUDA_RUNTIME_TAG}/${CUDA_RUNTIME_ASSET}`
  const zipPath = path.join(dir, 'cuda-runtime.zip')
  emitProgress({
    stage: 'cuda-runtime-download',
    tag: CUDA_RUNTIME_TAG,
    variant: 'cuda',
    progress: 0,
  })
  const { res } = await httpGetFollowRedirect(zipUrl, 5)
  const total = Number(res.headers['content-length'] ?? 0)
  let received = 0
  const out = fs.createWriteStream(zipPath)
  await new Promise<void>((resolve, reject) => {
    res.on('data', (c: Buffer) => {
      received += c.length
      emitProgress({
        stage: 'cuda-runtime-download',
        tag: CUDA_RUNTIME_TAG,
        variant: 'cuda',
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
  const missing = CUDA_RUNTIME_DLLS.filter((dll) => !fs.existsSync(path.join(dir, dll)))
  if (missing.length > 0) {
    throw new Error(
      `CUDA runtime download incomplete, missing: ${missing.join(', ')}`,
    )
  }
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

function fetchLoadedModelId(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    http
      .get(`http://127.0.0.1:${port}/v1/models`, { timeout: 3000 }, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            const j = JSON.parse(body) as { data?: Array<{ id?: string }> }
            resolve(j.data?.[0]?.id ?? null)
          } catch {
            resolve(null)
          }
        })
      })
      .on('error', () => resolve(null))
  })
}

/** Normalize a model name for comparison: basename, no .gguf, lowercase. */
function normalizeModelName(name: string): string {
  return path
    .basename(name.replace(/\\/g, '/'))
    .replace(/\.gguf$/i, '')
    .toLowerCase()
}

/**
 * True when two model identifiers refer to the same file (llama.cpp reports
 * the loaded model as its file basename, e.g. "qwen05b-q8.gguf"). Prefix
 * matching only accepts fairly long stems (>= 7 chars) so generic names like
 * "gemma" never alias a different model family ("gemma4-v2-Q4_K_M").
 */
function modelNamesMatch(a: string, b: string): boolean {
  const na = normalizeModelName(a)
  const nb = normalizeModelName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  return (
    (na.startsWith(nb) && nb.length >= 7) ||
    (nb.startsWith(na) && na.length >= 7)
  )
}

/**
 * Force-kill every process LISTENING on the given TCP port (Windows). Used to
 * clear a stale llama-server that holds LOCAL_ENGINE_PORT with a different
 * model. Returns true when at least one process was terminated.
 */
async function killProcessOnPort(port: number): Promise<boolean> {
  try {
    const { stdout } = await exec(
      `netstat -ano | findstr ":${port} " | findstr "LISTENING"`,
      { windowsHide: true, timeout: 8000 },
    )
    if (!stdout) return false
    const pids = new Set<string>()
    for (const line of stdout.split(/\r?\n/)) {
      const tok = line.trim().split(/\s+/).pop()
      if (tok && /^\d+$/.test(tok)) pids.add(tok)
    }
    if (pids.size === 0) return false
    let killed = false
    for (const pid of pids) {
      try {
        await exec(`taskkill /PID ${pid} /F /T`, {
          windowsHide: true,
          timeout: 8000,
        })
        killed = true
      } catch {
        /* ignore per-pid failures */
      }
    }
    return killed
  } catch {
    return false
  }
}

function fetchServerContextWindow(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    http
      .get(`http://127.0.0.1:${port}/props`, { timeout: 3000 }, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            const j = JSON.parse(body) as {
              n_ctx?: number
              default_generation_settings?: { n_ctx?: number }
            }
            resolve(j.n_ctx ?? j.default_generation_settings?.n_ctx ?? null)
          } catch {
            resolve(null)
          }
        })
      })
      .on('error', () => resolve(null))
  })
}

/**
 * Guard against context-window desync: when a llama-server was started
 * manually (or by an older build) with a smaller `-c` than the provider
 * model declares, cap contextWindow so input+output always fit inside the
 * server's n_ctx. Otherwise llama-server answers HTTP 400 "Context size has
 * been exceeded" as soon as the chat history grows. No-op when consistent.
 */
async function syncLocalContextWindow(
  port: number,
  cfg: OpenClawConfig,
  writeConfig: (c: OpenClawConfig) => void,
): Promise<void> {
  const nCtx = await fetchServerContextWindow(port)
  if (!nCtx || nCtx <= 0) return
  const local = cfg.models?.providers?.local
  const model = Array.isArray(local?.models) ? local.models[0] : undefined
  if (!model || typeof model.contextWindow !== 'number') return
  const maxTokens =
    typeof model.maxTokens === 'number' ? model.maxTokens : 2048
  const ideal = Math.max(1024, nCtx - maxTokens)
  if (model.contextWindow > ideal) {
    model.contextWindow = ideal
    writeConfig(cfg)
  }
}

/** Start llama-server with a downloaded GGUF; registers `local` provider in config. */
export async function startLocalEngine(
  modelIdRaw: string,
  currentConfig: OpenClawConfig,
  writeConfig: (c: OpenClawConfig) => void,
): Promise<LocalEngineState> {
  // The Experimental preset was merged into the base Hard model (both have
  // tool calling now); map a stale config id to the base preset.
  const modelId = modelIdRaw.replace(/-experimental$/, '')
  if (engineState.running && engineState.modelId !== modelId) {
    // Model switch while the engine is up: stop the old server first, then
    // start the new model below (the gateway keeps the same baseUrl).
    stopLocalEngine()
  }
  if (engineState.running) {
    return { ...engineState }
  }
  const preset = LOCAL_MODEL_PRESETS.find((p) => p.id === modelId)
  const model = listLocalModels().find(
    (m) =>
      m.id === modelId ||
      (preset?.fileName != null && m.fileName === preset.fileName) ||
      m.fileName.replace(/\.gguf$/i, '') === modelId,
  )
  if (!model) throw new Error(`Model not downloaded: ${modelId}`)
  if (process.platform !== 'win32') {
    throw new Error('Local engine is currently available on Windows only')
  }
  // Resolve the local model file (basename, e.g. "gemma4-v2-Q4_K_M.gguf")
  // up front — the adopt check below compares it against what the server on
  // LOCAL_ENGINE_PORT actually reports via /v1/models.
  const expectedModelName = path.basename(model.path)
  // Already serving on the port? (e.g. started manually, or by a previous
  // app instance whose state we lost) — adopt it instead of double-spawning.
  const alreadyUp = await waitForHealth(LOCAL_ENGINE_PORT, 5_000)
  if (alreadyUp) {
    // A server is already listening on the port. Adopt it ONLY when it is
    // actually serving the requested model. An orphaned llama-server (left
    // over from a previous app instance or started manually) may hold the
    // port with a DIFFERENT model — adopting it would make the UI lie about
    // what is really loaded and chat answers would come from the wrong
    // model. In that case kill the stale process and start ours below.
    const loaded = await fetchLoadedModelId(LOCAL_ENGINE_PORT)
    const matches =
      loaded != null &&
      (modelNamesMatch(loaded, modelId) ||
        modelNamesMatch(loaded, expectedModelName))
    if (matches) {
      // Adopted server may run with an arbitrary `-c`; keep the config
      // honest so we never send a prompt larger than the server's n_ctx.
      await syncLocalContextWindow(LOCAL_ENGINE_PORT, currentConfig, writeConfig)
      engineState = { running: true, port: LOCAL_ENGINE_PORT, modelId }
      return { ...engineState }
    }
    logInfo(
      `[local-engine] port ${LOCAL_ENGINE_PORT} is held by a server serving "${loaded ?? 'unknown'}", expected "${expectedModelName}" — killing stale process`,
    )
    const killed = await killProcessOnPort(LOCAL_ENGINE_PORT)
    if (killed) {
      await new Promise((r) => setTimeout(r, 800))
      const stillUp = await waitForHealth(LOCAL_ENGINE_PORT, 5_000)
      if (stillUp) {
        throw new Error(
          `Порт ${LOCAL_ENGINE_PORT} занят другим процессом и не освобождается. Закройте его вручную (Диспетчер задач) и повторите.`,
        )
      }
    } else {
      throw new Error(
        `На порту ${LOCAL_ENGINE_PORT} обнаружен чужой сервер (модель «${loaded ?? 'неизвестна'}») вместо «${expectedModelName}». Не удалось остановить его автоматически — закройте процесс вручную (Диспетчер задач) и повторите.`,
      )
    }
  }
  const shellConfig = readShellConfig()
  const gpu = await detectGpu()
  let variant = resolveEngineVariant(shellConfig.localEngineMode ?? 'auto', gpu)
  const serverPath = await ensureEngineBinary(variant)

  const spawnArgs = [
    '-m',
    model.path,
    '--host',
    '127.0.0.1',
    '--port',
    String(LOCAL_ENGINE_PORT),
    '--no-ui',
    '-c',
    '65536',
    '-ngl',
    variant === 'cpu' ? '0' : '99',
    // 64k context: quantize the KV cache (q8_0 ≈ half of fp16) so it fits in
    // VRAM/RAM next to the weights. The agent's prompt (system + tools +
    // history) easily reaches ~10k tokens; with a 32k window the compaction
    // reserve (50% by default) leaves too little room and auto-compaction
    // fires almost every turn.
    '-ctk',
    'q8_0',
    '-ctv',
    'q8_0',
    '--log-file',
    path.join(engineDir(), 'server.log'),
  ]

  const spawnServer = (exePath: string, args: string[]): Promise<boolean> => {
    const child = spawn(exePath, args, {
      windowsHide: true,
      stdio: 'ignore',
    })
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
    return waitForHealth(LOCAL_ENGINE_PORT, 120_000)
  }

  let ok = await spawnServer(serverPath, spawnArgs)
  if (!ok && variant !== 'cpu') {
    // GPU build failed to come up (missing driver/CUDA runtime, unsupported
    // iGPU, …) — fall back to the CPU build exactly once, then keep the
    // engine in CPU mode for this session.
    logInfo(
      `[local-engine] ${variant} engine did not become healthy, falling back to CPU`,
    )
    stopLocalEngine()
    variant = 'cpu'
    const cpuPath = await ensureEngineBinary('cpu')
    const cpuArgs = spawnArgs.map((a) => a)
    cpuArgs[cpuArgs.indexOf('-ngl') + 1] = '0'
    cpuArgs[cpuArgs.indexOf('-c') + 1] = '65536'
    ok = await spawnServer(cpuPath, cpuArgs)
  }
  if (!ok) {
    stopLocalEngine()
    throw new Error('llama-server did not become healthy within 120s')
  }
  // Register the `local` provider so the gateway can reach the engine.
  const next = JSON.parse(JSON.stringify(currentConfig)) as OpenClawConfig
  next.models = next.models ?? { providers: {} }
  next.models.providers = next.models.providers ?? {}
  // Small local models cannot afford the default compaction reserve (half the
  // context window): a 16k window would leave ~6k tokens for the prompt and
  // overflow as soon as the chat history grows. Cap the reserve explicitly.
  next.agents = next.agents ?? { defaults: {} }
  next.agents.defaults = next.agents.defaults ?? {}
  next.agents.defaults.compaction = next.agents.defaults.compaction ?? {}
  if (
    typeof next.agents.defaults.compaction.reserveTokens !== 'number' &&
    typeof next.agents.defaults.compaction.reserveTokensFloor !== 'number'
  ) {
    // Exact reserve: the gateway's default is 50% of the context window,
    // which for a 64k window would reserve 32k tokens for output that will
    // never come. 4096 is plenty (maxTokens is 2048 + tool results).
    next.agents.defaults.compaction.reserveTokens = 4096
  }
  if (
    typeof next.agents.defaults.compaction.reserveTokensFloor !== 'number'
  ) {
    next.agents.defaults.compaction.reserveTokensFloor = 3072
  }
  const existing = next.models.providers.local
  const existingModel =
    Array.isArray(existing?.models) && existing.models.length > 0
      ? existing.models[0]
      : undefined
  next.models.providers.local = {
    ...(existing ?? {}),
    baseUrl: `http://127.0.0.1:${LOCAL_ENGINE_PORT}/v1`,
    api: 'openai-completions',
    apiKey: existing?.apiKey ?? '',
    models: [
      {
        ...(existingModel ?? {}),
        id: model.id,
        name: model.id,
        // Real engine limits (-c 65536): context window + max output tokens
        // must fit inside the server's n_ctx or llama-server answers 400
        // "Context size has been exceeded" once the chat history grows.
        contextWindow: 63488,
        maxTokens: 2048,
        // Tool calling is on for presets that enable it and for custom GGUF
        // models: without the schemas the model echoes the agent's tool
        // descriptions as raw text (<|tool_call|>call:Read{...}<|tool_call|>).
        // Risk: llama.cpp may reject exotic JSON-schema constructs (bare
        // `pattern` → HTTP 400) — then the model errors instead of echoing.
        // VERIFIED 2026-08-20 on the live laptop engine: full OpenClaw tool
        // payload (31 tools incl. exec.env patternProperties '^.*$' and bare
        // '.*') returns 200 — tools stay ON. If 400 'Pattern must start with
        // ^ and end with $' ever comes back, re-disable here AND in
        // sanitizeConfigPaths, then sanitize tool schemas before send.
        compat: { supportsTools: preset ? preset.supportsTools === true : true },
      },
    ],
  }
  // Keep the agent's primary model in sync so the choice survives restarts
  // (and the gateway routes chat requests to the local provider).
  const prevModel = next.agents.defaults.model
  const agentModel: { primary?: string } =
    typeof prevModel === 'string' ? {} : { ...((prevModel as object) ?? {}) }
  agentModel.primary = `local/${model.id}`
  next.agents.defaults.model = agentModel
  writeConfig(next)

  // Belt-and-braces: if the downloaded binary defaults to a smaller n_ctx
  // than our -c request, align the config with reality instead of failing
  // later with HTTP 400.
  await syncLocalContextWindow(LOCAL_ENGINE_PORT, next, writeConfig)
  engineState = { running: true, port: LOCAL_ENGINE_PORT, modelId: model.id }
  return { ...engineState }
}

export interface LocalEngineTestResult {
  ok: boolean
  message: string
}

/**
 * Real end-to-end check: send a minimal chat completion to llama-server and
 * require an actual model answer. Health checks only prove the server is up;
 * this proves the loaded GGUF can produce tokens.
 *
 * Retries transient failures (server busy / model still loading / empty
 * reply) until the overall deadline: a local engine can legitimately take a
 * while when its single slot is busy or the model is warming up, and a
 * "Model did not answer" verdict must reflect the real state, not a race.
 */
export async function testLocalEngineChat(
  port: number,
  modelId: string,
  timeoutMs = 90_000,
): Promise<LocalEngineTestResult> {
  const deadline = Date.now() + timeoutMs
  let lastTransient = 'Модель не вернула ответ'
  while (Date.now() < deadline) {
    const probe = await singleChatProbe(
      port,
      modelId,
      Math.min(30_000, Math.max(5_000, deadline - Date.now())),
    )
    if (probe.ok) return { ok: true, message: 'OK' }
    if (!probe.retryable) return { ok: false, message: probe.message }
    lastTransient = probe.message
    await new Promise((r) => setTimeout(r, 2500))
  }
  return { ok: false, message: lastTransient }
}

interface ChatProbeResult {
  ok: boolean
  retryable: boolean
  message: string
}

function singleChatProbe(
  port: number,
  modelId: string,
  timeoutMs: number,
): Promise<ChatProbeResult> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 4,
      temperature: 0,
    })
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          if (res.statusCode === 503 || res.statusCode === 429) {
            resolve({ ok: false, retryable: true, message: `Движок занят (HTTP ${res.statusCode})` })
            return
          }
          if (res.statusCode !== 200) {
            resolve({
              ok: false,
              retryable: false,
              message: `llama-server вернул HTTP ${res.statusCode}`,
            })
            return
          }
          try {
            const j = JSON.parse(data) as {
              model?: string
              choices?: Array<{ message?: { content?: string } }>
            }
            const content = j.choices?.[0]?.message?.content?.trim()
            const respondedModel = j.model
            if (respondedModel && !modelNamesMatch(respondedModel, modelId)) {
              // The engine is serving a different model than requested — the
              // test must report the real state of affairs.
              resolve({
                ok: false,
                retryable: false,
                message: `Движок отвечает моделью «${respondedModel}», а не «${modelId}». Остановите и подключите движок заново.`,
              })
            } else if (content) {
              resolve({ ok: true, retryable: false, message: 'OK' })
            } else {
              resolve({ ok: false, retryable: true, message: 'Модель не вернула ответ' })
            }
          } catch {
            resolve({ ok: false, retryable: false, message: 'Некорректный ответ движка' })
          }
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, retryable: true, message: 'Движок не ответил вовремя' })
    })
    req.on('error', (err) =>
      resolve({ ok: false, retryable: true, message: err.message }),
    )
    req.write(body)
    req.end()
  })
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

/** Full local-engine runtime snapshot for the desktop UI (toggle + model bar). */
export async function getLocalEngineRuntimeState(): Promise<LocalEngineRuntimeInfo> {
  const shellConfig = readShellConfig()
  const mode = shellConfig.localEngineMode ?? 'auto'
  const gpu = await detectGpu()
  const variant = resolveEngineVariant(mode, gpu)
  return {
    mode,
    variant,
    installedVariants: (['cpu', 'cuda', 'vulkan'] as EngineVariant[]).filter(
      (v) => getEngineServerPath(v) !== null,
    ),
    effectiveGpu: variant === 'cpu' ? 'cpu' : 'gpu',
    gpuVendor: gpu.vendor,
    gpuName: gpu.name,
    engineState: { ...engineState },
    models: listLocalModels(shellConfig.localModelsOrder),
  }
}

/**
 * Download + unpack the llama.cpp binary for a compute variant (e.g. CUDA).
 * Emits `engine-download` progress over IPC_LOCAL_PROGRESS; used by the
 * wizard's "Where does it run" CPU/GPU section.
 */
export async function installEngineVariant(
  variant: EngineVariant,
): Promise<LocalEngineRuntimeInfo> {
  await ensureEngineBinary(variant)
  return getLocalEngineRuntimeState()
}

/** Switch the engine compute mode (cpu|gpu|auto); restarts a running engine. */
export async function setLocalEngineMode(
  mode: LocalEngineMode,
  currentConfig: OpenClawConfig,
  writeConfig: (c: OpenClawConfig) => void,
): Promise<LocalEngineRuntimeInfo> {
  const shellConfig = readShellConfig()
  shellConfig.localEngineMode = mode
  writeShellConfig(shellConfig)
  if (engineState.running && engineState.modelId) {
    const modelId = engineState.modelId
    stopLocalEngine()
    try {
      await startLocalEngine(modelId, currentConfig, writeConfig)
    } catch (err) {
      logInfo(
        `[local-engine] mode switch to ${mode} failed to restart engine: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return getLocalEngineRuntimeState()
}

/**
 * Repair a corrupted `agents.defaults.workspace` in the config: when the path
 * was mangled by an ANSI read/write round-trip (e.g. editing openclaw.json
 * with PowerShell `Get-Content` without `-Encoding UTF8` — cyrillic paths
 * like `C:\Users\Дамир\...` turn into mojibake), the agent fails on every
 * message with `ENOENT: mkdir '<mojibake>'`. Detect the mojibake signature
 * and fall back to the standard workspace path.
 */

/** Mojibake signature: cyrillic letters mixed with characters that never
 * appear in a real Windows path (NBSP U+00A0, smart quotes U+2018–U+201F,
 * currency U+20AC, CP1251 control chars U+0098). */
function isMojibakePath(p: string | undefined): boolean {
  if (typeof p !== 'string' || p.length === 0) return false
  return /[\u0400-\u045F][\u00A0\u0098\u2018-\u201F\u20AC]|[\u00A0\u0098\u2018-\u201F\u20AC][\u0400-\u045F]/.test(
    p,
  )
}

/**
 * Repair mojibake paths in the config (workspace, agentDir) so the agent
 * works in the real profile even when a cyrillic username was mangled by an
 * ANSI read/write round-trip of openclaw.json. Called on app start (before
 * the gateway spawns) and before every local-engine config write.
 */
export function sanitizeConfigPaths(
  cfg: OpenClawConfig,
  writeConfig: (c: OpenClawConfig) => void,
): void {
  const defaults = cfg.agents?.defaults
  if (!defaults) return
  if (isMojibakePath(defaults.workspace)) {
    defaults.workspace = path.join(os.homedir(), '.openclaw', 'workspace')
    writeConfig(cfg)
  }
}

/**
 * Auto-start the local engine on app launch when the primary agent model is a
 * `local/*` GGUF. Failures are swallowed (logged via return value) so a broken
 * local setup never blocks app startup; the Models panel still shows state.
 */
export async function maybeAutoStartLocalEngine(
  readConfig: () => OpenClawConfig | null,
  writeConfig: (c: OpenClawConfig) => void,
): Promise<void> {
  try {
    const config = readConfig()
    if (!config) return
    sanitizeConfigPaths(config, writeConfig)
    const modelCfg = config?.agents?.defaults?.model
    const primary =
      typeof modelCfg === 'string' ? modelCfg : modelCfg?.primary
    if (!primary || !primary.startsWith('local/')) return
    const modelId = primary.slice('local/'.length)
    await startLocalEngine(modelId, config, writeConfig)
  } catch (err) {
    // Non-fatal: engine stays off, Models panel shows the error state. But
    // surface the real reason in the log — silent failures made the
    // "network connection error" impossible to diagnose.
    logInfo(
      `[local-engine] auto-start failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    )
  }
}

export { formatBytes }
