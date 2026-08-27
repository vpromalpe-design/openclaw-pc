/**
 * IPC channel names — shared by main and renderer.
 * Matches the API exposed from preload.
 */

// ─── Request/response (ipcRenderer.invoke / ipcMain.handle) ─────────────────────

/** Start gateway */
export const IPC_GATEWAY_START = 'gateway:start' as const

/** Stop gateway */
export const IPC_GATEWAY_STOP = 'gateway:stop' as const

/** Restart gateway */
export const IPC_GATEWAY_RESTART = 'gateway:restart' as const

/** Gateway status query */
export const IPC_GATEWAY_STATUS = 'gateway:status' as const

/** Read OpenClaw config */
export const IPC_CONFIG_READ = 'config:read' as const

/** Write OpenClaw config */
export const IPC_CONFIG_WRITE = 'config:write' as const

/** Whether OpenClaw config file exists */
export const IPC_CONFIG_EXISTS = 'config:exists' as const

/** Config schema validation (`openclaw config validate --json`) */
export const IPC_CONFIG_VALIDATE = 'config:validate' as const

/** Read shell config */
export const IPC_SHELL_GET_CONFIG = 'shell:getConfig' as const

/** Write shell config */
export const IPC_SHELL_SET_CONFIG = 'shell:setConfig' as const

/** System/app locale for i18n */
export const IPC_SYSTEM_GET_LOCALE = 'system:getLocale' as const

/** Open URL in system browser */
export const IPC_SYSTEM_OPEN_EXTERNAL = 'system:openExternal' as const

/** Reveal path in file manager */
export const IPC_SYSTEM_OPEN_PATH = 'system:openPath' as const

/** TCP port availability check */
export const IPC_PORT_CHECK = 'port:check' as const

/** Wizard: test model connectivity */
export const IPC_WIZARD_TEST_MODEL = 'wizard:testModel' as const

/** Test Telegram bot token (getMe) during wizard setup */
export const IPC_WIZARD_TEST_TELEGRAM = 'wizard:testTelegram' as const

/** Telegram settings panel: load current channel state (token present, bot name/url) */
export const IPC_TELEGRAM_GET = 'telegram:get' as const

/** Telegram settings panel: save bot token/name/url, then restart the gateway */
export const IPC_TELEGRAM_SAVE = 'telegram:save' as const

/** Wizard: atomically write config + credentials + start gateway */
export const IPC_WIZARD_COMPLETE_SETUP = 'wizard:completeSetup' as const

/** Open log / user data directory */
export const IPC_SYSTEM_OPEN_LOG_DIR = 'system:openLogDir' as const

/** App version / bundle info */
export const IPC_SHELL_GET_VERSIONS = 'shell:getVersions' as const

/** Resize window for main shell + embedded Control UI */
export const IPC_SHELL_RESIZE_FOR_MAIN_INTERFACE = 'shell:resizeForMainInterface' as const

/** Set main BrowserWindow title (sync with renderer i18n) */
export const IPC_SHELL_SET_WINDOW_TITLE = 'shell:setWindowTitle' as const

/** Export redacted diagnostics bundle */
export const IPC_DIAGNOSTICS_EXPORT = 'diagnostics:export' as const

/** Gateway sessions: recent list (sidebar «Сессии») */
export const IPC_SESSIONS_LIST = 'sessions:list' as const

/** Providers: list profiles */
export const IPC_PROVIDERS_LIST = 'providers:list' as const

/** Providers: save profile */
export const IPC_PROVIDERS_SAVE_PROFILE = 'providers:saveProfile' as const

/** Providers: delete profile */
export const IPC_PROVIDERS_DELETE_PROFILE = 'providers:deleteProfile' as const

/** Providers: test connection */
export const IPC_PROVIDERS_TEST = 'providers:test' as const

/** Providers: export profiles */
export const IPC_PROVIDERS_EXPORT = 'providers:export' as const

/** Providers: import profiles */
export const IPC_PROVIDERS_IMPORT = 'providers:import' as const

/** Providers: save provider block in config */
export const IPC_PROVIDERS_SAVE_CONFIG = 'providers:saveProviderConfig' as const

/** Providers: set default model / fallbacks */
export const IPC_PROVIDERS_SET_MODEL_DEFAULTS = 'providers:setModelDefaults' as const

/** Settings: load model editor snapshot (infer from openclaw.json) */
export const IPC_MODEL_SETTINGS_LOAD = 'modelSettings:load' as const

/** Settings: apply model editor (merge config + optional gateway restart) */
export const IPC_MODEL_SETTINGS_APPLY = 'modelSettings:apply' as const

/** Settings: load voice (talk.realtime) editor snapshot */
export const IPC_VOICE_SETTINGS_LOAD = 'voiceSettings:load' as const

/** Settings: apply voice (talk.realtime) editor (write + optional gateway restart) */
export const IPC_VOICE_SETTINGS_APPLY = 'voiceSettings:apply' as const

