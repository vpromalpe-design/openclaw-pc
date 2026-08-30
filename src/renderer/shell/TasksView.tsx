import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ListChecks,
  Search,
  RefreshCw,
  Send,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2,
  CalendarClock,
  Play,
  Trash2,
  Bot,
  Zap,
  FileText,
  TerminalSquare,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Agent shape passed down from the shell sidebar (same as EmbeddedShellLayout). */
export interface AgentInfo {
  id: string
  name: string
  model?: string
  isDefault?: boolean
}

export interface TasksViewProps {
  onBack?: () => void
  /** Agents available for task dispatch */
  agents?: AgentInfo[]
}

type TaskStatus = string
type TaskFilter = 'all' | 'running' | 'queued' | 'failed' | 'scheduled' | 'done'

interface TaskItem {
  id: string
  taskId?: string
  kind?: string
  runtime?: string
  status: TaskStatus
  title?: string
  agentId?: string
  sessionKey?: string
  childSessionKey?: string
  ownerKey?: string
  runId?: string
  flowId?: string
  parentTaskId?: string
  sourceId?: string
  createdAt?: number
  updatedAt?: number
  startedAt?: number
  endedAt?: number
  progressSummary?: string
  terminalSummary?: string
  error?: string
}

interface CronJob {
  id: string
  name?: string
  displayName?: string
  enabled?: boolean
  agentId?: string
  schedule?: { kind?: string; expr?: string; at?: string; everyMs?: number }
  payload?: { kind?: string; message?: string }
  nextRunAtMs?: number | null
  lastRunAtMs?: number | null
  lastRunStatus?: string | null
}

const STATUS_META: Record<
  string,
  { label: string; dot: string; badge: string; icon: 'running' | 'queued' | 'done' | 'failed' | 'cancelled' }
