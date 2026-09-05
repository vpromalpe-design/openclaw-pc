import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot,
  Check,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Play,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Target,
  Trash2,
  User as UserIcon,
  UserMinus,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { visibleAssistantText } from '../../shared/visible-text'
import type { RoyGroup, RoyTask, RoyTaskRun, RoyLogRow, RoyFileCard } from './types'
import { activeTasks, nextTaskState, TASK_STATE, finishedRuns, hasReport, isLeaderTask } from './data'
import { useRoyAvatars } from './avatar'
import { useRoyRoles } from './roles'
import { RoyRoleForm } from './RoyUi'
import { EmblemIcon, isEmblemKey } from './emblems'
import { MicDictate } from '../components/MicDictate'

/* ── Small shared bits ─────────────────────────────────────────────────── */

const ROY_EMOJI: Record<string, string> = {
  main: '🦞',
  researcher: '🔬',
  design: '🎨',
  researcher2: '🔭',
  designer: '🎨',
}

export function royAgentEmoji(id: string): string {
  return ROY_EMOJI[id] ?? '🤖'
}

function timeHhMm(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Лучший статус агента по его задачам: run → работает, wait → в очереди,
 *  есть выполненные → готово, иначе свободен. */
export function agentState(agentId: string, tasks: RoyTask[]): { key: 'idle' | 'wait' | 'run' | 'done'; label: string } {
  const own = tasks.filter((t) => t.who === agentId)
  if (own.some((t) => t.state === 'run')) return { key: 'run', label: 'работает' }
  if (own.some((t) => t.state === 'wait')) return { key: 'wait', label: 'в очереди' }
  if (own.length > 0 && own.every((t) => t.state === 'done')) return { key: 'done', label: 'готово' }
  return { key: 'idle', label: 'свободен' }
}

export interface RoyAgentRef {
  id: string
  name: string
  model?: string
  /** v0.9.31: агент создан вместе с Telegram-ботом (бейдж в списке агентов) */
  telegramBot?: boolean
}

/** v0.9.42: телеграм-глиф (агент с ботом показывается иконкой Telegram). */
function TelegramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('roy-tg-glyph', className)} aria-hidden>
      <path
        fill="currentColor"
        d="M21.94 4.06 19.2 19.4c-.2 1.2-.98 1.5-2 .93l-5.5-4.05-2.65 2.55c-.3.3-.54.54-1.1.54l.4-5.6L18.6 6.4c.44-.4-.1-.62-.68-.22L6.4 13.4l-5.4-1.7c-1.18-.37-1.2-1.18.25-1.75L20.5 2.3c.98-.36 1.83.22 1.44 1.76Z"
      />
    </svg>
  )
}

/** Лицо агента: аватар-картинка > Telegram-иконка > эмодзи по id. */
export function RoyFace({
  id,
  telegramBot,
  avatarPath,
}: {
  id: string
  telegramBot?: boolean
  avatarPath?: string
}) {
  if (avatarPath) {
    return <img className="roy-face-img" src={avatarPath} alt="" draggable={false} />
  }
  if (telegramBot) {
    return <TelegramGlyph className="roy-face-tg" />
  }
  return <>{royAgentEmoji(id)}</>
}

/* ── Arena: task/mission/log/footer modals as ONE lightweight modal state ── */

export type RoyModalKind =
  | { kind: 'task'; target: string } // 'group' | agentId
  | { kind: 'mission' }
  | { kind: 'broadcast' }
  | { kind: 'members' }
  | { kind: 'report' }
  | { kind: 'agent'; agentId: string }
  | { kind: 'leader' } // v0.9.43: карточка главного (координатора)
  | null

/* ── SVG connector lines ───────────────────────────────────────────────── */

interface RoyLink {
  id: string
  from: 'leader' | string // file card id
  to: string // agent id
}

/**
 * Draws bezier links between two DOM elements (leader/file card → agent cell).
 * Geometry adapts to vertical arena layout: a source above its target exits
 * through its bottom edge, a source below (file shelf) exits through its top.
 */
function RoyLinksSvg({ links, fromEls, toEls, className }: { links: RoyLink[]; fromEls: Record<string, HTMLElement | null>; toEls: Record<string, HTMLElement | null>; className?: string }) {
  const [, setSize] = useState({ w: 0, h: 0 })
  const wrapRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setSize({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])
  return (
    <svg ref={wrapRef} className={className} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {links.map((l) => {
        const fromEl = fromEls[l.from]
        const toEl = toEls[l.to]
        if (!fromEl || !toEl) return null
        const wrap = wrapRef.current?.getBoundingClientRect()
        if (!wrap) return null
        const a = fromEl.getBoundingClientRect()
        const b = toEl.getBoundingClientRect()
        // координаты в системе wrap
        const ax = a.left - wrap.left
        const aw = a.width
        const ay = a.top - wrap.top
        const ah = a.height
        const bx = b.left - wrap.left
        const bw = b.width
        const by = b.top - wrap.top
        const bh = b.height
        const aCx = ax + aw / 2
        const bCx = bx + bw / 2
        const fromBelow = ay > by // источник ниже цели (файл → агент)
        const x1 = aCx
        const y1 = fromBelow ? ay : ay + ah
        const x2 = bCx
        const y2 = fromBelow ? by + bh : by
        const dy = Math.max(18, Math.abs(y2 - y1) * 0.45)
        return (
          <path
            key={l.id}
            d={`M ${x1} ${y1} C ${x1} ${fromBelow ? y1 - dy : y1 + dy}, ${x2} ${fromBelow ? y2 + dy : y2 - dy}, ${x2} ${y2}`}
            fill="none"
            stroke="rgba(10,132,255,0.4)"
            strokeWidth={1.4}
            strokeDasharray="4 4"
          />
        )
      })}
    </svg>
  )
}

/* ── Arena view (center) ───────────────────────────────────────────────── */

export interface RoyArenaProps {
  group: RoyGroup
  agents: RoyAgentRef[]
  onPatch: (fn: (g: RoyGroup) => RoyGroup) => void
  onChat: (agentId: string) => void
  onRemoveAgent: (agent: RoyAgentRef) => void
  onClose: () => void
  /** пункты меню «сменить модель» (из списка агентов шелла) */
  modelOptions?: Array<{ id: string; label: string }>
  onSetModel?: (agentId: string, model: string) => void
  /** v0.9.37: реальный запуск задачи у агентов (живой диспатч) */
  onRunTask?: (taskId: string) => void
  /** v0.9.39: открыть реальный файл диска во вьюере */
  onOpenPath?: (path: string, label?: string) => void
  /** v0.9.43: «Доработать» из отчёта главного — новое задание главному */
  onRework?: (taskId: string, files: string[], comment: string) => void
  /** v0.9.42: сменить аватар агента (выбор картинки с диска) */
  onAvatarAgent?: (agentId: string) => void
}

