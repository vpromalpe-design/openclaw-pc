import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { GatewayProcessManager } from '../gateway/index.js'
import type {
  OpenClawConfig,
  ShellConfig,
  AppVersionInfo,
  ModelConfig,
  WizardState,
  ModelSettingsApplyResult,
  ModelSettingsLoadResult,
  VoiceSettingsLoadResult,
  VoiceSettingsApplyResult,
  VoiceTestResult,
  AgentListEntry,
} from '../../shared/types.js'
import type { PortCheckResult } from '../utils/port-check.js'
import { testModelConnection } from '../wizard/model-tester.js'
import { testTelegramConnection } from '../wizard/telegram-tester.js'
import {
  API_KEY_PROVIDER_SET,
  handleWizardCompleteSetup,
  mergeModelIntoOpenClawConfig,
  sanitizeWizardState,
  writeAuthCredentialsForModelState,
  type ModelSettingsTarget,
} from '../wizard/setup-handler.js'
import { inferModelConfigFromOpenClaw, listAgentSummariesFromConfig } from '../wizard/model-settings-load.js'
import { testVoiceConnection } from '../wizard/voice-tester.js'
import fs from 'node:fs'
import path from 'node:path'
import type { ModelsViewResult } from '../../shared/types.js'
import { LOCAL_MODEL_PRESETS, modelsDir, testLocalEngineChat, LOCAL_ENGINE_PORT, type LocalEngineTestResult } from '../models/local-engine.js'
import { DEFAULT_GATEWAY_PORT } from '../../shared/constants.js'
import {
  IPC_GATEWAY_START,
  IPC_GATEWAY_STOP,
  IPC_GATEWAY_RESTART,
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
  IPC_AGENTS_ADD,
  IPC_AGENTS_SET_MODEL,
  IPC_AGENTS_REMOVE,
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
  IPC_TTS_LOAD,
  IPC_TTS_APPLY,
  IPC_TTS_TEST,
  IPC_TTS_VOICES,
  IPC_TTS_INSTALL,
  IPC_STT_LOAD,
  IPC_STT_APPLY,
  IPC_STT_INSTALL,
  IPC_STT_TRANSCRIBE,
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
  IPC_LOGS_TAIL,
  IPC_BACKUP_CREATE,
  IPC_BACKUP_VERIFY,
} from '../../shared/ipc-channels.js'
import { runPrestartCheck, exportDiagnostics, runDiagnostics, getDiagnosticsSummary } from '../diagnostics/index.js'
import {
  checkForUpdates,
  verifyBundle,
  getPrestartCheckForFrontend,
  downloadUpdate,
  cancelDownload,
  installShellUpdateWithBackup,
  readAndConsumePostUpdateResult,
} from '../update/index.js'
import {
  listAuthProfiles,
  saveAuthProfile,
  saveAuthProfileToken,
  deleteAuthProfile,
  exportAuthProfiles,
  importAuthProfiles,
  getProvidersSummary,
  saveProviderConfig,
  setModelDefaults,
  setModelAliases,
  addProfileToAuthOrder,
  removeProfileFromAuthOrder,
  normalizeAuthOrderEntry,
} from '../providers/index.js'
import { listSkillsWithProxy } from '../skills/index.js'
import { listModelsWithProxy } from '../models/index.js'
import {
  listPluginsWithCli,
  togglePlugin,
  installPlugin,
  uninstallPlugin,
} from '../plugins/index.js'
import {
  listExtensions,
  toggleSkill,
  toggleExtension,
  exportRegistry,
  importRegistry,
  validateRegistryItem,
} from '../registry/index.js'
import { tailLogsWithGateway } from '../logs/index.js'
import { logError, logWarn } from '../utils/logger.js'
import { getLogAggregator } from '../diagnostics/log-aggregator.js'
import { runBackupCreateCli, runBackupVerifyCli } from '../backup/index.js'
import { syncLoginItemToSystem } from '../login-item/index.js'
import { runConfigValidate, readOpenClawConfig } from '../config/index.js'
import {
  buildModelsView,
  applyModelsPriority,
  restoreConfigBackup,
} from '../models/models-view.js'
import { sendTextChat } from '../models/text-chat.js'
import {
  edgeListVoices,
  edgeSynthesize,
  elevenListVoices,
  elevenSynthesize,
  piperSynthesize,
  piperStatus,
  installPiper,
  installWhisper,
  whisperStatus,
  whisperTranscribe,
  setVoiceProgressHandler,
  PIPER_VOICES,
  WHISPER_MODELS,
  type TtsProvider,
  type PiperVoiceKey,
  type WhisperModelId,
} from '../voice/voice.js'
import {
  listLocalModels,
  getEngineState,
  startLocalEngine,
  stopLocalEngine,
  downloadLocalModel,
  cancelLocalDownload,
  setLocalProgressSender,
  getLocalEngineRuntimeState,
  setLocalEngineMode,
  installEngineVariant,
} from '../models/local-engine.js'
export interface IpcResult<T = unknown> {
  success: boolean
  data?: T
  error?: { code: string; message: string }
}

export interface IpcHandlerDeps {
  gatewayManager: GatewayProcessManager
  readOpenClawConfig: () => OpenClawConfig
  writeOpenClawConfig: (config: OpenClawConfig) => void
  openclawConfigExists: () => boolean
  readShellConfig: () => ShellConfig
  writeShellConfig: (config: ShellConfig) => void
  checkPort: (port: number) => Promise<PortCheckResult>
  getUserDataDir: () => string
  getBundledOpenClawPath?: () => string
  getVersions: () => AppVersionInfo
  resizeMainWindow?: (width: number, height: number, center?: boolean) => void
  /** Resize window for main shell (may grow beyond current size) */
  resizeForMainInterface?: () => void
  /** Sync native window title from renderer */
  setMainWindowTitle?: (title: string) => void
  /** Rebuild tray menu (e.g. after ShellConfig.locale change) */
  refreshTrayMenu?: () => void
  /** Send an event to the renderer (progress events etc.) */
  sendToRenderer?: (channel: string, ...args: unknown[]) => void
}

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(code: string, message: string): IpcResult<never> {
  return { success: false, error: { code, message } }
}

type AsyncHandler = (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<IpcResult>

function safelog(method: 'error' | 'warn' | 'info', ...args: unknown[]): void {
  try { console[method](...args) } catch { /* EPIPE — pipe closed, ignore */ }
}

function wrapHandler(code: string, fn: (...args: unknown[]) => Promise<unknown> | unknown): AsyncHandler {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcResult> => {
    try {
      const result = await fn(...args)
      return ok(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      safelog('error', `[ipc] ${code} handler error:`, message)
      return fail(code, message)
    }
  }
}

const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:'])

function validateExternalUrl(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('URL must be a non-empty string')
  }
  const parsed = new URL(url)
  if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Protocol "${parsed.protocol}" is not allowed; only http/https permitted`)
  }
  return url
}

function validatePlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a non-null object`)
  }
  return value as Record<string, unknown>
}

function parseModelConfigPayload(raw: Record<string, unknown>): ModelConfig {
  return {
    provider: raw.provider as ModelConfig['provider'],
    apiKey: String(raw.apiKey ?? ''),
    modelId: String(raw.modelId ?? ''),
    moonshotRegion: raw.moonshotRegion === 'cn' ? 'cn' : raw.moonshotRegion === 'global' ? 'global' : undefined,
    customProviderId: typeof raw.customProviderId === 'string' ? raw.customProviderId : undefined,
    customBaseUrl: typeof raw.customBaseUrl === 'string' ? raw.customBaseUrl : undefined,
    openrouterBaseUrl: typeof raw.openrouterBaseUrl === 'string' ? raw.openrouterBaseUrl : undefined,
    cloudflareAccountId: typeof raw.cloudflareAccountId === 'string' ? raw.cloudflareAccountId : undefined,
    cloudflareGatewayId: typeof raw.cloudflareGatewayId === 'string' ? raw.cloudflareGatewayId : undefined,
    customCompatibility:
      raw.customCompatibility === 'anthropic'
        ? 'anthropic'
        : raw.customCompatibility === 'openai'
          ? 'openai'
          : undefined,
    reasoningLevel:
      raw.reasoningLevel === 'off' ||
      raw.reasoningLevel === 'minimum' ||
      raw.reasoningLevel === 'medium' ||
      raw.reasoningLevel === 'high'
        ? raw.reasoningLevel
        : undefined,
  }
}

