import { useTranslation } from 'react-i18next'
import { useWizardStore } from '@/stores/wizard-store'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, XCircle, Rocket } from 'lucide-react'
import { tuk } from '@/lib/sounds'

/**
 * Wizard step 5: done (v0.9.17).
 * Простое завершение — крупный текст «Настройка завершена!» и кнопка
 * «Запустить OpenClaw PC», без сводок и полей настроек. Deploy-логика
 * (write config → start gateway → redirect) не менялась.
 */
export function CompleteStep() {
  const { t } = useTranslation()
  const store = useWizardStore()
  const { deployPhase, deployMessage } = store

  const isDeploying = deployPhase === 'writing' || deployPhase === 'starting'

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center text-center min-h-[52vh] justify-center">
      {/* Success orb */}
      <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-[#0A84FF] text-4xl shadow-[0_18px_50px_rgba(48,209,88,0.35),inset_0_1px_0_rgba(255,255,255,0.5)]">
        <CheckCircle2 className="h-12 w-12 text-white" />
      </div>

      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
        {t('wizard.complete.doneTitle')}
      </h2>

      <p className="mt-4 text-sm sm:text-base text-muted-foreground leading-relaxed max-w-md">
        {t('wizard.complete.doneText')}
      </p>

      {/* Deploy status */}
      {isDeploying && (
        <div className="mt-8 flex w-full items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
          <span className="text-primary">{deployMessage}</span>
          {deployPhase === 'starting' && (
            <span className="text-muted-foreground text-xs">({t('wizard.complete.startHint')})</span>
          )}
        </div>
      )}

      {deployPhase === 'success' && (
        <div className="mt-8 flex w-full items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-emerald-600">{deployMessage}</span>
        </div>
      )}

      {deployPhase === 'error' && (
        <div className="mt-8 flex w-full items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
          <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <span className="text-sm text-destructive">{deployMessage}</span>
        </div>
      )}

      {/* Launch */}
      {deployPhase !== 'success' && (
        <Button
          size="lg"
          className="mt-8 text-base px-8 py-6"
          onClick={() => {
            tuk()
            void store.triggerDeploy(t)
          }}
          disabled={isDeploying}
        >
          <Rocket className="w-5 h-5" />
          {deployPhase === 'error' ? t('wizard.complete.retry') : t('wizard.complete.launch')}
        </Button>
      )}
    </div>
  )
}
