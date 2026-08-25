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
import net from 'node:net'
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
import { logInfo, logWarn } from '../utils/logger.js'
import {
  readShellConfig,
  writeShellConfig,
} from '../config/shell-config.js'
import { IPC_LOCAL_PROGRESS } from '../../shared/ipc-channels.js'

export const LOCAL_ENGINE_PORT = 18788
export const LOCAL_PROVIDER_ID = 'local'

/**
 * v0.8.17: the real llama-server listens on LOCAL_ENGINE_BACKEND_PORT while
 * LOCAL_ENGINE_PORT (18788) is owned by the built-in schema-fix proxy.
 *
 * Why: the app rewrites openclaw.json on every start with
 * `baseUrl: http://127.0.0.1:${LOCAL_ENGINE_PORT}/v1`, so any external proxy
 * on a different port is wiped from the config on restart (observed live:
 * laptop baseUrl reverted to 18788 at 12:55Z). The gateway must therefore
 * always reach 18788 — and 18788 must be OUR proxy, which sanitizes tool
 * JSON-schema `pattern`s that llama.cpp rejects (e.g. bare `\S` in the cron
 * tool's job.declarationKey) before forwarding to the real engine.
 */
export const LOCAL_ENGINE_BACKEND_PORT = 18792
const PROXY_HEALTH_PATH = '/__proxy__/health'

export interface LocalModelPreset {
  id: string
  name: string
  fileName: string
  url: string
  sizeBytes: number
  description: string
  /** Overrides the default `compat.supportsTools: false` for this preset. */
  supportsTools?: boolean
  /** Fallback download URL (e.g. hf-mirror.com) tried after the primary fails. */
  mirrorUrl?: string
}

/**
 * Preinstalled GGUF pick — one model: Gemma4 v2 (Merged, 12B-class, Q4_K_M).
 * Tool calling enabled. Custom GGUF downloads (own URL / file from disk)
 * remain available in the picker.
 */
