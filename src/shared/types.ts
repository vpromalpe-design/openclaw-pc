/**
 * Shared types — used by main and renderer processes.
 * Compatible with upstream OpenClaw configuration shape.
 */

import type { ShellLocale } from './shell-locale.js'

// ─── ShellConfig ─────────────────────────────────────────────────────────────

/** Window position and size */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

/** Desktop shell theme */
export type ShellTheme = 'system' | 'light' | 'dark'

/** Update channel */
export type UpdateChannel = 'stable' | 'beta'

export type { ShellLocale }

/** Desktop shell settings stored in %APPDATA%\OpenClaw PC\config.json */
export interface ShellConfig {
  closeToTray: boolean
  autoStart: boolean
  theme: ShellTheme
  /** Preferred UI language; omit to follow OS locale */
  locale?: ShellLocale
  lastGatewayPort: number
  updateChannel: UpdateChannel
  /** After first-run wizard: whether main-window expand ran once */
  onboardingMainWindowExpanded?: boolean
  /** Whether to check for updates automatically; default true */
  autoCheckUpdates?: boolean
  /** Last update check time (ISO 8601) */
  lastUpdateCheck?: string
  /** Local engine compute mode: auto (GPU when available) | cpu | gpu */
  localEngineMode?: 'auto' | 'cpu' | 'gpu'
  /** Local engine context window (n_ctx) in tokens; default 32768. Applied on engine restart. */
  localModelContextSize?: number
  /** v0.9.13 (Этап F): text-to-speech settings (agent answers → speaker). */
  tts?: {
    enabled: boolean
    provider: 'edge' | 'elevenlabs' | 'piper'
    /** Edge ShortName (e.g. ru-RU-SvetlanaNeural) | ElevenLabs voice_id | piper voice key (irina/dmitri/denis) */
    voice?: string
    /** ElevenLabs API key (optional for edge/piper) */
    apiKey?: string
  }
  /** v0.9.13 (Этап F): local speech-to-text via whisper.cpp. */
  stt?: {
    enabled: boolean
    /** whisper.cpp model: tiny | base | small | medium */
    model?: string
  }
  /** v0.9.24: mic input mode preference: 'auto' | 'offline' | 'online'. */
  sttPreferredMode?: 'auto' | 'offline' | 'online'
  /** User-defined display/switch order for downloaded local models (ids). */
  localModelsOrder?: string[]
  /** Telegram panel: display-only bot name (saved in shell config, not openclaw.json) */
  telegramBotName?: string
  /** Telegram panel: display-only bot link (t.me/<username> or custom) */
  telegramBotUrl?: string
  /**
   * v0.9.31: Telegram bots added through the Telegram panel. Every entry
   * marks an agent that was auto-created for a bot (Telegram icon in the
   * agent list). `linked` stays true while the account exists in
   * channels.telegram; after the bot is removed the entry survives so the
   * agent keeps its Telegram badge until the agent itself is deleted.
   */
  telegramBots?: ShellTelegramBotLink[]
  windowBounds: WindowBounds
}

/** v0.9.31: Telegram bot → agent link created from the Telegram panel. */
export interface ShellTelegramBotLink {
  /** Account id in channels.telegram(.accounts.<id>) — bot username without '@' (top-level bot = 'default') */
  accountId: string
  /** Linked agent id (auto-created when the bot was added) */
  agentId: string
  /** Bot username with '@', e.g. '@gavrikos_bot' */
  username: string
  /** Bot display name (first_name when known) */
  name?: string
  /** True while the account is still present in channels.telegram */
  linked?: boolean
  /** ISO-8601 timestamp of the first link */
  addedAt?: string
}

// ─── OpenClawConfig ───────────────────────────────────────────────────────────

/** Gateway authentication config (upstream: `none` mode removed — use token or password) */
export interface GatewayAuthConfig {
  mode?: 'token' | 'password'
  token?: string
  /** Used when `mode` is `password` (or implied); same field as upstream `gateway.auth.password`. */
  password?: string
}

