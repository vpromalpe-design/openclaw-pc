# Changelog

All notable changes to OpenClaw Desktop will be documented in this file.

## [0.9.14] - 2026-08-26

### Fixed

- **Piper падал на Windows 11 (0xC0000409), голоса Дмитрий/Денис не скачивались**: движок заменён с piper 2023.11.14-2 (несовместим с Win11 Build 26200 — баг ucrtbase.dll, issue OHF-Voice/piper1-gpl #260) на **sherpa-onnx** (k2-fsa) — `sherpa-onnx-offline-tts.exe`, совместим с новыми сборками Windows. Установка теперь скачивает и распаковывает движок + **все три русских голоса** (Ирина/Дмитрий/Денис, vits-piper medium int8) + общий espeak-ng-data (распаковка tar.bz2 встроена в приложение). Текст в синтез передаётся аргументом командной строки (UTF-16, кириллица корректна).

## [0.9.13] - 2026-08-26

### Fixed

- **Озвучка ответов не работала**: монитор активности слушал несуществующее RPC-событие `chat` — теперь слушает `session.message` (фильтр: только `role=assistant`, пропуск стриминговых дельт через `hasActiveRun`, дедуп по `messageId`).
- **Устойчивость монитора активности**: если gateway закрыл WebSocket (рестарт/конфликт client.id), клиент пересоздаётся на следующем heartbeat (`isConnected`-проверка) вместо вечного «подписан, но мёртв».

### Features (Этап F: голос)

- **Озвучка ответов агента (TTS)**: раздел «Голос» → «Озвучка ответов» — три движка: Microsoft Edge (бесплатно, онлайн, ~320 голосов), ElevenLabs (API-ключ, свой голос), Piper (локально, офлайн, русские голоса Ирина/Дмитрий/Денис). Кнопка «Проверить голос» синтезирует и проигрывает фразу. Когда включено, агент озвучивает свои ответы (очередь, дедуп, обрезка длинных ответов).
- **Локальное распознавание речи (STT)**: whisper.cpp с моделями tiny/base/small/medium (скачиваются из приложения, работают офлайн). Тест микрофона: запись 3–10 с → распознавание → текст. API-варианты Google/OpenAI Realtime остались как были.
- **Слайдер контекста локальной модели**: настройка размера контекста (512–32768 токенов, шаг 512, по умолчанию 32768) с немедленным применением — движок перезапускается с новым `-c`.

## [0.9.12] - 2026-08-25

### Features

- **Вкладки чатов как вкладки браузера**: у каждого агента свой ряд вкладок (метка агента + незакрываемая вкладка Control UI + текстовые вкладки «Чат N» с × + кнопка «＋ Новый чат»). История каждого текстового чата сохраняется при переключении.
- **«＋ Добавить Агента»**: отдельная вкладка настройки (имя + языковая модель из подключённых провайдеров), агент создаётся без рестарта шлюза (hot-reload `agents.list`).
- **Меню у агента (⋯)**: выбор своей модели из подключённых; активная модель отмечена ✓.
- **Зелёная лампочка активности** у агента мигает «как HDD», пока агент выполняет задачу (события `sessions.changed`, автосброс через 90 с).

## [0.9.11] - 2026-08-25

### Features

- **Тема всегда тёмная**: светлая тема полностью удалена (база v0.9.8, решение Дамира). Тёмные токены применяются всегда (`:root, .dark`), переключатель темы убран из настроек.
- **Страница настройки Telegram** (⚙ → Telegram и боковая кнопка «Телеграм»): имя бота, ссылка t.me, токен с показом/скрытием, кнопка «Проверить токен» (getMe → @username), «Сохранить и перезагрузить Шлюз», предупреждение при открытом доступе (allowFrom пуст).
- **⚙ → «Локальный движок»**: открывает вкладку Модели и прокручивает к настройке локальной модели.
- **Правая bento-панель**: элементы больше не вылезают за рамку (grid `minmax(0,1fr)`, `min-width: 0` на тайлах).
- **Переключатель «Агентская задача | Просто текст»** вынесен под рамку чата — больше не наезжает на текст.
- **Контраст при тёмной теме**: `--text-3` поднят до 0.62 alpha, декоративный «/» в хлебных крошках — `text-muted-foreground`.

## [0.9.10] - 2026-08-25

### Bug Fixes

- **Шапка чата снова видна (лупа 🔍 и корзина 🗑)**: убран параметр `onboarding=1` из URL встроенного Control UI — именно он заставлял Control UI скрывать верхнюю панель чата (`.shell--onboarding .topbar { display: none }`). Левая навигация Control UI теперь скрывается нашим оверлеем темы — остаётся только наше меню.
- **Вкладки Модели/Голос/Настройки стали светлыми**: контейнер панелей имел жёсткий тёмный фон `rgba(11,16,32,.66)` — заменён на тему-зависимый ским (`--panel-scrim`): светлый бело-голубой градиент в светлой теме, глубокий синий в тёмной.
- **Правая bento-панель больше не обрезается**: компактнее отступы, зазоры и размеры тайлов — все 7 тайлов и кнопки действий помещаются в окнах высотой от ~850px.
- **Центральное окно чата — белое с холодным градиентом** (как на макете), без бежевого оттенка.

## [0.9.9] - 2026-08-25

### Features

- **Светлая тема по умолчанию**: весь интерфейс (оболочка, панели, меню, статусбар, bento-панель) переведён на светлую палитру «Liquid Glass Light». Все жёсткие тёмные цвета вынесены в CSS-переменные — тёмная тема полностью сохранена и переключается классом `.dark`.
- **Переключатель темы в шапке**: кнопка ☀️/🌙 с меню «Светлая / Тёмная» — выбор сохраняется и применяется мгновенно (встроенный Control UI следует за ним через nativeTheme).

## [0.9.8] - 2026-08-25

### Fixes

- **Чат**: переключение «Агентская задача ⇄ Просто текст» больше не сбрасывает историю диалога (история «Просто текста» хранилась внутри компонента и терялась при переключении режима).
- **Локальный движок**: исправлена повторная перекачка llama.cpp при каждом запуске/переключении модели — архив с верхней папкой (`llama-<tag>-bin-<variant>/`) теперь выравнивается при распаковке, а уже установленные движки чинятся без повторной загрузки. CUDA-рантайм кладётся рядом с бинарником (фикс «cudart64_12.dll missing»).
- **Микрофон**: голосовой режим (talk) больше не выдаёт Permission denied — iframe Control UI получил `allow="microphone"` (Chromium отклонял getUserMedia во вложенном iframe).


## [0.9.7] - 2026-08-25

### UI

- **Установщик**: на боковой панели вместо синего силуэта — логотип OpenClaw.
- **Левое меню**: новый пункт «Телеграм» (Разделы) — открывает каналы связи (Communications) в Control UI.
- **Правая панель состояния**: плитки **CPU / GPU** — показывают, на каком устройстве работает локальный движок, и переключают его прямо оттуда: клик по неактивному — включить движок на этом устройстве, клик по активному — остановить. Если GPU-сборка не установлена, клик ведёт на страницу Модели.
- Убрана кнопка «Скачать CUDA-сборку» из панели действий (установка осталась на странице Модели).


## [0.9.6] - 2026-08-25

### Исправления по багрепорту (openclaw-bug-report-2026-08-25)

- **Безопасность**: токен gateway больше не попадает в журнал (маскируется в URL запросов/ответов); `allowedOrigins` Control UI ограничен конкретными loopback-адресами вместо `["*"]`.
- **Стабильность**: экспоненциальная задержка между авто-рестартами gateway (1с → 5с → 15с → 60с) — больше нет «шторма» процессов при падении на старте (например, из-за невалидного конфига).
- **Диагностика**: экран ошибки показывает реальную причину падения gateway (последние строки журнала); при невалидном `channels.telegram.network.proxy` в конфиге приложение предупреждает об этом баннером.
- **Локальный движок**: читаемый текст ошибок распаковки CUDA (без CLIXML-мусора); id локальной модели нормализуется к каталогу при запуске (нет рассинхрона `primary` и каталога).

## [0.9.5] - 2026-08-25

### Added

- **Liquid Glass main screen (per approved mockup)** — the main window is now wrapped in the dark glass shell: a top bar (🦞 brand + version, agent switcher pill, «＋ Новый чат», Gateway pill, ⚙️ and ⋯ menus), a left sidebar (Агенты from config, Разделы — Чат/Модели/Голос/Обзор/Активность/Сеансы/Cron/Задачи/Навыки, and live Сессии from the Gateway), the embedded Control UI in the center (its own sidebar/topbar hidden via the built-in `onboarding` mode) and a right status panel (Gateway, Модель, Локальный движок with download progress, Telegram, Агенты; actions: Проверить соединение, Запустить/Остановить движок, Скачать CUDA-сборку) plus the dark status bar (● gateway online · agent · model · engine · token · UTC clock).
- **Live session list in the sidebar** — new `sessions:list` IPC: the main process connects to the Gateway over WebSocket RPC (`sessions.list`) and exposes the real sessions (agent chats, Telegram chats, Cron runs) in the sidebar; clicking a session opens it in the embedded chat.

### Fixed

- **Gateway RPC from the desktop app was rejected** — the embedded Gateway RPC client now sends an allowed `client.id` (`openclaw-control-ui`) and the current protocol version (4), and mirrors the Control UI `Origin` header, so `sessions.list` (and other backend RPC calls) authenticate against the Gateway instead of failing with «invalid connect params / protocol mismatch / origin not allowed».

## [0.9.4] - 2026-08-25

### Fixed

- **Embedded Control UI was light** — the app now forces the native dark theme (`nativeTheme.themeSource`), so the built-in Control UI (theme mode: system) renders dark like the Liquid Glass shell instead of the default light UI. The window background is dark (#0B1020) so there is no white flash while the Gateway/iframe loads, and switching the theme in Settings keeps the embedded UI in sync.

## [0.9.3] - 2026-08-24

### Fixed

- **Installer was only partially dark** — the NSIS dark-theme patch was rewritten from scratch (page hooks + `DarkControl`/`DarkPageCommon` helpers + per-page `dark*Show` functions): now *everything* is dark — welcome, install mode, license, folder, installing and finish pages — with white, readable labels, dark buttons and a white finish-page checkbox label («Run OpenClaw PC»).
- **Orange installer image replaced** — the sidebar now shows the OpenClaw PC logo + «OpenClaw PC» wordmark in blue (#5AC8FA) on a #0B1020 background, on every installer page.
- **“Model selected” was grey until engine refresh** — the green «Model selected» badge with a checkmark now lights up immediately when a model file is picked from disk (or a URL download finishes), no longer waiting for the engine state to refresh.
- **CUDA/CPU status turned green late** — the engine install now emits a dedicated `engine-installed` event only after the archive is extracted AND (for CUDA) the runtime DLLs are in place; the wizard marks the status green «Installed» the moment the download hits 100 %, with no extra clicks or waiting.

### Changed

- **Glass panels per mockup “(4)”** — dropdown/menu surfaces and the floating mode switcher now use `rgba(18,26,48,.70)` + `backdrop-filter: blur(60px) saturate(220%) brightness(1.1)` (was 95 % opaque / 40 px blur), matching `openclaw-pc-mockup-glass (4).html`.

## [0.9.2] - 2026-08-24

### Fixed

- **Wizard welcome screen was blank** — the setup wizard content (text, buttons, feature cards) was rendered *under* the animated blob background (static `main` vs fixed `z-0` background layer). The wizard body is now above the background, so the first welcome screen shows its text and buttons again.

### Changed

- **Dark installer theme** — the Windows installer is now fully dark (Liquid Glass): dark pages with white text (welcome, install folder, installing, finish), matching the app design.
- **Installer sidebar** — the orange welcome bitmap is replaced with a dark glass sidebar featuring the OpenClaw PC logo and the «OpenClaw PC» wordmark (shows on every page, including the finish page).
  - Implemented via a `pnpm.patchedDependencies` patch on the electron-builder NSIS template (`app-builder-lib@26.8.1`), see `patches/`.

## [0.9.1] - 2026-08-23

### Fixed

- **White text everywhere on dark glass** — the Liquid Glass theme is now applied at app startup (previously it was only applied once you opened Settings, so panels rendered light-theme tokens: dark text on the dark glass background). «System» theme now also resolves to dark (Liquid Glass is dark by default; only an explicit «Light» choice opts out).
- **Mode switch placement** — the «Агентская задача | Просто текст» toggle no longer overlaps the chat composer; it floats above the input block.
- **Panel overlay is Liquid Glass** — settings/panels now use a translucent frosted surface (blur 2xl, rgba(11,16,32,0.66)) with a glass header, so the blob background shines through like in the fixed design.
- **Wizard is Liquid Glass too** — the setup wizard now has the same glass header/footer and blob background.

## [0.9.0] - 2026-08-24

### Added

- **«Просто текст / Plain text» chat mode** — a segmented switch (Агентская задача | Просто текст) floats at the bottom of the chat. In text mode the agent loop is bypassed entirely: messages go straight to the active model (local engine or cloud provider) with no tools, no memory and no compaction. Handy for weak local models that "rush to act" instead of answering.
- **Connect/Disconnect toggle in the Models page** — the same «Подключить» button now toggles to «Отключить» for both local (stops the engine) and API providers (removes from the model chain); pressing it again reconnects.
- **Own local models only** — the setup wizard and the Models page no longer suggest Gemma4. The wizard offers a free-form local-model field (GGUF URL or install from disk); the Models page lets you add, download, remove and run any GGUF model you own.
- **<12B parameter warning** — when adding a model (URL or disk), the app detects the size (HEAD request / file size / name marker) and shows a warning that models below 12B are a poor fit for agent tasks, with recommendations (12B+, e.g. Qwen2.5-14B / Gemma-3-27B, or cloud).
- **Liquid Glass design (full port)** — dark glassmorphism across all menus and settings pages: iOS blue accent (#0A84FF), glass panels (blur 28px, saturate 180%, top highlight), living color blob background + noise, capsule buttons (999px), 22px radii, SF Pro font stack, dense dropdowns (rgba(18,26,48,.95) + blur 40px), terminal-style status bar at the bottom.

### Changed

- First wizard page text rewritten: local model is described as installing your own GGUF (URL or disk) instead of the Gemma4 preset.
- Local model size is probed at add time (HEAD/range request) so the <12B warning works for URL downloads too.

### Fixed

- Local picker no longer resets to an implicit Gemma4 default in the wizard.
- Removed all Gemma4 references from the renderer UI (wizard presets, Models page presets, i18n) — the bundled engine preset remains backend-only for existing installs.

## [0.8.31] - 2026-08-24

### Fixed

- **CUDA engine install "reaches 100% then resets"**: the CUDA runtime download (cudart/cublas DLLs) could be silently truncated on unstable networks — the old code treated a dropped connection as a successful download, then `Expand-Archive` failed with a useless "code 1" or left the DLLs missing. Downloads are now guarded by a byte-count check against `Content-Length` (truncated files are deleted and reported as errors), the inactivity timeout for engine/runtime archives was raised from 30s to 120s, and PowerShell errors from `Expand-Archive` are captured and surfaced in the log for real diagnostics.

## [0.8.30] - 2026-08-23

### Fixed

- **Local model downloads could hang forever on restricted networks**: every HTTP download now has a 30-second timeout; the built-in Gemma 4 preset falls back to the hf-mirror.com mirror when huggingface.co fails, and the final error explains the Russia block and suggests a VPN or a custom mirror URL.
- **CUDA / Vulkan engine buttons were missing**: the Models page now has an engine section with CPU / CUDA / Vulkan install buttons and live progress; the wizard shows all three variants unconditionally (GPU detection is unreliable on many laptops and no longer hides the GPU builds).
- **«Connect» / «Run» seemed to do nothing**: the first launch implicitly downloads the llama.cpp engine binary, which previously gave zero feedback. Engine and CUDA-runtime downloads now show a progress banner, the Run button shows a spinner, and test/start errors are displayed.
- **Engine resolution now has a fallback**: if the GitHub API is unreachable, the downloader uses a known-good pinned build (`b10593`) with deterministic asset names instead of failing.

### Added

- Models page now receives the local-engine runtime snapshot (installed variants, GPU vendor/name) to power the new engine section.

## [0.8.29] - 2026-08-23

### Fixed

- **Local models could not start** («No llama.cpp cpu build found in release v0.2.0 (assets: 0)»): llama.cpp moved its Windows binaries to prerelease per-build releases (`b10593`, …) while GitHub's «latest» endpoint now returns a stable marker release (`v0.2.0`) that contains no binaries. The engine downloader now scans recent releases and picks the newest one that actually ships `llama-<tag>-*` assets, so the CPU/CUDA engine downloads again and local GGUF models (Gemma 4) start.

## [0.8.28] - 2026-08-23

### Added

- **OpenRouter extended settings**: the wizard's Model step and Settings → Models now show an editable «API Base URL» field for OpenRouter (default `https://openrouter.ai/api/v1`, pre-filled). Users can point OpenRouter at their own endpoint or proxy. The URL is written to `models.providers.openrouter.baseUrl`, read back when settings load and used by the connection test.

## [0.8.27] - 2026-08-22

### Added

- **«Голос» item in the Control UI sidebar**: the panel menu now has a Voice entry (with a mic icon, next to «Модели») that opens the desktop voice settings directly — provider, API key, test and remove. Previously voice settings were only reachable via tray → Settings → General, and there was no voice item in the panel menu.

## [0.8.26] - 2026-08-22

### Added

- **Voice input setup in the wizard**: new optional «Voice» step (after Channels, before Gateway) with Google Gemini Live (free) / OpenAI Realtime (paid) provider cards, API-key field, connection test, VPN-for-Russia warning and «Skip» (step can be skipped without configuring anything).
- **«Voice» section in Settings**: read/write the realtime talk config (`talk.realtime`) directly — provider, API key, save, remove key, connection test; the gateway restarts automatically after saving.
- The wizard writes `talk.realtime` into `openclaw.json` at deploy time when a key was provided, so a fresh install boots with voice ready.

### Fixed

- Google voice keys entered in Model settings (auth profiles only) were never picked up by realtime voice — the voice path now stores the key in `talk.realtime.providers.google.apiKey`, which the realtime provider actually reads.

## [0.8.25] - 2026-08-22

### Fixed

- **Local engine could hang forever on a stalled llama-server** (v0.8.20+ regression): `http.get` with the `timeout` option but no `'timeout'` listener never settles — the socket is never destroyed, so `waitForHealth` (incl. the 120 s orphan-adoption wait), `fetchLoadedModelId`, `isSchemaFixProxyUp` and `fetchServerContextWindow` hung indefinitely on an accept-but-stall server (observed as two llama-server processes on the backend port, CPU 0, empty replies). All four probes now destroy the request on timeout and fall through to their retry/failure path, so deadlines are actually enforced.
- **Liveness watchdog did not cover adopted engines** (v0.8.23 regression): `ensureEngineWatchdog()` ran only on the cold-spawn path; engines adopted from a previous instance (orphan on the backend port) never got the watchdog, so a dying adopted engine left the UI reporting "running" forever. The watchdog is now armed on both adoption branches too.
- **Quitting the app left the local engine and schema-fix proxy running**: `cleanupBeforeQuit` stopped the gateway, tray and IPC handlers but not the llama-server child (~13 GB RSS) nor the schema-fix proxy on 18788 (`stopSchemaFixProxy` had no callers at all). Quit now stops the engine and the proxy.
- **A corrupt `auth-profiles.json` silently wiped every provider's API keys**: the store is the single credential vault, and both `loadStore` (auth-profile-store) and `loadExistingStore` (wizard writer) returned an empty store on parse failure — the next save then overwrote the file with one profile, destroying all other keys. Both writers now (a) write atomically (tmp + rename, no more torn files on crash) and (b) back the corrupt file up to `auth-profiles.json.bad-<ts>` before falling back to an empty store.
- **A corrupt `openclaw.json` could be silently overwritten**: a parse failure returned `{}` with no backup, and the next write (migration / settings save / wizard) replaced the user's config — including `gateway.auth.token`. The unparseable file is now copied to `openclaw.json.bad-<ts>` before defaults are used.
- **Wizard could leave a broken config on disk**: `openclaw.json` was written before validation; when validation failed the invalid config stayed, so the next app launch booted the gateway into a crash loop. The previous config is now snapshotted and restored (or the new file removed) on validation failure.
- **"Save model settings" with an empty API key reported success but every request 401'd**: the config referenced an auth profile that was never written. Both the renderer (Save button stays disabled) and the main-process IPC handler (explicit error) now require a non-empty key for API-key providers.
- **Telegram bot test through an `http://` proxy always failed with `socket hang up`**: after a CONNECT tunnel the socket was used raw for `https` when the proxy scheme was plain `http` — Node then sent plaintext HTTP into the TLS port. The tunnel socket is now always wrapped in `tls.connect` (the target is always TLS regardless of proxy scheme).
- **Gateway RPC client could never reconnect after a gateway restart**: the cached resolved `connectPromise` was never cleared and there was no post-connect `ws.on('close')`, so a reused client kept failing `GATEWAY_NOT_CONNECTED` forever. Connection state is now cleared when the socket closes or errors.
- **Window bounds written to disk on every mouse move**: `persistWindowBounds` ran on every `resize`/`move` event with no debounce. Writes are now debounced (500 ms).

## [0.8.24] - 2026-08-22

### Fixed

- **Silent install (`/S`) reported success but installed nothing** (and the interactive installer rejected the default install folder): a custom NSIS page (`PathValidateLeave`) blocked installation whenever the last path segment contained a space — which is exactly the default folder "OpenClaw PC". Windows and electron-builder handle spaces in paths fine, so the check was pure breakage. The page and its helper functions have been removed; installation into "OpenClaw PC" (and any other folder with spaces) now works both interactively and silently.

## [0.8.23] - 2026-08-21

### Fixed

- **Orphaned double-bound engines were adopted instead of cleared**: when two llama-server processes were left listening on the same port (from the 0.8.21 double-spawn bug), the app adopted one and left the other eating ~13 GB of RAM — the machine kept thrashing into the pagefile. On start the app now counts the listeners on the engine port; if more than one process is bound, all are killed and a fresh engine is spawned.
- **Engine death while the app is running was invisible**: if the adopted/own engine process died, the proxy kept returning 502 "local engine unreachable" forever and the UI kept showing the engine as running. A watchdog now probes the engine every 30 s and marks it stopped when it stops responding.
- **CUDA build could silently fall back to CPU**: when the CUDA llama-server binary was already on disk but its runtime DLLs (cudart64_12, cublas64_12, cublasLt64_12) were missing (the runtime asset used to 404 on our releases), the GPU build died on start and the app fell back to the slow CPU build. The runtime is now topped up before spawn, and the runtime DLLs are published as a release asset (`cuda-runtime-v1`) built automatically by CI.

## [0.8.22] - 2026-08-21

### Fixed

- **Two llama-server engines could be spawned on app launch, freezing the model** ("model does not answer"): the local engine was started twice concurrently at startup — a pre-gateway pre-start and a post-window auto-start. Both calls saw the engine as not running and each spawned its own llama-server; Windows allows both to bind the same port (18792), so two engine processes each loaded the 12B model into memory (~13 GB RSS each) and a 16 GB laptop thrashed into the pagefile — the model took minutes per token or hung entirely. Engine startup is now serialized through a single in-flight promise (the second caller awaits the first), and the port is re-checked right before spawning so a foreign/manual engine is adopted or killed instead of double-binding.

## [0.8.21] - 2026-08-20

### Fixed

- **All requests through the local-model proxy instantly failed with 502 "local engine unreachable"** (the 0.8.20 regression): the abort-forwarding added in 0.8.20 listened for Node's `'close'` event on the incoming request, but Node fires that event as soon as the request body has been fully received — not only when the client disconnects. The proxy therefore destroyed the upstream connection on *every* request and nothing could ever reach the engine. Now the request handler only destroys the upstream when the client actually disconnected mid-request (`!req.complete`), and the response handler only when the client vanished while awaiting the reply (`!res.writableEnded`). Normal requests pass through, aborted requests still free the engine slot.

## [0.8.20] - 2026-08-20

### Fixed

- **Local models stopped answering (the "bot thinks forever" issue on the Gemma 4 v2 12B)**:
  - Engine context window reduced from 64k to 32k (q8_0 KV). The 64k KV cache alone consumed ~13 GB of RAM; on 16 GB laptops the engine thrashed into the pagefile and could take minutes to emit a first token.
  - The schema-fix proxy now forwards client aborts to the engine. Previously a timed-out request left the engine slot busy forever, so every later message queued behind it and the model "stopped answering" until the engine was killed.
  - After start/adoption the app now sends a tiny probe chat request; if the engine is healthy but wedged (slot stuck), it is killed and restarted once automatically.

## [0.8.19] - 2026-08-20

### Changed

- **Wizard copy updated**: the local-model card on the first setup page now says "Gemma 4 GGUF" instead of "Qwen 3.5 GGUF".
- **Step indicator redesign**: the wizard's step bars are now rounded squares (icons/number inside), instead of vertical pill bars.

## [0.8.18] - 2026-08-20

### Changed

- **One local model instead of two**: the preinstalled Qwen 3.5 4B/9B presets are gone. The only built-in preset is now **Gemma 4 v2 (Q4_K_M)** (`gemma4-v2-Q4_K_M.gguf`, ~6.9 GB, tool calling enabled) — same model the wizard offers during first-time setup, same model on the Models page. Downloading it works exactly like the old Qwen flow. Custom GGUF options stay: paste your own model URL or pick a file from disk.

### Fixed

- **No more double engine on restart (the "bot thinks forever" bug)**: when an orphaned llama-server from a previous app session was still loading its model, the app could miss it (3s health check) and spawn a *second* engine on the same port — Windows allowed both to listen, requests hit the hung one and every reply timed out. Now the app first checks whether the engine port is occupied at the TCP level; if yes but `/health` is not ready yet, it waits (up to 2 minutes) for the loading engine instead of spawning a duplicate, and only kills+respaws when the port stays unhealthy.

## [0.8.17] - 2026-08-20

### Fixed

- **Local models answer again — permanently**. The real llama-server now runs on an internal port (18792) and a built-in schema-fix proxy owns the port the app writes into openclaw.json (18788). The proxy rewrites tool-call JSON-schema `pattern`s that llama.cpp rejects (shorthand classes like `\S`, unanchored regexes → HTTP 400 "Pattern must start with '^' and end with '$'") before forwarding to the engine. Previously the fix relied on an external proxy on a different port, which the app wiped from the config on every restart — the gateway then talked straight to the engine and every tool call failed with 400, so the bot showed "connected" but never replied.

## [0.8.16] - 2026-08-20

### Fixed

- **No raw URLs in engine install errors**: if downloading the CUDA/Vulkan engine build fails, the panel no longer shows the raw GitHub URL / HTTP status. The user sees a short message ("Failed to download the CUDA engine. Check your internet connection and try again.") and the technical detail goes to the log.

## [0.8.15] - 2026-08-20

### Changed

- **Wizard preselects Qwen 3.5 4B for Local Model**: choosing "Local Model" during setup now defaults to the Qwen 3.5 4B preset (lightest, first in the picker) instead of an empty selection. Picker order stays: Qwen 3.5 4B → Qwen 3.5 9B → custom GGUF file.

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
