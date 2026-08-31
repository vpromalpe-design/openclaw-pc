import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Shield,
  Globe,
  Radio,
  Save,
} from 'lucide-react'
import { ShellLayout } from './ShellLayout'
import { tuk } from '@/lib/sounds'
import { generateAuthToken } from '@/stores/wizard-store'

// v0.9.17: настройки шлюза перенесены из мастера сюда (⚙️ → «Шлюз (Gateway)»).
// Читаем/пишем gateway-секцию открытого openclaw.json через configRead/configWrite
// и перезапускаем gateway, чтобы изменения применились.

type BindValue = 'loopback' | 'lan' | 'auto'

interface BindOption {
  value: BindValue
  labelKey: string
  tagKey?: string
  icon: React.ReactNode
  descriptionKey: string
}

const BIND_OPTIONS: readonly BindOption[] = [
  {
    value: 'loopback',
    labelKey: 'wizard.gateway.loopback',
    tagKey: 'wizard.gateway.recommended',
    icon: <Shield className="w-4 h-4" />,
    descriptionKey: 'wizard.gateway.loopbackDesc',
  },
  {
    value: 'lan',
    labelKey: 'wizard.gateway.lan',
    icon: <Radio className="w-4 h-4" />,
    descriptionKey: 'wizard.gateway.lanDesc',
  },
  {
    value: 'auto',
    labelKey: 'wizard.gateway.auto',
    icon: <Globe className="w-4 h-4" />,
    descriptionKey: 'wizard.gateway.autoDesc',
  },
] as const

type PortCheckStatus = 'idle' | 'checking' | 'available' | 'occupied' | 'error'

interface PortCheckState {
  status: PortCheckStatus
  message: string
  suggestedPort?: number
}

const MAX_PORT_SCAN = 100

export interface GatewaySettingsViewProps {
  onBack?: () => void
}

