/** Механика роя (v0.9.34): группы, задачи, лог, диск. */

import type { RoyGroup, RoyTask, RoyTaskRun, RoyLogRow, RoyFileCard, RoyDiskNode } from './types'

const LS_KEY = 'openclaw-pc:roy-groups:v1'

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function loadGroups(): RoyGroup[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RoyGroup[]
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

export function saveGroups(groups: RoyGroup[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(groups))
  } catch {
    /* ignore */
  }
}

export function newGroup(name: string, emoji: string, grad: string): RoyGroup {
  const id = uid('roy')
  return {
    id,
    name: name.trim() || 'Рой',
    emoji: emoji || '🐝',
    grad,
    members: ['main'],
    head: 'main',
    mission: '',
    tasks: [],
    log: [{ id: uid('log'), ico: '🐝', text: 'группа создана — главный: main', ts: Date.now() }],
    files: [],
    createdAt: Date.now(),
  }
}

export function addLog(g: RoyGroup, ico: string, text: string): RoyGroup {
  return { ...g, log: [{ id: uid('log'), ico, text, ts: Date.now() }, ...g.log].slice(0, 80) }
}

export function addTask(g: RoyGroup, who: string, title: string): RoyGroup {
  const t: RoyTask = { id: uid('task'), who, title: title.trim(), state: 'wait', ts: Date.now() }
  return addLog(
    { ...g, tasks: [t, ...g.tasks] },
    '🎯',
    `задача → ${who === 'group' ? 'группе' : who}: ${title.trim()}`,
  )
}

/** Подписи и css-классы трёх статусов задачи (в очереди → работает → готово). */
export const TASK_STATE: Record<RoyTask['state'], { label: string; cls: string }> = {
  wait: { label: 'в очереди', cls: 'wait' },
  run: { label: 'работает', cls: 'run' },
  done: { label: 'готово', cls: 'done' },
}

/** Следующее состояние по «честному» пути вперёд; done не зацикливается. */
export function nextTaskState(state: RoyTask['state']): RoyTask['state'] | null {
  if (state === 'wait') return 'run'
  if (state === 'run') return 'done'
  return null
}

export function setTaskState(g: RoyGroup, taskId: string, state: RoyTask['state']): RoyGroup {
  const prev = g.tasks.find((t) => t.id === taskId)
  return {
    ...g,
    tasks: g.tasks.map((t) => (t.id === taskId ? { ...t, state } : t)),
    log: [
      {
        id: uid('log'),
        ico: state === 'run' ? '▶️' : state === 'done' ? '✅' : '⏳',
        text: `задача ${state === 'run' ? 'в работу' : state === 'done' ? 'выполнена' : 'в очередь'}${prev ? `: ${prev.title}` : ''}`,
        ts: Date.now(),
      },
      ...g.log,
    ].slice(0, 80),
  }
}

export function removeTask(g: RoyGroup, taskId: string): RoyGroup {
  const t = g.tasks.find((x) => x.id === taskId)
  return addLog(
    { ...g, tasks: g.tasks.filter((x) => x.id !== taskId) },
    '🗑',
    `задача удалена${t ? `: ${t.title}` : ''}`,
  )
}

/* ═══ v0.9.37: живые запуски (runs) — привязка к реальному слою задач ═══ */

/** Сколько запусков уже дали финальный результат (done|fail). */
export function finishedRuns(t: RoyTask): number {
  if (!t.runs) return 0
  return t.runs.filter((r) => r.status === 'done' || r.status === 'fail').length
}

/** Есть ли у задачи хоть один отчёт/ошибка для показа. */
export function hasReport(t: RoyTask): boolean {
  return !!t.runs && t.runs.some((r) => (r.report && r.report.trim()) || (r.error && r.error.trim()))
}

/** Задача считается задачей «главного» (её результат отчитывают Дамиру). */
export function isLeaderTask(t: RoyTask): boolean {
  return t.who === 'main' || t.who === 'group'
}

/**
 * Прикрепить результаты запусков к задаче (после реального диспатча).
 * Если все запуски сразу упали — задача становится done (с ошибками),
 * иначе — run («работает у N агентов»).
 */
export function attachTaskRuns(g: RoyGroup, taskId: string, runs: RoyTaskRun[]): RoyGroup {
  const t = g.tasks.find((x) => x.id === taskId)
  if (!t) return g
  const allFail = runs.length > 0 && runs.every((r) => r.status === 'fail')
  const nextState: RoyTask['state'] = allFail ? 'done' : 'run'
  const okN = runs.filter((r) => r.status !== 'fail').length
  const logText =
    runs.length === 0
      ? `запуск пуст: ${t.title}`
      : allFail
        ? `не удалось запустить ни у кого: ${t.title}`
        : `🚀 запущено у ${okN}/${runs.length}: ${t.title}`
  return {
    ...g,
    tasks: g.tasks.map((x) => (x.id === taskId ? { ...x, runs, state: nextState, accepted: false } : x)),
    log: [{ id: uid('log'), ico: allFail ? '⚠️' : '🚀', text: logText, ts: Date.now() }, ...g.log].slice(0, 80),
  }
}

