/**
 * `window.electronAPI` typings — must match preload exposure.
 */

import type {
  GatewayStatus,
  ShellConfig,
  OpenClawConfig,
  ModelConfig,
  ModelProviderConfig,
  WizardState,
  WizardCompleteResult,
  ModelSettingsLoadResult,
  ModelSettingsApplyPayload,
  ModelSettingsApplyResult,
  ModelsViewResult,
  ModelsViewApplyRequest,
  LocalModelInfo,
  LocalEngineState,
  LocalEngineStatus,
  AppVersionInfo,
  SkillRegistryItem,
  ExtensionRegistryItem,
  PluginInfo,
  ValidationResult,
  RegistryExportSummary,
  UpdateCheckResult,
  BundleVerifyResult,
  PrestartCheckFrontend,
  PostUpdateValidationResult,
  DiagnosticReport,
  DiagnosticItem,
  AgentActivityPayload,
  AgentsAddResult,
  AgentsSetModelResult,
  AgentsRemoveResult,
} from './types'

/** TCP port check result */
export interface PortCheckResult {
  available: boolean
  pid?: number
}

/** Gateway start/restart result */
export interface GatewayStartResult {
  port: number
}

/** Wizard / provider model test result */
export interface WizardTestModelResult {
  ok: boolean
  message?: string
}

/** Wizard Telegram bot token probe result (getMe) */
export interface WizardTestTelegramResult {
  ok: boolean
  botName?: string
  botId?: string
  message?: string
}

/** Gateway log line */
export interface GatewayLogPayload {
  level: string
  message: string
}

/** Structured gateway log (`stream:gateway-logs`) */
export interface StructuredLogPayload {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  source: 'shell' | 'gateway' | 'install-validation'
  message: string
}

/** Backup archive create result */
export interface BackupCreateResult {
  archivePath: string
  assets: Array<{ kind: string; displayPath: string }>
  skipped?: Array<{ kind: string; displayPath: string; reason: string }>
  verified?: boolean
}

/** `openclaw config validate --json` result */
export interface ConfigValidationResult {
  valid: boolean
  configPath: string
  issues: Array<{ path: string; message: string; allowedValues?: string[] }>
}

/** Backup verify result */
export interface BackupVerifyResult {
  ok: boolean
  archivePath?: string
  message?: string
}

/** `logs.tail` RPC response */
export interface LogsTailResult {
  file?: string
  cursor?: number
  size?: number
  lines?: string[]
  truncated?: boolean
  reset?: boolean
}

/** Update-available push payload */
export interface UpdateAvailablePayload {
  version: string
}

/** Update download progress */
export interface UpdateProgressPayload {
  percent: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  completed?: boolean
  error?: string
}

/** LLM providers + profiles list */
export interface ProvidersListResult {
  profiles: Array<{ profileId: string; provider: string; hasKey: boolean }>
  providers: Array<{
    providerId: string
    baseUrl?: string
    api?: string
    hasApiKey: boolean
    models?: Array<{ id: string; name?: string }>
  }>
  modelDefaults: { primary?: string; fallbacks?: string[] }
  authOrder: Record<string, string[]>
}

/** IPC event unsubscribe handle */
export type Unsubscribe = () => void

/** Local download/engine progress payload (local:progress event) */
export interface LocalProgressPayload {
  modelId?: string
  fileName?: string
  received?: number
  total?: number
  progress?: number
  stage?: 'downloading' | 'done' | 'error' | 'engine-download' | 'cuda-runtime-download' | 'engine-installed'
  tag?: string
  variant?: string
}

/** v0.9.39: узел реального диска роя (возвращается IPC roy:tree) */
export interface RoyDiskIpcNode {
  id: string
  label: string
  emoji: string
  kind: 'folder' | 'file'
  /** абсолютный путь (file) или папка — для открытия/чтения */
  path?: string
  size?: number
  mtimeMs?: number
  children?: RoyDiskIpcNode[]
  /** подпись под корнем, когда пусто (например «задач ещё не было») */
  info?: string
}