export function GatewaySettingsView({ onBack }: GatewaySettingsViewProps) {
  const { t } = useTranslation()
  const [port, setPort] = useState(18789)
  const [bind, setBind] = useState<BindValue>('loopback')
  const [authToken, setAuthToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null)
  const [portCheck, setPortCheck] = useState<PortCheckState>({ status: 'idle', message: '' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const cfg = (await window.electronAPI.configRead()) as {
          gateway?: { port?: number; bind?: BindValue; auth?: { token?: string } }
        }
        if (cancelled) return
        setPort(cfg?.gateway?.port ?? 18789)
        setBind(cfg?.gateway?.bind ?? 'loopback')
        setAuthToken(cfg?.gateway?.auth?.token ?? '')
      } catch {
        if (!cancelled) setAuthToken('')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handlePortChange = useCallback((value: string) => {
    const num = parseInt(value, 10)
    if (!Number.isNaN(num)) {
      setPort(Math.min(65535, Math.max(0, num)))
    } else if (value === '') {
      setPort(0)
    }
    setPortCheck({ status: 'idle', message: '' })
  }, [])

  const handleCheckPort = useCallback(async () => {
    if (port < 1024 || port > 65535) {
      setPortCheck({ status: 'error', message: t('wizard.gateway.portRange') })
      return
    }
    setPortCheck({ status: 'checking', message: '' })
    try {
      const result = await window.electronAPI.portCheck(port)
      if (result.available) {
        setPortCheck({ status: 'available', message: t('wizard.gateway.portAvailable', { port }) })
        return
      }
      const pidInfo = result.pid ? ` (PID: ${result.pid})` : ''
      let suggestedPort: number | undefined
      for (let p = port + 1; p <= Math.min(port + MAX_PORT_SCAN, 65535); p++) {
        const check = await window.electronAPI.portCheck(p)
        if (check.available) {
          suggestedPort = p
          break
        }
      }
      setPortCheck({
        status: 'occupied',
        message: `${t('wizard.gateway.portOccupied', { port })}${pidInfo}`,
        suggestedPort,
      })
    } catch {
      setPortCheck({ status: 'error', message: t('wizard.gateway.portCheckFailed') })
    }
  }, [port, t])

  const handleSave = useCallback(async () => {
    if (port < 1024 || port > 65535) {
      setSaveResult({ kind: 'err', message: t('wizard.gateway.portRange') })
      return
    }
    if (!authToken.trim()) {
      setSaveResult({ kind: 'err', message: t('wizard.gateway.tokenRequired') })
      return
    }
    setSaving(true)
    setSaveResult(null)
    try {
      const cfg = (await window.electronAPI.configRead()) as Record<string, unknown>
      const gateway = (cfg.gateway ?? {}) as Record<string, unknown>
      await window.electronAPI.configWrite({
        ...cfg,
        gateway: {
          ...gateway,
          mode: 'local',
          port,
          bind,
          auth: { mode: 'token', token: authToken.trim() },
          controlUi: {
            allowInsecureAuth: true,
            dangerouslyDisableDeviceAuth: true,
            ...(bind === 'loopback' ? { allowedOrigins: ['*'] } : {}),
          },
        },
      })
      try {
        await window.electronAPI.gatewayRestart()
      } catch {
        // Restart failure is non-fatal: the new config takes effect on next launch.
      }
      setSaveResult({ kind: 'ok', message: t('wizard.gateway.saved') })
    } catch (e) {
      setSaveResult({ kind: 'err', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }, [port, bind, authToken, t])

  const portOutOfRange = port !== 0 && (port < 1024 || port > 65535)

  return (
    <ShellLayout title={t('wizard.gateway.title')} onBack={onBack ?? (() => {})}>
      <div className="space-y-4">
        <p className="text-xs sm:text-sm text-muted-foreground">
          {t('wizard.gateway.settingsSubtitle')}
        </p>

        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2" role="status">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            {t('voice.stt.loading')}
          </p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
              {/* Port */}
              <fieldset className="space-y-1.5">
                <label htmlFor="gateway-port" className="text-sm font-medium">
                  {t('wizard.gateway.port')} <span className="text-destructive">*</span>
                </label>
                <div className="flex items-center gap-3">
                  <Input
                    id="gateway-port"
                    type="number"
                    min={1024}
                    max={65535}
                    value={port || ''}
                    onChange={(e) => handlePortChange(e.target.value)}
                    placeholder="18789"
                    className="w-32 font-mono tabular-nums"
                  />
                  <Button
                    variant={portCheck.status === 'available' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => void handleCheckPort()}
                    disabled={portCheck.status === 'checking' || port === 0}
                    className={[
                      portCheck.status === 'available' &&
                        'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700 hover:text-white shadow-sm shadow-emerald-600/30',
                    ].join(' ')}
                  >
                    {portCheck.status === 'checking' ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Shield className="w-4 h-4" />
                    )}
                    {portCheck.status === 'checking'
                      ? t('wizard.gateway.checking')
                      : portCheck.status === 'available'
                        ? t('wizard.gateway.free')
                        : t('wizard.gateway.checkPort')}
                  </Button>
                </div>

                {portOutOfRange && (
                  <p className="text-xs text-destructive flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5" />
                    {t('wizard.gateway.portRange')}
                  </p>
                )}
                {portCheck.status === 'available' && (
                  <p className="text-xs text-emerald-600 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {portCheck.message}
                  </p>
                )}
                {portCheck.status === 'occupied' && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-amber-600 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {portCheck.message}
                    </p>
                    {portCheck.suggestedPort && (
                      <button
                        type="button"
                        onClick={() => {
                          setPort(portCheck.suggestedPort ?? port)
                          setPortCheck({
                            status: 'available',
                            message: t('wizard.gateway.useSuggested', { port: portCheck.suggestedPort }),
                          })
                        }}
                        className="text-xs text-primary hover:underline"
                      >
                        {t('wizard.gateway.useSuggested', { port: portCheck.suggestedPort })}
                      </button>
                    )}
                  </div>
                )}
                {portCheck.status === 'error' && (
                  <p className="text-xs text-destructive flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5" />
                    {portCheck.message}
                  </p>
                )}
              </fieldset>

              {/* Auth Token */}
              <fieldset className="space-y-1.5">
                <label htmlFor="gateway-token" className="text-sm font-medium">
                  {t('wizard.gateway.authToken')} <span className="text-destructive">*</span>
                </label>
                <div className="flex items-center gap-3">
                  <Input
                    id="gateway-token"
                    type="text"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder={t('wizard.gateway.authToken')}
                    className="flex-1 font-mono"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      tuk()
                      setAuthToken(generateAuthToken())
                    }}
                    aria-label={t('wizard.gateway.regenerate')}
                  >
                    <RefreshCw className="w-4 h-4" />
                    {t('wizard.gateway.regenerate')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('wizard.gateway.tokenHint')}</p>
              </fieldset>
            </div>

            {/* Bind Address */}
            <fieldset className="space-y-2.5">
              <legend className="text-sm font-medium">
                {t('wizard.gateway.bindAddress')} <span className="text-destructive">*</span>
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3" role="radiogroup" aria-label="Bind address selection">
                {BIND_OPTIONS.map((opt) => {
                  const isSelected = bind === opt.value
                  return (
                    <div key={opt.value} className="flex flex-col gap-1.5 min-w-0">
                      <label
                        className={[
                          'flex flex-col items-start gap-2 rounded-lg border p-2.5 sm:p-3 cursor-pointer transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/30',
                        ].join(' ')}
                      >
                        <div className="flex items-center gap-2 w-full">
                          <input
                            type="radio"
                            name="gateway-bind"
                            value={opt.value}
                            checked={isSelected}
                            onChange={() => {
                              tuk()
                              setBind(opt.value)
                            }}
                            className="h-4 w-4 accent-primary shrink-0"
                          />
                          <span className="text-sm font-medium flex items-center gap-1.5 flex-1">
                            <span className="text-muted-foreground">{opt.icon}</span>
                            {t(opt.labelKey)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed pl-6">
                          {t(opt.descriptionKey)}
                        </p>
                      </label>
                      {opt.tagKey && (
                        <p className="text-xs font-semibold text-primary bg-primary/10 rounded-md px-2 py-1 text-center tracking-wide">
                          {t(opt.tagKey)}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </fieldset>

            {saveResult && (
              <p
                className={[
                  'text-xs flex items-center gap-1.5',
                  saveResult.kind === 'ok' ? 'text-emerald-600' : 'text-destructive',
                ].join(' ')}
                role={saveResult.kind === 'ok' ? 'status' : 'alert'}
              >
                {saveResult.kind === 'ok' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                {saveResult.message}
              </p>
            )}

            <div className="flex items-center justify-end gap-3">
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  tuk()
                  onBack?.()
                }}
              >
                {t('wizard.nav.cancel')}
              </Button>
              <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                {t('wizard.gateway.save')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ShellLayout>
  )
}
