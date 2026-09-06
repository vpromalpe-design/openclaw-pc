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
  /** v0.9.39: реальные файлы, созданные агентом (абсолютные пути) */
  files?: Array<{ path: string; label: string; emoji: string; size?: number; mtimeMs?: number }>
}

export interface RoyTask {
  id: string
  /** Кому дана задача: agent id, 'group' (всему рою) или parentId-миссия */
  who: string
  title: string
  state: 'wait' | 'run' | 'done'
  ts: number
  /** v0.9.37: реальные запуски по агентам (если есть — задача «живая») */
  runs?: RoyTaskRun[]
  /** v0.9.37: принято главным («Сделано») */
  accepted?: boolean
  /** v0.9.39: подзадача миссии (миссия → главный → исполнители) */
  parentId?: string
  /** v0.9.40 (Путь Б): одиночная задача лично координатору — он решает: выполнить сам или вернуть план раздачи */
  coord?: boolean
  /** v0.9.39: реальная папка проекта на диске (workspace/projects/...) */
  projectDir?: string
  /** v0.9.39: стадия плана миссии (who='group'): ждём план главного, план пришёл, роздан */
  plan?: {
    status: 'run' | 'done' | 'fail'
    localId?: string
    report?: string
    error?: string
    /** подзадачи уже розданы по плану (защита от повторов) */
    dispatched?: boolean
    /** v0.9.41: финальный запрос-сводка координатору отправлен (localId его run) */
    finalLocalId?: string
    /** v0.9.44: финальный отчёт уже отправлен в Telegram (защита от повторов) */
    telegramSent?: boolean
  }
  /** v0.9.43: доработка по итогам отчёта (новое задание главному с файлами) */
  rework?: { files: string[]; comment: string }
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
  /** реальный путь файла на диске (v0.9.39: передаётся агенту в задании) */
  path?: string
  /** v0.9.42: папка с диска (карточка-папка: клик → проводник, агенту уходит путь папки) */
  kind?: 'file' | 'folder'
}

export interface RoyGroup {
  id: string
  name: string
  emoji: string
  grad: string
  /** участники — agent id из списка агентов приложения (без 'main'/'user') */
  members: string[]
  /** кто глава: 'main' (агент-координатор = первый участник) или 'user' */
  head: 'main' | 'user'
  /** v0.9.39: реальный лидер группы (агент-координатор), если head='main' */
  leaderId?: string
  mission: string
  tasks: RoyTask[]
  log: RoyLogRow[]
  files: RoyFileCard[]
  createdAt: number
  /** v0.9.42: папка группы на диске (workspace/projects/<Группа>) — все задачи группы работают в ней */
  projectDir?: string
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
  /** v0.9.39: абсолютный путь (для открытия в системе / чтения) */
  path?: string
  size?: number
  mtimeMs?: number
}
