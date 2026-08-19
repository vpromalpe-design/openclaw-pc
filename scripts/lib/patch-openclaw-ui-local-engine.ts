/**
 * OpenClaw PC local-engine UI patch (applied to Control UI sources BEFORE vite build):
 * 1. Writes `openclaw-pc-engine-toggle.ts` — a very visible CPU/GPU toggle
 *    button (red when GPU is active) in the very right corner of the topbar.
 * 2. Writes `openclaw-pc-model-bar.ts` — an active-model chip under the chat
 *    composer; clicking it opens a list of downloaded local models to switch to.
 * 3. Bridges both to the desktop shell via postMessage:
 *    `openclaw-pc:local-engine` (request) → `openclaw-pc:local-engine:state` (reply).
 *
 * Idempotent: safe to run after every download-openclaw / prepare-bundle.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SENTINEL = 'openclaw-pc-local-engine'

async function patchFile(
  filePath: string,
  label: string,
  replacements: { find: RegExp | string; replace: string; expectCount?: number }[],
  comment: 'js' | 'css' = 'js',
): Promise<boolean> {
  let raw = await readFile(filePath, 'utf8')
  if (raw.includes(SENTINEL)) return false
  for (const { find, replace, expectCount } of replacements) {
    const re =
      find instanceof RegExp
        ? find
        : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const matches = raw.match(re)
    if (!matches || (expectCount != null && matches.length !== expectCount)) {
      console.warn(
        `  [patch-local-engine] ${label}: pattern not found${expectCount != null ? ` (expected ${expectCount}, got ${matches?.length ?? 0})` : ''} — layout may have changed; skipping`,
      )
      return false
    }
    raw = raw.replace(re, replace)
  }
  const marker = comment === 'css' ? `/* ${SENTINEL} v1 */\n` : `// ${SENTINEL} v1\n`
  raw = `${marker}${raw}`
  await writeFile(filePath, raw, 'utf8')
  console.log(`  [patch-local-engine] ${label}: patched`)
  return true
}

const ENGINE_TOGGLE_COMPONENT = `import { LitElement, html, css } from "lit";
import { property } from "lit/decorators.js";
import { t } from "../i18n/index.ts";

// Desktop bridge (see src/renderer/App.tsx): Control UI posts a request,
// the Electron shell replies with { type: "openclaw-pc:local-engine:state" }.
const REQUEST_TYPE = "openclaw-pc:local-engine";
const STATE_TYPE = "openclaw-pc:local-engine:state";

type EngineToggleState = {
  effectiveGpu?: "cpu" | "gpu";
  gpuName?: string;
  gpuVendor?: string;
  models?: unknown[];
  engineRunning?: boolean;
  error?: string;
};

const BRAND_RED = "#E43F3F";

export class OpenClawPcEngineToggle extends LitElement {
  static styles = css\`
    :host { display: inline-flex; }
    .engine-toggle {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 26px;
      padding: 0 10px;
      border-radius: 999px;
      border: 1px solid transparent;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.4px;
      cursor: pointer;
      color: #fff;
      background: rgba(255, 255, 255, 0.08);
      transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
      user-select: none;
      white-space: nowrap;
    }
    .engine-toggle:hover { transform: translateY(-1px); }
    .engine-toggle:active { transform: translateY(0); }
    .engine-toggle--gpu {
      background: \${BRAND_RED};
      box-shadow: 0 0 0 1px rgba(228, 63, 63, 0.6), 0 0 14px rgba(228, 63, 63, 0.55);
    }
    .engine-toggle--gpu:hover {
      background: #d63a3a;
      box-shadow: 0 0 0 1px rgba(228, 63, 63, 0.8), 0 0 18px rgba(228, 63, 63, 0.8);
    }
    .engine-toggle--cpu {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.25);
      color: rgba(255, 255, 255, 0.85);
    }
    .engine-toggle--cpu:hover {
      background: rgba(255, 255, 255, 0.2);
      box-shadow: 0 0 10px rgba(255, 255, 255, 0.15);
    }
    .engine-toggle__dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      flex: none;
    }
  \`;

  @property({ attribute: false }) state: EngineToggleState | null = null;
  @property({ attribute: false }) hidden = true;

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this.handleMessage);
    this.requestState();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this.handleMessage);
  }

  private readonly handleMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; effectiveGpu?: string; gpuName?: string; models?: unknown[]; engineRunning?: boolean; error?: string } | undefined;
    if (data?.type !== STATE_TYPE) return;
    this.state = data as EngineToggleState;
    const hasLocalModels = Array.isArray(data.models) && data.models.length > 0;
    this.hidden = !hasLocalModels;
    this.requestUpdate();
  };

  private requestState() {
    window.parent.postMessage({ type: REQUEST_TYPE, action: "get-state" }, "*");
  }

  private toggle() {
    window.parent.postMessage({ type: REQUEST_TYPE, action: "toggle-mode" }, "*");
  }

  override render() {
    if (this.hidden) return;
    const gpu = this.state?.effectiveGpu === "gpu";
    const label = gpu ? "GPU" : "CPU";
    const title = gpu
      ? \`\${t("localEngine.runningOnGpu")} \${this.state?.gpuName ? "· " + this.state.gpuName : ""}\`
      : \`\${t("localEngine.runningOnCpu")}\`;
    return html\`
      <button
        type="button"
        class="engine-toggle \${gpu ? "engine-toggle--gpu" : "engine-toggle--cpu"}"
        title=\${title}
        aria-label=\${title}
        @click=\${this.toggle}
      >
        <span class="engine-toggle__dot" aria-hidden="true"></span>
        \${label}
      </button>
    \`;
  }
}

if (!customElements.get("openclaw-pc-engine-toggle")) {
  customElements.define("openclaw-pc-engine-toggle", OpenClawPcEngineToggle);
}
`;