/** Preload `electronAPI` surface */
export interface ElectronAPI {
  // ─── Invoke channels ───────────────────────────────────────────────────────
  gatewayStart: () => Promise<GatewayStartResult>
  gatewayStop: () => Promise<void>
  gatewayRestart: () => Promise<GatewayStartResult>
  gatewayStatus: () => Promise<GatewayStatus>
  configRead: () => Promise<OpenClawConfig>
  configWrite: (config: OpenClawConfig) => Promise<void>
  configExists: () => Promise<boolean>
  configValidate: () => Promise<ConfigValidationResult>
  shellGetConfig: () => Promise<ShellConfig>
  shellSetConfig: (config: Partial<ShellConfig>) => Promise<void>
  systemGetLocale: () => Promise<string>
  systemOpenExternal: (url: string) => Promise<void>
  /** Открыть локальный путь в системе (shell.openPath). Возвращает '' при успехе или текст ошибки. */
  systemOpenPath: (path: string) => Promise<string>
  systemOpenLogDir: () => Promise<void>
  portCheck: (port: number) => Promise<PortCheckResult>
  wizardTestModel: (config: ModelConfig) => Promise<WizardTestModelResult>
  wizardTestTelegram: (config: {
    botToken?: string
    proxy?: string
  }) => Promise<WizardTestTelegramResult>
  telegramGet: () => Promise<TelegramSettingsLoadResult>
  /** Add a Telegram bot: probe token, create account + agent + binding, restart the gateway. */
  telegramAddBot: (payload: {
    botToken: string
    /** Telegram user ids allowed to talk to this bot (optional, union with inherited owner ids) */
    accessIds?: string[]
  }) => Promise<TelegramSettingsSaveResult>
  /** Remove a Telegram bot account + binding (the linked agent survives). */
  telegramRemoveBot: (payload: { accountId: string }) => Promise<TelegramSettingsSaveResult>
  /** Replace the allowFrom access list of one bot account (gateway restart follows). */
  telegramUpdateAccess: (payload: {
    accountId: string
    /** Empty list clears account-level allowFrom (falls back to top-level inheritance) */
    accessIds: string[]
  }) => Promise<TelegramSettingsSaveResult>
  wizardCompleteSetup: (state: WizardState) => Promise<WizardCompleteResult>
  shellGetVersions: () => Promise<AppVersionInfo>
  shellResizeForMainInterface: () => Promise<void>
  shellSetWindowTitle: (title: string) => Promise<void>
  diagnosticsExport: () => Promise<{ path: string; checksum: string }>
  sessionsList: () => Promise<unknown[]>

  // v0.9.16: Задачи (Tasks board)
  tasksList: (opts?: { status?: string[]; limit?: number; agentId?: string }) => Promise<{
    tasks: Array<Record<string, unknown>>
    nextCursor?: string
  }>
  tasksGet: (opts: { taskId: string }) => Promise<{ task: Record<string, unknown> }>
  tasksCancel: (opts: { taskId: string }) => Promise<{ ok: boolean }>
  tasksDispatch: (opts: {
    text: string
    agentId?: string
    mode?: 'now' | 'schedule'
    schedule?: { kind: string; at?: string; expr?: string; everyMs?: number }
    freq?: string
  }) => Promise<{
    ok: boolean
    localTaskId?: string
    runId?: string
    error?: string
  }>
  /** v0.9.22: local task registry (shell-created tasks) */
  tasksLocalList: () => Promise<{ tasks: Array<Record<string, unknown>> }>
  tasksLocalRemove: (opts: { taskId: string }) => Promise<{ ok: boolean }>
  tasksLocalSetStatus: (opts: { taskId: string; status: string }) => Promise<{ ok: boolean }>
  tasksResume: (opts: { taskId: string; reply?: string }) => Promise<{
    ok: boolean
    runId?: string
    error?: string
  }>
  /** v0.9.27: resolve relative file names from task output into existing absolute paths */
  tasksResolveFiles: (opts: { names: string[] }) => Promise<{ resolved: Record<string, string> }>

