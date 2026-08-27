import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Play, Volume2, Wifi, WifiOff, KeyRound, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface TtsLoadResult {
  enabled: boolean
  provider: 'edge' | 'elevenlabs' | 'piper'
  voice: string
  hasKey: boolean
  piper: { installed: boolean; voiceInstalled: boolean }
}

interface VoiceOption {
  id: string
  name: string
}

const EDGE_DEFAULTS: VoiceOption[] = [
  { id: 'ru-RU-SvetlanaNeural', name: 'Светлана (ru)' },
  { id: 'ru-RU-DmitryNeural', name: 'Дмитрий (ru)' },
]

const PIPER_OPTIONS: VoiceOption[] = [
  { id: 'irina', name: 'Ирина (женский)' },
  { id: 'dmitri', name: 'Дмитрий (мужской)' },
  { id: 'denis', name: 'Денис (мужской)' },
]

function playAudio(mime: string, base64: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(`data:${mime};base64,${base64}`)
    audio.onended = () => resolve()
    audio.onerror = () => reject(new Error('audio playback failed'))
    audio.play().catch(reject)
  })
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

/**
 * v0.9.13 (Этап F1): TTS section — Edge (free, online) / ElevenLabs (API) /
 * Piper (local, offline). Agent answers are spoken when enabled.
 */