/**
 * Применить результат реального запуска (мониторинг shell-реестра).
 * Когда все запуски терминальны — задача становится done (лог пишется один раз).
 */
export function applyRunResult(
  g: RoyGroup,
  taskId: string,
  localId: string,
  upd: { status: 'done' | 'fail'; report?: string; error?: string },
): RoyGroup {
  const t = g.tasks.find((x) => x.id === taskId)
  if (!t || !t.runs) return g
  const runs = t.runs.map((r) =>
    r.localId === localId
      ? {
          ...r,
          status: upd.status,
          report: upd.report,
          error: upd.error,
          endedAt: Date.now(),
        }
      : r,
  )
  const changed = t.runs.some((r) => r.localId === localId && r.status !== upd.status)
  if (!changed) return g
  const terminal = runs.every((r) => r.status === 'done' || r.status === 'fail')
  const prevState = t.state
  const nextState: RoyTask['state'] = terminal ? 'done' : prevState === 'wait' ? 'run' : prevState
  const doneN = runs.filter((r) => r.status === 'done').length
  const failN = runs.filter((r) => r.status === 'fail').length
  const newLogs: RoyLogRow[] = []
  if (terminal && prevState !== 'done') {
    newLogs.push({
      id: uid('log'),
      ico: failN > 0 && doneN === 0 ? '⚠️' : '✅',
      text:
        failN > 0
          ? `задача завершена с ошибками (${doneN} ок / ${failN} ошибок): ${t.title}`
          : `выполнено (${doneN}/${runs.length}): ${t.title}`,
      ts: Date.now(),
    })
  }
  return {
    ...g,
    tasks: g.tasks.map((x) => (x.id === taskId ? { ...x, runs, state: nextState } : x)),
    log: [...newLogs, ...g.log].slice(0, 80),
  }
}

export function setHead(g: RoyGroup, head: 'main' | 'user'): RoyGroup {
  return addLog({ ...g, head }, head === 'main' ? '👑' : '👤', head === 'main' ? 'глава — агент main' : 'глава — вы')
}

export function addMember(g: RoyGroup, agentId: string, agentName: string): RoyGroup {
  if (g.members.includes(agentId)) return g
  return addLog({ ...g, members: [...g.members, agentId] }, '＋', `участник добавлен: ${agentName}`)
}

export function removeMember(g: RoyGroup, agentId: string, agentName: string): RoyGroup {
  if (agentId === 'main') return g
  return addLog({ ...g, members: g.members.filter((m) => m !== agentId) }, '➖', `участник убран: ${agentName}`)
}

export function setMission(g: RoyGroup, mission: string): RoyGroup {
  return addLog({ ...g, mission }, '🎯', 'миссия обновлена')
}

export function renameGroup(g: RoyGroup, name: string): RoyGroup {
  return addLog({ ...g, name: name.trim() || g.name }, '✏️', `группа переименована: ${name.trim() || g.name}`)
}

export function removeGroup(g: RoyGroup): RoyGroup {
  return { ...g, members: ['main'], tasks: [], files: [], log: addLog({ ...g, name: g.name }, '🗑', 'группа очищена').log.slice(0, 5) }
}

/* ── Файлы на арене (перетащены с Диска) ─────────────────────────────── */

export function addFileCard(g: RoyGroup, fileId: string, label: string, emoji: string): RoyGroup {
  if (g.files.some((f) => f.fileId === fileId)) return g
  const n = g.files.length
  const card: RoyFileCard = {
    fileId,
    label,
    emoji,
    x: 120 + (n % 4) * 24,
    y: 120 + Math.floor(n / 4) * 24,
    to: [],
  }
  return addLog({ ...g, files: [...g.files, card] }, '📎', `файл на арене: ${label}`)
}

export function removeFileCard(g: RoyGroup, fileId: string): RoyGroup {
  return addLog({ ...g, files: g.files.filter((f) => f.fileId !== fileId) }, '🗑', 'файл убран с арены')
}

export function linkFileTo(g: RoyGroup, fileId: string, agentId: string): RoyGroup {
  const card = g.files.find((f) => f.fileId === fileId)
  if (!card) return g
  const linked = card.to.includes(agentId)
  const files = g.files.map((f) =>
    f.fileId === fileId
      ? { ...f, to: linked ? f.to.filter((a) => a !== agentId) : [...f.to, agentId] }
      : f,
  )
  return addLog(
    { ...g, files },
    linked ? '🔌' : '⚡',
    linked ? `связь снята: ${labelOf(agentId)} ← ${card.label}` : `файл роздан: ${card.label} → ${labelOf(agentId)}`,
  )
}