function wizardStateForModelConfig(modelConfig: ModelConfig): WizardState {
  return {
    currentStep: 0,
    modelConfig,
    channelConfig: {
      telegram: null,
      discord: null,
      slack: null,
      whatsapp: null,
      selectedChannel: 'webchat',
      skipChannels: true,
    },
    gatewayConfig: {
      port: 18789,
      bind: 'loopback',
      authToken: '',
    },
    voiceConfig: {
      provider: 'google',
      apiKey: '',
      skipVoice: true,
    },
  }
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const { gatewayManager } = deps

  ipcMain.handle(
    IPC_GATEWAY_START,
    wrapHandler('GATEWAY_START', () => {
      const config = deps.readOpenClawConfig()
      const gw = config?.gateway
      const port = gw?.port ?? DEFAULT_GATEWAY_PORT
      const bind = gw?.bind ?? 'loopback'
      const token = gw?.auth?.token?.trim()
      const force = Boolean(gw?.forcePortOnConflict)
      return gatewayManager.start({ port, bind, token: token || undefined, force })
    }),
  )

  ipcMain.handle(
    IPC_GATEWAY_STOP,
    wrapHandler('GATEWAY_STOP', () => gatewayManager.stop()),
  )

  ipcMain.handle(
    IPC_GATEWAY_RESTART,
    wrapHandler('GATEWAY_RESTART', () => {
      const config = deps.readOpenClawConfig()
      const gw = config?.gateway
      const port = gw?.port ?? DEFAULT_GATEWAY_PORT
      const bind = gw?.bind ?? 'loopback'
      const token = gw?.auth?.token?.trim()
      const force = Boolean(gw?.forcePortOnConflict)
      return gatewayManager.restart({ port, bind, token: token || undefined, force })
    }),
  )

  ipcMain.handle(
    IPC_GATEWAY_STATUS,
    wrapHandler('GATEWAY_STATUS', () => gatewayManager.getStatus()),
  )

  ipcMain.handle(
    IPC_CONFIG_READ,
    wrapHandler('CONFIG_READ', () => deps.readOpenClawConfig()),
  )

  ipcMain.handle(
    IPC_CONFIG_WRITE,
    wrapHandler('CONFIG_WRITE', (config: unknown) => {
      const validated = validatePlainObject(config, 'config')
      deps.writeOpenClawConfig(validated as OpenClawConfig)
      readOpenClawConfig()
    }),
  )

  ipcMain.handle(
    IPC_CONFIG_EXISTS,
    wrapHandler('CONFIG_EXISTS', () => deps.openclawConfigExists()),
  )

  ipcMain.handle(
    IPC_CONFIG_VALIDATE,
    wrapHandler('CONFIG_VALIDATE', () => runConfigValidate()),
  )

  ipcMain.handle(
    IPC_SHELL_GET_CONFIG,
    wrapHandler('SHELL_GET_CONFIG', () => deps.readShellConfig()),
  )

  ipcMain.handle(
    IPC_SHELL_SET_CONFIG,
    wrapHandler('SHELL_SET_CONFIG', (partial: unknown) => {
      const patch = validatePlainObject(partial, 'shellConfig')
      const current = deps.readShellConfig()
      const merged: ShellConfig = { ...current, ...patch } as ShellConfig
      deps.writeShellConfig(merged)
      if ('theme' in patch) {
        // Keep prefers-color-scheme in sync so the embedded Control UI
        // (theme mode: system) follows the shell theme.
        nativeTheme.themeSource = merged.theme === 'dark' ? 'dark' : 'light'
      }
      if ('autoStart' in patch) {
        syncLoginItemToSystem(merged.autoStart)
      }
      if ('locale' in patch) {
        deps.refreshTrayMenu?.()
      }
    }),
  )

  ipcMain.handle(
    IPC_SYSTEM_GET_LOCALE,
    wrapHandler('SYSTEM_GET_LOCALE', () => {
      return app.getLocale()
    }),
  )

  ipcMain.handle(
    IPC_SYSTEM_OPEN_EXTERNAL,
    wrapHandler('SYSTEM_OPEN_EXTERNAL', (url: unknown) => {
      const validUrl = validateExternalUrl(url)
      return shell.openExternal(validUrl)
    }),
  )

  ipcMain.handle(
    IPC_SYSTEM_OPEN_PATH,
    wrapHandler('SYSTEM_OPEN_PATH', (targetPath: unknown) => {
      if (typeof targetPath !== 'string' || targetPath.length === 0) {
        throw new Error('Path must be a non-empty string')
      }
      return shell.openPath(targetPath)
    }),
  )

  ipcMain.handle(
    IPC_PORT_CHECK,
    wrapHandler('PORT_CHECK', (port: unknown) => {
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Port must be an integer between 1 and 65535')
      }
      return deps.checkPort(port)
    }),
  )

  ipcMain.handle(
    IPC_WIZARD_TEST_MODEL,
    wrapHandler('WIZARD_TEST_MODEL', (config: unknown) => {
      const raw = validatePlainObject(config, 'modelConfig')
      const cfg: ModelConfig = {
        provider: raw.provider as ModelConfig['provider'],
        apiKey: String(raw.apiKey ?? ''),
        modelId: String(raw.modelId ?? ''),
        moonshotRegion: raw.moonshotRegion === 'cn' ? 'cn' : raw.moonshotRegion === 'global' ? 'global' : undefined,
        customProviderId: typeof raw.customProviderId === 'string' ? raw.customProviderId : undefined,
        customBaseUrl: typeof raw.customBaseUrl === 'string' ? raw.customBaseUrl : undefined,
        openrouterBaseUrl: typeof raw.openrouterBaseUrl === 'string' ? raw.openrouterBaseUrl : undefined,
        cloudflareAccountId: typeof raw.cloudflareAccountId === 'string' ? raw.cloudflareAccountId : undefined,
        cloudflareGatewayId: typeof raw.cloudflareGatewayId === 'string' ? raw.cloudflareGatewayId : undefined,
        customCompatibility:
          raw.customCompatibility === 'anthropic' ? 'anthropic' : raw.customCompatibility === 'openai' ? 'openai' : undefined,
      }
      if (!cfg.provider || !cfg.modelId) {
        throw new Error('modelConfig must include provider and modelId')
      }
      if (cfg.provider !== 'local' && !cfg.apiKey) {
        throw new Error('modelConfig must include apiKey')
      }
      if (cfg.provider === 'custom' && (!cfg.customProviderId || !cfg.customBaseUrl)) {
        throw new Error('custom modelConfig must include customProviderId and customBaseUrl')
      }
      return testModelConnection(cfg)
    }),
  )

  ipcMain.handle(
    IPC_WIZARD_TEST_TELEGRAM,
    wrapHandler('WIZARD_TEST_TELEGRAM', async (config: unknown) => {
      const raw = validatePlainObject(config, 'telegramConfig')
      return testTelegramConnection({
        botToken: typeof raw.botToken === 'string' ? raw.botToken : undefined,
        proxy: typeof raw.proxy === 'string' ? raw.proxy : undefined,
      })
    }),
  )

  ipcMain.handle(
    IPC_TELEGRAM_GET,
    wrapHandler('TELEGRAM_GET', () => {
      const cfg = deps.readOpenClawConfig()
      const tg = cfg?.channels?.telegram
      const shell = deps.readShellConfig()
      return {
        enabled: Boolean(tg?.enabled) || Boolean(tg?.botToken),
        hasToken: Boolean(tg?.botToken),
        allowFrom: Array.isArray(tg?.allowFrom) ? (tg.allowFrom as string[]) : [],
        botName: shell.telegramBotName ?? undefined,
        botUrl: shell.telegramBotUrl ?? undefined,
      }
    }),
  )

  ipcMain.handle(
    IPC_TELEGRAM_SAVE,
    wrapHandler('TELEGRAM_SAVE', async (payload: unknown) => {
      const raw = validatePlainObject(payload, 'telegramSave')
      const botToken = typeof raw.botToken === 'string' ? raw.botToken.trim() : ''
      const botName = typeof raw.botName === 'string' ? raw.botName.trim() : ''
      const botUrl = typeof raw.botUrl === 'string' ? raw.botUrl.trim() : ''

      const cfg = deps.readOpenClawConfig()
      const tg = cfg?.channels?.telegram
      const nextTg: Record<string, unknown> = {
        enabled: true,
        dmPolicy: typeof tg?.dmPolicy === 'string' ? tg.dmPolicy : 'pairing',
      }
      if (botToken) {
        nextTg.botToken = botToken
      } else if (typeof tg?.botToken === 'string' && tg.botToken) {
        nextTg.botToken = tg.botToken
      }
      if (Array.isArray(tg?.allowFrom) && (tg.allowFrom as unknown[]).length > 0) {
        nextTg.allowFrom = tg.allowFrom
      }
      if (typeof tg?.proxy === 'string' && tg.proxy) {
        nextTg.proxy = tg.proxy
      }
      cfg.channels = cfg.channels ?? {}
      cfg.channels.telegram = nextTg
      deps.writeOpenClawConfig(cfg)

      const shell = deps.readShellConfig()
      if (botName) shell.telegramBotName = botName
      if (botUrl) shell.telegramBotUrl = botUrl
      deps.writeShellConfig(shell)

      const gw = cfg.gateway
      const port = gw?.port ?? DEFAULT_GATEWAY_PORT
      const bind = gw?.bind ?? 'loopback'
      const token = gw?.auth?.token?.trim()
      const force = Boolean(gw?.forcePortOnConflict)
      const restarted = await gatewayManager.restart({ port, bind, token: token || undefined, force })
      return { ok: true, restarted }
    }),
  )

  ipcMain.handle(
    IPC_AGENTS_ADD,
    wrapHandler('AGENTS_ADD', (payload: unknown) => {
      const raw = validatePlainObject(payload, 'agentsAdd')
      const name = typeof raw.name === 'string' ? raw.name.trim() : ''
      if (!name) throw new Error('agent name is required')
      const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : undefined

      const cfg = deps.readOpenClawConfig()
      const list = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : []

      // Unique, filesystem-safe id derived from the name.
      let base =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/gi, '-')
          .replace(/^-+|-+$/g, '') || 'agent'
      if (/^[0-9]/.test(base)) base = `agent-${base}`
      const existing = new Set(list.map((a) => String(a?.id ?? '')))
      let id = base
      let n = 2
      while (existing.has(id)) {
        id = `${base}-${n++}`
      }

      const entry: AgentListEntry = { id, name }
      if (model) entry.model = model
      cfg.agents = cfg.agents ?? {}
      cfg.agents.list = [...list, entry]
      deps.writeOpenClawConfig(cfg)
      readOpenClawConfig()
      return { ok: true, id }
    }),
  )

  ipcMain.handle(
    IPC_AGENTS_SET_MODEL,
    wrapHandler('AGENTS_SET_MODEL', (payload: unknown) => {
      const raw = validatePlainObject(payload, 'agentsSetModel')
      const agentId = typeof raw.agentId === 'string' ? raw.agentId.trim() : ''
      const model = typeof raw.model === 'string' ? raw.model.trim() : ''
      if (!agentId) throw new Error('agentId is required')
      if (!model) throw new Error('model is required')

      const cfg = deps.readOpenClawConfig()
      const list = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : []
      const entry = list.find((a) => String(a?.id ?? '') === agentId)
      if (!entry) throw new Error(`agent "${agentId}" not found in agents.list`)
      entry.model = model
      cfg.agents = cfg.agents ?? {}
      cfg.agents.list = list
      deps.writeOpenClawConfig(cfg)
      readOpenClawConfig()
      return { ok: true }
    }),
  )

  ipcMain.handle(
    IPC_AGENTS_REMOVE,
    wrapHandler('AGENTS_REMOVE', (payload: unknown) => {
      const raw = validatePlainObject(payload, 'agentsRemove')
      const agentId = typeof raw.agentId === 'string' ? raw.agentId.trim() : ''
      if (!agentId) throw new Error('agentId is required')
      if (agentId === 'main') {
        throw new Error('нельзя удалить основного агента (main)')
      }

      const cfg = deps.readOpenClawConfig()
      const list = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : []
      const exists = list.some((a) => String(a?.id ?? '') === agentId)
      if (!exists) throw new Error(`agent "${agentId}" not found in agents.list`)

      // 1. Drop the agent from the config.
      cfg.agents = cfg.agents ?? {}
      cfg.agents.list = list.filter((a) => String(a?.id ?? '') !== agentId)
      deps.writeOpenClawConfig(cfg)
      readOpenClawConfig()

      // 2. Delete the agent state dir (chats = sessions/, auth profiles, etc.).
      //    Node fs handles non-ASCII paths natively (UTF-16) — no CLI involved.
      const agentDir = path.join(deps.getUserDataDir(), 'agents', agentId)
      try {
        if (fs.existsSync(agentDir)) {
          fs.rmSync(agentDir, { recursive: true, force: true })
        }
      } catch (err) {
        logWarn(`[AGENTS_REMOVE] failed to delete agent dir ${agentDir}: ${String(err)}`)
      }

      // 3. Restart the gateway so it forgets the agent (in-memory sessions).
      const gw = cfg.gateway
      const port = gw?.port ?? DEFAULT_GATEWAY_PORT
      const bind = gw?.bind ?? 'loopback'
      const token = gw?.auth?.token?.trim()
      const force = Boolean(gw?.forcePortOnConflict)
      void gatewayManager.restart({ port, bind, token: token || undefined, force })

      return { ok: true }
    }),
  )

  ipcMain.handle(
    IPC_WIZARD_COMPLETE_SETUP,
    wrapHandler('WIZARD_COMPLETE_SETUP', async (state: unknown) => {
      const raw = validatePlainObject(state, 'wizardState')
      if (!raw.modelConfig || !raw.gatewayConfig || !raw.channelConfig) {
        throw new Error('wizardState must include modelConfig, gatewayConfig, and channelConfig')
      }
      const ws = raw as unknown as WizardState
      const result = await handleWizardCompleteSetup(ws, {
        writeOpenClawConfig: deps.writeOpenClawConfig,
        readShellConfig: deps.readShellConfig,
        writeShellConfig: deps.writeShellConfig,
        gatewayManager: deps.gatewayManager,
      })
      return result
    }),
  )

  ipcMain.handle(
    IPC_SYSTEM_OPEN_LOG_DIR,
    wrapHandler('SYSTEM_OPEN_LOG_DIR', () => {
      return shell.openPath(deps.getUserDataDir())
    }),
  )

  ipcMain.handle(
    IPC_SHELL_GET_VERSIONS,
    wrapHandler('SHELL_GET_VERSIONS', () => deps.getVersions()),
  )

  ipcMain.handle(
    IPC_SHELL_RESIZE_FOR_MAIN_INTERFACE,
    wrapHandler('SHELL_RESIZE_FOR_MAIN_INTERFACE', () => {
      deps.resizeForMainInterface?.()
    }),
  )

  ipcMain.handle(
    IPC_SHELL_SET_WINDOW_TITLE,
    wrapHandler('SHELL_SET_WINDOW_TITLE', (title: unknown) => {
      if (typeof title !== 'string') throw new Error('title must be a string')
      deps.setMainWindowTitle?.(title)
    }),
  )

  ipcMain.handle(
    IPC_SESSIONS_LIST,
    wrapHandler('SESSIONS_LIST', async (): Promise<unknown[]> => {
      const { createGatewayRpcClientFromConfig } = await import('../gateway/rpc-client.js')
      const client = await createGatewayRpcClientFromConfig()
      try {
        const res = (await client.request('sessions.list', { limit: 20 })) as
          | { sessions?: unknown[] }
          | unknown[]
          | null
        if (Array.isArray(res)) return res
        return (res as { sessions?: unknown[] })?.sessions ?? []
      } finally {
        client.close()
      }
    }),
  )

  ipcMain.handle(
    IPC_DIAGNOSTICS_EXPORT,
    wrapHandler('DIAGNOSTICS_EXPORT', async () => {
      const prestartCheck = runPrestartCheck()
      const doctorReport = await runDiagnostics({
        readOpenClawConfig: deps.readOpenClawConfig,
        readShellConfig: deps.readShellConfig,
        gatewayStatus: () => gatewayManager.getStatus(),
      })
      return exportDiagnostics({
        versions: deps.getVersions(),
        openclawConfig: deps.readOpenClawConfig(),
        shellConfig: deps.readShellConfig(),
        prestartCheck,
        doctorReport,
      })
    }),
  )

  ipcMain.handle(
    IPC_DIAGNOSTICS_RUN,
    wrapHandler('DIAGNOSTICS_RUN', async () => {
      return runDiagnostics({
        readOpenClawConfig: deps.readOpenClawConfig,
        readShellConfig: deps.readShellConfig,
        gatewayStatus: () => gatewayManager.getStatus(),
      })
    }),
  )

  ipcMain.handle(
    IPC_DIAGNOSTICS_SUMMARY,
    wrapHandler('DIAGNOSTICS_SUMMARY', async () => {
      const report = await runDiagnostics({
        readOpenClawConfig: deps.readOpenClawConfig,
        readShellConfig: deps.readShellConfig,
        gatewayStatus: () => gatewayManager.getStatus(),
      })
      return getDiagnosticsSummary(report)
    }),
  )

  // ─── Provider / auth profile ───────────────────────────────────────────────
  ipcMain.handle(
    IPC_PROVIDERS_LIST,
    wrapHandler('PROVIDERS_LIST', () => {
      const profiles = listAuthProfiles(true)
      const config = deps.readOpenClawConfig()
      return getProvidersSummary(config, profiles.map((p) => ({
        profileId: p.profileId,
        provider: p.provider,
        hasKey: p.hasKey,
      })))
    }),
  )

  ipcMain.handle(
    IPC_PROVIDERS_SAVE_PROFILE,
    wrapHandler('PROVIDERS_SAVE_PROFILE', (opts: unknown) => {
      const raw = validatePlainObject(opts, 'saveProfile opts')
      const profileId = String(raw.profileId ?? '')
      const provider = String(raw.provider ?? '')
      const credType = raw.type === 'token' ? 'token' : 'api_key'
      if (!profileId || !provider) {
        throw new Error('profileId and provider are required')
      }
      const canonicalProfileId = normalizeAuthOrderEntry(provider, profileId)
      let secret: string
      let mode: 'api_key' | 'token'
      if (credType === 'token') {
        const token = String(raw.token ?? '')
        if (!token) throw new Error('token is required for type: token')
        saveAuthProfileToken(canonicalProfileId, provider, token)
        secret = token
        mode = 'token'
      } else {
        const apiKey = String(raw.apiKey ?? '').trim()
        if (!apiKey) throw new Error('apiKey is required for type: api_key')
        // Must match OpenClaw auth.order (full ids like openai:default); shorthand "default" alone
        // would leave credentials under the wrong key while order points at provider:default → HTTP 401.
        saveAuthProfile(canonicalProfileId, provider, apiKey)
        secret = apiKey
        mode = 'api_key'
      }
      const config = deps.readOpenClawConfig()
      const next = addProfileToAuthOrder(config, provider, canonicalProfileId)
      // Persist the secret in the static profile (openclaw.json) as well:
      // subagents only inherit portable static auth profiles from the main agentDir;
      // keys kept solely in auth-profiles.json are invisible to them (missing-provider-auth).
      next.auth = next.auth ?? {}
      next.auth.profiles = next.auth.profiles ?? {}
      next.auth.profiles[canonicalProfileId] = {
        ...(next.auth.profiles[canonicalProfileId] ?? {}),
        provider,
        mode,
        ...(mode === 'token' ? { token: secret } : { apiKey: secret }),
      }
      deps.writeOpenClawConfig(next)
    }),
  )

  ipcMain.handle(
    IPC_PROVIDERS_DELETE_PROFILE,
    wrapHandler('PROVIDERS_DELETE_PROFILE', (opts: unknown) => {
      const raw = validatePlainObject(opts, 'deleteProfile opts')
      const profileIdRaw = String(raw.profileId ?? '').trim()
      if (!profileIdRaw) throw new Error('profileId is required')
      const providerHint = String(raw.provider ?? '').trim()
      let canonicalId: string
      let authOrderProviderId: string
      if (profileIdRaw.includes(':')) {
        authOrderProviderId = profileIdRaw.split(':')[0]!
        canonicalId = normalizeAuthOrderEntry(authOrderProviderId, profileIdRaw)
      } else if (providerHint) {
        authOrderProviderId = providerHint
        canonicalId = normalizeAuthOrderEntry(providerHint, profileIdRaw)
      } else {
        canonicalId = profileIdRaw
        authOrderProviderId = profileIdRaw
      }
      deleteAuthProfile(canonicalId)
      const config = deps.readOpenClawConfig()
      const next = removeProfileFromAuthOrder(config, authOrderProviderId, canonicalId)
      deps.writeOpenClawConfig(next)
    }),
  )

  ipcMain.handle(
    IPC_PROVIDERS_TEST,
    wrapHandler('PROVIDERS_TEST', (config: unknown) => {
      const raw = validatePlainObject(config, 'modelConfig')
      const cfg: ModelConfig = {
        provider: raw.provider as ModelConfig['provider'],
        apiKey: String(raw.apiKey ?? ''),
        modelId: String(raw.modelId ?? ''),
        moonshotRegion: raw.moonshotRegion === 'cn' ? 'cn' : raw.moonshotRegion === 'global' ? 'global' : undefined,
        customProviderId: typeof raw.customProviderId === 'string' ? raw.customProviderId : undefined,
        customBaseUrl: typeof raw.customBaseUrl === 'string' ? raw.customBaseUrl : undefined,
        openrouterBaseUrl: typeof raw.openrouterBaseUrl === 'string' ? raw.openrouterBaseUrl : undefined,
        cloudflareAccountId: typeof raw.cloudflareAccountId === 'string' ? raw.cloudflareAccountId : undefined,
        cloudflareGatewayId: typeof raw.cloudflareGatewayId === 'string' ? raw.cloudflareGatewayId : undefined,
        customCompatibility:
          raw.customCompatibility === 'anthropic' ? 'anthropic' : raw.customCompatibility === 'openai' ? 'openai' : undefined,
      }
      if (!cfg.provider || !cfg.modelId) {
        throw new Error('modelConfig must include provider and modelId')
      }
      if (cfg.provider !== 'local' && !cfg.apiKey) {
        throw new Error('modelConfig must include apiKey')
      }
      if (cfg.provider === 'custom' && (!cfg.customProviderId || !cfg.customBaseUrl)) {
        throw new Error('custom modelConfig must include customProviderId and customBaseUrl')
      }
      return testModelConnection(cfg)
    }),
  )

  ipcMain.handle(
    IPC_PROVIDERS_EXPORT,
    wrapHandler('PROVIDERS_EXPORT', (opts?: unknown) => {
      const raw = opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as Record<string, unknown>)
        : {}
      return exportAuthProfiles({ maskKeys: raw.maskKeys !== false })
    }),
  )

  ipcMain.handle(
    IPC_PROVIDERS_IMPORT,
    wrapHandler('PROVIDERS_IMPORT', (json: unknown) => {
      if (typeof json !== 'string') throw new Error('json must be a string')
      return importAuthProfiles(json)
    }),
  )

  ipcMain.handle(
    IPC_PROVIDERS_SAVE_CONFIG,
    wrapHandler('PROVIDERS_SAVE_CONFIG', (opts: unknown) => {
      const raw = validatePlainObject(opts, 'saveProviderConfig opts')
      const providerId = String(raw.providerId ?? '')
      const config = validatePlainObject(raw.config, 'provider config')
      if (!providerId) throw new Error('providerId is required')
      const current = deps.readOpenClawConfig()
      const next = saveProviderConfig(current, providerId, config)
      deps.writeOpenClawConfig(next)
      readOpenClawConfig()
    }),
  )

  ipcMain.handle(
    IPC_PROVIDERS_SET_MODEL_DEFAULTS,
    wrapHandler('PROVIDERS_SET_MODEL_DEFAULTS', (opts?: unknown) => {
      const raw = opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as Record<string, unknown>)
        : {}
      const primary = typeof raw.primary === 'string' ? raw.primary : undefined
      const fallbacks = Array.isArray(raw.fallbacks)
        ? (raw.fallbacks as unknown[]).filter((x): x is string => typeof x === 'string')
        : undefined
      const current = deps.readOpenClawConfig()
      const next = setModelDefaults(current, { primary, fallbacks })
      deps.writeOpenClawConfig(next)
    }),
  )

  ipcMain.handle(
    IPC_MODEL_SETTINGS_LOAD,
    wrapHandler('MODEL_SETTINGS_LOAD', (): ModelSettingsLoadResult => {
      if (!deps.openclawConfigExists()) {
        return {
          hasConfig: false,
          modelConfig: inferModelConfigFromOpenClaw({}),
          agents: [],
        }
      }
      const config = deps.readOpenClawConfig() ?? {}
      const dm = config.agents?.defaults?.model
      const defaultPrimaryDisplay =
        typeof dm === 'string' ? dm : dm && typeof dm === 'object' ? (dm as { primary?: string }).primary : undefined
      return {
        hasConfig: true,
        modelConfig: inferModelConfigFromOpenClaw(config),
        agents: listAgentSummariesFromConfig(config),
        defaultPrimaryDisplay,
      }
    }),
  )

  ipcMain.handle(
    IPC_MODEL_SETTINGS_APPLY,
    wrapHandler('MODEL_SETTINGS_APPLY', async (payload: unknown): Promise<ModelSettingsApplyResult> => {
      const raw = validatePlainObject(payload, 'modelSettingsApply')
      const restartGateway = raw.restartGateway === true
      const modelRaw = validatePlainObject(raw.modelConfig, 'modelConfig')
      const cfg = parseModelConfigPayload(modelRaw)
      if (!cfg.modelId.trim()) {
        throw new Error('modelId is required')
      }
      if (cfg.provider === 'custom') {
        if (!cfg.customProviderId?.trim() || !cfg.customBaseUrl?.trim()) {
          throw new Error('Custom provider requires provider ID and API base URL')
        }
      }
      if (cfg.provider === 'cloudflare-ai-gateway') {
        if (!cfg.cloudflareAccountId?.trim() || !cfg.cloudflareGatewayId?.trim()) {
          throw new Error('Cloudflare AI Gateway requires Account ID and Gateway ID')
        }
      }
      // v0.8.25: empty API key for a key-auth provider used to "save" fine
      // while producing a config that references a non-existent auth profile
      // → gateway restarts, every model call 401, UI shows success. Reject
      // loudly instead (renderer now also blocks Save for the same case).
      if (
        cfg.provider !== 'custom' &&
        (API_KEY_PROVIDER_SET.has(cfg.provider) || cfg.provider === 'moonshot-cn') &&
        !cfg.apiKey.trim()
      ) {
        throw new Error('API Key is required for this provider')
      }
      const targetRaw = raw.target
      if (!targetRaw || typeof targetRaw !== 'object' || Array.isArray(targetRaw)) {
        throw new Error('target is required')
      }
      const tr = targetRaw as Record<string, unknown>
      let target: ModelSettingsTarget
      if (tr.kind === 'defaults') {
        target = { kind: 'defaults' }
      } else if (tr.kind === 'agent' && typeof tr.agentId === 'string' && tr.agentId.trim()) {
        target = { kind: 'agent', agentId: tr.agentId.trim() }
      } else {
        throw new Error('target must be { kind: "defaults" } or { kind: "agent", agentId }')
      }

      const state = wizardStateForModelConfig(cfg)
      const base = deps.readOpenClawConfig() ?? {}
      const merged = mergeModelIntoOpenClawConfig(base, state, target)
      deps.writeOpenClawConfig(merged)
      readOpenClawConfig()

      const sanitized = sanitizeWizardState(state)
      const cred = writeAuthCredentialsForModelState(sanitized)
      if (!cred.ok) {
        throw new Error(cred.error)
      }

      const validationResult = await runConfigValidate()
      const isEnvLimit = validationResult.issues.some(
        (i) =>
          i.path.startsWith('__') &&
          (i.path.includes('bundle') || i.path.includes('spawn') || i.path.includes('timeout')),
      )
      const validationIssues =
        !validationResult.valid && !isEnvLimit
          ? validationResult.issues.map((i) => ({ path: i.path, message: i.message }))
          : undefined

      let restarted = false
      if (restartGateway) {
        const gwCfg = deps.readOpenClawConfig()
        const gw = gwCfg?.gateway
        const port = gw?.port ?? DEFAULT_GATEWAY_PORT
        const bind = gw?.bind ?? 'loopback'
        const token = gw?.auth?.token?.trim()
        const force = Boolean(gw?.forcePortOnConflict)
        await gatewayManager.restart({ port, bind, token: token || undefined, force })
        restarted = true
      }

      return {
        ok: true,
        restarted,
        ...(validationIssues && validationIssues.length ? { validationIssues } : {}),
      }
    }),
  )

  // ─── Voice (talk.realtime) settings ─────────────────────────────────────
  ipcMain.handle(
    IPC_VOICE_SETTINGS_LOAD,
    wrapHandler('VOICE_SETTINGS_LOAD', (): VoiceSettingsLoadResult => {
      if (!deps.openclawConfigExists()) {
        return { hasConfig: false, enabled: false, provider: '', hasKey: false }
      }
      const config = deps.readOpenClawConfig() ?? {}
      const talk = config.talk
      const realtime = talk?.realtime
      const provider =
        typeof realtime?.provider === 'string' &&
        (realtime.provider === 'google' || realtime.provider === 'openai')
          ? realtime.provider
          : ''
      const providers =
        realtime?.providers && typeof realtime.providers === 'object'
          ? (realtime.providers as Record<string, { apiKey?: unknown; model?: unknown; speakerVoice?: unknown }>)
          : {}
      const pcfg = provider ? providers[provider] : undefined
      const hasKey = Boolean(pcfg?.apiKey && typeof pcfg.apiKey === 'string' && pcfg.apiKey.trim())
      return {
        hasConfig: true,
        enabled: Boolean(provider),
        provider,
        hasKey,
        ...(pcfg?.model && typeof pcfg.model === 'string' ? { model: pcfg.model } : {}),
        ...(pcfg?.speakerVoice && typeof pcfg.speakerVoice === 'string' ? { voice: pcfg.speakerVoice } : {}),
      }
    }),
  )

  ipcMain.handle(
    IPC_VOICE_SETTINGS_APPLY,
    wrapHandler('VOICE_SETTINGS_APPLY', async (payload: unknown): Promise<VoiceSettingsApplyResult> => {
      const raw = validatePlainObject(payload, 'voiceSettingsApply')
      const provider = raw.provider
      if (provider !== 'google' && provider !== 'openai') {
        throw new Error('provider must be "google" or "openai"')
      }
      // apiKey: string (set/keep) | null (remove & disable) | undefined (keep)
      let apiKey: string | null | undefined
      if (raw.apiKey === null) {
        apiKey = null
      } else if (typeof raw.apiKey === 'string') {
        apiKey = raw.apiKey.trim()
      }
      const restartGateway = raw.restartGateway === true

      const base = deps.openclawConfigExists() ? (deps.readOpenClawConfig() ?? {}) : {}
      const config = JSON.parse(JSON.stringify(base)) as OpenClawConfig
      const talk = { ...(config.talk ?? {}) } as NonNullable<OpenClawConfig['talk']>
      const realtime = {
        ...(talk.realtime ?? {}),
      } as NonNullable<NonNullable<OpenClawConfig['talk']>['realtime']>
      const providers =
        realtime.providers && typeof realtime.providers === 'object'
          ? (realtime.providers as Record<string, Record<string, unknown>>)
          : {}
      const pcfg = { ...(providers[provider] ?? {}) }

      if (apiKey === null) {
        // Remove the provider key and disable voice entirely
        delete pcfg.apiKey
        if (Object.keys(pcfg).length === 0) delete providers[provider]
        else providers[provider] = pcfg
        delete realtime.provider
      } else {
        if (apiKey) pcfg.apiKey = apiKey
        providers[provider] = pcfg
        realtime.provider = provider
        if (provider === 'google') {
          if (typeof pcfg.model !== 'string' || !pcfg.model) {
            pcfg.model = 'gemini-2.5-flash-native-audio-preview-12-2025'
          }
          if (typeof pcfg.speakerVoice !== 'string' || !pcfg.speakerVoice) {
            pcfg.speakerVoice = 'Kore'
          }
        }
      }

      realtime.providers = providers
      talk.realtime = realtime
      config.talk = talk
      deps.writeOpenClawConfig(config)
      readOpenClawConfig()

      let restarted = false
      if (restartGateway) {
        const gwCfg = deps.readOpenClawConfig()
        const gw = gwCfg?.gateway
        const port = gw?.port ?? DEFAULT_GATEWAY_PORT
        const bind = gw?.bind ?? 'loopback'
        const token = gw?.auth?.token?.trim()
        const force = Boolean(gw?.forcePortOnConflict)
        await gatewayManager.restart({ port, bind, token: token || undefined, force })
        restarted = true
      }

      return { ok: true, restarted }
    }),
  )

  ipcMain.handle(
    IPC_VOICE_TEST,
    wrapHandler('VOICE_TEST', async (payload: unknown): Promise<VoiceTestResult> => {
      const raw = validatePlainObject(payload, 'voiceTest')
      const provider = raw.provider
      if (provider !== 'google' && provider !== 'openai') {
        throw new Error('provider must be "google" or "openai"')
      }
      const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : ''
      return testVoiceConnection(provider, apiKey)
    }),
  )

  // ─── TTS (Этап F, v0.9.13) ────────────────────────────────────────────────

  const readTts = () => deps.readShellConfig().tts ?? { enabled: false, provider: 'edge' }

  ipcMain.handle(
    IPC_TTS_LOAD,
    wrapHandler('TTS_LOAD', () => {
      const tts = readTts()
      const piper = piperStatus()
      return {
        enabled: Boolean(tts.enabled),
        provider: (tts.provider === 'elevenlabs' || tts.provider === 'piper' ? tts.provider : 'edge') as TtsProvider,
        voice: typeof tts.voice === 'string' ? tts.voice : '',
        hasKey: Boolean(tts.apiKey && typeof tts.apiKey === 'string' && tts.apiKey.trim()),
        piper: { installed: piper.installed, voiceInstalled: piper.voiceInstalled },
      }
    }),
  )

  ipcMain.handle(
    IPC_TTS_APPLY,
    wrapHandler('TTS_APPLY', (payload: unknown) => {
      const raw = validatePlainObject(payload, 'tts:apply')
      const shell = deps.readShellConfig()
      const current = shell.tts ?? { enabled: false, provider: 'edge' as TtsProvider }
      const next: NonNullable<ShellConfig['tts']> = { ...current }
      if (typeof raw.enabled === 'boolean') next.enabled = raw.enabled
      if (raw.provider === 'edge' || raw.provider === 'elevenlabs' || raw.provider === 'piper') {
        next.provider = raw.provider as TtsProvider
      }
      if (typeof raw.voice === 'string') next.voice = raw.voice
      if (raw.apiKey === null) {
        delete next.apiKey
      } else if (typeof raw.apiKey === 'string') {
        const key = raw.apiKey.trim()
        if (key) next.apiKey = key
        else delete next.apiKey
      }
      deps.writeShellConfig({ ...shell, tts: next })
      return { ok: true }
    }),
  )

  ipcMain.handle(
    IPC_TTS_TEST,
    wrapHandler('TTS_TEST', async () => {
      const tts = readTts()
      const provider = tts.provider === 'elevenlabs' || tts.provider === 'piper' ? tts.provider : 'edge'
      try {
        if (provider === 'piper') {
          const voiceKey: PiperVoiceKey =
            tts.voice === 'dmitri' || tts.voice === 'denis' ? (tts.voice as PiperVoiceKey) : 'irina'
          const r = await piperSynthesize('Привет! Это проверка голоса.', voiceKey)
          return { ok: true, mime: r.mime, audioBase64: r.data.toString('base64') }
        }
        if (provider === 'elevenlabs') {
          if (!tts.apiKey) return { ok: false, error: 'Введите API-ключ ElevenLabs' }
          const r = await elevenSynthesize('Привет! Это проверка голоса.', tts.voice || '', tts.apiKey)
          return { ok: true, mime: r.mime, audioBase64: r.data.toString('base64') }
        }
        const r = await edgeSynthesize('Привет! Это проверка голоса.', tts.voice || 'ru-RU-SvetlanaNeural')
        return { ok: true, mime: r.mime, audioBase64: r.data.toString('base64') }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }),
  )

  ipcMain.handle(
    IPC_TTS_VOICES,
    wrapHandler('TTS_VOICES', async (payload: unknown) => {
      const raw = validatePlainObject(payload, 'tts:voices')
      const provider = raw.provider === 'elevenlabs' || raw.provider === 'piper' ? raw.provider : 'edge'
      if (provider === 'piper') {
        return { ok: true, voices: Object.entries(PIPER_VOICES).map(([id, v]) => ({ id, name: v.name })) }
      }
      if (provider === 'elevenlabs') {
        const key = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : ''
        if (!key) return { ok: false, error: 'Введите API-ключ ElevenLabs' }
        const voices = await elevenListVoices(key)
        return { ok: true, voices }
      }
      const voices = (await edgeListVoices()).map((v) => ({ id: v.ShortName, name: `${v.FriendlyName} (${v.Locale})` }))
      return { ok: true, voices }
    }),
  )

  ipcMain.handle(
    IPC_TTS_INSTALL,
    wrapHandler('TTS_INSTALL', async () => {
      await installPiper()
      return { ok: true }
    }),
  )

  // ─── STT (Этап F, v0.9.13) ────────────────────────────────────────────────

  const readStt = () => deps.readShellConfig().stt ?? { enabled: false, model: 'base' }

  ipcMain.handle(
    IPC_STT_LOAD,
    wrapHandler('STT_LOAD', () => {
      const stt = readStt()
      const model: WhisperModelId = stt.model === 'tiny' || stt.model === 'small' || stt.model === 'medium' ? stt.model : 'base'
      const whisper = whisperStatus()
      return {
        enabled: Boolean(stt.enabled),
        model,
        whisper: {
          installed: whisper.installed,
          modelsInstalled: whisper.modelsInstalled,
          models: Object.entries(WHISPER_MODELS).map(([id, m]) => ({ id, name: m.name })),
        },
      }
    }),
  )

  ipcMain.handle(
    IPC_STT_APPLY,
    wrapHandler('STT_APPLY', (payload: unknown) => {
      const raw = validatePlainObject(payload, 'stt:apply')
      const shell = deps.readShellConfig()
      const current = shell.stt ?? { enabled: false, model: 'base' }
      const next: NonNullable<ShellConfig['stt']> = { ...current }
      if (typeof raw.enabled === 'boolean') next.enabled = raw.enabled
      if (raw.model === 'tiny' || raw.model === 'base' || raw.model === 'small' || raw.model === 'medium') {
        next.model = raw.model as WhisperModelId
      }
      deps.writeShellConfig({ ...shell, stt: next })
      return { ok: true }
    }),
  )

  ipcMain.handle(
    IPC_STT_INSTALL,
    wrapHandler('STT_INSTALL', async (payload: unknown) => {
      const raw = validatePlainObject(payload, 'stt:install')
      const model: WhisperModelId =
        raw.model === 'tiny' || raw.model === 'small' || raw.model === 'medium' ? raw.model : 'base'
      await installWhisper(model)
      return { ok: true }
    }),
  )

  ipcMain.handle(
    IPC_STT_TRANSCRIBE,
    wrapHandler('STT_TRANSCRIBE', async (payload: unknown) => {
      const raw = validatePlainObject(payload, 'stt:transcribe')
      const audioBase64 = typeof raw.audioBase64 === 'string' ? raw.audioBase64 : ''
      if (!audioBase64) throw new Error('audioBase64 is required')
      const stt = readStt()
      const model: WhisperModelId = stt.model === 'tiny' || stt.model === 'small' || stt.model === 'medium' ? stt.model : 'base'
      const wavPath = path.join(deps.getUserDataDir(), 'voice', `mic-${Date.now()}.wav`)
      try {
        fs.writeFileSync(wavPath, Buffer.from(audioBase64, 'base64'))
        const text = await whisperTranscribe(wavPath, model)
        return { ok: true, text }
      } finally {
        try {
          fs.unlinkSync(wavPath)
        } catch {
          /* ignore */
        }
      }
    }),
  )

  // ─── Models page (v0.8.7) ────────────────────────────────────────────────
  setLocalProgressSender(deps.sendToRenderer ?? null)
  setVoiceProgressHandler(deps.sendToRenderer ?? null)

  ipcMain.handle(
    IPC_MODELS_VIEW_LIST,
    wrapHandler('MODELS_VIEW_LIST', async (): Promise<ModelsViewResult> => {
      const config = deps.openclawConfigExists() ? (deps.readOpenClawConfig() ?? {}) : {}
      const view = buildModelsView(config)
      view.localModels = listLocalModels(deps.readShellConfig().localModelsOrder)
      view.engineState = getEngineState()
      view.runtime = await getLocalEngineRuntimeState()
      return view
    }),
  )

  ipcMain.handle(
    IPC_MODELS_VIEW_APPLY,
    wrapHandler('MODELS_VIEW_APPLY', async (payload: unknown) => {
      const raw = validatePlainObject(payload, 'models:viewApply')
      const primary = raw.primary === null || raw.primary === undefined ? null : String(raw.primary)
      const fallbacks = Array.isArray(raw.fallbacks)
        ? (raw.fallbacks as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      const restart = raw.restart === true
      const base = deps.openclawConfigExists() ? (deps.readOpenClawConfig() ?? {}) : {}
      const { config: merged, backupPath } = applyModelsPriority(base, primary, fallbacks)
      deps.writeOpenClawConfig(merged)
      readOpenClawConfig()

      let restarted = false
      if (restart && deps.openclawConfigExists()) {
        const gwCfg = deps.readOpenClawConfig()
        const gw = gwCfg?.gateway
        const port = gw?.port ?? DEFAULT_GATEWAY_PORT
        const bind = gw?.bind ?? 'loopback'
        const token = gw?.auth?.token?.trim()
        const force = Boolean(gw?.forcePortOnConflict)
        try {
          await gatewayManager.restart({ port, bind, token: token || undefined, force })
          restarted = true
        } catch (err) {
          // Crash-loop protection: restore the pre-change backup so the app still boots.
          if (backupPath) restoreConfigBackup(backupPath)
          throw err
        }
      }
      return { ok: true, restarted, backupPath }
    }),
  )

  ipcMain.handle(
    IPC_LOCAL_LIST,
    wrapHandler('LOCAL_LIST', () => ({
      localModels: listLocalModels(deps.readShellConfig().localModelsOrder),
      engineState: getEngineState(),
    })),
  )

  ipcMain.handle(
    IPC_LOCAL_ADD,
    wrapHandler('LOCAL_ADD', async (payload: unknown) => {
      const raw = validatePlainObject(payload, 'local:add')
      const presetId = typeof raw.presetId === 'string' ? raw.presetId : undefined
      const url = typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : undefined
      const filePath = typeof raw.path === 'string' && raw.path.trim() ? raw.path.trim() : undefined
      if (presetId) {
        const preset = LOCAL_MODEL_PRESETS.find((p) => p.id === presetId)
        if (!preset) throw new Error(`Unknown local preset: ${presetId}`)
        return { preset }
      }
      if (url) {
        const fileName = url.split('/').pop()?.split('?')[0] ?? ''
        if (!fileName.toLowerCase().endsWith('.gguf')) {
          throw new Error('Custom model URL must point to a .gguf file')
        }
        const custom = {
          id: fileName.replace(/\.gguf$/i, ''),
          fileName,
          url,
          sizeBytes: 0,
          description: 'Custom GGUF',
        }
        // v0.9.0: try to learn the real size (HEAD) so the UI can warn about
        // models below ~12B (smaller than ≈6.5 GB at Q4). Best effort only.
        const size = await probeUrlSize(url)
        if (size > 0) custom.sizeBytes = size
        return { custom }
      }
      // Local file: copy it into the models dir so the engine can load it.
      if (filePath) {
        const fileName = path.basename(filePath)
        if (!fileName.toLowerCase().endsWith('.gguf')) {
          throw new Error('Selected file must be a .gguf model')
        }
        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${fileName}`)
        }
        const destDir = modelsDir()
        fs.mkdirSync(destDir, { recursive: true })
        const dest = path.join(destDir, fileName)
        if (path.resolve(filePath) !== path.resolve(dest)) {
          fs.copyFileSync(filePath, dest)
        }
        let size = 0
        try {
          size = fs.statSync(dest).size
        } catch {
          /* ignore */
        }
        return {
          custom: {
            id: fileName.replace(/\.gguf$/i, ''),
            fileName,
            url: '',
            sizeBytes: size,
            description: 'Local GGUF file',
          },
        }
      }
      throw new Error('Provide presetId, url or path')
    }),
  )

  async function probeUrlSize(url: string): Promise<number> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      try {
        const res = await fetch(url, { method: 'HEAD', signal: controller.signal })
        const len = res.headers.get('content-length')
        if (len) {
          const n = Number.parseInt(len, 10)
          if (Number.isFinite(n) && n > 0) return n
        }
        // Some CDNs (HF) don't answer HEAD — try a ranged GET of 1 byte.
        const res2 = await fetch(url, {
          method: 'GET',
          headers: { range: 'bytes=0-0' },
          signal: controller.signal,
        })
        const cr = res2.headers.get('content-range')
        if (cr) {
          const m = cr.match(/\/(\d+)$/)
          if (m) {
            const n = Number.parseInt(m[1]!, 10)
            if (Number.isFinite(n) && n > 0) return n
          }
        }
        return 0
      } finally {
        clearTimeout(timer)
      }
    } catch {
      return 0
    }
  }

  ipcMain.handle(
    IPC_LOCAL_PICK_FILE,
    wrapHandler('LOCAL_PICK_FILE', async () => {
      const win = BrowserWindow.getFocusedWindow() ?? undefined
      const res = await dialog.showOpenDialog(win!, {
        title: 'Select a GGUF model file',
        properties: ['openFile'],
        filters: [{ name: 'GGUF models', extensions: ['gguf'] }],
      })
      if (res.canceled || res.filePaths.length === 0) return null
      return { path: res.filePaths[0] }
    }),
  )

  ipcMain.handle(
    IPC_LOCAL_REMOVE,
    wrapHandler('LOCAL_REMOVE', (payload: unknown) => {
      const raw = validatePlainObject(payload, 'local:remove')
      const id = String(raw.id ?? '')
      if (!id) throw new Error('id is required')
      const model = listLocalModels().find(
        (m) => m.id === id || m.fileName.replace(/\.gguf$/i, '') === id,
      )
      if (!model) throw new Error(`Local model not found: ${id}`)
      try {
        fs.unlinkSync(model.path)
      } catch (err) {
        throw new Error(`Failed to delete model file: ${err instanceof Error ? err.message : String(err)}`)
      }
      return { ok: true }
    }),
  )

  ipcMain.handle(
    IPC_LOCAL_DOWNLOAD_START,
    wrapHandler('LOCAL_DOWNLOAD_START', async (payload: unknown) => {
      const raw = validatePlainObject(payload, 'local:downloadStart')
      const modelId = String(raw.modelId ?? '')
      if (!modelId) throw new Error('modelId is required')
      await downloadLocalModel(modelId)
      return { ok: true }
    }),
  )

  ipcMain.handle(
    IPC_LOCAL_DOWNLOAD_CANCEL,
    wrapHandler('LOCAL_DOWNLOAD_CANCEL', () => ({ ok: cancelLocalDownload() })),
  )

  ipcMain.handle(
    IPC_LOCAL_ENGINE_START,
    wrapHandler('LOCAL_ENGINE_START', async (payload: unknown) => {
      const raw = validatePlainObject(payload, 'local:engineStart')
      const modelId = String(raw.modelId ?? '')
      if (!modelId) throw new Error('modelId is required')
      const config = deps.openclawConfigExists() ? (deps.readOpenClawConfig() ?? {}) : {}
      const before = getEngineState()
      const state = await startLocalEngine(modelId, config, (c) => {
        deps.writeOpenClawConfig(c)
        readOpenClawConfig()
      })
      let test: LocalEngineTestResult | undefined
      if (raw.test === true && state.running) {
        test = await testLocalEngineChat(LOCAL_ENGINE_PORT, state.modelId ?? modelId)
      }
      // The running gateway only re-reads openclaw.json on restart. When the
      // engine started for the first time (or switched to another model) while
      // the gateway was already up, restart it so the chat actually uses the
      // new primary model. Failures here are non-fatal: the engine is healthy,
      // the user can restart the gateway from the UI.
      if (state.running && (raw.restartGateway !== false)) {
        const switched = !before.running || before.modelId !== state.modelId
        if (switched && deps.openclawConfigExists()) {
          const gwCfg = deps.readOpenClawConfig()
          const gw = gwCfg?.gateway
          const port = gw?.port ?? DEFAULT_GATEWAY_PORT
          const bind = gw?.bind ?? 'loopback'
          const token = gw?.auth?.token?.trim()
          const force = Boolean(gw?.forcePortOnConflict)
          try {
            await gatewayManager.restart({ port, bind, token: token || undefined, force })
          } catch (err) {
            logError(
              `[local-engine] gateway restart after model switch failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      }
      return { ok: test ? test.ok : true, engineState: state, test, restarted: true }
    }),
  )

  ipcMain.handle(
    IPC_LOCAL_ENGINE_STOP,
    wrapHandler('LOCAL_ENGINE_STOP', () => {
      const wasRunning = stopLocalEngine()
      return { ok: true, wasRunning }
    }),
  )

  ipcMain.handle(
    IPC_LOCAL_ENGINE_MODE,
    wrapHandler('LOCAL_ENGINE_MODE', async (payload: unknown) => {
      const raw =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {}
      if (typeof raw.installVariant === 'string') {
        const variant =
          raw.installVariant === 'cpu' ||
          raw.installVariant === 'cuda' ||
          raw.installVariant === 'vulkan'
            ? raw.installVariant
            : null
        if (variant) {
          // Download + unpack the llama.cpp build (progress on IPC_LOCAL_PROGRESS).
          await installEngineVariant(variant)
          // v0.9.14: installing a GPU/CPU build expresses intent — persist it
          // so the wizard's choice survives into the main panel (GPU tile green
          // without manual switching in Models). GPU builds store 'auto': on
          // laptops where the WMI GPU probe is broken ('none') resolveEngineVariant
          // falls back to the CUDA build already on disk instead of the CPU one.
          const shell = deps.readShellConfig()
          const nextMode = variant === 'cpu' ? 'cpu' : 'auto'
          if (shell.localEngineMode !== nextMode) {
            shell.localEngineMode = nextMode
            deps.writeShellConfig(shell)
          }
          return getLocalEngineRuntimeState()
        }
      }
      if (typeof raw.setMode === 'string') {
        const mode =
          raw.setMode === 'cpu' || raw.setMode === 'gpu' ? raw.setMode : 'auto'
        const config = deps.openclawConfigExists()
          ? (deps.readOpenClawConfig() ?? {})
          : {}
        return setLocalEngineMode(mode, config, (c) => {
          deps.writeOpenClawConfig(c)
          readOpenClawConfig()
        })
      }
      return getLocalEngineRuntimeState()
    }),
  )

  ipcMain.handle(
    IPC_LOCAL_ENGINE_STATUS,
    wrapHandler('LOCAL_ENGINE_STATUS', async () => {
      const r = await getLocalEngineRuntimeState()
      return {
        running: r.engineState.running,
        modelId: r.engineState.modelId,
        mode: r.mode,
        variant: r.variant,
        effectiveGpu: r.effectiveGpu,
        gpuName: r.gpuName,
        installedVariants: r.installedVariants,
      }
    }),
  )

  ipcMain.handle(
    IPC_LOCAL_REORDER,
    wrapHandler('LOCAL_REORDER', (payload: unknown) => {
      const raw = validatePlainObject(payload, 'local:reorder')
      const ids = Array.isArray(raw.ids)
        ? (raw.ids as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      const shell = deps.readShellConfig()
      shell.localModelsOrder = ids
      deps.writeShellConfig(shell)
      return { ok: true }
    }),
  )

  ipcMain.handle(
    IPC_TEXT_CHAT_SEND,
    wrapHandler('TEXT_CHAT_SEND', (payload: unknown) => {
      const raw = validatePlainObject(payload, 'textChat:send')
      const text = typeof raw.text === 'string' ? raw.text : ''
      const history = Array.isArray(raw.history)
        ? (raw.history as unknown[]).slice(0, 10).flatMap((m) => {
            if (!m || typeof m !== 'object') return []
            const mm = m as Record<string, unknown>
            const role = mm.role
            if (role !== 'user' && role !== 'assistant') return []
            if (typeof mm.content !== 'string') return []
            return [{ role: role as 'user' | 'assistant', content: mm.content }]
          })
        : []
      return sendTextChat({ text, history })
    }),
  )

  // ─── Registry (Skills / Extensions / Commands) ───────────────────────────
  const registryDeps = {
    getBundledOpenClawPath: deps.getBundledOpenClawPath ?? (() => ''),
    getUserDataDir: deps.getUserDataDir,
    readOpenClawConfig: deps.readOpenClawConfig,
    writeOpenClawConfig: deps.writeOpenClawConfig,
  }

  ipcMain.handle(
    IPC_SKILLS_LIST,
    wrapHandler('SKILLS_LIST', (opts?: unknown) => {
      const raw = opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as Record<string, unknown>)
        : {}
      const source = raw.source === 'bundled' || raw.source === 'user' ? raw.source : undefined
      return listSkillsWithProxy(registryDeps, source)
    }),
  )

  ipcMain.handle(
    IPC_SKILLS_RELOAD,
    wrapHandler('SKILLS_RELOAD', () => ({ ok: true })),
  )

  ipcMain.handle(
    IPC_SKILLS_TOGGLE,
    wrapHandler('SKILLS_TOGGLE', (opts: unknown) => {
      const raw = validatePlainObject(opts, 'skills:toggle opts')
      const skillKey = String(raw.skillKey ?? '')
      const enabled = raw.enabled === true
      if (!skillKey) throw new Error('skillKey is required')
      toggleSkill(registryDeps, skillKey, enabled)
      return { ok: true }
    }),
  )

  ipcMain.handle(
    IPC_EXTENSIONS_LIST,
    wrapHandler('EXTENSIONS_LIST', (opts?: unknown) => {
      const raw = opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as Record<string, unknown>)
        : {}
      const source = raw.source === 'bundled' || raw.source === 'user' ? raw.source : undefined
      return listExtensions(registryDeps, source)
    }),
  )

  ipcMain.handle(
    IPC_EXTENSIONS_TOGGLE,
    wrapHandler('EXTENSIONS_TOGGLE', (opts: unknown) => {
      const raw = validatePlainObject(opts, 'extensions:toggle opts')
      const pluginId = String(raw.pluginId ?? '')
      const enabled = raw.enabled === true
      if (!pluginId) throw new Error('pluginId is required')
      toggleExtension(registryDeps, pluginId, enabled)
      return { ok: true }
    }),
  )

  ipcMain.handle(
    IPC_REGISTRY_RELOAD,
    wrapHandler('REGISTRY_RELOAD', () => ({ ok: true })),
  )

  ipcMain.handle(
    IPC_REGISTRY_EXPORT,
    wrapHandler('REGISTRY_EXPORT', (opts?: unknown) => {
      const raw = opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as Record<string, unknown>)
        : {}
      const skills = Array.isArray(raw.skills) ? (raw.skills as string[]) : undefined
      const extensions = Array.isArray(raw.extensions) ? (raw.extensions as string[]) : undefined
      return exportRegistry(registryDeps, { skills, extensions })
    }),
  )

  ipcMain.handle(
    IPC_REGISTRY_IMPORT,
    wrapHandler('REGISTRY_IMPORT', (opts: unknown) => {
      const raw = validatePlainObject(opts, 'registry:import opts')
      const targetPath = String(raw.path ?? '')
      const merge = raw.merge !== false
      if (!targetPath) throw new Error('path is required')
      return importRegistry(registryDeps, { path: targetPath, merge })
    }),
  )

  ipcMain.handle(
    IPC_REGISTRY_VALIDATE,
    wrapHandler('REGISTRY_VALIDATE', (opts: unknown) => {
      const raw = validatePlainObject(opts, 'registry:validate opts')
      const kind = raw.kind === 'skill' ? 'skill' : raw.kind === 'extension' ? 'extension' : null
      const id = String(raw.id ?? '')
      if (!kind || !id) throw new Error('kind and id are required')
      return validateRegistryItem(registryDeps, kind, id)
    }),
  )

  // ─── Models (RPC proxy) ────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_MODELS_LIST,
    wrapHandler('MODELS_LIST', async () => {
      return listModelsWithProxy(deps.readOpenClawConfig)
    }),
  )

  ipcMain.handle(
    IPC_MODELS_SET_DEFAULT,
    wrapHandler('MODELS_SET_DEFAULT', (opts: unknown) => {
      const raw = validatePlainObject(opts, 'models:setDefault opts')
      const primary = String(raw.modelId ?? raw.primary ?? '')
      if (!primary) throw new Error('modelId or primary is required')
      const current = deps.readOpenClawConfig()
      const next = setModelDefaults(current, { primary })
      deps.writeOpenClawConfig(next)
      return { ok: true }
    }),
  )

  ipcMain.handle(
    IPC_MODELS_SET_FALLBACKS,
    wrapHandler('MODELS_SET_FALLBACKS', (opts: unknown) => {
      const raw = validatePlainObject(opts, 'models:setFallbacks opts')
      const fallbacks = Array.isArray(raw.fallbacks)
        ? (raw.fallbacks as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      const current = deps.readOpenClawConfig()
      const next = setModelDefaults(current, { fallbacks })
      deps.writeOpenClawConfig(next)
      return { ok: true }
    }),
  )

  ipcMain.handle(
    IPC_MODELS_SET_ALIASES,
    wrapHandler('MODELS_SET_ALIASES', (opts: unknown) => {
      const raw = validatePlainObject(opts, 'models:setAliases opts')
      const aliases = raw.aliases
      if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
        throw new Error('aliases must be a record of model id to { alias?: string }')
      }
      const typed: Record<string, { alias?: string }> = {}
      for (const [k, v] of Object.entries(aliases)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          typed[k] = { alias: typeof (v as { alias?: unknown }).alias === 'string' ? (v as { alias: string }).alias : undefined }
        }
      }
      const current = deps.readOpenClawConfig()
      const next = setModelAliases(current, typed)
      deps.writeOpenClawConfig(next)
      return { ok: true }
    }),
  )

  // ─── Plugins (CLI proxy) ───────────────────────────────────────────────────
  ipcMain.handle(
    IPC_PLUGINS_LIST,
    wrapHandler('PLUGINS_LIST', () => listPluginsWithCli()),
  )

  ipcMain.handle(
    IPC_PLUGINS_TOGGLE,
    wrapHandler('PLUGINS_TOGGLE', (opts: unknown) => {
      const raw = validatePlainObject(opts, 'plugins:toggle opts')
      const id = String(raw.id ?? raw.pluginId ?? '')
      const enabled = raw.enabled === true
      if (!id) throw new Error('id or pluginId is required')
      return togglePlugin(id, enabled)
    }),
  )

  ipcMain.handle(
    IPC_PLUGINS_INSTALL,
    wrapHandler('PLUGINS_INSTALL', (spec: unknown) => {
      if (typeof spec !== 'string') throw new Error('spec must be a string')
      return installPlugin(spec)
    }),
  )

  ipcMain.handle(
    IPC_PLUGINS_UNINSTALL,
    wrapHandler('PLUGINS_UNINSTALL', (opts: unknown) => {
      const raw = opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as Record<string, unknown>)
        : {}
      const id = String(raw.id ?? raw.pluginId ?? '')
      const keepFiles = raw.keepFiles === true
      if (!id) throw new Error('id or pluginId is required')
      return uninstallPlugin(id, { keepFiles })
    }),
  )

  ipcMain.handle(
    IPC_UPDATE_CHECK,
    wrapHandler('UPDATE_CHECK', () => checkForUpdates(deps.readShellConfig)),
  )

  ipcMain.handle(
    IPC_UPDATE_DOWNLOAD_SHELL,
    wrapHandler('UPDATE_DOWNLOAD_SHELL', () => downloadUpdate(deps.readShellConfig)),
  )

  ipcMain.handle(
    IPC_UPDATE_INSTALL_SHELL,
    wrapHandler('UPDATE_INSTALL_SHELL', () => installShellUpdateWithBackup()),
  )

  ipcMain.handle(
    IPC_UPDATE_CANCEL_DOWNLOAD,
    wrapHandler('UPDATE_CANCEL_DOWNLOAD', () => {
      cancelDownload()
      return {}
    }),
  )

  ipcMain.handle(
    IPC_UPDATE_VERIFY_BUNDLE,
    wrapHandler('UPDATE_VERIFY_BUNDLE', () => verifyBundle()),
  )

  ipcMain.handle(
    IPC_UPDATE_PRESTART_CHECK,
    wrapHandler('UPDATE_PRESTART_CHECK', () => getPrestartCheckForFrontend()),
  )

  ipcMain.handle(
    IPC_UPDATE_GET_POST_UPDATE_VALIDATION,
    wrapHandler('UPDATE_GET_POST_UPDATE_VALIDATION', () => {
      const result = readAndConsumePostUpdateResult()
      return result ?? { ran: false, ok: true, rollbackGuidance: '' }
    }),
  )

  // ─── Backup (CLI proxy) ────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_BACKUP_CREATE,
    wrapHandler('BACKUP_CREATE', async (opts?: unknown) => {
      const raw = opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as Record<string, unknown>)
        : {}
      const params = {
        output: typeof raw.output === 'string' ? raw.output : undefined,
        includeWorkspace: raw.includeWorkspace === false ? false : undefined,
        onlyConfig: raw.onlyConfig === true ? true : undefined,
        verify: raw.verify === true ? true : undefined,
      }
      return runBackupCreateCli(params)
    }),
  )

  ipcMain.handle(
    IPC_BACKUP_VERIFY,
    wrapHandler('BACKUP_VERIFY', (archivePath: unknown) => {
      if (typeof archivePath !== 'string' || archivePath.trim().length === 0) {
        throw new Error('archivePath must be a non-empty string')
      }
      return runBackupVerifyCli(archivePath.trim())
    }),
  )

  // ─── Logs (RPC proxy) ──────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_LOGS_TAIL,
    wrapHandler('LOGS_TAIL', async (opts: unknown) => {
      const raw = opts && typeof opts === 'object' && !Array.isArray(opts)
        ? (opts as Record<string, unknown>)
        : {}
      const params = {
        cursor: typeof raw.cursor === 'number' ? raw.cursor : undefined,
        limit: typeof raw.limit === 'number' ? raw.limit : undefined,
        maxBytes: typeof raw.maxBytes === 'number' ? raw.maxBytes : undefined,
      }
      try {
        return await tailLogsWithGateway(params)
      } catch {
        const aggregator = getLogAggregator()
        const recent = aggregator.getRecent(500).filter((e) => e.source === 'gateway')
        return {
          lines: recent.map((e) => `[${e.timestamp}] [${e.level}] ${e.message}`),
          truncated: false,
          reset: false,
        }
      }
    }),
  )
}

