<p align="center">
  <img src="resources/apple-touch-icon.png" alt="OpenClaw PC" width="128" height="128" />
</p>

<h1 align="center">OpenClaw PC</h1>

<p align="center">
  <strong>Your private AI assistant — fully on your PC. One file, no cloud, no subscription.</strong><br />
  Windows desktop app + smart installer in a <strong>single executable</strong>.
</p>

<p align="center">
  <a href="https://github.com/vpromalpe-design/openclaw-pc/releases/latest"><img src="https://img.shields.io/github/v/release/vpromalpe-design/openclaw-pc?style=flat-square&color=2563eb&label=release" alt="Release" /></a>
  <a href="https://github.com/vpromalpe-design/openclaw-pc/releases"><img src="https://img.shields.io/github/downloads/vpromalpe-design/openclaw-pc/total?style=flat-square&color=16a34a&label=downloads" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0A84FF?style=flat-square" alt="Platform" />
  <a href="LICENSE"><img src="https://img.shields.io/github/license/vpromalpe-design/openclaw-pc?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/state-v1.0.0%20final-30D158?style=flat-square" alt="State" />
</p>

<hr />

**OpenClaw PC** is a complete, self-contained desktop environment for private AI agents on Windows.
It installs everything it needs and runs agents, local models, voice and a Telegram bridge — **100% on your machine**.
Your conversations, agents and files never leave your computer unless you connect a cloud provider yourself.

> 🚀 **v1.0.0 — final release.** One single `.exe` file contains the whole product: interactive setup wizard + full application payload.

---

## ✨ Highlights

- 🧠 **Runs fully offline** — built-in local inference engine (llama.cpp) with GGUF models; no account, no cloud, no data leaving the PC. Works on a laptop with no internet at all.
- 🗣️ **Voice input** — dictation via local offline whisper.cpp, Google Speech or OpenAI Whisper (your choice).
- 🤖 **Real agent tasks** — create tasks for AI agents, watch them work step by step, pause / resume / delete, collect created files with one click, manage a shared agent disk.
- 🐝 **Agent groups («swarms»)** — organize agents into teams with a leader, assign missions, watch live activity.
- 📱 **Telegram bridge** — connect your own bot: talk to your agents from your phone anywhere.
- 🎨 **Liquid Glass UI** — signature dark glassmorphism design, animations and sound feedback, 3 languages (English / Русский / 中文).
- 📦 **Single-file installer** — one exe = wizard + payload. Works on clean Windows 10/11 (x64).
- 🔒 **Security hardened** — sandboxed renderer, strict IPC sender validation, locked-down CSP, no telemetry.

## 🖼 Screenshots

| Setup wizard | Gateway dashboard | Installer (user scope) |
|---|---|---|
| ![Setup wizard](resources/screenshot-setup-wizard.png) | ![Gateway dashboard](resources/screenshot-gateway-dashboard.png) | ![Installer user scope](resources/screenshot-installer-user-scope.png) |

## 🚀 Quick start