export function labelOf(agentId: string): string {
  return agentId === 'main' ? 'main' : agentId
}

/** Активные (работающие) задачи группы. */
export function activeTasks(g: RoyGroup): RoyTask[] {
  return g.tasks.filter((t) => t.state === 'run')
}

export const GRADS = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5'] as const

/* ── Диск (виртуальное дерево данных приложения) ─────────────────────── */

export function buildDiskTree(groups: RoyGroup[], agentCount: number, taskCount: number): RoyDiskNode[] {
  return [
    {
      id: 'root',
      label: 'OpenClaw PC',
      emoji: '📦',
      kind: 'folder',
      info: 'ядро + шелл · приложение',
      children: [
        { id: 'cfg', label: 'config.json', emoji: '⚙️', kind: 'file', info: `групп: ${groups.length} · агентов: ${agentCount}` },
        {
          id: 'groupsDir',
          label: 'groups/',
          emoji: '🐝',
          kind: 'folder',
          children: groups.map((g) => ({
            id: `g-${g.id}`,
            label: `${g.name}.json`,
            emoji: g.emoji,
            kind: 'file' as const,
            info: `${g.members.length} уч. · лидер ${g.head === 'main' ? 'main' : 'вы'}`,
          })),
        },
        { id: 'tasks', label: 'tasks.json', emoji: '✅', kind: 'file', info: `задач в роях: ${taskCount}` },
        {
          id: 'agentsDir',
          label: 'agents/',
          emoji: '🧑‍💻',
          kind: 'folder',
          children: [{ id: 'a-main', label: 'main.json', emoji: '🤖', kind: 'file', info: 'главный агент' }],
        },
        {
          id: 'logsDir',
          label: 'logs/',
          emoji: '📜',
          kind: 'folder',
          children: [
            { id: 'l-gw', label: 'gateway.log', emoji: '📄', kind: 'file', info: 'ok' },
            { id: 'l-sh', label: 'shell.log', emoji: '📄', kind: 'file', info: 'ok' },
          ],
        },
      ],
    },
    {
      id: 'prj',
      label: 'Проекты',
      emoji: '🗂️',
      kind: 'folder',
      info: 'папки больших задач',
      children: groups
        .filter((g) => g.mission.trim().length > 0)
        .map((g) => ({
          id: `prj-${g.id}`,
          label: g.name,
          emoji: g.emoji,
          kind: 'folder' as const,
          children: [
            { id: `prj-${g.id}-mission`, label: 'mission.md', emoji: '📄', kind: 'file' as const, info: g.mission.slice(0, 40) },
            ...g.tasks.slice(0, 4).map((t) => ({
              id: `prj-${g.id}-t-${t.id}`,
              label: `${t.id}.md`,
              emoji: '✅' as const,
              kind: 'file' as const,
              info: t.title.slice(0, 40),
            })),
          ],
        })),
    },
  ]
}

/** Содержимое виртуального файла — для окна просмотра. */
export function diskFileContent(node: RoyDiskNode, groups: RoyGroup[]): string {
  if (node.id === 'cfg') {
    return JSON.stringify(
      {
        product: 'OpenClaw PC',
        shell: 'v0.9.34 (рой)',
        groups: groups.map((g) => ({ id: g.id, name: g.name, members: g.members.length })),
      },
      null,
      2,
    )
  }
  if (node.id === 'tasks') {
    return JSON.stringify(
      {
        tasks: groups.flatMap((g) => g.tasks.map((t) => ({ group: g.name, ...t }))),
      },
      null,
      2,
    )
  }
  if (node.id.startsWith('g-')) {
    const g = groups.find((x) => `g-${x.id}` === node.id)
    return g ? JSON.stringify(g, null, 2) : '{}'
  }
  if (node.id.startsWith('prj-') && node.id.endsWith('-mission')) {
    const gid = node.id.slice(4, -'-mission'.length)
    const g = groups.find((x) => x.id === gid)
    return g ? g.mission : ''
  }
  if (node.id === 'l-gw') return '2026-09-03 16:40:12 info: gateway online · ошибок нет\n2026-09-03 16:40:12 info: uptime 99.9%'
  if (node.id === 'l-sh') return '2026-09-03 16:47:10 info: shell ready · рой-режим активен'
  if (node.id === 'a-main') return JSON.stringify({ id: 'main', name: 'main', isDefault: true }, null, 2)
  return '// содержимое недоступно — это бинарный или служебный файл'
}

/** Плоский список виртуальных файлов диска (для drag&drop → арена). */
export function flattenDiskFiles(nodes: RoyDiskNode[], into: Array<{ id: string; label: string; emoji: string }> = []): Array<{ id: string; label: string; emoji: string }> {
  for (const n of nodes) {
    if (n.kind === 'file') into.push({ id: n.id, label: n.label, emoji: n.emoji })
    if (n.children) flattenDiskFiles(n.children, into)
  }
  return into
}
