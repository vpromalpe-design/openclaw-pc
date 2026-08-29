import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import {
  useWizardStore,
  WIZARD_STEPS,
  WIZARD_STEP_COUNT,
} from '@/stores/wizard-store'
import { StepIndicator } from './StepIndicator'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WelcomeStep } from './steps/WelcomeStep'
import { ModelStep } from './steps/ModelStep'
import { ChannelStep } from './steps/ChannelStep'
import { VoiceStep } from './steps/VoiceStep'
import { GatewayStep } from './steps/GatewayStep'
import { CompleteStep } from './steps/CompleteStep'
import { ModelTestButton } from './ModelTestButton'
import { ChevronLeft, ChevronRight, SkipForward, Rocket, X } from 'lucide-react'
import openclawLogo from '@/assets/openclaw-logo.png'
import {
  setAppLocale,
  SHELL_SUPPORTED_LOCALES,
  SHELL_LOCALE_LABELS,
  type ShellLocale,
} from '@/i18n'

const STEP_COMPONENTS = [
  WelcomeStep,
  ModelStep,
  ChannelStep,
  VoiceStep,
  GatewayStep,
  CompleteStep,
] as const

function initialLocaleFromI18n(): ShellLocale {
  const lng = i18n.language
  return (SHELL_SUPPORTED_LOCALES as readonly string[]).includes(lng)
    ? (lng as ShellLocale)
    : 'en'
}

/**
 * Setup wizard shell — installer-style layout (v0.9.14, Вариант 1):
 * left sidebar like the NSIS installer (dark gradient, blobs, logo,
 * vertical step list), content on the right, footer with nav buttons.
 * Only the layout changed; steps, validation and deploy logic are untouched.
 */
export function WizardLayout() {
  const { t } = useTranslation()
  const store = useWizardStore()
  const { currentStep, completedSteps, deployPhase } = store

  const [uiLocale, setUiLocale] = useState<ShellLocale>(initialLocaleFromI18n)

  useEffect(() => {
    void window.electronAPI?.shellGetConfig?.().then((cfg) => {
      if (cfg.locale && (SHELL_SUPPORTED_LOCALES as readonly string[]).includes(cfg.locale)) {
        setUiLocale(cfg.locale)
      }
    })
  }, [])

  const isFirstStep = currentStep === 0
  const isLastStep = currentStep === WIZARD_STEP_COUNT - 1
  const stepDef = WIZARD_STEPS[currentStep]
  const canAdvance = store.isStepValid(currentStep)
  const isDeploying = deployPhase === 'writing' || deployPhase === 'starting'

  const StepContent = STEP_COMPONENTS[currentStep]

  return (
    <div className="h-screen relative flex select-none overflow-hidden bg-[rgba(11,16,32,0.72)]">
      <div className="app-bg" aria-hidden />

      {/* ── Left sidebar (installer-style) ── */}
      <aside
        className="relative z-10 flex w-[272px] shrink-0 flex-col overflow-hidden border-r border-white/10"
        style={{
          background:
            'radial-gradient(120px 110px at -10px -20px, rgba(10,132,255,.55), transparent 70%),' +
            'radial-gradient(150px 150px at 110px 300px, rgba(191,90,242,.30), transparent 70%),' +
            'linear-gradient(180deg, #0B1020, #121A34)',
        }}
      >
        <div className="flex flex-col items-center gap-3 px-5 pt-7 pb-2">
          <img
            src={openclawLogo}
            alt="OpenClaw"
            className="h-[86px] w-[86px] rounded-[20px] object-contain"
          />
          <div className="text-[19px] font-bold tracking-[0.2px] text-[#F2F4F8]">
            {t('wizard.appName')}
          </div>
          <div className="h-px w-[120px] bg-white/25" />
        </div>

        <StepIndicator
          steps={WIZARD_STEPS}
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={store.goToStep}
        />
      </aside>

      {/* ── Right: content + footer ── */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-8 py-7">
            <div className="text-xs font-bold uppercase tracking-[0.4px] text-[#5AC8FA]">
              {t('wizard.stepOf', { current: currentStep + 1, total: WIZARD_STEP_COUNT })}
              {' · '}
              {t(`wizard.steps.${stepDef.id}`)}
            </div>
            <StepContent />
          </div>
        </main>

        <footer className="relative shrink-0 border-t border-white/10 bg-white/[0.04] backdrop-blur-xl">
          <div className="max-w-4xl mx-auto px-8 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="lg" onClick={() => window.close()}>
                <X className="w-5 h-5" />
                {t('wizard.nav.cancel')}
              </Button>
              <Select
                value={uiLocale}
                onValueChange={(v) => {
                  const next = v as ShellLocale
                  setUiLocale(next)
                  void setAppLocale(next)
                }}
              >
                <SelectTrigger
                  className="w-[160px] shrink-0"
                  aria-label={t('shell.settings.language')}
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

            <div className="flex items-center gap-3">
              {currentStep === 1 && <ModelTestButton />}
              {stepDef.skippable && !isLastStep && (
                <Button variant="ghost" size="lg" onClick={store.nextStep}>
                  {t('wizard.nav.skip')}
                  <SkipForward className="w-5 h-5" />
                </Button>
              )}
              {!isFirstStep && (
                <Button variant="outline" size="lg" onClick={store.prevStep}>
                  <ChevronLeft className="w-5 h-5" />
                  {t('wizard.nav.previous')}
                </Button>
              )}
              {isLastStep ? (
                deployPhase === 'idle' || deployPhase === 'error' ? (
                  <Button
                    size="lg"
                    onClick={() => void store.triggerDeploy(t)}
                    disabled={isDeploying}
                  >
                    <Rocket className="w-5 h-5" />
                    {deployPhase === 'error' ? t('wizard.complete.retry') : t('wizard.complete.confirmStart')}
                  </Button>
                ) : isDeploying ? (
                  <Button size="lg" disabled>
                    <Rocket className="w-5 h-5" />
                    {t('shell.status.starting')}
                  </Button>
                ) : null
              ) : !isFirstStep ? (
                <Button
                  size="lg"
                  onClick={store.nextStep}
                  disabled={!canAdvance}
                >
                  {t('wizard.nav.next')}
                  <ChevronRight className="w-5 h-5" />
                </Button>
              ) : null}
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