export const LOCAL_MODEL_PRESETS: LocalModelPreset[] = [
  {
    id: 'gemma4-v2',
    name: 'Gemma 4 v2 (Q4_K_M)',
    fileName: 'gemma4-v2-Q4_K_M.gguf',
    url: 'https://huggingface.co/yuxinlu1/gemma-4-12B-agentic-fable5-composer2.5-v2-3.5x-tau2-GGUF/resolve/main/gemma4-v2-Q4_K_M.gguf?download=true',
    // huggingface.co is blocked for many Russian ISPs — fall back to the
    // hf-mirror.com CDN (same files, reachable from RU without a VPN).
    mirrorUrl:
      'https://hf-mirror.com/yuxinlu1/gemma-4-12B-agentic-fable5-composer2.5-v2-3.5x-tau2-GGUF/resolve/main/gemma4-v2-Q4_K_M.gguf?download=true',
    sizeBytes: 7_381_381_664,
    description: '~6.9 GB · best quality, tool calling enabled',
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
// v0.8.22: serializes concurrent startLocalEngine calls (app-launch pre-start
// + post-window auto-start raced and spawned TWO llama-server processes;
// Windows allows the double-bind on 18792 and both loaded the model — on a
// 16 GB laptop that is a pagefile death spiral).
let engineStartPromise: Promise<LocalEngineState> | null = null
let engineWatchdogStarted = false

function ensureEngineWatchdog(): void {
  if (engineWatchdogStarted) return
  engineWatchdogStarted = true
  setInterval(() => {
    if (!engineState.running) return
    void waitForHealth(LOCAL_ENGINE_BACKEND_PORT, 3000).then((up) => {
      if (!up && engineState.running) {
        logWarn(
          `[local-engine] watchdog: engine stopped responding on ${LOCAL_ENGINE_BACKEND_PORT} — marking stopped`,
        )
        engineChild = null
        engineState = {
          running: false,
          port: LOCAL_ENGINE_PORT,
          modelId: null,
        }
      }
    })
  }, 30_000)
}

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

const resolveCanonicalModelId = (raw: string): string => {
  const catalog = listLocalModels()
  if (catalog.some((m) => m.id === raw)) return raw
  // file name without .gguf, e.g. gemma4-v2-Q4_K_M → preset id gemma4-v2
  const byFile = catalog.find((m) => m.fileName.replace(/\.gguf$/i, '') === raw)
  if (byFile) return byFile.id
  // normalized lowercase comparison
  const needle = raw.toLowerCase()
  const byName = catalog.find((m) => m.id.toLowerCase() === needle)
  return byName?.id ?? raw
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
  timeoutMs = 30_000,
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
          httpGetFollowRedirect(next, redirectsLeft - 1, timeoutMs)
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
    // v0.8.30: never hang silently on a stalled connection (seen with
    // api.github.com / huggingface.co from RU networks). Destroy the socket
    // so the caller can fall back or surface a real error.
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs / 1000}s: ${url}`))
    })
  })
}

/**
 * v0.8.31: stream a download to disk with a size guard. `out.on('close')`
 * alone is not enough — an aborted connection can close the stream WITHOUT
 * emitting an error, leaving a truncated file that is then treated as a
 * successful download (observed live: CUDA runtime zip cut mid-transfer
 * "installed" fine, then Expand-Archive produced garbage or nothing).
 * Resolve only when every expected byte arrived; otherwise delete the
 * partial file and reject.
 */
function pipeToFileWithSizeGuard(
  res: http.IncomingMessage,
  out: fs.WriteStream,
  expectedTotal: number,
  onProgress: (received: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let received = 0
    let settled = false
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      try {
        out.destroy()
      } catch {
        /* ignore */
      }
      reject(err)
    }
    res.on('data', (c: Buffer) => {
      received += c.length
      onProgress(received)
    })
    res.on('error', fail)
    out.on('error', fail)
    out.on('close', () => {
      if (settled) return
      if (expectedTotal > 0 && received < expectedTotal) {
        fail(
          new Error(
            `Download incomplete: ${received} of ${expectedTotal} bytes (connection dropped)`,
          ),
        )
        return
      }
      settled = true
      resolve()
    })
    res.pipe(out)
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
    // huggingface.co is unreachable from many RU networks (Roskomnadzor
    // block) — fall back to the hf-mirror.com CDN on any failure. The
    // primary URL is still tried first because it is the canonical source.
    const candidates = [preset.url, preset.mirrorUrl].filter(
      (u): u is string => Boolean(u),
    )
    let lastErr: unknown = null
    let downloaded = false
    for (const candidate of candidates) {
      if (handle.cancelled) break
      try {
        const { res } = await httpGetFollowRedirect(candidate, 5, 45_000)
        const total = Number(
          res.headers['content-length'] ?? preset.sizeBytes,
        )
        const out = fs.createWriteStream(part)
        handle.req = res as unknown as import('node:http').ClientRequest
        await pipeToFileWithSizeGuard(res, out, total, (received) => {
          if (handle.cancelled) return
          emitProgress({
            modelId,
            fileName: preset.fileName,
            received,
            total,
            progress: Math.min(1, received / total),
            stage: 'downloading',
          })
        })
        if (handle.cancelled) {
          throw new Error('Download cancelled')
        }
        downloaded = true
        break
      } catch (err) {
        lastErr = err
        try {
          if (fs.existsSync(part)) fs.unlinkSync(part)
        } catch {
          /* ignore */
        }
        logWarn(
          `[local-engine] download from ${candidate} failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    if (!downloaded) {
      throw lastErr ?? new Error('Download failed')
    }
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
    // Russian users hitting the HF block get an actionable hint instead of a
    // bare network error.
    const message =
      err instanceof Error ? err.message : String(err)
    throw new Error(
      `${message} — if you are in Russia, huggingface.co is blocked: enable a VPN or add the model via a custom URL (e.g. hf-mirror.com).`,
    )
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

const LLAMA_RELEASES_URL =
  'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20'
// Fallback when api.github.com is unreachable (common from RU networks): a
// known-good recent build tag + deterministic asset names. The names follow
// llama.cpp's stable `llama-<tag>-bin-win-<variant>-x64.zip` convention.
const LLAMA_FALLBACK_TAG = 'b10593'
const LLAMA_FALLBACK_ASSETS = [
  `${'llama'}-${LLAMA_FALLBACK_TAG}-bin-win-cpu-x64.zip`,
  `${'llama'}-${LLAMA_FALLBACK_TAG}-bin-win-cuda-12.4-x64.zip`,
  `${'llama'}-${LLAMA_FALLBACK_TAG}-bin-win-vulkan-x64.zip`,
]

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
  // Do NOT trust the WMI/CIM GPU probe alone: on machines where the CIM
  // provider is broken (observed on Damir's laptop) detectGpu() reports
  // "none" even with an NVIDIA GPU present, silently downgrading to the slow
  // CPU build. If a CUDA build is already on disk, prefer trying it — the
  // spawn path falls back to CPU if it does not become healthy.
  if (gpu.vendor === 'nvidia') return 'cuda'
  if (gpu.vendor === 'amd') return 'vulkan'
  if (gpu.vendor === 'intel') {
    // Intel iGPU: try Vulkan if the build exists, else CPU.
    if (getEngineServerPath('vulkan')) return 'vulkan'
    return 'cpu'
  }
  if (getEngineServerPath('cuda')) return 'cuda'
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
  // llama.cpp publishes its Windows binaries on per-build releases
  // (b<number>, e.g. b10593), all marked as prerelease. GitHub's
  // /releases/latest endpoint therefore resolves to the stable "v0.2.0"
  // marker release which carries NO binaries — only a nightly-tag.txt file.
  // Iterate the recent releases and pick the newest one that actually ships
  // `llama-<tag>-*` assets.
  try {
    const { res } = await httpGetFollowRedirect(LLAMA_RELEASES_URL, 3, 15_000)
    let body = ''
    for await (const chunk of res) {
      body += chunk
    }
    const releases = JSON.parse(body) as Array<{
      tag_name?: string
      assets?: { name?: string }[]
    }>
    for (const release of releases) {
      const tag = release.tag_name
      if (!tag) continue
      const assets = (release.assets ?? [])
        .map((a) => a.name ?? '')
        .filter((n) => n.startsWith(`llama-${tag}-`))
      if (assets.length > 0) {
        cachedLlamaRelease = {
          tag,
          assets,
        }
        return cachedLlamaRelease
      }
    }
  } catch (err) {
    logWarn(
      `[local-engine] could not resolve llama.cpp release from GitHub API (${err instanceof Error ? err.message : String(err)}) — using fallback tag ${LLAMA_FALLBACK_TAG}`,
    )
  }
  cachedLlamaRelease = {
    tag: LLAMA_FALLBACK_TAG,
    assets: [...LLAMA_FALLBACK_ASSETS],
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
  if (existing) {
    // v0.8.23: the CUDA build may be on disk WITHOUT its runtime DLLs (a
    // previous run downloaded the engine but the runtime asset 404'd on our
    // release). Without cudart/cublas the GPU binary dies on start and we
    // silently fall back to the slow CPU build. Top up the DLLs first.
    if (variant === 'cuda') {
      await ensureCudaRuntime(path.dirname(existing)).catch((err) => {
        logInfo(
          `[local-engine] CUDA runtime top-up failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      })
    }
    return existing
  }
  if (process.platform !== 'win32') {
    throw new Error(
      'Local engine is currently available on Windows only. Downloads still work on other platforms.',
    )
  }
  const dir = path.join(engineDir(), variant)
  fs.mkdirSync(dir, { recursive: true })
  logInfo(
    `[local-engine] ${variant} engine binary missing — downloading llama.cpp release…`,
  )
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
  // v0.8.31: 2 minutes of inactivity for multi-hundred-MB archives; the old
  // 30 s default killed transfers on slow RU links. The size guard in
  // pipeToFileWithSizeGuard catches mid-transfer drops that would otherwise
  // look like a successful download.
  const { res } = await httpGetFollowRedirect(zipUrl, 5, 120_000)
  const total = Number(res.headers['content-length'] ?? 0)
  const out = fs.createWriteStream(zipPath)
  await pipeToFileWithSizeGuard(res, out, total, (received) => {
    emitProgress({
      stage: 'engine-download',
      tag,
      variant,
      received,
      total,
      progress: total ? Math.min(1, received / total) : 0,
    })
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
  const zipUrl = `https://github.com/vpromalpe-design/llama-runtime/releases/download/${CUDA_RUNTIME_TAG}/${CUDA_RUNTIME_ASSET}`
  const zipPath = path.join(dir, 'cuda-runtime.zip')
  emitProgress({
    stage: 'cuda-runtime-download',
    tag: CUDA_RUNTIME_TAG,
    variant: 'cuda',
    progress: 0,
  })
  // v0.8.31: same size-guarded download as the engine; truncated zips were
  // silently accepted before and Expand-Archive then produced "code 1".
  const { res } = await httpGetFollowRedirect(zipUrl, 5, 120_000)
  const total = Number(res.headers['content-length'] ?? 0)
  const out = fs.createWriteStream(zipPath)
  await pipeToFileWithSizeGuard(res, out, total, (received) => {
    emitProgress({
      stage: 'cuda-runtime-download',
      tag: CUDA_RUNTIME_TAG,
      variant: 'cuda',
      received,
      total,
      progress: total ? Math.min(1, received / total) : 0,
    })
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
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    let stdout = ''
    ps.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')))
    ps.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
    ps.on('error', reject)
    ps.on('exit', (code) => {
      if (code === 0) resolve()
      else {
        // v0.8.31: surface the real PowerShell error text — "code 1" alone
        // is useless for remote debugging (truncated zip, locked file, AV).
        // BUG-3: strip CLIXML progress noise (`#< CLIXML ... >`) and ANSI/
        // progress percent lines so the log shows a readable error, not
        // mojibake garbage.
        const detail = [stderr, stdout]
          .filter(Boolean)
          .map((s) =>
            s
              .split(/\r?\n/)
              .filter((line) => {
                const t = line.trim()
                if (!t) return false
                if (t.startsWith('#< CLIXML')) return false
                // progress lines like `[1/3] Скачивание…` / trailing percents
                if (t.includes('[') && t.includes(']') && /[\u0080-\uFFFF]/.test(t)) return false
                if (/\d+\s*%\s*$/.test(t) && !t.includes('Error')) return false
                return true
              })
              .join(' | '),
          )
          .filter(Boolean)
          .join(' | ')
        reject(
          new Error(
            `Expand-Archive failed with code ${code}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
          ),
        )
      }
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
      const req = http.get(
        `http://127.0.0.1:${port}/health`,
        { timeout: 2000 },
        (res) => {
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
        },
      )
      // v0.8.25: `timeout` option alone does NOT settle the request — without
      // a 'timeout' listener the socket is never destroyed and the promise
      // hangs forever on an accept-but-stall server (e.g. an orphan llama-server
      // still loading). Destroying here fires 'error' (ECONNRESET), which the
      // handler below turns into a retry — so the deadline is actually enforced.
      req.on('error', () => setTimeout(tryOnce, 1500))
      req.on('timeout', () => req.destroy())
    }
    tryOnce()
  })
}

/**
 * v0.8.20: prove the engine actually completes a chat completion, not just
 * that /health reports ok. A wedged slot (from an un-cancelled stream)
 * leaves /health green while every chat request queues forever.
 */
function verifyEngineResponds(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
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
        timeout: 30_000,
      },
      (res) => {
        let data = ''
        res.on('data', (c: Buffer) => (data += c))
        res.on('end', () => {
          try {
            const j = JSON.parse(data) as {
              choices?: Array<{ message?: unknown }>
            }
            resolve(!!(j.choices && j.choices[0] && j.choices[0].message))
          } catch {
            resolve(false)
          }
        })
      },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end(body)
  })
}

/**
 * v0.8.18: raw TCP probe — does anything accept connections on the port?
 * Used to detect an engine that is already bound (and possibly still
 * loading the model, so /health is not OK yet) before we decide to spawn.
 */
function canConnectTcp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => {
      socket.destroy()
      resolve(false)
    })
    socket.setTimeout(1500, () => {
      socket.destroy()
      resolve(true) // accepts connections but stalls — still occupied
    })
  })
}

function fetchLoadedModelId(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/v1/models`,
      { timeout: 3000 },
      (res) => {
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
      },
    )
    // v0.8.25: without a 'timeout' listener the request never settles (see
    // waitForHealth). destroy() → 'error' → resolve(null) instead of a hang.
    req.on('error', () => resolve(null))
    req.on('timeout', () => req.destroy())
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
 * Count the processes LISTENING on a TCP port (Windows, via netstat).
 * More than one means a double-bind (llama-server on Windows tolerates it).
 */
async function countListenersOnPort(port: number): Promise<number> {
  try {
    const { stdout } = await exec(
      `netstat -ano | findstr ":${port} " | findstr "LISTENING"`,
      { windowsHide: true, timeout: 8000 },
    )
    if (!stdout) return 0
    const pids = new Set<string>()
    for (const line of stdout.split(/\r?\n/)) {
      const tok = line.trim().split(/\s+/).pop()
      if (tok && /^\d+$/.test(tok)) pids.add(tok)
    }
    return pids.size
  } catch {
    return 0
  }
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

// ─── Built-in schema-fix proxy (v0.8.17) ──────────────────────────────────────
//
// llama.cpp's JSON-schema→grammar converter (build 10514) rejects several
// constructs that OpenClaw's tool schemas legitimately contain:
//   * Nested `pattern`s must be anchored (`^…$`) — a bare `\S` (cron tool's
//     job.declarationKey) yields HTTP 400 "JSON schema conversion failed:
//     Pattern must start with '^' and end with '$'".
//   * Shorthand character classes (`\S \s \d \D \w \W`) fail even when
//     anchored; only explicit char classes are accepted.
// The proxy rewrites every `pattern` string in POST /v1/chat/completions
// bodies (shorthand → char class, unanchored → wrapped in ^(?:…)$) and
// forwards everything else transparently. Health/model probes used by the
// adoption logic talk to the backend port directly.

let schemaFixProxy: http.Server | null = null

/** Replace shorthand classes and anchor unanchored patterns (verified on live engine). */
function fixToolPattern(pattern: string): string {
  let out = pattern
    .replace(/\\S/g, '[^ \\t\\r\\n]')
    .replace(/\\s/g, '[ \\t\\r\\n]')
    .replace(/\\d/g, '[0-9]')
    .replace(/\\D/g, '[^0-9]')
    .replace(/\\w/g, '[A-Za-z0-9_]')
    .replace(/\\W/g, '[^A-Za-z0-9_]')
  if (!out.startsWith('^') || !out.endsWith('$')) {
    out = `^(?:${out})$`
  }
  return out
}

/** Recursively rewrite `pattern` strings inside a JSON-schema (tools payload). */
function sanitizeToolsSchema(node: unknown, changed: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) sanitizeToolsSchema(item, changed)
    return
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'pattern' && typeof value === 'string') {
        const fixed = fixToolPattern(value)
        if (fixed !== value) {
          ;(node as Record<string, unknown>)[key] = fixed
          changed.push(`${value} -> ${fixed}`)
        }
      } else {
        sanitizeToolsSchema(value, changed)
      }
    }
  }
}

/** True when OUR proxy already owns LOCAL_ENGINE_PORT. */
function isSchemaFixProxyUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${LOCAL_ENGINE_PORT}${PROXY_HEALTH_PATH}`,
      { timeout: 1500 },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode === 200))
      },
    )
    // v0.8.25: timeout listener required — destroy() → 'error' → resolve(false)
    // (otherwise an accept-but-stall listener on the port hangs forever).
    req.on('error', () => resolve(false))
    req.on('timeout', () => req.destroy())
  })
}

