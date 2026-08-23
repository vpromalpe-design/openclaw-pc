import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Settings,
  Info,
  Key,
  Puzzle,
  RefreshCw,
  LayoutDashboard,
  ChevronLeft,
  Cpu,
  Mic,
  Loader2,
} from 'lucide-react'
import { LoadingView } from './LoadingView'
import { ErrorView, type ErrorType } from './ErrorView'
import { SettingsView } from './SettingsView'
import { VoiceSettingsView } from './VoiceSettingsView'
import { AboutView } from './AboutView'
import { DashboardView } from './DashboardView'
import { ProviderView } from './ProviderView'
import { ModelsView } from './ModelsView'
import { SkillsView } from './SkillsView'
import { UpdateView } from './UpdateView'
import { FeishuAccessView } from './FeishuAccessView'
import { TextChatView } from './TextChatView'
import { Bot, Type } from 'lucide-react'
import type { GatewayStatus, GatewayStatusValue } from '../../shared/types'
import { useUpdateNoticeStore } from '@/stores/update-store'
import { cn } from '@/lib/utils'

const TIMEOUT_MS = 300_000

/** Local-engine first-message banner auto-hide timeout (3 min). */
const BANNER_AUTO_HIDE_MS = 180_000

const STATUS_LABELS: Record<GatewayStatusValue, string> = {
  starting: 'Gateway is starting…',
  running: 'Gateway is ready',
  stopped: 'Waiting for Gateway to start…',
  error: 'Gateway failed to start',
}

interface ErrorInfo {
  errorType: ErrorType
  title: string
  detail?: string
}

export type EmbeddedPanel =
  | ''
  | 'settings'
  | 'voice'
  | 'about'
  | 'dashboard'
  | 'models'
  | 'llm-api'
  | 'skills'
  | 'updates'
  | 'feishu-settings'

export interface EmbeddedShellLayoutProps {
  activePanel: EmbeddedPanel
  onPanelChange: (panel: EmbeddedPanel) => void
}

function buildControlUIUrl(port: number, token?: string): string {
  let url = `http://127.0.0.1:${port}/`
  if (token && typeof token === 'string' && token.trim()) {
    url = `${url}#token=${encodeURIComponent(token.trim())}`
  }
  return url
}

/**
 * Prominent notice shown while the local GGUF engine is cold: the model is
 * being loaded into memory, the first message may take up to a minute.
 */
function LocalFirstRequestBanner({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="absolute left-1/2 top-4 z-40 w-[min(92vw,560px)] -translate-x-1/2">
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200/60 bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-3 shadow-xl shadow-amber-900/25">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-white" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">
            {t('shell.localFirstBanner.title')}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-50">
            {t('shell.localFirstBanner.text')}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-lg bg-white/25 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/40"
        >
          {t('shell.localFirstBanner.dismiss')}
        </button>
      </div>
    </div>
  )
}