1. Go to **[Releases](https://github.com/vpromalpe-design/openclaw-pc/releases/latest)** and download **`OpenClaw-PC-1.0.0.exe`** — the single self-contained file (the full NSIS installer is also published for in-app auto-updates).
2. Run it. The setup wizard guides you through: language → install folder → **AI model** → **Telegram bot** (optional) → voice → done.
3. Pick a model:
   - **Cloud (no install):** Anthropic, OpenAI, Google, DeepSeek or any OpenAI-compatible endpoint — just paste an API key.
   - **Local (fully offline):** point to a GGUF file (or let the wizard download one) — the built-in engine runs it locally.
4. Click **Launch** — your private AI assistant is ready.

> No admin rights required (per-user install), install path is freely selectable.

## 🧩 What you get

| Area | Description |
|---|---|
| **Chat & agents** | Direct chat (plain text or agent mode), multiple agents with roles and custom avatars, per-agent models, reasoning control |
| **Tasks** | Task registry with live status: running / paused / done — each task has output, terminal summary, created files, and questions back to you |
| **Models** | Cloud providers with priority & auto-fallback, local GGUF + built-in llama.cpp engine, connection test button |
| **Telegram** | Wizard-configured bot: token, proxy (http/socks5), allow-list; agents answer in Telegram |
| **Voice** | Mic dictation everywhere, offline (whisper.cpp) or online (Google / OpenAI) |
| **Gateway** | Full OpenClaw gateway status, one-click restart, diagnostics |
| **Security** | Sandboxed Electron renderer (`sandbox: true`, context isolation), IPC sender validation, CSP without wildcards, signed-commit workflow |
| **Updates** | In-app auto-updates straight from GitHub Releases (stable channel) |

## 📜 Version history (highlights)

Full per-version details: **[CHANGELOG.md](CHANGELOG.md)**

- **1.0.0 (2026-09-06) — FINAL**: single-file distribution (installer packed into one exe), avatar fix (data-URL rendering, works with any Windows user profile), universal compatibility pass, public open-source release.
- **0.9.46–0.9.47**: avatar/emblem pickers fixed for non-ASCII user profiles (file:// blocked by webSecurity → images now embedded as data URLs); input context menus; last UI polish.
- **0.9.34–0.9.45**: agent groups («swarms») with arena view & SVG connection lines; shared agent disk with copy/paste; agent roles injected into prompts; file links from task answers.
- **0.9.22–0.9.30**: hybrid task registry (shell-side, survives restarts), reliable answer parsing, "created files" blocks with path resolution, voice dictation inside tasks.
- **0.9.17–0.9.21**: wizard rebuilt (language sidebar, skip, voice step with 3 providers, settings moved to ⚙️), sounds, security hardening (CVE fixes, IPC hardening, sandbox).
- **0.9.8–0.9.15**: dark Liquid Glass design finalized, step indicator, models page with priority & fallback.
- **0.9.0**: agent-task / plain-text switcher, local engine toggle, model-scope cleanup, full Liquid Glass port.
- **0.8.5–0.8.7**: standalone distribution groundwork — deepseek-direct provider pattern, Telegram wizard, Russian localization, models page, local GGUF support.

## ⚙️ System requirements

- Windows 10 (1809+) or Windows 11, **x64**
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (evergreen; ships with Windows 11 and most Windows 10 installs via Edge)
- ~600 MB free disk for the app; more for local models
- 8 GB RAM recommended (2 GB minimum for chat with cloud models; local models scale with their size)
- No admin rights needed

## 🔧 Tech

- **Shell:** Electron 41 — hardened (sandbox, context isolation, no node integration in renderer)
- **Core:** [OpenClaw](https://github.com/agentkernel/openclaw) 2026.7.1 bundled runtime & gateway
- **UI:** React 19 + Vite, custom Liquid Glass design system, i18n (en/ru/zh)
- **Installer:** single-file WPF (.NET 8) wizard + embedded NSIS payload
- **Local inference:** llama.cpp (GGUF), offline whisper.cpp for voice

## 🗂 Repository layout

```
src/main        Electron main process (window, IPC, gateway manager, security)
src/preload     Context-isolated bridge (typed IPC)
src/renderer    React UI: shell, wizard, models, tasks, groups, voice
src/shared      Shared types & IPC channel definitions
scripts         Build/verify tooling (bundle, versions, smoke tests)
resources       Icons, installer assets, screenshots, license texts
```

## 🛠 Development

```bash
pnpm install
pnpm run dev              # run the shell against a local gateway
pnpm run type-check       # tsc
pnpm run lint             # eslint
pnpm run package:win      # build the NSIS installer (Windows)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/product-design.md](docs/product-design.md).

## 🔒 Security

- Renderer runs with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- All IPC calls validate their sender origin; no `postMessage` to `*`.
- Strict Content-Security-Policy (no wildcard frame ancestors), hardened gateway response headers.
- Local-first: nothing is sent anywhere unless you configure a cloud provider / Telegram bot yourself.
- Vulnerable transitive deps are pinned via `pnpm.overrides` (ws, js-yaml, electron-updater toolchain).

Found an issue? See [SECURITY.md](SECURITY.md) and [report it](https://github.com/vpromalpe-design/openclaw-pc/issues).

## 📄 License

[GPL-3.0](LICENSE) · Copyright © 2026 OpenClaw PC Team.

OpenClaw PC bundles [OpenClaw](https://github.com/agentkernel/openclaw) (GPL-3.0), a private-AI gateway runtime, and the llama.cpp inference engine.
