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
  /** Experimental presets enable tool calling (may fail on llama.cpp). */
  experimental?: boolean
  /** Overrides the default `compat.supportsTools: false` for this preset. */
  supportsTools?: boolean
}

/**
 * Preinstalled GGUF picks (CPU-friendly sizes, stable URLs):
 * Normal (Qwen 3.5 4B, runs on any PC), Hard (Qwen 3.5 9B, best quality)
 * and an experimental Hard preset with tool calling enabled — llama.cpp may
 * reject OpenClaw's tool schemas, so it is opt-in and clearly labelled.
 *
 * Qwen 3.5 ships as Ollama manifests; the model layer blobs are plain GGUF
 * files, served straight from the Ollama registry (no login required).
 */
export const LOCAL_MODEL_PRESETS: LocalModelPreset[] = [
  {
    id: 'qwen3.5-4b',
    name: 'Qwen 3.5 4B (Normal)',
    fileName: 'qwen3.5-4b-instruct-q4_k_m.gguf',
    url: 'https://registry.ollama.ai/v2/library/qwen3.5/blobs/sha256:81fb60c7daa80fc1123380b98970b320ae233409f0f71a72ed7b9b0d62f40490',
    sizeBytes: 3_389_971_840,
    description: '~3.2 GB · fastest, runs on any PC',
  },
  {
    id: 'qwen3.5-9b',
    name: 'Qwen 3.5 9B (Hard)',
    fileName: 'qwen3.5-9b-instruct-q4_k_m.gguf',
    url: 'https://registry.ollama.ai/v2/library/qwen3.5/blobs/sha256:dec52a44569a2a25341c4e4d3fee25846eed4f6f0b936278e3a3c900bb99d37c',
    sizeBytes: 6_594_462_816,
    description: '~6.1 GB · best quality on CPU',
  },
  {
    id: 'qwen3.5-9b-experimental',
    name: 'Qwen 3.5 9B (Experimental)',
    fileName: 'qwen3.5-9b-instruct-q4_k_m.gguf',
    url: 'https://registry.ollama.ai/v2/library/qwen3.5/blobs/sha256:dec52a44569a2a25341c4e4d3fee25846eed4f6f0b936278e3a3c900bb99d37c',
    sizeBytes: 6_594_462_816,
    description: '~6.1 GB · same Hard model, but with tool calling enabled',
    experimental: true,
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
      // Experimental presets share the same GGUF file with the base preset,
      // but are separate model entries (they enable tool calling).
      for (const exp of LOCAL_MODEL_PRESETS.filter(
        (p) => p.fileName === f && p.experimental,
      )) {
        out.push({
          id: exp.id,
          fileName: f,
          path: full,
          sizeBytes: size,
          downloaded: true,
          status: 'ready',
          progress: 1,
        })
      }
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
  modelId: string,
  currentConfig: OpenClawConfig,
  writeConfig: (c: OpenClawConfig) => void,
): Promise<LocalEngineState> {
  if (engineState.running) {
    return { ...engineState }
  }
  // Already serving on the port? (e.g. started manually, or by a previous
  // app instance whose state we lost) — adopt it instead of double-spawning.
  const alreadyUp = await waitForHealth(LOCAL_ENGINE_PORT, 5_000)
  if (alreadyUp) {
    // Adopted server may run with an arbitrary `-c`; keep the config honest
    // so we never send a prompt larger than the server's n_ctx.
    await syncLocalContextWindow(LOCAL_ENGINE_PORT, currentConfig, writeConfig)
    engineState = { running: true, port: LOCAL_ENGINE_PORT, modelId }
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
  const serverPath = await ensureEngineBinary()

  // Register the `local` provider so the gateway can reach the engine.
  // Merge with an existing provider entry and keep the configured model id,
  // so a previously set primary (e.g. local/qwen3.5-4b) keeps resolving.
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
        id: existingModel?.id ?? model.id,
        name: existingModel?.name ?? model.id,
        // Real engine limits (-c 16384): context window + max output tokens
        // must fit inside the server's n_ctx or llama-server answers 400
        // "Context size has been exceeded" once the chat history grows.
        contextWindow: 30720,
        maxTokens: 2048,
        // llama.cpp cannot parse OpenAI tool schemas (bare `pattern` regexes
        // fail JSON-schema→grammar conversion with HTTP 400), so local GGUF
        // models run without tools by default. The Experimental preset opts
        // into tool calling (may fail on some schemas).
        compat: { supportsTools: preset?.supportsTools === true },
      },
    ],
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
      '--no-ui',
      '-c',
      '32768',
      '--log-file',
      path.join(engineDir(), 'server.log'),
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
  // Belt-and-braces: if the downloaded binary defaults to a smaller n_ctx
  // than our -c request, align the config with reality instead of failing
  // later with HTTP 400.
  await syncLocalContextWindow(LOCAL_ENGINE_PORT, next, writeConfig)
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

/**
 * Repair a corrupted `agents.defaults.workspace` in the config: when the path
 * was mangled by an ANSI read/write round-trip (e.g. editing openclaw.json
 * with PowerShell `Get-Content` without `-Encoding UTF8` — cyrillic paths
 * like `C:\Users\Дамир\...` turn into mojibake), the agent fails on every
 * message with `ENOENT: mkdir '<mojibake>'`. Detect the mojibake signature
 * and fall back to the standard workspace path.
 */
function sanitizeConfigWorkspace(
  cfg: OpenClawConfig,
  writeConfig: (c: OpenClawConfig) => void,
): void {
  const ws = cfg.agents?.defaults?.workspace
  if (typeof ws !== 'string' || ws.length === 0) return
  // Mojibake signature: cyrillic letters mixed with punctuation/currency
  // ranges that never appear in a real path (U+2018–U+2020, U+20AC).
  const mojibake =
    /[\u0400-\u045F][\u2018-\u2020\u20AC]|[\u2018-\u2020\u20AC][\u0400-\u045F]/.test(
      ws,
    )
  if (mojibake) {
    cfg.agents!.defaults!.workspace = path.join(
      os.homedir(),
      '.openclaw',
      'workspace',
    )
    writeConfig(cfg)
    return
  }
  if (!fs.existsSync(ws)) {
    // Non-existent but not mojibake (e.g. first run, folder not created yet):
    // leave it alone, the agent creates it on demand.
    return
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
    sanitizeConfigWorkspace(config, writeConfig)
    const modelCfg = config?.agents?.defaults?.model
    const primary =
      typeof modelCfg === 'string' ? modelCfg : modelCfg?.primary
    if (!primary || !primary.startsWith('local/')) return
    const modelId = primary.slice('local/'.length)
    await startLocalEngine(modelId, config, writeConfig)
  } catch {
    /* non-fatal: engine stays off, Models panel shows the error state */
  }
}

export { formatBytes }
