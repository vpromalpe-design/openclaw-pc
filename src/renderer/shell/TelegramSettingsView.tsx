import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Loader2, Send, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ShellLayout } from './ShellLayout'

export interface TelegramSettingsViewProps {
  /** Back navigation when embedded in parent layout */
  onBack?: () => void
}

function defaultNavigateBack() {
  window.location.hash = ''
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Telegram bot settings panel (v0.9.11, п.1.0.3): bot name, t.me link,
 * token with show/hide, «Test token» (getMe) and «Save & restart Gateway».
 */
export function TelegramSettingsView({ onBack }: TelegramSettingsViewProps = {}) {
  const { t } = useTranslation()
  const handleBack = onBack ?? defaultNavigateBack

  const [enabled, setEnabled] = useState(false)
  const [hasToken, setHasToken] = useState(false)
  const [allowFrom, setAllowFrom] = useState<string[]>([])
  const [botName, setBotName] = useState('')
  const [botUrl, setBotUrl] = useState('')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .telegramGet()
      .then((res) => {
        if (cancelled) return
        setEnabled(res.enabled)
        setHasToken(res.hasToken)
        setAllowFrom(res.allowFrom ?? [])
        setBotName(res.botName ?? '')
        setBotUrl(res.botUrl ?? '')
      })
      .catch(() => {
        if (!cancelled) setSaveError(t('shell.telegram.loadFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const runTokenTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.electronAPI.wizardTestTelegram({ botToken: token.trim() })
      if (res.ok) {
        setTestResult({ ok: true, text: `${res.botName ?? ''}`.trim() })
        // Auto-fill the t.me link from the bot username when the field is empty
        if (res.botName?.startsWith('@') && !botUrl.trim()) {
          setBotUrl(`t.me/${res.botName.slice(1)}`)
        }
      } else {
        setTestResult({ ok: false, text: t('shell.telegram.testFailed') })
      }
    } catch {
      setTestResult({ ok: false, text: t('shell.telegram.testFailed') })
    } finally {
      setTesting(false)
    }
  }, [token, botUrl, t])

  const runSave = useCallback(async () => {
    setSaveState('saving')
    setSaveError('')
    try {
      const res = await window.electronAPI.telegramSave({
        botToken: token.trim() || undefined,
        botName: botName.trim() || undefined,
        botUrl: botUrl.trim() || undefined,
      })
      if (res.ok) {
        setSaveState('saved')
        setHasToken(true)
        setEnabled(true)
      } else {
        setSaveState('error')
        setSaveError(res.error ?? '')
      }
    } catch (err) {
      setSaveState('error')
      setSaveError(String(err))
    }
  }, [token, botName, botUrl])

  return (
    <ShellLayout title={t('shell.telegram.title')} onBack={handleBack}>
      <div className="w-full max-w-2xl flex flex-col gap-5">
        {/* Status pill */}
        <div
          className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-1 text-xs font-medium ${
            enabled
              ? 'bg-green-500/15 text-green-700 dark:text-green-400'
              : 'bg-muted text-muted-foreground'
          }`}
          role="status"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-green-500' : 'bg-muted-foreground/60'}`}
          />
          {enabled ? t('shell.telegram.statusActive') : t('shell.telegram.statusInactive')}
        </div>

        <p className="text-xs text-muted-foreground">{t('shell.telegram.desc')}</p>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <label htmlFor="tg-bot-name" className="text-sm font-medium">
              {t('shell.telegram.botName')}
            </label>
            <Input
              id="tg-bot-name"
              value={botName}
              onChange={(e) => setBotName(e.target.value)}
              placeholder={t('shell.telegram.botNamePlaceholder')}
            />
            <p className="text-xs text-muted-foreground">{t('shell.telegram.botNameHint')}</p>
          </div>

          <div className="flex flex-col gap-0.5">
            <label htmlFor="tg-bot-url" className="text-sm font-medium">
              {t('shell.telegram.botUrl')}
            </label>
            <Input
              id="tg-bot-url"
              value={botUrl}
              onChange={(e) => setBotUrl(e.target.value)}
              placeholder={t('shell.telegram.botUrlPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">{t('shell.telegram.botUrlHint')}</p>
          </div>

          <div className="flex flex-col gap-0.5">
            <label htmlFor="tg-bot-token" className="text-sm font-medium">
              {t('shell.telegram.botToken')}
            </label>
            <div className="relative">
              <Input
                id="tg-bot-token"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value)
                  setTestResult(null)
                }}
                placeholder={hasToken ? t('shell.telegram.tokenSet') : t('shell.telegram.botTokenPlaceholder')}
                className="pr-10"
              />
              <button
                type="button"
                tabIndex={-1}
                aria-label={showToken ? t('shell.telegram.hideToken') : t('shell.telegram.showToken')}
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{t('shell.telegram.botTokenHint')}</p>
          </div>
        </div>

        {/* Test token */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runTokenTest()}
            disabled={testing || !token.trim()}
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
            {testing ? t('shell.telegram.testing') : t('shell.telegram.testToken')}
          </Button>
          {testResult && (
            <span
              className={`text-xs ${testResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
              role="status"
            >
              {testResult.ok ? `${t('shell.telegram.testOk')} ${testResult.text}` : testResult.text}
            </span>
          )}
        </div>

        {/* allowFrom warning */}
        {allowFrom.length === 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{t('shell.telegram.allowFromWarn')}</span>
          </div>
        )}

        {/* Save & restart gateway */}
        <div className="flex flex-col gap-2">
          <Button onClick={() => void runSave()} disabled={saveState === 'saving'} className="self-start">
            {saveState === 'saving' ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
            )}
            {saveState === 'saving' ? t('shell.telegram.saving') : t('shell.telegram.save')}
          </Button>
          {saveState === 'saved' && (
            <span className="text-xs text-green-600 dark:text-green-400" role="status">
              {t('shell.telegram.saved')}
            </span>
          )}
          {saveState === 'error' && (
            <span className="text-xs text-red-600 dark:text-red-400" role="alert">
              {t('shell.telegram.saveFailed')} {saveError}
            </span>
          )}
        </div>
      </div>
    </ShellLayout>
  )
}
