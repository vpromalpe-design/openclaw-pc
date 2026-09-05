import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
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
  MessageCircle,
  Compass,
  Activity,
  Monitor,
  Clock,
  ListChecks,
  FileText,
  BarChart3,
  Archive,
  Wrench,
  HardDrive,
  Globe,
} from 'lucide-react'
import { LoadingView } from './LoadingView'
import { ErrorView, type ErrorType } from './ErrorView'
import { SettingsView } from './SettingsView'
import { VoiceSettingsView } from './VoiceSettingsView'
import { TelegramSettingsView } from './TelegramSettingsView'
import { AboutView } from './AboutView'
import { DashboardView } from './DashboardView'
import { ProviderView } from './ProviderView'
import { ModelsView } from './ModelsView'
import { SkillsView } from './SkillsView'
import { UpdateView } from './UpdateView'
import { TextChatView, type ChatMessage } from './TextChatView'
import { AgentSettingsView } from './AgentSettingsView'
import { GatewaySettingsView } from './GatewaySettingsView'
import { TasksView, TasksDetailPanel, useTasksData } from './TasksView'
import type { TasksSelection, TasksDetailTab } from './TasksView'
import { AgentMenuPortal } from './AgentMenu'
import { TelegramGlyph } from '@/components/TelegramGlyph'
import { Bot, Type, Send } from 'lucide-react'
import type { GatewayStatus, GatewayStatusValue } from '../../shared/types'
import { useUpdateNoticeStore } from '@/stores/update-store'
import { cn } from '@/lib/utils'
import { providerLabel } from '../../shared/provider-catalog'
import { installShellSounds } from '@/lib/sounds'
import { playTtsAudio } from '@/lib/tts-playback'
/* v0.9.34: рой (группы агентов) */
import { RoyGroupsList, RoyDiskButton, RoyDiskDrawer } from '../roy/SidebarRoy'
import { RoyArenaView, RoyRightPanel } from '../roy/ArenaRoy'
import type { RoyAgentRef } from '../roy/ArenaRoy'
import { RoyCreateModal, RoyFileViewer } from '../roy/RoyUi'
import { loadGroups, saveGroups, newGroup, renameGroup, attachTaskRuns, applyRunResult, parsePlanReport, addLog, uid, attachRunsToTask } from '../roy/data'
import type { RoyGroup, RoyTask, RoyTaskRun, RoyDiskNode } from '../roy/types'

const TIMEOUT_MS = 300_000

/* ═══ v0.9.40 (Путь Б + «изучи файл»): эвристики роевых задач ═══ */

/** Маркеры «создать артефакт/файл» — такой задаче нужна папка проекта. */
const ROY_CREATE_INTENT_RE =
  /(сделай|сделать|создай|создать|напиши|написать|сверстай|сверстать|собери|собрать|разработай|разработать|подготовь|подготовить|сформируй|построй|построить|почини|починить|исправь|исправить|переделай|переделать|добавь|добавить|нарисуй|нарисовать|сгенерируй|сгенерировать|настрой|настроить|установи|установить|запусти|запустить|разверни|сделайте|создайте|напишите)/i

/** Маркеры «вопрос/изучи» — папку проекта не создаём, агент просто отвечает. */
const ROY_QUESTION_RE =
  /(изучи|прочитай|посмотри|объясни|расскажи|переведи|проверь|проанализируй|анализ|сравни|оцени|опиши|ответь|что (там|здесь|написано)|что это|резюмируй|подытожь|кратко|своё мнение)/i

/** Привязаны ли к задаче файлы (общие или адресованные агенту). */
function royHasAttach(g: RoyGroup, who: string): boolean {
  return (g.files ?? []).some((f) => f.to.length === 0 || f.to.includes(who))
}

/** Агент — координатор (главный): подсказка в имени или лидер какой-либо группы. */
function royIsCoordinator(agentId: string, agents: Array<{ id: string; name?: string }>, groups: RoyGroup[]): boolean {
  const nm = (agents.find((a) => a.id === agentId)?.name ?? '').toLowerCase()
  return nm.includes('главн') || nm.includes('координатор') || nm.includes('лидер') || groups.some((gr) => gr.leaderId === agentId)
}

/**
 * Команда координатора для «Пути Б»: участники группы + все агенты приложения
 * (чтобы Главный мог задействовать агентов даже вне своей группы), без него самого.
 */
function royCoordTeam(g: RoyGroup, leaderId: string, agents: Array<{ id: string }>): string[] {
  const fromGroup = g.members.filter((m) => m !== 'user' && m !== 'main' && m !== leaderId)
  const all = agents.map((a) => a.id).filter((id) => id !== leaderId)
  return [...new Set([...fromGroup, ...all])]
}

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
  | 'telegram'
  | 'agent-settings'
  | 'tasks'
  | 'gateway'

export interface EmbeddedShellLayoutProps {
  activePanel: EmbeddedPanel
  onPanelChange: (panel: EmbeddedPanel) => void
}

/** Control UI route ids we link to from the sidebar («Разделы»). */
type ControlRoute =
  | '/chat'
  | '/overview'
  | '/activity'
  | '/sessions'
  | '/cron'
  | '/tasks'
  | '/skills'
  | '/settings/communications'

/** Sidebar «Разделы» item: either a Control UI route or one of our panels. */
interface SectionItem {
  id: string
  icon: React.ReactNode
  label: string
  route?: ControlRoute
  panel?: EmbeddedPanel
}

/** v0.9.16: primary sections — always visible as sidebar buttons (Чат · Модели · Телеграм · Голос). */
const SECTIONS: SectionItem[] = [
  { id: 'chat', icon: <MessageCircle size={15} strokeWidth={1.8} />, label: 'Чат', route: '/chat' },
  { id: 'models', icon: <Cpu size={15} strokeWidth={1.8} />, label: 'Модели', panel: 'models' },
  { id: 'telegram', icon: <Send size={15} strokeWidth={1.8} />, label: 'Телеграм', panel: 'telegram' },
  { id: 'voice', icon: <Mic size={15} strokeWidth={1.8} />, label: 'Голос', panel: 'voice' },
]