export function removeIpcHandlers(): void {
  ipcMain.removeHandler(IPC_GATEWAY_START)
  ipcMain.removeHandler(IPC_GATEWAY_STOP)
  ipcMain.removeHandler(IPC_GATEWAY_RESTART)
  ipcMain.removeHandler(IPC_GATEWAY_STATUS)
  ipcMain.removeHandler(IPC_CONFIG_READ)
  ipcMain.removeHandler(IPC_CONFIG_WRITE)
  ipcMain.removeHandler(IPC_CONFIG_EXISTS)
  ipcMain.removeHandler(IPC_CONFIG_VALIDATE)
  ipcMain.removeHandler(IPC_SHELL_GET_CONFIG)
  ipcMain.removeHandler(IPC_SHELL_SET_CONFIG)
  ipcMain.removeHandler(IPC_SYSTEM_GET_LOCALE)
  ipcMain.removeHandler(IPC_SYSTEM_OPEN_EXTERNAL)
  ipcMain.removeHandler(IPC_SYSTEM_OPEN_PATH)
  ipcMain.removeHandler(IPC_PORT_CHECK)
  ipcMain.removeHandler(IPC_WIZARD_TEST_MODEL)
  ipcMain.removeHandler(IPC_WIZARD_TEST_TELEGRAM)
  ipcMain.removeHandler(IPC_TELEGRAM_GET)
  ipcMain.removeHandler(IPC_TELEGRAM_SAVE)
  ipcMain.removeHandler(IPC_WIZARD_COMPLETE_SETUP)
  ipcMain.removeHandler(IPC_SYSTEM_OPEN_LOG_DIR)
  ipcMain.removeHandler(IPC_SHELL_GET_VERSIONS)
  ipcMain.removeHandler(IPC_SHELL_RESIZE_FOR_MAIN_INTERFACE)
  ipcMain.removeHandler(IPC_SHELL_SET_WINDOW_TITLE)
  ipcMain.removeHandler(IPC_DIAGNOSTICS_EXPORT)
  ipcMain.removeHandler(IPC_DIAGNOSTICS_RUN)
  ipcMain.removeHandler(IPC_DIAGNOSTICS_SUMMARY)
  ipcMain.removeHandler(IPC_PROVIDERS_LIST)
  ipcMain.removeHandler(IPC_PROVIDERS_SAVE_PROFILE)
  ipcMain.removeHandler(IPC_PROVIDERS_DELETE_PROFILE)
  ipcMain.removeHandler(IPC_PROVIDERS_TEST)
  ipcMain.removeHandler(IPC_PROVIDERS_EXPORT)
  ipcMain.removeHandler(IPC_PROVIDERS_IMPORT)
  ipcMain.removeHandler(IPC_PROVIDERS_SAVE_CONFIG)
  ipcMain.removeHandler(IPC_PROVIDERS_SET_MODEL_DEFAULTS)
  ipcMain.removeHandler(IPC_MODEL_SETTINGS_LOAD)
  ipcMain.removeHandler(IPC_MODEL_SETTINGS_APPLY)
  ipcMain.removeHandler(IPC_SKILLS_LIST)
  ipcMain.removeHandler(IPC_SKILLS_TOGGLE)
  ipcMain.removeHandler(IPC_SKILLS_RELOAD)
  ipcMain.removeHandler(IPC_EXTENSIONS_LIST)
  ipcMain.removeHandler(IPC_EXTENSIONS_TOGGLE)
  ipcMain.removeHandler(IPC_REGISTRY_RELOAD)
  ipcMain.removeHandler(IPC_REGISTRY_EXPORT)
  ipcMain.removeHandler(IPC_REGISTRY_IMPORT)
  ipcMain.removeHandler(IPC_REGISTRY_VALIDATE)
  ipcMain.removeHandler(IPC_MODELS_LIST)
  ipcMain.removeHandler(IPC_MODELS_SET_DEFAULT)
  ipcMain.removeHandler(IPC_MODELS_SET_FALLBACKS)
  ipcMain.removeHandler(IPC_MODELS_SET_ALIASES)
  ipcMain.removeHandler(IPC_PLUGINS_LIST)
  ipcMain.removeHandler(IPC_PLUGINS_TOGGLE)
  ipcMain.removeHandler(IPC_PLUGINS_INSTALL)
  ipcMain.removeHandler(IPC_PLUGINS_UNINSTALL)
  ipcMain.removeHandler(IPC_LOGS_TAIL)
  ipcMain.removeHandler(IPC_BACKUP_CREATE)
  ipcMain.removeHandler(IPC_BACKUP_VERIFY)
  ipcMain.removeHandler(IPC_UPDATE_CHECK)
  ipcMain.removeHandler(IPC_UPDATE_DOWNLOAD_SHELL)
  ipcMain.removeHandler(IPC_UPDATE_INSTALL_SHELL)
  ipcMain.removeHandler(IPC_UPDATE_CANCEL_DOWNLOAD)
  ipcMain.removeHandler(IPC_UPDATE_VERIFY_BUNDLE)
  ipcMain.removeHandler(IPC_UPDATE_PRESTART_CHECK)
  ipcMain.removeHandler(IPC_UPDATE_GET_POST_UPDATE_VALIDATION)
}
