/**
 * OpenClaw PC voice-input patch (applied to Control UI sources BEFORE vite build).
 *
 * v0.9.24: replaces the stock realtime-talk mic button with a single mic button
 * + an Online/Offline toggle:
 *   - Offline: record mic → postMessage to the shell → whisper.cpp (local STT)
 *     → transcript inserted into the composer as if typed.
 *   - Online: native realtime talk (google/openai) — only offered when a key
 *     is actually configured, so we never surface the raw
 *     «Realtime voice provider ... is not configured» error.
 *
 * Bridge (same pattern as the local-engine patch):
 *   request  { type: "openclaw-pc:stt", action: "get-status" | "transcribe" | "set-mode", ... }
 *   reply    { type: "openclaw-pc:stt:state", ... } | { type: "openclaw-pc:stt:result", ... }
 *
 * Idempotent: safe to run after every download-openclaw / prepare-bundle.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SENTINEL = 'openclaw-pc-voice-input'

async function patchFile(
  filePath: string,
  label: string,
  replacements: { find: RegExp | string; replace: string; expectCount?: number }[],
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
        `  [patch-voice-input] ${label}: pattern not found${expectCount != null ? ` (expected ${expectCount}, got ${matches?.length ?? 0})` : ''} — layout may have changed; skipping`,
      )
      return false
    }
    raw = raw.replace(re, replace)
  }
  raw = `// ${SENTINEL} v1\n${raw}`
  await writeFile(filePath, raw, 'utf8')
  console.log(`  [patch-voice-input] ${label}: patched`)
  return true
}

const VOICE_INPUT_COMPONENT = `import { LitElement, html, css } from "lit";
import { property } from "lit/decorators.js";
import { t } from "../i18n/index.ts";

// Desktop bridge: Control UI posts a request, the Electron shell replies.
const REQUEST_TYPE = "openclaw-pc:stt";
const STATE_TYPE = "openclaw-pc:stt:state";
const RESULT_TYPE = "openclaw-pc:stt:result";

type SttState = {
  sttEnabled?: boolean;
  whisperInstalled?: boolean;
  whisperModel?: string;
  realtimeProvider?: string;
  realtimeHasKey?: boolean;
  preferredMode?: "auto" | "offline" | "online";
};

type MicMode = "offline" | "online";

const MAX_RECORD_MS = 15000;

function encodeWav(samples: Float32Array, sampleRate: number): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Record mic until stop() is called or MAX_RECORD_MS elapses → WAV base64 @16k mono. */
function createRecorder() {
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  const chunks: Float32Array[] = [];
  let stopped = false;
  const stopPromise = new Promise<void>((resolve) => {
    const iv = window.setTimeout(() => {
      stop();
      resolve();
    }, MAX_RECORD_MS);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(iv);
      processor?.disconnect();
      stream?.getTracks().forEach((tr) => tr.stop());
      ctx?.close().catch(() => undefined);
      resolve();
    };
    (window as unknown as { __openclawPcMicStop?: () => void }).__openclawPcMicStop = stop;
  });
  const start = async (): Promise<void> => {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    ctx = new AudioContext({ sampleRate: 16000 });
    const src = ctx.createMediaStreamSource(stream);
    processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(processor);
    processor.connect(gain);
    gain.connect(ctx.destination);
  };
  const finish = async (): Promise<string> => {
    (window as unknown as { __openclawPcMicStop?: () => void }).__openclawPcMicStop?.();
    await stopPromise;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    let samples = merged;
    if (ctx && ctx.sampleRate !== 16000 && ctx.sampleRate > 0 && samples.length > 0) {
      const ratio = 16000 / ctx.sampleRate;
      const out = new Float32Array(Math.max(1, Math.floor(samples.length * ratio)));
      for (let i = 0; i < out.length; i++) {
        const pos = i / ratio;
        const i0 = Math.floor(pos);
        const i1 = Math.min(samples.length - 1, i0 + 1);
        const frac = pos - i0;
        out[i] = samples[i0]! * (1 - frac) + samples[i1]! * frac;
      }
      samples = out;
    }
    return encodeWav(samples, 16000);
  };
  return { start, finish, stop: () => (window as unknown as { __openclawPcMicStop?: () => void }).__openclawPcMicStop?.() };
}