  // ─── v0.9.39: реальный Диск роя (workspace/projects) ─────────────────────
  /** Дерево реального диска: workspace (файлы агентов + папки) и projects/ */
  royTree: () => Promise<{
    workspaceDir: string
    projectsDir: string
    roots: RoyDiskIpcNode[]
  }>
  /** Прочитать текстовый файл (≤ ~1 МБ) с диска роя */
  royRead: (opts: { path: string }) => Promise<{ ok: boolean; content?: string; error?: string; binary?: boolean }>
  /** Создать/найти папку проекта по названию задачи */
  royProjectCreate: (opts: { title: string }) => Promise<{ ok: boolean; dir?: string; error?: string }>
  /** Показать файл/папку в проводнике (Windows Explorer, showItemInFolder) */
  royShowInFolder: (path: string) => Promise<{ ok: boolean; error?: string }>
  /** v0.9.47: выбрать картинку → копия в userData/avatars + data URL (ресайз) для показа */
  royAvatarSave: (opts: { id?: string; src?: string }) => Promise<{ ok: boolean; path?: string; dataUrl?: string; picked?: string; error?: string }>
  /** v0.9.47: прочитать картинку с диска → data URL (миграция старых путей) */
  royAvatarRead: (opts: { path: string }) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>
  /** v0.9.46: переименовать/удалить/скопировать файл или папку диска */
  royFsRename: (opts: { path: string; name: string }) => Promise<{ ok: boolean; error?: string }>
  royFsDelete: (path: string) => Promise<{ ok: boolean; error?: string }>
  royFsCopy: (opts: { src: string; destDir: string }) => Promise<{ ok: boolean; error?: string }>
  /** v0.9.46: системный буфер обмена (текст) */
  clipboardRead: () => Promise<string>
  clipboardWrite: (text: string) => Promise<{ ok: boolean; error?: string }>
  /** v0.9.44: отчёт задачи в Telegram от имени бота агента (sendMessage + sendDocument) */
  royTelegramReport: (opts: { agentId: string; text: string; files?: string[] }) => Promise<{ ok: boolean; error?: string }>
  onTasksLocalChanged: (callback: () => void) => () => void
  cronList: () => Promise<{ jobs: Array<Record<string, unknown>> }>
  cronAdd: (opts: {
    name: string
    schedule: { kind: string; at?: string; expr?: string; everyMs?: number }
    sessionTarget?: string
    wakeMode?: string
    payload: { kind: string; message?: string }
    delivery?: { mode?: string }
  }) => Promise<{ ok: boolean; job?: Record<string, unknown>; error?: string }>
  cronRun: (opts: { jobId: string }) => Promise<{ ok: boolean }>
  cronRemove: (opts: { jobId: string }) => Promise<{ ok: boolean }>

  agentsAdd: (payload: { name: string; model?: string }) => Promise<AgentsAddResult>
  agentsSetModel: (payload: { agentId: string; model: string }) => Promise<AgentsSetModelResult>
  agentsRemove: (payload: { agentId: string }) => Promise<AgentsRemoveResult>

  providersList: () => Promise<ProvidersListResult>
  providersSaveProfile: (opts: { profileId: string; provider: string; apiKey: string }) => Promise<void>
  providersDeleteProfile: (opts: { profileId: string; provider?: string }) => Promise<void>
  providersTest: (config: ModelConfig) => Promise<WizardTestModelResult>
  providersExport: (opts?: { maskKeys?: boolean }) => Promise<string>
  providersImport: (json: string) => Promise<{ imported: number; errors: string[] }>
  providersSaveProviderConfig: (opts: { providerId: string; config: Partial<ModelProviderConfig> }) => Promise<void>
  providersFetchModels: (opts: { providerId: string; baseUrl: string; apiKey: string; compatibility?: 'openai' | 'anthropic' }) => Promise<Array<{ id: string; name?: string }>>
  providersSetModelDefaults: (opts: { primary?: string; fallbacks?: string[] }) => Promise<void>

