import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { RoyGroup, RoyTask, RoyLogRow, RoyFileCard } from './types'
import { activeTasks } from './data'

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

export interface RoyAgentRef {
  id: string
  name: string
  model?: string
}

/* ── Arena: task/mission/log/footer modals as ONE lightweight modal state ── */

export type RoyModalKind =
  | { kind: 'task'; target: string } // 'group' | agentId
  | { kind: 'mission' }
  | { kind: 'members' }
  | { kind: 'report' }
  | { kind: 'agent'; agentId: string }
  | null

/* ── SVG connector lines ───────────────────────────────────────────────── */

interface RoyLink {
  id: string
  from: 'leader' | string // file card id
  to: string // agent id
}

/**
 * Draws bezier links from the leader cell (or a file card) to member cells.
 * Positions come from DOM refs; we re-measure on every render pass.
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
        const x1 = a.left + a.width - wrap.left
        const y1 = a.top + a.height / 2 - wrap.top
        const x2 = b.left - wrap.left
        const y2 = b.top + b.height / 2 - wrap.top
        const mx = (x1 + x2) / 2
        return (
          <path
            key={l.id}
            d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke="rgba(10,132,255,0.55)"
            strokeWidth={1.6}
            strokeDasharray="4 3"
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
}

const STATE_ICON: Record<RoyTask['state'], string> = { wait: '⏸', run: '▶️', done: '✅' }
const STATE_NEXT: Record<RoyTask['state'], RoyTask['state']> = { wait: 'run', run: 'done', done: 'wait' }

export function RoyArenaView({ group, agents, onPatch, onChat, onRemoveAgent, onClose }: RoyArenaProps) {
  const [modal, setModal] = useState<RoyModalKind>(null)
  const [taskText, setTaskText] = useState('')
  const [missionText, setMissionText] = useState('')
  const [selFile, setSelFile] = useState<string | null>(null)
  const [hoverDelFile, setHoverDelFile] = useState<string | null>(null)
  const leaderRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const fileRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const members = group.members
  const memberAgents = agents.filter((a) => members.includes(a.id))
  const head = group.head === 'main' ? agents.find((a) => a.id === 'main') ?? memberAgents[0] : null
  const headIsUser = group.head === 'user'
  const running = activeTasks(group)
  const doneCount = group.tasks.filter((t) => t.state === 'done').length

  const patchTask = useCallback(
    (id: string, fn: (t: RoyTask) => RoyTask) => {
      onPatch((g) => ({ ...g, tasks: g.tasks.map((t) => (t.id === id ? fn(t) : t)) }))
    },
    [onPatch],
  )
  const removeTask = useCallback(
    (id: string) => onPatch((g) => ({ ...g, tasks: g.tasks.filter((t) => t.id !== id) })),
    [onPatch],
  )
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
      const id = `t${Date.now().toString(36)}`
      onPatch((g) => ({
        ...g,
        tasks: [{ id, who, title, state: 'wait', ts: Date.now() }, ...g.tasks],
        log: [
          { id: `l${Date.now().toString(36)}`, ico: '🎯', text: `задача → ${who === 'group' ? 'группе' : who}: ${title}`, ts: Date.now() },
          ...g.log,
        ].slice(0, 60),
      }))
    },
    [onPatch],
  )
  const addMember = useCallback(
    (agent: RoyAgentRef) => {
      if (group.members.includes(agent.id)) return
      onPatch((g) => ({ ...g, members: [...g.members, agent.id] }))
      pushLog('＋', `участник добавлен: ${agent.name}`)
      setModal(null)
    },
    [group.members, onPatch, pushLog],
  )
  const removeMember = useCallback(
    (agent: RoyAgentRef) => {
      onPatch((g) => ({ ...g, members: g.members.filter((m) => m !== agent.id) }))
      pushLog('➖', `участник убран: ${agent.name}`)
      setModal(null)
    },
    [onPatch, pushLog],
  )
  const toggleHead = useCallback(() => {
    onPatch((g) => ({ ...g, head: g.head === 'main' ? 'user' : 'main' }))
  }, [onPatch])

  const missionSet = group.mission.trim().length > 0
  const missionPct = group.tasks.length ? Math.round((doneCount / group.tasks.length) * 100) : 0

  const sendMission = () => {
    if (!missionText.trim()) return
    addTaskTo('group', missionText.trim())
    onPatch((g) => ({ ...g, mission: missionText.trim() }))
    pushLog('🎯', `миссия поставлена: ${missionText.trim()}`)
    setMissionText('')
    setModal(null)
  }
  const sendTask = () => {
    if (!taskText.trim()) return
    const who = modal && modal.kind === 'task' ? modal.target : 'group'
    addTaskTo(who, taskText.trim())
    setTaskText('')
    setModal(null)
  }
  const toggleFileLink = (agentId: string) => {
    if (!selFile) return
    onPatch((g) => ({
      ...g,
      files: g.files.map((f) =>
        f.fileId === selFile
          ? { ...f, to: f.to.includes(agentId) ? f.to.filter((a) => a !== agentId) : [...f.to, agentId] }
          : f,
      ),
    }))
  }
  const dropFileOnArena = (fileId: string, label: string, emoji: string) => {
    onPatch((g) => {
      if (g.files.some((f) => f.fileId === fileId)) return g
      const n = g.files.length
      return {
        ...g,
        files: [...g.files, { fileId, label, emoji, x: 30 + ((n % 5) * 46), y: 90 + Math.floor(n / 5) * 34, to: [] }],
        log: [
          { id: `l${Date.now().toString(36)}`, ico: '📎', text: `файл на арене: ${label}`, ts: Date.now() },
          ...g.log,
        ].slice(0, 60),
      }
    })
  }

  const fromEls: Record<string, HTMLElement | null> = { leader: leaderRef.current }
  for (const f of group.files) fromEls[`file-${f.fileId}`] = fileRefs.current[`file-${f.fileId}`]
  const toEls: Record<string, HTMLElement | null> = {}
  for (const m of members) toEls[m] = cellRefs.current[m]
  const links: RoyLink[] = []
  for (const m of members) {
    if (headIsUser || (head && head.id === m)) continue // leader itself
    links.push({ id: `L-${m}`, from: 'leader', to: m })
  }
  for (const f of group.files) for (const t of f.to) links.push({ id: `LF-${f.fileId}-${t}`, from: `file-${f.fileId}`, to: t })

  const headerAgentName = headIsUser ? 'вы' : head?.name ?? '—'
  const assignees = headIsUser ? members : members.filter((m) => m !== 'main')

  return (
    <div className="roy-arena-wrap">
      {/* ── Head ── */}
      <div className="roy-head">
        <div className="rh-left">
          <div className={cn('rh-av', group.grad)}>{group.emoji}</div>
          <div>
            <div className="rh-title">РОЙ <small>· арена</small></div>
            <div className="rh-name">{group.name}</div>
          </div>
        </div>
        <div className="rh-tags">
          <span className="rh-tag" title="Кто управляет роем — клик переключит">
            главный: <b>{headerAgentName}</b>{' '}
            <button type="button" className="rh-switch" onClick={toggleHead}>
              {group.head === 'main' ? '👑 агент' : '👤 вы'}
            </button>
          </span>
          <span className="rh-tag">{members.length} участн.</span>
          <span className="rh-tag">{running.length > 0 ? `🌀 ${running.length} работают` : 'все свободны'}</span>
        </div>
        <div className="rh-actions">
          <button type="button" className="roy-btn" onClick={() => { setMissionText(group.mission); setModal({ kind: 'mission' }) }}>
            🎯 Задача группе
          </button>
          <button type="button" className="roy-btn" onClick={() => setModal({ kind: 'members' })}>
            ＋ Участник
          </button>
          <button type="button" className="roy-btn ghost" onClick={onClose} title="Выйти из арены">
            ✕
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
            const f = JSON.parse(raw) as { fileId: string; label: string; emoji: string }
            dropFileOnArena(f.fileId, f.label, f.emoji)
          } catch {
            /* ignore */
          }
        }}
      >
        <RoyLinksSvg links={links} fromEls={fromEls} toEls={toEls} />

        {memberAgents.length === 0 && !headIsUser && (
          <div className="roy-empty" onClick={() => setModal({ kind: 'members' })}>
            👇 Рой пуст — добавь участников (агентов)
          </div>
        )}

        {/* Leader cell — main agent (or «вы») */}
        {(head || headIsUser) && (
          <div className="roy-leader" ref={leaderRef}>
            <div className="crown">👑</div>
            {headIsUser ? (
              <div className="rl-av user">👤</div>
            ) : (
              <div className={cn('rl-av', 'g0')}>{head ? royAgentEmoji(head.id) : '🤖'}</div>
            )}
            <div className="rl-body">
              <div className="rl-name">{headIsUser ? 'вы' : head?.name} <small>{headIsUser ? '· управление роем' : `@${head?.id}`}</small></div>
              <div className="rl-role">{headIsUser ? 'ставите задачи и распределяете файлы' : `модель: ${head?.model ?? '—'}`}</div>
              {!headIsUser && (
                <div className="rl-desc">Оценивает задачу, распределяет роли, координирует участников и собирает результат.</div>
              )}
              <div className="rl-actions">
                <button type="button" className="roy-mini" title="Задача главному" onClick={() => setModal({ kind: 'task', target: headIsUser ? 'group' : 'main' })}>⚡</button>
                {!headIsUser && head && (
                  <button type="button" className="roy-mini" title="Чат" onClick={() => onChat(head.id)}>💬</button>
                )}
                {!headIsUser && head && (
                  <button type="button" className="roy-mini" title="Меню" onClick={() => setModal({ kind: 'agent', agentId: head.id })}>⋯</button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Member cells */}
        <div className="roy-cells">
          {assignees.map((agentId) => {
            const a = agents.find((x) => x.id === agentId)
            if (!a) return null
            const busy = group.tasks.some((t) => t.who === a.id && t.state === 'run')
            return (
              <div
                key={a.id}
                ref={(el) => { cellRefs.current[a.id] = el }}
                className={cn('roy-cell', busy && 'busy')}
                onClick={() => setModal({ kind: 'agent', agentId: a.id })}
                title={`${a.name} — открыть карточку`}
              >
                <div className="rc-top">
                  <span className="rc-st" title={busy ? 'работает' : 'свободен'} />
                  <span className="rc-av g1">{royAgentEmoji(a.id)}</span>
                </div>
                <div className="rc-name">{a.name}</div>
                <div className="rc-model">{a.model ? a.model.split('/').pop() : '—'}</div>
                <div className="rc-actions">
                  <button type="button" className="roy-mini" title="Задача" onClick={(e) => { e.stopPropagation(); setModal({ kind: 'task', target: a.id }) }}>⚡</button>
                  <button type="button" className="roy-mini" title="Чат" onClick={(e) => { e.stopPropagation(); onChat(a.id) }}>💬</button>
                  <button type="button" className="roy-mini" title="Связать файл (кликни файл, потом сюда)" onClick={(e) => { e.stopPropagation(); toggleFileLink(a.id) }}>🔗</button>
                </div>
              </div>
            )
          })}
        </div>

        {/* File cards on the arena */}
        {group.files.length > 0 && (
          <div className="roy-files">
            {group.files.map((f) => (
              <div
                key={f.fileId}
                ref={(el) => { fileRefs.current[`file-${f.fileId}`] = el }}
                className={cn('roy-file', selFile === f.fileId && 'sel')}
                onMouseEnter={() => setHoverDelFile(f.fileId)}
                onMouseLeave={() => setHoverDelFile(null)}
                onClick={() => setSelFile(selFile === f.fileId ? null : f.fileId)}
                title={selFile === f.fileId ? 'Файл выбран — клик по 🔗 участника создаёт/снимает связь' : 'Выбрать файл для раздачи агентам'}
              >
                <span className="rf-emoji">{f.emoji}</span>
                <span className="rf-label">{f.label}</span>
                {f.to.length > 0 && <span className="rf-to">{f.to.map((t) => t === 'main' ? 'main' : t).join(' · ')}</span>}
                {hoverDelFile === f.fileId && (
                  <button
                    type="button"
                    className="rf-del"
                    title="Убрать с арены"
                    onClick={(e) => {
                      e.stopPropagation()
                      onPatch((g) => ({ ...g, files: g.files.filter((x) => x.fileId !== f.fileId) }))
                      setSelFile(null)
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {group.files.length === 0 && (
          <div className="roy-drop-hint">
            📄 брось файл сюда с «Диска», затем раздай его агентам: клик по файлу → 🔗 у участника
          </div>
        )}
      </div>

      {/* ── Bottom task line ── */}
      <div className="roy-under">
        <div className="ru-tasks">
          {group.tasks.length === 0 ? (
            <span className="ru-none">Задач нет — поставь первую 🎯</span>
          ) : (
            group.tasks.slice(0, 5).map((t) => (
              <div key={t.id} className={cn('ru-task', t.state)}>
                <button
                  type="button"
                  className="ru-state"
                  title="Сменить состояние"
                  onClick={() => patchTask(t.id, (x) => ({ ...x, state: STATE_NEXT[x.state] }))}
                >
                  {STATE_ICON[t.state]}
                </button>
                <span className="ru-who">{t.who === 'group' ? 'РОЙ' : t.who}</span>
                <span className="ru-title">{t.title}</span>
                <button type="button" className="ru-del" title="Удалить" onClick={() => removeTask(t.id)}>×</button>
              </div>
            ))
          )}
        </div>
        {missionSet && (
          <div className="ru-mission">
            <span className="rum-bar"><i style={{ width: `${missionPct}%` }} /></span>
            <span className="rum-txt">🎯 {group.mission}</span>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {modal?.kind === 'task' && (
        <RoyModal title={`Задача ${modal.target === 'group' ? 'группе' : `→ ${modal.target}`}`} onClose={() => setModal(null)}>
          <div className="rm-target">{modal.target === 'group' ? 'РОЙ в целом — главный декомпозирует' : `Агент: ${modal.target}`}</div>
          <textarea className="rm-textarea" autoFocus placeholder="Опиши задачу…" value={taskText} onChange={(e) => setTaskText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && sendTask()} />
          <div className="rm-foot">
            <button type="button" className="roy-btn ghost" onClick={() => setModal(null)}>Отмена</button>
            <button type="button" className="roy-btn primary" disabled={!taskText.trim()} onClick={sendTask}>📨 Поставить задачу</button>
          </div>
        </RoyModal>
      )}

      {modal?.kind === 'mission' && (
        <RoyModal title="Задача группе (миссия)" onClose={() => setModal(null)}>
          <div className="rm-target">Задача уходит главному — он декомпозирует её и запросит найм/создание агентов.</div>
          <textarea className="rm-textarea" autoFocus placeholder="Крупная задача: например «Создать сайт v2»…" value={missionText} onChange={(e) => setMissionText(e.target.value)} />
          <div className="rm-foot">
            <button type="button" className="roy-btn ghost" onClick={() => setModal(null)}>Отмена</button>
            <button type="button" className="roy-btn primary" disabled={!missionText.trim()} onClick={sendMission}>🎯 Поставить группе</button>
          </div>
        </RoyModal>
      )}

      {modal?.kind === 'members' && (
        <RoyModal title="Участники роя" onClose={() => setModal(null)}>
          <div className="rm-target">Добавь агентов в рой. Один агент может быть в нескольких группах.</div>
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
                  <span className="rl-av g1" style={{ width: 26, height: 26, fontSize: 14 }}>{royAgentEmoji(a.id)}</span>
                  <span className="rmli-name">{a.name}</span>
                  <span className="rmli-model">{a.model ? a.model.split('/').pop() : '—'}</span>
                  <span className="rmli-flag">{inGroup ? '✓ в рое' : '＋'}</span>
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
          <RoyModal big title={`Карточка агента — ${a.name}`} onClose={() => setModal(null)}>
            <div className="rm-agent-top">
              <div className="rl-av g1" style={{ width: 56, height: 56, fontSize: 30 }}>{royAgentEmoji(a.id)}</div>
              <div>
                <div className="rm-a-name">{a.name}</div>
                <div className="rm-a-model">{a.model ?? 'модель не назначена'}</div>
                {group.members.includes(a.id) && <div className="rm-a-in">участник роя «{group.name}»</div>}
              </div>
            </div>
            <div className="rm-foot big">
              <button type="button" className="roy-btn" onClick={() => { setModal({ kind: 'task', target: a.id }) }}>⚡ Задача</button>
              <button type="button" className="roy-btn" onClick={() => { setModal(null); onChat(a.id) }}>💬 Чат</button>
              {group.members.includes(a.id) ? (
                <button type="button" className="roy-btn ghost" onClick={() => removeMember(a)}>🚪 Убрать из роя</button>
              ) : (
                <button type="button" className="roy-btn ghost" onClick={() => addMember(a)}>＋ В рой</button>
              )}
              <button type="button" className="roy-btn danger" onClick={() => { setModal(null); onRemoveAgent(a) }}>🗑 Удалить</button>
              <button type="button" className="roy-btn primary" onClick={() => setModal(null)}>✕ Закрыть</button>
            </div>
            <div className="rm-agent-links">
              {group.files.map((f: RoyFileCard) => (
                <button
                  key={f.fileId}
                  type="button"
                  className={cn('rm-file-link', f.to.includes(a.id) && 'on')}
                  onClick={() => {
                    onPatch((g) => ({
                      ...g,
                      files: g.files.map((x) =>
                        x.fileId === f.fileId
                          ? { ...x, to: x.to.includes(a.id) ? x.to.filter((t) => t !== a.id) : [...x.to, a.id] }
                          : x,
                      ),
                    }))
                  }}
                >
                  {f.emoji} {f.label} {f.to.includes(a.id) ? '· связано' : '· связать'}
                </button>
              ))}
              {group.files.length === 0 && <span className="rm-none-links">нет файлов на арене — брось с «Диска»</span>}
            </div>
          </RoyModal>
        )
      })()}
    </div>
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
}

export function RoyRightPanel({ group, agents, onPatch }: RoyRightProps) {
  const [showAll, setShowAll] = useState(false)
  const [logExpanded, setLogExpanded] = useState(true)
  const [newTask, setNewTask] = useState('')
  const running = activeTasks(group)
  const done = group.tasks.filter((t) => t.state === 'done').length
  const waiting = group.tasks.filter((t) => t.state === 'wait').length
  const total = group.tasks.length
  const free = group.members.length - running.length
  const logs: RoyLogRow[] = group.log
  const missionPct = total ? Math.round((done / total) * 100) : 0

  const STATE_NEXT: Record<RoyTask['state'], RoyTask['state']> = { wait: 'run', run: 'done', done: 'wait' }
  const patchTask = (id: string, fn: (t: RoyTask) => RoyTask) =>
    onPatch((g) => ({ ...g, tasks: g.tasks.map((t) => (t.id === id ? fn(t) : t)) }))

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
            <div className="rcm-title">🎯 {group.mission}</div>
            <div className="rcm-bar"><i style={{ width: `${missionPct}%` }} /></div>
            <div className="rcm-meta"><span>{waiting > 0 ? 'ожидает выполнения' : total > 0 && done === total ? 'выполнена' : running.length > 0 ? 'в работе…' : 'ожидает найма'}</span><span>{missionPct}%</span></div>
          </>
        ) : (
          <div className="rcm-none">миссии нет — поставь 🎯 Задачу группе</div>
        )}
      </div>

      <div className="roy-card">
        <div className="rc-head">
          Задачи <span className="cnt">{total}</span>
          <span className="act" onClick={() => setNewTask((x) => (x ? '' : ' '))}>＋ новая</span>
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
          </div>
        )}
        <div className="roy-tasklist">
          {(showAll ? group.tasks : group.tasks.slice(0, 5)).map((t) => (
            <div key={t.id} className={cn('roy-task-row', t.state)}>
              <button type="button" className="rt-state" title="Сменить состояние" onClick={() => patchTask(t.id, (x) => ({ ...x, state: STATE_NEXT[x.state] }))}>
                {t.state === 'wait' ? '⏸' : t.state === 'run' ? '▶️' : '✅'}
              </button>
              <div className="rt-body">
                <div className="rt-title">{t.title}</div>
                <div className="rt-who">→ {t.who === 'group' ? 'РОЙ' : t.who}{t.state === 'wait' ? ' · ждёт' : t.state === 'run' ? ' · в работе' : ' · готово'}</div>
              </div>
              <button type="button" className="rt-del" title="Удалить задачу" onClick={() => onPatch((g) => ({ ...g, tasks: g.tasks.filter((x) => x.id !== t.id) }))}>×</button>
            </div>
          ))}
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
              {royAgentEmoji(a.id)}<i>{a.name}</i>
            </span>
          )
        })}
      </div>
    </div>
  )
}