export class OpenClawPcVoiceInput extends LitElement {
  static styles = css\`
    :host { display: inline-flex; align-items: center; gap: 6px; }
    .pc-mic {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 32px;
      padding: 0 12px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.9);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
      user-select: none;
      white-space: nowrap;
    }
    .pc-mic:hover { background: rgba(255, 255, 255, 0.14); }
    .pc-mic:active { transform: translateY(0); }
    .pc-mic:disabled { opacity: 0.45; cursor: not-allowed; }
    .pc-mic--rec {
      background: rgba(228, 63, 63, 0.22);
      border-color: rgba(228, 63, 63, 0.6);
      color: #ff7b7b;
      animation: pc-mic-pulse 1.1s ease-in-out infinite;
    }
    .pc-mic--busy { pointer-events: none; opacity: 0.8; }
    .pc-mic--err { border-color: rgba(228, 63, 63, 0.55); color: #ff7b7b; }
    .pc-mic__icon { width: 14px; height: 14px; flex: none; }
    .pc-mic__label { line-height: 1; }
    .pc-mode {
      display: inline-flex;
      align-items: center;
      height: 22px;
      padding: 0 8px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.6);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.3px;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      transition: color 0.15s ease, border-color 0.15s ease;
    }
    .pc-mode:hover { color: rgba(255, 255, 255, 0.9); border-color: rgba(255, 255, 255, 0.3); }
    .pc-mode--offline { color: #4ADE80; border-color: rgba(74, 222, 128, 0.4); }
    .pc-mode--online { color: #60A5FA; border-color: rgba(96, 165, 250, 0.4); }
    .pc-mode__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; margin-right: 4px; }
    @keyframes pc-mic-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(228, 63, 63, 0.45); }
      50% { box-shadow: 0 0 0 6px rgba(228, 63, 63, 0); }
    }
    .pc-spinner {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.25);
      border-top-color: rgba(255, 255, 255, 0.9);
      animation: pc-spin 0.8s linear infinite;
      flex: none;
    }
    @keyframes pc-spin { to { transform: rotate(360deg); } }
  \`;

  @property({ attribute: false }) onToggleVoice?: () => void;
  @property({ attribute: false }) connected = true;
  @property({ attribute: false }) sending = false;
  @property({ attribute: false }) isBusy = false;

  @property({ attribute: false }) state: SttState | null = null;
  @property({ attribute: false }) mode: MicMode | null = null;
  @property({ attribute: false }) recording = false;
  @property({ attribute: false }) busy = false;
  @property({ attribute: false }) error = "";

  private recorder: ReturnType<typeof createRecorder> | null = null;

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this.handleMessage);
    window.parent.postMessage({ type: REQUEST_TYPE, action: "get-status" }, "*");
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this.handleMessage);
    this.recorder?.stop();
  }

  private readonly handleMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; ok?: boolean; text?: string; error?: string; mode?: string } | undefined;
    if (!data?.type) return;
    if (data.type === STATE_TYPE) {
      this.state = data as SttState;
      this.error = "";
      this.busy = false;
      this.requestUpdate();
      return;
    }
    if (data.type === RESULT_TYPE) {
      this.busy = false;
      if (data.ok && data.text) {
        this.insertText(data.text);
      } else {
        this.error = data.error ?? "STT failed";
      }
      this.requestUpdate();
    }
  };

  private offlineAvailable(): boolean {
    return Boolean(this.state?.sttEnabled && this.state?.whisperInstalled);
  }

  private onlineAvailable(): boolean {
    return Boolean(this.state?.realtimeProvider && this.state?.realtimeHasKey);
  }

  private effectiveMode(): MicMode | null {
    const preferred = this.state?.preferredMode;
    const offline = this.offlineAvailable();
    const online = this.onlineAvailable();
    if (preferred === "offline" && offline) return "offline";
    if (preferred === "online" && online) return "online";
    if (offline) return "offline";
    if (online) return "online";
    return null;
  }

  private anyAvailable(): boolean {
    return this.offlineAvailable() || this.onlineAvailable();
  }

  private toggleMode() {
    if (this.busy || this.recording) return;
    const current = this.effectiveMode();
    const next: MicMode = current === "offline" ? "online" : "offline";
    if (next === "offline" && !this.offlineAvailable()) return;
    if (next === "online" && !this.onlineAvailable()) return;
    this.mode = next;
    window.parent.postMessage({ type: REQUEST_TYPE, action: "set-mode", mode: next }, "*");
  }

  private handleMicClick() {
    if (this.busy) return;
    const mode = this.mode ?? this.effectiveMode();
    if (!mode) return;
    if (mode === "online") {
      if (this.onToggleVoice) {
        this.onToggleVoice();
      } else {
        this.error = t("voiceInput.onlineNotConfigured");
      }
      return;
    }
    // Offline (local whisper): push-to-talk.
    if (this.recording) {
      void this.stopAndTranscribe();
      return;
    }
    this.error = "";
    this.recording = true;
    this.recorder = createRecorder();
    this.recorder
      .start()
      .catch((err: unknown) => {
        this.recording = false;
        this.error = err instanceof Error ? err.message : String(err);
        this.requestUpdate();
      });
    this.requestUpdate();
  }

  private async stopAndTranscribe() {
    if (!this.recorder) return;
    this.recording = false;
    this.busy = true;
    this.requestUpdate();
    try {
      const audioBase64 = await this.recorder.finish();
      window.parent.postMessage(
        { type: REQUEST_TYPE, action: "transcribe", audioBase64 },
        "*",
      );
    } catch (err) {
      this.busy = false;
      this.error = err instanceof Error ? err.message : String(err);
      this.requestUpdate();
    }
  }

  private insertText(text: string) {
    const ta = document.querySelector<HTMLTextAreaElement>(
      ".agent-chat__composer-combobox > textarea",
    );
    if (!ta) {
      this.error = "Composer not found";
      this.requestUpdate();
      return;
    }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const next = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.value = next;
    ta.dispatchEvent(
      new InputEvent("input", {
        inputType: "insertText",
        data: text,
        bubbles: true,
        composed: true,
      }),
    );
    ta.focus({ preventScroll: true });
    const caret = start + text.length;
    ta.setSelectionRange(caret, caret);
  }

  override render() {
    const mode = this.mode ?? this.effectiveMode();
    const offline = this.offlineAvailable();
    const online = this.onlineAvailable();
    const disabled = !this.connected || this.sending || this.isBusy;
    const micDisabled = disabled || !this.anyAvailable();
    const micLabel = this.recording
      ? t("voiceInput.stop")
      : this.busy
        ? t("voiceInput.transcribing")
        : mode === "online"
          ? t("voiceInput.online")
          : t("voiceInput.speak");
    const micTitle = this.anyAvailable()
      ? mode === "online"
        ? t("voiceInput.onlineHint")
        : t("voiceInput.offlineHint")
      : t("voiceInput.noneHint");
    return html\`
      <button
        type="button"
        class="pc-mic \${this.recording ? "pc-mic--rec" : ""} \${this.busy ? "pc-mic--busy" : ""} \${this.error ? "pc-mic--err" : ""}"
        title=\${micTitle}
        aria-label=\${micTitle}
        ?disabled=\${micDisabled}
        @click=\${this.handleMicClick}
      >
        \${this.busy
          ? html\`<span class="pc-spinner" aria-hidden="true"></span>\`
          : html\`<svg class="pc-mic__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>\`}
        <span class="pc-mic__label">\${micLabel}</span>
      </button>
      \${(offline || online) && !this.recording
        ? html\`
            <button
              type="button"
              class="pc-mode \${mode === "offline" ? "pc-mode--offline" : "pc-mode--online"}"
              title=\${t("voiceInput.toggleHint")}
              @click=\${this.toggleMode}
            >
              <span class="pc-mode__dot" aria-hidden="true"></span>
              \${mode === "offline" ? t("voiceInput.offline") : t("voiceInput.online")}
            </button>
          \`
        : ""}
    \`;
  }
}

if (!customElements.get("openclaw-pc-voice-input")) {
  customElements.define("openclaw-pc-voice-input", OpenClawPcVoiceInput);
}
`;

export async function applyOpenClawUiVoiceInputPatches(uiRoot: string): Promise<void> {
  const srcRoot = join(uiRoot, 'src')
  const components = join(srcRoot, 'components')
  const chatComponents = join(srcRoot, 'pages', 'chat', 'components')

  // 1. Write the mic component.
  await writeFile(join(components, 'openclaw-pc-voice-input.ts'), VOICE_INPUT_COMPONENT, 'utf8')

  // 2. chat-composer.ts: import + replace the stock realtime-talk mic button
  //    with the desktop mic (offline/online toggle).
  await patchFile(
    join(chatComponents, 'chat-composer.ts'),
    'chat-composer.ts',
    [
      {
        find: 'import type { ChatAttachment, ChatQueueItem } from "../../../lib/chat/chat-types.ts";',
        replace:
          'import type { ChatAttachment, ChatQueueItem } from "../../../lib/chat/chat-types.ts";\nimport "../../../components/openclaw-pc-voice-input.ts";',
        expectCount: 1,
      },
      {
        find: '<openclaw-tooltip .content=${t("chat.composer.startVoiceInput")}>\n                <button\n                  class="chat-send-btn chat-send-btn--voice"\n                  @click=${props.onToggleVoice}\n                  ?disabled=${!props.connected || props.sending || props.isBusy}\n                  aria-label=${t("chat.composer.startVoiceInput")}\n                >\n                  ${icons.mic}\n                  <span class="agent-chat__control-label"\n                    >${t("chat.composer.startVoiceInput")}</span\n                  >\n                </button>\n              </openclaw-tooltip>',
        replace:
          '<openclaw-pc-voice-input\n                .onToggleVoice=${props.onToggleVoice}\n                .connected=${props.connected}\n                .sending=${props.sending}\n                .isBusy=${props.isBusy}\n              ></openclaw-pc-voice-input>',
        expectCount: 1,
      },
    ],
    'js',
  )

  // 3. Locales: voiceInput.* keys (en source + ru target).
  const locales = join(srcRoot, 'i18n', 'locales')
  const voiceInputEn = {
    speak: "Speak",
    stop: "Stop",
    transcribing: "Listening…",
    offline: "Offline",
    online: "Online",
    offlineHint: "Local recognition (whisper)",
    onlineHint: "Cloud recognition (realtime)",
    noneHint: "Voice is not configured — set it up in app settings",
    toggleHint: "Switch recognition mode",
    onlineNotConfigured: "Cloud voice is not configured",
  }
  const voiceInputRu = {
    speak: "Говорите",
    stop: "Стоп",
    transcribing: "Распознаю…",
    offline: "Офлайн",
    online: "Онлайн",
    offlineHint: "Локальное распознавание (whisper)",
    onlineHint: "Облачное распознавание (realtime)",
    noneHint: "Голос не настроен — настройте в приложении",
    toggleHint: "Переключить способ распознавания",
    onlineNotConfigured: "Облачный голос не настроен",
  }
  // Patch en.ts: first try the anchor right after nameRequiredShort (clean
  // sources); local-engine patch inserts its own block before the closing
  // brace, so fall back to the stable end-of-file anchor.
  const enOk =
    (await patchFile(
      join(locales, 'en.ts'),
      'locales/en.ts',
      [
        {
          find: '      nameRequiredShort: "Name required.",\n    },\n  },\n};',
          replace: `      nameRequiredShort: "Name required.",\n    },\n  },\n  voiceInput: ${JSON.stringify(voiceInputEn, null, 2)},\n};`,
          expectCount: 1,
        },
      ],
      'js',
    )) ||
    (await patchFile(
      join(locales, 'en.ts'),
      'locales/en.ts',
      [
        {
          find: '  },\n};',
          replace: `  },\n  voiceInput: ${JSON.stringify(voiceInputEn, null, 2)},\n};`,
          expectCount: 1,
        },
      ],
      'js',
    ))
  if (!enOk) {
    console.warn('  [patch-voice-input] locales/en.ts: no anchor found — voiceInput keys missing')
  }
  const ruOk =
    (await patchFile(
      join(locales, 'ru.ts'),
      'locales/ru.ts',
      [
        {
          find: '      nameRequiredShort: "Требуется имя.",\n    },\n  },\n};',
          replace: `      nameRequiredShort: "Требуется имя.",\n    },\n  },\n  voiceInput: ${JSON.stringify(voiceInputRu, null, 2)},\n};`,
          expectCount: 1,
        },
      ],
      'js',
    )) ||
    (await patchFile(
      join(locales, 'ru.ts'),
      'locales/ru.ts',
      [
        {
          find: '  },\n};',
          replace: `  },\n  voiceInput: ${JSON.stringify(voiceInputRu, null, 2)},\n};`,
          expectCount: 1,
        },
      ],
      'js',
    ))
  if (!ruOk) {
    console.warn('  [patch-voice-input] locales/ru.ts: no anchor found — voiceInput keys missing')
  }
}