/** v0.9.16: secondary sections — hidden behind the ⋯ (Ещё) menu in the top bar. */
const MORE_SECTIONS: SectionItem[] = [
  { id: 'overview', icon: <Compass size={15} strokeWidth={1.8} />, label: 'Обзор', route: '/overview' },
  { id: 'activity', icon: <Activity size={15} strokeWidth={1.8} />, label: 'Активность', route: '/activity' },
  { id: 'sessions', icon: <Monitor size={15} strokeWidth={1.8} />, label: 'Сеансы', route: '/sessions' },
  { id: 'cron', icon: <Clock size={15} strokeWidth={1.8} />, label: 'Задания Cron', route: '/cron' },
  { id: 'skills', icon: <Puzzle size={15} strokeWidth={1.8} />, label: 'Навыки', route: '/skills' },
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

/** v0.9.31: badge node for an agent — Telegram glyph for bot-linked agents. */
function renderAgentBadge(agent: AgentInfo): React.ReactNode {
  if (agent.telegramBot) {
    return <TelegramGlyph size={14} className="text-[#229ED9] align-[-1.5px]" />
  }
  return <>{agentIcon(agent.id)}</>
}

/** Short model label: strip provider prefix (openrouter/stealth/ox-alpha → ox-alpha). */
function shortModel(model: string | null | undefined): string {
  if (!model) return '—'
  const parts = model.split('/')
  return parts[parts.length - 1] ?? model
}

/** v0.9.12 (D1): a chat tab. The first tab of every agent is kind 'agent' (Control UI); 'text' tabs are plain-text chats. */
interface ChatTab {
  id: string
  kind: 'agent' | 'text'
  title: string
  history: ChatMessage[]
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
  // v0.9.10: NO `onboarding=1` — it made Control UI hide its topbar
  // (search/clear chat buttons) and sidebar nav via `.shell--onboarding`.
  // Sidebar nav is hidden by the shell theme override instead, so the
  // topbar (лупа/корзина) stays visible while our own nav remains the
  // only sidebar.
  const query = session ? `?session=${encodeURIComponent(session)}` : ''
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
  { id: 'tasks', label: 'Tasks', icon: <ListChecks className="w-4 h-4" />, description: 'Agent tasks & schedules' },
  { id: 'updates', label: 'Updates', icon: <RefreshCw className="w-4 h-4" />, description: 'Check for updates' },
  { id: 'voice', label: 'Voice', icon: <Mic className="w-4 h-4" />, description: 'Voice provider & API key' },
  { id: 'telegram', label: 'Telegram', icon: <Send className="w-4 h-4" />, description: 'Telegram bot settings' },
  { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" />, description: 'Appearance & startup' },
  { id: 'about', label: 'About', icon: <Info className="w-4 h-4" />, description: 'Version info' },
]

/** Desktop nav item id → i18n key (used for the panel header breadcrumb). */
const NAV_I18N_KEY: Record<string, string> = {
  dashboard: 'shell.nav.dashboard',
  models: 'shell.nav.models',
  'llm-api': 'shell.nav.llmApi',
  skills: 'shell.nav.skills',
  tasks: 'shell.nav.tasks',
  updates: 'shell.nav.updates',
  voice: 'shell.nav.voice',
  telegram: 'shell.nav.telegram',
  settings: 'shell.nav.settings',
  about: 'shell.nav.about',
  gateway: 'shell.nav.gateway',
}

interface AgentInfo {
  id: string
  name: string
  model?: string
  isDefault?: boolean
  /** v0.9.31: agent was auto-created together with a Telegram bot → Telegram badge */
  telegramBot?: boolean
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
  /** v0.9.12 FIX: Control UI session key — defaults to the main agent's session so each agent gets its own Agent chat (Control UI would otherwise show the shared agent:main:main chat for everyone). */
  const [controlSession, setControlSession] = useState<string | null>('agent:main:main')
  /** Bumps when the gateway process restarts so the iframe remounts and opens a fresh WebSocket (same #token URL would otherwise not reload). */
  const [controlUiReloadKey, setControlUiReloadKey] = useState(0)
  const prevGatewayStatusRef = useRef<GatewayStatusValue | null>(null)
  const lastRunningPidRef = useRef<number | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Last ~30 gateway log lines, kept for crash diagnostics (BUG-1). */
  const gatewayLogTailRef = useRef<string | null>(null)
  const [firstRequestPending, setFirstRequestPending] = useState(false)
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** v0.9.0: «Агентская задача» (embedded webchat) vs «Просто текст» (direct model call). */
  const [chatMode, setChatMode] = useState<'agent' | 'text'>('agent')
  /** v0.9.12 (D1): per-agent chat tabs. First tab is always the agent (Control UI), rest are plain-text chats. */
  const [tabsByAgent, setTabsByAgent] = useState<Record<string, ChatTab[]>>({})
  const [activeTabByAgent, setActiveTabByAgent] = useState<Record<string, string>>({})
  const [nextTabNumByAgent, setNextTabNumByAgent] = useState<Record<string, number>>({})
  /** v0.9.12 (E3): per-agent activity lamp (busy while the agent processes a turn). */
  const [agentActivity, setAgentActivity] = useState<Record<string, boolean>>({})
  /** v0.9.12 (E4): model picker options (connected providers) + which agent's ⋯ menu is open.
   *  v0.9.14: menu is rendered via portal at fixed screen coords (x = button right edge,
   *  y = button bottom) so the sidebar frame no longer clips it. */
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; label: string }>>([])
  const [agentModelMenu, setAgentModelMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const updateAvailable = useUpdateNoticeStore((state) => state.available)
  const updateDismissed = useUpdateNoticeStore((state) => state.dismissed)
  const updateInfo = useUpdateNoticeStore((state) => state.info)
  const setUpdateAvailable = useUpdateNoticeStore((state) => state.setUpdateAvailable)
  const dismissUpdateNotice = useUpdateNoticeStore((state) => state.dismissUpdateNotice)

  /** v0.9.5 shell frame data ──────────────────────────────────────────────── */
  const [agents, setAgents] = useState<AgentInfo[]>([{ id: 'main', name: 'main', isDefault: true }])
  // v0.9.21: live task data (ledger + cron, 10s poll) drives the sidebar badge,
  // the tasks list and the right-hand detail panel (replaces the Status bento).
  const tasksData = useTasksData(true)
  const [tasksSelected, setTasksSelected] = useState<TasksSelection>(null)
  const [tasksDetailTab, setTasksDetailTab] = useState<TasksDetailTab>('output')
  const [activeAgent, setActiveAgent] = useState('main')

  // v0.9.24 FIX: if the active agent no longer exists in the config (e.g. the
  // user created agents and the list was rewritten without "main"), fall back
  // to the first configured agent instead of driving a phantom "main" session
  // (gateway: `Agent "main" no longer exists in configuration`).
  useEffect(() => {
    if (agents.length === 0) return
    if (!agents.some((a) => a.id === activeAgent)) {
      const first = agents[0].id
      setActiveAgent(first)
      setControlSession(`agent:${first}:main`)
    }
  }, [agents, activeAgent, setControlSession])

  const [sessions, setSessions] = useState<ShellSessionRow[]>([])
  const [activeSection, setActiveSection] = useState('chat')
  // v0.9.34: рой — группы агентов, открытая арена, файл Диска, создание группы
  const [royGroups, setRoyGroups] = useState<RoyGroup[]>(() => loadGroups())
  const [royOpenId, setRoyOpenId] = useState<string | null>(null)
  const [royFileNode, setRoyFileNode] = useState<RoyDiskNode | null>(null)
  const [royCreateOpen, setRoyCreateOpen] = useState(false)
  // v0.9.36: диск — кнопка + дровер
  const [royDiskOpen, setRoyDiskOpen] = useState(false)
  // v0.9.39: «Диск» = реальное дерево workspace/projects из main (IPC roy:tree)
  const [royDiskRoots, setRoyDiskRoots] = useState<RoyDiskNode[]>([])
  const [royDiskReload, setRoyDiskReload] = useState(0)
  const loadRoyDisk = useCallback(async () => {
    try {
      const res = await window.electronAPI.royTree()
      if (res && Array.isArray(res.roots)) setRoyDiskRoots(res.roots)
    } catch {
      /* electron недоступен (dev) */
    }
  }, [])
  useEffect(() => {
    if (!royDiskOpen) return
    void loadRoyDisk()
  }, [royDiskOpen, royDiskReload, loadRoyDisk])
  useEffect(() => {
    if (!royDiskOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRoyDiskOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [royDiskOpen])
  const royDiskFileCount = useMemo(() => {
    const cnt = (ns: RoyDiskNode[]): number =>
      ns.reduce((n, x) => n + (x.kind === 'file' ? 1 : x.children ? cnt(x.children) : 0), 0)
    return cnt(royDiskRoots)
  }, [royDiskRoots])
  // v0.9.39: просмотр реального файла диска (IPC roy:read)
  const [royFileContent, setRoyFileContent] = useState('')
  const openRoyDiskFile = useCallback(async (node: RoyDiskNode) => {
    setRoyDiskOpen(false)
    if (node.kind !== 'file' || !node.path) return
    try {
      const res = await window.electronAPI.royRead({ path: node.path })
      setRoyFileContent(res.ok ? (res.content ?? '') : res.error ?? 'не удалось прочитать')
      setRoyFileNode(node)
    } catch {
      setRoyFileNode(null)
    }
  }, [])
  const royDiskDrag = (e: React.DragEvent, node: RoyDiskNode) => {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData(
      'application/x-roy-file',
      JSON.stringify({ fileId: node.id, path: node.path ?? '', label: node.label, emoji: node.emoji }),
    )
  }
  // v0.9.34: рой-группы сохраняются в localStorage.
  useEffect(() => {
    saveGroups(royGroups)
  }, [royGroups])
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [primaryModel, setPrimaryModel] = useState<string | null>(null)
  const [engineModel, setEngineModel] = useState<string | null>(null)
  const [engineRunning, setEngineRunning] = useState(false)
  const [engineVariant, setEngineVariant] = useState<'cpu' | 'cuda' | 'vulkan' | null>(null)
  /** Compute state from runtime: effective device, GPU identity. */
  const [effectiveGpu, setEffectiveGpu] = useState<'cpu' | 'gpu' | null>(null)
  const [gpuName, setGpuName] = useState<string | null>(null)
  const [installedVariants, setInstalledVariants] = useState<string[]>([])
  const [downloadProgress, setDownloadProgress] = useState<{ modelId: string; progress: number } | null>(null)
  const [localCount, setLocalCount] = useState(0)
  const [localReadyBytes, setLocalReadyBytes] = useState(0)
  const [telegramEnabled, setTelegramEnabled] = useState(false)
  const [hasGatewayToken, setHasGatewayToken] = useState(false)
  const [shellVersion, setShellVersion] = useState('')
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle')
  const [clock, setClock] = useState('')
  const [engineBusy, setEngineBusy] = useState(false)
  /** BUG-1: config keys the current gateway schema rejects (e.g. channels.telegram.network.proxy). */
  const [configWarning, setConfigWarning] = useState<string | null>(null)

  /** v0.9.12 (D1): make sure an agent has its first (agent) tab and it is active. */
  const ensureAgentTabs = useCallback((agentId: string, agentName: string) => {
    const firstTabId = `tab-${agentId}-agent`
    setTabsByAgent((prev) => {
      if (prev[agentId]) return prev
      return {
        ...prev,
        [agentId]: [{ id: firstTabId, kind: 'agent', title: agentName, history: [] }],
      }
    })
    setActiveTabByAgent((prev) =>
      prev[agentId] ? prev : { ...prev, [agentId]: firstTabId },
    )
  }, [])

  /** v0.9.12 (D1): create a new plain-text chat tab for an agent and activate it. */
  const newTextTab = useCallback((agentId: string) => {
    const num = nextTabNumByAgent[agentId] ?? 2
    setNextTabNumByAgent((prev) => ({ ...prev, [agentId]: num + 1 }))
    const tab: ChatTab = {
      id: `tab-${agentId}-text-${Date.now().toString(36)}`,
      kind: 'text',
      title: `Чат ${num}`,
      history: [],
    }
    setTabsByAgent((prev) => ({
      ...prev,
      [agentId]: [...(prev[agentId] ?? []), tab],
    }))
    setActiveTabByAgent((prev) => ({ ...prev, [agentId]: tab.id }))
    setChatMode('text')
  }, [nextTabNumByAgent])

  /** v0.9.12 (D1): activate a tab; switches the mode strip to its kind. */
  const activateTab = useCallback(
    (agentId: string, tabId: string) => {
      setActiveTabByAgent((prev) => ({ ...prev, [agentId]: tabId }))
      const tab = (tabsByAgent[agentId] ?? []).find((tb) => tb.id === tabId)
      if (tab) {
        setChatMode(tab.kind)
        // Each agent has its own Agent chat (Control UI session agent:<id>:main).
        if (tab.kind === 'agent') {
          setControlSession(`agent:${agentId}:main`)
        }
      }
    },
    [tabsByAgent],
  )

  /** v0.9.12 (D1): close a text tab (agent tabs are not closable). */
  const closeTab = useCallback(
    (agentId: string, tabId: string) => {
      const list = tabsByAgent[agentId] ?? []
      const target = list.find((tb) => tb.id === tabId)
      if (!target || target.kind === 'agent') return
      const next = list.filter((tb) => tb.id !== tabId)
      setTabsByAgent((prev) => ({ ...prev, [agentId]: next }))
      setActiveTabByAgent((prev) => {
        if (prev[agentId] !== tabId) return prev
        const fallback = next[next.length - 1] ?? next[0]
        const nextId = fallback?.id ?? `tab-${agentId}-agent`
        setChatMode(fallback?.kind ?? 'agent')
        return { ...prev, [agentId]: nextId }
      })
    },
    [tabsByAgent],
  )

  /** v0.9.12 (D1): history updater for the ACTIVE tab (drives TextChatView). */
  const handleTabHistoryChange = useCallback(
    (updater: React.SetStateAction<ChatMessage[]>) => {
      setTabsByAgent((prev) => {
        const list = prev[activeAgent] ?? []
        const idx = list.findIndex((tb) => tb.id === activeTabByAgent[activeAgent])
        if (idx === -1) return prev
        const tab = list[idx]
        if (tab.kind !== 'text') return prev
        const value =
          typeof updater === 'function'
            ? (updater as (prevH: ChatMessage[]) => ChatMessage[])(tab.history)
            : updater
        const next = list.slice()
        next[idx] = { ...tab, history: value }
        return { ...prev, [activeAgent]: next }
      })
    },
    [activeAgent, activeTabByAgent],
  )

  /** v0.9.24: свежий список моделей для меню агента (RPC + конфиг + allowlist). */
  const loadModelOptions = useCallback(async () => {
    try {
      const res = await window.electronAPI.modelsList()
      const opts = (res?.models ?? [])
        .map((m) => {
          if (!m.id) return null
          const provider = m.provider ?? ''
          const id = provider ? `${provider}/${m.id}` : m.id
          const label = provider ? `${providerLabel(provider)} · ${m.id}` : m.id
          return { id, label }
        })
        .filter((x): x is { id: string; label: string } => x !== null)
      setModelOptions(Array.from(new Map(opts.map((o) => [o.id, o])).values()))
    } catch {
      // non-fatal — model picker stays empty
    }
  }, [])

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
        // v0.9.31: Telegram badge — agents auto-created together with a Telegram
        // bot carry a Telegram icon (registry lives in the shell config).
        let botAgentIds = new Set<string>()
        try {
          const shellCfg = await window.electronAPI.shellGetConfig()
          const links = Array.isArray(
            (shellCfg as { telegramBots?: Array<{ agentId?: string }> } | undefined)?.telegramBots,
          )
            ? ((shellCfg as { telegramBots: Array<{ agentId?: string }> }).telegramBots ?? [])
            : []
          botAgentIds = new Set(links.map((l) => l.agentId).filter((v): v is string => Boolean(v)))
        } catch {
          // Shell config may be missing on first run — badges are skipped.
        }
        setAgents(
          list.map((a) => {
            const id = String(a.id ?? 'agent')
            return {
              id,
              name: String(a.name ?? a.id ?? 'agent'),
              model: typeof a.model === 'string' ? a.model : undefined,
              telegramBot: botAgentIds.has(id),
            }
          }),
        )
        list.forEach((a) => {
          ensureAgentTabs(
            String(a.id ?? 'agent'),
            String(a.name ?? a.id ?? 'agent'),
          )
        })
      }
      const tg = config?.channels?.telegram as { botToken?: string; network?: { proxy?: unknown } } | undefined
      setTelegramEnabled(Boolean(tg?.botToken))
      // BUG-1: `channels.telegram.network.proxy` is rejected by the gateway
      // schema ("must not have additional properties: proxy") and crash-loops
      // the child. Warn loudly instead of silently restarting 20×.
      if (tg?.network && typeof tg.network === 'object' && 'proxy' in tg.network) {
        setConfigWarning(
          '⚠️ В конфиге есть channels.telegram.network.proxy — эта версия gateway его не принимает (краш-луп при старте). Удали ключ или настрой прокси на уровне системы (HTTPS_PROXY).',
        )
      } else {
        setConfigWarning((w) => (w?.startsWith('⚠️ В конфиге') ? null : w))
      }
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
      setEffectiveGpu(view?.runtime?.effectiveGpu ?? null)
      setGpuName(view?.runtime?.gpuName ?? null)
      setInstalledVariants(view?.runtime?.installedVariants ?? [])
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
    try {
      // v0.9.16: счётчик активных задач для акцентного пункта «Задачи»
      // v0.9.21: replaced by useTasksData() live poll (activeCount badge)
    } catch {
      // non-fatal
    }
    try {
      // v0.9.12 (E4): model picker options — all models of connected providers.
      // v0.9.23 (C): modelsList уже возвращает merge RPC + конфиг + allowlist
      // (включая local/<model>); label — человеческое имя провайдера.
      // v0.9.24: вынесено в loadModelOptions — подгружается и при каждом
      // открытии меню модели агента (свежие модели без ожидания refresh).
      await loadModelOptions()
    } catch {
      // non-fatal — model picker stays empty
    }
  }, [ensureAgentTabs, loadModelOptions])

  useEffect(() => {
    const unsub = window.electronAPI.onGatewayLog((log) => {
      const line = typeof log === 'object' && log !== null
        ? String((log as { text?: unknown }).text ?? '')
        : ''
      if (!line) return
      const prev = gatewayLogTailRef.current ?? ''
      const next = `${prev}\n${line}`.trim().split('\n').slice(-30).join('\n')
      gatewayLogTailRef.current = next
    })
    return () => {
      unsub()
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
    void window.electronAPI.shellGetConfig().then((cfg) => {
      const t = cfg?.theme
      if (t !== 'dark') {
        void window.electronAPI.shellSetConfig({ theme: 'dark' })
      }
    })
    const tick = setInterval(() => {
      setClock(new Date().toISOString().slice(11, 19))
    }, 1000)
    // v0.9.12: CPU/GPU indicators must mirror the real engine state (what is
    // actually running lights up green). The engine can be started/stopped
    // from the Models page or the wizard, so poll a lightweight status every
    // 4s instead of relying on one-shot refresh at mount.
    const pollEngine = setInterval(() => {
      void window.electronAPI
        .localEngineStatus()
        .then((s) => {
          setEngineRunning(Boolean(s?.running))
          setEngineModel(s?.modelId ?? null)
          setEngineVariant(s?.variant ?? null)
          setEffectiveGpu(s?.effectiveGpu ?? null)
          setGpuName(s?.gpuName ?? null)
          setInstalledVariants(s?.installedVariants ?? [])
        })
        .catch(() => {
          /* non-fatal — indicators keep last known state */
        })
    }, 4000)
    return () => {
      unsub()
      clearInterval(tick)
      clearInterval(pollEngine)
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

  // v0.9.12 (E4): close the agent model picker when clicking outside it.
  useEffect(() => {
    if (!agentModelMenu) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.a-model-menu') && !target.closest('.a-more')) {
        setAgentModelMenu(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [agentModelMenu])

  // v0.9.11: dark theme is forced. Keep the class on <html> so every
  // `.dark`-scoped token block in globals.css stays active.
  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

  // Фирменные UI-звуки («тук» на кликах, «пук» на открытии меню).
  useEffect(() => installShellSounds(), [])

  // v0.9.13 (Этап F1): speak agent answers (TTS) — play audio pushed by main.
  useEffect(() => {
    const unsub = window.electronAPI.onTtsUtterance((u) => {
      void playTtsAudio(u.mime, u.audioBase64)
    })
    return unsub
  }, [])

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
          // BUG-1: show the actual gateway failure reason (invalid config,
          // port busy, plugin install…) in the error view instead of a generic
          // message — collected from the recent gateway log lines.
          const recentLog = gatewayLogTailRef.current
          const detail = recentLog
            ? `Причина из журнала gateway:\n${recentLog}`
            : 'Please check Gateway configuration and logs, then retry.'
          showError({
            errorType: 'gateway-crash',
            title: 'Gateway service exited unexpectedly',
            detail,
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

  /** Open a task's session in the Agent chat (right side of the shell). */
  const openTaskSession = useCallback(
    (sessionKey?: string) => {
      setActiveAgent(sessionKey?.startsWith('agent:') ? sessionKey.split(':')[1] : activeAgent)
      setActiveSection('chat')
      onPanelChange('')
      setOpenMenu(null)
      setControlSession(sessionKey ?? `agent:${activeAgent}:main`)
      setControlRoute('/chat')
    },
    [activeAgent, onPanelChange],
  )

  /** Selecting a new task resets the detail panel tab to «Вывод». */
  const handleTasksSelect = useCallback((sel: TasksSelection) => {
    setTasksSelected(sel)
    setTasksDetailTab('output')
  }, [])

  const handleNavigateToPanel = (panel: EmbeddedPanel) => {
    setRoyOpenId(null)
    onPanelChange(panel)
    if (panel === '') {
      setActiveSection('chat')
    } else {
      const section = SECTIONS.find((s) => s.panel === panel)
      if (section) setActiveSection(section.id)
    }
  }

  /** п.1.1: ⚙ → «Локальный движок» — open Models and scroll to the local section. */
  const scrollToLocalModelSection = () => {
    setTimeout(() => {
      document
        .getElementById('local-model-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 120)
  }

  const openSection = (section: SectionItem) => {
    setRoyOpenId(null)
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

  const openChatForAgent = useCallback((agentId: string) => {
    setRoyOpenId(null)
    setActiveAgent(agentId)
    setActiveSection('chat')
    onPanelChange('')
    setOpenMenu(null)
    // Each agent has its own Agent chat — point Control UI at its main session.
    setControlSession(`agent:${agentId}:main`)
    // Switch the Control UI session to the agent's main session.
    const next: ControlRoute = '/chat'
    setControlRoute(next)
  }, [onPanelChange])

  /** v0.9.12 (E3): agent activity lamp — subscribe to busy/idle events. */
  useEffect(() => {
    const unsub = window.electronAPI.onAgentsActivity((payload) => {
      const p = payload as { agentId?: string; busy?: boolean } | null
      if (!p || typeof p.agentId !== 'string' || !p.agentId) return
      const agentId = p.agentId
      setAgentActivity((prev) => {
        if (prev[agentId] === Boolean(p.busy)) return prev
        return { ...prev, [agentId]: Boolean(p.busy) }
      })
      // Safety net: if the terminal event was lost, auto-clear after 90s.
      if (p.busy) {
        setTimeout(() => {
          setAgentActivity((prev) =>
            prev[agentId] ? { ...prev, [agentId]: false } : prev,
          )
        }, 90_000)
      }
    })
    return () => unsub()
  }, [])

  /** v0.9.12 (D1): mode strip «Агентская задача» → activate the agent tab. */
  const handleAgentModeClick = useCallback(() => {
    const list = tabsByAgent[activeAgent] ?? []
    const agentTab = list.find((tb) => tb.kind === 'agent')
    if (agentTab) {
      activateTab(activeAgent, agentTab.id)
    } else {
      setChatMode('agent')
    }
  }, [activeAgent, tabsByAgent, activateTab])

  /** v0.9.12 (D1): mode strip «Просто текст» → open a fresh text tab (or stay). */
  const handleTextModeClick = useCallback(() => {
    const list = tabsByAgent[activeAgent] ?? []
    const activeTab = list.find((tb) => tb.id === activeTabByAgent[activeAgent])
    if (activeTab?.kind === 'text') return
    newTextTab(activeAgent)
  }, [activeAgent, activeTabByAgent, tabsByAgent, newTextTab])

  /** v0.9.12 (E4): set an agent's model (writes agents.list[].model, gateway hot-reloads).
   *  v0.9.23 (B): выбор `local/<model>` в меню = реальный запуск локального движка
   *  (localEngineStart) + запись той же ссылки агенту. */
  const setAgentModel = async (agentId: string, model: string) => {
    setAgentModelMenu(null)
    try {
      if (model.startsWith('local/')) {
        const modelId = model.slice('local/'.length)
        if (engineRunning && engineModel !== modelId) {
          await window.electronAPI.localEngineStop()
        }
        await window.electronAPI.localEngineStart({ modelId })
      }
      const res = await window.electronAPI.agentsSetModel({ agentId, model })
      if (res.ok) {
        // Оптимистичное обновление: сайдбар/меню показывают новую модель
        // мгновенно, не дожидаясь перечитывания конфига.
        setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, model } : a)))
        void refreshShellData()
      }
    } catch {
      // non-fatal — keep previous model
    }
  }

  const handleRemoveAgent = useCallback(
    async (a: AgentInfo) => {
      setAgentModelMenu(null)
      if (a.isDefault) return
      const ok = window.confirm(
        `Удалить агента «${a.name}» и все его чаты? Это действие нельзя отменить.`,
      )
      if (!ok) return
      try {
        // v0.9.33 FIX: switch the chat away from the agent BEFORE removing it —
        // while the gateway is still up. Otherwise the embedded control UI
        // survives the gateway restart, restores the deleted agent from its
        // local state and shows `Unknown agent id "..."` + dead chat.
        if (activeAgent === a.id) {
          const rest = agents.filter((x) => x.id !== a.id)
          openChatForAgent(rest[0]?.id ?? 'main')
        }
        const res = await window.electronAPI.agentsRemove({ agentId: a.id })
        if (!res.ok) {
          window.alert(res.error ?? 'Не удалось удалить агента')
          return
        }
        setTabsByAgent((prev) => {
          const next = { ...prev }
          delete next[a.id]
          return next
        })
        void refreshShellData()
      } catch (err) {
        window.alert(`Не удалось удалить агента: ${String(err)}`)
      }
    },
    [activeAgent, agents, openChatForAgent, refreshShellData],
  )

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

  /**
   * CPU/GPU tiles in the status panel: click an inactive tile to switch the
   * engine to that device (and start it if it is stopped); click the active
   * tile to stop the engine.
   */
  const toggleCompute = async (target: 'cpu' | 'gpu') => {
    if (engineBusy) return
    setEngineBusy(true)
    try {
      const active = engineRunning && effectiveGpu === target
      if (active) {
        // Click on the active tile → switch the engine off.
        await window.electronAPI.localEngineStop()
        setEngineRunning(false)
      } else {
        if (target === 'gpu') {
          const gpuBuildInstalled = installedVariants.some(
            (v) => v === 'cuda' || v === 'vulkan',
          )
          if (!gpuBuildInstalled) {
            // No GPU build on disk yet — send the user to the Models page
            // where the CUDA/Vulkan build can be installed.
            handleNavigateToPanel('models')
            return
          }
        }
        await window.electronAPI.localEngineMode({ setMode: target })
        const view = await window.electronAPI.modelsViewList()
        if (!view?.engineState?.running) {
          const readyModel = (view?.localModels ?? []).find((m) => m.downloaded)
          if (readyModel) {
            await window.electronAPI.localEngineStart({ modelId: readyModel.id })
            setEngineRunning(true)
            setEngineModel(readyModel.id)
          } else {
            handleNavigateToPanel('models')
          }
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
  // v0.9.12 (D1): the active tab drives what the chat canvas shows.
  const activeTabs = tabsByAgent[activeAgent] ?? []
  const activeTabId = activeTabByAgent[activeAgent] ?? activeTabs[0]?.id
  // v0.9.24 (Damir): единый источник истины для отображения модели — модель
  // АКТИВНОГО агента (agents.list[].model ?? дефолт). Раньше «Состояние» и
  // статусбар показывали только глобальную primary → рассинхрон.
  const activeAgentModel = agents.find((a) => a.id === activeAgent)?.model ?? primaryModel
  const activeTab = activeTabs.find((tb) => tb.id === activeTabId) ?? activeTabs[0]
  const activeTabHistory = activeTab?.kind === 'text' ? activeTab.history : []

    /* ══════════ v0.9.34: РОЙ — производные и операции ══════════ */
  const royOpenGroup = royOpenId ? (royGroups.find((g) => g.id === royOpenId) ?? null) : null
  const royPatch = useCallback(
    (fn: (g: RoyGroup) => RoyGroup) => {
      setRoyGroups((gs) => gs.map((g) => (g.id === royOpenId ? fn(g) : g)))
    },
    [royOpenId],
  )

  // v0.9.39: «связка файлов» агента — прикреплённые к нему файлы арены (+ общие).
  // Вставляется в промпт задачи, чтобы агент понимал, с каким файлом работает.
  const royAttachedNote = useCallback((g: RoyGroup, agentId: string, shared = false): string => {
    const fs = (g.files ?? []).filter((f) => f.to.includes(agentId) || (shared && f.to.length === 0))
    if (fs.length === 0) return ''
    const lines = fs.map((f) => `- ${f.label}${f.path ? ` — ${f.path}` : ''}`)
    return `\n\n📎 Прикреплённые к тебе файлы (связка):\n${lines.join('\n')}\nСначала открой и изучи их — пойми, что это и что с ними делать, потом выполняй задачу.`
  }, [])
  // v0.9.39: что уже лежит в папке проекта (снапшот по загруженному дереву диска).
  const listDirFiles = useCallback(
    (dir: string | undefined): string[] => {
      if (!dir) return []
      const out: string[] = []
      const walk = (ns: RoyDiskNode[]) => {
        for (const n of ns) {
          if (n.kind === 'file' && n.path && n.path.toLowerCase().startsWith(dir.toLowerCase())) out.push(n.path)
          if (n.children && n.children.length > 0) walk(n.children)
        }
      }
      walk(royDiskRoots)
      return out.sort()
    },
    [royDiskRoots],
  )
  const dirContextNote = useCallback(
    (dir: string | undefined): string => {
      const have = listDirFiles(dir)
      if (have.length === 0) return ''
      return `\n\n📂 Уже есть в папке проекта (посмотри, что сделано до тебя):\n${have.map((p) => `- ${p}`).join('\n')}`
    },
    [listDirFiles],
  )

  // v0.9.39: реальный запуск задачи роя.
  //  - Миссия (who='group', глава — агент): двухфазный протокол: папка проекта →
  //    диспатч главному-координатору (вернёт план) → по плану спавнятся подзадачи.
  //  - Обычная/подзадача: диспатч адресату (в его сессию задач) + привязка runs.
  const royRunTask = useCallback(
    async (groupId: string, taskId: string) => {
      const g = royGroups.find((x) => x.id === groupId)
      const t = g?.tasks.find((x) => x.id === taskId)
      if (!g || !t) return
      if (t.state !== 'wait') return
      const nameOf = new Map(agents.map((a) => [a.id, a.name]))
      const members = g.members.filter((w) => w !== 'user' && w !== 'main')
      const mission = t.who === 'group'
      // ── v0.9.40: разбор адресата обычной задачи (до создания папки) ──
      const targets0 = mission ? [] : [t.who].filter((w) => w !== 'user' && w !== 'main')
      const who0 = targets0[0]
      // «изучи файл»/вопрос: папку проекта НЕ создаём — агент просто отвечает
      const artTask = !!who0 && ROY_CREATE_INTENT_RE.test(t.title)
      const questionLike = !!who0 && !artTask && !t.parentId && (royHasAttach(g, who0) || ROY_QUESTION_RE.test(t.title))
      // «Путь Б»: задача лично координатору (Главному) — он решает: сделать сам или вернуть план
      const coordTask = !!who0 && !t.parentId && royIsCoordinator(who0, agents, royGroups)
      const coordTeamArr = coordTask ? royCoordTeam(g, who0, agents) : []
      const needProject = mission || artTask || (coordTask && coordTeamArr.length > 0)
      // папка проекта для задачи/миссии (на Диске: Проекты/<название>)
      let projectDir = t.projectDir
      let createdNow = false
      if (!projectDir && needProject) {
        try {
          const pr = await window.electronAPI.royProjectCreate({ title: t.title })
          if (pr.ok && pr.dir) {
            projectDir = pr.dir
            createdNow = true
            setRoyDiskReload((n) => n + 1)
          }
        } catch {
          /* ignore */
        }
      }
      if (createdNow && projectDir) void window.electronAPI.systemOpenPath(projectDir).catch(() => undefined)

      const dispatchOne = async (agentId: string, text: string) => {
        try {
          const res = await window.electronAPI.tasksDispatch({ text, agentId, mode: 'now', freq: 'once' })
          if (res?.ok) {
            return { agentId, agentName: nameOf.get(agentId) ?? agentId, localId: res.localTaskId, runId: res.runId, status: 'run' as const, startedAt: Date.now() }
          }
          return { agentId, agentName: nameOf.get(agentId) ?? agentId, status: 'fail' as const, error: res?.error ?? 'dispatch failed', startedAt: Date.now() }
        } catch (err) {
          return { agentId, agentName: nameOf.get(agentId) ?? agentId, status: 'fail' as const, error: String(err), startedAt: Date.now() }
        }
      }

      if (mission) {
        // ── МИССИЯ: глава-агент планирует → подзадачи исполнителям ──
        const leader = g.head === 'main' ? (g.leaderId && members.includes(g.leaderId) ? g.leaderId : members[0]) : null
        if (leader && members.length > 1) {
          const roster = members.map((m) => `${m}${nameOf.get(m) ? ` (${nameOf.get(m)})` : ''}`).join(', ')
          const prompt =
            `📋 МИССИЯ ДЛЯ КООРДИНАТОРА. Ты — главный агент роя. НЕ создавай файлы и НЕ запускай субагентов — сначала только продумай план.\n\n` +
            `Задача: «${t.title}»\n` +
            `Состав роя (доступны только эти агенты, обращайся по id): ${roster}\n` +
            `${projectDir ? `Папка проекта (файлы создавать в ней): ${projectDir}\n` : ''}` +
            `${royAttachedNote(g, leader, true)}\n` +
            `Подумай: из каких подзадач состоит задача, кому какую поручить по ролям, каких ролей/агентов не хватает.\n` +
            `Верни ОДНО сообщение: сначала 1-2 предложения размышлений, затем строго JSON-блок: ` +
            `{"tasks":[{"to":"<agentId из состава>","what":"<конкретная подзадача>","file":"<имя файла, который создаст>"}]}` +
            (members.length > 1 ? ` Если нужны агенты, которых нет в составе — добавь после tasks поле "need":["роль — зачем"].` : '') +
            ` Подзадач должно быть не больше ${members.length - 1}, каждому агенту — одна.`
          const run = await dispatchOne(leader, prompt)
          const runOk = run as RoyTaskRun
          setRoyGroups((gs) =>
            gs.map((gr) => {
              if (gr.id !== groupId) return gr
              const upd: RoyTask = {
                ...t,
                state: runOk.status === 'run' ? 'run' : 'done',
                projectDir,
                runs: [runOk],
                plan: runOk.status === 'run' ? { status: 'run', localId: runOk.localId } : { status: 'fail', error: runOk.error },
              }
              return addLog(
                { ...gr, tasks: gr.tasks.map((x) => (x.id === taskId ? upd : x)) },
                runOk.status === 'run' ? '👑' : '⚠️',
                runOk.status === 'run' ? `миссия ушла координатору ${nameOf.get(leader) ?? leader}: ${t.title} — ждём план` : `не удалось запустить координатора: ${t.title}`,
              )
            }),
          )
        } else {
          // глава — Дамир или в рое один агент: рассылка всем участникам как раньше
          const runs: RoyTaskRun[] = []
          for (const agentId of members) {
            const text = `${t.title}${projectDir ? `\n\n📁 Папка проекта (работай там, создавай файлы только в ней): ${projectDir}` : ''}${royAttachedNote(g, agentId)}${dirContextNote(projectDir)}`
            runs.push(await dispatchOne(agentId, text))
          }
          setRoyGroups((gs) => gs.map((gr) => (gr.id === groupId ? attachTaskRuns(gr, taskId, runs) : gr)))
        }
        return
      }

      // ── обычная задача (агенту / подзадача по плану) ──
      const targets = targets0
      if (targets.length === 0) return
      if (coordTask && coordTeamArr.length > 0) {
        // ── ПУТЬ Б: задача лично координатору — он сам решает: выполнить или дать план ──
        const leader = who0
        const roster = coordTeamArr.map((m) => `${m}${nameOf.get(m) ? ` (${nameOf.get(m)})` : ''}`).join(', ')
        const prompt =
          `📋 КООРДИНАТОРСКАЯ ЗАДАЧА. Ты — главный агент (координатор). Реши сам, как её выполнить.\n\n` +
          `Задача: «${t.title}»\n` +
          `Команда (агенты приложения, обращайся по id): ${roster}\n` +
          `${projectDir ? `Папка проекта (если будут создаваться файлы — только здесь): ${projectDir}\n` : ''}` +
          `${royAttachedNote(g, leader, true)}\n` +
          `Вариант 1 — выполнить самому: просто сделай и верни ОДНО финальное сообщение с результатом и списком созданных файлов.\n` +
          `Вариант 2 — командная работа: НЕ выполняй сам(а), продумай план и верни JSON-блок ` +
          `{"tasks":[{"to":"<agentId>","what":"<подзадача>","file":"<имя файла>"}]}` +
          ` — система сама раздаст подзадачи. Если нужны отсутствующие роли — добавь "need":["роль — зачем"]. Подзадач не больше ${coordTeamArr.length}, каждому агенту — одна.\n` +
          `Верни ОДНО сообщение: результат ИЛИ JSON-план.`
        const run = await dispatchOne(leader, prompt)
        const runOk = run as RoyTaskRun
        setRoyGroups((gs) =>
          gs.map((gr) => {
            if (gr.id !== groupId) return gr
            const upd: RoyTask = {
              ...t,
              coord: true,
              state: runOk.status === 'run' ? 'run' : 'done',
              projectDir,
              runs: [runOk],
              plan: runOk.status === 'run' ? { status: 'run', localId: runOk.localId } : { status: 'fail', error: runOk.error },
            }
            return addLog(
              { ...gr, tasks: gr.tasks.map((x) => (x.id === taskId ? upd : x)) },
              runOk.status === 'run' ? '👑' : '⚠️',
              runOk.status === 'run'
                ? `задача ушла координатору ${nameOf.get(leader) ?? leader}: ${t.title} — ждём результат или план`
                : `не удалось запустить координатора: ${t.title}`,
            )
          }),
        )
        return
      }
      const runs: RoyTaskRun[] = []
      for (const agentId of targets) {
        const fileNote = projectDir ? `\n\n📁 Папка проекта (работай там, создавай файлы только в ней): ${projectDir}` : ''
        const answerNote = questionLike ? `\n\nЭто запрос на ответ/анализ: НЕ создавай папки проекта и лишние файлы — просто ответь.` : ''
        const text = `${t.title}${fileNote}${answerNote}${royAttachedNote(g, agentId)}${dirContextNote(projectDir)}`
        runs.push(await dispatchOne(agentId, text))
      }
      setRoyGroups((gs) =>
        gs.map((gr) =>
          gr.id === groupId
            ? (() => {
                const base = attachTaskRuns(gr, taskId, runs)
                // у подзадачи миссии — проставить папку проекта
                if (projectDir && t.parentId) {
                  return { ...base, tasks: base.tasks.map((x) => (x.id === taskId ? { ...x, projectDir } : x)) }
                }
                return base
              })()
            : gr,
        ),
      )
    },
    [royGroups, agents, dirContextNote, royAttachedNote],
  )

  // Мониторинг: ответы агентов из локального реестра задач → runs роя.
  // Срабатывает при каждом обновлении реестра (onTasksLocalChanged → load).
  useEffect(() => {
    const locals = tasksData.tasks
    if (!locals || locals.length === 0) return
    setRoyGroups((gs) => {
      let any = false
      const next = gs.map((g) => {
        let g2 = g
        for (const t of g2.tasks) {
          if (!t.runs) continue
          for (const rn of t.runs) {
            if (!rn.localId || rn.status !== 'run') continue
            const loc = locals.find((l) => l.id === rn.localId)
            if (!loc) continue
            const upd =
              loc.status === 'succeeded'
                ? { status: 'done' as const, report: loc.answer }
                : loc.status === 'failed' || loc.status === 'cancelled' || loc.status === 'timed_out'
                  ? { status: 'fail' as const, error: loc.error ?? `задача не выполнена (${loc.status})` }
                  : null
            if (!upd) continue
            const before = g2
            g2 = applyRunResult(g2, t.id, rn.localId, upd)
            if (g2 !== before) any = true
          }
        }
        return g2
      })
      return any ? next : gs
    })
  }, [tasksData.tasks])

  // v0.9.39: единичный диспатч задачи агенту (переиспользуется при раздаче подзадач)
  const royDispatchOne = useCallback(
    async (agentId: string, text: string): Promise<RoyTaskRun> => {
      const nameOf = new Map(agents.map((a) => [a.id, a.name]))
      try {
        const res = await window.electronAPI.tasksDispatch({ text, agentId, mode: 'now', freq: 'once' })
        if (res?.ok) {
          return { agentId, agentName: nameOf.get(agentId) ?? agentId, localId: res.localTaskId, runId: res.runId, status: 'run' as const, startedAt: Date.now() }
        }
        return { agentId, agentName: nameOf.get(agentId) ?? agentId, status: 'fail' as const, error: res?.error ?? 'dispatch failed', startedAt: Date.now() }
      } catch (err) {
        return { agentId, agentName: nameOf.get(agentId) ?? agentId, status: 'fail' as const, error: String(err), startedAt: Date.now() }
      }
    },
    [agents],
  )

  // v0.9.39: план координатора пришёл (succeeded) → создаём и раздаём подзадачи
  const spawningRoy = useRef<Set<string>>(new Set())
  const roySpawnFromPlan = useCallback(
    async (groupId: string, missionId: string, planText: string) => {
      if (spawningRoy.current.has(missionId)) return
      spawningRoy.current.add(missionId)
      try {
        const g0 = royGroups.find((x) => x.id === groupId)
        const mission = g0?.tasks.find((x) => x.id === missionId)
        if (!g0 || !mission || !mission.plan) return
        const members = g0.members.filter((m) => m !== 'user' && m !== 'main')
        const isCoord = mission.coord === true
        // координаторская задача (Путь Б): адресат = координатор, команда = группа + все агенты приложения
        const leader = isCoord ? mission.who : g0.leaderId && members.includes(g0.leaderId) ? g0.leaderId : members[0]
        const doers = isCoord ? royCoordTeam(g0, leader, agents).filter((m) => m !== leader) : members.filter((m) => m !== leader)
        const nameOf = new Map(agents.map((a) => [a.id, a.name]))
        const body = planText.replace(/```(?:json)?/gi, '').replace(/```/g, '')
        const needMatch = /"need"\s*:\s*\[([\s\S]*?)\]/.exec(body)
        const needNote = needMatch
          ? needMatch[1].split(',').map((s) => s.replace(/["'[\]]/g, '').trim()).filter(Boolean)
          : []
        const items = parsePlanReport(planText)
        const itemsOk = items && items.length > 0
        const used = new Set<string>()
        const assign = (toRaw: string): string | null => {
          if (!toRaw) return null
          const byId = members.includes(toRaw) ? toRaw : null
          const byName = byId ? null : agents.find((a) => a.id === toRaw || a.name === toRaw)?.id ?? null
          const hit = byId ?? byName
          if (!hit || !doers.includes(hit) || used.has(hit)) return null
          used.add(hit)
          return hit
        }
        const planned: Array<{ who: string; what: string; file?: string }> = []
        const unknownRoles: string[] = []
        if (itemsOk) {
          for (const it of items ?? []) {
            if (it.to === leader) continue
            const who = assign(it.to)
            if (!who) {
              unknownRoles.push(it.to)
              continue
            }
            planned.push({ who, what: it.what, file: it.file })
          }
        }
        // план не распознан/все роли вне состава/пуст → раздать миссию всем исполнителям
        if (planned.length === 0) {
          if (isCoord) {
            // координатор не дал JSON-план — он выполнил задачу сам (ответ уже в его отчёте)
            setRoyGroups((gs) =>
              gs.map((gr) =>
                gr.id === groupId
                  ? addLog(
                      { ...gr, tasks: gr.tasks.map((x) => (x.id === missionId ? { ...x, plan: { status: 'done', localId: mission.plan?.localId, report: planText } } : x)) },
                      '✅',
                      `координатор выполнил задачу сам (JSON-план не потребовался): ${mission.title}`,
                    )
                  : gr,
              ),
            )
            return
          }
          planned.length = 0
          unknownRoles.length = 0
          for (const d of doers) planned.push({ who: d, what: mission.title })
        }
        if (planned.length === 0) {
          setRoyGroups((gs) =>
            gs.map((gr) =>
              gr.id === groupId
                ? addLog(gr, '⚠️', `по плану координатора некому раздавать — в рое только ${nameOf.get(leader ?? '') ?? leader}: ${mission.title}`)
                : gr,
            ),
          )
          return
        }
        const created: RoyTask[] = []
        const runResults: Array<{ taskId: string; run: RoyTaskRun }> = []
        for (const p of planned) {
          const subId = uid('task')
          const dirNote = mission.projectDir ? `Папка проекта (создавай файлы ТОЛЬКО здесь): ${mission.projectDir}` : ''
          const fileNote = p.file ? `Файл, который нужно создать: ${p.file}` : ''
          const prompt = `🎯 Задача проекта «${mission.title}» — твоя часть от координатора:\n${p.what}\n\n${dirNote}${fileNote ? `\n${fileNote}` : ''}${royAttachedNote(g0, p.who)}${dirContextNote(mission.projectDir)}\nВыполни самостоятельно, без субагентов. В конце верни ОДНО финальное сообщение: что сделал + список созданных файлов.`
          const run = await royDispatchOne(p.who, prompt)
          created.push({ id: subId, who: p.who, title: p.what.slice(0, 160), state: 'wait', ts: Date.now(), parentId: missionId, projectDir: mission.projectDir })
          runResults.push({ taskId: subId, run })
        }
        const whoList = planned.map((p) => nameOf.get(p.who) ?? p.who).join(', ')
        setRoyGroups((gs) =>
          gs.map((gr) => {
            if (gr.id !== groupId) return gr
            let g2 = gr
            const missionUpd: RoyTask = {
              ...mission,
              plan: { status: 'done', localId: mission.plan?.localId, report: planText, dispatched: true },
            }
            g2 = { ...g2, tasks: g2.tasks.map((x) => (x.id === missionId ? missionUpd : x)) }
            const fresh: RoyTask[] = []
            for (const c of created) {
              const r = runResults.find((rr) => rr.taskId === c.id)
              const withRun = r ? attachRunsToTask(c, [r.run]) : c
              fresh.push(withRun)
            }
            g2 = { ...g2, tasks: [...fresh, ...g2.tasks] }
            g2 = addLog(g2, '👑', `план координатора: подзадачи розданы → ${whoList}`)
            if (itemsOk) {
              g2 = addLog(g2, '📋', `роли по плану: ${planned.map((p) => `${nameOf.get(p.who) ?? p.who}${p.file ? ` → ${p.file}` : ''}`).join(' · ')}`)
            } else {
              g2 = addLog(g2, '📋', 'план не распознан как JSON — задача роздана участникам целиком')
            }
            if (needNote.length > 0) g2 = addLog(g2, '💡', `координатор предлагает добавить агентов: ${needNote.join('; ')}`)
            if (unknownRoles.length > 0) g2 = addLog(g2, '⚠️', `в плане роли вне состава роя: ${unknownRoles.join(', ')}`)
            return g2
          }),
        )
      } finally {
        spawningRoy.current.delete(missionId)
      }
    },
    [royGroups, agents, royDispatchOne, royAttachedNote, dirContextNote],
  )

  // план координатора завершён в реестре → запустить раздачу подзадач
  useEffect(() => {
    const locals = tasksData.tasks
    if (!locals || locals.length === 0) return
    for (const g of royGroups) {
      for (const t of g.tasks) {
        if ((t.who !== 'group' && !t.coord) || !t.plan || t.plan.status !== 'run' || !t.plan.localId || t.plan.dispatched) continue
        const loc = locals.find((l) => l.id === t.plan?.localId)
        if (!loc || loc.status !== 'succeeded') continue
        void roySpawnFromPlan(g.id, t.id, loc.answer ?? '')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksData.tasks])

  // v0.9.39: миссия завершена, когда все её подзадачи — done
  useEffect(() => {
    setRoyGroups((gs) => {
      let any = false
      const next = gs.map((g) => {
        let g2 = g
        for (const mission of g2.tasks) {
          if ((mission.who !== 'group' && !mission.coord) || mission.state !== 'run' || !mission.plan?.dispatched) continue
          const kids = g2.tasks.filter((x) => x.parentId === mission.id)
          if (kids.length === 0) continue
          if (kids.every((k) => k.state === 'done')) {
            any = true
            g2 = addLog(
              { ...g2, tasks: g2.tasks.map((x) => (x.id === mission.id ? { ...x, state: 'done' } : x)) },
              '🏁',
              `${mission.who === 'group' ? 'миссия завершена' : 'координаторская задача выполнена'}: ${mission.title}`,
            )
          }
        }
        return g2
      })
      return any ? next : gs
    })
  }, [royGroups])

  // v0.9.39: прикрепить реальные файлы папки проекта к завершённым запускам
  const fileScanning = useRef<Set<string>>(new Set())
  useEffect(() => {
    const want: Array<{ groupId: string; taskId: string; dir: string; runs: RoyTaskRun[] }> = []
    for (const g of royGroups) {
      for (const t of g.tasks) {
        if (!t.projectDir || !t.runs) continue
        const pending = t.runs.filter((r) => r.status === 'done' && !r.files)
        if (pending.length === 0) continue
        want.push({ groupId: g.id, taskId: t.id, dir: t.projectDir, runs: pending })
      }
    }
    if (want.length === 0) return
    let cancelled = false
    void (async () => {
      let tree: RoyDiskNode[] = []
      try {
        const res = await window.electronAPI.royTree()
        tree = res?.roots ?? []
      } catch {
        return
      }
      if (cancelled) return
      const filesOfDir = (dirPath: string): RoyDiskNode[] => {
        const walk = (n: RoyDiskNode | undefined): RoyDiskNode[] => {
          if (!n) return []
          if (n.kind === 'folder' && n.path === dirPath) return (n.children ?? []).filter((c) => c.kind === 'file')
          for (const c of n.children ?? []) {
            const hit = walk(c)
            if (hit.length > 0) return hit
          }
          return []
        }
        for (const root of tree) {
          const hit = walk(root)
          if (hit.length > 0) return hit
        }
        return []
      }
      setRoyGroups((gs) => {
        let any = false
        const next = gs.map((g) => {
          if (!want.some((w) => w.groupId === g.id)) return g
          let g2 = g
          for (const w of want) {
            if (w.groupId !== g.id) continue
            const files = filesOfDir(w.dir)
            if (files.length === 0) continue
            const t = g2.tasks.find((x) => x.id === w.taskId)
            if (!t || !t.runs) continue
            const runs = t.runs.map((r) => {
              if (r.status !== 'done' || r.files) return r
              const key = `${w.taskId}:${r.localId ?? r.agentId}`
              if (fileScanning.current.has(key)) return r
              // файлы, созданные в окне работы агента (и чуть раньше/позже)
              const from = (r.startedAt ?? Date.now()) - 180_000
              const to = (r.endedAt ?? Date.now()) + 120_000
              const owned = files
                .filter((f) => typeof f.mtimeMs === 'number' && f.mtimeMs >= from && f.mtimeMs <= to)
                .map((f) => ({ path: f.path ?? '', label: f.label, emoji: f.emoji, size: f.size, mtimeMs: f.mtimeMs }))
              if (owned.length === 0) return r
              fileScanning.current.add(key)
              any = true
              return { ...r, files: owned }
            })
            if (runs.some((r, i) => r !== t.runs![i])) g2 = { ...g2, tasks: g2.tasks.map((x) => (x.id === w.taskId ? { ...x, runs } : x)) }
          }
          return g2
        })
        return any ? next : gs
      })
    })()
    return () => {
      cancelled = true
    }
  }, [royGroups])
  const royRemoveAgentRef = useCallback(
    (agent: RoyAgentRef) => {
      const full = agents.find((a) => a.id === agent.id)
      if (full && !full.isDefault) void handleRemoveAgent(full)
      // Вычистить агента из участников/связей всех групп (+коррекция лидера).
      setRoyGroups((gs) =>
        gs.map((g) => {
          const members = g.members.filter((m) => m !== agent.id)
          const needRelead = g.head === 'main' && (g.leaderId === agent.id || !members.includes(g.leaderId ?? ''))
          const files = g.files.map((f) => ({ ...f, to: f.to.filter((t) => t !== agent.id) }))
          return needRelead
            ? { ...g, members, files, head: members.length > 0 ? 'main' : 'user', leaderId: members[0] }
            : { ...g, members, files }
        }),
      )
    },
    [agents, handleRemoveAgent],
  )
  const royCreate = useCallback(
    (name: string, emoji: string, grad: string) => {
      const g = newGroup(name, emoji, grad)
      setRoyGroups((gs) => [g, ...gs])
      setRoyCreateOpen(false)
      setRoyOpenId(g.id)
      onPanelChange('')
      setActiveSection('chat')
    },
    [onPanelChange],
  )


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
          />
        )
      case 'voice':
        return <VoiceSettingsView onBack={() => handleNavigateToPanel('')} />
      case 'telegram':
        return (
          <TelegramSettingsView
            onBack={() => {
              handleNavigateToPanel('')
              void refreshShellData()
            }}
            onAgentsChanged={() => void refreshShellData()}
          />
        )
      case 'gateway':
        return <GatewaySettingsView onBack={() => handleNavigateToPanel('')} />
      case 'agent-settings':
        return (
          <AgentSettingsView
            onBack={() => handleNavigateToPanel('')}
            onAgentCreated={(agentId) => {
              void refreshShellData()
              openChatForAgent(agentId)
            }}
          />
        )
      case 'about':
        return <AboutView onBack={() => handleNavigateToPanel('')} />
      case 'dashboard':
        return (
          <DashboardView
            onNavigateToSettings={() => handleNavigateToPanel('settings')}
            onNavigateToLlmApi={() => handleNavigateToPanel('llm-api')}
            onNavigateToSkills={() => handleNavigateToPanel('skills')}
            onNavigateToUpdates={() => handleNavigateToPanel('updates')}
            updateAvailable={updateAvailable && !updateDismissed}
            updateVersion={updateInfo?.version}
            onDismissUpdateNotice={() => dismissUpdateNotice()}
          />
        )
      case 'llm-api':
        return <ProviderView onBack={() => handleNavigateToPanel('')} />
      case 'models':
        return (
          <ModelsView
            onBack={() => handleNavigateToPanel('')}
            onChanged={() => void refreshShellData()}
          />
        )
      case 'skills':
        return <SkillsView onBack={() => handleNavigateToPanel('')} />
      case 'tasks':
        return (
          <TasksView
            onBack={() => handleNavigateToPanel('')}
            agents={agents}
            data={tasksData}
            selected={tasksSelected}
            onSelect={handleTasksSelect}
            onOpenSession={openTaskSession}
          />
        )
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
      {/* Фон приложения: живые цветные блобы + шум */}
      <div className="app-bg" aria-hidden>
        <div
          className="app-blob"
          style={{
            width: '34vmax',
            height: '34vmax',
            left: '38%',
            top: '-14vmax',
            background: 'radial-gradient(circle, var(--blob-3), transparent 62%)',
            animation: 'blob-drift-1 24s ease-in-out infinite alternate',
          }}
        />
        <div
          className="app-blob"
          style={{
            width: '30vmax',
            height: '30vmax',
            right: '-8vmax',
            bottom: '8vmax',
            background: 'radial-gradient(circle, var(--blob-4), transparent 60%)',
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
              <small>v{shellVersion || '0.9.0'}</small>
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
                  <span className="ic">{renderAgentBadge(a)}</span>
                  <span className="shell-menu-item-name">{a.name}</span>
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
                  handleNavigateToPanel('agent-settings')
                }}
              >
                <span className="ic">＋</span>
                Добавить агента…
              </button>
            </div>
          </div>

          {/* v0.9.12 (Damir 21:26Z): per-agent chat tabs live in the TOP BAR —
              right of the agent pill, left of ＋ Новый чат. The standalone
              tab row under the top bar was removed. Each agent owns its own
              tabs: 1 pinned agent chat + N text chats. */}
          {inChat && !hasActivePanel && (
            <div className="chat-tabs">
              <div className="chat-tabs-scroll">
                {(tabsByAgent[activeAgent] ?? []).map((tab) => (
                  <div
                    key={tab.id}
                    className={cn('chat-tab', tab.id === activeTabByAgent[activeAgent] && 'active')}
                    onClick={() => activateTab(activeAgent, tab.id)}
                    role="button"
                    title={tab.title}
                  >
                    <span className="chat-tab-ic">{tab.kind === 'agent' ? '🤖' : '💬'}</span>
                    <span className="chat-tab-title">{tab.title}</span>
                    {tab.kind === 'agent' && agentActivity[activeAgent] && (
                      <span className="chat-tab-busy" title="Агент работает…" />
                    )}
                    {tab.kind === 'text' && (
                      <button
                        type="button"
                        className="chat-tab-x"
                        onClick={(e) => {
                          e.stopPropagation()
                          closeTab(activeAgent, tab.id)
                        }}
                        title="Закрыть вкладку"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            className="shell-btn ghost"
            style={{ padding: '8px 16px' }}
            onClick={() => {
              // v0.9.12 (Damir 21:26Z): top-bar button creates a new text tab for the active agent
              if (!inChat) openSection(SECTIONS[0])
              newTextTab(activeAgent)
            }}
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
                <span className="ic"><Cpu size={15} strokeWidth={1.8} /></span> Модели и провайдеры <span className="hint">ключи, URL</span>
              </button>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('models'); scrollToLocalModelSection() }}>
                <span className="ic"><HardDrive size={15} strokeWidth={1.8} /></span> Локальный движок <span className="hint">llama.cpp</span>
              </button>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('telegram') }}>
                <span className="ic"><Send size={15} strokeWidth={1.8} /></span> Telegram <span className="hint">бот</span>
              </button>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('voice') }}>
                <span className="ic"><Mic size={15} strokeWidth={1.8} /></span> Голос и микрофон
              </button>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('gateway') }}>
                <span className="ic"><Globe size={15} strokeWidth={1.8} /></span> Шлюз (Gateway) <span className="hint">порт, доступ</span>
              </button>
              <div className="shell-menu-sep" />
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('settings') }}>
                <span className="ic"><Wrench size={15} strokeWidth={1.8} /></span> Расширенные <span className="hint">конфиг, порты</span>
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
              <div className="shell-menu-title">Разделы</div>
              {MORE_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={cn('shell-menu-item', activeSection === s.id && 'active')}
                  onClick={() => openSection(s)}
                >
                  <span className="ic">{s.icon}</span> {s.label}
                </button>
              ))}
              <div className="shell-menu-sep" />
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleOpenLogDir() }}>
                <span className="ic"><FileText size={15} strokeWidth={1.8} /></span> Журналы <span className="hint">logs</span>
              </button>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('dashboard') }}>
                <span className="ic"><BarChart3 size={15} strokeWidth={1.8} /></span> Статистика и расход
              </button>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('settings') }}>
                <span className="ic"><Archive size={15} strokeWidth={1.8} /></span> Резервная копия <span className="hint">экспорт</span>
              </button>
              <div className="shell-menu-sep" />
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('updates') }}>
                <span className="ic"><RefreshCw size={15} strokeWidth={1.8} /></span> Проверить обновления
              </button>
              <button type="button" className="shell-menu-item" onClick={() => { setOpenMenu(null); handleNavigateToPanel('about') }}>
                <span className="ic"><Info size={15} strokeWidth={1.8} /></span> О приложении
              </button>
            </div>
          </div>
        </header>

        {/* ══════════ MAIN ══════════ */}
        <div className="shell-main">
          {/* ── Sidebar ── */}
          <aside
            className="shell-glass shell-sidebar"
            onScroll={() => {
              if (agentModelMenu) setAgentModelMenu(null)
            }}
          >
            <div className="shell-side-group">
              <div className="shell-g-title">
                Агенты
                <span
                  className="plus"
                  title="Добавить агента"
                  onClick={() => handleNavigateToPanel('agent-settings')}
                >
                  ＋
                </span>
              </div>
              <div className="shell-agent-list">
              {agents.map((a) => (
                <div
                  key={a.id}
                  className={cn('shell-agent-row', agentModelMenu?.id === a.id && 'menu-open')}
                >
                  <button
                    type="button"
                    className={cn('shell-agent-item', activeAgent === a.id && 'active')}
                    onClick={() => openChatForAgent(a.id)}
                    title={`Агент ${a.name}`}
                  >
                    <div
                      className="shell-agent-av"
                      style={a.telegramBot ? { background: '#229ED9', borderColor: 'transparent' } : undefined}
                    >
                      {a.telegramBot ? (
                        <TelegramGlyph size={17} className="text-white" />
                      ) : (
                        a.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="a-body">
                      <div className="a-name">{a.name}</div>
                      <div className="a-sub">
                        {shortModel(a.model ?? primaryModel)} · 1M ctx
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="a-more"
                    title="Модель агента"
                    onClick={(e) => {
                      e.stopPropagation()
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      const row = (e.currentTarget as HTMLElement)
                        .closest('.shell-agent-row') as HTMLElement | null
                      const rowRect = row?.getBoundingClientRect() ?? rect
                      if (agentModelMenu?.id === a.id) {
                        setAgentModelMenu(null)
                      } else {
                        // Свежие модели при каждом открытии меню (v0.9.24).
                        void loadModelOptions()
                        setAgentModelMenu({
                          id: a.id,
                          x: rowRect.right,
                          y: rowRect.top + rowRect.height / 2,
                        })
                      }
                    }}
                  >
                    ⋯
                  </button>
                  <span
                    className={cn(
                      'a-status',
                      agentActivity[a.id]
                        ? 'busy'
                        : activeAgent === a.id
                          ? 'on'
                          : 'idle',
                    )}
                    title={agentActivity[a.id] ? 'Агент работает…' : activeAgent === a.id ? 'активен' : 'свободен'}
                  />
                  {agentModelMenu && agentModelMenu.id === a.id &&
                    createPortal(
                      <AgentMenuPortal
                        agent={a}
                        primaryModel={primaryModel ?? undefined}
                        modelOptions={modelOptions}
                        anchorX={agentModelMenu.x}
                        anchorCenterY={agentModelMenu.y}
                        onClose={() => setAgentModelMenu(null)}
                        onSetModel={(m) => void setAgentModel(a.id, m)}
                        onRemove={() => void handleRemoveAgent(a)}
                      />,
                      document.body,
                    )}
                </div>
              ))}
              </div>
            </div>

            {/* v0.9.34: «Группы» (рои) — между агентами и задачами */}
            <RoyGroupsList
              groups={royGroups}
              activeId={royOpenId}
              onOpen={(id) => {
                setRoyOpenId(id)
                onPanelChange('')
                setActiveSection('chat')
              }}
              onCreate={() => setRoyCreateOpen(true)}
              onRename={(id, name) =>
                setRoyGroups((gs) => gs.map((g) => (g.id === id ? renameGroup(g, name) : g)))
              }
              onRemove={(id) => {
                setRoyGroups((gs) => gs.filter((g) => g.id !== id))
                setRoyOpenId((cur) => (cur === id ? null : cur))
              }}
            />

            {/* v0.9.16: акцентный пункт «Задачи» — между агентами и разделами */}
            <button
              type="button"
              className={cn('shell-nav-feature', activePanel === 'tasks' && 'active')}
              onClick={() => handleNavigateToPanel('tasks')}
              title="Задачи агентов и расписания"
            >
              <span className="ic"><ListChecks size={16} strokeWidth={2} /></span>
              <span className="t">Задачи</span>
              {tasksData.activeCount > 0 && <span className="nf-count">{tasksData.activeCount}</span>}
              <span className="nf-badge">NEW</span>
            </button>

            <div className="shell-side-group">
              <div className="shell-g-title">Разделы</div>
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={cn('shell-section-item', activeSection === s.id && 'active')}
                  onClick={() => openSection(s)}
                >
                  <span className="ic">{s.icon}</span>
                  <span className="t">{s.label}</span>
                </button>
              ))}
            </div>

            {/* v0.9.36: «Диск» — кнопка, открывает дровер с деревом (файлы — на арену) */}
            <RoyDiskButton
              fileCount={royDiskFileCount}
              open={royDiskOpen}
              onToggle={() => setRoyDiskOpen((o) => !o)}
            />

            <div className="shell-side-foot">
              <div className="shell-disk">
                <span>Модели · {diskLabel}</span>
              </div>
              <div className="shell-disk-bar">
                <i style={{ width: `${diskPercent}%` }} />
              </div>
            </div>
          </aside>

          {/* v0.9.36: дровер «Диск» — поверх левой части, файлы тянутся на арену */}
          <RoyDiskDrawer
            open={royDiskOpen}
            roots={royDiskRoots}
            onOpenFile={(node) => void openRoyDiskFile(node)}
            onDragFile={royDiskDrag}
            onClose={() => setRoyDiskOpen(false)}
          />

          {/* ── Center: embedded Control UI / panels ── */}
          <section className="shell-chat-area">
            <div className="shell-chat-canvas">
              {/* v0.9.34: рой открыт → центральная область = арена */}
              {royOpenGroup && (
                <div className="roy-arena-slot">
                  <RoyArenaView
                    group={royOpenGroup}
                    agents={agents}
                    onPatch={royPatch}
                    onRunTask={(taskId) => void royRunTask(royOpenGroup.id, taskId)}
                    onChat={(agentId) => {
                      setRoyOpenId(null)
                      openChatForAgent(agentId)
                    }}
                    onRemoveAgent={royRemoveAgentRef}
                    onClose={() => setRoyOpenId(null)}
                    modelOptions={modelOptions}
                    onSetModel={(agentId, model) => void setAgentModel(agentId, model)}
                    onOpenPath={(p, l) => void openRoyDiskFile({ id: p, label: l ?? p, emoji: '📄', kind: 'file', path: p })}
                  />
                </div>
              )}
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
                allow="microphone; camera; autoplay; clipboard-read; clipboard-write"
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
                <TextChatView history={activeTabHistory} onHistoryChange={handleTabHistoryChange} />
              </div>
            )}

            {/* Desktop panel overlay (models/settings/etc.) — v0.9.10: themed
                scrim (light: white→blue gradient like the mockup; dark: deep
                navy) instead of the hard-coded dark overlay. */}
            {hasActivePanel && (
              <div className="shell-panel-overlay absolute inset-0 z-30 flex min-h-0 flex-col">
                <div className="shell-panel-head shrink-0 flex items-center gap-2 px-4 py-2">
                  <button
                    type="button"
                    onClick={() => handleNavigateToPanel('')}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg px-2 py-1.5 hover:bg-muted"
                    aria-label="Back to Control UI"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Control UI
                  </button>
                  <span className="text-sm text-muted-foreground">/</span>
                  <span className="text-sm font-medium">
                    {(() => {
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

            {/* BUG-1: config keys the gateway schema rejects — warn instead of silent crash-loop */}
            {configWarning && (
              <div className="absolute left-1/2 top-4 z-50 w-[min(92vw,640px)] -translate-x-1/2">
                <div className="flex items-start gap-3 rounded-2xl border border-red-300/60 bg-gradient-to-r from-red-500 to-rose-600 px-4 py-3 shadow-xl shadow-red-900/30">
                  <span className="mt-0.5 text-lg leading-none">🚨</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">Конфиг несовместим с gateway</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-red-50">{configWarning}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfigWarning(null)}
                    className="shrink-0 rounded-lg bg-white/25 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/40"
                  >
                    Понятно
                  </button>
                </div>
              </div>
            )}
            </div>

            {/* v0.9.11: mode switch — «Агентская задача | Просто текст» lives in
                its own strip BELOW the chat frame (was floating over the chat
                text / Control UI composer — Damir bug report). */}
            {!royOpenGroup && showControlUIIframe && !hasActivePanel && inChat && (
              <div className="shell-mode-strip">
                <div className="shell-mode-switch">
                  <button
                    type="button"
                    className={cn('shell-mode-btn', chatMode === 'agent' && 'active')}
                    onClick={handleAgentModeClick}
                    title={t('shell.chat.agentModeHint')}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    {t('shell.chat.agentMode')}
                  </button>
                  <button
                    type="button"
                    className={cn('shell-mode-btn', chatMode === 'text' && 'active')}
                    onClick={handleTextModeClick}
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
            {royOpenGroup ? (
              <RoyRightPanel
                group={royOpenGroup}
                agents={agents}
                onPatch={royPatch}
                onRunTask={(taskId) => void royRunTask(royOpenGroup.id, taskId)}
                onOpenPath={(p, l) => void openRoyDiskFile({ id: p, label: l ?? p, emoji: '📄', kind: 'file', path: p })}
              />
            ) : activePanel === 'tasks' ? (
              <TasksDetailPanel
                data={tasksData}
                selected={tasksSelected}
                tab={tasksDetailTab}
                onTabChange={setTasksDetailTab}
                onSelect={handleTasksSelect}
                onOpenSession={openTaskSession}
              />
            ) : (
              <>
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
                  {shortModel(activeAgentModel)}
                </div>
                <div className="t-sub mono">{activeAgentModel ?? '—'}</div>
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
              <button
                type="button"
                className={cn('shell-tile clickable', engineRunning && effectiveGpu === 'cpu' && 'on')}
                onClick={() => void toggleCompute('cpu')}
                disabled={engineBusy}
                title={engineRunning && effectiveGpu === 'cpu' ? 'Выключить движок' : 'Включить движок на CPU'}
              >
                <div className="t-label">
                  CPU{' '}
                  {engineRunning && effectiveGpu === 'cpu' && <span className="shell-dot ok" />}
                </div>
                <div className="t-val" style={{ fontSize: 13 }}>
                  {engineRunning && effectiveGpu === 'cpu' ? 'активен' : 'выкл'}
                </div>
                <div className="t-sub mono">процессор · llama.cpp</div>
              </button>
              <button
                type="button"
                className={cn('shell-tile clickable', engineRunning && effectiveGpu === 'gpu' && 'on')}
                onClick={() => void toggleCompute('gpu')}
                disabled={engineBusy}
                title={
                  engineRunning && effectiveGpu === 'gpu'
                    ? 'Выключить движок'
                    : installedVariants.some((v) => v === 'cuda' || v === 'vulkan')
                      ? 'Включить движок на GPU'
                      : 'GPU-сборка не установлена — открою Модели'
                }
              >
                <div className="t-label">
                  GPU{' '}
                  {engineRunning && effectiveGpu === 'gpu' && <span className="shell-dot ok" />}
                </div>
                <div className="t-val" style={{ fontSize: 13 }}>
                  {engineRunning && effectiveGpu === 'gpu' ? 'активен' : 'выкл'}
                </div>
                <div className="t-sub mono">{gpuName && gpuName.trim() ? gpuName : 'видеокарта'}</div>
              </button>
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
            </div>

            {/* v0.9.39 (Damir 14:18Z): «Сессии» переехали из левой колонки сюда —
                в правую панель «Состояние», под кнопки соединения/движка */}
            <div className="shell-sp-head">
              <span className="t">Сессии</span>
              <span className="plus" title="Все сеансы" onClick={() => openSection(MORE_SECTIONS[2])}>
                ＋
              </span>
            </div>
            {sessions.length === 0 ? (
              <div className="shell-sessions-none">нет активных сессий</div>
            ) : (
              <div className="shell-session-list">
                {sessions.map((s) => (
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
                ))}
              </div>
            )}

            <div className="shell-mini-links">
              <a onClick={handleOpenLogDir}>Журналы</a>
              <a onClick={() => handleNavigateToPanel('models')}>Настройки моделей</a>
              <a onClick={() => handleNavigateToPanel('settings')}>Резервная копия</a>
              <a onClick={() => handleNavigateToPanel('updates')}>Обновления</a>
              <a onClick={() => handleNavigateToPanel('about')}>О приложении</a>
            </div>
              </>
            )}
          </aside>
        </div>

        {/* ══════════ STATUS BAR ══════════ */}
        <footer className="shell-glass shell-statusbar">
          <span className="ok">● gateway {gatewayOk ? 'online' : 'starting'}</span>
          <span className="sep">·</span>
          <span>agent: {activeAgent}</span>
          <span className="sep">·</span>
          <span>model: {activeAgentModel ?? '—'}</span>
          <span className="sep">·</span>
          <span>engine: {engineLabel}</span>
          <span className="sp-r">
            <span>token: {hasGatewayToken ? 'OK' : '—'}</span>
            <span className="sep">·</span>
            <span className="lat">{clock} UTC</span>
          </span>
        </footer>

        {/* v0.9.34: рой-оверлеи — создание группы и просмотр файла Диска */}
        {royCreateOpen && (
          <RoyCreateModal onCreate={royCreate} onClose={() => setRoyCreateOpen(false)} />
        )}
        {royFileNode && (
          <RoyFileViewer
            node={royFileNode}
            content={royFileContent}
            onClose={() => setRoyFileNode(null)}
          />
        )}
      </div>
    </main>
  )
}
