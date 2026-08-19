import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Check, Sparkles, Bot, MessageSquare, Server, Rocket } from 'lucide-react'
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
  gateway: <Server className="w-4 h-4" />,
  complete: <Rocket className="w-4 h-4" />,
}

export function StepIndicator({
  steps,
  currentStep,
  completedSteps,
  onStepClick,
}: StepIndicatorProps) {
  const { t } = useTranslation()

  return (
    <nav aria-label="Wizard steps" className="w-full">
      <ol className="flex items-start relative">
        {steps.map((step, index) => {
          const isCompleted = completedSteps[index]
          const isCurrent = index === currentStep
          const isClickable = index <= currentStep || isCompleted
          const isLast = index === steps.length - 1
          const stepLabel = t(`wizard.steps.${step.id}`)

          return (
            <li
              key={step.id}
              className="flex items-start"
              style={{ flex: isLast ? '0 0 auto' : '1 1 0' }}
            >
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => isClickable && onStepClick(index)}
                  disabled={!isClickable}
                  className={cn(
                    'w-7 h-10 rounded-[10px] flex items-center justify-center text-xs font-semibold transition-colors shrink-0 border-2 relative',
                    isCurrent &&
                      'border-primary bg-primary text-primary-foreground shadow-sm',
                    isCompleted &&
                      !isCurrent &&
                      'border-primary bg-primary text-primary-foreground',
                    !isCurrent &&
                      !isCompleted &&
                      'border-border bg-background text-muted-foreground',
                    isClickable && !isCurrent && 'cursor-pointer',
                    !isClickable && 'opacity-50 cursor-not-allowed',
                  )}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`Step ${index + 1}: ${stepLabel}${isCompleted ? ' (completed)' : isCurrent ? ' (current)' : ''}`}
                >
                  {isCompleted && !isCurrent ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    STEP_ICONS[step.id] ?? index + 1
                  )}
                </button>

                {/* Label directly under the bar */}
                <span
                  className={cn(
                    'text-[11px] mt-1.5 select-none text-center whitespace-nowrap transition-colors',
                    isCurrent && 'text-foreground font-semibold',
                    isCompleted && !isCurrent && 'text-foreground/70 font-medium',
                    !isCurrent && !isCompleted && 'text-muted-foreground',
                  )}
                >
                  {stepLabel}
                </span>
              </div>

              {/* Connector line, vertically centered on the bar */}
              {!isLast && (
                <div className="flex-1 h-0.5 mt-[19px] mx-2 overflow-hidden rounded-full">
                  <div
                    className={cn(
                      'h-full rounded-full transition-colors duration-300',
                      completedSteps[index] ? 'bg-primary' : 'bg-border',
                    )}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
