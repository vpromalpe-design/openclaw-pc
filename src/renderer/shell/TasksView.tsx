import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ListChecks,
  Search,
  RefreshCw,
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
  Copy,
  MessageSquare,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

/** Agent shape passed down from the shell sidebar (same as EmbeddedShellLayout). */
export interface AgentInfo {
  id: string
  name: string
  model?: string
  isDefault?: boolean
}

/** Task row from the gateway task ledger (tasks.list). */
export interface TaskItem {
  id: string
  kind?: string
  runtime?: string
  status: string
  title?: string
  agentId?: string
  sessionKey?: string
  childSessionKey?: string
  ownerKey?: string
  runId?: string
  taskId?: string
  flowId?: string
  parentTaskId?: string
  sourceId?: string
  createdAt?: number | string
  updatedAt?: number | string
  startedAt?: number | string
  endedAt?: number | string
  progressSummary?: string
  terminalSummary?: string
  error?: string
}

/** Cron job row (cron.list). */
export interface CronJob {
  id: string
  name?: string
  displayName?: string
  description?: string
  enabled?: boolean
  agentId?: string
  sessionKey?: string
  schedule?: { kind?: string; expr?: string; at?: string; everyMs?: number; tz?: string }
  sessionTarget?: string
  wakeMode?: string
  payload?: { kind?: string; message?: string; text?: string; model?: string }
  delivery?: { mode?: string; channel?: string; to?: string }
  createdAtMs?: number
  updatedAtMs?: number
  nextRunAtMs?: number | null
  lastRunAtMs?: number | null
  lastRunStatus?: string | null
  lastRunError?: string | null
}

export interface TasksData {
  tasks: TaskItem[]
  cronJobs: CronJob[]
  loading: boolean
  reloading: boolean
  error: string | null
  reload: (quiet?: boolean) => Promise<void>
  cancelTask: (task: TaskItem) => Promise<string | null>
  runCron: (job: CronJob) => Promise<string | null>
  removeCron: (job: CronJob) => Promise<string | null>
  /** Dispatch «now» or schedule; returns error message or null on success. */
  dispatchTask: (opts: {
    text: string
    agentId?: string
    timeOpt: string
    freq: string
    pickVal?: string
  }) => Promise<string | null>
  counts: Record<string, number>
  activeCount: number
}

export type TasksSelection = { kind: 'task' | 'cron'; id: string } | null
export type TasksDetailTab = 'output' | 'details' | 'memory' | 'actions'

export interface TasksViewProps {
  onBack?: () => void
  /** Agents available for task dispatch */
  agents?: AgentInfo[]
  data: TasksData
  selected?: TasksSelection
  onSelect?: (sel: TasksSelection) => void
  onOpenSession?: (sessionKey?: string) => void
}

const STATUS_META: Record<
  string,
  { label: string; color: string; bg: string; icon: 'running' | 'queued' | 'done' | 'failed' | 'cancelled' }
> = {
  running: { label: 'выполняется', color: '#0A84FF', bg: 'rgba(10,132,255,.14)', icon: 'running' },
  queued: { label: 'в очереди', color: '#FFD60A', bg: 'rgba(255,214,10,.13)', icon: 'queued' },
  completed: { label: 'готово', color: '#30D158', bg: 'rgba(48,209,88,.13)', icon: 'done' },
  succeeded: { label: 'готово', color: '#30D158', bg: 'rgba(48,209,88,.13)', icon: 'done' },
  failed: { label: 'ошибка', color: '#FF453A', bg: 'rgba(255,69,58,.13)', icon: 'failed' },
  timed_out: { label: 'таймаут', color: '#FF453A', bg: 'rgba(255,69,58,.13)', icon: 'failed' },
  cancelled: { label: 'отменена', color: '#8E8E93', bg: 'rgba(142,142,147,.14)', icon: 'cancelled' },
  canceled: { label: 'отменена', color: '#8E8E93', bg: 'rgba(142,142,147,.14)', icon: 'cancelled' },
}

const KIND_ICON: Record<string, string> = { flow: '🔀', subagent: '🧩', acp: '⚙️', cron: '⏰', task: '📋' }
const KIND_LABEL: Record<string, string> = { flow: 'flow', subagent: 'субагент', acp: 'ACP', cron: 'cron', task: 'задача' }

function toMs(ts?: number | string): number | undefined {
  if (ts == null) return undefined
  if (typeof ts === 'number') return ts
  const n = Number(ts)
  return Number.isFinite(n) ? n : new Date(ts).getTime() || undefined
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

function fmtWhen(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now.getTime() + 86_400_000).toDateString() === d.toDateString()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (sameDay) return `сегодня ${hm}`
  if (tomorrow) return `завтра ${hm}`
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + hm
}

