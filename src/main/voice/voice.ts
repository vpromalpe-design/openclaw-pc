/**
 * Voice (Этап F, v0.9.13): text-to-speech (Edge / ElevenLabs / Piper) and
 * local speech-to-text (whisper.cpp).
 *
 * Settings live in the desktop shell config (config.json), NOT openclaw.json:
 *   tts: { enabled, provider: 'edge'|'elevenlabs'|'piper', voice?, apiKey? }
 *   stt: { enabled, model: 'tiny'|'base'|'small'|'medium' }
 *
 * Agent answers are hooked in activity.ts: the gateway `chat` event with
 * `state === 'final'` carries the final assistant text, which we synthesize
 * and push to the renderer as `tts:utterance` audio for playback.
 */

import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import * as tar from 'tar'
import unbzip2Stream from 'unbzip2-stream'
import { MsEdgeTTS, OUTPUT_FORMAT, type Voice as EdgeVoice } from 'msedge-tts'
import { getUserDataDir } from '../utils/paths.js'
import { logInfo, logWarn, logError } from '../utils/logger.js'
import { readShellConfig } from '../config/shell-config.js'
import { IPC_TTS_UTTERANCE, IPC_VOICE_PROGRESS } from '../../shared/ipc-channels.js'

export type TtsProvider = 'edge' | 'elevenlabs' | 'piper'
export type WhisperModelId = 'tiny' | 'base' | 'small' | 'medium'
export type PiperVoiceKey = 'irina' | 'dmitri' | 'denis'

// ─── Paths ───────────────────────────────────────────────────────────────────

function voiceDir(): string {
  const dir = path.join(getUserDataDir(), 'voice')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function piperDir(): string {
  return path.join(voiceDir(), 'piper')
}

function whisperDir(): string {
  return path.join(voiceDir(), 'whisper')
}

function findFileRecursive(dir: string, name: string): string | null {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, name)
      if (found) return found
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full
    }
  }
  return null
}

function piperExe(): string {
  const found = findFileRecursive(piperDir(), 'sherpa-onnx-offline-tts.exe')
  return found ?? path.join(piperDir(), 'engine', 'sherpa-onnx-offline-tts.exe')
}

/**
 * sherpa-onnx converts its argv to ANSI on Windows, so it CANNOT open files
 * whose paths contain non-ASCII characters (e.g. C:\Users\Дамир\... becomes
 * C:\Users\???\... and the model "does not exist"). We expose the real piper
 * dir through an ASCII junction (no admin rights needed) so every path passed
 * to the engine (model, tokens, espeak-ng-data, output wav) stays ASCII.
 * Falls back to the real dir if no junction can be created.
 */
function piperAsciiDir(): string {
  const real = piperDir()
  const candidates = [
    path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'OpenClawPC-piper'),
    path.join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'OpenClawPC-piper'),
  ]
  for (const link of candidates) {
    try {
      if (fs.existsSync(link)) {
        const st = fs.lstatSync(link)
        if (st.isSymbolicLink()) {
          const target = fs.readlinkSync(link)
          if (target.toLowerCase() === real.toLowerCase() && fs.existsSync(path.join(link, 'models'))) {
            return link
          }
          // Stale junction (userData moved) — remove and recreate below.
          fs.rmSync(link, { recursive: true, force: true })
        } else {
          // A real directory occupies the path — don't touch it.
          return real
        }
      }
      fs.mkdirSync(path.dirname(link), { recursive: true })
      fs.symlinkSync(real, link, 'junction')
      if (fs.existsSync(path.join(link, 'models'))) return link
    } catch {
      /* try next candidate */
    }
  }
  return real
}

function whisperExe(): string {
  // whisper-bin-x64.zip layout changed between releases (whisper-bin-x64/ in
  // older tags, Release/ in v1.7.6+) — locate the exe wherever it landed.
  const found = findFileRecursive(whisperDir(), 'whisper-cli.exe')
  return found ?? path.join(whisperDir(), 'whisper-bin-x64', 'whisper-cli.exe')
}

// ─── Download helpers (same pattern as local-engine) ─────────────────────────

