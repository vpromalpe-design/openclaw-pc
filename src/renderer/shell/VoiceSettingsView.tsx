import { useTranslation } from 'react-i18next'
import { ShellLayout } from './ShellLayout'
import { VoiceSettingsSection } from './VoiceSettingsSection'
import { TtsSettingsSection } from './TtsSettingsSection'
import { SttSettingsSection } from './SttSettingsSection'

export interface VoiceSettingsViewProps {
  /** Back navigation when embedded in parent layout */
  onBack?: () => void
}

function defaultNavigateBack() {
  window.location.hash = ''
}

/**
 * Standalone «Голос» panel (opened from the Control UI sidebar bridge,
 * like Models). Reuses the same section as Settings → «Голос».
 */
export function VoiceSettingsView({ onBack }: VoiceSettingsViewProps = {}) {
  const { t } = useTranslation()
  const handleBack = onBack ?? defaultNavigateBack
  return (
    <ShellLayout title={t('voice.settings.title')} onBack={handleBack}>
      <div className="w-full max-w-2xl mx-auto flex flex-col gap-8">
        {/* v0.9.13 (Этап F): TTS + local STT sections joined the voice panel */}
        <TtsSettingsSection />
        <SttSettingsSection />
        <VoiceSettingsSection />
      </div>
    </ShellLayout>
  )
}