const MODEL_BAR_COMPONENT = `import { LitElement, html, css } from "lit";
import { property } from "lit/decorators.js";
import { t } from "../i18n/index.ts";

const REQUEST_TYPE = "openclaw-pc:local-engine";
const STATE_TYPE = "openclaw-pc:local-engine:state";

type ModelBarModel = {
  id: string;
  name: string;
  fileName: string;
  sizeBytes: number;
};

type ModelBarState = {
  engineState?: { running?: boolean; modelId?: string | null; error?: string };
  models?: ModelBarModel[];
  error?: string;
};

export class OpenClawPcModelBar extends LitElement {
  static styles = css\`
    :host { display: block; margin-top: 4px; }
    .model-bar { display: inline-flex; align-items: center; gap: 6px; }
    .model-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 260px;
      padding: 3px 10px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(255, 255, 255, 0.06);
      color: rgba(255, 255, 255, 0.85);
      font-size: 11px;
      line-height: 1.4;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .model-chip:hover { background: rgba(255, 255, 255, 0.14); }
    .model-chip__icon { flex: none; opacity: 0.8; }
    .model-chip__name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    .model-chip__caret { flex: none; opacity: 0.6; font-size: 9px; }
    .model-chip--idle { border-style: dashed; opacity: 0.8; }
    .model-menu {
      position: absolute;
      z-index: 200;
      min-width: 240px;
      max-width: 320px;
      max-height: 300px;
      overflow-y: auto;
      margin-top: 4px;
      padding: 4px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: #17181c;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }
    .model-menu__item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 7px 10px;
      border-radius: 8px;
      border: none;
      background: transparent;
      color: rgba(255, 255, 255, 0.9);
      font-size: 12px;
      text-align: left;
      cursor: pointer;
    }
    .model-menu__item:hover { background: rgba(255, 255, 255, 0.1); }
    .model-menu__item--active { color: #E43F3F; font-weight: 700; }
    .model-menu__size { margin-left: auto; opacity: 0.5; font-size: 10px; flex: none; }
    .model-menu__check { flex: none; color: #E43F3F; font-weight: 800; }
    .model-menu__hint {
      padding: 6px 10px;
      color: rgba(255, 255, 255, 0.45);
      font-size: 11px;
    }
  \`;

  @property({ attribute: false }) state: ModelBarState | null = null;
  @property({ attribute: false }) open = false;
  @property({ attribute: false }) busy = false;
  @property({ attribute: false }) hidden = true;

  private onDocClick = (event: MouseEvent) => {
    const target = event.target as Node;
    if (!this.contains(target)) this.open = false;
  };

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this.handleMessage);
    document.addEventListener("click", this.onDocClick);
    window.parent.postMessage({ type: REQUEST_TYPE, action: "get-state" }, "*");
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this.handleMessage);
    document.removeEventListener("click", this.onDocClick);
  }

  private readonly handleMessage = (event: MessageEvent) => {
    const data = event.data as ModelBarState & { type?: string };
    if (data?.type !== STATE_TYPE) return;
    this.state = data;
    this.busy = false;
    this.hidden = !Array.isArray(data.models) || data.models.length === 0;
    this.requestUpdate();
  };

  private toggleMenu() {
    this.open = !this.open;
  }

  private switchModel(modelId: string) {
    this.open = false;
    this.busy = true;
    window.parent.postMessage({ type: REQUEST_TYPE, action: "switch-model", modelId }, "*");
  }

  private formatSize(bytes: number): string {
    if (!bytes) return "";
    const gb = bytes / 1024 / 1024 / 1024;
    return \`\${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB\`;
  }

  override render() {
    if (this.hidden) return;
    const models = this.state?.models ?? [];
    const activeId = this.state?.engineState?.modelId ?? null;
    const active =
      models.find((m) => m.id === activeId) ??
      (activeId ? { id: activeId, name: activeId, fileName: "", sizeBytes: 0 } : null);
    const running = this.state?.engineState?.running === true;
    const label = active
      ? active.name
      : running
        ? (activeId ?? t("localEngine.model"))
        : t("localEngine.selectModel");
    return html\`
      <div class="model-bar" style="position: relative">
        <button
          type="button"
          class="model-chip \${active && !running ? "model-chip--idle" : ""}"
          title=\${active ? active.fileName : ""}
          @click=\${this.toggleMenu}
          ?disabled=\${this.busy}
        >
          <span class="model-chip__icon" aria-hidden="true">⚙</span>
          <span class="model-chip__name">\${this.busy ? t("localEngine.starting") + "…" : label}</span>
          <span class="model-chip__caret" aria-hidden="true">▼</span>
        </button>
        \${this.open
          ? html\`
              <div class="model-menu">
                <div class="model-menu__hint">\${t("localEngine.downloadedModels")}</div>
                \${models.map(
                  (m) => html\`
                    <button
                      type="button"
                      class="model-menu__item \${m.id === activeId ? "model-menu__item--active" : ""}"
                      @click=\${() => this.switchModel(m.id)}
                    >
                      <span class="model-menu__check" aria-hidden="true">\${m.id === activeId ? "✓" : ""}</span>
                      <span class="model-menu__name">\${m.name}</span>
                      <span class="model-menu__size">\${this.formatSize(m.sizeBytes)}</span>
                    </button>
                  \`,
                )}
              </div>
            \`
          : ""}
      </div>
    \`;
  }
}

if (!customElements.get("openclaw-pc-model-bar")) {
  customElements.define("openclaw-pc-model-bar", OpenClawPcModelBar);
}
`;