function httpGetFollowRedirect(
  url: string,
  redirectsLeft = 5,
  timeoutMs = 30_000,
): Promise<{ res: http.IncomingMessage; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(
      url,
      { headers: { 'user-agent': 'OpenClaw-PC/0.9.13' } },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume()
          const next = new URL(res.headers.location, url).toString()
          resolve(httpGetFollowRedirect(next, redirectsLeft - 1, timeoutMs))
          return
        }
        if (status !== 200) {
          res.resume()
          reject(new Error(`HTTP ${status} for ${url}`))
          return
        }
        resolve({ res, finalUrl: url })
      },
    )
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)))
    req.on('error', reject)
  })
}

function pipeToFileWithSizeGuard(
  res: http.IncomingMessage,
  out: fs.WriteStream,
  total: number,
  onProgress: (received: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let received = 0
    res.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (total > 0 && received > total) {
        res.destroy(new Error(`size guard exceeded: got ${received} > ${total}`))
        return
      }
      onProgress(received)
    })
    res.pipe(out)
    out.on('finish', resolve)
    out.on('error', reject)
    res.on('error', (err) => {
      out.destroy()
      reject(err)
    })
  })
}

interface DownloadSpec {
  url: string
  mirrorUrl?: string
  fileName: string
  total?: number
}

async function downloadWithFallback(
  spec: DownloadSpec,
  onProgress: (progress: number) => void,
): Promise<string> {
  const dir = voiceDir()
  const target = path.join(dir, spec.fileName)
  const part = `${target}.part`
  const candidates = [spec.url, spec.mirrorUrl].filter((u): u is string => Boolean(u))
  let lastErr: unknown = null
  for (const candidate of candidates) {
    try {
      const { res } = await httpGetFollowRedirect(candidate, 5, 45_000)
      const total = Number(res.headers['content-length'] ?? spec.total ?? 0)
      const out = fs.createWriteStream(part)
      await pipeToFileWithSizeGuard(res, out, total, (received) => {
        onProgress(total > 0 ? Math.min(1, received / total) : 0)
      })
      fs.renameSync(part, target)
      return target
    } catch (err) {
      lastErr = err
      try {
        if (fs.existsSync(part)) fs.unlinkSync(part)
      } catch {
        /* ignore */
      }
      logWarn(`[voice] download from ${candidate} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw lastErr ?? new Error('Download failed')
}

function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script =
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' ` +
      `-DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    ps.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
    ps.on('error', reject)
    ps.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Expand-Archive failed with code ${code}${stderr ? `: ${stderr.slice(0, 300)}` : ''}`))
    })
  })
}

// ─── Progress broadcasting ───────────────────────────────────────────────────

export interface VoiceProgress {
  scope: 'tts' | 'stt'
  stage: 'downloading' | 'extracting' | 'done' | 'error'
  component: string
  progress: number
  error?: string
}

export function setVoiceProgressHandler(
  fn: ((channel: string, ...args: unknown[]) => void) | null,
): void {
  sendProgress = fn
}

let sendProgress: ((channel: string, ...args: unknown[]) => void) | null = null

function emitProgress(payload: VoiceProgress): void {
  if (sendProgress) sendProgress(IPC_VOICE_PROGRESS, payload)
  else {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC_VOICE_PROGRESS, payload)
    }
  }
}

// ─── Piper (local, offline) — движок sherpa-onnx (k2-fsa) ───────────────────
// piper 2023.11.14-2 крашится на Windows 11 Build 26200 (0xC0000409, ucrtbase.dll,
// OHF-Voice/piper1-gpl #260) → заменён на sherpa-onnx-offline-tts (совместим).

export const PIPER_VOICES: Record<PiperVoiceKey, { name: string; modelFile: string; tokensFile: string }> = {
  irina: { name: 'Ирина (женский)', modelFile: 'ru_RU-irina-medium.onnx', tokensFile: 'tokens.txt' },
  dmitri: { name: 'Дмитрий (мужской)', modelFile: 'ru_RU-dmitri-medium.onnx', tokensFile: 'tokens.txt' },
  denis: { name: 'Денис (мужской)', modelFile: 'ru_RU-denis-medium.onnx', tokensFile: 'tokens.txt' },
}

