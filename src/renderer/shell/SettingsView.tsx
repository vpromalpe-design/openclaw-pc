import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ShellLayout } from './ShellLayout'
import type { ShellConfig } from '../../shared/types'
import {
  setAppLocale,
  SHELL_SUPPORTED_LOCALES,
  SHELL_LOCALE_LABELS,
  type ShellLocale,
} from '../i18n'
import { normalizeToShellLocale } from '../../shared/shell-locale'
import { ModelSettingsSection } from './ModelSettingsSection'
import { VoiceSettingsSection } from './VoiceSettingsSection'

export interface SettingsViewProps {
  /** Back navigation when embedded in parent layout */
  onBack?: () => void
  /** Open Feishu pairing / allowlist panel */
  onOpenFeishuSettings?: () => void
}

function defaultNavigateBack() {
  window.location.hash = ''
}

// v0.9.11: dark is the only theme — keep the .dark class active no matter
// what the stored shell config says.
function applyTheme(): void {
  document.documentElement.classList.add('dark')
}

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  id: string
}

function Toggle({ checked, onChange, id }: ToggleProps) {
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

export function SettingsView({ onBack, onOpenFeishuSettings }: SettingsViewProps = {}) {
  const { t, i18n } = useTranslation()
  const handleBack = onBack ?? defaultNavigateBack
  const [config, setConfig] = useState<ShellConfig | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.electronAPI.shellGetConfig().then((cfg) => {
      setConfig(cfg)
      setLoading(false)
      applyTheme()
    }).catch(() => {
      setLoading(false)
    })
  }, [])

  const updateConfig = useCallback(
    (patch: Partial<ShellConfig>) => {
      if (!config) return
      const updated = { ...config, ...patch }
      setConfig(updated)
      void window.electronAPI.shellSetConfig(patch)
    },
    [config],
  )

  const effectiveLocale = useMemo((): ShellLocale => {
    if (config?.locale) return config.locale
    return normalizeToShellLocale(i18n.language)
  }, [config?.locale, i18n.language])

  const handleLanguageChange = useCallback(
    async (next: ShellLocale) => {
      await setAppLocale(next)
      updateConfig({ locale: next })
    },
    [updateConfig],
  )

  if (loading) {
    return (
      <ShellLayout title={t('shell.settings.title')} onBack={handleBack}>
        <div className="flex items-center justify-center min-h-[40vh]" role="status">
          <p className="text-sm text-muted-foreground">{t('shell.settings.loading')}</p>
        </div>
      </ShellLayout>
    )
  }

  if (!config) {
    return (
      <ShellLayout title={t('shell.settings.title')} onBack={handleBack}>
        <div className="flex items-center justify-center min-h-[40vh]" role="alert">
          <p className="text-sm text-destructive">{t('shell.settings.loadFailed')}</p>
        </div>
      </ShellLayout>
    )
  }

  return (
    <ShellLayout title={t('shell.settings.title')} onBack={handleBack}>
      <div className="w-full max-w-2xl flex flex-col gap-8">
        <section className="flex flex-col gap-6" aria-label={t('shell.settings.generalSectionAria')}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <label htmlFor="close-to-tray" className="text-sm font-medium">
                {t('shell.settings.closeToTray')}
              </label>
              <p className="text-xs text-muted-foreground">{t('shell.settings.closeToTrayDesc')}</p>
            </div>
            <Toggle
              id="close-to-tray"
              checked={config.closeToTray}
              onChange={(v) => updateConfig({ closeToTray: v })}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <label htmlFor="auto-start" className="text-sm font-medium">
                {t('shell.settings.autoStart')}
              </label>
              <p className="text-xs text-muted-foreground">{t('shell.settings.autoStartDesc')}</p>
            </div>
            <Toggle
              id="auto-start"
              checked={config.autoStart}
              onChange={(v) => updateConfig({ autoStart: v })}
            />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t('shell.settings.language')}</span>
              <p className="text-xs text-muted-foreground">{t('shell.settings.languageDesc')}</p>
            </div>
            <Select
              value={effectiveLocale}
              onValueChange={(v) => void handleLanguageChange(v as ShellLocale)}
            >
              <SelectTrigger
                id="shell-language"
                aria-label={t('shell.settings.languageSelectAria')}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHELL_SUPPORTED_LOCALES.map((loc) => (
                  <SelectItem key={loc} value={loc}>
                    {SHELL_LOCALE_LABELS[loc]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t('shell.settings.updateChannel')}</span>
              <p className="text-xs text-muted-foreground">{t('shell.settings.updateChannelDesc')}</p>
            </div>
            <div className="flex gap-2" role="radiogroup" aria-label={t('shell.settings.updateChannelRadiogroupAria')}>
              <Button
                variant={config.updateChannel === 'stable' ? 'default' : 'outline'}
                size="sm"
                role="radio"
                aria-checked={config.updateChannel === 'stable'}
                onClick={() => updateConfig({ updateChannel: 'stable' })}
              >
                {t('shell.settings.stable')}
              </Button>
              <Button
                variant={config.updateChannel === 'beta' ? 'default' : 'outline'}
                size="sm"
                role="radio"
                aria-checked={config.updateChannel === 'beta'}
                onClick={() => updateConfig({ updateChannel: 'beta' })}
              >
                {t('shell.settings.beta')}
              </Button>
            </div>
          </div>
        </section>

        <ModelSettingsSection />

        <VoiceSettingsSection />

        {onOpenFeishuSettings && (
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4" aria-label={t('shell.settings.feishuSection')}>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t('shell.settings.feishuSection')}</span>
              <p className="text-xs text-muted-foreground">{t('shell.settings.feishuSectionDesc')}</p>
            </div>
            <Button type="button" variant="secondary" className="w-fit" onClick={onOpenFeishuSettings}>
              {t('shell.settings.openFeishuSettings')}
            </Button>
          </section>
        )}
      </div>
    </ShellLayout>
  )
}