  modelSettingsLoad: () => Promise<ModelSettingsLoadResult>
  modelSettingsApply: (payload: ModelSettingsApplyPayload) => Promise<ModelSettingsApplyResult>

  voiceSettingsLoad: () => Promise<VoiceSettingsLoadResult>
  voiceSettingsApply: (payload: VoiceSettingsApplyPayload) => Promise<VoiceSettingsApplyResult>
  voiceTest: (opts: { provider: 'google' | 'openai'; apiKey: string }) => Promise<VoiceTestResult>

  // v0.9.13 (Этап F): TTS / STT
  ttsLoad: () => Promise<{
    enabled: boolean
    provider: 'edge' | 'elevenlabs' | 'piper'
    voice: string
    hasKey: boolean
    piper: { installed: boolean; voiceInstalled: boolean }
  }>
  ttsApply: (payload: {
    enabled?: boolean
    provider?: 'edge' | 'elevenlabs' | 'piper'
    voice?: string
    apiKey?: string | null
  }) => Promise<{ ok: boolean }>
  ttsTest: () => Promise<{ ok: boolean; mime?: string; audioBase64?: string; error?: string }>
  ttsVoices: (payload: { provider: string; apiKey?: string }) =>
    Promise<{ ok: boolean; voices?: { id: string; name: string }[]; error?: string }>
  ttsInstall: () => Promise<{ ok: boolean }>
  onTtsUtterance: (cb: (payload: { mime: string; audioBase64: string; text: string }) => void) => () => void
  sttLoad: () => Promise<{
    enabled: boolean
    model: 'tiny' | 'base' | 'small' | 'medium'
    preferredMode?: 'auto' | 'offline' | 'online'
    whisper: {
      installed: boolean
      modelsInstalled: string[]
      models: { id: string; name: string }[]
    }
  }>
  sttApply: (payload: { enabled?: boolean; model?: string }) => Promise<{ ok: boolean }>
  sttInstall: (payload: { model: string }) => Promise<{ ok: boolean }>
  sttTranscribe: (payload: { audioBase64: string }) => Promise<{ ok: boolean; text?: string; error?: string }>
  sttSetPreferredMode: (payload: { mode: 'auto' | 'offline' | 'online' }) => Promise<{ ok: boolean; mode: string }>
  onVoiceProgress: (cb: (payload: unknown) => void) => () => void

  modelsViewList: () => Promise<ModelsViewResult>
  modelsViewApply: (payload: ModelsViewApplyRequest) => Promise<{ ok: boolean; restarted: boolean; backupPath: string | null }>
  localList: () => Promise<{ localModels: LocalModelInfo[]; engineState: LocalEngineState }>
  localAdd: (payload: { presetId?: string; url?: string; path?: string }) => Promise<unknown>
  localPickFile: () => Promise<{ path: string } | null>
  localRemove: (payload: { id: string }) => Promise<{ ok: boolean }>
  localDownloadStart: (payload: { modelId: string }) => Promise<{ ok: boolean }>
  localDownloadCancel: () => Promise<{ ok: boolean }>
  localEngineStart: (payload: { modelId: string; test?: boolean }) => Promise<{ ok: boolean; engineState: LocalEngineState; test?: { ok: boolean; message: string } }>
  localEngineStop: () => Promise<{ ok: boolean; wasRunning: boolean }>
  localEngineMode: (payload?: {
    setMode?: 'auto' | 'cpu' | 'gpu'
    installVariant?: 'cpu' | 'cuda' | 'vulkan'
  }) => Promise<LocalEngineRuntimeInfo>
  /** Lightweight engine status for CPU/GPU indicators (v0.9.12) */
  localEngineStatus: () => Promise<LocalEngineStatus>
  localEngineReorder: (ids: string[]) => Promise<{ ok: boolean }>
  textChatSend: (payload: {
    text: string
    history?: { role: 'user' | 'assistant'; content: string }[]
  }) => Promise<{ ok: boolean; text?: string; message?: string; model?: string; provider?: string }>
  localFirstRequestStatus: () => Promise<{ pending: boolean }>
  onLocalProgress: (callback: (payload: LocalProgressPayload) => void) => Unsubscribe

