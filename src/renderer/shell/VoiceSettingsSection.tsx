import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VoiceConfigForm, type VoiceProviderId } from '@/components/voice/VoiceConfigForm'
import type { VoiceSettingsLoadResult, VoiceTestResult } from '../../shared/types'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Settings → «Голос» section. Reads/writes `talk.realtime` in openclaw.json
 * via IPC; same VoiceConfigForm as the wizard step.
 */
export function VoiceSettingsSection() {
  const { t } = useTranslation()
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [snapshot, setSnapshot] = useState<VoiceSettingsLoadResult | null>(null)
  const [provider, setProvider] = useState<VoiceProviderId>('google')
  const [apiKey, setApiKey] = useState('')
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')

  const load = useCallback(async () => {
    setLoadState('loading')
    try {
      const res = await window.electronAPI.voiceSettingsLoad()
      setSnapshot(res)
      setProvider(res.provider === 'openai' ? 'openai' : 'google')
      setHasStoredKey(res.hasKey)
      setApiKey('') // never echo the stored key back into the field
      setSaveState('idle')
      setSaveError('')
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleTest = async (): Promise<VoiceTestResult> => {
    try {
      return await window.electronAPI.voiceTest({ provider, apiKey })
    } catch {
      return { ok: false, status: 'network-error', message: 'IPC error' }
    }
  }

  const handleSave = async () => {
    setSaveState('saving')
    setSaveError('')
    try {
      const res = await window.electronAPI.voiceSettingsApply({
        provider,
        apiKey: apiKey.trim() ? apiKey.trim() : (hasStoredKey ? '' : null),
        restartGateway: true,
      })
      if (res.ok) {
        setHasStoredKey(Boolean(apiKey.trim()) || (hasStoredKey && apiKey.trim() === ''))
        setApiKey('')
        setSaveState('saved')
        setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2500)
      } else {
        setSaveState('error')
        setSaveError(res.error ?? t('voice.settings.saveFailed'))
      }
    } catch (e) {
      setSaveState('error')
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleRemove = async () => {
    setSaveState('saving')
    setSaveError('')
    try {
      const res = await window.electronAPI.voiceSettingsApply({
        provider,
        apiKey: null, // remove stored key + disable voice
        restartGateway: true,
      })
      if (res.ok) {
        setHasStoredKey(false)
        setApiKey('')
        setSaveState('saved')
        setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2500)
      } else {
        setSaveState('error')
        setSaveError(res.error ?? t('voice.settings.saveFailed'))
      }
    } catch (e) {
      setSaveState('error')
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  if (loadState === 'loading') {
    return (
      <section
        className="rounded-lg border border-border bg-card p-4"
        aria-label={t('voice.settings.sectionAria')}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden />
          {t('shell.settings.loading')}
        </div>
      </section>
    )
  }

  if (loadState === 'error' || !snapshot) {
    return (
      <section
        className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"
        role="alert"
        aria-label={t('voice.settings.sectionAria')}
      >
        <p className="text-sm text-destructive">{t('voice.settings.loadFailed')}</p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
          {t('shell.feishu.refresh')}
        </Button>
      </section>
    )
  }

  return (
    <section
      className="rounded-lg border border-border bg-card p-4 flex flex-col gap-5"
      aria-label={t('voice.settings.sectionAria')}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-medium">{t('voice.settings.title')}</h2>
          {hasStoredKey && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              {t('voice.settings.active')}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('voice.settings.desc')}</p>
      </div>

      <VoiceConfigForm
        provider={provider}
        apiKey={apiKey}
        onProviderChange={setProvider}
        onApiKeyChange={setApiKey}
        onTest={handleTest}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={handleSave}
          disabled={saveState === 'saving'}
        >
          {saveState === 'saving' ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden />
          ) : null}
          {t('voice.settings.save')}
        </Button>
        {hasStoredKey && (
          <Button type="button" variant="ghost" size="sm" onClick={handleRemove} disabled={saveState === 'saving'}>
            {t('voice.settings.removeKey')}
          </Button>
        )}
        {saveState === 'saved' && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400" role="status">
            {t('voice.settings.saved')}
          </p>
        )}
        {saveState === 'error' && (
          <p className="text-xs text-destructive" role="alert">
            {saveError}
          </p>
        )}
      </div>
    </section>
  )
}