/** Voice: test provider connectivity (wizard step + settings section) */
export const IPC_VOICE_TEST = 'voice:test' as const

// v0.9.13 (Этап F): TTS / STT (Edge / ElevenLabs / Piper / whisper.cpp) —
// settings live in the desktop shell config (config.json), not openclaw.json.
/** TTS: load settings snapshot (tts section of shell config + install state) */
export const IPC_TTS_LOAD = 'tts:load' as const
/** TTS: apply settings (enabled / provider / voice / apiKey) */
export const IPC_TTS_APPLY = 'tts:apply' as const
/** TTS: synthesize a test phrase with current settings */
export const IPC_TTS_TEST = 'tts:test' as const
/** TTS: fetch voice list for a provider (edge: live; elevenlabs: needs key; piper: catalog) */
export const IPC_TTS_VOICES = 'tts:voices' as const
/** TTS: install local component (piper binary + voice model) */
export const IPC_TTS_INSTALL = 'tts:install' as const
/** TTS: main → renderer, agent answer audio for playback */
export const IPC_TTS_UTTERANCE = 'tts:utterance' as const

/** STT: load settings snapshot */
export const IPC_STT_LOAD = 'stt:load' as const
/** STT: apply settings (enabled / whisper model) */
export const IPC_STT_APPLY = 'stt:apply' as const
/** STT: install whisper.cpp binary + model */
export const IPC_STT_INSTALL = 'stt:install' as const
/** STT: transcribe WAV (base64) with local whisper */
export const IPC_STT_TRANSCRIBE = 'stt:transcribe' as const

/** Voice: install/download progress (main → renderer, payload VoiceProgress) */
export const IPC_VOICE_PROGRESS = 'voice:progress' as const

/** Skills list */
export const IPC_SKILLS_LIST = 'skills:list' as const

/** Skills enable/disable */
export const IPC_SKILLS_TOGGLE = 'skills:toggle' as const

/** Skills rescan/reload */
export const IPC_SKILLS_RELOAD = 'skills:reload' as const

/** Extensions list */
export const IPC_EXTENSIONS_LIST = 'extensions:list' as const

/** Extensions enable/disable */
export const IPC_EXTENSIONS_TOGGLE = 'extensions:toggle' as const

/** Registry reload */
export const IPC_REGISTRY_RELOAD = 'registry:reload' as const

/** Registry export */
export const IPC_REGISTRY_EXPORT = 'registry:export' as const

/** Registry import */
export const IPC_REGISTRY_IMPORT = 'registry:import' as const

/** Registry validate */
export const IPC_REGISTRY_VALIDATE = 'registry:validate' as const

/** Check for updates (GitHub / electron-updater) */
export const IPC_UPDATE_CHECK = 'update:check' as const

/** Download shell update */
export const IPC_UPDATE_DOWNLOAD_SHELL = 'update:downloadShell' as const

/** Install shell update (backup, quit, install) */
export const IPC_UPDATE_INSTALL_SHELL = 'update:installShell' as const

/** Cancel in-progress download */
export const IPC_UPDATE_CANCEL_DOWNLOAD = 'update:cancelDownload' as const

/** Bundle verification result */
export const IPC_UPDATE_VERIFY_BUNDLE = 'update:verifyBundle' as const

/** Pre-start check result */
export const IPC_UPDATE_PRESTART_CHECK = 'update:prestartCheck' as const

/** Post-update validation (read-once) */
export const IPC_UPDATE_GET_POST_UPDATE_VALIDATION = 'update:getPostUpdateValidation' as const

/** Run full diagnostics (doctor proxy) */
export const IPC_DIAGNOSTICS_RUN = 'diagnostics:run' as const

/** Diagnostics summary */
export const IPC_DIAGNOSTICS_SUMMARY = 'diagnostics:summary' as const

/** Models list (RPC proxy) */
export const IPC_MODELS_LIST = 'models:list' as const

/** Models: set default */
export const IPC_MODELS_SET_DEFAULT = 'models:setDefault' as const

/** Models: set fallbacks */
export const IPC_MODELS_SET_FALLBACKS = 'models:setFallbacks' as const

/** Models: set aliases */
export const IPC_MODELS_SET_ALIASES = 'models:setAliases' as const

/** Models page: full table view (providers + priority + local) */
export const IPC_MODELS_VIEW_LIST = 'models:viewList' as const

/** Models page: apply priority (primary + fallbacks) with backup + restart */
export const IPC_MODELS_VIEW_APPLY = 'models:viewApply' as const

/** Local models: list downloaded GGUF + engine state */
export const IPC_LOCAL_LIST = 'local:list' as const

/** Local models: add (preset, custom URL or local file) */
export const IPC_LOCAL_ADD = 'local:add' as const

/** Local models: pick a .gguf file from disk */
export const IPC_LOCAL_PICK_FILE = 'local:pickFile' as const