/** Gateway Control UI policy (upstream `gateway.controlUi.*`) */
export interface GatewayControlUiConfig {
  /**
   * When true, loopback Control UI may connect with token/password only if device identity
   * is unavailable (e.g. Electron sandboxed iframe without `crypto.subtle`).
   * Required for embedded dashboard in OpenClaw PC.
   */
  allowInsecureAuth?: boolean
  /**
   * When true, skip Control UI device-identity requirements on loopback (upstream
   * `gateway.controlUi.dangerouslyDisableDeviceAuth`). Needed with OpenClaw ≥2026.3.x when the
   * embedded iframe still hits 500 / device-identity failures despite `allowInsecureAuth`.
   */
  dangerouslyDisableDeviceAuth?: boolean
  /**
   * Browser/WebSocket origins allowed for Control UI (upstream `gateway.controlUi.allowedOrigins`).
   * Desktop may seed `["*"]` on loopback bind when empty so Electron embeds pass origin checks.
   */
  allowedOrigins?: string[]
  /** Custom filesystem root for built Control UI (upstream `gateway.controlUi.root`) */
  root?: string
}

/** Gateway config */
export interface GatewayConfig {
  /** Matches upstream doctor: local (desktop shell) or remote */
  mode?: 'local' | 'remote'
  port?: number
  /** Upstream `gateway run --bind`: loopback | lan | tailnet | auto | custom */
  bind?: 'loopback' | 'lan' | 'auto' | 'tailnet' | 'custom'
  auth?: GatewayAuthConfig
  controlUi?: GatewayControlUiConfig
  /** When true, pass --force on port conflict (aligned with gateway run) */
  forcePortOnConflict?: boolean
}

/** Auth profile selection entry (aligned with upstream OpenClaw) */
export interface AuthProfileSelection {
  provider: string
  mode: 'api_key' | 'oauth' | 'token'
  email?: string
}

/** Auth config (aligned with upstream OpenClaw) */
export interface AuthConfig {
  profiles?: Record<string, AuthProfileSelection>
  order?: Record<string, string[]>
}

/** Default model settings */
export interface AgentModelDefaults {
  primary?: string
  /** Fallback model chain (provider/model) */
  fallbacks?: string[]
}

/** Default model alias entry */
export interface AgentModelAlias {
  alias?: string
}

/** Agent defaults */
export interface AgentDefaultsConfig {
  /** CLI compatibility: model may be a string (provider/model) */
  model?: AgentModelDefaults | string
  /** Optional model alias map (e.g. moonshot/kimi-k2.5) */
  models?: Record<string, AgentModelAlias>
  workspace?: string
  /** Default thinking level for reasoning-capable models (off | minimal | low | medium | high | xhigh | adaptive | max) */
  thinkingDefault?: string
  /** Auto-compaction tuning (small local models need a low reserve) */
  compaction?: {
    /** Minimum token reserve kept after compaction; default is ~half the context window */
    reserveTokensFloor?: number
    [key: string]: unknown
  }
}

/** Single agent entry (OpenClaw `agents.list[]`; multi-agent routing) */
export interface AgentListEntry {
  id: string
  name?: string
  workspace?: string
  agentDir?: string
  /** Upstream accepts `provider/model` string or structured model */
  model?: string | AgentModelDefaults
  [key: string]: unknown
}

/** Agents section */
export interface AgentsConfig {
  defaults?: AgentDefaultsConfig
  /** Optional multi-agent list (same shape as upstream `openclaw.json`) */
  list?: AgentListEntry[]
}

/** Agent activity event (main → renderer, v0.9.12 E3) */
export interface AgentActivityPayload {
  /** Agent id (e.g. `main`) */
  agentId: string
  /** True while the agent is processing a turn */
  busy: boolean
}

/** Result of `agents:add` (v0.9.12 E1) */
export interface AgentsAddResult {
  ok: boolean
  id?: string
  error?: string
}

/** Result of `agents:setModel` (v0.9.12 E4) */
export interface AgentsSetModelResult {
  ok: boolean
  error?: string
}

/** Result of `agents:remove` (v0.9.14) */
export interface AgentsRemoveResult {
  ok: boolean
  error?: string
}