/** Start the schema-fix proxy on LOCAL_ENGINE_PORT (throws on EADDRINUSE). */
async function startSchemaFixProxy(): Promise<void> {
  if (schemaFixProxy) return
  const server = http.createServer((req, res) => {
    // Liveness marker for the adoption logic.
    if (req.method === 'GET' && (req.url ?? '').startsWith(PROXY_HEALTH_PATH)) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      let body = Buffer.concat(chunks)
      const changed: string[] = []
      if (
        req.method === 'POST' &&
        (req.url ?? '').includes('/chat/completions') &&
        body.length > 0
      ) {
        try {
          const json = JSON.parse(body.toString('utf8')) as unknown
          if (json && typeof json === 'object') {
            sanitizeToolsSchema(json, changed)
            if (changed.length > 0) {
              body = Buffer.from(JSON.stringify(json), 'utf8')
              logInfo(
                `[local-engine] proxy patched ${changed.length} pattern(s): ${changed.join('; ')}`,
              )
            }
          }
        } catch {
          /* pass through unparseable bodies unchanged */
        }
      }
      const headers = { ...req.headers }
      delete headers.host
      headers['content-length'] = String(body.length)
      const upstream = http.request(
        {
          host: '127.0.0.1',
          port: LOCAL_ENGINE_BACKEND_PORT,
          path: req.url ?? '/',
          method: req.method ?? 'GET',
          headers,
        },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers)
          up.pipe(res)
        },
      )
      upstream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'local engine unreachable' } }))
        } else {
          res.destroy()
        }
      })
      upstream.end(body)
      // Forward client aborts to the engine: otherwise a timed-out request
      // keeps llama-server's slot busy forever and every later request queues
      // behind it (the "model stopped answering" symptom). NB: in Node the
      // IncomingMessage 'close' event fires as soon as the request body has
      // been fully received — NOT only on abort — so v0.8.20's
      // `req.on('close') -> destroy` killed every proxied request with 502
      // "local engine unreachable". Correct abort detection:
      //  - req 'close' && !req.complete          -> client died mid-request
      //  - res 'close' && !res.writableEnded     -> client died awaiting reply
      req.on('close', () => {
        if (!req.complete) upstream.destroy()
      })
      res.on('close', () => {
        if (!res.writableEnded) upstream.destroy()
      })
    })
    req.on('error', () => res.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(LOCAL_ENGINE_PORT, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  schemaFixProxy = server
  logInfo(
    `[local-engine] schema-fix proxy listening on ${LOCAL_ENGINE_PORT} -> backend ${LOCAL_ENGINE_BACKEND_PORT}`,
  )
}

/** Stop the schema-fix proxy (called on app quit paths). */
export function stopSchemaFixProxy(): void {
  if (schemaFixProxy) {
    try {
      schemaFixProxy.close()
    } catch {
      /* ignore */
    }
    schemaFixProxy = null
  }
}

function fetchServerContextWindow(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/props`,
      { timeout: 3000 },
      (res) => {
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
      },
    )
    // v0.8.25: timeout listener required — destroy() → 'error' → resolve(null)
    // (otherwise a stall on /props hangs the context-window sync forever).
    req.on('error', () => resolve(null))
    req.on('timeout', () => req.destroy())
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
/**
 * Start the local GGUF engine (schema-fix proxy on 18788 + llama-server on
 * 18792). Serialized by a module-level promise: two concurrent callers (the
 * pre-gateway pre-start and the post-window auto-start on app launch) used
 * to race — both saw `engineState.running === false` and both spawned a
 * llama-server. Windows allows the double-bind on 18792, both processes
 * loaded the model into memory (~13 GB RSS each on a 16 GB laptop) and the
 * machine thrashed into the pagefile: the model "did not answer" for
 * minutes (observed twice on Damir's Legion with gemma4-v2 Q4_K_M).
 */
export function startLocalEngine(
  modelIdRaw: string,
  currentConfig: OpenClawConfig,
  writeConfig: (c: OpenClawConfig) => void,
): Promise<LocalEngineState> {
  if (engineStartPromise) return engineStartPromise
  engineStartPromise = startLocalEngineInner(modelIdRaw, currentConfig, writeConfig).finally(
    () => {
      engineStartPromise = null
    },
  )
  return engineStartPromise
}

async function startLocalEngineInner(
  modelIdRaw: string,
  currentConfig: OpenClawConfig,
  writeConfig: (c: OpenClawConfig) => void,
): Promise<LocalEngineState> {
  // The Experimental preset was merged into the base Hard model (both have
  // tool calling now); map a stale config id to the base preset.
  const modelIdRaw2 = modelIdRaw.replace(/-experimental$/, '')
  // BUG-6: the config sometimes carries a stale id derived from the GGUF file
  // name (gemma4-v2-Q4_K_M) while the catalog id is the preset id (gemma4-v2).
  // Resolve to the canonical catalog id so `primary` and the provider model id
  // stay in sync with the served model.
  const modelId = resolveCanonicalModelId(modelIdRaw2)
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
  // the backend port actually reports via /v1/models.
  const expectedModelName = path.basename(model.path)

  // v0.8.17: LOCAL_ENGINE_PORT (18788) belongs to OUR schema-fix proxy; the
  // real llama-server runs on LOCAL_ENGINE_BACKEND_PORT (18792). The gateway
  // and the config always talk to 18788, so a foreign/legacy server squatting
  // there (old app instance, manual llama-server start) must be cleared
  // before the proxy can claim the port.
  const proxyUp = await isSchemaFixProxyUp()
  if (!proxyUp) {
    const foreignUp = await waitForHealth(LOCAL_ENGINE_PORT, 3_000)
    if (foreignUp) {
      const loaded = await fetchLoadedModelId(LOCAL_ENGINE_PORT)
      logInfo(
        `[local-engine] port ${LOCAL_ENGINE_PORT} is held by a foreign server ("${loaded ?? 'unknown'}") — killing to install schema-fix proxy`,
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
          `На порту ${LOCAL_ENGINE_PORT} обнаружен чужой сервер (модель «${loaded ?? 'неизвестна'}»). Не удалось остановить его автоматически — закройте процесс вручную (Диспетчер задач) и повторите.`,
        )
      }
    }
    try {
      await startSchemaFixProxy()
    } catch (err) {
      logInfo(
        `[local-engine] proxy failed to bind ${LOCAL_ENGINE_PORT}: ${err instanceof Error ? err.message : String(err)}`,
      )
      throw new Error(
        `Порт ${LOCAL_ENGINE_PORT} занят другим процессом. Закройте его вручную (Диспетчер задач) и повторите.`,
      )
    }
  }

  // Already serving on the backend port? (e.g. started manually, or by a
  // previous app instance whose state we lost) — adopt it instead of
  // double-spawning. Adopt ONLY when it is actually serving the requested
  // model: an orphaned llama-server holding the port with a DIFFERENT model
  // would make the UI lie about what is really loaded.
  //
  // v0.8.18: an orphaned engine from a previous app instance may still be
  // LOADING the model (bound to the port but /health not OK yet). A short
  // waitForHealth would miss it and we would spawn a SECOND engine on the
  // same port — Windows allows the double-bind, both processes listen, and
  // requests randomly hit the hung/last-bound one (observed live twice:
  // two llama-server on 18792, CPU 0, empty replies). So: if the port
  // accepts TCP connections but health is not OK yet, WAIT for health
  // (up to 120s) instead of spawning.
  // v0.8.23: Windows allows a second llama-server to bind the SAME port
  // (observed live: two processes LISTENING on 18792, each loading the model
  // — pagefile death spiral on 16 GB laptops). If more than one process
  // listens on the backend port, kill them ALL and spawn fresh: adopting
  // one and leaving the other would keep 13 GB of RSS hostage.
  if ((await countListenersOnPort(LOCAL_ENGINE_BACKEND_PORT)) > 1) {
    logWarn(
      `[local-engine] ${await countListenersOnPort(LOCAL_ENGINE_BACKEND_PORT)} processes listening on ${LOCAL_ENGINE_BACKEND_PORT} (double-bind) — killing all and spawning a fresh engine`,
    )
    await killProcessOnPort(LOCAL_ENGINE_BACKEND_PORT)
    await new Promise((r) => setTimeout(r, 1500))
  }
  let backendUp = await waitForHealth(LOCAL_ENGINE_BACKEND_PORT, 3_000)
  if (!backendUp && (await canConnectTcp(LOCAL_ENGINE_BACKEND_PORT))) {
    logInfo(
      `[local-engine] backend port ${LOCAL_ENGINE_BACKEND_PORT} is occupied but not healthy yet (orphan engine still loading?) — waiting up to 120s instead of spawning a second engine`,
    )
    backendUp = await waitForHealth(LOCAL_ENGINE_BACKEND_PORT, 120_000)
  }
  if (backendUp) {
    const loaded = await fetchLoadedModelId(LOCAL_ENGINE_BACKEND_PORT)
    const matches =
      loaded != null &&
      (modelNamesMatch(loaded, modelId) ||
        modelNamesMatch(loaded, expectedModelName))
    if (matches) {
      // Adopted server may run with an arbitrary `-c`; keep the config
      // honest so we never send a prompt larger than the server's n_ctx.
      await syncLocalContextWindow(LOCAL_ENGINE_BACKEND_PORT, currentConfig, writeConfig)
      // v0.8.25: adopt paths must arm the liveness watchdog too (v0.8.23's
      // fix only covered the cold-spawn path) — otherwise a dying adopted
      // engine leaves the UI lying "running" forever.
      ensureEngineWatchdog()
      engineState = { running: true, port: LOCAL_ENGINE_PORT, modelId, adopted: true }
      return { ...engineState }
    }
    logInfo(
      `[local-engine] backend port ${LOCAL_ENGINE_BACKEND_PORT} serves "${loaded ?? 'unknown'}", expected "${expectedModelName}" — killing stale process`,
    )
    const killed = await killProcessOnPort(LOCAL_ENGINE_BACKEND_PORT)
    if (killed) {
      await new Promise((r) => setTimeout(r, 800))
    } else {
      throw new Error(
        `На порту ${LOCAL_ENGINE_BACKEND_PORT} обнаружен чужой сервер (модель «${loaded ?? 'неизвестна'}») вместо «${expectedModelName}». Не удалось остановить его автоматически — закройте процесс вручную (Диспетчер задач) и повторите.`,
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
    String(LOCAL_ENGINE_BACKEND_PORT),
    '--no-ui',
    '-c',
    '32768',
    '-ngl',
    variant === 'cpu' ? '0' : '99',
    // 32k context (q8_0 KV ≈ 3.2 GB for the 12B gemma4 model): the agent's
    // prompt (system + tools + history) reaches ~10k tokens, which fits with
    // the compaction reserve. 64k made the KV cache alone ≈ 13 GB of RSS —
    // on 16 GB laptops the engine thrashed into the pagefile and took
    // minutes to emit a first token (observed on Damir's Legion with the
    // gemma4-v2 Q4_K_M 12B model).
    '-ctk',
    'q8_0',
    '-ctv',
    'q8_0',
    // Thinking/reasoning models dump the whole reply into
    // `reasoning_content` and return an empty `content`, often burning the
    // entire token budget without ever emitting a final answer — the agent
    // then "replies" with silence. Disable reasoning at the engine level so
    // chat completions always produce a real `content`.
    '--reasoning',
    'off',
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
    return waitForHealth(LOCAL_ENGINE_BACKEND_PORT, 120_000)
  }

  // v0.8.22: re-check the port right before spawning — a foreign/manual
  // llama-server (or a second app instance) may have claimed 18792 while we
  // were resolving the engine binary. Double-binding on Windows lets both
  // processes listen and both load the model: on a 16 GB laptop that is a
  // pagefile death spiral. Adopt (or kill the stale process) instead.
  if (await canConnectTcp(LOCAL_ENGINE_BACKEND_PORT)) {
    const healthy = await waitForHealth(LOCAL_ENGINE_BACKEND_PORT, 120_000)
    if (healthy) {
      const loaded = await fetchLoadedModelId(LOCAL_ENGINE_BACKEND_PORT)
      const matches =
        loaded != null &&
        (modelNamesMatch(loaded, modelId) ||
          modelNamesMatch(loaded, expectedModelName))
      if (matches) {
        await syncLocalContextWindow(LOCAL_ENGINE_BACKEND_PORT, currentConfig, writeConfig)
        // v0.8.25: arm the watchdog on this pre-spawn adopt branch as well.
        ensureEngineWatchdog()
        engineState = { running: true, port: LOCAL_ENGINE_PORT, modelId, adopted: true }
        return { ...engineState }
      }
      logInfo(
        `[local-engine] pre-spawn recheck: port ${LOCAL_ENGINE_BACKEND_PORT} serves "${loaded ?? 'unknown'}", expected "${expectedModelName}" — killing stale process`,
      )
      await killProcessOnPort(LOCAL_ENGINE_BACKEND_PORT)
      await new Promise((r) => setTimeout(r, 800))
    } else {
      logInfo(
        `[local-engine] pre-spawn recheck: port ${LOCAL_ENGINE_BACKEND_PORT} occupied but never became healthy — killing stale process`,
      )
      await killProcessOnPort(LOCAL_ENGINE_BACKEND_PORT)
      await new Promise((r) => setTimeout(r, 800))
    }
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
    cpuArgs[cpuArgs.indexOf('-c') + 1] = '32768'
    ok = await spawnServer(cpuPath, cpuArgs)
  }
  if (!ok) {
    stopLocalEngine()
    throw new Error('llama-server did not become healthy within 120s')
  }
  // v0.8.20: /health says "ok" as soon as the model is loaded, but a
  // previously adopted engine may still be stuck (request slot wedged by an
  // un-cancelled stream from an earlier session). Probe the real thing: a
  // tiny chat completion must come back within 30s or we kill and respawn.
  let verified = await verifyEngineResponds(LOCAL_ENGINE_BACKEND_PORT)
  if (!verified) {
    logWarn(
      '[local-engine] engine healthy but not responding to chat — killing and respawning once',
    )
    await killProcessOnPort(LOCAL_ENGINE_BACKEND_PORT)
    await new Promise((r) => setTimeout(r, 1200))
    ok = await spawnServer(serverPath, spawnArgs)
    if (ok) {
      verified = await verifyEngineResponds(LOCAL_ENGINE_BACKEND_PORT)
    }
  }
  if (!ok || !verified) {
    stopLocalEngine()
    throw new Error('llama-server did not answer a test request within 30s')
  }
  // Register the `local` provider so the gateway can reach the engine.
  // The public baseUrl stays on LOCAL_ENGINE_PORT (18788): the schema-fix
  // proxy owns that port and forwards to the real engine, and the app
  // rewrites this exact URL into openclaw.json on every start — so the
  // proxy is always in the path, permanently fixing llama.cpp's tool-schema
  // 400s without relying on external processes or manual config edits.
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
  await syncLocalContextWindow(LOCAL_ENGINE_BACKEND_PORT, next, writeConfig)
  // v0.8.23: if the engine dies while the app is running (adopted orphan or
  // our own child crashing), /health goes dark but nothing notices: the
  // proxy keeps returning 502 "local engine unreachable" forever. Watch the
  // backend port and mark the engine stopped so the UI shows the truth and
  // the user can restart it.
  ensureEngineWatchdog()

  engineState = { running: true, port: LOCAL_ENGINE_PORT, modelId: model.id, adopted: false }
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
      // Small budgets are useless for reasoning models: they spend them all
      // on `reasoning_content` and return an empty `content` even though the
      // engine is perfectly healthy (Gemma4-v2 behaves exactly like this).
      max_tokens: 1024,
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
              choices?: Array<{
                message?: { content?: string; reasoning_content?: string }
              }>
            }
            const content = j.choices?.[0]?.message?.content?.trim?.()
            const reasoning = j.choices?.[0]?.message?.reasoning_content?.trim?.()
            const respondedModel = j.model
            if (respondedModel && !modelNamesMatch(respondedModel, modelId)) {
              // The engine is serving a different model than requested — the
              // test must report the real state of affairs.
              resolve({
                ok: false,
                retryable: false,
                message: `Движок отвечает моделью «${respondedModel}», а не «${modelId}». Остановите и подключите движок заново.`,
              })
            } else if (content || reasoning) {
              // `reasoning` alone proves the engine is generating tokens —
              // accept it so the test never cries wolf on thinking models.
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
  engineState = { running: false, port: LOCAL_ENGINE_PORT, modelId: null, adopted: false }
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
  try {
    await ensureEngineBinary(variant)
  } catch (err) {
    // Never surface raw URLs / HTTP noise in the UI — log the detail here and
    // show the user a short human-readable message instead.
    logInfo(
      `[local-engine] ${variant} engine install failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    throw new Error(
      `Failed to download the ${variant.toUpperCase()} engine. Check your internet connection and try again.`,
    )
  }
  // v0.9.3: emit the completion event only AFTER the archive is extracted AND
  // (for CUDA) the runtime DLLs are in place — the old `engine-download`
  // progress=1 fired right after the ZIP landed, so the UI showed “100 %”
  // while the install was still running (and the variant was not yet visible
  // in installedVariants).
  emitProgress({ stage: 'engine-installed', variant, progress: 1 })
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
): Promise<boolean | undefined> {
  try {
    const shellConfig = readShellConfig()
  logInfo(
    `[local-engine] starting (mode=${shellConfig.localEngineMode ?? 'auto'})…`,
  )
  if (process.platform !== 'win32') {
    logWarn('[local-engine] skipping auto-start: Windows only')
    return false
  }
  const config = readConfig()
    if (!config) return false
    sanitizeConfigPaths(config, writeConfig)
    const modelCfg = config?.agents?.defaults?.model
    const primary =
      typeof modelCfg === 'string' ? modelCfg : modelCfg?.primary
    if (!primary || !primary.startsWith('local/')) return false
    const modelId = primary.slice('local/'.length)
    logInfo(`[local-engine] auto-start model=${modelId}`)
    const state = await startLocalEngine(modelId, config, writeConfig)
    logInfo(`[local-engine] auto-start OK, engine listening on ${LOCAL_ENGINE_PORT}`)
    // true = engine was started cold (model freshly loaded into memory);
    // the first chat message will be slow — the UI shows a hint banner.
    return state.running && !state.adopted ? true : false
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
