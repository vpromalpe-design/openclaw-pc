/**
 * Shared mic recording helpers for local STT dictation (whisper.cpp).
 * Record → 16 kHz mono WAV base64 → `stt:transcribe`.
 */

/** Encode Float32 PCM samples (mono) into a 16-bit PCM WAV file (base64). */
export function encodeWav(samples: Float32Array, sampleRate: number): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  // base64 (chunked — large buffers blow the argument stack otherwise)
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export type MicRecordOptions = {
  /** Resolves when the caller wants to stop recording (push-to-talk toggle). */
  stopSignal?: Promise<void>
  /** Hard cap for one recording; default 15 s. */
  maxMs?: number
}

/**
 * Record mic until `stopSignal` resolves or `maxMs` elapses.
 * Returns WAV base64 at 16 kHz mono.
 */
export async function recordMic(opts?: MicRecordOptions): Promise<string> {
  const maxMs = opts?.maxMs ?? 15000
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  const ctx = new AudioContext({ sampleRate: 16000 })
  const src = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  processor.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
  }
  const gain = ctx.createGain()
  gain.gain.value = 0
  src.connect(processor)
  processor.connect(gain)
  gain.connect(ctx.destination)
  try {
    const waiters: Promise<void>[] = [new Promise((r) => setTimeout(r, maxMs))]
    if (opts?.stopSignal) waiters.push(opts.stopSignal)
    await Promise.race(waiters)
  } finally {
    processor.disconnect()
    src.disconnect()
    stream.getTracks().forEach((tr) => tr.stop())
    await ctx.close().catch(() => undefined)
  }
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const merged = new Float32Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.length
  }
  // Resample to 16 kHz if the context used a different rate.
  let samples = merged
  if (ctx.sampleRate !== 16000 && ctx.sampleRate > 0 && samples.length > 0) {
    const ratio = 16000 / ctx.sampleRate
    const out = new Float32Array(Math.max(1, Math.floor(samples.length * ratio)))
    for (let i = 0; i < out.length; i++) {
      const pos = i / ratio
      const i0 = Math.floor(pos)
      const i1 = Math.min(samples.length - 1, i0 + 1)
      const frac = pos - i0
      out[i] = samples[i0]! * (1 - frac) + samples[i1]! * frac
    }
    samples = out
  }
  return encodeWav(samples, 16000)
}
