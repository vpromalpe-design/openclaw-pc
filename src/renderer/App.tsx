import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingView } from '@/shell/LoadingView'
import { EmbeddedShellLayout, type EmbeddedPanel } from '@/shell/EmbeddedShellLayout'
import { WizardLayout } from './wizard/WizardLayout'
import { syncNativeWindowTitle } from '@/i18n'

function getHashRoute(): string {
  return window.location.hash.replace(/^#/, '')
}

const VALID_HASH_PANELS = new Set<string>([
  'settings',
  'voice',
  'about',
  'telegram',
  'dashboard',
  'models',
  'llm-api',
  'skills',
  'updates',
  'agent-settings',
  'tasks',
  'gateway',
])

/** Map legacy hashes and drop unknown fragments (e.g. pasted gateway #token=…) so we don't open a bogus “panel”. */
function normalizeShellRoute(route: string): string {
  if (!route) return ''
  if (!VALID_HASH_PANELS.has(route)) return ''
  return route
}

function App() {
  const { t, i18n } = useTranslation()
  const [route, setRoute] = useState<string | null>(null)
  const [configExists, setConfigExists] = useState<boolean | null>(null)

  useEffect(() => {
    if (typeof window.electronAPI === 'undefined') return
    window.electronAPI
      .configExists()
      .then((exists) => {
        setConfigExists(exists)
        if (!exists) {
          setRoute('wizard')
          return
        }
        setRoute(normalizeShellRoute(getHashRoute() || ''))
      })
      .catch((err) => {
        console.warn('[OpenClaw] configExists failed:', err)
        setConfigExists(false)
        setRoute('wizard')
      })
  }, [])

  useEffect(() => {
    if (configExists !== true) return
    const handler = () => setRoute(normalizeShellRoute(getHashRoute() || ''))
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [configExists])

  const handlePanelChange = useCallback((panel: EmbeddedPanel) => {
    const hash = panel === '' ? '' : `#${panel}`
    if (window.location.hash !== hash) {
      window.location.hash = hash
    }
    setRoute(panel)
  }, [])

  // Control UI (iframe) → shell bridge: sidebar "Models" item posts a message,
  // we open the desktop Models panel on top of the Control UI.
  useEffect(() => {
    if (configExists !== true) return
    const onBridgeMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; panel?: string } | undefined
      if (data?.type !== 'openclaw-pc:open-panel') return
      const panel = normalizeShellRoute(String(data.panel ?? ''))
      if (!panel) return
      handlePanelChange(panel as EmbeddedPanel)
    }
    window.addEventListener('message', onBridgeMessage)
    return () => window.removeEventListener('message', onBridgeMessage)
  }, [configExists, handlePanelChange])

  // Control UI (iframe) → shell bridge for the local engine: the CPU/GPU
  // toggle and the model bar inside Control UI ask the desktop main process
  // for engine state (via IPC) and get the answer posted back into the iframe.
  useEffect(() => {
    if (configExists !== true) return
    const onEngineBridgeMessage = async (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; action?: string; modelId?: string }
        | undefined
      if (data?.type !== 'openclaw-pc:local-engine') return
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[title="OpenClaw Control UI"]',
      )
      if (!iframe || event.source !== iframe.contentWindow) return
      const respond = (payload: unknown) => {
        // Target the iframe's exact origin instead of '*'; fall back to
        // discarding the response when the origin cannot be derived.
        let targetOrigin: string | null = null
        try {
          targetOrigin = new URL(iframe.src).origin
        } catch {
          targetOrigin = null
        }
        if (!targetOrigin) return
        iframe.contentWindow?.postMessage(
          { type: 'openclaw-pc:local-engine:state', ...(payload as object) },
          targetOrigin,
        )
      }
      try {
        if (data.action === 'toggle-mode') {
          const current = await window.electronAPI.localEngineMode()
          const next = current.effectiveGpu === 'cpu' ? 'gpu' : 'cpu'
          respond(await window.electronAPI.localEngineMode({ setMode: next }))
        } else if (data.action === 'switch-model' && data.modelId) {
          await window.electronAPI.localEngineStart({
            modelId: data.modelId,
          })
          respond(await window.electronAPI.localEngineMode())
        } else {
          respond(await window.electronAPI.localEngineMode())
        }
      } catch (err) {
        respond({
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    window.addEventListener('message', onEngineBridgeMessage)
    return () => window.removeEventListener('message', onEngineBridgeMessage)
  }, [configExists])

  // Control UI (iframe) → shell bridge for the mic input: the desktop mic
  // button inside Control UI asks for STT/realtime status, asks the main
  // process to transcribe WAV with whisper.cpp (offline), and persists the
  // preferred online/offline mode.
  useEffect(() => {
    if (configExists !== true) return
    const onSttBridgeMessage = async (event: MessageEvent) => {
      const data = event.data as
        | {
            type?: string
            action?: string
            audioBase64?: string
            mode?: string
          }
        | undefined
      if (data?.type !== 'openclaw-pc:stt') return
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[title="OpenClaw Control UI"]',
      )
      if (!iframe || event.source !== iframe.contentWindow) return
      const respond = (type: string, payload: object) => {
        let targetOrigin: string | null = null
        try {
          targetOrigin = new URL(iframe.src).origin
        } catch {
          targetOrigin = null
        }
        if (!targetOrigin) return
        iframe.contentWindow?.postMessage({ type, ...payload }, targetOrigin)
      }
      try {
        if (data.action === 'transcribe' && data.audioBase64) {
          const res = await window.electronAPI.sttTranscribe({
            audioBase64: data.audioBase64,
          })
          respond('openclaw-pc:stt:result', {
            ok: Boolean(res.ok),
            text: res.text,
            error: res.error,
          })
          return
        }
        if (data.action === 'set-mode' && data.mode) {
          const mode =
            data.mode === 'offline' || data.mode === 'online' ? data.mode : 'auto'
          await window.electronAPI.sttSetPreferredMode({ mode })
        }
        // get-status (default): aggregate local STT + realtime voice state.
        const [stt, voice] = await Promise.all([
          window.electronAPI.sttLoad(),
          window.electronAPI.voiceSettingsLoad(),
        ])
        const shell = await window.electronAPI.shellGetConfig()
        const sttState = stt as {
          enabled?: boolean
          whisper?: { installed?: boolean; modelsInstalled?: string[] }
          model?: string
        }
        respond('openclaw-pc:stt:state', {
          sttEnabled: Boolean(sttState?.enabled),
          whisperInstalled: Boolean(sttState?.whisper?.installed),
          whisperModel: sttState?.model ?? 'base',
          realtimeProvider: voice.provider ?? '',
          realtimeHasKey: Boolean(voice.hasKey),
          preferredMode: shell?.sttPreferredMode ?? 'auto',
        })
      } catch (err) {
        respond('openclaw-pc:stt:result', {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    window.addEventListener('message', onSttBridgeMessage)
    return () => window.removeEventListener('message', onSttBridgeMessage)
  }, [configExists])

  /** Native title + document.title: wizard uses app name only (без «Мастер настройки» в заголовке). */
  useEffect(() => {
    if (route === null || configExists === null) {
      syncNativeWindowTitle(t('app.name'))
      return
    }
    if (route === 'wizard') {
      syncNativeWindowTitle(t('app.name'))
      return
    }
    if (configExists) {
      const panelTitles: Record<string, string> = {
        '': t('shell.dashboard.title'),
        dashboard: t('shell.dashboard.title'),
        models: t('shell.models.title'),
        settings: t('shell.settings.title'),
        voice: t('voice.settings.title'),
        about: t('shell.about.title'),
        'llm-api': t('shell.dashboard.llmApi'),
        skills: t('shell.skillsPanel.title'),
        updates: t('shell.updates.title'),
      }
      const segment = panelTitles[route] ?? t('shell.dashboard.title')
      syncNativeWindowTitle(`${segment} - ${t('app.name')}`)
    }
  }, [route, configExists, t, i18n.language])

  if (typeof window.electronAPI === 'undefined') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{t('shell.error.preloadTitle')}</h1>
        <p className="text-sm text-muted-foreground max-w-sm">{t('shell.error.preloadBody')}</p>
        <p className="text-xs text-muted-foreground max-w-sm">{t('shell.error.preloadHint')}</p>
      </main>
    )
  }

  if (route === null || configExists === null) {
    return <LoadingView statusText={t('shell.loading.checkingConfig')} />
  }
  if (route === 'wizard') return <WizardLayout />
  if (configExists) {
    const panel: EmbeddedPanel =
      route === 'settings' ||
      route === 'voice' ||
      route === 'about' ||
      route === 'dashboard' ||
      route === 'models' ||
      route === 'llm-api' ||
      route === 'skills' ||
      route === 'updates' ||
      route === 'telegram' ||
      route === 'agent-settings' ||
      route === 'tasks' ||
      route === 'gateway'
        ? route
        : ''
    return <EmbeddedShellLayout activePanel={panel} onPanelChange={handlePanelChange} />
  }
  return <LoadingView statusText={t('shell.loading.checkingConfig')} />
}

export default App
