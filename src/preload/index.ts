/**
 * Preload: contextBridge.exposeInMainWorld API surface.
 * Matches ipc-channels; contextIsolation on, nodeIntegration off.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type {
  LocalEngineStatus,
  TelegramSettingsLoadResult,
  TelegramSettingsSaveResult,
} from '../shared/types'
import {
  IPC_GATEWAY_START,
  IPC_GATEWAY_STOP,
  IPC_GATEWAY_RESTART,
  IPC_AGENTS_ADD,
  IPC_AGENTS_SET_MODEL,
  IPC_AGENTS_ACTIVITY,
  IPC_GATEWAY_STATUS,
  IPC_CONFIG_READ,
  IPC_CONFIG_WRITE,
  IPC_CONFIG_EXISTS,
  IPC_CONFIG_VALIDATE,
  IPC_SHELL_GET_CONFIG,
  IPC_SHELL_SET_CONFIG,
  IPC_SYSTEM_GET_LOCALE,
  IPC_SYSTEM_OPEN_EXTERNAL,
  IPC_SYSTEM_OPEN_PATH,
  IPC_PORT_CHECK,
  IPC_WIZARD_TEST_MODEL,
  IPC_WIZARD_TEST_TELEGRAM,
  IPC_TELEGRAM_GET,
  IPC_TELEGRAM_SAVE,
  IPC_WIZARD_COMPLETE_SETUP,
  IPC_SYSTEM_OPEN_LOG_DIR,
  IPC_SHELL_GET_VERSIONS,
  IPC_SHELL_RESIZE_FOR_MAIN_INTERFACE,
  IPC_SHELL_SET_WINDOW_TITLE,
  IPC_DIAGNOSTICS_EXPORT,
  IPC_SESSIONS_LIST,
  IPC_PROVIDERS_LIST,
  IPC_PROVIDERS_SAVE_PROFILE,
  IPC_PROVIDERS_DELETE_PROFILE,
  IPC_PROVIDERS_TEST,
  IPC_PROVIDERS_EXPORT,
  IPC_PROVIDERS_IMPORT,
  IPC_PROVIDERS_SAVE_CONFIG,
  IPC_PROVIDERS_SET_MODEL_DEFAULTS,
  IPC_MODEL_SETTINGS_LOAD,
  IPC_MODEL_SETTINGS_APPLY,
  IPC_VOICE_SETTINGS_LOAD,
  IPC_VOICE_SETTINGS_APPLY,
  IPC_VOICE_TEST,
  IPC_MODELS_VIEW_LIST,
  IPC_MODELS_VIEW_APPLY,
  IPC_LOCAL_LIST,
  IPC_LOCAL_ADD,
  IPC_LOCAL_PICK_FILE,
  IPC_LOCAL_REMOVE,
  IPC_LOCAL_DOWNLOAD_START,
  IPC_LOCAL_DOWNLOAD_CANCEL,
  IPC_LOCAL_ENGINE_START,
  IPC_LOCAL_ENGINE_STOP,
  IPC_LOCAL_ENGINE_MODE,
  IPC_LOCAL_ENGINE_STATUS,
  IPC_LOCAL_REORDER,
  IPC_TEXT_CHAT_SEND,
  IPC_LOCAL_PROGRESS,
  IPC_SKILLS_LIST,
  IPC_SKILLS_TOGGLE,
  IPC_SKILLS_RELOAD,
  IPC_EXTENSIONS_LIST,
  IPC_EXTENSIONS_TOGGLE,
  IPC_REGISTRY_RELOAD,
  IPC_REGISTRY_EXPORT,
  IPC_REGISTRY_IMPORT,
  IPC_REGISTRY_VALIDATE,
  IPC_UPDATE_CHECK,
  IPC_UPDATE_DOWNLOAD_SHELL,
  IPC_UPDATE_INSTALL_SHELL,
  IPC_UPDATE_CANCEL_DOWNLOAD,
  IPC_UPDATE_VERIFY_BUNDLE,
  IPC_UPDATE_PRESTART_CHECK,
  IPC_UPDATE_GET_POST_UPDATE_VALIDATION,
  IPC_DIAGNOSTICS_RUN,
  IPC_DIAGNOSTICS_SUMMARY,
  IPC_MODELS_LIST,
  IPC_MODELS_SET_DEFAULT,
  IPC_MODELS_SET_FALLBACKS,
  IPC_MODELS_SET_ALIASES,
  IPC_PLUGINS_LIST,
  IPC_PLUGINS_TOGGLE,
  IPC_PLUGINS_INSTALL,
  IPC_PLUGINS_UNINSTALL,
  IPC_BACKUP_CREATE,
  IPC_BACKUP_VERIFY,
  IPC_PAIRING_LIST_PENDING,
  IPC_PAIRING_LIST_APPROVED,
  IPC_PAIRING_APPROVE,
  IPC_PAIRING_REMOVE_APPROVED,
  IPC_GATEWAY_STATUS_CHANGE,
  IPC_GATEWAY_LOG,
  IPC_STREAM_GATEWAY_LOGS,
  IPC_UPDATE_AVAILABLE,
  IPC_UPDATE_PROGRESS,
  IPC_LOCAL_FIRST_REQUEST,
  IPC_LOCAL_FIRST_REQUEST_STATUS,
  IPC_LOGS_TAIL,
} from '../shared/ipc-channels'

interface IpcResult<T = unknown> {
  success: boolean
  data?: T
  error?: { code: string; message: string }
}

function isIpcResult(value: unknown): value is IpcResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof (value as IpcResult).success === 'boolean'
  )
}

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const raw: unknown = await ipcRenderer.invoke(channel, ...args)
  if (isIpcResult(raw)) {
    if (!raw.success) {
      throw new Error(raw.error?.message ?? `IPC call failed: ${channel}`)
    }
    return raw.data as T
  }
  return raw as T
}

const on = (
  channel: string,
  callback: (...args: unknown[]) => void
): (() => void) => {
  const handler = (_: unknown, ...args: unknown[]) => callback(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Invoke channels ───────────────────────────────────────────────────────
  gatewayStart: () => invoke(IPC_GATEWAY_START),
  gatewayStop: () => invoke(IPC_GATEWAY_STOP),
  gatewayRestart: () => invoke(IPC_GATEWAY_RESTART),
  gatewayStatus: () => invoke(IPC_GATEWAY_STATUS),
  configRead: () => invoke(IPC_CONFIG_READ),
  configWrite: (config: unknown) => invoke(IPC_CONFIG_WRITE, config),
  configExists: () => invoke(IPC_CONFIG_EXISTS),
  configValidate: () =>
    invoke<{ valid: boolean; configPath: string; issues: Array<{ path: string; message: string; allowedValues?: string[] }> }>(
      IPC_CONFIG_VALIDATE,
    ),
  shellGetConfig: () => invoke(IPC_SHELL_GET_CONFIG),
  shellSetConfig: (config: unknown) => invoke(IPC_SHELL_SET_CONFIG, config),
  systemGetLocale: () => invoke<string>(IPC_SYSTEM_GET_LOCALE),
  systemOpenExternal: (url: string) => invoke(IPC_SYSTEM_OPEN_EXTERNAL, url),
  systemOpenPath: (path: string) => invoke(IPC_SYSTEM_OPEN_PATH, path),
  portCheck: (port: number) => invoke(IPC_PORT_CHECK, port),
  wizardTestModel: (config: unknown) => invoke(IPC_WIZARD_TEST_MODEL, config),
  wizardTestTelegram: (config: unknown) => invoke(IPC_WIZARD_TEST_TELEGRAM, config),
  telegramGet: () => invoke<TelegramSettingsLoadResult>(IPC_TELEGRAM_GET),
  telegramSave: (payload: { botToken?: string; botName?: string; botUrl?: string }) =>
    invoke<TelegramSettingsSaveResult>(IPC_TELEGRAM_SAVE, payload),
  wizardCompleteSetup: (state: unknown) => invoke(IPC_WIZARD_COMPLETE_SETUP, state),
  systemOpenLogDir: () => invoke(IPC_SYSTEM_OPEN_LOG_DIR),
  shellGetVersions: () => invoke(IPC_SHELL_GET_VERSIONS),
  shellResizeForMainInterface: () => invoke(IPC_SHELL_RESIZE_FOR_MAIN_INTERFACE),
  shellSetWindowTitle: (title: string) => invoke(IPC_SHELL_SET_WINDOW_TITLE, title),
  diagnosticsExport: () => invoke<{ path: string; checksum: string }>(IPC_DIAGNOSTICS_EXPORT),
  sessionsList: () => invoke<unknown[]>(IPC_SESSIONS_LIST),

  agentsAdd: (payload: { name: string; model?: string }) =>
    invoke<{ ok: boolean; id?: string; error?: string }>(IPC_AGENTS_ADD, payload),
  agentsSetModel: (payload: { agentId: string; model: string }) =>
    invoke<{ ok: boolean; error?: string }>(IPC_AGENTS_SET_MODEL, payload),
  onAgentsActivity: (callback: (payload: unknown) => void) =>
    on(IPC_AGENTS_ACTIVITY, callback),

  providersList: () => invoke(IPC_PROVIDERS_LIST),
  providersSaveProfile: (opts: { profileId: string; provider: string; apiKey: string }) =>
    invoke(IPC_PROVIDERS_SAVE_PROFILE, opts),
  providersDeleteProfile: (opts: { profileId: string; provider?: string }) =>
    invoke(IPC_PROVIDERS_DELETE_PROFILE, opts),
  providersTest: (config: unknown) => invoke(IPC_PROVIDERS_TEST, config),
  providersExport: (opts?: { maskKeys?: boolean }) => invoke<string>(IPC_PROVIDERS_EXPORT, opts ?? {}),
  providersImport: (json: string) => invoke<{ imported: number; errors: string[] }>(IPC_PROVIDERS_IMPORT, json),
  providersSaveProviderConfig: (opts: { providerId: string; config: unknown }) =>
    invoke(IPC_PROVIDERS_SAVE_CONFIG, opts),
  providersSetModelDefaults: (opts: { primary?: string; fallbacks?: string[] }) =>
    invoke(IPC_PROVIDERS_SET_MODEL_DEFAULTS, opts ?? {}),

  modelSettingsLoad: () => invoke(IPC_MODEL_SETTINGS_LOAD),
  modelSettingsApply: (payload: unknown) => invoke(IPC_MODEL_SETTINGS_APPLY, payload),

  voiceSettingsLoad: () => invoke(IPC_VOICE_SETTINGS_LOAD),
  voiceSettingsApply: (payload: unknown) => invoke(IPC_VOICE_SETTINGS_APPLY, payload),
  voiceTest: (opts: unknown) => invoke(IPC_VOICE_TEST, opts),

  modelsViewList: () => invoke(IPC_MODELS_VIEW_LIST),
  modelsViewApply: (payload: { primary: string | null; fallbacks: string[]; restart: boolean }) =>
    invoke(IPC_MODELS_VIEW_APPLY, payload),
  localList: () => invoke(IPC_LOCAL_LIST),
  localAdd: (payload: { presetId?: string; url?: string; path?: string }) => invoke(IPC_LOCAL_ADD, payload),
  localPickFile: () => invoke(IPC_LOCAL_PICK_FILE),
  localRemove: (payload: { id: string }) => invoke(IPC_LOCAL_REMOVE, payload),
  localDownloadStart: (payload: { modelId: string }) => invoke(IPC_LOCAL_DOWNLOAD_START, payload),
  localDownloadCancel: () => invoke(IPC_LOCAL_DOWNLOAD_CANCEL),
  localEngineStart: (payload: { modelId: string; test?: boolean }) => invoke(IPC_LOCAL_ENGINE_START, payload),
  localEngineStop: () => invoke(IPC_LOCAL_ENGINE_STOP),
  localEngineMode: (payload?: {
    setMode?: 'auto' | 'cpu' | 'gpu'
    installVariant?: 'cpu' | 'cuda' | 'vulkan'
  }) => invoke(IPC_LOCAL_ENGINE_MODE, payload ?? {}),
  localEngineStatus: () => invoke<LocalEngineStatus>(IPC_LOCAL_ENGINE_STATUS),
  localEngineReorder: (ids: string[]) => invoke(IPC_LOCAL_REORDER, { ids }),
  textChatSend: (payload: {
    text: string
    history?: { role: 'user' | 'assistant'; content: string }[]
  }) => invoke(IPC_TEXT_CHAT_SEND, payload),
  onLocalProgress: (cb: (payload: unknown) => void) => on(IPC_LOCAL_PROGRESS, cb),

  skillsList: (opts?: { source?: 'all' | 'bundled' | 'user' }) =>
    invoke(IPC_SKILLS_LIST, opts ?? {}),
  skillsToggle: (opts: { skillKey: string; enabled: boolean }) =>
    invoke(IPC_SKILLS_TOGGLE, opts),
  skillsReload: () => invoke(IPC_SKILLS_RELOAD),
  extensionsList: (opts?: { source?: 'all' | 'bundled' | 'user' }) =>
    invoke(IPC_EXTENSIONS_LIST, opts ?? {}),
  extensionsToggle: (opts: { pluginId: string; enabled: boolean }) =>
    invoke(IPC_EXTENSIONS_TOGGLE, opts),
  registryReload: () => invoke(IPC_REGISTRY_RELOAD),
  registryExport: (opts?: { skills?: string[]; extensions?: string[] }) =>
    invoke(IPC_REGISTRY_EXPORT, opts ?? {}),
  registryImport: (opts: { path: string; merge?: boolean }) =>
    invoke(IPC_REGISTRY_IMPORT, opts),
  registryValidate: (opts: { kind: 'skill' | 'extension'; id: string }) =>
    invoke(IPC_REGISTRY_VALIDATE, opts),

  updateCheck: () => invoke(IPC_UPDATE_CHECK),
  updateDownloadShell: () => invoke(IPC_UPDATE_DOWNLOAD_SHELL),
  updateInstallShell: () => invoke(IPC_UPDATE_INSTALL_SHELL),
  updateCancelDownload: () => invoke(IPC_UPDATE_CANCEL_DOWNLOAD),
  updateVerifyBundle: () => invoke(IPC_UPDATE_VERIFY_BUNDLE),
  updatePrestartCheck: () => invoke(IPC_UPDATE_PRESTART_CHECK),
  updateGetPostUpdateValidation: () =>
    invoke<{ ran: boolean; ok: boolean; report?: unknown; rollbackGuidance: string }>(
      IPC_UPDATE_GET_POST_UPDATE_VALIDATION,
    ),
  diagnosticsRun: () => invoke(IPC_DIAGNOSTICS_RUN),
  diagnosticsSummary: () => invoke(IPC_DIAGNOSTICS_SUMMARY),

  modelsList: () => invoke<{ models: Array<{ id: string; name?: string; provider?: string }> }>(IPC_MODELS_LIST),
  modelsSetDefault: (opts: { modelId: string } | { primary: string }) =>
    invoke(IPC_MODELS_SET_DEFAULT, opts),
  modelsSetFallbacks: (opts: { fallbacks: string[] }) =>
    invoke(IPC_MODELS_SET_FALLBACKS, opts),
  modelsSetAliases: (opts: { aliases: Record<string, { alias?: string }> }) =>
    invoke(IPC_MODELS_SET_ALIASES, opts),

  pluginsList: () => invoke(IPC_PLUGINS_LIST),
  pluginsToggle: (opts: { id: string; enabled: boolean } | { pluginId: string; enabled: boolean }) =>
    invoke(IPC_PLUGINS_TOGGLE, opts),
  pluginsInstall: (spec: string) => invoke(IPC_PLUGINS_INSTALL, spec),
  pluginsUninstall: (opts: { id: string; keepFiles?: boolean } | { pluginId: string; keepFiles?: boolean }) =>
    invoke(IPC_PLUGINS_UNINSTALL, opts),

  logsTail: (opts?: { cursor?: number; limit?: number; maxBytes?: number }) =>
    invoke<{ file?: string; cursor?: number; size?: number; lines?: string[]; truncated?: boolean; reset?: boolean }>(
      IPC_LOGS_TAIL,
      opts ?? {},
    ),

  backupCreate: (opts?: { output?: string; includeWorkspace?: boolean; onlyConfig?: boolean; verify?: boolean }) =>
    invoke<{ archivePath: string; assets: Array<{ kind: string; displayPath: string }>; skipped?: Array<{ kind: string; displayPath: string; reason: string }>; verified?: boolean }>(
      IPC_BACKUP_CREATE,
      opts ?? {},
    ),
  backupVerify: (archivePath: string) =>
    invoke<{ ok: boolean; archivePath?: string; message?: string }>(IPC_BACKUP_VERIFY, archivePath),

  pairingListPending: (opts: { channel: 'feishu' }) =>
    invoke<{ channel: 'feishu'; requests: Array<{ code: string; openId?: string; displayName?: string; createdAt?: string; expiresAt?: string }> }>(
      IPC_PAIRING_LIST_PENDING,
      opts,
    ),
  pairingListApproved: (opts: { channel: 'feishu' }) =>
    invoke<{ channel: 'feishu'; senders: Array<{ openId: string }> }>(IPC_PAIRING_LIST_APPROVED, opts),
  pairingApprove: (opts: { channel: 'feishu'; code: string; openId?: string }) =>
    invoke<{ ok: boolean; message?: string }>(IPC_PAIRING_APPROVE, opts),
  pairingRemoveApproved: (opts: { channel: 'feishu'; openId: string }) =>
    invoke<{ ok: boolean }>(IPC_PAIRING_REMOVE_APPROVED, opts),

  // ─── Event subscriptions ─────────────────────────────────────────────────────
  onGatewayStatusChange: (callback: (status: unknown) => void) =>
    on(IPC_GATEWAY_STATUS_CHANGE, callback),
  onGatewayLog: (callback: (log: unknown) => void) =>
    on(IPC_GATEWAY_LOG, callback as (...args: unknown[]) => void),
  onLocalFirstRequest: (callback: (phase: 'start' | 'done') => void) =>
    on(IPC_LOCAL_FIRST_REQUEST, callback as (...args: unknown[]) => void),
  localFirstRequestStatus: () => invoke<{ pending: boolean }>(IPC_LOCAL_FIRST_REQUEST_STATUS),
  onStreamGatewayLogs: (callback: (log: unknown) => void) =>
    on(IPC_STREAM_GATEWAY_LOGS, callback),
  onUpdateAvailable: (callback: (info: unknown) => void) =>
    on(IPC_UPDATE_AVAILABLE, callback),
  onUpdateProgress: (callback: (progress: unknown) => void) =>
    on(IPC_UPDATE_PROGRESS, callback),
})
