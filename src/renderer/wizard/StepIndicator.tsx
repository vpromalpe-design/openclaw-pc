import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Check, Sparkles, Bot, MessageSquare, Mic, Server, Rocket } from 'lucide-react'
import type { WizardStepDef } from '@/stores/wizard-store'

interface StepIndicatorProps {
  steps: readonly WizardStepDef[]
  currentStep: number
  completedSteps: boolean[]
  onStepClick: (step: number) => void
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  welcome: <Sparkles className="w-4 h-4" />,
  model: <Bot className="w-4 h-4" />,
  channel: <MessageSquare className="w-4 h-4" />,
  voice: <Mic className="w-4 h-4" />,
  gateway: <Server className="w-4 h-4" />,
  complete: <Rocket className="w-4 h-4" />,
}

/**
 * Vertical step list for the installer-style sidebar (v0.9.14).
 * Same semantics as the old horizontal stepper: current step is
 * highlighted, completed steps are check-marked, clicks navigate
 * only to reachable steps (via onStepClick → store.goToStep).
 */
export function StepIndicator({
  steps,
  currentStep,
  completedSteps,
  onStepClick,
}: StepIndicatorProps) {
  const { t } = useTranslation()

  return (
    <nav aria-label="Wizard steps" className="mt-6 flex flex-1 flex-col gap-1.5 px-4 pb-4">
      {steps.map((step, index) => {
        const isCompleted = completedSteps[index]
        const isCurrent = index === currentStep
        const isClickable = index <= currentStep || isCompleted
        const stepLabel = t(`wizard.steps.${step.id}`)

        return (
          <button
            key={step.id}
            type="button"
            onClick={() => isClickable && onStepClick(index)}
            disabled={!isClickable}
            aria-current={isCurrent ? 'step' : undefined}
            aria-label={`Step ${index + 1}: ${stepLabel}${isCompleted ? ' (completed)' : isCurrent ? ' (current)' : ''}`}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-semibold transition-colors',
              isCurrent &&
                'border border-[rgba(10,132,255,0.5)] bg-gradient-to-b from-[rgba(10,132,255,0.28)] to-[rgba(10,132,255,0.14)] text-[#F2F4F8] shadow-[0_4px_16px_rgba(10,132,255,0.18)]',
              isCompleted && !isCurrent && 'text-[rgba(242,244,248,0.92)]',
              !isCurrent &&
                !isCompleted &&
                (isClickable
                  ? 'text-[rgba(242,244,248,0.88)] hover:bg-white/5'
                  : 'cursor-not-allowed text-[rgba(242,244,248,0.5)] opacity-70'),
            )}
          >
            <span
              className={cn(
                'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] border',
                isCurrent
                  ? 'border-[#0A84FF] bg-[#0A84FF] text-white shadow-[0_0_14px_rgba(10,132,255,0.55)]'
                  : isCompleted
                    ? 'border-[rgba(10,132,255,0.45)] bg-[rgba(10,132,255,0.22)] text-[#5AC8FA]'
                    : 'border-white/10 bg-white/[0.06]',
              )}
            >
              {isCompleted && !isCurrent ? <Check className="w-4 h-4" /> : STEP_ICONS[step.id]}
            </span>

            <span className="min-w-0 flex-1 truncate">{stepLabel}</span>

            <span
              className={cn(
                'text-[11px] font-bold',
                isCurrent
                  ? 'text-white/60'
                  : isCompleted
                    ? 'text-[rgba(242,244,248,0.5)]'
                    : 'text-[rgba(242,244,248,0.4)]',
              )}
            >
              {index + 1}/{steps.length}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
