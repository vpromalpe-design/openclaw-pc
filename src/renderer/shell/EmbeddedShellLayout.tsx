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
import { installShellSounds } from '@/lib/sounds'

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

/** Control UI route ids we link to from the sidebar («Разделы»). */
type ControlRoute = '/chat' | '/overview' | '/activity' | '/sessions' | '/cron' | '/tasks' | '/skills'

/** Sidebar «Разделы» item: either a Control UI route or one of our panels. */
interface SectionItem {
  id: string
  icon: string
  label: string
  route?: ControlRoute
  panel?: EmbeddedPanel
}

const SECTIONS: SectionItem[] = [
  { id: 'chat', icon: '💬', label: 'Чат', route: '/chat' },
  { id: 'models', icon: '🧠', label: 'Модели', panel: 'models' },
  { id: 'voice', icon: '🎙️', label: 'Голос', panel: 'voice' },
  { id: 'overview', icon: '🗺️', label: 'Обзор', route: '/overview' },
  { id: 'activity', icon: '📈', label: 'Активность', route: '/activity' },
  { id: 'sessions', icon: '📟', label: 'Сеансы', route: '/sessions' },
  { id: 'cron', icon: '⏰', label: 'Задания Cron', route: '/cron' },
  { id: 'tasks', icon: '✅', label: 'Задачи', route: '/tasks' },
  { id: 'skills', icon: '🧩', label: 'Навыки', route: '/skills' },
]

const AGENT_ICONS: Record<string, string> = {
  main: '🦞',
  researcher: '🔬',
  design: '🎨',
  researcher2: '🔭',
  designer: '🎨',
}

function agentIcon(id: string): string {
  return AGENT_ICONS[id] ?? '🤖'
}

/** Short model label: strip provider prefix (openrouter/stealth/ox-alpha → ox-alpha). */
function shortModel(model: string | null | undefined): string {
  if (!model) return '—'
  const parts = model.split('/')
  return parts[parts.length - 1] ?? model
}

/** Human time for a session row: HH:MM today, «вчера», else DD.MM. */
function formatSessionTime(ts: number | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const yesterday = new Date(now.getTime() - 86400_000).toDateString() === d.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (yesterday) return 'вчера'
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })
}

/** Human label for a session row: label > displayName > derivedTitle > prettified key. */
function sessionLabel(s: ShellSessionRow): string {
  if (s.label) return s.label
  if (s.displayName) return s.displayName
  if (s.derivedTitle) return s.derivedTitle
  const key = s.key ?? ''
  // agent:main:main → «Чат · main», telegram:@Gazdamir → «@Gazdamir»
  const agentMatch = key.match(/^agent:([^:]+)/)
  if (agentMatch) return `Чат · ${agentMatch[1]}`
  const tgMatch = key.match(/^telegram:(.+)$/)
  if (tgMatch) return tgMatch[1]
  return key
}

interface ShellSessionRow {
  key: string
  label?: string
  displayName?: string
  derivedTitle?: string
  updatedAt?: number | null
  lastMessagePreview?: string
}

interface LocalProgressPayload {
  modelId?: string
  progress?: number
  receivedBytes?: number
  totalBytes?: number
  status?: string
}

