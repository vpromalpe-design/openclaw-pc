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
import { GatewayStep } from './steps/GatewayStep'
import { CompleteStep } from './steps/CompleteStep'
import { ChevronLeft, ChevronRight, SkipForward, Rocket } from 'lucide-react'
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
  GatewayStep,
  CompleteStep,
] as const

function initialLocaleFromI18n(): ShellLocale {
  const lng = i18n.language
  return (SHELL_SUPPORTED_LOCALES as readonly string[]).includes(lng)
    ? (lng as ShellLocale)
    : 'en'
}

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
    <div className="h-screen flex flex-col select-none bg-background">
      <header className="shrink-0 border-b border-border bg-muted/20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <img
                src={openclawLogo}
                alt="OpenClaw"
                className="w-8 h-8 shrink-0 rounded-lg object-contain"
              />
              <h1 className="text-2xl sm:text-3xl font-semibold leading-tight tracking-tight">
                {t('wizard.setupWizard')}
              </h1>
            </div>
            <Select
              value={uiLocale}
              onValueChange={(v) => {
                const next = v as ShellLocale
                setUiLocale(next)
                void setAppLocale(next)
              }}
            >
              <SelectTrigger className="w-full sm:w-[200px] shrink-0" aria-label={t('shell.settings.language')}>
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

          <StepIndicator
            steps={WIZARD_STEPS}
            currentStep={currentStep}
            completedSteps={completedSteps}
            onStepClick={store.goToStep}
          />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <StepContent />
        </div>
      </main>

      <footer className="shrink-0 border-t border-border bg-background">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div>
            {!isFirstStep && (
              <Button variant="outline" size="lg" onClick={store.prevStep}>
                <ChevronLeft className="w-5 h-5" />
                {t('wizard.nav.previous')}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {stepDef.skippable && !isLastStep && (
              <Button variant="ghost" size="lg" onClick={store.nextStep}>
                {t('wizard.nav.skip')}
                <SkipForward className="w-5 h-5" />
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
  )
}