  skillsList: (opts?: { source?: 'all' | 'bundled' | 'user' }) => Promise<SkillRegistryItem[]>
  skillsToggle: (opts: { skillKey: string; enabled: boolean }) => Promise<{ ok: boolean }>
  skillsReload: () => Promise<{ ok: boolean }>
  extensionsList: (opts?: { source?: 'all' | 'bundled' | 'user' }) => Promise<ExtensionRegistryItem[]>
  extensionsToggle: (opts: { pluginId: string; enabled: boolean }) => Promise<{ ok: boolean }>
  registryReload: () => Promise<{ ok: boolean }>
  registryExport: (opts?: { skills?: string[]; extensions?: string[] }) => Promise<{ path: string; summary: RegistryExportSummary; checksum: string }>
  registryImport: (opts: { path: string; merge?: boolean }) => Promise<{ ok: boolean; merged: string[]; errors: string[] }>
  registryValidate: (opts: { kind: 'skill' | 'extension'; id: string }) => Promise<ValidationResult>

  updateCheck: () => Promise<UpdateCheckResult>
  updateDownloadShell: () => Promise<void>
  updateInstallShell: () => Promise<void>
  updateCancelDownload: () => Promise<void>
  updateVerifyBundle: () => Promise<BundleVerifyResult>
  updatePrestartCheck: () => Promise<PrestartCheckFrontend>
  updateGetPostUpdateValidation: () => Promise<PostUpdateValidationResult>
  diagnosticsRun: () => Promise<DiagnosticReport>
  diagnosticsSummary: () => Promise<{ ok: boolean; summary: string; topIssues: DiagnosticItem[] }>

  modelsList: () => Promise<{ models: Array<{ id: string; name?: string; provider?: string }> }>
  modelsSetDefault: (opts: { modelId: string } | { primary: string }) => Promise<{ ok: boolean }>
  modelsSetFallbacks: (opts: { fallbacks: string[] }) => Promise<{ ok: boolean }>
  modelsSetAliases: (opts: { aliases: Record<string, { alias?: string }> }) => Promise<{ ok: boolean }>

  pluginsList: () => Promise<{ plugins: PluginInfo[]; workspaceDir?: string }>
  pluginsToggle: (opts: { id: string; enabled: boolean } | { pluginId: string; enabled: boolean }) => Promise<{ ok: boolean; message?: string }>
  pluginsInstall: (spec: string) => Promise<{ ok: boolean; pluginId?: string; message?: string }>
  pluginsUninstall: (opts: { id: string; keepFiles?: boolean } | { pluginId: string; keepFiles?: boolean }) => Promise<{ ok: boolean; message?: string }>

  logsTail: (opts?: { cursor?: number; limit?: number; maxBytes?: number }) => Promise<LogsTailResult>

  backupCreate: (opts?: { output?: string; includeWorkspace?: boolean; onlyConfig?: boolean; verify?: boolean }) => Promise<BackupCreateResult>
  backupVerify: (archivePath: string) => Promise<BackupVerifyResult>

  onGatewayStatusChange: (callback: (status: GatewayStatus) => void) => Unsubscribe
  onGatewayLog: (callback: (log: GatewayLogPayload) => void) => Unsubscribe
  onLocalFirstRequest: (callback: (phase: 'start' | 'done') => void) => Unsubscribe
  onStreamGatewayLogs: (callback: (log: StructuredLogPayload) => void) => Unsubscribe
  onUpdateAvailable: (callback: (info: UpdateAvailablePayload) => void) => Unsubscribe
  onUpdateProgress: (callback: (progress: UpdateProgressPayload) => void) => Unsubscribe
  onAgentsActivity: (callback: (payload: AgentActivityPayload) => void) => Unsubscribe
}