const SHERPA_ONNX_VERSION = 'v1.13.6'
const SHERPA_BINARY_URL =
  `https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_ONNX_VERSION}/` +
  `sherpa-onnx-${SHERPA_ONNX_VERSION}-win-x64-shared-MD-Release.tar.bz2`

// Native N-API addon (sherpa-onnx-node JS wrapper + sherpa-onnx-win-x64 binary).
// The CLI accepts text only as an argv argument, and Windows CRT converts argv
// to the ANSI codepage (cp1251), so Cyrillic arrives as garbage. The addon
// takes text through its JS API (UTF-8), so we synthesize in a separate
// bundled node.exe process (the addon cannot run inside Electron: Electron
// forbids napi_create_external_buffer, which the addon uses for audio output).
// Node 22 ABI (bundled resources/node/node.exe = v22.23.2, modules 127) is
// compatible with the prebuilt sherpa-onnx.node (pure N-API).
const SHERPA_NODE_JS_URL = `https://registry.npmjs.org/sherpa-onnx-node/-/sherpa-onnx-node-1.13.6.tgz`
const SHERPA_NODE_BIN_URL = `https://registry.npmjs.org/sherpa-onnx-win-x64/-/sherpa-onnx-win-x64-1.13.6.tgz`

function nodeAddonDir(): string {
  return path.join(piperDir(), 'node-addon')
}

/** Bundled Node.js used by the engine runtime (resources/node/node.exe, v22). */
function bundledNodeExe(): string {
  // Production layout: <install>/resources/app.asar + <install>/resources/node/node.exe
  const candidate = path.join(path.dirname(app.getAppPath()), 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  if (fs.existsSync(candidate)) return candidate
  return process.env.OPENCLAW_NODE || 'node'
}

/** Extract a .tgz (gzip) archive into destDir (pure-JS, works in electron main). */
async function extractTgz(archivePath: string, destDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const extractor = tar.x({ cwd: destDir, strict: true })
    const gunzip = zlib.createGunzip()
    createReadStream(archivePath)
      .pipe(gunzip)
      .on('error', reject)
      .pipe(extractor)
      .on('error', reject)
      .on('finish', resolve)
  })
}

/**
 * Standalone synthesis worker, written to node-addon/tts-worker.js at install
 * time and executed by the bundled node.exe (NOT inside Electron, see above).
 * argv[2] = base64url(JSON): { addonDir, model, tokens, dataDir, text, outWav, numThreads }
 */
const TTS_WORKER_SOURCE = `// sherpa-onnx TTS worker (runs under bundled node.exe, NOT inside Electron)
'use strict'
const fs = require('node:fs')
const path = require('node:path')
function fail(msg) {
  try { fs.writeFileSync(process.env.TTS_WORKER_ERR || path.join(require('node:os').tmpdir(), 'tts-worker-error.txt'), String(msg)) } catch {}
  console.error('TTS_WORKER_ERROR:', msg)
  process.exit(1)
}
let payload
 try {
  payload = JSON.parse(Buffer.from(process.argv[2] || '', 'base64url').toString('utf8'))
} catch (e) { return fail('bad payload: ' + e.message) }
try {
  const sherpa = require(path.join(payload.addonDir, 'sherpa-onnx.js'))
  const tts = new sherpa.OfflineTts({
    model: {
      vits: { model: payload.model, tokens: payload.tokens, dataDir: payload.dataDir },
      debug: false,
      numThreads: payload.numThreads || 2,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  })
  const genCfg = new sherpa.GenerationConfig({ sid: 0, speed: 1.0, silenceScale: 0.2 })
  const audio = tts.generate({ text: payload.text, generationConfig: genCfg })
  if (!audio || !audio.samples || !audio.samples.length) return fail('no audio generated')
  sherpa.writeWave(payload.outWav, { samples: audio.samples, sampleRate: audio.sampleRate })
  console.log('TTS_WORKER_OK', audio.sampleRate, audio.samples.length)
  process.exit(0)
} catch (e) {
  return fail((e && e.stack) || String(e))
}
`

function sherpaModelUrl(voice: PiperVoiceKey): string {
  return `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-ru_RU-${voice}-medium-int8.tar.bz2`
}

