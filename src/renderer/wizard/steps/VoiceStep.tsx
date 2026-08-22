import { useTranslation } from 'react-i18next'
import { Mic } from 'lucide-react'
import { useWizardStore } from '@/stores/wizard-store'
import { VoiceConfigForm, type VoiceProviderId } from '@/components/voice/VoiceConfigForm'
import type { VoiceTestResult } from '../../../shared/types'

/**
 * Wizard step 4: voice (realtime talk) setup.
 * Skippable — the user can configure voice later in Settings.
 */
export function VoiceStep() {
  const { t } = useTranslation()
  const { voiceConfig, setVoiceConfig } = useWizardStore()

  const handleProviderChange = (provider: VoiceProviderId) => {
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

      <section className="rounded-lg border border-border p-3 sm:p-5 space-y-4">
        <VoiceConfigForm
          provider={voiceConfig.provider === 'openai' ? 'openai' : 'google'}
          apiKey={voiceConfig.apiKey}
          onProviderChange={handleProviderChange}
          onApiKeyChange={handleApiKeyChange}
          onTest={handleTest}
        />
      </section>
    </div>
  )
}