export function TtsSettingsSection() {
  const { t } = useTranslation()
  const [state, setState] = useState<TtsLoadResult | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [provider, setProvider] = useState<'edge' | 'elevenlabs' | 'piper'>('edge')
  const [voice, setVoice] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [voices, setVoices] = useState<VoiceOption[]>(EDGE_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<number | null>(null)
  const [installLabel, setInstallLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [apiKeyDirty, setApiKeyDirty] = useState(false)
  const keyRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    const res = await window.electronAPI.ttsLoad()
    setState(res)
    setEnabled(res.enabled)
    setProvider(res.provider)
    setVoice(res.voice)
    if (res.provider === 'edge' && !res.voice) setVoice('ru-RU-SvetlanaNeural')
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await window.electronAPI.ttsLoad()
        if (cancelled) return
        setState(res)
        setEnabled(res.enabled)
        setProvider(res.provider)
        setVoice(res.voice)
        setApiKey('')
        setApiKeyDirty(false)
        if (res.provider === 'edge') {
          setVoices(EDGE_DEFAULTS)
          if (!res.voice) setVoice('ru-RU-SvetlanaNeural')
        }
        if (res.provider === 'piper') {
          setVoices(PIPER_OPTIONS)
          if (!res.voice) setVoice('irina')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    const unsub = window.electronAPI.onVoiceProgress((p) => {
      const pp = p as { scope?: string; stage?: string; component?: string; progress?: number; error?: string }
      if (pp.scope !== 'tts') return
      if (pp.stage === 'done') {
        setInstalling(false)
        setInstallProgress(null)
        void refresh()
      } else if (pp.stage === 'error') {
        setInstalling(false)
        setInstallProgress(null)
        setError(pp.error ?? t('voice.tts.installFailed'))
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

  const save = async (patch: {
    enabled?: boolean
    provider?: 'edge' | 'elevenlabs' | 'piper'
    voice?: string
    apiKey?: string | null
  }) => {
    setSaving(true)
    setError(null)
    try {
      await window.electronAPI.ttsApply(patch)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleEnabled = async (v: boolean) => {
    setEnabled(v)
    await save({ enabled: v })
  }

  const handleProvider = async (v: string) => {
    const p = v as 'edge' | 'elevenlabs' | 'piper'
    setProvider(p)
    setTestMsg(null)
    if (p === 'piper') {
      setVoices(PIPER_OPTIONS)
      if (!voice || !['irina', 'dmitri', 'denis'].includes(voice)) setVoice('irina')
    } else if (p === 'edge') {
      setVoices(EDGE_DEFAULTS)
      if (!voice || !voice.startsWith('ru-')) setVoice('ru-RU-SvetlanaNeural')
    } else {
      setVoices([])
      if (!voice || voice.startsWith('ru-') || ['irina', 'dmitri', 'denis'].includes(voice)) setVoice('')
    }
    await save({ provider: p })
  }

  const loadVoices = async () => {
    const key = apiKeyDirty && apiKey ? apiKey : ''
    const res = await window.electronAPI.ttsVoices({
      provider,
      apiKey: provider === 'elevenlabs' ? key : undefined,
    })
    if (res.ok && res.voices) {
      setVoices(res.voices)
      if (!voice && res.voices[0]) setVoice(res.voices[0].id)
      setError(null)
    } else if (res.error) {
      setError(res.error)
    }
  }

  const handleVoice = async (v: string) => {
    setVoice(v)
    await save({ voice: v })
  }

  const handleApiKeySave = async () => {
    const key = keyRef.current?.value.trim() ?? ''
    setApiKey(key)
    setApiKeyDirty(Boolean(key))
    await save({ apiKey: key || null })
    if (key) {
      setVoices([])
      void loadVoices()
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestMsg(null)
    setError(null)
    try {
      const res = await window.electronAPI.ttsTest()
      if (res.ok && res.audioBase64 && res.mime) {
        await playAudio(res.mime, res.audioBase64)
        setTestMsg({ ok: true, text: t('voice.tts.testOk') })
      } else {
        setTestMsg({ ok: false, text: res.error ?? t('voice.tts.testFailed') })
      }
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const handleInstallPiper = async () => {
    setInstalling(true)
    setInstallProgress(0)
    setInstallLabel('')
    setError(null)
    try {
      await window.electronAPI.ttsInstall()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setInstalling(false)
      setInstallProgress(null)
    }
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground flex items-center gap-2" role="status">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          {t('voice.tts.loading')}
        </p>
      </section>
    )
  }

  const piperReady = Boolean(state?.piper.installed && state.piper.voiceInstalled)

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-4" aria-label={t('voice.tts.title')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-medium">{t('voice.tts.title')}</h3>
        </div>
        <Toggle checked={enabled} onChange={(v) => void handleEnabled(v)} id="tts-enabled" />
      </div>
      <p className="text-xs text-muted-foreground">{t('voice.tts.desc')}</p>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="grid gap-3">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">{t('voice.tts.provider')}</label>
          <Select value={provider} onValueChange={(v) => void handleProvider(v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="edge">Microsoft Edge (бесплатно, онлайн)</SelectItem>
              <SelectItem value="elevenlabs">ElevenLabs (API-ключ)</SelectItem>
              <SelectItem value="piper">Piper (локально, офлайн)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {provider === 'edge' && (
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">{t('voice.tts.voice')}</label>
            <Select value={voice || 'ru-RU-SvetlanaNeural'} onValueChange={(v) => void handleVoice(v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {voices.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Wifi className="w-3 h-3" aria-hidden />
              {t('voice.tts.edgeHint')}
            </p>
          </div>
        )}

        {provider === 'elevenlabs' && (
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              <KeyRound className="w-3 h-3" aria-hidden />
              {t('voice.tts.elevenKey')}
            </label>
            <div className="flex gap-2">
              <Input
                ref={keyRef}
                type="password"
                defaultValue={state?.hasKey ? '••••••••' : ''}
                placeholder={state?.hasKey ? t('voice.tts.keySaved') : 'sk_…'}
                className="flex-1"
                onFocus={(e) => {
                  if (e.target.value === '••••••••') e.target.value = ''
                }}
              />
              <Button variant="outline" size="sm" onClick={() => void handleApiKeySave()} disabled={saving}>
                {t('voice.tts.saveKey')}
              </Button>
            </div>
            {voices.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">{t('voice.tts.voice')}</label>
                <Select value={voice} onValueChange={(v) => void handleVoice(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {voices.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {provider === 'piper' && (
          <div className="space-y-2">
            {!piperReady ? (
              <div className="rounded-md border border-border p-3 space-y-2">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <WifiOff className="w-3 h-3" aria-hidden />
                  {t('voice.tts.piperNotInstalled')}
                </p>
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
                <Button size="sm" onClick={() => void handleInstallPiper()} disabled={installing} className="w-full">
                  {installing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden />
                      {t('voice.tts.installing')}
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-1" aria-hidden />
                      {t('voice.tts.installPiper')}
                    </>
                  )}
                </Button>
                <p className="text-[11px] text-muted-foreground">{t('voice.tts.piperSizeHint')}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">{t('voice.tts.voice')}</label>
                <Select value={voice || 'irina'} onValueChange={(v) => void handleVoice(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PIPER_OPTIONS.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <WifiOff className="w-3 h-3" aria-hidden />
                  {t('voice.tts.piperHint')}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleTest()}
          disabled={testing || (provider === 'piper' && !piperReady)}
        >
          {testing ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden />
          ) : (
            <Play className="w-4 h-4 mr-1" aria-hidden />
          )}
          {t('voice.tts.test')}
        </Button>
        {testMsg && (
          <span
            className={`text-xs ${testMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}
            role={testMsg.ok ? 'status' : 'alert'}
          >
            {testMsg.text}
          </span>
        )}
      </div>
    </section>
  )
}
