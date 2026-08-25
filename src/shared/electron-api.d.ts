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
  PairingApproveResult,
  PairingListApprovedResult,
  PairingListPendingResult,
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
  systemOpenPath: (path: string) => Promise<void>
  systemOpenLogDir: () => Promise<void>
  portCheck: (port: number) => Promise<PortCheckResult>
  wizardTestModel: (config: ModelConfig) => Promise<WizardTestModelResult>
  wizardTestTelegram: (config: {
    botToken?: string
    proxy?: string
  }) => Promise<WizardTestTelegramResult>
  telegramGet: () => Promise<TelegramSettingsLoadResult>
  telegramSave: (payload: { botToken?: string; botName?: string; botUrl?: string }) => Promise<TelegramSettingsSaveResult>
  wizardCompleteSetup: (state: WizardState) => Promise<WizardCompleteResult>
  shellGetVersions: () => Promise<AppVersionInfo>
  shellResizeForMainInterface: () => Promise<void>
  shellSetWindowTitle: (title: string) => Promise<void>
  diagnosticsExport: () => Promise<{ path: string; checksum: string }>
  sessionsList: () => Promise<unknown[]>

  providersList: () => Promise<ProvidersListResult>
  providersSaveProfile: (opts: { profileId: string; provider: string; apiKey: string }) => Promise<void>
  providersDeleteProfile: (opts: { profileId: string; provider?: string }) => Promise<void>
  providersTest: (config: ModelConfig) => Promise<WizardTestModelResult>
  providersExport: (opts?: { maskKeys?: boolean }) => Promise<string>
  providersImport: (json: string) => Promise<{ imported: number; errors: string[] }>
  providersSaveProviderConfig: (opts: { providerId: string; config: Partial<ModelProviderConfig> }) => Promise<void>
  providersSetModelDefaults: (opts: { primary?: string; fallbacks?: string[] }) => Promise<void>

  modelSettingsLoad: () => Promise<ModelSettingsLoadResult>
  modelSettingsApply: (payload: ModelSettingsApplyPayload) => Promise<ModelSettingsApplyResult>

  voiceSettingsLoad: () => Promise<VoiceSettingsLoadResult>
  voiceSettingsApply: (payload: VoiceSettingsApplyPayload) => Promise<VoiceSettingsApplyResult>
  voiceTest: (opts: { provider: 'google' | 'openai'; apiKey: string }) => Promise<VoiceTestResult>

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

  pairingListPending: (opts: { channel: 'feishu' }) => Promise<PairingListPendingResult>
  pairingListApproved: (opts: { channel: 'feishu' }) => Promise<PairingListApprovedResult>
  pairingApprove: (opts: { channel: 'feishu'; code: string; openId?: string }) => Promise<PairingApproveResult>
  pairingRemoveApproved: (opts: { channel: 'feishu'; openId: string }) => Promise<{ ok: boolean }>

  // ─── Event subscriptions ───────────────────────────────────────────────────
  onGatewayStatusChange: (callback: (status: GatewayStatus) => void) => Unsubscribe
  onGatewayLog: (callback: (log: GatewayLogPayload) => void) => Unsubscribe
  onLocalFirstRequest: (callback: (phase: 'start' | 'done') => void) => Unsubscribe
  onStreamGatewayLogs: (callback: (log: StructuredLogPayload) => void) => Unsubscribe
  onUpdateAvailable: (callback: (info: UpdateAvailablePayload) => void) => Unsubscribe
  onUpdateProgress: (callback: (progress: UpdateProgressPayload) => void) => Unsubscribe
}
