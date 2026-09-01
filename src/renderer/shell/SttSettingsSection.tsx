import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Mic, MicOff, Download, AudioLines } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { recordMic } from '@/utils/mic-recorder'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface SttLoadResult {
  enabled: boolean
  model: 'tiny' | 'base' | 'small' | 'medium'
  whisper: {
    installed: boolean
    modelsInstalled: string[]
    models: { id: string; name: string }[]
  }
}

function Toggle({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        checked ? 'bg-primary' : 'bg-input'
      }`}
    >
      <span
        className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

/** Record mic for `durationMs`, return WAV base64 at 16 kHz mono. */
async function recordMicBase64(durationMs: number): Promise<string> {
  return recordMic({ maxMs: durationMs })
}

/**
 * v0.9.13 (Этап F2): local speech-to-text via whisper.cpp (tiny/base/small/
 * medium). Existing API options (google/openai, talk.realtime) stay untouched.
 */
export function SttSettingsSection() {
  const { t } = useTranslation()
  const [state, setState] = useState<SttLoadResult | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [model, setModel] = useState('base')
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<number | null>(null)
  const [installLabel, setInstallLabel] = useState('')
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recordMs, setRecordMs] = useState(4000)
  /** v0.9.24: preferred mic mode in chat ('auto' | 'offline' | 'online') */
  const [preferredMode, setPreferredMode] = useState<'auto' | 'offline' | 'online'>('auto')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = async () => {
    const res = await window.electronAPI.sttLoad()
    setState(res)
    setEnabled(res.enabled)
    setModel(res.model)
    try {
      const shell = await window.electronAPI.shellGetConfig()
      setPreferredMode(shell.sttPreferredMode ?? 'auto')
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await window.electronAPI.sttLoad()
        if (cancelled) return
        setState(res)
        setEnabled(res.enabled)
        setModel(res.model)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    const unsub = window.electronAPI.onVoiceProgress((p) => {
      const pp = p as { scope?: string; stage?: string; component?: string; progress?: number; error?: string }
      if (pp.scope !== 'stt') return
      if (pp.stage === 'done') {
        setInstalling(false)
        setInstallProgress(null)
        void refresh()
      } else if (pp.stage === 'error') {
        setInstalling(false)
        setInstallProgress(null)
        setError(pp.error ?? t('voice.stt.installFailed'))
      } else if (typeof pp.progress === 'number') {
        setInstallProgress(pp.progress)
        setInstallLabel(pp.component ?? '')
      }
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [t])

  const handleEnabled = async (v: boolean) => {
    setEnabled(v)
    try {
      await window.electronAPI.sttApply({ enabled: v })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleModel = async (v: string) => {
    setModel(v)
    try {
      await window.electronAPI.sttApply({ model: v })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handlePreferredMode = async (v: string) => {
    const mode = v === 'offline' || v === 'online' ? v : 'auto'
    setPreferredMode(mode)
    try {
      await window.electronAPI.sttSetPreferredMode({ mode })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleInstall = async () => {
    setInstalling(true)
    setInstallProgress(0)
    setInstallLabel('')
    setError(null)
    try {
      await window.electronAPI.sttInstall({ model })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setInstalling(false)
      setInstallProgress(null)
    }
  }

  const handleRecord = async () => {
    setResult(null)
    setError(null)
    try {
      setRecording(true)
      const audioBase64 = await recordMicBase64(recordMs)
      setRecording(false)
      setTranscribing(true)
      const res = await window.electronAPI.sttTranscribe({ audioBase64 })
      if (res.ok) {
        setResult({ ok: true, text: res.text ?? '' })
      } else {
        setResult({ ok: false, text: res.error ?? t('voice.stt.transcribeFailed') })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRecording(false)
      setTranscribing(false)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground flex items-center gap-2" role="status">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          {t('voice.stt.loading')}
        </p>
      </section>
    )
  }

  const whisper = state?.whisper
  const modelInstalled = whisper?.modelsInstalled.some((f) => f.includes(model) || f.includes(`ggml-${model}`)) ?? false
  const ready = Boolean(whisper?.installed && modelInstalled)

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-4" aria-label={t('voice.stt.title')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AudioLines className="w-4 h-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-medium">{t('voice.stt.title')}</h3>
        </div>
        <Toggle checked={enabled} onChange={(v) => void handleEnabled(v)} id="stt-enabled" />
      </div>
      <p className="text-xs text-muted-foreground">{t('voice.stt.desc')}</p>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">{t('voice.stt.preferredMode')}</label>
        <Select value={preferredMode} onValueChange={(v) => void handlePreferredMode(v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t('voice.stt.preferredAuto')}</SelectItem>
            <SelectItem value="offline">{t('voice.stt.preferredOffline')}</SelectItem>
            <SelectItem value="online">{t('voice.stt.preferredOnline')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">{t('voice.stt.preferredHint')}</p>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">{t('voice.stt.model')}</label>
        <Select value={model} onValueChange={(v) => void handleModel(v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(whisper?.models ?? []).map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!ready ? (
        <div className="rounded-md border border-border p-3 space-y-2">
          <p className="text-xs text-muted-foreground">{t('voice.stt.notInstalled')}</p>
          {installProgress !== null && (
            <div className="space-y-1">
              <div
                className="h-1.5 rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-valuenow={Math.round(installProgress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full bg-[var(--accent)] transition-[width] duration-300"
                  style={{ width: `${Math.min(100, Math.round(installProgress * 100))}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground truncate">{installLabel}</p>
            </div>
          )}
          <Button size="sm" onClick={() => void handleInstall()} disabled={installing} className="w-full">
            {installing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden />
                {t('voice.stt.installing')}
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-1" aria-hidden />
                {t('voice.stt.install')}
              </>
            )}
          </Button>
          <p className="text-[11px] text-muted-foreground">{t('voice.stt.sizeHint')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              variant={recording ? 'destructive' : 'default'}
              size="sm"
              onClick={() => void handleRecord()}
              disabled={recording || transcribing}
            >
              {recording ? (
                <>
                  <MicOff className="w-4 h-4 mr-1 animate-pulse" aria-hidden />
                  {t('voice.stt.recording')}
                </>
              ) : transcribing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden />
                  {t('voice.stt.transcribing')}
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4 mr-1" aria-hidden />
                  {t('voice.stt.record')}
                </>
              )}
            </Button>
            <Select value={String(recordMs)} onValueChange={(v) => setRecordMs(Number(v))}>
              <SelectTrigger className="w-32 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3000">3 с</SelectItem>
                <SelectItem value="4000">4 с</SelectItem>
                <SelectItem value="6000">6 с</SelectItem>
                <SelectItem value="10000">10 с</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {result && (
            <div
              className={`rounded-md border p-3 text-sm whitespace-pre-wrap ${result.ok ? 'border-green-500/30 bg-green-500/10' : 'border-destructive/40 bg-destructive/5 text-destructive'}`}
              role={result.ok ? 'status' : 'alert'}
            >
              {result.ok ? (
                <>{result.text || t('voice.stt.emptyResult')}</>
              ) : (
                result.text
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{t('voice.stt.micHint')}</p>
        </div>
      )}
    </section>
  )
}