export function RoyArenaView({ group, agents, onPatch, onChat, onRemoveAgent, onClose, modelOptions, onSetModel, onRunTask, onOpenPath, onRework, onAvatarAgent }: RoyArenaProps) {
  const [modal, setModal] = useState<RoyModalKind>(null)
  const [missionText, setMissionText] = useState('')
  const [broadcastText, setBroadcastText] = useState('')
  const [hoverDelFile, setHoverDelFile] = useState<string | null>(null)
  const leaderRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const fileRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const members = group.members
  const memberAgents = agents.filter((a) => members.includes(a.id))
  // v0.9.39: «главный» = РЕАЛЬНЫЙ агент (leaderId или первый участник), не фантом 'main'
  const head = group.head === 'main' ? (memberAgents.find((a) => a.id === group.leaderId) ?? memberAgents[0] ?? null) : null
  const headIsUser = group.head === 'user' || memberAgents.length === 0
  const running = activeTasks(group)
  const doneCount = group.tasks.filter((t) => t.state === 'done').length
  const totalTasks = group.tasks.length
  const missionPct = totalTasks ? Math.round((doneCount / totalTasks) * 100) : 0
  const avatars = useRoyAvatars()
  // v0.9.43: «свежий» отчёт главного — готовая, но ещё не принятая задача (миссия/координаторская/личная)
  const freshLeaderReport =
    head && !headIsUser
      ? (group.tasks.find((t) => t.state === 'done' && !t.accepted && (isLeaderTask(t) || t.who === head.id) && hasReport(t)) ?? null)
      : null

  const pushLog = useCallback(
    (ico: string, text: string) =>
      onPatch((g) => ({
        ...g,
        log: [{ id: `l${Date.now().toString(36)}`, ico, text, ts: Date.now() }, ...g.log].slice(0, 60),
      })),
    [onPatch],
  )
  const addTaskTo = useCallback(
    (who: string, title: string) => {
      onPatch((g) => {
        const id = `t${Date.now().toString(36)}`
        return {
          ...g,
          tasks: [{ id, who, title, state: 'wait', ts: Date.now() }, ...g.tasks],
          log: [
            { id: `l${Date.now().toString(36)}`, ico: '🎯', text: `задача → ${who === 'group' ? 'группе' : who}: ${title}`, ts: Date.now() },
            ...g.log,
          ].slice(0, 60),
        }
      })
    },
    [onPatch],
  )
  /** head=user: разослать задачу всем участникам (каждому — своя карточка в списке). */
  const addTaskToAll = useCallback(
    (title: string) => {
      onPatch((g) => {
        const ids = g.members
        const tasks = ids.map((who) => ({ id: `t${Date.now().toString(36)}${who}`, who, title, state: 'wait' as const, ts: Date.now() }))
        return {
          ...g,
          tasks: [...tasks.reverse(), ...g.tasks],
          log: [
            { id: `l${Date.now().toString(36)}`, ico: '📣', text: `разослано всем (${ids.length}): ${title}`, ts: Date.now() },
            ...g.log,
          ].slice(0, 60),
        }
      })
    },
    [onPatch],
  )
  const addMember = useCallback(
    (agent: RoyAgentRef) => {
      if (group.members.includes(agent.id)) return
      onPatch((g) => {
        if (g.members.includes(agent.id)) return g
        const members = [...g.members, agent.id]
        // первый участник при главе-«вы» становится координатором (можно вернуть «вы» тумблером)
        const becomeHead = g.head === 'user' && members.length === 1
        return { ...g, members, head: becomeHead ? 'main' : g.head, leaderId: becomeHead ? agent.id : g.leaderId }
      })
      pushLog('＋', `участник добавлен: ${agent.name}`)
      setModal(null)
    },
    [group.members, onPatch, pushLog],
  )
  const removeMember = useCallback(
    (agent: RoyAgentRef) => {
      onPatch((g) => {
        const members = g.members.filter((m) => m !== agent.id)
        const needRelead = g.head === 'main' && (g.leaderId === agent.id || !members.includes(g.leaderId ?? ''))
        return needRelead
          ? { ...g, members, head: members.length > 0 ? 'main' : 'user', leaderId: members[0] }
          : { ...g, members }
      })
      pushLog('➖', `участник убран: ${agent.name}`)
      setModal(null)
    },
    [onPatch, pushLog],
  )
  const toggleHead = useCallback(() => {
    onPatch((g) => {
      const real = g.members.filter((m) => m !== 'main' && m !== 'user')
      if (g.head === 'main') return { ...g, head: 'user', leaderId: undefined }
      if (real.length === 0) return g // некому быть главным-агентом
      return { ...g, head: 'main', leaderId: g.leaderId ?? real[0] }
    })
    pushLog('👑', 'глава — агент-координатор (первый участник)')
  }, [onPatch, pushLog])

  const missionSet = group.mission.trim().length > 0

  const sendMission = () => {
    if (!missionText.trim()) return
    addTaskTo('group', missionText.trim())
    onPatch((g) => ({ ...g, mission: missionText.trim() }))
    pushLog('🎯', `миссия поставлена: ${missionText.trim()}`)
    setMissionText('')
    setModal(null)
  }
  const sendBroadcast = () => {
    if (!broadcastText.trim()) return
    addTaskToAll(broadcastText.trim())
    pushLog('📣', `разослано всем: ${broadcastText.trim()}`)
    setBroadcastText('')
    setModal(null)
  }
  const dropFileOnArena = (fileId: string, label: string, emoji: string, path?: string, kind?: 'file' | 'folder') => {
    onPatch((g) => {
      if (g.files.some((f) => f.fileId === fileId)) return g
      const n = g.files.length
      const kind2 = kind === 'folder' ? 'folder' : 'file'
      return {
        ...g,
        files: [...g.files, { fileId, label, emoji, path, kind: kind2, x: 30 + ((n % 5) * 46), y: 90 + Math.floor(n / 5) * 34, to: [] }],
        log: [
          { id: `l${Date.now().toString(36)}`, ico: kind2 === 'folder' ? '🗂' : '📎', text: `${kind2 === 'folder' ? 'папка' : 'файл'} на арене: ${label}`, ts: Date.now() },
          ...g.log,
        ].slice(0, 60),
      }
    })
  }
  /** v0.9.42: открыть папку в проводнике. */
  const showFolderInSystem = async (fPath?: string) => {
    if (!fPath) return
    try {
      await window.electronAPI.royShowInFolder(fPath)
    } catch {
      /* ignore */
    }
  }

  const fromEls: Record<string, HTMLElement | null> = { leader: leaderRef.current }
  for (const f of group.files) fromEls[`file-${f.fileId}`] = fileRefs.current[`file-${f.fileId}`]
  const toEls: Record<string, HTMLElement | null> = {}
  for (const m of members) toEls[m] = cellRefs.current[m]
  const links: RoyLink[] = []
  for (const m of members) {
    if (head && head.id === m) continue // сам лидер
    links.push({ id: `L-${m}`, from: 'leader', to: m })
  }
  for (const f of group.files) for (const t of f.to) links.push({ id: `LF-${f.fileId}-${t}`, from: `file-${f.fileId}`, to: t })

  const assignees = members.filter((m) => !(head && head.id === m))
  const leaderState = head ? agentState(head.id, group.tasks) : null
  const leaderLine = headIsUser
    ? 'вы главный — ставьте задачи каждому вручную (или разошлите всем)'
    : head
      ? running.length > 0
        ? 'раскладывает задачи и следит за работой…'
        : 'оценивает задачу, распределяет роли и собирает результат'
      : 'лидер не найден'
  const leaderRole = headIsUser ? 'управление роем' : head ? `модель: ${head.model ?? '—'}` : '—'

  return (
    <div className="roy-arena-wrap">
      {/* ── Head ── */}
      <div className="roy-head">
        <div className="rh-left">
          <div className={cn('rh-av', group.grad)}>
            {avatars[group.id] ? (
              <img className="roy-face-img" src={avatars[group.id]} alt="" draggable={false} />
            ) : isEmblemKey(group.emoji) ? (
              <EmblemIcon k={group.emoji} size={22} strokeWidth={1.9} />
            ) : (
              group.emoji
            )}
            {onAvatarAgent && (
              <button
                type="button"
                className="av-edit"
                title="Сменить аватар группы — картинка с диска"
                onClick={(e) => {
                  e.stopPropagation()
                  onAvatarAgent(group.id)
                }}
              >
                <ImageIcon size={10} />
              </button>
            )}
          </div>
          <div>
            <div className="rh-title">РОЙ <small>· арена</small></div>
            <div className="rh-name">{group.name}</div>
          </div>
        </div>
        <div className="rh-tags">
          <span className="rh-tag"><b>{members.length}</b> участн.</span>
          <span className="rh-tag">
            <i className={cn('rh-dot', running.length > 0 ? 'on' : 'idle')} />
            {running.length > 0 ? `${running.length} работают` : 'все свободны'}
          </span>
          <span className="rh-tag">задач: <b>{totalTasks}</b></span>
        </div>
        <div className="rh-actions">
          <button type="button" className="roy-btn" onClick={() => setModal({ kind: 'members' })}>
            <Plus size={14} /> Участник
          </button>
          <button type="button" className="roy-btn ghost" onClick={onClose} title="Закрыть арену">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Arena surface ── */}
      <div
        className="roy-arena"
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
        onDrop={(e) => {
          e.preventDefault()
          try {
            const raw = e.dataTransfer.getData('application/x-roy-file')
            if (!raw) return
            const f = JSON.parse(raw) as { fileId: string; label: string; emoji: string; path?: string; kind?: 'file' | 'folder' }
            dropFileOnArena(f.fileId, f.label, f.emoji, f.path, f.kind === 'folder' ? 'folder' : 'file')
          } catch {
            /* ignore */
          }
        }}
      >
        <RoyLinksSvg links={links} fromEls={fromEls} toEls={toEls} />

        {memberAgents.length === 0 && !headIsUser && !head && (
          <div className="roy-empty" onClick={() => setModal({ kind: 'members' })}>
            Рой пуст — добавь участников (агентов)
          </div>
        )}

        {/* ── Leader: кто главный (тумблер) + карточка ── */}
        {(head || headIsUser) && (
          <div className="roy-leader" ref={leaderRef}>
            <div className="rl-cap">
              <span className="rl-cap-t">кто главный в рое</span>
              <div className="rl-seg">
                <button
                  type="button"
                  className={cn('rl-seg-btn', headIsUser && 'on')}
                  disabled={headIsUser}
                  onClick={() => !headIsUser && toggleHead()}
                >
                  <UserIcon size={12} /> вы
                </button>
                <button
                  type="button"
                  className={cn('rl-seg-btn', !headIsUser && 'on')}
                  disabled={!headIsUser ? !!head : members.length === 0}
                  title={members.length === 0 ? 'Сначала добавь участников — первый станет главным' : undefined}
                  onClick={() => headIsUser && toggleHead()}
                >
                  <Bot size={12} /> агент-координатор
                </button>
              </div>
            </div>
            <div
              className={cn('rl-main', head && !headIsUser && 'openable')}
              onClick={() => head && !headIsUser && setModal({ kind: 'leader' })}
              title={head && !headIsUser ? `${head?.name ?? 'главный'} — открыть карточку главного` : undefined}
            >
              {headIsUser ? (
                <div className="rl-av user"><UserIcon size={22} /></div>
              ) : (
                <div className={cn('rl-av', 'g0')}>
                  <RoyFace id={head?.id ?? ''} telegramBot={head?.telegramBot} avatarPath={avatars[head?.id ?? '']} />
                  {!headIsUser && head && onAvatarAgent && (
                    <button
                      type="button"
                      className="av-edit"
                      title="Сменить аватар главного — картинка с диска"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAvatarAgent(head.id)
                      }}
                    >
                      <ImageIcon size={10} />
                    </button>
                  )}
                </div>
              )}
              <div className="rl-body">
                <div className="rl-name">
                  {headIsUser ? 'вы' : head?.name ?? '—'}
                  <small>{headIsUser ? '' : `@${head?.id}`}</small>
                  {freshLeaderReport && <i className="rl-fresh-dot" title="есть готовый отчёт главного" />}
                </div>
                <div className="rl-role">{leaderRole}</div>
                <div className={cn('rl-state', leaderState?.key ?? 'idle')}>
                  <i className="rl-st-dot" />
                  {leaderLine}
                </div>
              </div>
              <div className="rl-acts" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="roy-btn primary" onClick={() => { setMissionText(group.mission); setModal({ kind: 'mission' }) }}>
                  <Target size={13} /> Задача группе
                </button>
                {headIsUser && (
                  <button type="button" className="roy-btn" onClick={() => setModal({ kind: 'broadcast' })}>
                    <Send size={13} /> Разослать всем
                  </button>
                )}
                {!headIsUser && head && (
                  <button
                    type="button"
                    className={cn('roy-btn', freshLeaderReport && 'pulse-green')}
                    title="Задачи главного и полный отчёт"
                    onClick={() => setModal({ kind: 'leader' })}
                  >
                    <FileText size={13} /> {freshLeaderReport ? 'Отчёт' : 'Карточка'}
                  </button>
                )}
                {!headIsUser && head && (
                  <button type="button" className="roy-btn" onClick={() => onChat(head.id)} title="Открыть чат с главным">
                    <MessageSquare size={13} /> Чат
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Member cells (агенты-исполнители) ── */}
        <div className="roy-cells">
          {assignees.map((agentId) => {
            const a = agents.find((x) => x.id === agentId)
            if (!a) return null
            const own = group.tasks.filter((t) => t.who === a.id)
            const st = agentState(a.id, group.tasks)
            const last = own[0]
            const doneOwn = own.filter((t) => t.state === 'done').length
            return (
              <div
                key={a.id}
                ref={(el) => { cellRefs.current[a.id] = el }}
                className={cn('roy-cell', `st-${st.key}`, 'openable')}
                onClick={() => setModal({ kind: 'agent', agentId: a.id })}
                title={`${a.name} — открыть карточку`}
              >
                <span className={cn('rc-ind', st.key)} title={st.label} />
                <div className="rc-top">
                  <div className="rc-av"><RoyFace id={a.id} telegramBot={a.telegramBot} avatarPath={avatars[a.id]} /></div>
                  <div className="rc-id">
                    <b>{a.name}<small>@{a.id}</small></b>
                    <span className="rc-role">{a.model ? a.model.split('/').pop() : 'модель —'}</span>
                  </div>
                </div>
                <div className="rc-task">
                  <div className="rc-task-l">
                    <span>последняя задача</span>
                    <span className={cn('rc-sttxt', st.key)}>{st.label}</span>
                  </div>
                  {last ? (
                    <div className="rc-task-t">{last.title}</div>
                  ) : (
                    <div className="rc-task-t none">пока свободен</div>
                  )}
                </div>
                <div className="rc-foot">
                  <span className="rc-tag">{doneOwn > 0 ? `сдал: ${doneOwn}` : `задач: ${own.length}`}</span>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="roy-mini" title="Чат с агентом" onClick={(e) => { e.stopPropagation(); onChat(a.id) }}>
                    <MessageSquare size={12} />
                  </button>
                  <button type="button" className="roy-mini" title="Меню агента" onClick={(e) => { e.stopPropagation(); setModal({ kind: 'agent', agentId: a.id }) }}>
                    <MoreHorizontal size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── File shelf ── */}
        <div className="roy-files-zone">
          {group.files.length > 0 && (
            <div className="roy-files">
              {group.files.map((f) => (
                <div
                  key={f.fileId}
                  ref={(el) => { fileRefs.current[`file-${f.fileId}`] = el }}
                  className={cn('roy-file', f.kind === 'folder' ? 'folder' : f.path && 'openable')}
                  onMouseEnter={() => setHoverDelFile(f.fileId)}
                  onMouseLeave={() => setHoverDelFile(null)}
                  onClick={() => {
                    if (f.kind === 'folder') void showFolderInSystem(f.path)
                    else if (f.path) onOpenPath?.(f.path, f.label)
                  }}
                  title={
                    f.kind === 'folder'
                      ? `${f.path ?? f.label}\n(клик — открыть папку в проводнике)`
                      : f.path
                        ? `${f.path}\n(клик — открыть для просмотра)`
                        : 'Файл на арене — свяжи его с агентом в карточке агента'
                  }
                >
                  <span className="rf-emoji">{f.emoji}</span>
                  <span className="rf-label">{f.label}</span>
                  {f.kind === 'folder' && <span className="rf-kind">папка</span>}
                  {f.to.length > 0 && <span className="rf-to">{f.to.join(' · ')}</span>}
                  {hoverDelFile === f.fileId && (
                    <button
                      type="button"
                      className="rf-del"
                      title="Убрать с арены"
                      onClick={(e) => {
                        e.stopPropagation()
                        onPatch((g) => ({ ...g, files: g.files.filter((x) => x.fileId !== f.fileId) }))
                      }}
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {group.files.length === 0 && (
            <div className="roy-drop-hint">брось файл сюда с «Диска», затем раздай его агентам в их карточках</div>
          )}
        </div>

        {/* ── Bottom progress strip (внизу арены) ── */}
        <div className="roy-progress">
          <span className="rp-mission" title={group.mission || undefined}>
            {missionSet ? <><Target size={12} /> {group.mission}</> : <span className="dim">задач нет — поставь первую</span>}
          </span>
          <span className="rp-bar"><i style={{ width: `${missionPct}%` }} /></span>
          <span className="rp-pct">{doneCount}/{totalTasks} · {missionPct}%</span>
        </div>
      </div>

      {/* ── Modals ── */}
      {modal?.kind === 'mission' && (
        <RoyModal title="Задача группе (миссия)" onClose={() => setModal(null)}>
          <div className="rm-target">
            {headIsUser
              ? 'Задача ляжет в общий список — раздать её можешь сам (карточки агентов) или через «Разослать всем».'
              : 'Задача уходит главному — он декомпозирует её и раздаст участникам.'}
          </div>
          <div className="rm-ta-wrap">
            <textarea className="rm-textarea" autoFocus placeholder="Крупная задача: например «Создать сайт v2»…" value={missionText} onChange={(e) => setMissionText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && sendMission()} />
            <MicDictate appear={missionText.trim().length > 0} onText={(t) => setMissionText((v) => (v ? v + ' ' + t : t))} />
          </div>
          <div className="rm-foot">
            <button type="button" className="roy-btn ghost" onClick={() => setModal(null)}>Отмена</button>
            <button type="button" className="roy-btn primary" disabled={!missionText.trim()} onClick={sendMission}>
              <Target size={13} /> Поставить группе
            </button>
          </div>
        </RoyModal>
      )}

      {modal?.kind === 'broadcast' && (
        <RoyModal title={`Разослать всем (${members.length} участн.)`} onClose={() => setModal(null)}>
          <div className="rm-target">Каждый участник получит эту задачу в свою карточку (в очереди).</div>
          <div className="rm-ta-wrap">
            <textarea className="rm-textarea" autoFocus placeholder="Задача для всех…" value={broadcastText} onChange={(e) => setBroadcastText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && sendBroadcast()} />
            <MicDictate appear={broadcastText.trim().length > 0} onText={(t) => setBroadcastText((v) => (v ? v + ' ' + t : t))} />
          </div>
          <div className="rm-foot">
            <button type="button" className="roy-btn ghost" onClick={() => setModal(null)}>Отмена</button>
            <button type="button" className="roy-btn primary" disabled={!broadcastText.trim()} onClick={sendBroadcast}>
              <Send size={13} /> Разослать
            </button>
          </div>
        </RoyModal>
      )}

      {modal?.kind === 'members' && (
        <RoyModal title="Участники роя" onClose={() => setModal(null)}>
          <div className="rm-target">Добавь агентов в рой. Один агент может быть в нескольких группах. Создание нового агента — через список агентов (с подтверждением).</div>
          <div className="rm-list">
            {agents.map((a) => {
              const inGroup = group.members.includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  className={cn('rm-list-item', inGroup && 'in')}
                  onClick={() => (inGroup ? removeMember(a) : addMember(a))}
                >
                  <span className="rl-av g1" style={{ width: 26, height: 26, fontSize: 14 }}>
                    <RoyFace id={a.id} telegramBot={a.telegramBot} avatarPath={avatars[a.id]} />
                  </span>
                  <span className="rmli-name">{a.name}</span>
                  <span className="rmli-model">{a.model ? a.model.split('/').pop() : '—'}</span>
                  <span className="rmli-flag">{inGroup ? <><Check size={12} /> в рое</> : <Plus size={12} />}</span>
                </button>
              )
            })}
          </div>
        </RoyModal>
      )}

      {modal?.kind === 'agent' && (() => {
        const a = agents.find((x) => x.id === modal.agentId)
        if (!a) return null
        return (
          <AgentCardModal
            key={a.id}
            agent={a}
            group={group}
            onPatch={onPatch}
            onChat={onChat}
            onRemoveAgent={onRemoveAgent}
            modelOptions={modelOptions}
            onSetModel={onSetModel}
            onRunTask={onRunTask}
            onOpenPath={onOpenPath}
            onAvatarAgent={onAvatarAgent}
            onClose={() => setModal(null)}
          />
        )
      })()}

      {modal?.kind === 'leader' && head && !headIsUser && (
        <LeaderCardModal
          key={head.id}
          agent={head}
          group={group}
          onPatch={onPatch}
          onChat={onChat}
          onRunTask={onRunTask}
          onOpenPath={onOpenPath}
          onRework={onRework}
          onAvatarAgent={onAvatarAgent}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

/* ── v0.9.43: Карточка главного (координатора) ───────────────────────── */

function LeaderCardModal({
  agent: a,
  group,
  onPatch,
  onChat,
  onRunTask,
  onOpenPath,
  onRework,
  onAvatarAgent,
  onClose,
}: {
  agent: RoyAgentRef
  group: RoyGroup
  onPatch: (fn: (g: RoyGroup) => RoyGroup) => void
  onChat: (agentId: string) => void
  onRunTask?: (taskId: string) => void
  onOpenPath?: (path: string, label?: string) => void
  onRework?: (taskId: string, files: string[], comment: string) => void
  onAvatarAgent?: (agentId: string) => void
  onClose: () => void
}) {
  const [cmd, setCmd] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [reportTask, setReportTask] = useState<RoyTask | null>(null)
  const avatars = useRoyAvatars()

  // задачи главного: миссии (он координатор), координаторские и личные
  const own = group.tasks.filter((t) => isLeaderTask(t) || t.who === a.id)
  const st = agentState(a.id, group.tasks)
  const sel = own.find((t) => t.id === selId) ?? null
  const fresh = own.find((t) => t.state === 'done' && !t.accepted && hasReport(t)) ?? null

  const giveTask = (title: string) => {
    if (!title.trim()) return
    const id = `t${Date.now().toString(36)}`
    onPatch((g) => ({
      ...g,
      tasks: [{ id, who: a.id, title: title.trim(), state: 'wait', ts: Date.now() }, ...g.tasks],
      log: [{ id: `l${Date.now().toString(36)}`, ico: '🎯', text: `задача главному → ${a.name}: ${title.trim()}`, ts: Date.now() }, ...g.log].slice(0, 60),
    }))
    setCmd('')
  }
  const acceptSel = () => {
    if (!sel) return
    onPatch((g) => ({
      ...g,
      tasks: g.tasks.map((x) => (x.id === sel.id ? { ...x, accepted: true } : x)),
      log: [{ id: `l${Date.now().toString(36)}`, ico: '🤝', text: `отчёт принят: ${sel.title}`, ts: Date.now() }, ...g.log].slice(0, 60),
    }))
    setSelId(null)
  }
  const delSel = () => {
    if (!sel) return
    onPatch((g) => ({ ...g, tasks: g.tasks.filter((x) => x.id !== sel.id) }))
    setSelId(null)
  }
  const backToQueue = (t: RoyTask) => {
    onPatch((g) => ({ ...g, tasks: g.tasks.map((x) => (x.id === t.id ? { ...x, state: 'wait' } : x)) }))
  }
  const kidsOf = (t: RoyTask) => (t.who === 'group' ? group.tasks.filter((k) => k.parentId === t.id) : [])

  return (
    <RoyModal big title="Карточка главного · координатора" onClose={onClose}>
      <div className="rac-top">
        <div className="rl-av g1" style={{ width: 54, height: 54, fontSize: 28 }}>
          <RoyFace id={a.id} telegramBot={a.telegramBot} avatarPath={avatars[a.id]} />
        </div>
        <div className="rac-id">
          <div className="rac-name">{a.name} <small>@{a.id}</small>{a.telegramBot && <i className="rac-tg" title="Telegram-агент (бот)">TG</i>}</div>
          <div className="rac-model">{a.model ?? 'модель не назначена'}</div>
          <div className="rac-in">координатор роя «{group.name}» — декомпозирует задачи и раздаёт участникам</div>
        </div>
        <span className={cn('rac-st', st.key)} title={`статус: ${st.label}`}><i />{st.label}</span>
      </div>

      <div className="rac-actions">
        <button type="button" className="roy-btn" onClick={() => { onClose(); onChat(a.id) }}>
          <MessageSquare size={13} /> Чат
        </button>
        {onAvatarAgent && (
          <button type="button" className="roy-btn" title="Сменить аватар — выбрать картинку с диска" onClick={() => onAvatarAgent(a.id)}>
            <ImageIcon size={13} /> Аватар
          </button>
        )}
        {fresh && (
          <button type="button" className="roy-btn pulse-green" onClick={() => setReportTask(fresh)}>
            <FileText size={13} /> Полный отчёт
          </button>
        )}
      </div>

      <LeaderRolesBlock group={group} />
      <div className="cd-label">Задачи главного <small style={{ opacity: 0.6 }}>миссии · координаторские · личные</small></div>
      <div className="rac-tasks">
        {own.length === 0 && <div className="rm-none-links">задач пока нет — напиши задачу главному ниже</div>}
        {own.slice(0, 10).map((t) => {
          const kids = kidsOf(t)
          return (
            <button key={t.id} type="button" className={cn('rac-task-row', `st-${t.state}`, sel?.id === t.id && 'sel')} onClick={() => setSelId(sel?.id === t.id ? null : t.id)}>
              <span className={cn('rac-t-dot', t.state)} />
              <span className="rac-t-title">
                {t.who === 'group' ? '🎯 ' : t.who === a.id ? '' : '📨 '}
                {t.title}
              </span>
              {kids.length > 0 && <span className="rac-t-run" title="подзадачи участников">{finishedRuns(t)}/{kids.length} детей</span>}
              {t.runs && t.runs.length > 0 && <span className="rac-t-run" title="реальные запуски">{finishedRuns(t)}/{t.runs.length}</span>}
              <span className="rac-t-st">{TASK_STATE[t.state].label}</span>
              {t.state === 'done' && hasReport(t) && <FileText size={12} className="rac-t-report" />}
              <ChevronRight size={13} className="rac-t-chev" />
            </button>
          )
        })}
      </div>

      {sel && (
        <div className="rac-detail">
          <div className="rac-detail-h">
            <span className={cn('rac-st', sel.state)}><i />{TASK_STATE[sel.state].label}</span>
            <span className="rac-detail-ts">создана {timeHhMm(sel.ts)}</span>
          </div>
          <div className="rac-detail-t">{sel.title}</div>
          {kidsOf(sel).length > 0 && (
            <div className="rac-detail-runs">
              {kidsOf(sel).map((k) => (
                <span key={k.id} className={cn('rac-run-chip', k.state === 'done' ? 'done' : k.state)}>
                  {royAgentEmoji(k.who)} {k.who}
                  {k.state === 'done' ? ' ✓' : k.state === 'run' ? ' …' : ' ⏳'}
                </span>
              ))}
            </div>
          )}
          {sel.runs?.some((r) => r.files && r.files.length > 0) && (
            <div className="rac-detail-files">
              <div className="cd-label">Файлы задачи</div>
              {sel.runs.map((r) => (r.files && r.files.length > 0 ? <RoyFilesChips key={r.localId ?? r.agentId} files={r.files} onOpenPath={onOpenPath} /> : null))}
            </div>
          )}
          <div className="rac-detail-a">
            {sel.state === 'wait' && onRunTask && (
              <button type="button" className="roy-btn primary" onClick={() => { setSelId(null); onRunTask(sel.id) }}>
                <Send size={12} /> Запустить у главного
              </button>
            )}
            {sel.state === 'done' && hasReport(sel) && (
              <button type="button" className="roy-btn" onClick={() => setReportTask(sel)}>
                <FileText size={12} /> Полный отчёт
              </button>
            )}
            {sel.state === 'done' && !sel.accepted && (
              <button type="button" className="roy-btn primary" onClick={acceptSel}>
                <Check size={12} /> Сделано (принять)
              </button>
            )}
            {sel.state === 'done' && (
              <button type="button" className="roy-btn ghost" onClick={() => backToQueue(sel)}>
                <RotateCcw size={12} /> Вернуть в очередь
              </button>
            )}
            <button type="button" className="roy-btn danger ghost" onClick={delSel}>
              <Trash2 size={12} /> Удалить
            </button>
          </div>
        </div>
      )}

      <div className="cd-label">Задача главному</div>
      <div className="c-cmd">
        <input
          value={cmd}
          placeholder="Например: собери итоговый отчёт по проекту…"
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') giveTask(cmd) }}
        />
        <MicDictate compact appear={cmd.trim().length > 0} onText={(t) => setCmd((v) => (v ? v + ' ' + t : t))} />
        <button type="button" className="c-send" title="Отправить задачу (Enter)" disabled={!cmd.trim()} onClick={() => giveTask(cmd)}>
          <Send size={15} />
        </button>
      </div>
      <div className="rm-none-links" style={{ marginTop: 6 }}>
        💡 Главный сам решит: сделать самому или раздать участникам планом (JSON). Задачи-миссии идут в его папку проекта.
      </div>

      {reportTask && (
        <RoyReportModal
          task={reportTask}
          group={group}
          onOpenPath={onOpenPath}
          onRework={onRework ? (files, comment) => { const id = reportTask.id; setReportTask(null); onClose(); onRework?.(id, files, comment) } : undefined}
          onClose={() => setReportTask(null)}
        />
      )}
    </RoyModal>
  )
}

/* ── Карточка агента (раскрытие поверх, поле крупнее) ─────────────────── */

function AgentCardModal({
  agent: a,
  group,
  onPatch,
  onChat,
  onRemoveAgent,
  modelOptions,
  onSetModel,
  onRunTask,
  onOpenPath,
  onAvatarAgent,
  onClose,
}: {
  agent: RoyAgentRef
  group: RoyGroup
  onPatch: (fn: (g: RoyGroup) => RoyGroup) => void
  onChat: (agentId: string) => void
  onRemoveAgent: (agent: RoyAgentRef) => void
  modelOptions?: Array<{ id: string; label: string }>
  onSetModel?: (agentId: string, model: string) => void
  onRunTask?: (taskId: string) => void
  onOpenPath?: (path: string, label?: string) => void
  /** v0.9.42: сменить аватар агента */
  onAvatarAgent?: (agentId: string) => void
  onClose: () => void
}) {
  const [cmd, setCmd] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [selId, setSelId] = useState<string | null>(null)
  const [reportTask, setReportTask] = useState<RoyTask | null>(null)
  const avatars = useRoyAvatars()

  const inGroup = group.members.includes(a.id)
  const own = group.tasks.filter((t) => t.who === a.id)
  const st = agentState(a.id, group.tasks)
  const sel = own.find((t) => t.id === selId) ?? null

  const pushLog = (ico: string, text: string) =>
    onPatch((g) => ({ ...g, log: [{ id: `l${Date.now().toString(36)}`, ico, text, ts: Date.now() }, ...g.log].slice(0, 60) }))

  const giveTask = (title: string) => {
    if (!title.trim()) return
    const id = `t${Date.now().toString(36)}`
    onPatch((g) => ({
      ...g,
      tasks: [{ id, who: a.id, title: title.trim(), state: 'wait', ts: Date.now() }, ...g.tasks],
      log: [{ id: `l${Date.now().toString(36)}`, ico: '🎯', text: `задача → ${a.name}: ${title.trim()}`, ts: Date.now() }, ...g.log].slice(0, 60),
    }))
    setCmd('')
  }
  const advance = (t: RoyTask) => {
    const next = nextTaskState(t.state)
    if (!next) return
    onPatch((g) => ({
      ...g,
      tasks: g.tasks.map((x) => (x.id === t.id ? { ...x, state: next } : x)),
      log: [
        { id: `l${Date.now().toString(36)}`, ico: next === 'done' ? '✅' : '▶️', text: `задача ${next === 'done' ? 'выполнена' : 'в работе'}: ${t.title}`, ts: Date.now() },
        ...g.log,
      ].slice(0, 60),
    }))
  }
  const backToQueue = (t: RoyTask) => {
    onPatch((g) => ({
      ...g,
      tasks: g.tasks.map((x) => (x.id === t.id ? { ...x, state: 'wait' } : x)),
      log: [{ id: `l${Date.now().toString(36)}`, ico: '⏳', text: `задача возвращена в очередь: ${t.title}`, ts: Date.now() }, ...g.log].slice(0, 60),
    }))
  }
  const delTask = (t: RoyTask) => {
    onPatch((g) => ({
      ...g,
      tasks: g.tasks.filter((x) => x.id !== t.id),
      log: [{ id: `l${Date.now().toString(36)}`, ico: '🗑', text: `задача удалена: ${t.title}`, ts: Date.now() }, ...g.log].slice(0, 60),
    }))
    if (selId === t.id) setSelId(null)
  }
  const toggleFile = (fileId: string) => {
    onPatch((g) => ({
      ...g,
      files: g.files.map((f) =>
        f.fileId === fileId ? { ...f, to: f.to.includes(a.id) ? f.to.filter((x) => x !== a.id) : [...f.to, a.id] } : f,
      ),
    }))
  }

  return (
    <RoyModal big title="Карточка агента" onClose={onClose}>
      <div className="rac-top">
        <div className="rl-av g1" style={{ width: 54, height: 54, fontSize: 28 }}>
          <RoyFace id={a.id} telegramBot={a.telegramBot} avatarPath={avatars[a.id]} />
        </div>
        <div className="rac-id">
          <div className="rac-name">{a.name} <small>@{a.id}</small>{a.telegramBot && <i className="rac-tg" title="Telegram-агент (бот)">TG</i>}</div>
          <div className="rac-model">{a.model ?? 'модель не назначена'}</div>
          <div className="rac-in">{inGroup ? `участник роя «${group.name}»` : 'не в этом рое'}</div>
        </div>
        <span className={cn('rac-st', st.key)} title={`статус: ${st.label}`}><i />{st.label}</span>
      </div>

      {/* ряд действий — как в макете, но без «⚡ Задача» и «✕ Закрыть» */}
      <div className="rac-actions">
        <button type="button" className="roy-btn" onClick={() => { onClose(); onChat(a.id) }}>
          <MessageSquare size={13} /> Чат
        </button>
        <button type="button" className={cn('roy-btn', menuOpen && 'on')} onClick={() => setMenuOpen((m) => !m)}>
          <Settings2 size={13} /> Меню
        </button>
        {onAvatarAgent && (
          <button type="button" className="roy-btn" title="Сменить аватар — выбрать картинку с диска" onClick={() => onAvatarAgent(a.id)}>
            <ImageIcon size={13} /> Аватар
          </button>
        )}
        {inGroup ? (
          <button
            type="button"
            className="roy-btn ghost"
            onClick={() => {
              onPatch((g) => {
                const members = g.members.filter((m) => m !== a.id)
                const needRelead = g.head === 'main' && (g.leaderId === a.id || !members.includes(g.leaderId ?? ''))
                return needRelead
                  ? { ...g, members, head: members.length > 0 ? 'main' : 'user', leaderId: members[0] }
                  : { ...g, members }
              })
              pushLog('➖', `участник убран: ${a.name}`)
            }}
          >
            <UserMinus size={13} /> Убрать из группы
          </button>
        ) : (
          <button type="button" className="roy-btn ghost" onClick={() => onPatch((g) => (g.members.includes(a.id) ? g : { ...g, members: [...g.members, a.id] }))}>
            <Plus size={13} /> В группу
          </button>
        )}
        <button
          type="button"
          className="roy-btn danger"
          onClick={() => {
            if (window.confirm(`Удалить агента «${a.name}» из списка агентов?`)) {
              onClose()
              onRemoveAgent(a)
            }
          }}
        >
          <Trash2 size={13} /> Удалить
        </button>
      </div>

      <RoyRoleCard agentId={a.id} />

      {/* меню «сменить модель» */}
      {menuOpen && (
        <div className="rac-menu">
          <div className="rac-menu-t">модель агента</div>
          <div className="rac-menu-list">
            {modelOptions && modelOptions.length > 0 ? (
              modelOptions.map((m) => {
                const cur = a.model === m.id
                return (
                  <button key={m.id} type="button" className={cn('rac-model-row', cur && 'on')} onClick={() => { setMenuOpen(false); onSetModel?.(a.id, m.id) }}>
                    <span className="rac-model-radio">{cur && <Check size={11} />}</span>
                    <span className="rac-model-name">{m.label || m.id}</span>
                  </button>
                )
              })
            ) : (
              <div className="rm-none-links">список моделей недоступен — смени модель в списке агентов (⋯)</div>
            )}
          </div>
        </div>
      )}

      {/* задачи агента */}
      <div className="cd-label">Задачи агента</div>
      <div className="rac-tasks">
        {own.length === 0 && <div className="rm-none-links">задач пока нет — напиши задачу ниже</div>}
        {own.slice(0, 8).map((t) => (
          <button key={t.id} type="button" className={cn('rac-task-row', `st-${t.state}`, sel?.id === t.id && 'sel')} onClick={() => setSelId(sel?.id === t.id ? null : t.id)}>
            <span className={cn('rac-t-dot', t.state)} />
            <span className="rac-t-title">{t.title}</span>
            {t.runs && t.runs.length > 0 && (
              <span className="rac-t-run" title="реальный запуск у агентов">{finishedRuns(t)}/{t.runs.length}</span>
            )}
            <span className="rac-t-st">{TASK_STATE[t.state].label}</span>
            {t.state === 'done' && hasReport(t) && <FileText size={12} className="rac-t-report" />}
            <ChevronRight size={13} className="rac-t-chev" />
          </button>
        ))}
      </div>

      {sel && (
        <div className="rac-detail">
          <div className="rac-detail-h">
            <span className={cn('rac-st', sel.state)}><i />{TASK_STATE[sel.state].label}</span>
            <span className="rac-detail-ts">создана {timeHhMm(sel.ts)}</span>
          </div>
          <div className="rac-detail-t">{sel.title}</div>
          {sel.runs && sel.runs.length > 0 && (
            <div className="rac-detail-runs">
              {sel.runs.map((r) => (
                <span key={r.localId ?? r.agentId} className={cn('rac-run-chip', r.status)}>
                  {royAgentEmoji(r.agentId)} {r.agentId === 'user' ? 'вы' : r.agentName ?? r.agentId}
                  {r.status === 'done' ? ' ✓' : r.status === 'fail' ? ' ⚠' : ' …'}
                </span>
              ))}
            </div>
          )}
          {sel.runs?.some((r) => r.files && r.files.length > 0) && (
            <div className="rac-detail-files">
              <div className="cd-label">Файлы задачи (создал/работал)</div>
              {sel.runs.map((r) => (r.files && r.files.length > 0 ? <RoyFilesChips key={r.localId ?? r.agentId} files={r.files} onOpenPath={onOpenPath} /> : null))}
            </div>
          )}
          <div className="rac-detail-a">
            {sel.state === 'wait' && (
              <button
                type="button"
                className="roy-btn primary"
                title={onRunTask ? 'Реально запустить у агента (в его сессии задач)' : 'Ручной прогон (демо)'}
                onClick={() => { setSelId(null); if (onRunTask) onRunTask(sel.id); else advance(sel) }}
              >
                <Send size={12} /> {onRunTask ? 'Запустить' : 'В работу'}
              </button>
            )}
            {sel.state === 'run' && (
              <button type="button" className="roy-btn primary" onClick={() => advance(sel)}>
                <Check size={12} /> Готово
              </button>
            )}
            {sel.state === 'done' && (
              <button type="button" className="roy-btn ghost" onClick={() => backToQueue(sel)}>
                <RotateCcw size={12} /> Вернуть в очередь
              </button>
            )}
            {sel.state === 'done' && hasReport(sel) && (
              <button type="button" className="roy-btn" onClick={() => setReportTask(sel)}>
                <FileText size={12} /> Посмотреть отчёт
              </button>
            )}
            {sel.state === 'done' && isLeaderTask(sel) && !sel.accepted && (
              <button
                type="button"
                className="roy-btn primary"
                onClick={() => {
                  onPatch((g) => ({
                    ...g,
                    tasks: g.tasks.map((x) => (x.id === sel.id ? { ...x, accepted: true } : x)),
                    log: [
                      { id: `l${Date.now().toString(36)}`, ico: '🤝', text: `отчёт принят: ${sel.title}`, ts: Date.now() },
                      ...g.log,
                    ].slice(0, 60),
                  }))
                  setSelId(null)
                }}
              >
                <Check size={12} /> Сделано
              </button>
            )}
            <button type="button" className="roy-btn danger ghost" onClick={() => delTask(sel)}>
              <Trash2 size={12} /> Удалить
            </button>
          </div>
        </div>
      )}

      {/* поле задачи агенту */}
      <div className="cd-label">Задача агенту</div>
      <div className="c-cmd">
        <input
          value={cmd}
          autoFocus
          placeholder={`Например: подготовь отчёт по…`}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') giveTask(cmd) }}
        />
        <MicDictate compact appear={cmd.trim().length > 0} onText={(t) => setCmd((v) => (v ? v + ' ' + t : t))} />
        <button type="button" className="c-send" title="Отправить задачу (Enter)" disabled={!cmd.trim()} onClick={() => giveTask(cmd)}>
          <Send size={15} />
        </button>
      </div>

      {/* файлы агента */}
      <div className="cd-label">Файлы агента</div>
      <div className="rac-files">
        {group.files.length === 0 && <div className="rm-none-links">нет файлов на арене — брось с «Диска»</div>}
        {group.files.map((f: RoyFileCard) => {
          const on = f.to.includes(a.id)
          return (
            <button key={f.fileId} type="button" className={cn('rac-file-chip', on && 'on')} onClick={() => toggleFile(f.fileId)}>
              <Paperclip size={11} />
              <span>{f.emoji} {f.label}</span>
              <i>{on ? 'связан' : 'связать'}</i>
            </button>
          )
        })}
      </div>

      {reportTask && <RoyReportModal task={reportTask} group={group} onOpenPath={onOpenPath} onClose={() => setReportTask(null)} />}
    </RoyModal>
  )
}

/* ── Modal scaffold ────────────────────────────────────────────────────── */

function RoyModal({ title, onClose, children, big }: { title: string; onClose: () => void; children: React.ReactNode; big?: boolean }) {
  return (
    <div className="roy-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn('roy-modal', big && 'big')}>
        <div className="rm-head">
          <div className="rm-title">{title}</div>
          <button type="button" className="rm-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ── Right panel: Состояние роя / Миссия / Задачи / Активность ────────── */

export interface RoyRightProps {
  group: RoyGroup
  agents: RoyAgentRef[]
  onPatch: (fn: (g: RoyGroup) => RoyGroup) => void
  /** v0.9.37: реальный запуск задачи у агентов */
  onRunTask?: (taskId: string) => void
  /** v0.9.39: открыть реальный файл во вьюере */
  onOpenPath?: (path: string, label?: string) => void
}

export function RoyRightPanel({ group, agents, onPatch, onRunTask, onOpenPath }: RoyRightProps) {
  const [showAll, setShowAll] = useState(false)
  const [logExpanded, setLogExpanded] = useState(true)
  const [newTask, setNewTask] = useState('')
  const [reportTask, setReportTask] = useState<RoyTask | null>(null)
  const avatars = useRoyAvatars()
  const running = activeTasks(group)
  const done = group.tasks.filter((t) => t.state === 'done').length
  const waiting = group.tasks.filter((t) => t.state === 'wait').length
  const total = group.tasks.length
  const free = group.members.length - running.length
  const logs: RoyLogRow[] = group.log
  const missionPct = total ? Math.round((done / total) * 100) : 0

  const patchTask = (id: string, fn: (t: RoyTask) => RoyTask) =>
    onPatch((g) => ({ ...g, tasks: g.tasks.map((t) => (t.id === id ? fn(t) : t)) }))
  const advanceTask = (t: RoyTask) => {
    const next = nextTaskState(t.state)
    if (!next) return
    patchTask(t.id, (x) => ({ ...x, state: next }))
  }

  const quickAdd = () => {
    if (!newTask.trim()) return
    const id = `t${Date.now().toString(36)}`
    onPatch((g) => ({
      ...g,
      tasks: [{ id, who: 'group', title: newTask.trim(), state: 'wait', ts: Date.now() }, ...g.tasks],
      log: [{ id: `l${Date.now().toString(36)}`, ico: '🎯', text: `задача: ${newTask.trim()}`, ts: Date.now() }, ...g.log].slice(0, 60),
    }))
    setNewTask('')
  }

  return (
    <div className="roy-right">
      <div className="shell-sp-head">
        <span className="t">Состояние роя</span>
        <span className="cnt">{free}/{group.members.length}</span>
      </div>

      <div className="roy-stats">
        <div className="roy-stat idle"><div className="v">{free}</div><div className="k">свободны</div></div>
        <div className="roy-stat busy"><div className="v">{running.length}</div><div className="k">работают</div></div>
        <div className="roy-stat done"><div className="v">{done}</div><div className="k">сдали</div></div>
      </div>

      <div className="roy-card mission">
        <div className="rc-head">Миссия <span className="cnt">{done}/{total}</span></div>
        {group.mission.trim() ? (
          <>
            <div className="rcm-title">
            <Target size={13} /> {group.mission}
          </div>
            <div className="rcm-bar"><i style={{ width: `${missionPct}%` }} /></div>
            <div className="rcm-meta">
              <span>{total === 0 ? 'задач нет' : done === total ? 'выполнена' : running.length > 0 ? `${running.length} в работе` : waiting > 0 ? `${waiting} в очереди` : 'ожидает'}</span>
              <span>{missionPct}%</span>
            </div>
          </>
        ) : (
          <div className="rcm-none">миссии нет — поставь Задачу группе (🎯 на арене)</div>
        )}
      </div>

      <div className="roy-card">
        <div className="rc-head">
          Задачи <span className="cnt">{total}</span>
          <span className="act" onClick={() => setNewTask((x) => (x ? '' : ' '))}>
            <Plus size={11} /> новая
          </span>
        </div>
        {newTask !== '' && (
          <div className="roy-newtask">
            <input
              value={newTask.trim() === ' ' ? '' : newTask}
              autoFocus
              placeholder="Задача группе… (Enter)"
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && quickAdd()}
            />
            <MicDictate compact appear={newTask.trim().length > 0} onText={(t) => setNewTask((v) => (v.trim() === ' ' ? '' : v) + (v && v.trim() !== ' ' ? ' ' : '') + t)} />
          </div>
        )}
        <div className="roy-tasklist">
          {(showAll ? group.tasks : group.tasks.slice(0, 5)).map((t) => {
            const next = nextTaskState(t.state)
            const rep = hasReport(t)
            return (
              <div key={t.id} className={cn('roy-task-row', t.state)}>
                <span className={cn('rt-dot', t.state)} title={TASK_STATE[t.state].label} />
                <div className="rt-body">
                  <div className="rt-title">{t.title}</div>
                  <div className="rt-who">
                    → {t.who === 'group' ? 'РОЙ' : t.who} · {TASK_STATE[t.state].label}
                    {t.runs && t.runs.length > 0 && <i className="rt-prog">{finishedRuns(t)}/{t.runs.length} ответили</i>}
                  </div>
                </div>
                {t.state === 'wait' && onRunTask && (
                  <button
                    type="button"
                    className="rt-act"
                    title={t.who === 'group' ? 'Запустить миссию: координатор составит план и раздаст участникам' : 'Реально запустить у агента'}
                    onClick={() => onRunTask(t.id)}
                  >
                    <Play size={12} />
                  </button>
                )}
                {t.state === 'wait' && !onRunTask && next && (
                  <button type="button" className="rt-act" title="В работу" onClick={() => advanceTask(t)}>
                    <Play size={12} />
                  </button>
                )}
                {t.state === 'run' && next && (
                  <button type="button" className="rt-act" title="Готово (вручную)" onClick={() => advanceTask(t)}>
                    <Check size={12} />
                  </button>
                )}
                {t.state === 'done' && rep && (
                  <button type="button" className="rt-act" title="Посмотреть отчёт" onClick={() => setReportTask(t)}>
                    <FileText size={12} />
                  </button>
                )}
                {t.state === 'done' && isLeaderTask(t) && !t.accepted && (
                  <button
                    type="button"
                    className="rt-act ok"
                    title="Принять: задача главного сделана"
                    onClick={() =>
                      onPatch((g) => ({
                        ...g,
                        tasks: g.tasks.map((x) => (x.id === t.id ? { ...x, accepted: true } : x)),
                        log: [
                          { id: `l${Date.now().toString(36)}`, ico: '🤝', text: `отчёт принят: ${t.title}`, ts: Date.now() },
                          ...g.log,
                        ].slice(0, 60),
                      }))
                    }
                  >
                    <Check size={12} />
                  </button>
                )}
                <button type="button" className="rt-del" title="Удалить задачу" onClick={() => onPatch((g) => ({ ...g, tasks: g.tasks.filter((x) => x.id !== t.id) }))}>
                  <X size={11} />
                </button>
              </div>
            )
          })}
          {group.tasks.length > 5 && (
            <button type="button" className="roy-more" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'свернуть' : `ещё ${group.tasks.length - 5}…`}
            </button>
          )}
        </div>
      </div>

      <div className="roy-card log">
        <div className="rc-head" onClick={() => setLogExpanded((x) => !x)}>
          Активность <span className="cnt">{logs.length}</span>
          <span className="chev">{logExpanded ? '▾' : '▸'}</span>
        </div>
        {logExpanded && (
          <div className="roy-log">
            {logs.length === 0 && <div className="rl-none">пока тихо</div>}
            {logs.slice(0, 30).map((l) => (
              <div key={l.id} className="roy-log-row">
                <span className="log-ico">{l.ico}</span>
                <span className="log-txt">{l.text}</span>
                <span className="log-ts">{timeHhMm(l.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="roy-agent-mini">
        {group.members.map((m) => {
          const a = agents.find((x) => x.id === m)
          if (!a) return null
          return (
            <span key={m} className="ram-chip" title={a.name}>
              <RoyFace id={a.id} telegramBot={a.telegramBot} avatarPath={avatars[a.id]} /><i>{a.name}</i>
            </span>
          )
        })}
      </div>

      {reportTask && <RoyReportModal task={reportTask} group={group} onOpenPath={onOpenPath} onClose={() => setReportTask(null)} />}
    </div>
  )
}

/* ── v0.9.45: роли агентов в карточках (промт-роль) ─────────────────── */

/** Блок «Роль агента» в карточке агента на арене: превью + форма. */
function RoyRoleCard({ agentId }: { agentId: string }) {
  const roles = useRoyRoles()
  const [open, setOpen] = useState(false)
  const role = (roles[agentId] ?? '').trim()
  return (
    <div className="roy-role-card">
      <div className="roy-role-card-head">
        <span className="roy-role-card-ic">🎭</span>
        <div className="roy-role-card-txt">
          <div className="roy-role-card-title">Роль агента{role ? ' · задана' : ''} <small>{role ? 'вшивается в каждую задачу' : 'влияет на ответы агента'}</small></div>
          {!open && <div className={cn('roy-role-card-text', !role && 'empty')}>{role || 'роль не задана — агент отвечает без роли'}</div>}
        </div>
        <button type="button" className="roy-btn ghost" title={open ? 'Свернуть' : role ? 'Изменить промт-роль' : 'Задать промт-роль'} onClick={() => setOpen((o) => !o)}>
          {open ? '✕ Свернуть' : role ? '✎ Изменить' : '+ Задать'}
        </button>
      </div>
      {open && <RoyRoleForm agentId={agentId} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** Блок «Роли участников» в карточке главного — лидер видит роли всех. */
function LeaderRolesBlock({ group }: { group: RoyGroup }) {
  const roles = useRoyRoles()
  const avatars = useRoyAvatars()
  const [openId, setOpenId] = useState<string | null>(null)
  const members = group.members.filter((m) => m !== 'user' && m !== 'main')
  if (members.length === 0) return null
  return (
    <div className="roy-rlb">
      <div className="cd-label">Роли участников <small>видны главному · план строится с их учётом</small></div>
      {members.map((m) => {
        const role = (roles[m] ?? '').trim()
        const open = openId === m
        return (
          <div key={m} className={cn('roy-rlb-row', open && 'open')}>
            <div className="roy-rlb-head">
              <span className="roy-rlb-av"><RoyFace id={m} avatarPath={avatars[m]} /></span>
              <span className="roy-rlb-id">@{m}</span>
              <span className={cn('roy-rlb-role', !role && 'empty')}>{role || 'роль не задана'}</span>
              <button
                type="button"
                className="roy-btn ghost"
                title={role ? 'Изменить роль' : 'Задать роль'}
                onClick={() => setOpenId(open ? null : m)}
              >
                {open ? '✕' : role ? '✎' : '+ Задать'}
              </button>
            </div>
            {open && <RoyRoleForm key={m} agentId={m} onClose={() => setOpenId(null)} />}
          </div>
        )
      })}
    </div>
  )
}

/* ── Отчёт задачи (v0.9.39): план координатора + кто что сделал + файлы ── */

function RoyFilesChips({ files, onOpenPath }: { files?: RoyTaskRun['files']; onOpenPath?: (path: string, label?: string) => void }) {
  if (!files || files.length === 0) return null
  return (
    <div className="roy-rep-files">
      {files.map((f) => (
        <button
          key={f.path}
          type="button"
          className="roy-rep-file"
          title={`${f.path}\n(нажми — открыть в просмотре)`}
          onClick={() => onOpenPath?.(f.path, f.label)}
        >
          {f.emoji || '📄'} {f.label}
        </button>
      ))}
    </div>
  )
}

function RoyReportModal({
  task,
  group,
  onOpenPath,
  onRework,
  onClose,
}: {
  task: RoyTask
  group?: RoyGroup
  onOpenPath?: (path: string, label?: string) => void
  /** v0.9.43: «Доработать» — выбрали файлы + комментарий → новое задание главному */
  onRework?: (files: string[], comment: string) => void
  onClose: () => void
}) {
  const runs = task.runs ?? []
  const answered = runs.filter((r) => r.report || r.error)
  const mission = task.who === 'group'
  const kids = mission && group ? group.tasks.filter((t) => t.parentId === task.id) : []
  const leaderText = task.plan?.report ?? (runs.find((r) => r.report || r.error)?.report || runs.find((r) => r.error)?.error)
  const avatars = useRoyAvatars()

  // v0.9.43: все конечные файлы задачи (запуски лидера/агента + файлы подзадач детей)
  const allRuns = [...runs, ...kids.flatMap((k) => k.runs ?? [])]
  const fileRows = allRuns
    .flatMap((r) => r.files ?? [])
    .filter((f, i, arr) => arr.findIndex((x) => x.path === f.path) === i)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [reworkText, setReworkText] = useState('')
  useEffect(() => {
    setChecked(Object.fromEntries(fileRows.filter((f) => !!f.path).map((f) => [f.path as string, true])))
    setReworkText('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])
  const canRework = onRework !== undefined && (task.who === 'group' || task.coord === true)
  const doRework = () => {
    if (!onRework) return
    const files = fileRows.map((f) => f.path as string).filter((p) => checked[p] === true)
    onRework(files, reworkText.trim())
  }
  return (
    <div className="roy-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="roy-modal roy-rep" style={{ width: 'min(720px, 94vw)' }}>
        <div className="rm-head">
          <div className="rm-title">
            <FileText size={14} /> Отчёт: {task.title}
          </div>
          <button type="button" className="rm-close" onClick={onClose}>✕</button>
        </div>
        <div className="roy-rep-who">
          {mission
            ? kids.length > 0
              ? `миссия · координатор составил план и роздал ${kids.length} подзадач`
              : `миссия · ${runs.length === 0 ? 'без реального запуска' : 'координатор думает…'}`
            : `задача → ${task.who} · ${runs.length === 0 ? 'без реального запуска' : `${answered.length}/${runs.length} ответили`}`}
        </div>

        {mission && leaderText && (
          <>
            <div className="roy-rep-sec">🧠 План / размышления координатора</div>
            <div className="roy-rep-leader">
              <pre className="roy-rep-text">{(visibleAssistantText(leaderText) || '—').trim()}</pre>
            </div>
          </>
        )}

        {mission && kids.length > 0 && (
          <>
            <div className="roy-rep-sec">🤝 Кто что сделал</div>
            <div className="roy-rep-list">
              {kids.map((k) => {
                const done = k.state === 'done'
                const kruns = k.runs ?? []
                const kr = kruns.find((r) => r.status === 'done') ?? kruns[kruns.length - 1]
                const text = kr && (kr.report || kr.error) ? visibleAssistantText(kr.report || kr.error) : null
                return (
                  <div key={k.id} className={cn('roy-rep-item', done ? 'done' : k.state)}>
                    <div className="roy-rep-h">
                      <span className="roy-rep-av"><RoyFace id={k.who} avatarPath={avatars[k.who]} /></span>
                      <b>{k.who}</b>
                      <span className={cn('roy-rep-st', done ? 'done' : k.state)}>
                        {done ? '✓ готово' : k.state === 'run' ? '… работает' : '⏳ в очереди'}
                      </span>
                      <span className="roy-rep-sub">{k.title}</span>
                      {kr?.endedAt && <i>{timeHhMm(kr.endedAt)}</i>}
                    </div>
                    {text && <pre className="roy-rep-text">{(text as string).trim()}</pre>}
                    <RoyFilesChips files={kr?.files} onOpenPath={onOpenPath} />
                  </div>
                )
              })}
            </div>
          </>
        )}

        {!mission && (
          <div className="roy-rep-list">
            {runs.length === 0 && (
              <div className="rm-none-links">задача отмечена вручную — реального ответа агентов нет.</div>
            )}
            {runs.map((r) => (
              <div key={r.localId ?? r.agentId} className={cn('roy-rep-item', r.status)}>
                <div className="roy-rep-h">
                  <span className="roy-rep-av"><RoyFace id={r.agentId} avatarPath={avatars[r.agentId]} /></span>
                  <b>{r.agentName ?? r.agentId}</b>
                  <span className={cn('roy-rep-st', r.status)}>
                    {r.status === 'done' ? '✓ ответил' : r.status === 'fail' ? '⚠ ошибка' : '… работает'}
                  </span>
                  {r.endedAt && <i>{timeHhMm(r.endedAt)}</i>}
                </div>
                <pre className="roy-rep-text">{(visibleAssistantText(r.report || r.error) || '—').trim()}</pre>
                <RoyFilesChips files={r.files} onOpenPath={onOpenPath} />
              </div>
            ))}
          </div>
        )}

        {canRework && (
          <>
            <div className="roy-rep-sec">🛠 Доработать результат</div>
            <div className="rm-target" style={{ marginBottom: 8 }}>
              Главный получит новое задание: доработать по выбранным файлам и твоему комментарию.
            </div>
            {fileRows.length > 0 ? (
              <div className="rrw-files">
                {fileRows.map((f) => (
                  <label key={f.path ?? f.label} className={cn('rrw-file', checked[f.path ?? ''] && 'on')}>
                    <input
                      type="checkbox"
                      checked={checked[f.path ?? ''] === true}
                      onChange={(e) => setChecked((c) => ({ ...c, [f.path ?? '']: e.target.checked }))}
                    />
                    <span>{f.emoji || '📄'} {f.label}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="rm-none-links">файлов в задаче нет — доработка уйдёт текстом</div>
            )}
            <div className="rm-ta-wrap" style={{ marginTop: 8 }}>
              <textarea
                className="rm-textarea"
                rows={2}
                placeholder="Что доработать? Например: поправь шапку сайта, смени синий на зелёный…"
                value={reworkText}
                onChange={(e) => setReworkText(e.target.value)}
              />
              <MicDictate appear={reworkText.trim().length > 0} onText={(t) => setReworkText((v) => (v ? v + ' ' + t : t))} />
            </div>
          </>
        )}

        <div className="rm-foot">
          {canRework && (
            <button
              type="button"
              className="roy-btn danger"
              title="Новое задание главному: доработать по выбранным файлам"
              onClick={doRework}
            >
              <RotateCcw size={13} /> Доработать
            </button>
          )}
          <button type="button" className="roy-btn primary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  )
}