/** Wizard Telegram channel (aligned with upstream TelegramConfig) */
export interface TelegramChannelConfig {
  /** Channel enabled flag (upstream field; written by wizard/settings) */
  enabled?: boolean
  botToken?: string
  /** Owner Telegram user ID (numeric) — written to allowFrom */
  userId?: string
  /** Owner Telegram user ids allowed to talk to the bot (upstream field) */
  allowFrom?: string[]
  /** DM policy for the bot (upstream: 'pairing' | 'open') */
  dmPolicy?: string
  /** Optional proxy URL (http/https preferred; socks5 experimental) */
  proxy?: string
}

/** One connected bot account shown in the Telegram panel (v0.9.31). */
export interface TelegramBotAccountRow {
  /** Account id inside channels.telegram.accounts (top-level bot = 'default') */
  accountId: string
  /** True for the top-level/default bot */
  isDefault: boolean
  /** Bot username for display, e.g. '@gavrikos_bot' (when known) */
  username?: string
  /** Bot display name (when known) */
  name?: string
  /** Agent bound to this bot (auto-created when the bot was added via the panel) */
  agentId?: string
  /** True when this bot was added via the panel (its agent carries the Telegram badge) */
  hasAgentLink?: boolean
  /** True when this account has a stored token */
  hasToken: boolean
  /** True when the account is enabled */
  enabled: boolean
}

/** Telegram settings panel: load snapshot (v0.9.31: multi-bot) */
export interface TelegramSettingsLoadResult {
  /** Channel enabled (or any token present) in openclaw.json */
  enabled: boolean
  /** Owner user ids from allowFrom (shared by all accounts) */
  allowFrom: string[]
  /** Explicit default account id, when set */
  defaultAccount?: string
  /** Connected bot accounts (top-level default first) */
  bots: TelegramBotAccountRow[]
}

/** Telegram settings panel: save/add/remove result */
export interface TelegramSettingsSaveResult {
  ok: boolean
  restarted: boolean
  error?: string
  /** New bot account id (addBot) */
  accountId?: string
  /** Linked agent id (addBot) */
  agentId?: string
  /** Bot username with '@' (addBot) */
  username?: string
}

/** Wizard Discord channel (aligned with upstream DiscordConfig) */
export interface DiscordChannelConfig {
  token?: string
}

/** Wizard Slack channel (aligned with upstream SlackConfig) */
export interface SlackChannelConfig {
  mode?: 'socket' | 'http'
  botToken?: string
  signingSecret?: string
  appToken?: string
}

/** Wizard WhatsApp channel (aligned with upstream; Baileys needs Control UI) */
export interface WhatsAppChannelConfig {
  enabled?: boolean
}

/** Channels keyed by channel name */
export interface ChannelsConfig {
  telegram?: TelegramChannelConfig
  discord?: DiscordChannelConfig
  slack?: SlackChannelConfig
  whatsapp?: WhatsAppChannelConfig
  [key: string]: unknown
}

/** Main OpenClaw config at %USERPROFILE%\.openclaw\openclaw.json */
export interface OpenClawConfig {
  gateway?: GatewayConfig
  agents?: AgentsConfig
  channels?: ChannelsConfig
  auth?: AuthConfig
  models?: ModelsConfig
  talk?: TalkConfig
  [key: string]: unknown
}

/** Talk (voice mode) config — `talk.*` in openclaw.json */
export interface TalkRealtimeProviderConfig {
  apiKey?: string
  model?: string
  speakerVoice?: string
  [key: string]: unknown
}

