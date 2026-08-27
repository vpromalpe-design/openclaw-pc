import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Eye, EyeOff, ExternalLink, Loader2, Lock, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { VoiceTestResult } from '../../../shared/types'

export type VoiceProviderId = 'google' | 'openai'

export interface VoiceConfigFormProps {
  provider: VoiceProviderId
  apiKey: string
  onProviderChange: (provider: VoiceProviderId) => void
  onApiKeyChange: (key: string) => void
  /** When set, the «Проверить подключение» button is shown and wired to this async probe */
  onTest?: () => Promise<VoiceTestResult>
  /** Disable the whole form (e.g. wizard step skipped) */
  disabled?: boolean
  /** Compact variant for the Settings section (no big provider cards) */
  compact?: boolean
}

const PROVIDER_OPTIONS: { id: VoiceProviderId; badge: 'free' | 'paid' }[] = [
  { id: 'google', badge: 'free' },
  { id: 'openai', badge: 'paid' },
]

/**
 * Shared voice (realtime talk) config form: provider picker + API key + geo
 * warning + connection test. Used by the wizard VoiceStep and the Settings
 * «Голос» section so both surfaces behave identically.
 */
export function VoiceConfigForm({
  provider,
  apiKey,
  onProviderChange,
  onApiKeyChange,
  onTest,
  disabled,
  compact,
}: VoiceConfigFormProps) {
  const { t } = useTranslation()
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testState, setTestState] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null)

  const handleTest = async () => {
    if (!onTest) return
    if (!apiKey.trim()) {
      setTestState({ kind: 'err', message: t('voice.test.missingKey') })
      return
    }
    setTesting(true)
    setTestState(null)
    try {
      const res = await onTest()
      if (res.ok) {
        setTestState({ kind: 'ok', message: t('voice.test.ok') })
      } else {
        const key =
          res.status === 'missing-key'
            ? 'voice.test.missingKey'
            : res.status === 'invalid-key'
              ? 'voice.test.invalidKey'
              : res.status === 'geo-blocked'
                ? 'voice.test.geoBlocked'
                : 'voice.test.networkError'
        setTestState({ kind: 'err', message: t(key, { detail: res.message ?? '' }) })
      }
    } catch {
      setTestState({ kind: 'err', message: t('voice.test.networkError', { detail: '' }) })
    } finally {
      setTesting(false)
    }
  }

  const keyHint =
    provider === 'google'
      ? t('voice.provider.google.keyHint')
      : t('voice.provider.openai.keyHint')

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PROVIDER_OPTIONS.map((opt) => {
            const active = provider === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                disabled={disabled}
                onClick={() => onProviderChange(opt.id)}
                className={cn(
                  'relative rounded-lg border-2 p-3 sm:p-4 text-left transition-colors',
                  active
                    ? 'border-primary bg-primary/10 shadow-sm'
                    : 'border-border bg-background hover:border-primary/40',
                  disabled && 'opacity-60 cursor-not-allowed',
                )}
              >
                <span
                  className={cn(
                    'absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center',
                    active ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                  )}
                >
                  {active && <Check className="w-3 h-3" />}
                </span>
                <span className="text-sm font-semibold flex items-center gap-2 pr-8">
                  {t(`voice.provider.${opt.id}.name`)}
                  <span
                    className={cn(
                      'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full',
                      opt.badge === 'free'
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                    )}
                  >
                    {t(`voice.provider.${opt.id}.badge`)}
                  </span>
                </span>
                <span className="block text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  {t(`voice.provider.${opt.id}.desc`)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <fieldset className="space-y-1.5">
        <label htmlFor="voice-api-key" className="text-sm font-medium">
          {t('voice.apiKeyLabel')}
          <span className="text-muted-foreground font-normal text-xs"> {keyHint}</span>
        </label>
        <div className="relative">
          <Input
            id="voice-api-key"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={
              provider === 'google' ? 'AQ.Ab8… или AIza…' : 'sk-…'
            }
            className="font-mono pr-10"
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            disabled={disabled}
            aria-label={showKey ? t('voice.hideKey') : t('voice.showKey')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {provider === 'google' && (
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {t('voice.getKey')}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </fieldset>

      <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 flex gap-2.5 items-start">
        <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300/90">
          {t('voice.geoWarning')}
        </p>
      </div>

      <div className="rounded-md border border-border/60 bg-muted/30 p-3 flex gap-2.5 items-start">
        <Lock className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('voice.keyStorageNote')}
        </p>
      </div>

      {onTest && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant={testState?.kind === 'ok' ? 'default' : 'outline'}
            size="lg"
            className={cn(
              'w-fit transition-colors',
              testState?.kind === 'ok' &&
                'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 hover:text-white shadow-sm shadow-emerald-600/30',
            )}
            onClick={handleTest}
            disabled={disabled || testing || !apiKey.trim()}
          >
            {testing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <ShieldCheck className="w-5 h-5" />
            )}
            {testing
              ? t('voice.test.testing')
              : testState?.kind === 'ok'
                ? t('voice.test.connected')
                : t('voice.test.run')}
          </Button>
          {testState && (
            <p
              className={cn(
                'text-xs inline-flex items-center gap-1.5',
                testState.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
              )}
            >
              {testState.kind === 'ok' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <TriangleAlert className="w-3.5 h-3.5" />
              )}
              {testState.message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