/** Extract a .tar.bz2 archive into destDir (pure-JS, works in electron main). */
async function extractTarBz2(archivePath: string, destDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const extractor = tar.x({ cwd: destDir, strict: true })
    createReadStream(archivePath)
      .pipe(unbzip2Stream())
      .on('error', reject)
      .pipe(extractor)
      .on('error', reject)
      .on('finish', resolve)
  })
}

/** Recursive directory copy via copyFileSync — safe with non-ASCII paths on Windows. */
function copyDirSync(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) copyDirSync(s, d)
    else fs.copyFileSync(s, d)
  }
}

/**
 * Move a file/dir, falling back to copy+remove. fs.cpSync is NOT used:
 * it crashes / throws EIO with non-ASCII paths on Windows (observed on
 * C:\Users\<Кириллица>\... with both node.exe and the Electron runtime).
 */
function moveEntrySync(from: string, to: string): void {
  try {
    if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true })
    fs.renameSync(from, to)
    return
  } catch {
    /* fall through to copy+remove */
  }
  const st = fs.lstatSync(from)
  if (st.isDirectory()) copyDirSync(from, to)
  else fs.copyFileSync(from, to)
  fs.rmSync(from, { recursive: true, force: true })
}

export function piperStatus(): { installed: boolean; voiceInstalled: boolean } {
  // "installed" now also requires the native addon (engine + addon + worker),
  // otherwise the UI shows the Install button and installPiper fills the gap.
  const installed =
    fs.existsSync(piperExe()) &&
    fs.existsSync(path.join(nodeAddonDir(), 'sherpa-onnx.js')) &&
    fs.existsSync(path.join(nodeAddonDir(), 'sherpa-onnx.node')) &&
    fs.existsSync(path.join(nodeAddonDir(), 'tts-worker.js'))
  const voiceInstalled = Object.keys(PIPER_VOICES).some((k) =>
    fs.existsSync(path.join(piperDir(), 'models', k, PIPER_VOICES[k as PiperVoiceKey].modelFile)),
  )
  return { installed, voiceInstalled }
}