function buildControlUIUrl(port: number, token: string | undefined, path = '/chat', session?: string | null): string {
  const base = `http://127.0.0.1:${port}${path}`
  const query = session ? `?session=${encodeURIComponent(session)}&onboarding=1` : '?onboarding=1'
  if (token && typeof token === 'string' && token.trim()) {
    return `${base}${query}#token=${encodeURIComponent(token.trim())}`
  }
  return `${base}${query}`
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

interface AgentInfo {
  id: string
  name: string
  model?: string
  isDefault?: boolean
}

type OpenMenu = 'agent' | 'settings' | 'more' | null

export function EmbeddedShellLayout({ activePanel, onPanelChange }: EmbeddedShellLayoutProps) {
  const { t } = useTranslation()
  const [gatewayView, setGatewayView] = useState<'loading' | 'error'>('loading')
  const [statusText, setStatusText] = useState('Gateway is starting…')
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const [gatewayPort, setGatewayPort] = useState<number | null>(null)
  const [controlUrl, setControlUrl] = useState<string | null>(null)
  const [controlRoute, setControlRoute] = useState<ControlRoute>('/chat')
  const [controlSession, setControlSession] = useState<string | null>(null)
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

  // ── v0.9.5 shell frame data ────────────────────────────────────────────────
  const [agents, setAgents] = useState<AgentInfo[]>([{ id: 'main', name: 'main', isDefault: true }])
  const [activeAgent, setActiveAgent] = useState('main')
  const [sessions, setSessions] = useState<ShellSessionRow[]>([])
  const [activeSection, setActiveSection] = useState('chat')
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [primaryModel, setPrimaryModel] = useState<string | null>(null)
  const [engineModel, setEngineModel] = useState<string | null>(null)
  const [engineRunning, setEngineRunning] = useState(false)
  const [engineVariant, setEngineVariant] = useState<'cpu' | 'cuda' | 'vulkan' | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<{ modelId: string; progress: number } | null>(null)
  const [localCount, setLocalCount] = useState(0)
  const [localReadyBytes, setLocalReadyBytes] = useState(0)
  const [telegramEnabled, setTelegramEnabled] = useState(false)
  const [hasGatewayToken, setHasGatewayToken] = useState(false)
  const [shellVersion, setShellVersion] = useState('')
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle')
  const [clock, setClock] = useState('')
  const [engineBusy, setEngineBusy] = useState(false)

  const refreshShellData = useCallback(async () => {
    try {
      const config = await window.electronAPI.configRead()
      const list = (config?.agents?.list ?? []) as Array<Record<string, unknown>>
      const defaultModel =
        config?.agents?.defaults && typeof config.agents.defaults === 'object'
          ? (config.agents.defaults as { model?: unknown }).model
          : undefined
      const primaryFromDefaults =
        typeof defaultModel === 'string'
          ? defaultModel
          : defaultModel && typeof defaultModel === 'object' && 'primary' in defaultModel
            ? String((defaultModel as { primary?: unknown }).primary ?? '')
            : null
      setPrimaryModel(primaryFromDefaults)
      if (Array.isArray(list) && list.length > 0) {
        setAgents(
          list.map((a) => ({
            id: String(a.id ?? 'agent'),
            name: String(a.name ?? a.id ?? 'agent'),
            model: typeof a.model === 'string' ? a.model : undefined,
          })),
        )
      }
      const tg = config?.channels?.telegram as { botToken?: string } | undefined
      setTelegramEnabled(Boolean(tg?.botToken))
      const token = (config?.gateway?.auth as { token?: string } | undefined)?.token
      setHasGatewayToken(Boolean(token && token.trim()))
    } catch {
      // non-fatal — sidebar falls back to defaults
    }
    try {
      const view = await window.electronAPI.modelsViewList()
      if (view?.primary) setPrimaryModel(view.primary)
      setEngineRunning(Boolean(view?.engineState?.running))
      setEngineModel(view?.engineState?.modelId ?? null)
      setEngineVariant(view?.runtime?.variant ?? null)
      const models = view?.localModels ?? []
      setLocalCount(models.length)
      const ready = models
        .filter((m) => m.downloaded)
        .reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0)
      setLocalReadyBytes(ready)
      const downloading = models.find((m) => m.status === 'downloading')
      if (downloading) {
        setDownloadProgress({ modelId: downloading.id, progress: downloading.progress })
      }
    } catch {
      // non-fatal
    }
    try {
      const rows = (await window.electronAPI.sessionsList()) as unknown[]
      setSessions(
        rows
          .map((r) => r as ShellSessionRow)
          .filter((r) => r && typeof r.key === 'string')
          .slice(0, 12),
      )
    } catch {
      setSessions([])
    }
  }, [])

  useEffect(() => {
    void refreshShellData()
    const unsub = window.electronAPI.onLocalProgress((payload) => {
      const p = payload as LocalProgressPayload
      if (p && typeof p.progress === 'number' && p.modelId) {
        setDownloadProgress({ modelId: p.modelId, progress: p.progress })
      }
    })
    void window.electronAPI.shellGetVersions().then((v) => {
      if (v?.shell) setShellVersion(v.shell)
    })
    const tick = setInterval(() => {
      setClock(new Date().toISOString().slice(11, 19))
    }, 1000)
    return () => {
      unsub()
      clearInterval(tick)
    }
  }, [refreshShellData])

  // Close dropdowns on outside click.
  useEffect(() => {
    if (!openMenu) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.shell-dropdown')) setOpenMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openMenu])

  // Liquid Glass UI sounds («тук» on clicks, «пук» on opening menus) — ported from the approved mockup.
  useEffect(() => installShellSounds(), [])

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
            const token = (config as { gateway?: { auth?: { token?: string } } } | undefined)?.gateway?.auth?.token
            if (shouldReloadControlUi) {
              setControlUiReloadKey((k) => k + 1)
            }
            setControlUrl(buildControlUIUrl(port, token, controlRoute, controlSession))
          } catch {
            if (shouldReloadControlUi) {
              setControlUiReloadKey((k) => k + 1)
            }
            setControlUrl(buildControlUIUrl(port, undefined, controlRoute, controlSession))
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
    [showError, clearTimeoutTimer, controlRoute, controlSession],
  )

  // Rebuild the iframe URL when the sidebar route changes.
  useEffect(() => {
    if (gatewayPort !== null && controlUrl !== null) {
      void (async () => {
        try {
          const config = await window.electronAPI.configRead()
          const token = (config as { gateway?: { auth?: { token?: string } } } | undefined)?.gateway?.auth?.token
          setControlUrl(buildControlUIUrl(gatewayPort, token, controlRoute, controlSession))
        } catch {
          setControlUrl(buildControlUIUrl(gatewayPort, undefined, controlRoute, controlSession))
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlRoute, controlSession])

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
    if (panel === '') {
      setActiveSection('chat')
    } else {
      const section = SECTIONS.find((s) => s.panel === panel)
      if (section) setActiveSection(section.id)
    }
  }

  const openSection = (section: SectionItem) => {
    setOpenMenu(null)
    setActiveSection(section.id)
    if (section.panel) {
      onPanelChange(section.panel)
    } else if (section.route) {
      onPanelChange('')
      if (section.route === '/chat') {
        // Chat with the currently selected agent session.
        setControlRoute(section.route)
      } else {
        setControlRoute(section.route)
      }
    }
  }

  const openChatForAgent = (agentId: string) => {
    setActiveAgent(agentId)
    setActiveSection('chat')
    onPanelChange('')
    setOpenMenu(null)
    setControlSession(null)
    // Switch the Control UI session to the agent's main session.
    const next: ControlRoute = '/chat'
    setControlRoute(next)
  }

  const runConnectionCheck = async () => {
    setCheckState('checking')
    try {
      const status = await window.electronAPI.gatewayStatus()
      if (status.status === 'running') {
        setCheckState('ok')
      } else {
        setCheckState('fail')
      }
    } catch {
      setCheckState('fail')
    }
    setTimeout(() => setCheckState('idle'), 3500)
  }

  const toggleEngine = async () => {
    if (engineBusy) return
    setEngineBusy(true)
    try {
      if (engineRunning) {
        await window.electronAPI.localEngineStop()
        setEngineRunning(false)
      } else {
        const view = await window.electronAPI.modelsViewList()
        const readyModel = (view?.localModels ?? []).find((m) => m.downloaded)
        if (readyModel) {
          await window.electronAPI.localEngineStart({ modelId: readyModel.id })
          setEngineRunning(true)
          setEngineModel(readyModel.id)
        } else {
          // No local model yet — jump to the Models page.
          handleNavigateToPanel('models')
        }
      }
    } catch {
      // keep previous state
    }
    setEngineBusy(false)
    void refreshShellData()
  }

  const showControlUIIframe = gatewayPort !== null && controlUrl !== null
  const hasActivePanel = activePanel !== ''
  // The «Агентская задача | Просто текст» switch belongs to the chat page only
  // (mockup); hide it on Обзор/Активность/Сеансы/Cron/Задачи/Навыки routes.
  const inChat = controlRoute === '/chat'
  const textModeActive = chatMode === 'text' && !hasActivePanel && showControlUIIframe && inChat

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
            onBack={() => handleNavigateToPanel('')}
            onOpenFeishuSettings={() => handleNavigateToPanel('feishu-settings')}
          />
        )
      case 'voice':
        return <VoiceSettingsView onBack={() => handleNavigateToPanel('')} />
      case 'about':
        return <AboutView onBack={() => handleNavigateToPanel('')} />
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
        return <ProviderView onBack={() => handleNavigateToPanel('')} />
      case 'models':
        return <ModelsView onBack={() => handleNavigateToPanel('')} />
      case 'skills':
        return <SkillsView onBack={() => handleNavigateToPanel('')} />
      case 'updates':
        return (
          <UpdateView
            onBack={() => handleNavigateToPanel('')}
            updateAvailable={updateAvailable}
            updateVersion={updateInfo?.version}
            updateNotes={updateInfo?.releaseNotes}
            onDismissUpdateNotice={() => dismissUpdateNotice()}
          />
        )
      case 'feishu-settings':
        return <FeishuAccessView onBack={() => handleNavigateToPanel('settings')} />
      default:
        return null
    }
  }

  const engineLabel = engineRunning
    ? engineVariant
      ? `llama.cpp ${engineVariant}`
      : 'llama.cpp'
    : downloadProgress
      ? `gemma4 ${Math.round(downloadProgress.progress)}%`
      : 'off'

  const downloadingModelName = downloadProgress ? shortModel(downloadProgress.modelId) : null
  const diskPercent =
    downloadProgress && downloadProgress.progress > 0
      ? Math.min(100, Math.round(downloadProgress.progress))
      : localCount > 0
        ? 100
        : 0
  const diskLabel =
    downloadProgress && downloadProgress.progress > 0
      ? `скачивание ${Math.round(downloadProgress.progress)}%`
      : localCount > 0
        ? `${localCount} мод. · ${(localReadyBytes / 1e9).toFixed(1)} GB`
        : 'моделей нет'

  const gatewayOk = gatewayPort !== null

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

      <div className="shell-frame">
        {/* ══════════ TOP BAR ══════════ */}
        <header className="shell-glass shell-topbar">
          <div className="shell-brand">
            <div className="shell-brand-ic">🦞</div>
            <div className="shell-brand-name">
              OpenClaw PC
              <small>v{shellVersion || '0.9.5'} · liquid glass</small>
            </div>
          </div>

          <div className="shell-dropdown">
            <button
              type="button"
              className="shell-pill"
              onClick={() => setOpenMenu(openMenu === 'agent' ? null : 'agent')}
              title="Переключить агента"
            >
              <span
                className="shell-dot ok"
                style={{ width: 8, height: 8 }}
              />
              <span>{activeAgent}</span>
              <span className="caret">▾</span>
            </button>
            <div className={cn('shell-menu', openMenu === 'agent' && 'open')}>
              <div className="shell-menu-title">Агенты</div>
              {agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="shell-menu-item"
                  onClick={() => openChatForAgent(a.id)}
                >
                  <span className="ic">{agentIcon(a.id)}</span>
                  {a.name}
                  <span className="hint">
                    {a.isDefault ? 'default' : shortModel(a.model)}
                  </span>
                </button>
              ))}
              <div className="shell-menu-sep" />
              <button
                type="button"
                className="shell-menu-item"
                onClick={() => {
                  setOpenMenu(null)
                  handleNavigateToPanel('settings')
                }}
              >
                <span className="ic">＋</span>
                Добавить агента…
              </button>
            </div>
          </div>

          <button
            type="button"
            className="shell-btn ghost"
            style={{ padding: '8px 16px' }}
            onClick={() => openSection(SECTIONS[0])}
          >
            ＋ Новый чат
          </button>

          <div className="spacer flex-1" />

          <div className={cn('shell-gw-pill', !gatewayOk && 'err')}>
            <span className="pulse" />
            Gateway · {gatewayOk ? `127.0.0.1:${gatewayPort}` : 'запуск…'}
          </div>

          <div className="shell-dropdown">
            <button
              type="button"
              className="shell-icon-btn"
              title="Настройки"
              onClick={() => setOpenMenu(openMenu === 'settings' ? null : 'settings')}
            >
              ⚙️
            </button>
            <div className={cn('shell-menu', openMenu === 'settings' && 'open')}>
              <div className="shell-menu-title">Настройки</div>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('models') }}>
                <span className="ic">🧠</span> Модели и провайдеры <span className="hint">ключи, URL</span>
              </button>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('models') }}>
                <span className="ic">🖥️</span> Локальный движок <span className="hint">llama.cpp</span>
              </button>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('settings') }}>
                <span className="ic">📡</span> Telegram <span className="hint">бот</span>
              </button>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('voice') }}>
                <span className="ic">🎙️</span> Голос и микрофон
              </button>
              <div className="shell-menu-sep" />
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('settings') }}>
                <span className="ic">🔧</span> Расширенные <span className="hint">конфиг, порты</span>
              </button>
            </div>
          </div>

          <div className="shell-dropdown">
            <button
              type="button"
              className="shell-icon-btn"
              title="Ещё"
              onClick={() => setOpenMenu(openMenu === 'more' ? null : 'more')}
            >
              ⋯
            </button>
            <div className={cn('shell-menu', openMenu === 'more' && 'open')}>
              <div className="shell-menu-title">Ещё</div>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleOpenLogDir() }}>
                <span className="ic">📜</span> Журналы <span className="hint">logs</span>
              </button>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('dashboard') }}>
                <span className="ic">📊</span> Статистика и расход
              </button>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('settings') }}>
                <span className="ic">🗄️</span> Резервная копия <span className="hint">экспорт</span>
              </button>
              <div className="shell-menu-sep" />
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('updates') }}>
                <span className="ic">🔄</span> Проверить обновления
              </button>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('about') }}>
                <span className="ic">ℹ️</span> О приложении
              </button>
            </div>
          </div>
        </header>

        {/* ══════════ MAIN ══════════ */}
        <div className="shell-main">
          {/* ── Sidebar ── */}
          <aside className="shell-glass shell-sidebar">
            <div className="shell-side-group">
              <div className="shell-g-title">
                Агенты
                <span
                  className="plus"
                  title="Добавить агента"
                  onClick={() => handleNavigateToPanel('settings')}
                >
                  ＋
                </span>
              </div>
              {agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={cn('shell-agent-item', activeAgent === a.id && 'active')}
                  onClick={() => openChatForAgent(a.id)}
                  title={`Агент ${a.name}`}
                >
                  <div className="shell-agent-av">{a.name.charAt(0).toUpperCase()}</div>
                  <div className="a-body">
                    <div className="a-name">{a.name}</div>
                    <div className="a-sub">
                      {shortModel(a.model ?? primaryModel)} · 1M ctx
                    </div>
                  </div>
                  <span className={cn('a-status', activeAgent === a.id ? 'on' : 'idle')} />
                </button>
              ))}
            </div>

            <div className="shell-side-group">
              <div className="shell-g-title">Разделы</div>
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={cn('shell-section-item', activeSection === s.id && 'active')}
                  onClick={() => openSection(s)}
                >
                  <span className="t">
                    {s.icon} {s.label}
                  </span>
                </button>
              ))}
            </div>

            <div className="shell-side-group">
              <div className="shell-g-title">
                Сессии
                <span className="plus" title="Все сеансы" onClick={() => openSection(SECTIONS[5])}>
                  ＋
                </span>
              </div>
              {sessions.length === 0 ? (
                <div style={{ padding: '8px 10px', fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                  нет активных сессий
                </div>
              ) : (
                sessions.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className="shell-session-item"
                    title={s.lastMessagePreview ?? s.key}
                    onClick={() => {
                      setActiveSection('chat')
                      onPanelChange('')
                      setControlSession(s.key)
                      setControlRoute('/chat')
                    }}
                  >
                    <span className="t">{sessionLabel(s)}</span>
                    <span className="tm">{formatSessionTime(s.updatedAt)}</span>
                  </button>
                ))
              )}
            </div>

            <div className="shell-side-foot">
              <div className="shell-disk">
                <span>Модели · {diskLabel}</span>
              </div>
              <div className="shell-disk-bar">
                <i style={{ width: `${diskPercent}%` }} />
              </div>
            </div>
          </aside>

          {/* ── Center: embedded Control UI / panels ── */}
          <section className="shell-chat-area">
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

            {/* Desktop panel overlay (models/settings/etc.) */}
            {hasActivePanel && (
              <div className="absolute inset-0 z-30 flex min-h-0 flex-col bg-[rgba(11,16,32,0.66)] backdrop-blur-2xl">
                <div className="shrink-0 flex items-center gap-2 border-b border-white/10 bg-white/[0.04] px-4 py-2 backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={() => handleNavigateToPanel('')}
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

            {/* v0.9.0: mode switch — «Агентская задача | Просто текст» (chat page only) */}
            {showControlUIIframe && !hasActivePanel && inChat && (
              <div className="absolute bottom-40 left-1/2 z-40 -translate-x-1/2">
                <div className="shell-mode-switch">
                  <button
                    type="button"
                    className={cn('shell-mode-btn', chatMode === 'agent' && 'active')}
                    onClick={() => setChatMode('agent')}
                    title={t('shell.chat.agentModeHint')}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    {t('shell.chat.agentMode')}
                  </button>
                  <button
                    type="button"
                    className={cn('shell-mode-btn', chatMode === 'text' && 'active')}
                    onClick={() => setChatMode('text')}
                    title={t('shell.chat.textModeHint')}
                  >
                    <Type className="h-3.5 w-3.5" />
                    {t('shell.chat.textMode')}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── Right bento panel ── */}
          <aside className="shell-glass shell-status-panel">
            <div className="shell-sp-head">
              <span className="t">Состояние</span>
            </div>

            <div className="shell-bento">
              <div className="shell-tile">
                <div className="t-label">
                  Gateway <span className={cn('shell-dot', gatewayOk ? 'ok' : 'warn')} />
                </div>
                <div className="t-val">{gatewayOk ? 'онлайн' : 'запуск…'}</div>
                <div className="t-sub mono">
                  {gatewayOk ? `127.0.0.1:${gatewayPort}` : '—'}
                </div>
              </div>
              <div className="shell-tile">
                <div className="t-label">Модель</div>
                <div className="t-val" style={{ fontSize: 13 }}>
                  {shortModel(primaryModel)}
                </div>
                <div className="t-sub mono">{primaryModel ?? '—'}</div>
              </div>
              <div className="shell-tile wide">
                <div className="t-label">
                  Локальный движок{' '}
                  <span className={cn('shell-dot', engineRunning ? 'ok' : downloadProgress ? 'busy' : 'idle')} />
                </div>
                <div className="t-val" style={{ fontSize: 13 }}>
                  {engineRunning ? engineLabel : downloadProgress ? 'скачивание…' : 'остановлен'}
                </div>
                <div className="t-sub">
                  {downloadProgress && downloadProgress.progress > 0
                    ? `${downloadingModelName ?? 'модель'} · ${Math.round(downloadProgress.progress)}%`
                    : engineRunning
                      ? engineModel ?? ''
                      : 'llama.cpp не запущен'}
                </div>
                {(downloadProgress?.progress ?? 0) > 0 && (
                  <div className="shell-progress">
                    <div className="p-top">
                      <span>скачивание</span>
                      <span>{Math.round(downloadProgress?.progress ?? 0)}%</span>
                    </div>
                    <div className="p-bar">
                      <i style={{ width: `${Math.round(downloadProgress?.progress ?? 0)}%` }} />
                    </div>
                  </div>
                )}
              </div>
              <div className="shell-tile">
                <div className="t-label">Telegram</div>
                <div className="t-val" style={{ fontSize: 13 }}>
                  {telegramEnabled ? 'бот активен' : 'не настроен'}
                </div>
                <div className="t-sub mono">{telegramEnabled ? 'bot token ✓' : 'визард'}</div>
              </div>
              <div className="shell-tile">
                <div className="t-label">Агенты</div>
                <div className="t-val" style={{ fontSize: 13 }}>
                  {agents.length} · все готовы
                </div>
                <div className="t-sub">{agents.map((a) => a.name).join(', ')}</div>
              </div>
            </div>

            <div className="shell-actions">
              <button
                type="button"
                className={cn(
                  'shell-btn primary',
                  checkState === 'checking' && 'ghost',
                  checkState === 'ok' && 'ok',
                )}
                onClick={() => void runConnectionCheck()}
                disabled={checkState === 'checking'}
              >
                {checkState === 'checking'
                  ? '⏳ Проверка…'
                  : checkState === 'ok'
                    ? '✓ Подключено'
                    : '⚡ Проверить соединение'}
              </button>
              <button type="button" className="shell-btn" onClick={() => void toggleEngine()} disabled={engineBusy}>
                {engineRunning ? '⏹ Остановить движок' : '▶ Запустить движок'}
              </button>
              <button type="button" className="shell-btn ghost" onClick={() => handleNavigateToPanel('models')}>
                📥 Скачать CUDA-сборку
              </button>
            </div>

            <div className="shell-mini-links">
              <a onClick={handleOpenLogDir}>Журналы</a>
              <a onClick={() => handleNavigateToPanel('models')}>Настройки моделей</a>
              <a onClick={() => handleNavigateToPanel('settings')}>Резервная копия</a>
              <a onClick={() => handleNavigateToPanel('updates')}>Обновления</a>
              <a onClick={() => handleNavigateToPanel('about')}>О приложении</a>
            </div>
          </aside>
        </div>

        {/* ══════════ STATUS BAR ══════════ */}
        <footer className="shell-glass shell-statusbar">
          <span className="ok">● gateway {gatewayOk ? 'online' : 'starting'}</span>
          <span className="sep">·</span>
          <span>agent: {activeAgent}</span>
          <span className="sep">·</span>
          <span>model: {primaryModel ?? '—'}</span>
          <span className="sep">·</span>
          <span>engine: {engineLabel}</span>
          <span className="sp-r">
            <span>token: {hasGatewayToken ? 'OK' : '—'}</span>
            <span className="sep">·</span>
            <span className="lat">{clock} UTC</span>
          </span>
        </footer>
      </div>
    </main>
  )
}