export interface TalkConfig {
  provider?: string
  providers?: Record<string, Record<string, unknown>>
  realtime?: {
    provider?: string
    providers?: Record<string, TalkRealtimeProviderConfig>
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** Custom / extended model provider entry */
export interface ModelProviderConfig {
  baseUrl?: string
  compatibility?: 'openai' | 'anthropic'
  /** Upstream field: model API kind */
  api?: string
  apiKey?: string
  /** Custom HTTP headers */
  headers?: Record<string, string>
  /**
   * Third-party `anthropic-messages` hosts that expect Bearer credentials (Synthetic, OpenCode Zen, Kimi Coding, Cloudflare gateway, etc.) use `true`. MiniMax (`api.minimax.io`) uses Anthropic-style `x-api-key` — omit or `false`. Use `false` for local proxies (e.g. copilot-proxy).
   */
  authHeader?: boolean
  models?: Array<Record<string, unknown> & { id: string; name?: string }>
}

/** Models section (CLI-aligned) */
export interface ModelsConfig {
  mode?: 'merge' | 'replace'
  providers?: Record<string, ModelProviderConfig>
}

// ─── WizardState ─────────────────────────────────────────────────────────────

/** Model provider id */
export type ModelProvider =
  | 'deepseek'
  | 'anthropic'
  | 'openai'
  | 'openai-codex'
  | 'google'
  | 'openrouter'
  | 'opencode'
  | 'mistral'
  | 'minimax'
  | 'moonshot'
  | 'moonshot-cn' // UI alias: moonshot with China endpoint (api.moonshot.cn)
  | 'zai'
  | 'venice'
  | 'groq'
  | 'xai'
  | 'cerebras'
  | 'huggingface'
  | 'github-copilot'
  | 'kilocode'
  | 'volcengine'
  | 'volcengine-plan'
  | 'byteplus'
  | 'byteplus-plan'
  | 'qianfan'
  | 'bedrock'
  | 'cloudflare-ai-gateway'
  | 'litellm'
  | 'together'
  | 'nvidia'
  | 'qwen-portal'
  | 'google-vertex'
  | 'google-gemini-cli'
  | 'ollama'
  | 'vllm'
  | 'lmstudio'
  | 'vercel-ai-gateway'
  | 'synthetic'
  | 'xiaomi'
  | 'kimi-coding'
  | 'chutes'
  | 'copilot-proxy'
  | 'kuae' // Kuae Cloud Coding Plan
  | 'local' // Local model (placeholder for upcoming offline model support)
  | 'custom'

/** Wizard model step data */
export interface ModelConfig {
  provider: ModelProvider
  apiKey: string
  modelId: string
  /** Moonshot endpoint region */
  moonshotRegion?: 'global' | 'cn'
  /** Custom provider: real provider id */
  customProviderId?: string
  /** Custom provider: API base URL */
  customBaseUrl?: string
  /** Custom provider: protocol compatibility */
  customCompatibility?: 'openai' | 'anthropic'
  /** OpenRouter: custom API endpoint (default https://openrouter.ai/api/v1) */
  openrouterBaseUrl?: string
  /** Cloudflare AI Gateway: Account ID */
  cloudflareAccountId?: string
  /** Cloudflare AI Gateway: Gateway ID */
  cloudflareGatewayId?: string
  /** Reasoning level for reasoning-capable models (UI naming) */
  reasoningLevel?: ReasoningLevel
}

/** Reasoning level shown in the UI; mapped to OpenClaw `thinkingDefault` on write. */
export type ReasoningLevel = 'off' | 'minimum' | 'medium' | 'high'

/** OpenClaw `agents.*.thinkingDefault` values we map to/from. */
export type OpenClawThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'adaptive'
  | 'max'

/** Wizard channel step data */
export interface ChannelConfig {
  telegram: TelegramChannelConfig | null
  discord: DiscordChannelConfig | null
  slack: SlackChannelConfig | null
  whatsapp: WhatsAppChannelConfig | null
  selectedChannel: 'webchat' | 'telegram' | 'whatsapp' | 'discord'
  skipChannels: boolean
}

/** Wizard gateway step data */
export interface GatewayWizardConfig {
  port: number
  bind: 'loopback' | 'lan' | 'auto'
  authToken: string
}

/** Wizard voice (realtime talk) step data */
export interface VoiceConfig {
  /** Realtime voice provider: 'google' (Gemini Live) or 'openai' (Realtime) */
  provider: 'google' | 'openai' | ''
  /** Provider API key (Google AI Studio / OpenAI platform) */
  apiKey: string
  /** True when the user chose to skip voice setup */
  skipVoice: boolean
}

/** Wizard progress (in-memory, Zustand) */
export interface WizardState {
  currentStep: number
  modelConfig: ModelConfig
  channelConfig: ChannelConfig
  gatewayConfig: GatewayWizardConfig
  voiceConfig: VoiceConfig
}

// ─── Voice settings (SettingsView section) ──────────────────────────────────

/** Settings → voice editor: load snapshot */
export interface VoiceSettingsLoadResult {
  hasConfig: boolean
  /** talk.realtime.provider set and non-empty */
  enabled: boolean
  provider: 'google' | 'openai' | ''
  /** Non-empty apiKey present in talk.realtime.providers.<provider> */
  hasKey: boolean
  model?: string
  voice?: string
}

/** Settings → voice editor: apply payload */
export interface VoiceSettingsApplyPayload {
  provider: 'google' | 'openai'
  /** New API key to persist; empty string keeps the existing key; null removes it */
  apiKey: string | null
  /** When true, restart Gateway after write so changes take effect immediately */
  restartGateway: boolean
}

/** Settings → voice editor: apply result */
export interface VoiceSettingsApplyResult {
  ok: boolean
  error?: string
  restarted?: boolean
}

/** Voice connection test (wizard step + settings section) */
export interface VoiceTestResult {
  ok: boolean
  /** Machine-friendly status: 'ok' | 'missing-key' | 'geo-blocked' | 'invalid-key' | 'network-error' */
  status?: string
  message?: string
}

// ─── WizardCompleteResult ─────────────────────────────────────────────────────

/** Result of wizard completeSetup */
export interface WizardCompleteResult {
  ok: boolean
  port?: number
  error?: string
  phase?: 'config' | 'auth' | 'gateway'
}

/** Result of wizard Telegram token probe (getMe) */
export interface WizardTestTelegramResult {
  ok: boolean
  botName?: string
  botId?: string
  /** Friendly error/status message for the UI */
  message?: string
}

/** Settings → model editor: load snapshot */
export interface ModelSettingsLoadResult {
  hasConfig: boolean
  modelConfig: ModelConfig
  /** Extra agents from `agents.list` (for per-agent model target) */
  agents: Array<{ id: string; name?: string; currentModel?: string }>
  /** Resolved default primary for display */
  defaultPrimaryDisplay?: string
}

/** Settings → model editor: apply payload */
export interface ModelSettingsApplyPayload {
  modelConfig: ModelConfig
  target: { kind: 'defaults' } | { kind: 'agent'; agentId: string }
  /** When true, restart Gateway after write so changes take effect immediately */
  restartGateway: boolean
}

/** Settings → model editor: apply result */
export interface ModelSettingsApplyResult {
  ok: boolean
  error?: string
  restarted?: boolean
  validationIssues?: Array<{ path: string; message: string }>
}

// ─── BundleManifest / AppVersionInfo ────────────────────────────────────────

/** Bundle manifest from prepare-bundle (About / Update Center) */
export interface BundleManifest {
  shellVersion: string
  bundledOpenClawVersion: string
}

/** Collected app version info */
export interface AppVersionInfo {
  shell: string
  electron: string
  node: string
  openclaw: string
}

// ─── GatewayStatus ───────────────────────────────────────────────────────────

/** Gateway lifecycle status */
export type GatewayStatusValue = 'starting' | 'running' | 'stopped' | 'error'

/** Gateway child process snapshot */
export interface GatewayStatus {
  running: boolean
  port: number
  pid: number | null
  uptime: number
  status: GatewayStatusValue
}

// ─── Registry (Skills / Extensions / Commands) ──────────────────────────────

/** Skill discovery source */
export type SkillSource = 'bundled' | 'user-workspace' | 'user-extensions' | 'load-path'

/** Extension discovery source */
export type ExtensionSource = 'bundled' | 'user-extensions' | 'load-path'

/** Skill registry row */
export interface SkillRegistryItem {
  id: string
  name: string
  description?: string
  source: SkillSource
  enabled: boolean
  path: string
  version?: string
  requires?: { bins?: string[]; env?: string[]; config?: string[] }
  conflict?: string
}

/** Extension registry row */
export interface ExtensionRegistryItem {
  id: string
  name: string
  description?: string
  source: ExtensionSource
  enabled: boolean
  path: string
  version?: string
  providers?: string[]
  tools?: string[]
  commands?: string[]
  error?: string
}

/** Plugin row from `openclaw plugins list --json` */
export interface PluginInfo {
  id: string
  name?: string
  status: 'loaded' | 'disabled' | 'error'
  description?: string
  source?: string
  origin?: string
  version?: string
  error?: string
}

/** Validation outcome */
export interface ValidationResult {
  ok: boolean
  errors?: string[]
  warnings?: string[]
}

/** Registry export summary */
export interface RegistryExportSummary {
  skills: string[]
  extensions: string[]
  exportedAt: string
}

// ─── Update / Verify / Repair ────────────────────────────────────────────────

/** GitHub release check result */
export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  releaseNotes?: string
  publishedAt?: string
  downloadUrl?: string
  error?: string
}

/** Bundled resources verification */
export interface BundleVerifyResult {
  ok: boolean
  nodeExists: boolean
  openclawExists: boolean
  missing: string[]
  versions: {
    shell: string
    electron: string
    node: string
    openclaw: string
  }
}

/** Pre-start check payload for the renderer */
export interface PrestartCheckFrontend {
  ok: boolean
  bundleOk: boolean
  configExists: boolean
  configParseable: boolean
  errors: string[]
  fixSuggestions: string[]
}

/** Post-update validation (rollback hints for Update Center) */
export interface PostUpdateValidationResult {
  ran: boolean
  ok: boolean
  report?: DiagnosticReport
  rollbackGuidance: string
}

// ─── Diagnostics (Doctor proxy) ────────────────────────────────────────────────

/** Diagnostic severity */
export type DiagnosticLevel = 'error' | 'warning' | 'info' | 'pass'

/** Single diagnostic line */
export interface DiagnosticItem {
  id: string
  level: DiagnosticLevel
  message: string
  fix?: string
  source?: 'cli' | 'prestart' | 'desktop'
}

/** Full diagnostic report */
export interface DiagnosticReport {
  ok: boolean
  items: DiagnosticItem[]
  runAt: string
}

// ─── Models page (v0.8.7) ─────────────────────────────────────────────────────

/** One row in the Models table */
export interface ModelTableEntry {
  providerId: string
  label: string
  /** Model id currently configured for this provider (primary candidate) */
  modelId: string
  /** Whether models.providers[providerId] exists */
  hasConfig: boolean
  hasApiKey: boolean
  status: 'primary' | 'fallback' | 'available' | 'local'
  /** Index in primary+fallbacks order, null when not in the chain */
  priority: number | null
  isLocal: boolean
}

/** Local GGUF model */
export interface LocalModelInfo {
  id: string
  fileName: string
  /** Human-readable name (preset name or file name) */
  name: string
  path: string
  sizeBytes: number
  downloaded: boolean
  status: 'none' | 'downloading' | 'ready'
  progress: number
}

/** llama.cpp engine state */
export interface LocalEngineState {
  running: boolean
  port: number
  modelId: string | null
  error?: string
  /** true when the engine was adopted from a pre-existing server (already warm) */
  adopted?: boolean
}

/** Local engine runtime snapshot for the desktop UI (CPU/GPU toggle + model bar) */
export interface LocalEngineRuntimeInfo {
  mode: 'auto' | 'cpu' | 'gpu'
  /** Resolved llama.cpp build variant */
  variant: 'cpu' | 'cuda' | 'vulkan'
  /** Which engine binaries are already downloaded on this PC */
  installedVariants: ('cpu' | 'cuda' | 'vulkan')[]
  /** Effective compute backend shown in the UI */
  effectiveGpu: 'cpu' | 'gpu'
  gpuVendor: 'nvidia' | 'amd' | 'intel' | 'other' | 'none'
  gpuName: string
  engineState: LocalEngineState
  models: LocalModelInfo[]
}

/** Lightweight engine status for the status-panel CPU/GPU indicators (v0.9.12) */
export interface LocalEngineStatus {
  running: boolean
  modelId: string | null
  mode: 'auto' | 'cpu' | 'gpu'
  variant: 'cpu' | 'cuda' | 'vulkan'
  effectiveGpu: 'cpu' | 'gpu'
  gpuName: string
  installedVariants: ('cpu' | 'cuda' | 'vulkan')[]
}

/** Full Models page payload */
export interface ModelsViewResult {
  entries: ModelTableEntry[]
  primary: string | null
  fallbacks: string[]
  localModels: LocalModelInfo[]
  engineState: LocalEngineState
  /** Local-engine runtime snapshot (installed variants, GPU info) — v0.8.30 */
  runtime?: LocalEngineRuntimeInfo
}

/** Models page: apply priority request */
export interface ModelsViewApplyRequest {
  primary: string | null
  fallbacks: string[]
  restart: boolean
}