function TaskStatusIcon({ status, className }: { status: string; className?: string }) {
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

function scheduleLabel(job: CronJob): string {
  const s = job.schedule
  if (!s) return '—'
  if (s.kind === 'every') return `каждые ${Math.round((s.everyMs ?? 0) / 60_000)} мин`
  if (s.kind === 'cron') return s.expr ?? 'cron'
  if (s.kind === 'at') return `в ${fmtWhen(new Date(s.at ?? Date.now()).getTime())}`
  return s.kind ?? '—'
}

/** Shared data hook: task ledger + cron jobs, 10s polling, actions. */
export function useTasksData(enabled = true): TasksData {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [cronJobs, setCronJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    if (!enabled) return
    void load()
    timerRef.current = setInterval(() => void load(true), 10_000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [load, enabled])

  const cancelTask = useCallback(
    async (task: TaskItem): Promise<string | null> => {
      try {
        await window.electronAPI.tasksCancel({ taskId: task.taskId ?? task.id })
        void load(true)
        return null
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    },
    [load],
  )

  const runCron = useCallback(
    async (job: CronJob): Promise<string | null> => {
      try {
        await window.electronAPI.cronRun({ jobId: job.id })
        void load(true)
        return null
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    },
    [load],
  )

  const removeCron = useCallback(
    async (job: CronJob): Promise<string | null> => {
      try {
        await window.electronAPI.cronRemove({ jobId: job.id })
        void load(true)
        return null
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    },
    [load],
  )

  const dispatchTask = useCallback(
    async (opts: {
      text: string
      agentId?: string
      timeOpt: string
      freq: string
      pickVal?: string
    }): Promise<string | null> => {
      const text = opts.text.trim()
      const agentId = (opts.agentId ?? 'main').trim() || 'main'
      const freq = opts.freq
      const timeOpt = opts.timeOpt
      const pickVal = opts.pickVal || '19:30'

      // Разово и сейчас → прямой запуск через агента (chat.send).
      if (freq === 'once' && timeOpt === 'now') {
        try {
          const res = await window.electronAPI.tasksDispatch({ text, agentId })
          if (!res.ok) return res.error ?? 'dispatch failed'
          void load(true)
          return null
        } catch (err) {
          return err instanceof Error ? err.message : String(err)
        }
      }

      // Иначе — cron: периодичность + время первого запуска.
      const now = new Date()
      const hmFromTime = (): { h: number; m: number } => {
        if (timeOpt === 'today20') return { h: 20, m: 0 }
        if (timeOpt === 'tmr9') return { h: 9, m: 0 }
        if (timeOpt === 'pick') {
          const [h, m] = pickVal.split(':').map(Number)
          return { h: Number.isFinite(h) ? h : 19, m: Number.isFinite(m) ? m : 30 }
        }
        return { h: (now.getHours() + 1) % 24, m: now.getMinutes() }
      }
      const atMs = (): number => {
        const { h, m } = hmFromTime()
        const d = new Date(now)
        d.setHours(h, m, 0, 0)
        if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
        return d.getTime()
      }

      let schedule: { kind: string; at?: string; expr?: string; everyMs?: number }
      if (freq === 'hourly') {
        schedule = { kind: 'every', everyMs: 3_600_000 }
      } else if (freq === 'daily' || freq === 'weekly' || freq === 'monthly') {
        const { h, m } = hmFromTime()
        const dom = freq === 'monthly' ? '1' : '*'
        const dow = freq === 'weekly' ? '1' : '*'
        schedule = { kind: 'cron', expr: `${m} ${h} ${dom} * ${dow}` }
      } else {
        // once + отложенное время
        schedule = { kind: 'at', at: new Date(atMs()).toISOString() }
      }

      try {
        const res = await window.electronAPI.cronAdd({
          name: text.slice(0, 80),
          schedule,
          sessionTarget: 'isolated',
          wakeMode: 'now',
          payload: { kind: 'agentTurn', message: text },
          delivery: { mode: 'none' },
        })
        if (!res.ok) return res.error ?? 'cron.add failed'
        void load(true)
        return null
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    },
    [load],
  )

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, waiting: 0, running: 0, failed: 0, scheduled: cronJobs.length, done: 0 }
    for (const t of tasks) {
      c.all += 1
      if (t.status === 'queued') c.waiting += 1
      else if (t.status === 'running') c.running += 1
      else if (t.status === 'failed' || t.status === 'timed_out') c.failed += 1
      else if (t.status === 'completed' || t.status === 'cancelled' || t.status === 'canceled' || t.status === 'succeeded') c.done += 1
    }
    return c
  }, [tasks, cronJobs])

  const activeCount = counts.waiting + counts.running + counts.failed + counts.scheduled

  return {
    tasks,
    cronJobs,
    loading,
    reloading,
    error,
    reload: load,
    cancelTask,
    runCron,
    removeCron,
    dispatchTask,
    counts,
    activeCount,
  }
}

/* ═══════════════════════ MAIN VIEW (center) ═══════════════════════ */

const FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'running', label: '⚡ Активные' },
  { id: 'waiting', label: '🔔 Ждут вас' },
  { id: 'failed', label: '⚠️ Ошибки' },
  { id: 'scheduled', label: '⏰ Отложенные' },
]

const GROUPS: { key: string; label: string; color: string; test: (t: TaskItem) => boolean }[] = [
  { key: 'waiting', label: '🔔 Ждут вас', color: '#FFD60A', test: (t) => t.status === 'queued' },
  { key: 'running', label: '⚡ Выполняются', color: '#0A84FF', test: (t) => t.status === 'running' },
  { key: 'failed', label: '⚠️ Ошибки', color: '#FF453A', test: (t) => t.status === 'failed' || t.status === 'timed_out' },
  { key: 'completed', label: '✅ Завершено', color: '#8E8E93', test: (t) => t.status === 'completed' || t.status === 'cancelled' || t.status === 'canceled' || t.status === 'succeeded' },
]

export function TasksView({ agents = [], data, selected, onSelect, onOpenSession }: TasksViewProps) {
  const [filter, setFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({ completed: true })
  const [dispatchText, setDispatchText] = useState('')
  const [dispatchAgent, setDispatchAgent] = useState('main')
  const [dispatchTime, setDispatchTime] = useState('now')
  const [dispatchFreq, setDispatchFreq] = useState('once')
  const [dispatchPick, setDispatchPick] = useState('19:30')
  const [dispatching, setDispatching] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const showFeedback = useCallback((msg: string) => {
    setFeedback(msg)
    window.setTimeout(() => setFeedback(null), 3200)
  }, [])

  const visible = useCallback(
    (t: TaskItem): boolean => {
      if (filter !== 'all' && filter !== 'scheduled') {
        if (filter === 'running' && t.status !== 'running') return false
        if (filter === 'waiting' && t.status !== 'queued') return false
        if (filter === 'failed' && !(t.status === 'failed' || t.status === 'timed_out')) return false
      }
      const q = searchQuery.trim().toLowerCase()
      if (q) {
        const hay = `${t.title ?? ''} ${t.agentId ?? ''} ${t.terminalSummary ?? ''} ${t.progressSummary ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    },
    [filter, searchQuery],
  )

  const visibleCron = useCallback(
    (j: CronJob): boolean => {
      if (filter !== 'all' && filter !== 'scheduled') return false
      const q = searchQuery.trim().toLowerCase()
      if (q) {
        const hay = `${j.name ?? ''} ${j.displayName ?? ''} ${j.payload?.message ?? ''} ${j.payload?.text ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    },
    [filter, searchQuery],
  )

  const handleDispatch = useCallback(async () => {
    const text = dispatchText.trim()
    if (!text) return
    setDispatching(true)
    try {
      const err = await data.dispatchTask({
        text,
        agentId: dispatchAgent,
        timeOpt: dispatchTime,
        freq: dispatchFreq,
        pickVal: dispatchPick,
      })
      if (err) {
        showFeedback(`⚠ ${err}`)
      } else {
        showFeedback(
          dispatchFreq === 'once' && dispatchTime === 'now'
            ? '⚡ Задача отправлена агенту'
            : '⏰ Задача поставлена в расписание',
        )
        setDispatchText('')
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
      }
    } finally {
      setDispatching(false)
    }
  }, [dispatchText, dispatchAgent, dispatchTime, dispatchFreq, dispatchPick, data, showFeedback])

  const taskActions = useCallback(
    (task: TaskItem): string => {
      if (task.status === 'running') return '✕'
      if (task.status === 'queued') return '✕'
      if (task.status === 'failed' || task.status === 'timed_out') return '↻'
      return '💬'
    },
    [],
  )

  const handleTaskAction = useCallback(
    async (task: TaskItem, act: string) => {
      if (act === 'cancel') {
        const err = await data.cancelTask(task)
        if (err) showFeedback(`⚠ ${err}`)
        else showFeedback('✕ Задача отменена')
        return
      }
      if (act === 'retry') {
        const err = await data.dispatchTask({
          text: task.title ?? task.id,
          agentId: task.agentId ?? 'main',
          timeOpt: 'now',
          freq: 'once',
        })
        if (err) showFeedback(`⚠ ${err}`)
        else showFeedback('↻ Повторный запуск')
        return
      }
      if (act === 'chat') {
        onOpenSession?.(task.sessionKey ?? (task.agentId ? `agent:${task.agentId}:main` : undefined))
      }
    },
    [data, showFeedback, onOpenSession],
  )

  const renderTaskCard = (task: TaskItem, isChild = false) => {
    const meta = STATUS_META[task.status]
    const isSelected = selected?.kind === 'task' && selected.id === task.id
    const children = data.tasks.filter((c) => c.parentTaskId === task.id)
    const kindIcon = KIND_ICON[task.kind ?? ''] ?? '📋'
    const kindLabel = KIND_LABEL[task.kind ?? ''] ?? task.kind ?? 'задача'
    const startedAt = toMs(task.startedAt)
    const updatedAt = toMs(task.updatedAt ?? task.createdAt)
    const badge =
      meta && meta.label !== kindLabel ? (
        <span
          className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
          style={{ color: meta.color, borderColor: `${meta.color}55`, background: meta.bg }}
        >
          {meta.label}
        </span>
      ) : (
        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/55">
          {kindLabel}
        </span>
      )
    const progress =
      task.status === 'running' && task.progressSummary ? (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
            <i
              className="block h-full rounded-full"
              style={{ width: '100%', background: 'linear-gradient(90deg,#0A84FF,#5E5CE6)', animation: 'tasks-shimmer 1.6s ease-in-out infinite' }}
            />
          </div>
          <span className="shrink-0 text-[10.5px] text-sky-300/80">{task.progressSummary}</span>
        </div>
      ) : null
    const errLine = task.status === 'failed' || task.status === 'timed_out' ? (
      <div className="mt-1 line-clamp-1 text-[11px] text-red-400/90">{task.error ?? 'Ошибка выполнения'}</div>
    ) : null
    const actions = (() => {
      const a = taskActions(task)
      const act = a === '✕' ? 'cancel' : a === '↻' ? 'retry' : 'chat'
      const title = a === '✕' ? 'Отменить' : a === '↻' ? 'Повторить' : 'Открыть чат'
      const danger = a === '✕'
      return (
        <button
          type="button"
          title={title}
          onClick={(e) => {
            e.stopPropagation()
            void handleTaskAction(task, act)
          }}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] transition-all ${
            danger
              ? 'border border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/25'
              : a === '↻'
                ? 'border border-sky-400/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/25'
                : 'border border-white/10 bg-white/5 text-white/50 hover:bg-white/20 hover:text-white'
          }`}
        >
          {a}
        </button>
      )
    })()
    return (
      <div key={task.id} className={isChild ? 'ml-3' : ''}>
        <button
          type="button"
          onClick={() => onSelect?.({ kind: 'task', id: task.id })}
          className={`group flex w-full items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-left transition-all ${
            isSelected
              ? 'border-sky-400/50 bg-sky-500/10'
              : 'border-white/[0.08] bg-white/[0.04] hover:border-sky-400/30 hover:bg-white/[0.07]'
          }`}
        >
          <span className="mt-1 shrink-0 text-[15px] leading-none">{kindIcon}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <TaskStatusIcon status={task.status} className="h-3.5 w-3.5 shrink-0 text-white/45" />
              <span className="truncate text-[13px] font-medium text-white/90">{task.title || task.taskId || task.id}</span>
              {badge}
              {task.parentTaskId && (
                <span className="shrink-0 rounded border border-purple-400/30 bg-purple-500/10 px-1.5 py-0.5 text-[9.5px] font-medium text-purple-300">
                  ветка
                </span>
              )}
            </span>
            <span className="mt-1 flex items-center gap-2 text-[10.5px] text-white/40">
              <span className="inline-flex items-center gap-1">
                <Bot className="h-3 w-3" aria-hidden />
                {task.agentId || 'main'}
              </span>
              <span>{task.kind ? KIND_LABEL[task.kind] ?? task.kind : 'агент'}</span>
              {startedAt && <span>· {fmtDuration(startedAt, toMs(task.endedAt))}</span>}
              <span>· {fmtTime(updatedAt)}</span>
              <span style={{ marginLeft: 'auto' }}>id {task.id.slice(0, 6)}</span>
            </span>
            {progress}
            {errLine}
          </span>
          <span className="mt-0.5 shrink-0">{actions}</span>
        </button>
        {children.length > 0 && (
          <div className="mt-1.5 space-y-1.5">{children.filter(visible).map((c) => renderTaskCard(c, true))}</div>
        )}
      </div>
    )
  }

  const renderCronCard = (job: CronJob) => {
    const isSelected = selected?.kind === 'cron' && selected.id === job.id
    const nextAt = job.nextRunAtMs ?? toMs(job.schedule?.kind === 'at' ? new Date(job.schedule.at ?? '').getTime() : undefined)
    const freq = (() => {
      const s = job.schedule
      if (s?.kind === 'every') return 'раз в час'
      if (s?.kind === 'cron') {
        const parts = (s.expr ?? '').trim().split(/\s+/)
        if (parts.length >= 5) {
          const [m, h, dom, , dow] = parts
          if (dom === '*' && dow === '*') return `ежедневно ${h.padStart(2, '0')}:${m.padStart(2, '0')}`
          if (dom === '1' && dow === '*') return `ежемесячно 1-го числа ${h.padStart(2, '0')}:${m.padStart(2, '0')}`
          if (dom === '*' && dow === '1') return `еженедельно пн ${h.padStart(2, '0')}:${m.padStart(2, '0')}`
        }
        return s.expr ?? 'cron'
      }
      if (s?.kind === 'at') return 'один раз'
      return '—'
    })()
    return (
      <button
        type="button"
        key={job.id}
        onClick={() => onSelect?.({ kind: 'cron', id: job.id })}
        className={`flex w-full items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-left transition-all ${
          isSelected
            ? 'border-purple-400/50 bg-purple-500/10'
            : 'border-white/[0.08] bg-white/[0.04] hover:border-purple-400/30 hover:bg-white/[0.07]'
        }`}
      >
        <span className="mt-1 shrink-0 text-[15px] leading-none">⏰</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-purple-300" aria-hidden />
            <span className="truncate text-[13px] font-medium text-white/90">{job.name || job.displayName || job.id}</span>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                job.enabled === false
                  ? 'border-white/10 bg-white/5 text-white/45'
                  : 'border-purple-400/40 bg-purple-500/10 text-purple-300'
              }`}
            >
              {job.enabled === false ? 'выключено' : 'расписание'}
            </span>
          </span>
          <span className="mt-1 flex items-center gap-2 text-[10.5px] text-white/40">
            <span className="inline-flex items-center gap-1">
              <Bot className="h-3 w-3" aria-hidden />
              {job.agentId || 'main'}
            </span>
            <span>· {freq}</span>
            {nextAt && <span>· след. {fmtTime(nextAt)}</span>}
            {job.lastRunStatus && <span>· последний: {job.lastRunStatus}</span>}
          </span>
          {job.payload?.message && (
            <span className="mt-1 block truncate text-[11px] text-white/55">{job.payload.message}</span>
          )}
        </span>
        <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            title="Запустить сейчас"
            onClick={(e) => {
              e.stopPropagation()
              void (async () => {
                const err = await data.runCron(job)
                if (err) showFeedback(`⚠ ${err}`)
                else showFeedback('▶ Запущено сейчас')
              })()
            }}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-sky-400/30 bg-sky-500/10 text-[11px] text-sky-300 transition-all hover:bg-sky-500/25"
          >
            ▶
          </button>
          <button
            type="button"
            title="Удалить расписание"
            onClick={(e) => {
              e.stopPropagation()
              void (async () => {
                const err = await data.removeCron(job)
                if (err) showFeedback(`⚠ ${err}`)
                else {
                  showFeedback('🗑 Расписание удалено')
                  if (selected?.kind === 'cron' && selected.id === job.id) onSelect?.(null)
                }
              })()
            }}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-red-400/30 bg-red-500/10 text-[11px] text-red-300 transition-all hover:bg-red-500/25"
          >
            ✕
          </button>
        </span>
      </button>
    )
  }

  const groupItems = (key: string): TaskItem[] => {
    if (key === 'scheduled') return []
    const g = GROUPS.find((x) => x.key === key)
    if (!g) return []
    return data.tasks.filter((t) => g.test(t) && visible(t))
  }

  const headerCounts = `${data.counts.all} задач · ${data.counts.running} активных · ${data.counts.waiting} ждут · ${data.counts.failed} ошибок · ${data.counts.scheduled} отложено`

  return (
    <div className="flex h-full flex-col bg-transparent animate-in fade-in duration-200">
      {/* ── Head: title + counts + search ── */}
      <div className="shrink-0 px-5 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-sky-400/30 bg-sky-500/15">
              <ListChecks className="h-4 w-4 text-sky-300" aria-hidden />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold leading-tight text-white/95">Задачи</h2>
              <p className="text-[10.5px] text-white/40">{headerCounts}</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {feedback && (
              <span className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">
                {feedback}
              </span>
            )}
            <button
              type="button"
              onClick={() => void data.reload(true)}
              disabled={data.reloading || data.loading}
              className="flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 text-[11px] text-white/70 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              {data.reloading || data.loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              Обновить
            </button>
          </div>
        </div>

        {/* Filters + search */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] transition-all ${
                  filter === f.id
                    ? 'border-sky-400/55 bg-gradient-to-b from-sky-500/25 to-indigo-500/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.2),0_4px_14px_rgba(10,132,255,.2)]'
                    : 'border-white/10 bg-white/[0.05] text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span>{f.label}</span>
                <span className="font-mono text-[9.5px] opacity-75">
                  {f.id === 'all' ? data.counts.all : data.counts[f.id] ?? 0}
                </span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex h-8 w-52 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3">
            <Search className="h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск задач…"
              className="w-full bg-transparent text-[11.5px] text-white/85 outline-none placeholder:text-white/30"
            />
          </div>
        </div>
      </div>

      {/* ── Task groups ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {data.error && (
          <div className="mb-3 flex items-center gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-2.5 text-[12px] text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {data.error}
          </div>
        )}

        {/* Отложенные (cron) */}
        {data.cronJobs.filter(visibleCron).length > 0 && (
          <div className="mb-3">
            <div
              className="mb-1.5 flex cursor-pointer items-center gap-2 px-1"
              onClick={() => setCollapsedGroups((c) => ({ ...c, scheduled: !c.scheduled }))}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: '#BF5AF2', boxShadow: '0 0 8px #BF5AF2' }} />
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-white/70">⏰ Отложенные</span>
              <span className="rounded-full bg-white/10 px-1.5 text-[10px] text-white/60">
                {data.cronJobs.filter(visibleCron).length}
              </span>
              <span className="ml-auto text-[10px] text-white/40 transition-transform" style={{ transform: collapsedGroups.scheduled ? 'rotate(-90deg)' : 'none' }}>
                ▾
              </span>
            </div>
            {!collapsedGroups.scheduled && (
              <div className="space-y-1.5">{data.cronJobs.filter(visibleCron).map(renderCronCard)}</div>
            )}
          </div>
        )}

        {/* Группы задач */}
        {GROUPS.map((g) => {
          const items = groupItems(g.key)
          if (items.length === 0 && !(g.key === 'completed' && data.counts.done > 0)) return null
          if (items.length === 0 && filter !== 'all') return null
          const collapsed = collapsedGroups[g.key]
          return (
            <div key={g.key} className="mb-3">
              <div
                className="mb-1.5 flex cursor-pointer items-center gap-2 px-1"
                onClick={() => setCollapsedGroups((c) => ({ ...c, [g.key]: !c[g.key] }))}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: g.color, boxShadow: `0 0 8px ${g.color}` }} />
                <span className="text-[11.5px] font-semibold uppercase tracking-wide text-white/70">{g.label}</span>
                <span className="rounded-full bg-white/10 px-1.5 text-[10px] text-white/60">{items.length}</span>
                <span className="ml-auto text-[10px] text-white/40 transition-transform" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none' }}>
                  ▾
                </span>
              </div>
              {!collapsed && <div className="space-y-1.5">{items.map((task) => renderTaskCard(task))}</div>}
            </div>
          )
        })}

        {data.counts.all === 0 && data.cronJobs.length === 0 && !data.loading && (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
            <div className="text-4xl">🔍</div>
            <div className="mt-2 text-[13px] text-white/50">Задач пока нет</div>
            <div className="mt-1 text-[11px] text-white/30">Опишите задачу внизу — агент начнёт выполнение</div>
          </div>
        )}
      </div>

      {/* ── Dispatch (footer) ── */}
      <div className="shrink-0 border-t border-white/[0.07] bg-white/[0.03] px-5 py-3 backdrop-blur-xl">
        <div className="flex items-start gap-2.5">
          <span className="mt-2 text-[15px]">⚡</span>
          <Textarea
            ref={textareaRef}
            value={dispatchText}
            onChange={(e) => {
              setDispatchText(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && dispatchText.trim()) {
                e.preventDefault()
                void handleDispatch()
              }
            }}
            placeholder="Новая задача для агента…"
            rows={2}
            className="min-h-[38px] flex-1 resize-none rounded-2xl border-white/10 bg-white/[0.05] text-[12.5px] text-white/90 placeholder:text-white/30"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
          <select
            value={dispatchAgent}
            onChange={(e) => setDispatchAgent(e.target.value)}
            title="Агент"
            className="h-7 rounded-full border border-white/10 bg-white/[0.07] px-3 font-mono text-[11px] text-white/80 outline-none [&>option]:bg-[#121A34]"
          >
            {agents.length > 0
              ? agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    агент: {a.name}
                  </option>
                ))
              : (
                  <>
                    <option value="main">агент: main</option>
                    <option value="researcher">агент: researcher</option>
                  </>
                )}
          </select>
          <select
            value={dispatchTime}
            onChange={(e) => setDispatchTime(e.target.value)}
            title="Время запуска"
            className="h-7 rounded-full border border-white/10 bg-white/[0.07] px-3 font-mono text-[11px] text-white/80 outline-none [&>option]:bg-[#121A34]"
          >
            <option value="now">сейчас</option>
            <option value="today20">сегодня 20:00</option>
            <option value="tmr9">завтра 09:00</option>
            <option value="pick">выбрать время…</option>
          </select>
          {dispatchTime === 'pick' && (
            <Input
              type="time"
              value={dispatchPick}
              onChange={(e) => setDispatchPick(e.target.value)}
              className="h-7 w-[104px] rounded-full border-white/10 bg-white/[0.07] px-3 font-mono text-[11px] text-white/80 [color-scheme:dark]"
            />
          )}
          <select
            value={dispatchFreq}
            onChange={(e) => setDispatchFreq(e.target.value)}
            title="Расписание"
            className="h-7 rounded-full border border-white/10 bg-white/[0.07] px-3 font-mono text-[11px] text-white/80 outline-none [&>option]:bg-[#121A34]"
          >
            <option value="once">один раз</option>
            <option value="hourly">раз в час</option>
            <option value="daily">раз в день</option>
            <option value="weekly">раз в неделю</option>
            <option value="monthly">раз в месяц</option>
          </select>
          <span className="hidden font-mono text-[10px] text-white/30 sm:inline">Enter ↵ · Shift+Enter — новая строка</span>
          <button
            type="button"
            title="Запустить (Enter)"
            onClick={() => void handleDispatch()}
            disabled={dispatching || !dispatchText.trim()}
            className="ml-auto flex h-7 w-9 items-center justify-center rounded-full bg-gradient-to-b from-sky-500 to-indigo-600 text-[13px] text-white shadow-[0_4px_14px_rgba(10,132,255,.35)] transition-all hover:brightness-110 disabled:opacity-40"
          >
            {dispatching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '➤'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════ DETAIL PANEL (right) ═══════════════════════ */

export interface TasksDetailPanelProps {
  data: TasksData
  selected?: TasksSelection
  tab?: TasksDetailTab
  onTabChange?: (tab: TasksDetailTab) => void
  onSelect?: (sel: TasksSelection) => void
  onOpenSession?: (sessionKey?: string) => void
}

export function TasksDetailPanel({ data, selected, tab = 'output', onTabChange, onSelect, onOpenSession }: TasksDetailPanelProps) {
  const [localTab, setLocalTab] = useState<TasksDetailTab>(tab)
  const activeTab = onTabChange ? tab : localTab
  const setTab = (tb: TasksDetailTab) => (onTabChange ? onTabChange(tb) : setLocalTab(tb))
  const [feedback, setFeedback] = useState<string | null>(null)

  const showFeedback = useCallback((msg: string) => {
    setFeedback(msg)
    window.setTimeout(() => setFeedback(null), 3000)
  }, [])

  const task = selected?.kind === 'task' ? data.tasks.find((x) => x.id === selected.id) ?? null : null
  const cron = selected?.kind === 'cron' ? data.cronJobs.find((x) => x.id === selected.id) ?? null : null

  if (!task && !cron) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <div className="text-4xl">🗂️</div>
        <div className="mt-3 text-[13px] font-medium text-white/60">Выберите задачу из списка</div>
        <div className="mt-1 text-[10.5px] text-white/35">покажутся вывод, детали и действия</div>
        <div className="mt-4 flex gap-3 font-mono text-[9.5px] text-white/30">
          <span>💾 retention 7 дней</span>
          <span>🔔 {data.counts.waiting} ждут вас</span>
        </div>
      </div>
    )
  }

  const TABS: { id: TasksDetailTab; label: string }[] = [
    { id: 'output', label: 'Вывод' },
    { id: 'details', label: 'Детали' },
    { id: 'memory', label: 'Память' },
    { id: 'actions', label: 'Действия' },
  ]

  const dbRow = (k: string, v: string) => (
    <div className="flex items-start justify-between gap-3 py-[5px]">
      <span className="shrink-0 text-[10.5px] text-white/40">{k}</span>
      <span className="min-w-0 break-all text-right font-mono text-[10.5px] text-white/80">{v || '—'}</span>
    </div>
  )

  const block = (label: string, children: React.ReactNode, style?: React.CSSProperties) => (
    <div
      className="rounded-[15px] border border-white/[0.08] bg-white/[0.04] px-3 py-2.5"
      style={style}
    >
      <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[1px] text-white/35">{label}</div>
      {children}
    </div>
  )

  const renderOutput = () => {
    if (task) {
      const meta = STATUS_META[task.status]
      return (
        <div className="space-y-2.5">
          {task.status === 'running' && task.progressSummary && (
            <div className="rounded-[15px] border border-sky-400/25 bg-sky-500/10 px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-sky-300">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Выполняется
              </div>
              <p className="text-[11px] leading-relaxed text-white/85">{task.progressSummary}</p>
            </div>
          )}
          {task.terminalSummary && (
            <div className="rounded-[15px] border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
              <div className="mb-1 text-[10px] font-semibold text-white/40">Итог</div>
              <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-white/85">{task.terminalSummary}</p>
            </div>
          )}
          {task.error && (
            <div className="rounded-[15px] border border-red-400/25 bg-red-500/10 px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-red-300">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                Ошибка
              </div>
              <p className="whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-red-200/90">{task.error}</p>
            </div>
          )}
          {!task.progressSummary && !task.terminalSummary && !task.error && (
            <div className="pt-6 text-center text-[11px] text-white/35">
              {task.status === 'queued' ? 'Задача в очереди — ждёт запуска' : 'Нет вывода'}
            </div>
          )}
          {block(
            `Статус · ${KIND_LABEL[task.kind ?? ''] ?? task.kind ?? 'задача'} · ${task.id.slice(0, 8)}`,
            <>
              {dbRow('Агент', task.agentId || 'main')}
              {dbRow('Тип', (KIND_LABEL[task.kind ?? ''] ?? task.kind ?? 'агент') + (task.runtime ? ` · ${task.runtime}` : ''))}
              {dbRow('Статус', meta ? meta.label : task.status)}
              {dbRow('Запущена', fmtTime(toMs(task.startedAt)))}
              {dbRow('Длительность', fmtDuration(toMs(task.startedAt), toMs(task.endedAt)))}
              {dbRow('Обновлена', fmtTime(toMs(task.updatedAt ?? task.createdAt)))}
            </>,
          )}
        </div>
      )
    }
    if (cron) {
      const nextAt = cron.nextRunAtMs ?? toMs(cron.schedule?.kind === 'at' ? new Date(cron.schedule.at ?? '').getTime() : undefined)
      return (
        <div className="space-y-2.5">
          {cron.payload?.message && (
            <div className="rounded-[15px] border border-purple-400/25 bg-purple-500/10 px-3 py-2.5">
              <div className="mb-1 text-[10px] font-semibold text-purple-300">⏰ Задача по расписанию</div>
              <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-white/85">{cron.payload.message}</p>
            </div>
          )}
          {cron.lastRunError && (
            <div className="rounded-[15px] border border-red-400/25 bg-red-500/10 px-3 py-2.5">
              <div className="mb-1 text-[10px] font-semibold text-red-300">Последний запуск: ошибка</div>
              <p className="font-mono text-[10.5px] leading-relaxed text-red-200/90">{cron.lastRunError}</p>
            </div>
          )}
          {block(
            '⏰ Расписание',
            <>
              {dbRow('Следующий запуск', nextAt ? fmtWhen(nextAt) : '—')}
              {dbRow('Расписание', scheduleLabel(cron))}
              {dbRow('Периодичность', cron.schedule?.kind === 'at' ? 'один раз' : cron.schedule?.kind ?? '—')}
              {dbRow('Последний запуск', cron.lastRunAtMs ? fmtTime(cron.lastRunAtMs) : '—')}
              {dbRow('Статус', cron.lastRunStatus ?? (cron.enabled === false ? 'выключено' : 'активно'))}
            </>,
            { borderColor: 'rgba(191,90,242,.4)', background: 'rgba(191,90,242,.07)' },
          )}
          {block(
            'Параметры',
            <>
              {dbRow('Агент', cron.agentId || 'main')}
              {dbRow('Сессия', cron.sessionTarget ?? '—')}
              {dbRow('Wake', cron.wakeMode ?? '—')}
              {dbRow('Доставка', cron.delivery?.mode ?? '—')}
            </>,
          )}
        </div>
      )
    }
    return null
  }

  const renderDetails = () => {
    if (task) {
      return block(
        'Детали задачи',
        <>
          {dbRow('ID', task.id)}
          {dbRow('Статус', STATUS_META[task.status]?.label ?? task.status)}
          {dbRow('Агент', task.agentId || 'main')}
          {dbRow('Создана', fmtTime(toMs(task.createdAt)))}
          {dbRow('Запущена', fmtTime(toMs(task.startedAt)))}
          {dbRow('Завершена', fmtTime(toMs(task.endedAt)))}
          {dbRow('Run ID', task.runId ?? '—')}
          {dbRow('Flow ID', task.flowId ?? '—')}
          {dbRow('Родитель', task.parentTaskId ?? '—')}
          {dbRow('kind', task.kind ?? '—')}
          {dbRow('runtime', task.runtime ?? '—')}
        </>,
      )
    }
    if (cron) {
      return block(
        'Детали расписания',
        <>
          {dbRow('ID', cron.id)}
          {dbRow('Имя', cron.name ?? '—')}
          {dbRow('Агент', cron.agentId || 'main')}
          {dbRow('Создано', cron.createdAtMs ? fmtTime(cron.createdAtMs) : '—')}
          {dbRow('Обновлено', cron.updatedAtMs ? fmtTime(cron.updatedAtMs) : '—')}
          {dbRow('След. запуск', cron.nextRunAtMs ? fmtWhen(cron.nextRunAtMs) : '—')}
          {dbRow('Сессия', cron.sessionKey ?? '—')}
          {dbRow('Delivery', cron.delivery?.mode ?? '—')}
        </>,
      )
    }
    return null
  }

  const renderMemory = () => (
    <div className="space-y-2.5">
      <div className="flex flex-col items-center rounded-[15px] border border-white/[0.06] bg-white/[0.02] px-4 py-7 text-center">
        <div className="text-2xl">🧠</div>
        <div className="mt-2 text-[11.5px] text-white/45">Связанная память не найдена</div>
        <div className="mt-1 text-[9.5px] text-white/30">memory_search выполняется по содержимому задачи</div>
      </div>
      {block(
        'Сессия задачи',
        <>
          {dbRow('session', task?.sessionKey ?? cron?.sessionKey ?? '—')}
          {dbRow('child', task?.childSessionKey ?? '—')}
          {dbRow('owner', task?.ownerKey ?? '—')}
          {dbRow('source', task?.sourceId ?? '—')}
        </>,
      )}
    </div>
  )

  const renderActions = () => {
    const acts: React.ReactNode[] = []
    const btnBase = 'flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[11.5px] font-medium transition-all'
    if (task) {
      if (task.status === 'running' || task.status === 'queued') {
        acts.push(
          <button
            key="cancel"
            type="button"
            className={`${btnBase} border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/20`}
            onClick={() =>
              void (async () => {
                const err = await data.cancelTask(task)
                if (err) showFeedback(`⚠ ${err}`)
                else showFeedback('✕ Задача отменена')
              })()
            }
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Отменить задачу
          </button>,
        )
      }
      if (task.status === 'failed' || task.status === 'timed_out') {
        acts.push(
          <button
            key="retry"
            type="button"
            className={`${btnBase} border-sky-400/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25`}
            onClick={() =>
              void (async () => {
                const err = await data.dispatchTask({
                  text: task.title ?? task.id,
                  agentId: task.agentId ?? 'main',
                  timeOpt: 'now',
                  freq: 'once',
                })
                if (err) showFeedback(`⚠ ${err}`)
                else showFeedback('↻ Повторный запуск')
              })()
            }
          >
            ↻ Повторить
          </button>,
        )
      }
      if (task.sessionKey) {
        acts.push(
          <button
            key="chat"
            type="button"
            className={`${btnBase} border-white/10 bg-white/[0.06] text-white/80 hover:bg-white/20`}
            onClick={() => onOpenSession?.(task.sessionKey)}
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            Открыть чат сессии
          </button>,
        )
      }
      acts.push(
        <button
          key="copy"
          type="button"
          className={`${btnBase} border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/10`}
          onClick={() => {
            void navigator.clipboard?.writeText(task.id)
            showFeedback('🔗 ID скопирован')
          }}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
          Копировать ID задачи
        </button>,
      )
    }
    if (cron) {
      acts.push(
        <button
          key="run"
          type="button"
          className={`${btnBase} border-sky-400/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25`}
          onClick={() =>
            void (async () => {
              const err = await data.runCron(cron)
              if (err) showFeedback(`⚠ ${err}`)
              else showFeedback('▶ Запущено сейчас')
            })()
          }
        >
          <Play className="h-3.5 w-3.5" aria-hidden />
          Запустить сейчас
        </button>,
      )
      acts.push(
        <button
          key="remove"
          type="button"
          className={`${btnBase} border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/20`}
          onClick={() =>
            void (async () => {
              const err = await data.removeCron(cron)
              if (err) showFeedback(`⚠ ${err}`)
              else {
                showFeedback('🗑 Расписание удалено')
                onSelect?.(null)
              }
            })()
          }
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Удалить расписание
        </button>,
      )
      acts.push(
        <button
          key="copy"
          type="button"
          className={`${btnBase} border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/10`}
          onClick={() => {
            void navigator.clipboard?.writeText(cron.id)
            showFeedback('🔗 ID скопирован')
          }}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
          Копировать ID
        </button>,
      )
    }
    return (
      <div className="space-y-2">
        {feedback && (
          <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[10.5px] text-emerald-300">
            {feedback}
          </div>
        )}
        {acts}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Head */}
      <div className="shrink-0 border-b border-white/[0.07] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px]">{task ? KIND_ICON[task.kind ?? ''] ?? '📋' : '⏰'}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold text-white/90">{task?.title ?? cron?.name ?? cron?.id ?? '—'}</p>
            <p className="text-[9.5px] text-white/40">
              {task ? `${KIND_LABEL[task.kind ?? ''] ?? task.kind ?? 'задача'} · ${task.id.slice(0, 8)}` : `расписание · ${cron?.id.slice(0, 8) ?? ''}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSelect?.(null)}
            title="Закрыть"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[10px] text-white/50 transition-colors hover:bg-white/20"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 border-b border-white/[0.07] px-2">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            className={`border-b-2 px-2.5 py-2 text-[10.5px] font-medium transition-colors ${
              activeTab === tb.id
                ? 'border-sky-400 text-white'
                : 'border-transparent text-white/40 hover:text-white/75'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === 'output' && renderOutput()}
        {activeTab === 'details' && renderDetails()}
        {activeTab === 'memory' && renderMemory()}
        {activeTab === 'actions' && renderActions()}
      </div>
    </div>
  )
}