const DESKTOP_NAV_ITEMS: { id: EmbeddedPanel; label: string; icon: React.ReactNode; description: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" />, description: 'Gateway status & versions' },
  { id: 'models', label: 'Models', icon: <Cpu className="w-4 h-4" />, description: 'Providers, priority & local models' },
  { id: 'llm-api', label: 'LLM API', icon: <Key className="w-4 h-4" />, description: 'Providers & auth profiles' },
  { id: 'skills', label: 'Skills', icon: <Puzzle className="w-4 h-4" />, description: 'Skills & extensions' },
  { id: 'updates', label: 'Updates', icon: <RefreshCw className="w-4 h-4" />, description: 'Check for updates' },
  { id: 'voice', label: 'Voice', icon: <Mic className="w-4 h-4" />, description: 'Voice provider & API key' },
  { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" />, description: 'Appearance & startup' },
  { id: 'about', label: 'About', icon: <Info className="w-4 h-4" />, description: 'Version info' },
]

/** Desktop nav item id → i18n key (used for the panel header breadcrumb). */
const NAV_I18N_KEY: Record<string, string> = {
  dashboard: 'shell.nav.dashboard',
  models: 'shell.nav.models',
  'llm-api': 'shell.nav.llmApi',
  skills: 'shell.nav.skills',
  updates: 'shell.nav.updates',
  voice: 'shell.nav.voice',
  settings: 'shell.nav.settings',
  about: 'shell.nav.about',
}

export function EmbeddedShellLayout({ activePanel, onPanelChange }: EmbeddedShellLayoutProps) {
  const { t } = useTranslation()
  const [gatewayView, setGatewayView] = useState<'loading' | 'error'>('loading')
  const [statusText, setStatusText] = useState('Gateway is starting…')
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const [gatewayPort, setGatewayPort] = useState<number | null>(null)
  const [controlUrl, setControlUrl] = useState<string | null>(null)
  /** Bumps when the gateway process restarts so the iframe remounts and opens a fresh WebSocket (same #token URL would otherwise not reload). */
  const [controlUiReloadKey, setControlUiReloadKey] = useState(0)
  const prevGatewayStatusRef = useRef<GatewayStatusValue | null>(null)
  const lastRunningPidRef = useRef<number | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [firstRequestPending, setFirstRequestPending] = useState(false)
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** v0.9.0: «Агентская задача» (embedded webchat) vs «Просто текст» (direct model call). */
  const [chatMode, setChatMode] = useState<'agent' | 'text'>('agent')
  const updateAvailable = useUpdateNoticeStore((state) => state.available)
  const updateDismissed = useUpdateNoticeStore((state) => state.dismissed)
  const updateInfo = useUpdateNoticeStore((state) => state.info)
  const setUpdateAvailable = useUpdateNoticeStore((state) => state.setUpdateAvailable)
  const dismissUpdateNotice = useUpdateNoticeStore((state) => state.dismissUpdateNotice)

  const clearTimeoutTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const showError = useCallback((info: ErrorInfo) => {
    clearTimeoutTimer()
    setTimedOut(false)
    setGatewayView('error')
    setErrorInfo(info)
  }, [clearTimeoutTimer])

  const startTimeoutTimer = useCallback(() => {
    clearTimeoutTimer()
    timeoutRef.current = setTimeout(() => {
      setTimedOut(true)
      setStatusText('Gateway did not become ready within 5 minutes. Please check logs or retry.')
    }, TIMEOUT_MS)
  }, [clearTimeoutTimer])

  const handleStatusUpdate = useCallback(
    (status: GatewayStatus) => {
      const prev = prevGatewayStatusRef.current
      prevGatewayStatusRef.current = status.status

      setStatusText(STATUS_LABELS[status.status])
      if (status.status === 'running') {
        clearTimeoutTimer()
        setGatewayView('loading')

        const resumedFromNonRunning = prev !== 'running'
        const pidChanged =
          status.pid != null &&
          lastRunningPidRef.current != null &&
          status.pid !== lastRunningPidRef.current
        const shouldReloadControlUi = resumedFromNonRunning || pidChanged
        if (status.pid != null) {
          lastRunningPidRef.current = status.pid
        }

        setGatewayPort(status.port)
        void (async () => {
          const port = status.port
          try {
            // Never block the console on a hung config IPC — fall back to URL without #token after 10s.
            const config = await Promise.race([
              window.electronAPI.configRead(),
              new Promise<undefined>((resolve) => {
                setTimeout(() => resolve(undefined), 10_000)
              }),
            ])
            const token = config?.gateway?.auth?.token
            const url = buildControlUIUrl(port, token)
            if (shouldReloadControlUi) {
              setControlUiReloadKey((k) => k + 1)
            }
            setControlUrl(url)
          } catch {
            if (shouldReloadControlUi) {
              setControlUiReloadKey((k) => k + 1)
            }
            setControlUrl(buildControlUIUrl(port))
          }
        })()
      } else {
        if (prev === 'running') {
          setGatewayPort(null)
          setControlUrl(null)
        }
        if (status.status === 'error') {
          showError({
            errorType: 'gateway-crash',
            title: 'Gateway service exited unexpectedly',
            detail: 'Please check Gateway configuration and logs, then retry.',
          })
        }
      }
    },
    [showError, clearTimeoutTimer],
  )

  useEffect(() => {
    let mounted = true
    const init = async () => {
      try {
        const status = await window.electronAPI.gatewayStatus()
        if (!mounted) return
        handleStatusUpdate(status)
        if (status.status === 'stopped') {
          startTimeoutTimer()
          try {
            await window.electronAPI.gatewayStart()
          } catch {
            if (!mounted) return
            showError({
              errorType: 'start-failure',
              title: 'Gateway failed to start',
              detail: 'Unable to start Gateway process. Please check installation integrity.',
            })
          }
        } else if (status.status === 'starting') {
          startTimeoutTimer()
        }
      } catch {
        if (!mounted) return
        showError({
          errorType: 'connection-error',
          title: 'Unable to connect to main process',
          detail: 'Internal communication failed. Please restart the application.',
        })
      }
    }
    void init()
    const unsub = window.electronAPI.onGatewayStatusChange((status) => {
      if (mounted) handleStatusUpdate(status)
    })
    return () => {
      mounted = false
      unsub()
      clearTimeoutTimer()
    }
  }, [handleStatusUpdate, startTimeoutTimer, clearTimeoutTimer, showError])

  const showFirstRequestBanner = useCallback(() => {
    setFirstRequestPending(true)
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current)
    bannerTimerRef.current = setTimeout(() => {
      setFirstRequestPending(false)
      bannerTimerRef.current = null
    }, BANNER_AUTO_HIDE_MS)
  }, [])

  const hideFirstRequestBanner = useCallback(() => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current)
    bannerTimerRef.current = null
    setFirstRequestPending(false)
  }, [])

  // Local-engine first-message banner: main reports 'start' when a local model
  // was cold-started (loading into memory), 'done' once the engine answered its
  // first chat request. On mount we poll the current state in case the event
  // fired before the window finished loading.
  useEffect(() => {
    let mounted = true
    const unsub = window.electronAPI.onLocalFirstRequest((phase) => {
      if (!mounted) return
      if (phase === 'start') showFirstRequestBanner()
      else hideFirstRequestBanner()
    })
    void window.electronAPI.localFirstRequestStatus().then((res) => {
      if (mounted && res?.pending) showFirstRequestBanner()
    })
    return () => {
      mounted = false
      unsub()
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current)
      bannerTimerRef.current = null
    }
  }, [showFirstRequestBanner, hideFirstRequestBanner])

  useEffect(() => {
    const unsub = window.electronAPI.onUpdateAvailable((info) => {
      const payload = info as { version?: string; releaseNotes?: string; releaseDate?: string }
      const version = payload?.version?.toString().trim()
      if (!version) return
      setUpdateAvailable({
        version,
        releaseNotes: payload.releaseNotes,
        publishedAt: payload.releaseDate,
      })
    })
    return () => {
      unsub()
    }
  }, [setUpdateAvailable])

  useEffect(() => {
    if (activePanel === 'updates') {
      dismissUpdateNotice()
    }
  }, [activePanel, dismissUpdateNotice])

  const handleRetry = async () => {
    setGatewayView('loading')
    setErrorInfo(null)
    setTimedOut(false)
    setStatusText('Restarting Gateway…')
    startTimeoutTimer()
    try {
      await window.electronAPI.gatewayRestart()
    } catch {
      showError({
        errorType: 'start-failure',
        title: 'Gateway restart failed',
        detail: 'Please check Gateway configuration and logs, then retry.',
      })
    }
  }

  const handleOpenLogDir = () => {
    void window.electronAPI.systemOpenLogDir()
  }

  const handleNavigateToPanel = (panel: EmbeddedPanel) => {
    onPanelChange(panel)
  }

  const showControlUIIframe = gatewayPort !== null && controlUrl !== null
  const hasActivePanel = activePanel !== ''
  const textModeActive = chatMode === 'text' && !hasActivePanel && showControlUIIframe

  if (gatewayView === 'error' && errorInfo) {
    return (
      <ErrorView
        errorType={errorInfo.errorType}
        title={errorInfo.title}
        detail={errorInfo.detail}
        onRetry={handleRetry}
        onOpenLogDir={handleOpenLogDir}
      />
    )
  }

  const renderPanelContent = () => {
    switch (activePanel) {
      case 'settings':
        return (
          <SettingsView
            onBack={() => onPanelChange('')}
            onOpenFeishuSettings={() => onPanelChange('feishu-settings')}
          />
        )
      case 'voice':
        return <VoiceSettingsView onBack={() => onPanelChange('')} />
      case 'about':
        return <AboutView onBack={() => onPanelChange('')} />
      case 'dashboard':
        return (
          <DashboardView
            onNavigateToSettings={() => handleNavigateToPanel('settings')}
            onNavigateToLlmApi={() => handleNavigateToPanel('llm-api')}
            onNavigateToSkills={() => handleNavigateToPanel('skills')}
            onNavigateToUpdates={() => handleNavigateToPanel('updates')}
            onNavigateToFeishuSettings={() => handleNavigateToPanel('feishu-settings')}
            updateAvailable={updateAvailable && !updateDismissed}
            updateVersion={updateInfo?.version}
            onDismissUpdateNotice={() => dismissUpdateNotice()}
          />
        )
      case 'llm-api':
        return <ProviderView onBack={() => onPanelChange('')} />
      case 'models':
        return <ModelsView onBack={() => onPanelChange('')} />
      case 'skills':
        return <SkillsView onBack={() => onPanelChange('')} />
      case 'updates':
        return (
          <UpdateView
            onBack={() => onPanelChange('')}
            updateAvailable={updateAvailable}
            updateVersion={updateInfo?.version}
            updateNotes={updateInfo?.releaseNotes}
            onDismissUpdateNotice={() => dismissUpdateNotice()}
          />
        )
      case 'feishu-settings':
        return <FeishuAccessView onBack={() => onPanelChange('settings')} />
      default:
        return null
    }
  }

  return (
    <main className="h-screen relative overflow-hidden select-none" role="main">
      {/* Liquid Glass background: living color blobs + noise (v0.9.0) */}
      <div className="liquid-glass-bg" aria-hidden>
        <div
          className="liquid-glass-blob"
          style={{
            width: '34vmax',
            height: '34vmax',
            left: '38%',
            top: '-14vmax',
            background: 'radial-gradient(circle, rgba(255,55,95,0.4), transparent 62%)',
            animation: 'blob-drift-1 24s ease-in-out infinite alternate',
          }}
        />
        <div
          className="liquid-glass-blob"
          style={{
            width: '30vmax',
            height: '30vmax',
            right: '-8vmax',
            bottom: '8vmax',
            background: 'radial-gradient(circle, rgba(48,209,88,0.32), transparent 60%)',
            animation: 'blob-drift-2 30s ease-in-out infinite alternate',
          }}
        />
      </div>
      {/* Full-screen Control UI iframe (always mounted when available).
          Do not use flex-1 on iframe: in column flex layouts the iframe often collapses to 0 height
          (only the dark shell body shows through — looks like a black window). */}
      {showControlUIIframe ? (
        <iframe
          key={`openclaw-control-ui-${controlUiReloadKey}`}
          src={controlUrl}
          title="OpenClaw Control UI"
          className={`absolute inset-0 z-0 h-full w-full border-0 bg-background ${
            hasActivePanel || textModeActive ? 'opacity-0 pointer-events-none' : ''
          }`}
          referrerPolicy="no-referrer"
          allowFullScreen
        />
      ) : (
        !hasActivePanel && (
          <div className="absolute inset-0 z-0 flex min-h-0 items-center justify-center overflow-auto p-4">
            <LoadingView
              variant="embedded"
              statusText={statusText}
              timedOut={timedOut}
              onRetry={handleRetry}
              hintText="Startup takes approximately 5 minutes, please wait."
            />
          </div>
        )
      )}

      {/* v0.9.0: plain-text chat mode (direct model call, no agent loop) */}
      {textModeActive && (
        <div className="absolute inset-0 z-20 flex min-h-0 flex-col bg-background/70 backdrop-blur-xl">
          <TextChatView />
        </div>
      )}

      {/* Desktop panel overlay: Liquid Glass — translucent frosted panel over the blob background */}
      {hasActivePanel && (
        <div className="absolute inset-0 z-30 flex min-h-0 flex-col bg-[rgba(11,16,32,0.66)] backdrop-blur-2xl">
          <div className="shrink-0 flex items-center gap-2 border-b border-white/10 bg-white/[0.04] px-4 py-2 backdrop-blur-xl">
            <button
              type="button"
              onClick={() => onPanelChange('')}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg px-2 py-1.5 hover:bg-muted"
              aria-label="Back to Control UI"
            >
              <ChevronLeft className="w-4 h-4" />
              Control UI
            </button>
            <span className="text-sm text-border">/</span>
            <span className="text-sm font-medium">
              {activePanel === 'feishu-settings'
                ? t('shell.feishu.title')
                : (() => {
                    const found = DESKTOP_NAV_ITEMS.find(
                      (item) => item.id === activePanel,
                    )
                    return found
                      ? t(NAV_I18N_KEY[found.id] ?? found.label, found.label)
                      : activePanel
                  })()}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{renderPanelContent()}</div>
        </div>
      )}

      {/* First-message hint for cold-started local models */}
      {firstRequestPending && (
        <LocalFirstRequestBanner onDismiss={hideFirstRequestBanner} />
      )}

      {/* v0.9.0: mode switch — «Агентская задача | Просто текст» (floating, above the composer) */}
      {showControlUIIframe && !hasActivePanel && (
        <div className="absolute bottom-32 left-1/2 z-40 -translate-x-1/2">
          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-[rgba(18,26,48,0.92)] p-1 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <button
              type="button"
              onClick={() => setChatMode('agent')}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors',
                chatMode === 'agent'
                  ? 'bg-[#0A84FF] text-white shadow-lg shadow-[#0A84FF]/30'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              title={t('shell.chat.agentModeHint')}
            >
              <Bot className="h-3.5 w-3.5" />
              {t('shell.chat.agentMode')}
            </button>
            <button
              type="button"
              onClick={() => setChatMode('text')}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors',
                chatMode === 'text'
                  ? 'bg-[#0A84FF] text-white shadow-lg shadow-[#0A84FF]/30'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              title={t('shell.chat.textModeHint')}
            >
              <Type className="h-3.5 w-3.5" />
              {t('shell.chat.textMode')}
            </button>
          </div>
        </div>
      )}
      {/* Terminal-style status bar (v0.9.0) */}
      {showControlUIIframe && (
        <div className="absolute bottom-0 left-0 right-0 z-40 flex h-6 items-center gap-3 border-t border-white/10 bg-[rgba(6,10,20,0.85)] px-3 font-mono text-[10px] tracking-wide text-green-400/90 backdrop-blur-xl">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                gatewayView === 'error' ? 'bg-red-400' : 'bg-green-400'
              } shadow-[0_0_6px_rgba(52,211,153,0.9)]`}
            />
            gateway:{gatewayView === 'error' ? 'error' : 'ready'}
          </span>
          {gatewayPort && <span>127.0.0.1:{gatewayPort}</span>}
          <span className="hidden sm:inline">mode:{chatMode}</span>
          <span className="ml-auto text-muted-foreground/70">openclaw-pc v0.9.1</span>
        </div>
      )}
    </main>
  )
}
