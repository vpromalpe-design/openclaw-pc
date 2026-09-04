/** Рой (группа агентов) — типы данных (v0.9.34, встраивание макета). */

/** Реальный запуск задачи у агента (v0.9.37): привязка к shell-реестру задач. */
export interface RoyTaskRun {
  /** кому ушла задача (agent id) */
  agentId: string
  /** имя на момент запуска — для отчёта */
  agentName?: string
  /** id записи в локальном реестре задач (tasksDispatch → localTaskId) */
  localId?: string
  runId?: string
  status: 'run' | 'done' | 'fail'
  /** финальный ответ агента */
  report?: string
  error?: string
  startedAt: number
  endedAt?: number
}

export interface RoyTask {
  id: string
  /** Кому дана задача: agent id или 'group' (всему рою) */
  who: string
  title: string
  state: 'wait' | 'run' | 'done'
  ts: number
  /** v0.9.37: реальные запуски по агентам (если есть — задача «живая») */
  runs?: RoyTaskRun[]
  /** v0.9.37: принято главным/Дамиром («Сделано») */
  accepted?: boolean
}

export interface RoyLogRow {
  id: string
  ico: string
  text: string
  ts: number
}

export interface RoyFileCard {
  /** виртуальный файл диска */
  fileId: string
  label: string
  emoji: string
  x: number
  y: number
  /** агенты, которым «роздан» файл (связи-ниточки) */
  to: string[]
}

export interface RoyGroup {
  id: string
  name: string
  emoji: string
  grad: string
  /** участники — agent id из списка агентов приложения */
  members: string[]
  /** кто глава: 'main' (агент-координатор) или 'user' */
  head: 'main' | 'user'
  mission: string
  tasks: RoyTask[]
  log: RoyLogRow[]
  files: RoyFileCard[]
  createdAt: number
}

export interface RoyDiskNode {
  id: string
  label: string
  emoji: string
  kind: 'folder' | 'file'
  /** для папки — дети (реальные или вычисляемые позже) */
  children?: RoyDiskNode[]
  /** динамический info-текст (число групп/агентов/задач) */
  info?: string
}