export async function applyOpenClawUiLocalEnginePatches(uiRoot: string): Promise<void> {
  const srcRoot = join(uiRoot, 'src')
  const components = join(srcRoot, 'components')
  const chatComponents = join(srcRoot, 'pages', 'chat', 'components')

  // 1. Write the two desktop bridge components.
  await writeFile(
    join(components, 'openclaw-pc-engine-toggle.ts'),
    ENGINE_TOGGLE_COMPONENT,
    'utf8',
  )
  await writeFile(
    join(components, 'openclaw-pc-model-bar.ts'),
    MODEL_BAR_COMPONENT,
    'utf8',
  )

  // 2. Topbar: import + toggle button as the very last element of the actions row.
  await patchFile(
    join(components, 'app-topbar.ts'),
    'app-topbar.ts',
    [
      {
        find: 'import "./tooltip.ts";',
        replace:
          'import "./tooltip.ts";\nimport "./openclaw-pc-engine-toggle.ts";',
        expectCount: 1,
      },
      {
        find: '</openclaw-tooltip>\n          </div>\n        </div>\n      </header>',
        replace:
          '</openclaw-tooltip>\n            <openclaw-pc-engine-toggle></openclaw-pc-engine-toggle>\n          </div>\n        </div>\n      </header>',
        expectCount: 1,
      },
    ],
    'js',
  )

  // 3. Composer footer: import + model bar right above the composer meta row.
  await patchFile(
    join(chatComponents, 'chat-composer.ts'),
    'chat-composer.ts',
    [
      {
        find: 'import type { CompactionStatus, FallbackStatus } from "../tool-stream.ts";',
        replace:
          'import type { CompactionStatus, FallbackStatus } from "../tool-stream.ts";\nimport "../../../components/openclaw-pc-model-bar.ts";',
        expectCount: 1,
      },
      {
        find: '<div class="agent-chat__composer-meta">${contextNotice}</div>',
        replace:
          '<openclaw-pc-model-bar></openclaw-pc-model-bar>\n          <div class="agent-chat__composer-meta">${contextNotice}</div>',
        expectCount: 1,
      },
    ],
    'js',
  )

  // 4. Locales: add the localEngine.* keys to en (source) and ru (target).
  const locales = join(srcRoot, 'i18n', 'locales')
  await patchFile(
    join(locales, 'en.ts'),
    'locales/en.ts',
    [
      {
        find: '      nameRequiredShort: "Name required.",\n    },\n  },\n};',
        replace:
          '      nameRequiredShort: "Name required.",\n    },\n  },\n  localEngine: {\n    runningOnGpu: "Running on GPU",\n    runningOnCpu: "Running on CPU",\n    model: "Local model",\n    selectModel: "Select local model",\n    starting: "Starting",\n    downloadedModels: "Downloaded models",\n  },\n};',
        expectCount: 1,
      },
    ],
    'js',
  )
  await patchFile(
    join(locales, 'ru.ts'),
    'locales/ru.ts',
    [
      {
        find: '      nameRequiredShort: "Требуется имя.",\n    },\n  },\n};',
        replace:
          '      nameRequiredShort: "Требуется имя.",\n    },\n  },\n  localEngine: {\n    runningOnGpu: "Работает на GPU",\n    runningOnCpu: "Работает на CPU",\n    model: "Локальная модель",\n    selectModel: "Выбрать локальную модель",\n    starting: "Запуск",\n    downloadedModels: "Скачанные модели",\n  },\n};',
        expectCount: 1,
      },
    ],
    'js',
  )
}