/** Local models: remove */
export const IPC_LOCAL_REMOVE = 'local:remove' as const

/** Local models: start download */
export const IPC_LOCAL_DOWNLOAD_START = 'local:downloadStart' as const

/** Local models: cancel download */
export const IPC_LOCAL_DOWNLOAD_CANCEL = 'local:downloadCancel' as const

/** Local engine: start llama-server with a model */
export const IPC_LOCAL_ENGINE_START = 'local:engineStart' as const

/** Local engine: first-request pending status (cold start banner) */
export const IPC_LOCAL_FIRST_REQUEST_STATUS = 'local:firstRequestStatus' as const

/** Local engine: stop */
export const IPC_LOCAL_ENGINE_STOP = 'local:engineStop' as const

/** Local engine: get runtime info / set compute mode (cpu|gpu|auto) */
export const IPC_LOCAL_ENGINE_MODE = 'local:engineMode' as const
/** Lightweight engine status for the status-panel indicators (v0.9.12) */
export const IPC_LOCAL_ENGINE_STATUS = 'local:engineStatus' as const
export const IPC_LOCAL_REORDER = 'local:reorder' as const

/** Local download progress event (main → renderer) */
export const IPC_LOCAL_PROGRESS = 'local:progress' as const

/** Agents: add a new agent (v0.9.12) */
export const IPC_AGENTS_ADD = 'agents:add' as const

/** Agents: set agent model (v0.9.12) */
export const IPC_AGENTS_SET_MODEL = 'agents:setModel' as const

/** Agents: remove an agent and all its chats (v0.9.14) */
export const IPC_AGENTS_REMOVE = 'agents:remove' as const

/** Agents: activity event — an agent started/finished processing a turn (main → renderer, v0.9.12) */
export const IPC_AGENTS_ACTIVITY = 'agents:activity' as const

/** Plain-text chat: direct model call without the agent runtime (v0.9.0) */
export const IPC_TEXT_CHAT_SEND = 'textChat:send' as const

/** Plugins list (CLI proxy) */
export const IPC_PLUGINS_LIST = 'plugins:list' as const

/** Plugins enable/disable */
export const IPC_PLUGINS_TOGGLE = 'plugins:toggle' as const

/** Plugins install */
export const IPC_PLUGINS_INSTALL = 'plugins:install' as const

/** Plugins uninstall */
export const IPC_PLUGINS_UNINSTALL = 'plugins:uninstall' as const

/** Log tail (RPC or aggregator fallback) */
export const IPC_LOGS_TAIL = 'logs:tail' as const

/** Backup create */
export const IPC_BACKUP_CREATE = 'backup:create' as const

/** Backup verify */
export const IPC_BACKUP_VERIFY = 'backup:verify' as const


// ─── Events (ipcRenderer.on / webContents.send) ───────────────────────────────

/** Gateway status changed */
export const IPC_GATEWAY_STATUS_CHANGE = 'gateway:statusChange' as const

/** Gateway log line */
export const IPC_GATEWAY_LOG = 'gateway:log' as const

/** Local engine first-request lifecycle: 'start' | 'done' */
export const IPC_LOCAL_FIRST_REQUEST = 'local:first-request' as const

/** Structured gateway log stream */
export const IPC_STREAM_GATEWAY_LOGS = 'stream:gateway-logs' as const

/** Update available */
export const IPC_UPDATE_AVAILABLE = 'update:available' as const

/** Update download progress */
export const IPC_UPDATE_PROGRESS = 'update:progress' as const

// ─── Channel sets (bulk register/unregister) ─────────────────────────────────

/** All invoke channels */
export const IPC_INVOKE_CHANNELS = [
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
  IPC_LOCAL_REORDER,
  IPC_TEXT_CHAT_SEND,
  IPC_TTS_LOAD,
  IPC_TTS_APPLY,
  IPC_TTS_TEST,
  IPC_TTS_VOICES,
  IPC_TTS_INSTALL,
  IPC_STT_LOAD,
  IPC_STT_APPLY,
  IPC_STT_INSTALL,
  IPC_STT_TRANSCRIBE,
  IPC_PLUGINS_LIST,
  IPC_PLUGINS_TOGGLE,
  IPC_PLUGINS_INSTALL,
  IPC_PLUGINS_UNINSTALL,
  IPC_LOGS_TAIL,
  IPC_BACKUP_CREATE,
  IPC_BACKUP_VERIFY,
] as const

/** All event channels */
export const IPC_EVENT_CHANNELS = [
  IPC_GATEWAY_STATUS_CHANGE,
  IPC_GATEWAY_LOG,
  IPC_STREAM_GATEWAY_LOGS,
  IPC_UPDATE_AVAILABLE,
  IPC_UPDATE_PROGRESS,
  IPC_LOCAL_PROGRESS,
  IPC_LOCAL_FIRST_REQUEST,
  IPC_VOICE_PROGRESS,
  IPC_TTS_UTTERANCE,
] as const