export async function installPiper(onProgress?: (p: VoiceProgress) => void): Promise<void> {
  const dir = piperDir()
  fs.mkdirSync(dir, { recursive: true })
  const cb = onProgress ?? emitProgress
  try {
    // 1) Engine (sherpa-onnx-offline-tts.exe). Skip if already installed.
    if (!fs.existsSync(piperExe())) {
      // Remove legacy rhasspy piper leftovers (broken on Win11 26200).
      for (const legacy of [path.join(dir, 'piper'), path.join(dir, 'piper_windows_amd64.zip')]) {
        try {
          if (fs.existsSync(legacy)) fs.rmSync(legacy, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
      cb({ scope: 'tts', stage: 'downloading', component: 'sherpa-onnx', progress: 0 })
      const archive = await downloadWithFallback(
        { url: SHERPA_BINARY_URL, fileName: 'sherpa-onnx.tar.bz2' },
        (progress) => cb({ scope: 'tts', stage: 'downloading', component: 'sherpa-onnx', progress }),
      )
      cb({ scope: 'tts', stage: 'extracting', component: 'sherpa-onnx', progress: 1 })
      const engineDir = path.join(dir, 'engine')
      fs.mkdirSync(engineDir, { recursive: true })
      await extractTarBz2(archive, engineDir)
      try {
        fs.unlinkSync(archive)
      } catch {
        /* ignore */
      }
      if (!fs.existsSync(piperExe())) {
        throw new Error('sherpa-onnx-offline-tts.exe not found after extraction')
      }
    }

    // Remove stale top-level model files from the old layout (models/<file>.onnx).
    const modelsDir = path.join(dir, 'models')
    if (fs.existsSync(modelsDir)) {
      for (const entry of fs.readdirSync(modelsDir)) {
        const full = path.join(modelsDir, entry)
        if (!fs.statSync(full).isDirectory()) {
          try {
            fs.unlinkSync(full)
          } catch {
            /* ignore */
          }
        }
      }
    }

    // 2) Native N-API addon (JS wrapper + binary + worker). Needed for correct
    //    UTF-8 synthesis — the CLI mangles Cyrillic argv on Windows.
    const addonDir = nodeAddonDir()
    if (!fs.existsSync(path.join(addonDir, 'sherpa-onnx.js')) || !fs.existsSync(path.join(addonDir, 'sherpa-onnx.node'))) {
      fs.mkdirSync(addonDir, { recursive: true })
      for (const [label, url, fileName] of [
        ['sherpa-onnx-node (JS wrapper)', SHERPA_NODE_JS_URL, 'sherpa-onnx-node.tgz'],
        ['sherpa-onnx-win-x64 (binary)', SHERPA_NODE_BIN_URL, 'sherpa-onnx-win-x64.tgz'],
      ]) {
        cb({ scope: 'tts', stage: 'downloading', component: 'sherpa-node-addon', progress: 0 })
        logInfo(`[voice] installPiper: downloading ${label}...`)
        const archive = await downloadWithFallback(
          { url, fileName },
          (progress) => cb({ scope: 'tts', stage: 'downloading', component: 'sherpa-node-addon', progress }),
        )
        cb({ scope: 'tts', stage: 'extracting', component: 'sherpa-node-addon', progress: 1 })
        await extractTgz(archive, addonDir)
        try {
          fs.unlinkSync(archive)
        } catch {
          /* ignore */
        }
        // npm tarballs contain a top-level package/ folder; move contents up.
        const pkgDir = path.join(addonDir, 'package')
        if (fs.existsSync(pkgDir)) {
          for (const entry of fs.readdirSync(pkgDir)) {
            moveEntrySync(path.join(pkgDir, entry), path.join(addonDir, entry))
          }
          try {
            fs.rmSync(pkgDir, { recursive: true, force: true })
          } catch {
            /* ignore */
          }
        }
      }
      const workerPath = path.join(addonDir, 'tts-worker.js')
      if (!fs.existsSync(workerPath)) {
        fs.writeFileSync(workerPath, TTS_WORKER_SOURCE, 'utf8')
      }
      if (!fs.existsSync(path.join(addonDir, 'sherpa-onnx.node'))) {
        throw new Error('sherpa-onnx.node not found after addon installation')
      }
    }

    // 3) Voice models for ALL configured voices + shared espeak-ng-data.
    const espeakDir = path.join(dir, 'espeak-ng-data')
    for (const voiceKey of Object.keys(PIPER_VOICES) as PiperVoiceKey[]) {
      const v = PIPER_VOICES[voiceKey]
      const voiceDirPath = path.join(modelsDir, voiceKey)
      const modelPath = path.join(voiceDirPath, v.modelFile)
      if (fs.existsSync(modelPath)) continue
      fs.mkdirSync(voiceDirPath, { recursive: true })
      cb({ scope: 'tts', stage: 'downloading', component: `piper-voice-${voiceKey}`, progress: 0 })
      logInfo(`[voice] installPiper: downloading voice ${voiceKey}...`)
      const archive = await downloadWithFallback(
        { url: sherpaModelUrl(voiceKey), fileName: `vits-piper-${voiceKey}.tar.bz2` },
        (progress) => cb({ scope: 'tts', stage: 'downloading', component: `piper-voice-${voiceKey}`, progress }),
      )
      cb({ scope: 'tts', stage: 'extracting', component: `piper-voice-${voiceKey}`, progress: 1 })
      logInfo(`[voice] installPiper: extracting voice ${voiceKey}...`)
      await extractTarBz2(archive, voiceDirPath)
      try {
        fs.unlinkSync(archive)
      } catch {
        /* ignore */
      }
      // The voice package extracts into a nested folder; move its contents up
      // so <voiceDirPath>/ru_RU-<voice>-medium.onnx and tokens.txt live directly there.
      const pkgDir = path.join(voiceDirPath, `vits-piper-ru_RU-${voiceKey}-medium-int8`)
      if (fs.existsSync(pkgDir)) {
        for (const entry of fs.readdirSync(pkgDir)) {
          moveEntrySync(path.join(pkgDir, entry), path.join(voiceDirPath, entry))
        }
        try {
          fs.rmSync(pkgDir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
      if (!fs.existsSync(modelPath)) {
        throw new Error(`model ${v.modelFile} not found after extraction`)
      }
      // espeak-ng-data lives inside the voice package; keep one shared copy.
      // Rename (not cpSync — see moveEntrySync note about non-ASCII paths).
      const nestedEspeak = path.join(voiceDirPath, 'espeak-ng-data')
      if (!fs.existsSync(espeakDir) && fs.existsSync(nestedEspeak)) {
        moveEntrySync(nestedEspeak, espeakDir)
      }
      try {
        if (fs.existsSync(nestedEspeak)) fs.rmSync(nestedEspeak, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    // Ensure shared espeak-ng-data exists even if all voices were already
    // installed (e.g. previous interrupted install left it nested inside a voice).
    if (!fs.existsSync(espeakDir)) {
      for (const voiceKey of Object.keys(PIPER_VOICES) as PiperVoiceKey[]) {
        const nested = path.join(modelsDir, voiceKey, 'espeak-ng-data')
        if (fs.existsSync(nested)) {
          moveEntrySync(nested, espeakDir)
          break
        }
      }
    }
    cb({ scope: 'tts', stage: 'done', component: 'piper', progress: 1 })
    logInfo('[voice] piper (sherpa-onnx) installed')
  } catch (err) {
    cb({
      scope: 'tts',
      stage: 'error',
      component: 'piper',
      progress: 0,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

export async function piperSynthesize(
  text: string,
  voiceKey: PiperVoiceKey,
): Promise<{ mime: string; data: Buffer }> {
  const addonDir = nodeAddonDir()
  const worker = path.join(addonDir, 'tts-worker.js')
  const nodeExe = bundledNodeExe()
  if (!fs.existsSync(worker)) throw new Error('Piper не установлен. Установите его в настройках голоса.')
  const v = PIPER_VOICES[voiceKey]
  // ASCII paths via junction — the addon handles non-ASCII fine, but the CLI
  // engine doesn't; keep every path we pass ASCII for uniformity.
  const base = piperAsciiDir()
  const modelPath = path.join(base, 'models', voiceKey, v.modelFile)
  const tokensPath = path.join(base, 'models', voiceKey, v.tokensFile)
  if (!fs.existsSync(modelPath)) throw new Error('Голосовая модель Piper не найдена. Установите её в настройках голоса.')
  const espeakDir = path.join(base, 'espeak-ng-data')
  if (!fs.existsSync(espeakDir)) throw new Error('espeak-ng-data не найден. Переустановите Piper в настройках голоса.')

  const outWav = path.join(base, `piper-out-${Date.now()}.wav`)
  // addonDir via junction too: the addon .node loads DLLs from its own folder
  // (LoadLibraryEx altered search path), but require() of the JS wrapper with
  // a non-ASCII path is safer through the ASCII junction on some systems.
  const addonAsciiDir = path.join(base, 'node-addon')
  const payload = {
    addonDir: addonAsciiDir,
    model: modelPath,
    tokens: tokensPath,
    dataDir: espeakDir,
    text,
    outWav,
    numThreads: 2,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(nodeExe, [worker, payloadB64], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = ''
      child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code === 0 && fs.existsSync(outWav)) resolve()
        else reject(new Error(`piper worker exited with code ${code}: ${stderr.slice(0, 300)}`))
      })
    })
    const data = fs.readFileSync(outWav)
    return { mime: 'audio/wav', data }
  } finally {
    try {
      fs.unlinkSync(outWav)
    } catch {
      /* ignore */
    }
  }
}

// ─── Edge TTS (free, online) ─────────────────────────────────────────────────

let edgeVoicesCache: { at: number; voices: EdgeVoice[] } | null = null

export async function edgeListVoices(): Promise<EdgeVoice[]> {
  if (edgeVoicesCache && Date.now() - edgeVoicesCache.at < 6 * 3600_000) {
    return edgeVoicesCache.voices
  }
  const tts = new MsEdgeTTS()
  try {
    const voices = await tts.getVoices()
    edgeVoicesCache = { at: Date.now(), voices }
    return voices
  } finally {
    tts.close()
  }
}

export async function edgeSynthesize(text: string, voice: string): Promise<{ mime: string; data: Buffer }> {
  const tts = new MsEdgeTTS()
  try {
    await tts.setMetadata(voice || 'ru-RU-SvetlanaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = await tts.toStream(text, { rate: '+0%', pitch: '+0Hz' })
    const chunks: Buffer[] = []
    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return { mime: 'audio/mpeg', data: Buffer.concat(chunks) }
  } finally {
    tts.close()
  }
}

// ─── ElevenLabs (API key) ────────────────────────────────────────────────────

export async function elevenListVoices(apiKey: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`ElevenLabs API error: HTTP ${res.status}`)
  const json = (await res.json()) as { voices?: { voice_id: string; name: string }[] }
  return (json.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name }))
}

export async function elevenSynthesize(
  text: string,
  voiceId: string,
  apiKey: string,
): Promise<{ mime: string; data: Buffer }> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`ElevenLabs API error: HTTP ${res.status}`)
  const data = Buffer.from(await res.arrayBuffer())
  return { mime: 'audio/mpeg', data }
}

// ─── whisper.cpp (local STT) ─────────────────────────────────────────────────

export const WHISPER_MODELS: Record<WhisperModelId, { name: string; file: string; sizeBytes: number }> = {
  tiny: { name: 'tiny (75 МБ, быстро)', file: 'ggml-tiny.bin', sizeBytes: 75_000_000 },
  base: { name: 'base (142 МБ, баланс)', file: 'ggml-base.bin', sizeBytes: 142_000_000 },
  small: { name: 'small (466 МБ, точнее)', file: 'ggml-small.bin', sizeBytes: 466_000_000 },
  medium: { name: 'medium (1.5 ГБ, макс. точность)', file: 'ggml-medium.bin', sizeBytes: 1_500_000_000 },
}

// v1.7.4 has NO release assets (404); v1.7.6 is the closest tag with whisper-bin-x64.zip.
const WHISPER_BINARY_URL =
  'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip'

export function whisperStatus(): { installed: boolean; modelsInstalled: string[] } {
  const installed = fs.existsSync(whisperExe())
  const modelsDir = path.join(whisperDir(), 'models')
  const modelsInstalled: string[] = []
  if (fs.existsSync(modelsDir)) {
    for (const m of Object.values(WHISPER_MODELS)) {
      if (fs.existsSync(path.join(modelsDir, m.file))) modelsInstalled.push(m.file)
    }
  }
  return { installed, modelsInstalled }
}

export async function installWhisper(
  modelId: WhisperModelId,
  onProgress?: (p: VoiceProgress) => void,
): Promise<void> {
  const dir = whisperDir()
  fs.mkdirSync(dir, { recursive: true })
  const cb = onProgress ?? emitProgress
  try {
    if (!fs.existsSync(whisperExe())) {
      cb({ scope: 'stt', stage: 'downloading', component: 'whisper', progress: 0 })
      const zip = await downloadWithFallback(
        { url: WHISPER_BINARY_URL, fileName: 'whisper-bin-x64.zip' },
        (progress) => cb({ scope: 'stt', stage: 'downloading', component: 'whisper', progress }),
      )
      cb({ scope: 'stt', stage: 'extracting', component: 'whisper', progress: 1 })
      await extractZip(zip, dir)
      try {
        fs.unlinkSync(zip)
      } catch {
        /* ignore */
      }
      if (!fs.existsSync(whisperExe())) throw new Error('whisper-cli.exe not found after extraction')
    }

    const spec = WHISPER_MODELS[modelId]
    const modelsDir = path.join(dir, 'models')
    fs.mkdirSync(modelsDir, { recursive: true })
    const target = path.join(modelsDir, spec.file)
    if (!fs.existsSync(target)) {
      cb({ scope: 'stt', stage: 'downloading', component: `whisper-model-${spec.file}`, progress: 0 })
      await downloadWithFallback(
        {
          url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${spec.file}`,
          mirrorUrl: `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/${spec.file}`,
          fileName: path.join('whisper', 'models', spec.file),
          total: spec.sizeBytes,
        },
        (progress) => cb({ scope: 'stt', stage: 'downloading', component: `whisper-model-${spec.file}`, progress }),
      )
    }
    cb({ scope: 'stt', stage: 'done', component: 'whisper', progress: 1 })
    logInfo(`[voice] whisper installed (model ${modelId})`)
  } catch (err) {
    cb({
      scope: 'stt',
      stage: 'error',
      component: 'whisper',
      progress: 0,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

export async function whisperTranscribe(wavPath: string, modelId: WhisperModelId): Promise<string> {
  if (!fs.existsSync(whisperExe())) throw new Error('whisper-cli не установлен. Установите его в настройках голоса.')
  const spec = WHISPER_MODELS[modelId]
  const modelPath = path.join(whisperDir(), 'models', spec.file)
  if (!fs.existsSync(modelPath)) throw new Error('Модель распознавания не скачана. Скачайте её в настройках голоса.')

  const outBase = path.join(voiceDir(), `whisper-out-${Date.now()}`)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      whisperExe(),
      ['-m', modelPath, '-f', wavPath, '-l', 'ru', '-otxt', '-nt', '-np', '-of', outBase],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let stderr = ''
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`whisper-cli exited with code ${code}: ${stderr.slice(0, 300)}`))
    })
  })
  try {
    const txtPath = `${outBase}.txt`
    const text = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8').trim() : ''
    return text
  } finally {
    try {
      fs.unlinkSync(`${outBase}.txt`)
    } catch {
      /* ignore */
    }
  }
}

// ─── Dispatch / agent-answer integration ─────────────────────────────────────

export interface TtsUtterance {
  mime: string
  audioBase64: string
  text: string
}

export async function synthesizeWithConfig(text: string): Promise<TtsUtterance | null> {
  const cfg = readShellConfig()
  const tts = cfg.tts
  if (!tts?.enabled) return null
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    let result: { mime: string; data: Buffer }
    if (tts.provider === 'piper') {
      const voiceKey: PiperVoiceKey = tts.voice === 'dmitri' || tts.voice === 'denis' ? tts.voice : 'irina'
      result = await piperSynthesize(trimmed, voiceKey)
    } else if (tts.provider === 'elevenlabs') {
      if (!tts.apiKey) throw new Error('Нет API-ключа ElevenLabs')
      result = await elevenSynthesize(trimmed, tts.voice || '', tts.apiKey)
    } else {
      result = await edgeSynthesize(trimmed, tts.voice || 'ru-RU-SvetlanaNeural')
    }
    return { mime: result.mime, audioBase64: result.data.toString('base64'), text: trimmed }
  } catch (err) {
    logWarn(`[voice] tts failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

const MAX_ANSWER_CHARS = 4000

/** Cap the answer length so a huge reply cannot stall the queue. */
export function trimForSpeech(text: string): string {
  if (text.length <= MAX_ANSWER_CHARS) return text
  const cut = text.slice(0, MAX_ANSWER_CHARS)
  const last = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'), cut.lastIndexOf('\n'))
  return last > MAX_ANSWER_CHARS * 0.6 ? cut.slice(0, last + 1) : cut
}

let speechQueue: Promise<void> = Promise.resolve()
let lastSpokenText = ''
let lastSpokenAt = 0

/**
 * Speak an agent answer (fire-and-forget, sequential queue). Called from the
 * gateway RPC event handler when a `chat` event with state 'final' arrives.
 */
export function speakAgentAnswer(text: string): void {
  const cfg = readShellConfig()
  if (!cfg.tts?.enabled) {
    logInfo('[voice] speakAgentAnswer: skipped (tts disabled)')
    return
  }
  const trimmed = trimForSpeech(text ?? '').trim()
  if (!trimmed) return
  logInfo(`[voice] speakAgentAnswer: ${trimmed.slice(0, 80)}`)
  // Dedupe: gateway may emit the same final text twice (e.g. delta + final).
  const now = Date.now()
  if (trimmed === lastSpokenText && now - lastSpokenAt < 5000) return
  lastSpokenText = trimmed
  lastSpokenAt = now

  speechQueue = speechQueue
    .then(async () => {
      const utterance = await synthesizeWithConfig(trimmed)
      if (!utterance) return
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC_TTS_UTTERANCE, utterance)
      }
    })
    .catch((err) => logError(`[voice] speakAgentAnswer: ${err instanceof Error ? err.message : String(err)}`))
}