> = {
  running: { label: 'running', dot: 'bg-sky-400', badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30', icon: 'running' },
  queued: { label: 'queued', dot: 'bg-amber-400', badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: 'queued' },
  succeeded: { label: 'done', dot: 'bg-green-400', badge: 'bg-green-500/15 text-green-300 border-green-500/30', icon: 'done' },
  completed: { label: 'done', dot: 'bg-green-400', badge: 'bg-green-500/15 text-green-300 border-green-500/30', icon: 'done' },
  failed: { label: 'failed', dot: 'bg-red-400', badge: 'bg-red-500/15 text-red-300 border-red-500/30', icon: 'failed' },
  cancelled: { label: 'cancelled', dot: 'bg-zinc-500', badge: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30', icon: 'cancelled' },
  canceled: { label: 'cancelled', dot: 'bg-zinc-500', badge: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30', icon: 'cancelled' },
}

function fmtTime(ms?: number | null): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const now = Date.now()
  const diff = now - ms
  if (diff >= 0 && diff < 60_000) return 'только что'
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff >= 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(started?: number, ended?: number): string {
  if (!started) return '—'
  const end = ended ?? Date.now()
  const s = Math.max(0, Math.round((end - started) / 1000))
  if (s < 60) return `${s} с`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} мин ${s % 60} с`
  return `${Math.floor(m / 60)} ч ${m % 60} мин`
}

function TaskStatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const meta = STATUS_META[status]
  if (!meta) return <Clock className={className} aria-hidden />
  switch (meta.icon) {
    case 'running':
      return <Loader2 className={`${className} animate-spin`} aria-hidden />
    case 'queued':
      return <Clock className={className} aria-hidden />
    case 'done':
      return <CheckCircle2 className={className} aria-hidden />
    case 'failed':
      return <XCircle className={className} aria-hidden />
    case 'cancelled':
      return <X className={className} aria-hidden />
  }
}

export function TasksView({ agents = [] }: TasksViewProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [cronJobs, setCronJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [detail, setDetail] = useState<{ kind: 'task' | 'cron'; item: TaskItem | CronJob } | null>(null)
  const [dispatchText, setDispatchText] = useState('')
  const [dispatchAgent, setDispatchAgent] = useState('main')
  const [dispatchWhen, setDispatchWhen] = useState<'now' | 'later'>('now')
  const [dispatchAt, setDispatchAt] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'output' | 'details' | 'actions'>('output')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const [tasksRes, cronRes] = await Promise.all([
        window.electronAPI.tasksList({ limit: 200 }),
        window.electronAPI.cronList(),
      ])
      setTasks((tasksRes?.tasks as unknown as TaskItem[]) ?? [])
      setCronJobs((cronRes?.jobs as unknown as CronJob[]) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      setReloading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    timerRef.current = setInterval(() => void load(true), 10_000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [load])

  const handleReload = useCallback(() => {
    setReloading(true)
    void load(true)
  }, [load])

  const counts = useMemo(() => {
    const c: Record<TaskFilter, number> = { all: 0, running: 0, queued: 0, failed: 0, scheduled: cronJobs.length, done: 0 }
    for (const task of tasks) {
      c.all += 1
      if (task.status === 'running') c.running += 1
      else if (task.status === 'queued') c.queued += 1
      else if (task.status === 'failed') c.failed += 1
      else if (task.status === 'succeeded' || task.status === 'completed' || task.status === 'cancelled' || task.status === 'canceled') c.done += 1
    }
    return c
  }, [tasks, cronJobs])

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return tasks.filter((task) => {
      if (filter !== 'all') {
        if (filter === 'running' && task.status !== 'running') return false
        if (filter === 'queued' && task.status !== 'queued') return false
        if (filter === 'failed' && task.status !== 'failed') return false
        if (filter === 'done' && !(task.status === 'succeeded' || task.status === 'completed' || task.status === 'cancelled' || task.status === 'canceled')) return false
      }
      if (q) {
        const hay = `${task.title ?? ''} ${task.agentId ?? ''} ${task.terminalSummary ?? ''} ${task.progressSummary ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tasks, filter, searchQuery])

  const filteredCron = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return cronJobs.filter((job) => {
      if (filter !== 'all' && filter !== 'scheduled') return false
      if (q) {
        const hay = `${job.name ?? ''} ${job.displayName ?? ''} ${job.payload?.message ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [cronJobs, filter, searchQuery])

  const showFeedback = useCallback((msg: string) => {
    setActionFeedback(msg)
    setTimeout(() => setActionFeedback(null), 3000)
  }, [])

  const handleCancelTask = useCallback(
    async (task: TaskItem) => {
      try {
        await window.electronAPI.tasksCancel({ taskId: task.taskId ?? task.id })
        showFeedback('Задача отменена')
        void load(true)
      } catch (err) {
        showFeedback(err instanceof Error ? err.message : String(err))
      }
    },
    [load, showFeedback],
  )

  const handleRunCron = useCallback(
    async (job: CronJob) => {
      try {
        await window.electronAPI.cronRun({ jobId: job.id })
        showFeedback('Задача запущена')
        void load(true)
      } catch (err) {
        showFeedback(err instanceof Error ? err.message : String(err))
      }
    },
    [load, showFeedback],
  )

  const handleRemoveCron = useCallback(
    async (job: CronJob) => {
      try {
        await window.electronAPI.cronRemove({ jobId: job.id })
        showFeedback('Расписание удалено')
        setDetail(null)
        void load(true)
      } catch (err) {
        showFeedback(err instanceof Error ? err.message : String(err))
      }
    },
    [load, showFeedback],
  )

  const handleDispatch = useCallback(async () => {
    const text = dispatchText.trim()
    if (!text) return
    setDispatching(true)
    try {
      if (dispatchWhen === 'now') {
        const res = await window.electronAPI.tasksDispatch({ text, agentId: dispatchAgent })
        if (!res.ok) throw new Error(res.error ?? 'dispatch failed')
        showFeedback('Задача отправлена агенту')
      } else {
        const at = new Date(dispatchAt || Date.now() + 3_600_000).toISOString()
        const res = await window.electronAPI.cronAdd({
          name: text.slice(0, 80),
          schedule: { kind: 'at', at },
          sessionTarget: 'isolated',
          payload: { kind: 'agentTurn', message: text },
          delivery: { mode: 'none' },
        })
        if (!res.ok) throw new Error(res.error ?? 'cron.add failed')
        showFeedback('Задача отложена в расписание')
      }
      setDispatchText('')
      void load(true)
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : String(err))
    } finally {
      setDispatching(false)
    }
  }, [dispatchText, dispatchAgent, dispatchWhen, dispatchAt, load, showFeedback])

  const groupTasks = useCallback(
    (statuses: string[]) => filteredTasks.filter((task) => statuses.includes(task.status)),
    [filteredTasks],
  )

  const groups = useMemo(() => {
    return [
      { key: 'running', title: 'Выполняются', icon: <Zap className="w-4 h-4 text-sky-300" aria-hidden />, items: groupTasks(['running']) },
      { key: 'queued', title: 'В очереди', icon: <Clock className="w-4 h-4 text-amber-300" aria-hidden />, items: groupTasks(['queued']) },
      { key: 'failed', title: 'Ошибки', icon: <AlertTriangle className="w-4 h-4 text-red-300" aria-hidden />, items: groupTasks(['failed']) },
      { key: 'done', title: 'Завершено', icon: <CheckCircle2 className="w-4 h-4 text-green-300" aria-hidden />, items: groupTasks(['succeeded', 'completed', 'cancelled', 'canceled']) },
    ]
  }, [groupTasks])

  const renderTaskRow = (task: TaskItem, indent = false) => {
    const meta = STATUS_META[task.status]
    const isSelected = detail?.kind === 'task' && detail.item === task
    return (
      <li key={task.id}>
        <button
          type="button"
          onClick={() => {
            setDetail({ kind: 'task', item: task })
            setDetailTab('output')
          }}
          className={`w-full text-left group flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-all ${
            isSelected
              ? 'border-primary/50 bg-primary/10'
              : 'border-border/80 bg-card/60 hover:border-primary/30 hover:bg-card'
          } ${indent ? 'ml-6' : ''}`}
        >
          <span className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${meta?.dot ?? 'bg-zinc-500'}`} aria-hidden />
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2">
              <TaskStatusIcon status={task.status} className="w-4 h-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium truncate">{task.title || task.taskId || task.id}</span>
              {task.parentTaskId && (
                <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30">
                  ветка
                </span>
              )}
            </span>
            {task.progressSummary && task.status === 'running' && (
              <span className="block text-xs text-muted-foreground mt-1 line-clamp-1">{task.progressSummary}</span>
            )}
            {task.error && task.status === 'failed' && (
              <span className="block text-xs text-red-400/90 mt-1 line-clamp-1">{task.error}</span>
            )}
            <span className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground/80">
              <span className="inline-flex items-center gap-1">
                <Bot className="w-3 h-3" aria-hidden />
                {task.agentId || 'main'}
              </span>
              {task.kind && <span>{task.kind}</span>}
              {task.startedAt && <span>· {fmtDuration(task.startedAt, task.endedAt)}</span>}
              <span>· {fmtTime(task.updatedAt ?? task.createdAt)}</span>
            </span>
          </span>
          <span
            className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
              meta?.badge ?? 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'
            }`}
          >
            {meta?.label ?? task.status}
          </span>
        </button>
      </li>
    )
  }

  const renderCronRow = (job: CronJob) => {
    const isSelected = detail?.kind === 'cron' && detail.item === job
    const scheduleLabel =
      job.schedule?.kind === 'every'
        ? `каждые ${Math.round((job.schedule.everyMs ?? 0) / 60_000)} мин`
        : job.schedule?.kind === 'cron'
          ? (job.schedule.expr ?? 'cron')
          : job.schedule?.kind === 'at'
            ? `в ${fmtTime(job.schedule.at ? new Date(job.schedule.at).getTime() : undefined)}`
            : job.schedule?.kind ?? '—'
    return (
      <li key={job.id}>
        <button
          type="button"
          onClick={() => {
            setDetail({ kind: 'cron', item: job })
            setDetailTab('output')
          }}
          className={`w-full text-left group flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-all ${
            isSelected
              ? 'border-primary/50 bg-primary/10'
              : 'border-border/80 bg-card/60 hover:border-primary/30 hover:bg-card'
          }`}
        >
          <span className="mt-0.5 shrink-0 w-2 h-2 rounded-full bg-purple-400" aria-hidden />
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 shrink-0 text-purple-300" aria-hidden />
              <span className="text-sm font-medium truncate">{job.name || job.displayName || job.id}</span>
            </span>
            {job.payload?.message && (
              <span className="block text-xs text-muted-foreground mt-1 line-clamp-1">{job.payload.message}</span>
            )}
            <span className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground/80">
              <span className="inline-flex items-center gap-1">
                <Bot className="w-3 h-3" aria-hidden />
                {job.agentId || 'main'}
              </span>
              <span>· {scheduleLabel}</span>
              {job.nextRunAtMs && <span>· след. {fmtTime(job.nextRunAtMs)}</span>}
              {job.lastRunStatus && <span>· последний: {job.lastRunStatus}</span>}
            </span>
          </span>
          <span
            className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
              job.enabled === false
                ? 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'
                : 'bg-purple-500/15 text-purple-300 border-purple-500/30'
            }`}
          >
            {job.enabled === false ? 'выкл' : 'расписание'}
          </span>
        </button>
      </li>
    )
  }

  const renderDetail = () => {
    if (!detail) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center p-6">
          <ListChecks className="w-12 h-12 text-muted-foreground/30 mb-3" aria-hidden />
          <p className="text-sm font-medium text-muted-foreground">Выберите задачу</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Подробности появятся здесь</p>
        </div>
      )
    }
    if (detail.kind === 'cron') {
      const job = detail.item as CronJob
      return (
        <div className="flex flex-col h-full">
          <div className="px-4 py-3 border-b border-border/70">
            <p className="text-sm font-semibold truncate">{job.name || job.id}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Расписание · {job.id.slice(0, 8)}</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-muted-foreground">Агент</p>
                <p className="font-medium mt-0.5">{job.agentId || 'main'}</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-muted-foreground">Статус</p>
                <p className="font-medium mt-0.5">{job.enabled === false ? 'выключено' : 'активно'}</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-muted-foreground">След. запуск</p>
                <p className="font-medium mt-0.5">{fmtTime(job.nextRunAtMs)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-muted-foreground">Последний</p>
                <p className="font-medium mt-0.5">{job.lastRunStatus ?? '—'}</p>
              </div>
            </div>
            {job.payload?.message && (
              <div className="rounded-lg border border-border/70 bg-card/60 p-3">
                <p className="text-[11px] font-semibold text-muted-foreground mb-1">Задача</p>
                <p className="text-xs whitespace-pre-wrap leading-relaxed">{job.payload.message}</p>
              </div>
            )}
          </div>
          <div className="p-3 border-t border-border/70 flex gap-2">
            <Button size="sm" onClick={() => void handleRunCron(job)} className="flex-1">
              <Play className="w-3.5 h-3.5 mr-1.5" aria-hidden />
              Запустить сейчас
            </Button>
            <Button size="sm" variant="outline" onClick={() => void handleRemoveCron(job)}>
              <Trash2 className="w-3.5 h-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      )
    }
    const task = detail.item as TaskItem
    const meta = STATUS_META[task.status]
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-border/70">
          <div className="flex items-center gap-2">
            <TaskStatusIcon status={task.status} className="w-4 h-4 shrink-0" />
            <p className="text-sm font-semibold truncate">{task.title || task.taskId || task.id}</p>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${meta?.badge ?? 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'}`}
            >
              {meta?.label ?? task.status}
            </span>
            <span className="text-[11px] text-muted-foreground">{task.agentId || 'main'}</span>
            {task.kind && <span className="text-[11px] text-muted-foreground">· {task.kind}</span>}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border/70 px-2">
          {(
            [
              { id: 'output', label: 'Вывод', icon: <TerminalSquare className="w-3.5 h-3.5" aria-hidden /> },
              { id: 'details', label: 'Детали', icon: <FileText className="w-3.5 h-3.5" aria-hidden /> },
              { id: 'actions', label: 'Действия', icon: <Zap className="w-3.5 h-3.5" aria-hidden /> },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setDetailTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                detailTab === tab.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {detailTab === 'output' && (
            <>
              {task.status === 'running' && task.progressSummary && (
                <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 p-3">
                  <p className="text-[11px] font-semibold text-sky-300 mb-1 flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                    Выполняется
                  </p>
                  <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">{task.progressSummary}</p>
                </div>
              )}
              {task.terminalSummary && (
                <div className="rounded-lg border border-border/70 bg-card/60 p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-1">Итог</p>
                  <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">{task.terminalSummary}</p>
                </div>
              )}
              {task.error && (
                <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-3">
                  <p className="text-[11px] font-semibold text-red-300 mb-1 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3" aria-hidden />
                    Ошибка
                  </p>
                  <p className="text-xs text-red-200/90 whitespace-pre-wrap leading-relaxed">{task.error}</p>
                </div>
              )}
              {!task.progressSummary && !task.terminalSummary && !task.error && (
                <p className="text-xs text-muted-foreground text-center pt-8">Нет вывода</p>
              )}
            </>
          )}
          {detailTab === 'details' && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-muted/50 px-3 py-2 col-span-2">
                <p className="text-muted-foreground">ID</p>
                <p className="font-mono text-[11px] mt-0.5 break-all">{task.id}</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-muted-foreground">Создана</p>
                <p className="font-medium mt-0.5">{fmtTime(task.createdAt)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-muted-foreground">Обновлена</p>
                <p className="font-medium mt-0.5">{fmtTime(task.updatedAt)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-muted-foreground">Запуск</p>
                <p className="font-medium mt-0.5">{fmtTime(task.startedAt)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-muted-foreground">Длительность</p>
                <p className="font-medium mt-0.5">{fmtDuration(task.startedAt, task.endedAt)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-muted-foreground">Run ID</p>
                <p className="font-mono text-[11px] mt-0.5 break-all">{task.runId ?? '—'}</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-muted-foreground">Агент</p>
                <p className="font-medium mt-0.5">{task.agentId || 'main'}</p>
              </div>
              {task.parentTaskId && (
                <div className="rounded-lg bg-muted/50 px-3 py-2 col-span-2">
                  <p className="text-muted-foreground">Родительская задача</p>
                  <p className="font-mono text-[11px] mt-0.5 break-all">{task.parentTaskId}</p>
                </div>
              )}
            </div>
          )}
          {detailTab === 'actions' && (
            <div className="space-y-2">
              {(task.status === 'running' || task.status === 'queued') && (
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => void handleCancelTask(task)}
                >
                  <X className="w-4 h-4 mr-1.5" aria-hidden />
                  Отменить задачу
                </Button>
              )}
              <Button variant="outline" className="w-full" onClick={() => setDetail(null)}>
                Закрыть
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const FILTERS: { id: TaskFilter; label: string }[] = [
    { id: 'all', label: 'Все' },
    { id: 'running', label: 'Выполняются' },
    { id: 'queued', label: 'В очереди' },
    { id: 'failed', label: 'Ошибки' },
    { id: 'scheduled', label: 'Отложено' },
    { id: 'done', label: 'Завершено' },
  ]

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-200">
      {/* Header */}
      <div className="px-4 sm:px-6 pt-4 pb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
            <ListChecks className="w-4.5 h-4.5 text-primary" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold leading-tight">Задачи</h2>
            <p className="text-[11px] text-muted-foreground">Агенты, выполнение и расписания</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {actionFeedback && (
            <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/25 rounded-lg px-2.5 py-1">
              {actionFeedback}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={handleReload} disabled={reloading || loading}>
            {reloading || loading ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="w-4 h-4" aria-hidden />
            )}
            <span className="ml-1.5">Обновить</span>
          </Button>
        </div>
      </div>

      {/* Filters + search */}
      <div className="px-4 sm:px-6 pb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filter === f.id
                  ? 'bg-primary/15 border-primary/40 text-primary'
                  : 'border-border bg-card/50 text-muted-foreground hover:text-foreground hover:border-border/70'
              }`}
            >
              {f.label}
              <span className="ml-1.5 opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden />
          <Input
            placeholder="Поиск задач…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
            aria-label="Поиск задач"
          />
        </div>
      </div>

      {error && (
        <div className="mx-4 sm:mx-6 mb-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2.5 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" aria-hidden />
          <p className="text-xs text-red-200/90 flex-1">{error}</p>
          <Button size="sm" variant="outline" onClick={handleReload}>
            Повторить
          </Button>
        </div>
      )}

      {/* Board */}
      <div className="flex-1 min-h-0 px-4 sm:px-6 pb-4 flex gap-4">
        <div className="flex-1 min-w-0 space-y-5 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-primary" aria-hidden />
            </div>
          ) : (
            <>
              {/* Dispatch box */}
              <section className="rounded-2xl border border-border/80 bg-card/40 p-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <Send className="w-4 h-4 text-primary" aria-hidden />
                  <h3 className="text-sm font-semibold">Новая задача</h3>
                </div>
                <div className="flex flex-col gap-2.5">
                  <Textarea
                    placeholder="Опишите задачу агенту…"
                    value={dispatchText}
                    onChange={(e) => setDispatchText(e.target.value)}
                    className="min-h-[70px] resize-none text-sm"
                    aria-label="Текст задачи"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={dispatchAgent} onValueChange={setDispatchAgent}>
                      <SelectTrigger className="w-44 h-9 text-sm" aria-label="Агент">
                        <Bot className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" aria-hidden />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(agents.length > 0 ? agents : [{ id: 'main', name: 'main' }]).map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={dispatchWhen} onValueChange={(v) => setDispatchWhen(v as 'now' | 'later')}>
                      <SelectTrigger className="w-40 h-9 text-sm" aria-label="Когда">
                        <Clock className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" aria-hidden />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="now">Сейчас</SelectItem>
                        <SelectItem value="later">Отложить</SelectItem>
                      </SelectContent>
                    </Select>
                    {dispatchWhen === 'later' && (
                      <Input
                        type="datetime-local"
                        value={dispatchAt}
                        onChange={(e) => setDispatchAt(e.target.value)}
                        className="w-52 h-9 text-sm"
                        aria-label="Время запуска"
                      />
                    )}
                    <Button
                      className="ml-auto"
                      onClick={() => void handleDispatch()}
                      disabled={dispatching || !dispatchText.trim()}
                    >
                      {dispatching ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                      ) : (
                        <Send className="w-4 h-4" aria-hidden />
                      )}
                      <span className="ml-1.5">
                        {dispatchWhen === 'now' ? 'Запустить' : 'Отложить'}
                      </span>
                    </Button>
                  </div>
                </div>
              </section>

              {/* Cron group */}
              {filteredCron.length > 0 && (
                <section aria-label="Отложенные задачи">
                  <div className="flex items-center gap-2 px-1 mb-2">
                    <CalendarClock className="w-4 h-4 text-purple-300" aria-hidden />
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Отложенные · расписания
                    </h3>
                    <span className="text-[11px] text-muted-foreground/70">{filteredCron.length}</span>
                  </div>
                  <ul className="space-y-2">{filteredCron.map(renderCronRow)}</ul>
                </section>
              )}

              {/* Task groups */}
              {groups.map(
                (g) =>
                  g.items.length > 0 && (
                    <section key={g.key} aria-label={g.title}>
                      <div className="flex items-center gap-2 px-1 mb-2">
                        {g.icon}
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h3>
                        <span className="text-[11px] text-muted-foreground/70">{g.items.length}</span>
                      </div>
                      <ul className="space-y-2">{g.items.map((task) => renderTaskRow(task))}</ul>
                    </section>
                  ),
              )}

              {filteredTasks.length === 0 && filteredCron.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-10 text-center">
                  <ListChecks className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" aria-hidden />
                  <p className="text-sm font-medium text-muted-foreground">
                    {tasks.length === 0 && cronJobs.length === 0
                      ? 'Задач пока нет. Опишите задачу выше — агент начнёт выполнение.'
                      : 'Ничего не найдено по фильтру или поиску.'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Detail panel */}
        <aside className="w-[340px] shrink-0 hidden lg:block rounded-2xl border border-border/80 bg-card/40 overflow-hidden">
          {renderDetail()}
        </aside>
      </div>
    </div>
  )
}
