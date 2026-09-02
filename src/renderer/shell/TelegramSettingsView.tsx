import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  MessageCircle,
  Plus,
  Send,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ShellLayout } from './ShellLayout'
import { TelegramGlyph } from '@/components/TelegramGlyph'
import type { TelegramBotAccountRow } from '../../shared/types'

export interface TelegramSettingsViewProps {
  /** Back navigation when embedded in parent layout */
  onBack?: () => void
  /** Called after a bot was added/removed so the parent refreshes the agent list */
  onAgentsChanged?: () => void
}

function defaultNavigateBack() {
  window.location.hash = ''
}

type SaveState = 'idle' | 'busy' | 'saved' | 'error'

/**
 * Telegram bots panel (v0.9.31): a list of connected bots. Adding a bot
 * atomically creates a Telegram account + an agent with the bot's name +
 * a binding (account → agent), then restarts the gateway. Removing a bot
 * only unlinks it — the agent (with its Telegram badge) survives and is
 * deleted manually in the agent list, if ever needed.
 */
export function TelegramSettingsView({ onBack, onAgentsChanged }: TelegramSettingsViewProps = {}) {
  const { t } = useTranslation()
  const handleBack = onBack ?? defaultNavigateBack

  const [bots, setBots] = useState<TelegramBotAccountRow[]>([])
  const [allowFrom, setAllowFrom] = useState<string[]>([])
  const [loadError, setLoadError] = useState('')

  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  const [busyState, setBusyState] = useState<SaveState>('idle')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [errorText, setErrorText] = useState('')

  /** accountId awaiting the second «really delete» click */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reload = useCallback(async () => {
    try {
      const res = await window.electronAPI.telegramGet()
      setBots(res.bots ?? [])
      setAllowFrom(res.allowFrom ?? [])
      setLoadError('')
    } catch {
      setLoadError(t('shell.telegram.loadFailed'))
    }
  }, [t])

  useEffect(() => {
    void reload()
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    }
  }, [reload])

  /** Friendly text for known error codes returned by the main process. */
  const describeError = useCallback(
    (code: string): string => {
      const known: Record<string, string> = {
        'missing-token': t('shell.telegram.errors.missingToken'),
        'malformed-token': t('shell.telegram.errors.malformedToken'),
        'invalid-token': t('shell.telegram.errors.invalidToken'),
        'network-blocked': t('shell.telegram.errors.networkBlocked'),
        'network-through-proxy': t('shell.telegram.errors.networkThroughProxy'),
        'proxy-unsupported': t('shell.telegram.errors.proxyUnsupported'),
        duplicate: t('shell.telegram.errors.duplicate'),
        'already-added': t('shell.telegram.errors.alreadyAdded'),
      }
      if (known[code]) return known[code]
      if (code.startsWith('http-') || code.startsWith('error:')) {
        return t('shell.telegram.errors.http')
      }
      return code
    },
    [t],
  )

  const runTokenTest = useCallback(async () => {
    const trimmed = token.trim()
    if (!trimmed || testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.electronAPI.wizardTestTelegram({ botToken: trimmed })
      if (res.ok) {
        setTestResult({ ok: true, text: `${res.botName ?? ''}`.trim() })
      } else {
        setTestResult({ ok: false, text: describeError(res.message ?? 'invalid-token') })
      }
    } catch {
      setTestResult({ ok: false, text: t('shell.telegram.testFailed') })
    } finally {
      setTesting(false)
    }
  }, [token, testing, describeError, t])

  const runAdd = useCallback(async () => {
    const trimmed = token.trim()
    if (!trimmed || busyState === 'busy') return
    setBusyState('busy')
    setErrorText('')
    setNotice(null)
    try {
      const res = await window.electronAPI.telegramAddBot({ botToken: trimmed })
      if (res.ok) {
        const name = res.username ?? res.accountId ?? ''
        setNotice({
          ok: true,
          text: `${t('shell.telegram.added')} ${name} — ${t('shell.telegram.agentCreated')}`,
        })
        setToken('')
        setTestResult(null)
        setShowAdd(false)
        await reload()
        onAgentsChanged?.()
      } else {
        setBusyState('error')
        setErrorText(describeError(res.error ?? 'unknown'))
      }
    } catch (err) {
      setBusyState('error')
      setErrorText(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyState('idle')
    }
  }, [token, busyState, describeError, t, reload, onAgentsChanged])

  const runRemove = useCallback(
    async (accountId: string) => {
      if (busyState === 'busy') return
      if (confirmRemove !== accountId) {
        setConfirmRemove(accountId)
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
        confirmTimerRef.current = setTimeout(() => setConfirmRemove(null), 4000)
        return
      }
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      setConfirmRemove(null)
      setBusyState('busy')
      setErrorText('')
      setNotice(null)
      try {
        const res = await window.electronAPI.telegramRemoveBot({ accountId })
        if (res.ok) {
          setNotice({ ok: true, text: t('shell.telegram.removed') })
          await reload()
          onAgentsChanged?.()
        } else {
          setBusyState('error')
          setErrorText(describeError(res.error ?? 'unknown'))
        }
      } catch (err) {
        setBusyState('error')
        setErrorText(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyState('idle')
      }
    },
    [busyState, confirmRemove, describeError, t, reload, onAgentsChanged],
  )

  const openBotLink = useCallback((bot: TelegramBotAccountRow) => {
    const username = (bot.username ?? '').replace(/^@/, '')
    if (username) void window.electronAPI.systemOpenExternal(`https://t.me/${username}`)
  }, [])

  const anyEnabled = bots.some((b) => b.enabled && b.hasToken)
  const statusActive = anyEnabled || (bots.length === 0 ? false : bots.some((b) => b.hasToken))

  return (
    <ShellLayout title={t('shell.telegram.title')} onBack={handleBack}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        {/* Status pill */}
        <div
          className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-1 text-xs font-medium ${
            statusActive
              ? 'bg-green-500/15 text-green-700 dark:text-green-400'
              : 'bg-muted text-muted-foreground'
          }`}
          role="status"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${statusActive ? 'bg-green-500' : 'bg-muted-foreground/60'}`}
          />
          {statusActive ? t('shell.telegram.statusActive') : t('shell.telegram.statusInactive')}
        </div>

        <p className="text-xs text-muted-foreground">{t('shell.telegram.desc')}</p>

        {loadError && <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>}

        {/* Bot list */}
        {bots.length === 0 ? (
          <div className="rounded-xl border border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
            {t('shell.telegram.noBots')}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {bots.map((bot) => {
              const agentId = bot.agentId
              const usernameClean = (bot.username ?? '').replace(/^@/, '')
              const removing = confirmRemove === bot.accountId
              return (
                <div
                  key={bot.accountId}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card/50 px-3.5 py-3"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#229ED9]/15 text-[#229ED9]">
                    <TelegramGlyph size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {bot.username ?? bot.name ?? (bot.isDefault ? t('shell.telegram.defaultBot') : bot.accountId)}
                      </span>
                      {bot.isDefault && (
                        <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                          {t('shell.telegram.defaultBadge')}
                        </span>
                      )}
                      {bot.enabled ? (
                        <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                          {t('shell.telegram.live')}
                        </span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {t('shell.telegram.off')}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {bot.hasAgentLink && agentId ? (
                        <>
                          <TelegramGlyph size={11} className="text-[#229ED9]" />
                          <span>
                            {t('shell.telegram.agent')}: {agentId}
                          </span>
                        </>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <MessageCircle size={11} />
                          {bot.isDefault
                            ? t('shell.telegram.servesMain')
                            : t('shell.telegram.noAgent')}
                        </span>
                      )}
                    </div>
                  </div>
                  {usernameClean && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('shell.telegram.openBot')}
                      onClick={() => openBotLink(bot)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant={removing ? 'destructive' : 'ghost'}
                    size="sm"
                    disabled={busyState === 'busy'}
                    onClick={() => void runRemove(bot.accountId)}
                    title={t('shell.telegram.removeTitle')}
                    className={removing ? '' : 'text-muted-foreground hover:text-red-600'}
                  >
                    {removing ? (
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    {removing ? t('shell.telegram.confirmRemove') : ''}
                  </Button>
                </div>
              )
            })}
          </div>
        )}

        <p className="flex items-start gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('shell.telegram.removeHint')}</span>
        </p>

        {/* allowFrom warning */}
        {allowFrom.length === 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t('shell.telegram.allowFromWarn')}</span>
          </div>
        )}

        {/* Add bot */}
        {!showAdd ? (
          <Button variant="outline" className="self-start" onClick={() => setShowAdd(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('shell.telegram.addBot')}
          </Button>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <TelegramGlyph size={16} className="text-[#229ED9]" />
              {t('shell.telegram.addTitle')}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="tg-new-token" className="text-xs font-medium text-muted-foreground">
                {t('shell.telegram.botToken')}
              </label>
              <div className="relative">
                <Input
                  id="tg-new-token"
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value)
                    setTestResult(null)
                  }}
                  placeholder="123456:AA... (от @BotFather)"
                  className="pr-10"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runAdd()
                  }}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={showToken ? t('shell.telegram.hideToken') : t('shell.telegram.showToken')}
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{t('shell.telegram.addHint')}</p>
            </div>

            {/* Test token */}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runTokenTest()}
                disabled={testing || !token.trim() || busyState === 'busy'}
              >
                {testing ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="mr-1 h-3.5 w-3.5" />
                )}
                {testing ? t('shell.telegram.testing') : t('shell.telegram.testToken')}
              </Button>
              {testResult && (
                <span
                  className={`text-xs ${
                    testResult.ok
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                  role="status"
                >
                  {testResult.ok ? `${t('shell.telegram.testOk')} ${testResult.text}` : testResult.text}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={() => void runAdd()} disabled={busyState === 'busy' || !token.trim()}>
                {busyState === 'busy' ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-4 w-4" />
                )}
                {busyState === 'busy' ? t('shell.telegram.adding') : t('shell.telegram.addAndRestart')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)} disabled={busyState === 'busy'}>
                {t('shell.telegram.cancel')}
              </Button>
            </div>
          </div>
        )}

        {/* Notices */}
        {notice && (
          <span
            className={`text-xs ${notice.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
            role="status"
          >
            {notice.text}
          </span>
        )}
        {errorText && (
          <span className="text-xs text-red-600 dark:text-red-400" role="alert">
            {t('shell.telegram.saveFailed')} {errorText}
          </span>
        )}
      </div>
    </ShellLayout>
  )
}
