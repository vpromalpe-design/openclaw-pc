import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Mic, Sparkles, Zap, Home } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWizardStore } from '@/stores/wizard-store'
import { VoiceConfigForm, type VoiceProviderId } from '@/components/voice/VoiceConfigForm'
import { SttSettingsSection } from '@/shell/SttSettingsSection'
import type { VoiceTestResult } from '../../../shared/types'

/**
 * Wizard step 4: voice (realtime talk + local STT) setup.
 * v0.9.17: three options — Google (free), OpenAI (paid), Локально
 * (whisper.cpp, fully offline). The local variant reuses the exact
 * SttSettingsSection from the Settings «Голос и микрофон» panel.
 * Skippable — voice can be configured later in Settings.
 */
export function VoiceStep() {
  const { t } = useTranslation()
  const { voiceConfig, setVoiceConfig } = useWizardStore()

  const [mode, setMode] = useState<'google' | 'openai' | 'local'>(
    voiceConfig.provider === 'openai' ? 'openai' : 'google',
  )

  const handleProviderChange = (provider: VoiceProviderId) => {
    setMode(provider)
    setVoiceConfig({ provider, skipVoice: false })
  }

  const handleApiKeyChange = (apiKey: string) => {
    setVoiceConfig({ apiKey, skipVoice: false })
  }

  const handleTest = async (): Promise<VoiceTestResult> => {
    try {
      return await window.electronAPI.voiceTest({
        provider: voiceConfig.provider as VoiceProviderId,
        apiKey: voiceConfig.apiKey,
      })
    } catch {
      return { ok: false, status: 'network-error', message: 'IPC error' }
    }
  }

  const OPTIONS: { id: 'google' | 'openai' | 'local'; icon: React.ReactNode }[] = [
    { id: 'google', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'openai', icon: <Zap className="w-4 h-4" /> },
    { id: 'local', icon: <Home className="w-4 h-4" /> },
  ]

  return (
    <div className="space-y-5 sm:space-y-6 max-w-3xl mx-auto">
      <header>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight inline-flex items-center gap-2">
          <Mic className="w-5 h-5 text-muted-foreground" />
          {t('voice.step.title')}
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          {t('voice.step.subtitle')}
        </p>
      </header>

      {/* v0.9.17: three options — Google / OpenAI / Локально (как в макете) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {OPTIONS.map((opt) => {
          const active = mode === opt.id
          const isApi = opt.id !== 'local'
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => (isApi ? handleProviderChange(opt.id as VoiceProviderId) : setMode('local'))}
              className={cn(
                'relative rounded-lg border-2 p-3 sm:p-4 text-left transition-colors',
                active
                  ? 'border-primary bg-primary/10 shadow-sm'
                  : 'border-border bg-background hover:border-primary/40',
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
                {opt.icon}
                {t(`voice.provider.${opt.id}.name`)}
              </span>
              <span
                className={cn(
                  'inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full mt-1.5',
                  opt.id === 'google'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : opt.id === 'openai'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
                )}
              >
                {t(`voice.provider.${opt.id}.badge`)}
              </span>
              <span className="block text-xs text-muted-foreground mt-1.5 leading-relaxed">
                {t(`voice.provider.${opt.id}.desc`)}
              </span>
            </button>
          )
        })}
      </div>

      {/* Provider details */}
      <section className="rounded-lg border border-border p-3 sm:p-5 space-y-4">
        {mode === 'local' ? (
          <SttSettingsSection />
        ) : (
          <VoiceConfigForm
            key={mode}
            provider={mode}
            apiKey={voiceConfig.apiKey}
            onProviderChange={handleProviderChange}
            onApiKeyChange={handleApiKeyChange}
            onTest={handleTest}
            compact
          />
        )}
      </section>
    </div>
  )
}
