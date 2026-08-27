import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, XCircle, Loader2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWizardStore } from '@/stores/wizard-store'
import { canTestModel } from '@/utils/model-test'

/**
 * Wizard footer «Проверить подключение» button (v0.9.14): lives in the footer,
 * right before «Далее», while the test state is kept in the wizard store so the
 * Model step can render hints and reset it on config changes.
 */
export function ModelTestButton() {
  const { t } = useTranslation()
  const modelConfig = useWizardStore((s) => s.modelConfig)
  const testState = useWizardStore((s) => s.testState)
  const setTestState = useWizardStore((s) => s.setTestState)

  const canTest = canTestModel(modelConfig)

  const handleTestConnection = useCallback(async () => {
    setTestState({ status: 'testing', message: '' })
    try {
      const result = await window.electronAPI.wizardTestModel(modelConfig)
      if (result.ok) {
        setTestState({ status: 'success', message: t('wizard.model.connectionSuccess') })
      } else {
        setTestState({
          status: 'error',
          message: result.message ?? t('wizard.model.connectionFailed'),
        })
      }
    } catch {
      setTestState({
        status: 'error',
        message: t('wizard.model.networkError'),
      })
    }
  }, [modelConfig, setTestState, t])

  return (
    <>
      <Button
        variant="outline"
        size="lg"
        onClick={() => void handleTestConnection()}
        disabled={!canTest || testState.status === 'testing'}
        className={[testState.status === 'success' && 'btn-success'].join(' ')}
      >
        {testState.status === 'testing' ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : testState.status === 'success' ? (
          <CheckCircle2 className="w-5 h-5" />
        ) : (
          <Zap className="w-5 h-5" />
        )}
        {testState.status === 'testing'
          ? t('wizard.model.testing')
          : testState.status === 'success'
            ? t('wizard.model.connected')
            : t('wizard.model.testConnection')}
      </Button>

      {testState.status === 'error' && (
        <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
          <XCircle className="w-4 h-4 shrink-0" />
          <span className="max-w-[240px] leading-tight">{testState.message}</span>
        </span>
      )}
    </>
  )
}
