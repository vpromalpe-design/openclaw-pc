/**
 * v0.9.42: универсальная кнопка голосового ввода — «везде, где есть поле
 * текста с отправкой». Показывается только когда STT включён (онлайн или
 * офлайн) и whisper установлен. Паттерн записи — как в чате (TextChatView):
 * нажал → говоришь → нажал → распознавание → текст в поле.
 */
import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { recordMic } from '@/utils/mic-recorder'

export interface MicDictateProps {
  /** Полученный распознанный текст (дописывается к уже введённому) */
  onText: (text: string) => void
  /** Запись идёт — поле ввода обычно блокируется/подсвечивается */
  onRecording?: (rec: boolean) => void
  disabled?: boolean
  compact?: boolean
  title?: string
  /** v0.9.45: показывать кнопку только когда true (появление при вводе текста) */
  appear?: boolean
}

type ReadyState = 'unknown' | 'yes' | 'no'

let cachedStt: { ts: number; ready: boolean } | null = null

async function sttAvailable(): Promise<boolean> {
  if (cachedStt && Date.now() - cachedStt.ts < 30_000) return cachedStt.ready
  try {
    const res = await window.electronAPI.sttLoad()
    const ready = Boolean(
      res.enabled &&
        res.whisper.installed &&
        (res.whisper.modelsInstalled ?? []).includes(res.model),
    )
    cachedStt = { ts: Date.now(), ready }
    return ready
  } catch {
    cachedStt = { ts: Date.now(), ready: false }
    return false
  }
}

export function MicDictate({ onText, onRecording, disabled, compact, title, appear }: MicDictateProps) {
  const [ready, setReady] = useState<ReadyState>('unknown')
  const [dictating, setDictating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    void sttAvailable().then((ok) => {
      if (!cancelled) setReady(ok ? 'yes' : 'no')
    })
    return () => {
      cancelled = true
      stopRef.current?.()
    }
  }, [])

  // v0.9.45: кнопка видна при вводе текста (appear) — даже если STT выключен,
  // чтобы было понятно, что голосовой ввод есть (клик покажет, как включить).
  const sttOk = ready === 'yes'
  const show = appear === undefined ? sttOk : appear && ready !== 'unknown'
  if (!show) return null

  const toggle = async () => {
    if (!sttOk) {
      setError('Голосовой ввод выключен: открой ⚙️ → Голос и включи STT (нужен whisper)')
      window.setTimeout(() => setError(null), 4000)
      return
    }
    if (dictating) {
      stopRef.current?.()
      return
    }
    setError(null)
    setDictating(true)
    onRecording?.(true)
    let stopResolve: () => void = () => undefined
    const stopSignal = new Promise<void>((r) => {
      stopResolve = r
    })
    stopRef.current = stopResolve
    try {
      const audioBase64 = await recordMic({ stopSignal, maxMs: 15000 })
      setDictating(false)
      onRecording?.(false)
      setBusy(true)
      const res = await window.electronAPI.sttTranscribe({ audioBase64 })
      if (res.ok && res.text) {
        onText(res.text)
      } else {
        setError(res.error ?? 'распознавание не удалось')
      }
    } catch (e) {
      setDictating(false)
      onRecording?.(false)
      setError(e instanceof Error ? e.message : 'распознавание не удалось')
    } finally {
      setBusy(false)
      stopRef.current = null
    }
  }

  const cls = ['roy-mic', !sttOk && 'no', dictating && 'rec', busy && 'busy', error && 'err', compact && 'compact']
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={cls}
      title={title ?? (!sttOk ? 'Голосовой ввод выключен — включи в ⚙️ → Голос (STT + whisper)' : dictating ? 'Стоп — закончить запись' : 'Голосовой ввод — нажмите, говорите, нажмите ещё раз')}
      aria-label="Голосовой ввод"
      onClick={() => void toggle()}
      disabled={disabled || busy}
    >
      {dictating ? <Square size={compact ? 11 : 13} /> : <Mic size={compact ? 11 : 13} />}
      {!compact && <span className="roy-mic-l">{!sttOk ? '' : dictating ? 'Стоп' : busy ? '…' : ''}</span>}
    </button>
  )
}
