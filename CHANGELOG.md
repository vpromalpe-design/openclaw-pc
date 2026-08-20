# Changelog

All notable changes to OpenClaw Desktop will be documented in this file.

## [0.8.14] - 2026-08-20

### Added

- **First-message banner for local models**: when a local GGUF engine is cold-started (model loading into memory), the panel shows a prominent notice that the first message may take up to a minute and that subsequent replies will be faster. The banner appears on the first launch of the panel, disappears automatically once the engine answers its first chat request (or after 3 minutes / on "Got it"), and only shows again on a fresh cold start.
- **Installer versioning fixed**: the package version is now bumped with each release (was stuck at 0.8.8), so the installer is named `OpenClaw-PC-Setup-0.8.14.exe` and in-app auto-updates can actually detect newer versions again.

## [0.8.13] - 2026-08-20

### Fixed

- **Local engine starts BEFORE the gateway**: with a local/* primary model the engine now starts and becomes healthy (bounded 120s health wait, GPU→CPU fallback included) before the gateway accepts any chat. Previously the engine auto-start ran async after the gateway was already serving, so the first user message after setup could hit a cold port and fail with "network connection error" — with zero log lines and no UI hint.
- **Thinking/reasoning GGUFs no longer reply with silence** (Qwen3.5-*): those models dump the whole reply into `reasoning_content` and return an empty `content`, often burning the whole token budget without a final answer. The engine now launches with `--reasoning off` so chat completions always produce real content.
- **Connection test understands reasoning models**: the probe now sends a 1024-token budget and accepts a non-empty `reasoning_content` as proof the engine is generating, so "Проверить подключение" cannot falsely report "Модель не вернула ответ" on a healthy engine.
- **GPU auto-detection no longer trusts a broken CIM provider**: when the WMI/CIM probe fails (observed on the user's laptop) auto mode prefers the CUDA build if present and falls back to CPU only if it does not become healthy.
- **Engine startup is fully logged**: auto-start logs its phase (mode, model, OK/error) and engine-binary downloads are announced before they start — no more silent stalls.

## [0.8.12] - 2026-08-20

### Fixed

- **Local connection test no longer lies**: "Проверить подключение" (Test Connection) retries busy/loading/empty-reply states until the deadline instead of failing with "Модель не вернула ответ" the first time the engine is mid-generation or warming up. 503/429 and socket timeouts are retryable; a wrong model or HTTP error fails immediately with an honest message.
- **Successful local test now shows a green "Модель ответила"** (was "Подключение установлено").

### Changed

- `testLocalEngineChat` verifies the `model` field of the engine response: if llama-server answers with a different GGUF than selected, the test reports it explicitly ("Движок отвечает моделью X, а не Y") instead of a generic failure.

## [0.8.11] - 2026-08-20

### Fixed

- **Engine adoption could silently serve the wrong model**: `startLocalEngine` trusted any HTTP-200 server on port 18788 without checking which model it actually loaded. An orphaned llama-server (left over from a previous app instance or a manual start) holding the port with a different GGUF was adopted, so the UI claimed the selected model was active while replies came from the stale one. The app now adopts a server only when `/v1/models` reports the requested model; otherwise it force-kills the stale process (`netstat`+`taskkill`) and spawns its own engine with the correct model.
- Model name matching is normalized (basename, `.gguf` stripped, Windows paths, case) with prefix matching only for stems ≥ 7 chars so `gemma` never aliases `gemma4-v2-Q4_K_M`.

## [0.8.10] - 2026-08-20

### Fixed

- **Local GGUF models appended "NO_REPLY" to real replies**: the `## Silent Replies` system-prompt section instructed them to reply with the literal token. The section is now suppressed for models whose id starts with `local/` (cloud models keep it).

## [0.8.9] - 2026-08-20

### Changed

- **Tool calling re-enabled for local GGUF models** after live verification against the bundled llama.cpp engine (31-tool request returned HTTP 200 with the exact schemas the app sends). Previous releases disabled tools for the `local` provider.

## [0.8.8] - 2026-08-18

### Changed

- **Welcome screen redesigned**: three feature cards in a row, start button centered and raised, original OpenClaw logo image instead of a text mark.
- **Wizard**: removed the "Skip, WebChat only" checkbox — WebChat remains the default channel and Telegram/Discord stay optional.
- **Accent color** switched to the brand coral `#E43F3F` in both light and dark themes.
- **DeepSeek listed last** among cloud providers.
- **Download progress on the model button**: live percentage fill turning into a green "Downloaded" state with a checkmark when the model finishes.
- **Models page**: each cloud provider row expands into a settings panel (model picker with presets or free input, API key with show/hide, Base URL + API compatibility for custom providers) with a "Test Connection" button that turns green "Connected" on success and a "Save" button that persists the key and model into the config.
- **Models page**: "Active local model" selector lists every downloaded GGUF model (including ones added from disk); "Test Connection" starts the local engine with the chosen model and shows a green "Connected" status once it is ready.

- **Local model presets reworked to Qwen 3.5**: **Normal** (Qwen 3.5 4B, runs on any PC), **Hard** (Qwen 3.5 9B, best quality) and **Experimental** (same 9B model, but with tool calling enabled — llama.cpp may reject some tool schemas, opt-in by design). The wizard and the Models page show an `Experimental` badge on the third preset. GGUF files are fetched straight from the Ollama registry (official model blobs are plain GGUF).
- **Add a model from disk**: new "From disk…" button in the wizard and on the Models page opens a file picker for a local `.gguf` file and copies it into the models folder (previously only a download URL was supported).
- **Brand accent**: wizard/settings accent switched from orange (`#FF4500`) to the official OpenClaw coral palette — deep wine red `#9C3222` (light) / `#C24028` (dark).
- **Wizard no longer disables tools for API providers**: `compat.supportsTools: false` and the 32k local context window are now applied only to the `local` provider (previously `buildDefaultProviderModel` forced them on DeepSeek/cloudflare/custom too, silently disabling tools for cloud models).

### Added

- **Local engine auto-start on app launch**: when the primary agent model is `local/*`, the llama.cpp engine now starts itself (no manual button needed after reboot).
- **Engine state adoption**: if `llama-server` is already listening on `127.0.0.1:18788` (e.g. started manually), the app adopts it instead of spawning a second server.

### Fixed

- **Local agents failed with `provider rejected the request schema or tool payload`** (field report 2026-08-18): llama.cpp rejects OpenAI tool schemas whose regex `pattern` lacks `^`/`$` anchors (HTTP 400 during JSON-schema→grammar conversion). The `local` provider now registers with `compat.supportsTools: false` — local GGUF models run tool-free and reply normally. Applied both in the wizard-generated config and in the engine's provider registration.
- Engine now starts with `-c 32768` (the 1.5B model's native max context) and writes `server.log` for diagnostics; deprecated `--no-webui` replaced with `--no-ui`.
- **Local agents failed with `Context size has been exceeded`** (field report 2026-08-18): the `local` model advertised `contextWindow: 128000` while the engine ran with `-c 8192`, so llama-server rejected chats whose history exceeded the real limit. The engine now starts with `-c 32768` and the provider model is written as `contextWindow: 30720` / `maxTokens: 2048` (input + output fit inside n_ctx) in both the wizard and engine registration.
- **Context-window auto-sync on engine adoption**: when `llama-server` is already running (manual start, older build), the app reads the server's real `n_ctx` from `/props` and caps the provider model's `contextWindow` accordingly — a desynced config can never cause HTTP 400 again.
- **Corrupted `agents.defaults.workspace` self-heals**: if the workspace path was mangled by an ANSI read/write round-trip (e.g. editing `openclaw.json` with PowerShell without `-Encoding UTF8` — cyrillic paths turn into mojibake and every agent message fails with `ENOENT: mkdir`), the app detects the mojibake signature at startup and falls back to the standard workspace path.
- **Compaction reserve capped for local models**: OpenClaw reserves ~half the context window for auto-compaction, which left a 16k-window 1.5B model with only ~6k tokens (now 32k window, ~27k usable) of history before `Context overflow (precheck)` blocked the agent. The wizard and engine registration now write `agents.defaults.compaction.reserveTokensFloor: 3072` when unset, roughly tripling the usable history.
- The engine no longer overwrites an existing `local` provider entry: configured model id/name (and any custom fields) are preserved, so a set primary like `local/qwen2.5-1.5b` keeps resolving.

## [0.8.7] - 2026-08-17

### Added

- **Models page** in the desktop sidebar: a full table of every configured provider/model with its priority chain, reorder controls (↑/↓), and a **Connect** action that writes `agents.defaults.model = { primary, fallbacks[] }` — OpenClaw automatically falls back down the chain on rate limits, 5xx or timeouts. Changing the chain applies the config with a backup + atomic write + crash-loop rollback, then restarts the gateway safely.
- **Local models (offline, Windows)**: three one-click presets (Qwen 2.5 0.5B / 1.5B / 3B GGUF) plus a custom GGUF URL field, background downloads with live progress, and a built-in **llama.cpp engine** (`llama-server` on `127.0.0.1:18788`) with start/stop controls. The engine registers the `local` provider automatically.
- **Setup wizard: real local-model picker** — local is the first provider option and now offers the three GGUF presets (or your own GGUF URL) with a download button instead of the old "coming soon" placeholder.
- **Russian language**: the whole desktop UI (wizard, dashboard, settings, tray menu) is fully translated; `ru`/`be`/`uk` system locales are detected automatically.
- **Working Reasoning level control** (off / minimum / medium / high) in the wizard and model settings — writes `agents.defaults.thinkingDefault` (previously the control was cosmetic and never persisted).

### Changed

- Wizard buttons enlarged; provider list reordered with **Local first** (badge); 22 monochrome provider logos (simple-icons) in wizard and models table.
- Archive extraction (llama.cpp install) now goes through PowerShell `-EncodedCommand` (UTF-16LE) so non-ASCII user paths such as `C:\Users\Дамир\` survive intact.

### Fixed

- Vite dev dependency pinned to a non-broken build (vite@6.4.1).

## [0.8.6] - 2026-08-17

### Fixed

- **A Telegram bot configured through the wizard stayed silent** (field report 2026-08-17: the bot never answered; the token was valid and the channel looked configured). Two compounding causes, both now handled at setup time:
  1. The wizard wrote only `botToken` — the channel was **not enabled** and had **no owner allowlist**, so it never started and ignored every message. The wizard now writes a complete, schema-valid channel config: `enabled: true`, `botToken`, `allowFrom: [<your user id>]`, `dmPolicy: "pairing"`.
  2. **SOCKS5 proxies do not work reliably from the bundled Node runtime** (experimental support; all outbound Telegram calls failed with `Network request failed` while the same proxy worked from curl). The new setup step warns about this and prefers an HTTP(S) proxy or VPN.

### Added

- **Telegram setup in the wizard now asks for your Telegram user ID** (numeric, from @userinfobot) in addition to the bot token — so the bot answers only you, out of the box.
- **"Test token" button** in the Telegram setup step: validates the token live via Telegram `getMe`, shows the bot name (e.g. `@LocallliPC_bot`) and gives actionable errors: wrong token, Telegram blocked in the current network (→ enable VPN), proxy unreachable, or SOCKS5-unsupported hint.
- **Optional proxy field** in the Telegram setup step (HTTP/HTTPS only, e.g. `http://127.0.0.1:7890`) — written to `channels.telegram.proxy` (schema-valid location, unlike the old `channels.telegram.network.proxy` that crashed the gateway with InvalidConfig).

### Changed

- Channel step validation requires both the bot token **and** the owner user ID before you can finish the wizard.

## [0.8.5] - 2026-08-17

### Fixed

- **Setup wizard produced an invalid config on every run** (regression from 0.8.2). The wizard persisted the API key *inline* inside `auth.profiles.<id>` in `openclaw.json`; the bundled OpenClaw 2026.7.1 schema rejects `apiKey`/`key` in auth profiles (`Unrecognized key`), so any wizard run with a key entered produced an invalid config and the gateway crashed on startup with `Invalid input` (exit 78). The static profile now carries `provider` + `mode` only; the key lives in the portable `auth-profiles.json` store (main agentDir), which subagents also inherit.
- **DeepSeek no longer works on a fresh install.** The desktop bundle maps provider id `deepseek` to the `@openclaw/deepseek-provider` plugin, which is not bundled and cannot be auto-installed on end-user machines (no npm) — the gateway failed to start with `Failed to install missing configured plugin "deepseek"`. The wizard now emits DeepSeek as a **custom OpenAI-compatible provider** (`deepseek-direct`) with `baseUrl https://api.deepseek.com`, `api: openai-completions` and the apiKey inline in `models.providers` — schema-valid and plugin-free, so a new user can select DeepSeek, paste a key and chat.
- **Settings editor now recognizes the `deepseek-direct` provider id** and shows it back as DeepSeek.

### Changed

- **Provider order in the wizard:** DeepSeek now appears **after Anthropic and OpenAI** (previously first), matching the common choice order.
- **New "Local Model" placeholder item** in the provider list — reserved for offline local models (coming in a future version). Selecting it shows a "coming soon" note and blocks advancing; no functional model yet.

## [0.8.3] - 2026-08-17

### Fixed

- **Gemini/Google provider broken after every setup-wizard run.** The wizard wrote `baseUrl: https://generativelanguage.googleapis.com/v1beta` without the OpenAI-compatible suffix and without `api`, so OpenClaw treated the provider as plugin-native, resolved an empty model list and the chat stayed silent. The seed now emits `…/v1beta/openai` + `api: openai-completions` and tags each Gemini model with `api: openai-completions` and vision input — mirroring the known-working config. Reinstalling and re-running the wizard no longer regresses the Google provider.

## [0.8.2] - 2026-08-16

### Fixed

- **API keys now persist into `openclaw.json` static auth profiles.** Previously the wizard and the provider settings screen stored keys only in the per-agent `auth-profiles.json`, which subagents cannot see — creating a subagent failed with `No API key found for provider …` (`missing-provider-auth`). The key is now written into `auth.profiles.<id>.apiKey` in the config as well, so subagents inherit it (portable static auth profiles).

## [0.8.1] - 2026-08-16

### Fixed

- **DeepSeek connection test in the setup wizard:** the wizard's testable-provider list was missing `deepseek`, so the "Test connection" button stayed disabled. It is now enabled.
- **DeepSeek connection probe in the main process:** `model-tester` had no `deepseek` provider config, so the test would have failed even from the settings screen. Added an OpenAI-compatible probe against `https://api.deepseek.com/chat/completions`.

## [0.8.0] - 2026-08-16

### Added

- **DeepSeek API provider** in the setup wizard and provider presets: `deepseek` model family (`deepseek-chat`, `deepseek-reasoner`, `deepseek-v4-flash`, …), `sk-` API key input with connection test.
- **Multiple model providers** supported side by side in the wizard/shell — switch the active model in real time.

### Changed

- **Bundled OpenClaw:** npm `2026.4.2` → **`2026.7.1`** (built from the `v2026.7.1` GitHub tag sources for the Electron Control UI).
- **Bundled Node.js:** `22.16.0` → **`22.23.2`** (OpenClaw 2026.7.1 requires Node ≥22.22.3).
- **Release:** Shell **`0.8.0+openclaw.2026.7.1`**; Git release tag **`v0.8.0+openclaw.2026.7.1`**.
- **Bundle pipeline adapted to the 2026.7.1 pnpm monorepo:** workspace packages (`@openclaw/media-core`, `@openclaw/normalization-core`, `@openclaw/ai`, `gateway-protocol`, …) are vendored and built with tsdown, `workspace:*` refs are rewritten to `file:`, hoisted root deps (`@lit/context`, …) are mirrored into `ui` devDependencies, and `@openclaw/uirouter` / `@openclaw/libterminal` are installed into the bundle root for the Vite aliases.
- **Verify:** `verify-bundle` prefers the Linux node binary on non-Windows hosts; CLI checks (`doctor`/`config`/`backup`/`plugins`/`gateway run`) pass against 2026.7.1.

## [0.7.0] - 2026-04-03

### Changed

- **网关就绪判定：** 首次启动后仅在 **TCP 端口可连** 且 **GET `/`（含 token 查询串）返回非 5xx** 后才将状态标为 `running`，避免 Control UI 仍在插件探测 / 认证栈初始化时出现 HTTP 500 时 iframe 已显示错误页（`process-manager.ts`）。
- **网关绑定类型：** `GatewayLaunchOptions.bind` 与上游对齐，补充 **`tailnet`** / **`custom`**（`process-manager.ts`、`shared/types.ts`）。
- **随包 OpenClaw 收尾：** `download-openclaw` 在多种路径下统一执行 **飞书 Lark SDK 注入**、**Feishu registerFull 补丁**、**Slack 通道剥离补丁**；npm 临时目录改为每次唯一路径，减轻 Windows 下 `_openclaw_tmp` 锁定导致安装失败（`download-openclaw.ts`、新脚本 `ensure-openclaw-feishu-sdk.ts`、`patch-openclaw-strip-slack-channel.ts`）。
- **打包与校验：** `prepare-bundle` / `verify-bundle` / `verify-packaged-win` 等与上述资源布局一致；smoke 与网关响应头相关脚本同步。
- **Release：** Shell **`0.7.0+openclaw.2026.4.2`**；Git 发行标签 **`v0.7.0+openclaw.2026.4.2`**。捆绑 OpenClaw 仍为 npm **`2026.4.2`**（与 `openclaw@latest` 一致）。
- **文档：** `README.md` / `README.zh-CN.md` / `CONTRIBUTING.md` / `release.yml` 示例与 **0.7.0** 及 **2026.4.2** 钉扎对齐。

## [0.6.6] - 2026-04-03

### Changed

- **Bundled OpenClaw：** 升至 npm **2026.4.2**（与当前 `openclaw@latest` 一致）。完整上游说明：[openclaw/openclaw v2026.4.2](https://github.com/openclaw/openclaw/releases/tag/v2026.4.2)。
- **Release：** Shell **`0.6.6+openclaw.2026.4.2`**；Git 发行标签为 **`v` + `package.json` 的 `version`**，例如 **`v0.6.6+openclaw.2026.4.2`**。
- **文档：** `README.md` / `README.zh-CN.md` / `CONTRIBUTING.md` / `release.yml` 示例标签与 **2026.4.2** 钉扎及上游摘要对齐。

### Notes（与桌面壳 / 用户配置）

- **破坏性（需迁移）：** X（xAI）插件将 **`x_search`** 配置从旧路径 `tools.web.x_search.*` 迁至 **`plugins.entries.xai.config.xSearch.*`**，认证统一到 **`plugins.entries.xai.config.webSearch.apiKey` / `XAI_API_KEY`**；Firecrawl 将 **`web_fetch`** 从 `tools.web.fetch.firecrawl.*` 迁至 **`plugins.entries.firecrawl.config.webFetch.*`**。上游提供 **`openclaw doctor --fix`** 做旧配置迁移（参见上游 Release #59674、#59465）。
- **与本项目相关：** 上游修复 **网关 loopback 配对** 后本地 exec / 子代理在 **2026.3.31** 后出现的配对类错误（如 #59092、#59555）；桌面仍通过 **`node` + `openclaw.mjs gateway run`**（`--allow-unconfigured`、`--bind`、`--port`、可选 `--token`）启动，**`OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` / `OPENCLAW_AGENT_DIR`** 与内嵌 Control UI（GitHub 标签源码 + Vite + Electron 兼容构建）流程不变；若你自定义了 **x_search** 或 **Firecrawl web_fetch**，升级后请运行 **`openclaw doctor`** 并按提示修复。

## [0.6.4] - 2026-04-03

### Fixed

- **主界面 / Control UI / Internal Server Error（续）：** 上游 `checkBrowserOrigin` 在 **WebSocket** 上若 **`Origin` 缺失或为字面量 `null`** 会直接拒绝（早于 loopback 放行）。Electron 内嵌 iframe 可能出现该情况。现于主进程 **`webRequest.onBeforeSendHeaders`** 对发往本机网关端口的环回请求补全 `Origin`（`gateway-request-origin.ts`、`index.ts`）。对 **`gateway.bind` 为 loopback 或未设置** 且 **`gateway.controlUi.allowedOrigins` 未配置或为空数组** 的配置，迁移与写盘合并 **`allowedOrigins: ["*"]`**（与上游 allowlist 逻辑一致；不覆盖用户已有非空列表）。**向导**在 **`bind === 'loopback'`** 时生成的 `openclaw.json` 同步写入上述 `allowedOrigins`（`setup-handler.ts`）。
- **打包：** `prepare-bundle` 复制随包 OpenClaw 后 **移除 `dist/extensions/amazon-bedrock`**，该扩展依赖未打入安装包的 `@aws-sdk/client-bedrock`，否则会每次启动刷屏告警（`prepare-bundle.ts`）。

## [0.6.3] - 2026-04-02

### Fixed

- **主界面 / Control UI / 配置：** 上游 OpenClaw **2026.3.x** 在内嵌 iframe 下需 `gateway.controlUi.allowInsecureAuth` 与 `dangerouslyDisableDeviceAuth`。此前若 `openclaw.json` **缺少整段 `gateway`**（CLI/手改配置常见），迁移会跳过，子进程仍读磁盘旧文件并可能 **HTTP 500**。现对非 `remote` 网关始终合并上述字段；且 **`writeOpenClawConfig` 在每次写盘前再次合并**，避免设置/导入等路径覆盖后丢失标志；写盘增加短暂重试以减轻 Windows 下偶发锁文件导致迁移未落盘的问题（`openclaw-config.ts`）。

## [0.6.2] - 2026-04-01

### Changed

- **发布与 Git 标签：** 自本版起，**发行版 Git 标签**与根目录 `package.json` 的 **`version` 字段一致并加前缀 `v`**，例如 **`v0.6.2+openclaw.2026.3.31`**，后缀 **`+openclaw.<捆绑 OpenClaw 版本>`** 与钉扎 `openclawBundleVersion` 对齐，便于对照安装包内捆绑运行时。手动触发 `Release` 工作流时请在输入框填写**完整标签名**（含 `+`）；PowerShell 下若命令行打 tag，请给标签加引号。

## [0.6.1] - 2026-04-01

### Fixed

- **主界面 / Control UI：** 上游 OpenClaw **2026.3.x** 对 Control UI 的 **device identity** 与环回认证更严格，Electron 内嵌 iframe 下仅设置 `gateway.controlUi.allowInsecureAuth` 仍可能出现 **HTTP 500 Internal Server Error** 或 WebSocket 握手失败。现对**非 remote** 网关自动写入 **`allowInsecureAuth: true`** 与 **`dangerouslyDisableDeviceAuth: true`**（并覆盖用户误设的 `false`），与向导新建配置一致（`openclaw-config.ts`、`setup-handler.ts`）。详见上游相关讨论（如 device-identity / Control UI HTTP 问题）。

## [0.6.0] - 2026-04-01

### Fixed

- **Control UI / `package.json`：** `ensureOpenClawRootDepsForBundledSrc` 为解析 `../src/**` 曾写入临时 stub `package.json`（`0.0.0`），构建结束后未还原，导致 `build/openclaw`（及随后同步的 `resources/openclaw`）与 `.openclaw-version` 版本不一致，`check-openclaw-versions` 失败。现于 root `npm install` 后 **写回 GitHub 标签解压得到的真实 OpenClaw `package.json`**（`scripts/ensure-openclaw-control-ui.ts`）。
- **prepare-bundle / 资源同步：** 当 `resources/openclaw` 仅因版本标记相同而 **跳过复制** 时，可能仍保留上述 stub 清单。现检测 `package.json` 的 `name === "openclaw-desktop-control-ui-openclawroot"` 时 **强制从 `build/openclaw` 重拷**（`scripts/prepare-bundle.ts`）。

### Changed

- **Release：** Shell **`0.6.0+openclaw.2026.3.31`**；Git 标签 **`v0.6.0`**。捆绑 OpenClaw 仍为 **2026.3.31**（`openclawBundleVersion` 未变）。
- **文档：** `README.md` / `README.zh-CN.md` / `CONTRIBUTING.md` / `release.yml` 示例 tag 与 **v0.6.0** 对齐。

## [0.5.0] - 2026-03-31

### Changed

- **Bundled OpenClaw：** 自 **2026.3.28** 升至 **2026.3.31**（npm `latest`）。上游含飞书相关修复：`hooks.mappings[].channel` 接受 `feishu`（[#56226](https://github.com/openclaw/openclaw/issues/56226)）、群组引用回复与 allowlist 对齐等；完整说明见 [v2026.3.31](https://github.com/openclaw/openclaw/releases/tag/v2026.3.31) / [npm 摘要](https://newreleases.io/project/npm/openclaw/release/2026.3.31)。破坏性项包括：`nodes.run` 壳封装移除、插件安装/技能依赖扫描默认失败关闭、`trusted-proxy` 与 Node 配对/命令面收紧等（详见上游 Release）。桌面仍对随包 `dist` 执行 `patch-openclaw-feishu-register-once`；**2026.3.31** 起 Feishu 打入 `dist/extensions/feishu/index.js`，补丁已覆盖该路径，避免 `registrationMode: full` 下重复 `registerFull`。
- **Release：** Shell **`0.5.0+openclaw.2026.3.31`**（延续 `主版本+openclaw.<捆绑 OpenClaw 版本号>` 命名）；Git 标签 **`v0.5.0`**。
- **文档：** `README.md` / `README.zh-CN.md` / `CONTRIBUTING.md` 与 **2026.3.31** 钉扎及上游摘要对齐；历史条目见本文件。
- **CI：** `release.yml` 手动发布示例 tag 更新为 `v0.5.0`。

## [0.4.11] - 2026-03-31

### Changed

- **Bundled OpenClaw:** 升级至 npm **2026.3.28**（[上游 v2026.3.28](https://github.com/openclaw/openclaw/releases/tag/v2026.3.28)）。相对 2026.3.24 含大量通道/网关/CLI 修复与行为变更；破坏性项包括：Qwen 弃用 `qwen-portal-auth`、Doctor 不再自动迁移两个月前的旧配置键。
- **向导 MiniMax 预设：** 下拉选项与上游目录一致，仅保留 **M2.7** 系列（移除已弃用的 M2 / M2.1 / M2.5 / VL-01）。
- **飞书 `registerFull` 补丁：** 上游将 Feishu 打入 `dist/auth-profiles-*.js` 后，原 `dist/feishu-*.js` 补丁不再命中；现同时扫描 `auth-profiles-*.js` 并注入一次性防护。`prepare-bundle` 在 OpenClaw 因版本相同跳过复制时仍会对 `resources/openclaw` 打补丁，避免随包资源缺补丁。
- **Release：** Shell `0.4.11+openclaw.2026.3.28`；`prepare-bundle` 后 `resources/bundle-manifest.json` 与 `package.json` 对齐。

## [0.4.10] - 2026-03-27

### Added

- **设置 → 模型：** 新增「模型」区块，可从 `openclaw.json` 加载当前默认/按 Agent 的模型配置，编辑提供商、模型 ID、API Key（及 Moonshot 区域等），支持连接测试，并写回配置与 `auth-profiles`（与向导逻辑对齐）。
- **打包：** 对随包 OpenClaw 飞书通道做 `registerFull` 一次性防护补丁（`patch-openclaw-feishu-register-once`），避免 `registrationMode: full` 下重复注册工具并刷屏日志。

### Changed

- **Release：** Shell `0.4.10+openclaw.2026.3.24`；`prepare-bundle` 后 `resources/bundle-manifest.json` 与 `package.json` 对齐。

## [0.4.9] - 2026-03-27

### Fixed

- **MiniMax / wizard:** Align generated `openclaw.json` with onboard-style configs: `auth.order.minimax` uses `["global"]`, `agents.defaults.model.primary` uses the bare model id, `models.providers.minimax` includes `apiKey` alongside auth-profiles, and config load keeps the inline key (sync to `minimax:global` without stripping JSON). Migration rewrites legacy `["minimax:global"]` order entries to `["global"]`.
- **Wizard model list (MiniMax):** Default preset is `MiniMax-M2.7-highspeed` (first in list); dropdown labels use the exact API model ids (including `-highspeed` / hyphen suffixes) so they match `openclaw.json`.

### Changed

- **Release:** Shell `0.4.9+openclaw.2026.3.24`; `resources/bundle-manifest.json` `shellVersion` aligned with `package.json`.

## [0.4.8] - 2026-03-27

### Fixed

- **Setup wizard (MiniMax):** Default `models.providers.minimax.baseUrl` uses `https://api.minimaxi.com/anthropic`, matching working user configs; `api.minimax.io` can break Anthropic-compatible routing for some accounts.

### Changed

- **Release:** Shell `0.4.8+openclaw.2026.3.24`; `resources/bundle-manifest.json` `shellVersion` aligned with `package.json`.

## [0.4.7] - 2026-03-27

### Changed

- **Release:** Bump Shell version to `0.4.7+openclaw.2026.3.24`; `resources/bundle-manifest.json` `shellVersion` aligned with `package.json`.

## [0.4.6] - 2026-03-28

### Changed

- **CI / Release:** Document pnpm `cache: pnpm` behavior; set `cache-dependency-path: pnpm-lock.yaml` on `setup-node`; print checkout ref + SHA + one-line log in verify / release jobs for build provenance. Windows packaging: widen Electron binary cache key with `electron-builder.config.cjs` / `electron-builder.yml` so invalidation tracks builder config changes, not only the lockfile.
- **Gateway:** When a MiniMax auth profile is configured and inherited `MINIMAX_*` env keys are stripped for the child process, log whether the guard ran and which keys were removed (or that none were present).

## [0.4.5] - 2026-03-27

### Fixed

- **Release metadata:** `resources/bundle-manifest.json` `shellVersion` is aligned with `package.json` so `check-openclaw-versions` / packaged builds report the correct shell version (follow-up to v0.4.4 tag pointing at a commit before manifest sync).

## [0.4.4] - 2026-03-27

### Fixed

- **MiniMax HTTP 401 (follow-up):** Run config migrations **immediately before spawning the gateway** so `openclaw.json` on disk is corrected before the child reads it. MiniMax `anthropic-messages` entries now persist **`authHeader: false` whenever it was not already `false`** (not only when it was `true`), so upstream rewrites cannot leave an ambiguous default that still sends Bearer.
- **MiniMax env vs profile:** When `auth.profiles` includes a `minimax:*` profile, the gateway child environment no longer passes through `MINIMAX_API_KEY` / `MINIMAX_CODE_PLAN_KEY` from the desktop process, so profile-based credentials are not overridden by stray shell env.

### Changed

- **Gateway logs:** Dedupe repeated Feishu tool registration lines within a short window and emit a single summary line when many repeats are suppressed.

## [0.4.3] - 2026-03-26

### Fixed

- **MiniMax 401 when `openclaw.json` key looks correct:** OpenClaw resolves credentials as **auth-profiles.json → env → `models.providers.*.apiKey`**. A stale **`minimax:global`** entry in `auth-profiles.json` overrides the key embedded under `models.providers.minimax`, so edits to JSON alone could still yield `invalid api key`. On config load (and after wizard / provider config writes), **`models.providers.minimax.apiKey` is synced into `minimax:global` and removed from JSON** so the profile and gateway always agree. The setup wizard no longer duplicates API keys into `models.providers` for providers that use auth profiles.

## [0.4.2] - 2026-03-26

### Fixed

- **MiniMax HTTP 401 `invalid api key`:** MiniMax’s Anthropic-compatible API (`https://api.minimax.io/anthropic`) expects **Anthropic-style `x-api-key`** (official docs: `ANTHROPIC_API_KEY` + Anthropic SDK). The shell had set `authHeader: true` (**Bearer**), which MiniMax rejects even when the key is valid. The MiniMax seed no longer sets Bearer; existing `openclaw.json` entries are migrated to **`authHeader: false`** on load. The blanket third-party `anthropic-messages` migration **excludes** MiniMax; OpenCode Zen, Kimi Coding, Synthetic, Cloudflare AI Gateway, etc. are unchanged.

### Changed

- **Feishu DM pairing notifications:** Replaced the 12s polling loop with **`fs.watch` on `~/.openclaw/credentials`** (debounced) so pairing JSON updates drive notifications; **dedupe by `openId`** and a short throttle when `openId` is missing to avoid repeated toasts when the pairing code rotates.

## [0.4.1] - 2026-03-26

### Changed

- **Setup wizard:** Before writing `openclaw.json` and `auth-profiles.json`, the wizard now **sanitizes** (trims) API keys, model IDs, custom provider fields, Cloudflare gateway fields, and the gateway auth token so pasted values match runtime configuration.
- **Custom provider:** Wizard output now includes an **`agents.defaults.models`** alias entry for the selected model, consistent with built-in provider seeds from `ensureProviderSeedConfig`.

## [0.3.4] - 2026-03-26

### Fixed

- **MiniMax / third-party Anthropic HTTP 401:** Aligned with OpenClaw `extensions/minimax/onboard.ts` by setting **`authHeader: true`** on `anthropic-messages` providers that target non-`api.anthropic.com` hosts (MiniMax, Synthetic, OpenCode Zen, Kimi Coding, Cloudflare AI Gateway). Existing `openclaw.json` entries are migrated on load. Custom Anthropic-compatible bases get the same flag when the URL is not Anthropic’s official API.

## [0.3.3] - 2026-03-26

### Fixed

- **MiniMax (401):** OpenClaw and the setup wizard use auth profile **`minimax:global`**, but the LLM API path normalized `default` to **`minimax:default`**, so the gateway looked up the wrong profile. `normalizeAuthOrderEntry` now maps MiniMax `default` / `minimax:default` → **`minimax:global`**; `auth-profiles.json` migration renames `minimax:default` to `minimax:global` when needed.

## [0.3.2] - 2026-03-26

### Fixed

- **Model auth (401) hardening:** LLM API “save profile” now always stores credentials under **canonical profile ids** (`provider:name`) via `normalizeAuthOrderEntry`, matching `auth.order`. Startup migrates shorthand keys in `auth-profiles.json`; reading `openclaw.json` normalizes `auth.order` entries. Custom provider / wizard auth writes trim API keys. Delete profile accepts optional `provider` and resolves ids consistently with save.

## [0.3.1] - 2026-03-26

### Fixed

- **Upstream model auth (401):** Wizard-generated `auth.order` now uses **full profile IDs** (e.g. `minimax:global`) to match OpenClaw’s configuration reference and the LLM API “save profile” path. `addProfileToAuthOrder` / `removeProfileFromAuthOrder` normalize shorthand entries (`global` vs `minimax:global`) so the gateway resolves the same credential as `auth-profiles.json`.
- **Xiaomi MiMo seed config:** Provider seed uses `https://api.xiaomimimo.com/v1` with `openai-completions`, aligned with upstream provider docs (was incorrectly pointed at an Anthropic-style path).

### Changed

- **Wizard model presets:** Provider/model dropdowns updated to match bundled OpenClaw **2026.3.23-2** (MiniMax M2.7 lineup, xAI Grok catalog, Synthetic `hf:*` IDs, Kilo `kilo/auto`, Volcengine naming, Vercel ordering, etc.). See `src/renderer/constants/provider-presets.ts`.

## [0.3.0] - 2026-03-25

### Fixed

- **Embedded Control UI:** Removed the WebSocket **operator pre-probe** (`gateway:probeOperator`) that blocked the main iframe until a main-process RPC connect succeeded. On some gateway builds the probe never completed (repeated `[ws] closed before connect` / code 1005) while the browser Control UI could still connect, which left the shell stuck on **Gateway starting**. The shell again mounts the Control UI iframe as soon as the gateway is **running** and the control URL (with token hash) is known—same as pre-0.3.0 behavior, so the console always loads.
- **Config read timeout:** When building the control URL, `config:read` is raced with a **10s** timeout so a hung IPC cannot leave the shell on the loading screen indefinitely (falls back to a URL without `#token=`).

## [0.2.22] - 2026-03-25

### Fixed

- **Control UI (Lit field decorators in Electron):** Before building OpenClaw `ui/` from GitHub sources, apply desktop-only Vite/tsconfig patches so Lit `@property` / `@state` emit legacy decorator semantics Chromium in Electron accepts; remove any prepackaged npm `dist/control-ui` so the bundle is always rebuilt with that config. Track installs with `.electron-lit-compat-v1` and rebuild when the marker is missing (avoids `Unsupported decorator location: field` at runtime).

## [0.2.21] - 2026-03-25

### Fixed

- **Control UI (embedded gateway dashboard):** After the upstream Vite build, run a **desktop-only** esbuild pass on `dist/control-ui` (`target: chrome130`) so TC39 decorators and similar syntax no longer crash the Electron renderer (black screen). No changes to the OpenClaw upstream repo.
- **In-app updates:** Map shell “stable” channel to electron-updater channel **`latest`** so GitHub **`latest.yml`** is fetched instead of a non-existent **`stable.yml`**.

## [0.2.20] - 2026-03-25

### Changed

- **Electron:** Upgrade to **41.x** (Chromium **146**) so the embedded browser can parse modern gateway Control UI bundles that rely on current JS syntax (e.g. class decorators), closer to system Chrome.

### Fixed

- **Gateway response headers:** Only apply CSP / `frame-ancestors` relaxation on `mainFrame` / `subFrame` responses; do not inject synthetic CSP on `script` and other subresource types (avoids breaking JS module loads).

## [0.2.18] - 2026-03-25

### Changed

- **Release CI:** Workflow sets `OPENCLAW_SKIP_NPM_LATEST_CHECK=1` so `check-openclaw-versions` validates the committed pin + `bundle-manifest` + on-disk artifacts without querying or warning against npm `openclaw@latest`.

### Documentation

- **README.md / README.zh-CN.md:** Describe pinned OpenClaw (`openclawBundleVersion`), current bundle `2026.3.23-2`, and the CI/version-check behavior; align installer filename and download table with **v0.2.18**.

### Added

- **`scripts/check-openclaw-versions.ts`:** `--skip-npm-latest-check` and `OPENCLAW_SKIP_NPM_LATEST_CHECK` to skip the npm registry latest comparison (used by Release CI).

## [0.2.17] - 2026-03-25

### Added

- **Pinned OpenClaw bundle:** Root `package.json` field `openclawBundleVersion`; `download-openclaw` and CI Control UI build read it first (override via `OPENCLAW_DESKTOP_BUNDLE_VERSION` or CLI), reducing npm `latest` drift between jobs.
- **`verify-packaged-win`:** After `electron-builder`, validates `app.asar` / `bundle-manifest.json` / bundled OpenClaw / Control UI asset refs in `win-unpacked` so mixed artifacts fail the build.

### Documentation

- **`INSTALLER_BLACKSCREEN_POSTMORTEM.zh-CN.md`:** Release hardening section updated to reflect implemented checks.

## [0.2.16] - 2026-03-25

### Added

- **Install integrity (packaged):** Pre-start check compares `resources/bundle-manifest.json` `shellVersion` to `app.getVersion()`, and fails fast when the manifest is missing, unreadable, or mismatched (mixed/stale installer layout).
- **Bundle validation:** `validateOpenclawResources` now verifies Control UI `index.html` references an on-disk module script under `dist/control-ui`, catching incomplete or broken UI bundles before launch.

## [0.2.15] - 2026-03-25

### Changed

- **Diagnostics:** Type desktop doctor dependencies with `readOpenClawConfig: () => unknown` and a narrow cast inside `buildDesktopChecks`, avoiding loose `any` while keeping runtime shape checks.

## [0.2.14] - 2026-03-25

### Fixed

- **Local gateway Control UI root:** In non-remote mode, strip `gateway.controlUi.root` when it points outside the bundled `dist/control-ui`, so stale custom paths from older installs no longer load incompatible UI (black page).
- **Gateway auth token injection:** Apply the gateway token redirect patch to `mainFrame` and `subFrame` requests as well as WebSockets, so embedded/iframed Control UI loads authenticated resources correctly.

### Changed

- **Diagnostics:** Doctor adds a desktop warning when `gateway.controlUi.root` is set to a path outside the bundled Control UI (local gateway mode).

## [0.2.13] - 2026-03-24

### Fixed

- **Gateway Control UI black screen (browser and embedded iframe):** Run all bundled OpenClaw child processes with `cwd` set to `resources/openclaw` instead of the install directory. Upstream resolves `process.cwd()/dist/control-ui` before the real bundle path; a stray or partial `dist/control-ui` under the exe folder made HTML load while `assets/*.js` returned 404, leaving a blank dark page.
- **Stale `gateway.controlUi.root`:** On config read, remove `gateway.controlUi.root` when it does not point at a complete built UI (`index.html` plus `assets/*.js`), so copied configs from other machines or broken paths fall back to automatic bundle detection.

## [0.2.1] - 2026-03-24

### Updated

- **Bundled OpenClaw runtime:** `2026.3.22` (npm `latest`), bringing upstream fixes and features to the Windows installer bundle.
- **`download-openclaw`:** When installing the default `latest` dist-tag, logs an explicit `[policy]` line so release/local builds are visibly tied to the npm registry (still overridable via CLI or `OPENCLAW_DESKTOP_BUNDLE_VERSION`).

### Fixed

- **Extension registry:** Scan bundled plugins under `resources/openclaw/dist/extensions` (OpenClaw npm 2026.3+ layout), with fallback to legacy top-level `extensions/`, so the Skills/Extensions UI matches shipped plugins.
- **Embedded Control UI (OpenClaw 2026.3+):** Default and migrated `openclaw.json` set `gateway.controlUi.allowInsecureAuth` for local gateways; main RPC client sends full operator scopes and `tool-events` cap so WebChat/控制台 can load sessions, channels, and nodes.
- **Gateway process liveness:** Desktop health checks use a **TCP connect** to the gateway port first (avoids false SIGTERM when HTTP is backlogged under heavy RPC/plugin load), merge loopback into main-process `NO_PROXY`, require **3 consecutive** failures before auto-restart, and probe every **12s** — health monitoring stays enabled.
- **Control UI iframe:** Remount when the gateway leaves `running` or the gateway **PID** changes so WebSocket reconnects after restarts (same `#token` URL no longer leaves a blank console).
- **Control UI build (`ensure-openclaw-control-ui`):** Copy upstream monorepo `src/` next to `ui/` so Vite can resolve shared imports (e.g. `format-duration`); copy `apps/` (e.g. `OpenClawKit/Resources/tool-display.json`) for imports from `ui/src/ui/tool-display.ts`.
- **ESLint:** Ignore `build/**` so CI/local OpenClaw extract paths are not linted.

### Documentation

- **README.md / README.zh-CN:** Matching sections on OpenClaw **2026.3.22** compatibility — how the bundle tracks npm `latest`, `bundle-manifest.json` vs `prepare-bundle`, Node/OpenClaw paths, Control UI source build, `dist/extensions`, and pointers to upstream breaking changes for plugin authors.
- **CONTRIBUTING.md:** Local Windows packaging notes and `package:prepare-deps`.

## [0.2.0] - 2026-03-22

### Added

- **Feishu Access panel** — dedicated screen for Feishu credentials, pending pairing requests, pairing-code approval, and allowlist management (Settings, Dashboard, and tray entry points).
- **Pairing IPC (main process)** — list/approve/remove Feishu pairing state via the bundled OpenClaw runtime from the desktop shell.
- **Tray menu localization** — tray labels follow the selected shell/UI language.
- **Installer license assets** — English, Simplified Chinese, and Traditional Chinese license texts for the NSIS flow.
- **`pnpm i18n:zh-tw`** — script to regenerate Traditional Chinese locale strings from Simplified Chinese using OpenCC.

### Changed

- **Shell UX** — refinements across Dashboard, Settings, Wizard, About, Updates, Provider, and Skills views; expanded i18n keys (en, zh-CN, zh-TW, and other locales).
- **Electron builder** — extra resource entries for multilingual licenses where configured.

## [0.1.1] - 2026-03-20

### Fixed

- **Kuae Coding Plan behind HTTPS proxy:** Gateway child process now merges `NO_PROXY` / `no_proxy` for `coding-plan-endpoint.kuaecloud.net` and `.kuaecloud.net` on spawn so Kuae API calls can bypass broken local TLS through `HTTP(S)_PROXY`. Other providers unchanged. Opt out with `OPENCLAW_SKIP_KUAE_NO_PROXY=1`.

### Updated

- **Bundled OpenClaw runtime:** Updated bundled OpenClaw to the latest version `2026.3.13`, so OpenClaw Desktop supports the latest OpenClaw runtime.

### Documentation

- README Changelog and FAQ (English); Chinese notes in [README.zh-CN.md](./README.zh-CN.md).

## [0.1.0] - 2026-03-10

### Added
- Initial release of OpenClaw Desktop
- NSIS Windows installer with bundled Node.js 22 and OpenClaw
- 5-step setup wizard (Welcome → Model → Channel → Gateway → Complete)
- 50+ AI provider support (Anthropic, OpenAI, Google, Moonshot, xAI, etc.)
- Multi-channel configuration (Feishu, Telegram, Discord, Slack, WhatsApp)
- Desktop management panels (Dashboard, Settings, Updates, LLM API, Skills, About)
- Control UI iframe embedding with OpenClaw Gateway
- System tray integration with gateway status
- Auto-start at login support
- Dark/Light/System theme support
- 7-language internationalization (en, zh-CN, zh-TW, ja, ko, fr, es)
- electron-updater auto-update with stable/beta channels
- Pre-update backup with rotation
- Post-update validation with doctor checks
- Bundle integrity verification
- Diagnostic export (redacted)
- Configuration backup and restore
- Single instance enforcement
- Window state persistence
