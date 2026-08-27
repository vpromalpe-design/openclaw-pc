import { app, dialog, Menu, ipcMain, session, screen } from 'electron'
import path from 'node:path'
import { IPC_GATEWAY_LOG, IPC_GATEWAY_STATUS_CHANGE, IPC_STREAM_GATEWAY_LOGS, IPC_UPDATE_AVAILABLE, IPC_LOCAL_FIRST_REQUEST, IPC_LOCAL_FIRST_REQUEST_STATUS } from '../shared/ipc-channels.js'
import { APP_NAME, DEFAULT_GATEWAY_PORT, OPENCLAW_CONFIG_FILE } from '../shared/constants.js'
import { getLogAggregator, runPrestartCheck } from './diagnostics/index.js'
import {
  readOpenClawConfig,
  writeOpenClawConfig,
  openclawConfigExists,
  readShellConfig,
  writeShellConfig,
} from './config/index.js'
import { GatewayProcessManager } from './gateway/index.js'
import { registerIpcHandlers, removeIpcHandlers } from './ipc/index.js'
import { syncAgentActivityMonitor } from './agents/activity.js'
import { TrayManager } from './tray/index.js'
import { WindowManager } from './window/index.js'
import { checkPort } from './utils/port-check.js'
import { getUserDataDir, getInstallDir, getBundledOpenClawPath } from './utils/paths.js'

import { getAppVersions } from './utils/versions.js'
import { initShellLog, logError, logInfo, logWarn } from './utils/logger.js'
import { initAutoUpdater, runPostUpdateValidationIfNeeded, checkForUpdates } from './update/index.js'
import { startBackgroundUpdateCheck, stopBackgroundUpdateCheck } from './update/background-check.js'
import { parseGatewayLogLine } from './logs/index.js'
import { migrateAuthProfilesIfNeeded } from './wizard/index.js'
import { listAuthProfiles } from './providers/index.js'
import {
  maybeAutoStartLocalEngine,
  sanitizeConfigPaths,
  stopLocalEngine,
  stopSchemaFixProxy,
} from './models/local-engine.js'
import { syncLoginItemToSystem, getLoginItemOpenAtLogin, clearLoginItem } from './login-item/index.js'
import { patchGatewayResponseHeaders } from './security/gateway-response-headers.js'
import { rewriteGatewayRequestUrlWithToken, maskSensitiveUrl } from './security/gateway-request-auth.js'
import { ensureLoopbackGatewayOriginHeader } from './security/gateway-request-origin.js'
import { resolveTrayLocale } from './tray/tray-i18n.js'
import { registerShellFileProtocol, registerShellPrivileges } from './shell-protocol.js'

/** Must run before app 'ready' so the shell can use openclaw-shell:// instead of file:// */
registerShellPrivileges()

process.on('uncaughtException', (error) => {
  if ((error as NodeJS.ErrnoException).code === 'EPIPE') return
  logError(`[uncaughtException] ${error.stack ?? error.message}`)
  dialog.showErrorBox('Unexpected Error', error.stack ?? error.message)
})
let isQuitting = false
const windowManager = new WindowManager({
  defaultGatewayPort: DEFAULT_GATEWAY_PORT,
  readShellConfig,
  writeShellConfig,
  isQuitting: () => isQuitting,
})

const trayManager = new TrayManager({
  appName: APP_NAME,
  resolveTrayLocale: () => resolveTrayLocale(readShellConfig),
  onOpenMainWindow: () => windowManager.showMainWindow(),
  onOpenSettings: () => windowManager.showShellRoute('#settings'),
  onOpenAbout: () => windowManager.showShellRoute('#about'),
  onOpenUpdates: () => windowManager.showShellRoute('#updates'),
  onRestartGateway: async () => {
    await gatewayManager.restart()
  },
  onQuit: () => {
    app.quit()
  },
})

const logAggregator = getLogAggregator()
// First local-engine request lifecycle: pending until the engine answers one
// chat request (or errors). Used by the UI to show the "model is loading into
// memory, first message may take up to a minute" banner on cold starts.
let localFirstRequestPending = false
let localFirstRequestDone = false
ipcMain.handle(IPC_LOCAL_FIRST_REQUEST_STATUS, () => ({ pending: localFirstRequestPending }))

const gatewayManager = new GatewayProcessManager({
  onStatusChange: (status) => {
    trayManager.setGatewayStatus(status.status)
    const mainWindow = windowManager.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_GATEWAY_STATUS_CHANGE, status)
    }
  },
  onLog: (log) => {
    const structured = parseGatewayLogLine(log.message, log.stream)
    logAggregator.append(structured.source, structured.level, structured.message)
    const mainWindow = windowManager.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      // First-request lifecycle for local models: the first chat message to a
      // freshly started llama-server is slow (model loading + first prefill),
      // so the UI shows a hint banner until the engine answers once.
      if (!localFirstRequestDone && /\[model-fetch\] start .*provider=local/i.test(structured.message)) {
        localFirstRequestPending = true
        mainWindow.webContents.send(IPC_LOCAL_FIRST_REQUEST, 'start')
      } else if (localFirstRequestPending && /\[model-fetch\] .*provider=local .*(status=|error)/i.test(structured.message)) {
        localFirstRequestPending = false
        localFirstRequestDone = true
        mainWindow.webContents.send(IPC_LOCAL_FIRST_REQUEST, 'done')
      }
      mainWindow.webContents.send(IPC_GATEWAY_LOG, { level: structured.level, message: structured.message })
      mainWindow.webContents.send(IPC_STREAM_GATEWAY_LOGS, structured)
    }
  },
})

// Agent activity heartbeat (v0.9.12 E3): re-ensure the RPC subscription
// whenever the gateway is running. Idempotent; survives gateway restarts.
setInterval(() => {
  void syncAgentActivityMonitor(gatewayManager.getStatus().running)
}, 10_000)

async function cleanupBeforeQuit(): Promise<void> {
  if (isQuitting) return
  isQuitting = true

  // 1. Persist window bounds
  windowManager.persistWindowBounds()

  // 2. Stop child processes (gateway)
  await gatewayManager.stop(5000)

  // 2b. v0.8.25: stop the local engine and its schema-fix proxy so quitting
  // the app does not leave an orphaned llama-server (~13 GB RSS) holding the
  // backend port and the proxy port. (Before 0.8.25 the engine child was only
  // stopped via the IPC stop handler, and stopSchemaFixProxy had no callers.)
  stopLocalEngine()
  stopSchemaFixProxy()

  // 3. Tear down tray
  trayManager.destroy()

  // 4. Remove IPC handlers
  removeIpcHandlers()

  // 5. Stop background update polling
  stopBackgroundUpdateCheck()

}

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('OpenClaw.Desktop')
  }

  // Uninstaller: --clear-login-item (called from NSIS) removes login item
  if (process.argv.includes('--clear-login-item')) {
    clearLoginItem()
    app.exit(0)
    return
  }

  Menu.setApplicationMenu(null) // Remove View, File, etc. menu bar
  initShellLog()
  registerShellFileProtocol()

  // Repair mojibake paths in openclaw.json (cyrillic username mangled by an
  // ANSI round-trip, e.g. PowerShell Get-Content without -Encoding UTF8).
  // Must run before the gateway spawns: it reads workspace/agentDir from the
  // config and would otherwise re-create the agent profile under a garbage
  // C:\Users\<mojibake> directory.
  try {
    const cfg = readOpenClawConfig()
    if (cfg) {
      sanitizeConfigPaths(cfg, (c) => writeOpenClawConfig(c))
    }
  } catch (err) {
    logWarn(`[OpenClaw] sanitizeConfigPaths failed: ${String(err)}`)
  }

  // Allow Control UI to be embedded in our Shell iframe: OpenClaw sets X-Frame-Options: DENY
  // and frame-ancestors 'none', which would block the iframe. We intercept and relax these
  // only for Gateway loopback responses so the Shell can embed the Control UI.
  let loggedGatewayHeaderPatch = false
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const patchedHeaders = patchGatewayResponseHeaders(details.url, details.responseHeaders, {
      resourceType: details.resourceType,
    })
    if (patchedHeaders) {
      if (!loggedGatewayHeaderPatch && details.resourceType === 'subFrame') {
        loggedGatewayHeaderPatch = true
        logInfo(`[OpenClaw] Patched gateway response headers for iframe: ${maskSensitiveUrl(details.url)}`)
      }
      callback({ responseHeaders: patchedHeaders })
      return
    }
    callback({ responseHeaders: details.responseHeaders })
  })
  let loggedGatewayTokenPatch = false
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (
      details.resourceType !== 'webSocket' &&
      details.resourceType !== 'subFrame' &&
      details.resourceType !== 'mainFrame'
    ) {
      callback({})
      return
    }

    const cfg = readOpenClawConfig()
    const cfgPort = cfg?.gateway?.port ?? DEFAULT_GATEWAY_PORT
    const gwStatus = gatewayManager.getStatus()
    // Use the port the desktop-managed gateway is actually bound to; config alone can drift (e.g. after conflict handling).
    const port =
      gwStatus.status === 'running' || gwStatus.status === 'starting' ? gwStatus.port : cfgPort
    const token = cfg?.gateway?.auth?.token
    const redirectURL = rewriteGatewayRequestUrlWithToken(details.url, { port, token })

    if (redirectURL) {
      if (!loggedGatewayTokenPatch) {
        loggedGatewayTokenPatch = true
        logInfo(
          `[OpenClaw] Patched gateway request with auth token (${details.resourceType}): ${maskSensitiveUrl(details.url)}`,
        )
      }
      callback({ redirectURL })
      return
    }

    callback({})
  })
  let loggedGatewayOriginPatch = false
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const cfg = readOpenClawConfig()
    if (cfg?.gateway?.mode === 'remote') {
      callback({ requestHeaders: details.requestHeaders })
      return
    }
    const cfgPort = cfg?.gateway?.port ?? DEFAULT_GATEWAY_PORT
    const gwStatus = gatewayManager.getStatus()
    const port =
      gwStatus.status === 'running' || gwStatus.status === 'starting' ? gwStatus.port : cfgPort
    const headers = details.requestHeaders ?? {}
    const patched = ensureLoopbackGatewayOriginHeader(details.url, headers, port)
    if (!patched) {
      callback({ requestHeaders: details.requestHeaders })
      return
    }
    if (!loggedGatewayOriginPatch) {
      loggedGatewayOriginPatch = true
      logInfo('[OpenClaw] Injected Origin for loopback gateway requests (Electron embed / WebSocket)')
    }
    const cleaned: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(patched)) {
      if (v !== undefined) cleaned[k] = v
    }
    callback({ requestHeaders: cleaned })
  })
  logInfo(`[OpenClaw] App starting. packaged=${String(app.isPackaged)}`)
  logInfo(`[OpenClaw] paths: exe=${app.getPath('exe')} appPath=${app.getAppPath()} resources=${process.resourcesPath}`)
  logInfo(`[OpenClaw] installDir=${getInstallDir()} userDataDir=${getUserDataDir()}`)

  // 1. Single-instance lock
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    logWarn('[OpenClaw] Single instance lock failed; exiting.')
    dialog.showErrorBox(
      'OpenClaw is already running',
      'Another OpenClaw instance is running. Please quit from the system tray first, then restart.',
    )
    app.quit()
    return
  }
  logInfo('[OpenClaw] Single instance lock acquired.')

  app.on('second-instance', () => {
    windowManager.showMainWindow()
    windowManager.reloadMainWindow()
    logInfo('[OpenClaw] Second instance attempted, focusing existing window')
  })

  // 2. Load config
  let shellConfig = readShellConfig()
  void readOpenClawConfig() // Warm cache for gateway and other main-path users
  migrateAuthProfilesIfNeeded() // Migrate legacy credentials/ → agents/main/agent (upstream layout)
  listAuthProfiles(false) // Normalize shorthand auth-profiles keys (provider:name) so gateway auth matches
  if (!openclawConfigExists()) {
    // First-run wizard: reset to stable window size (ignore stale bounds).
    shellConfig = {
      ...shellConfig,
      windowBounds: {
        x: -1,
        y: -1,
        width: 980,
        height: 920,
        maximized: false,
      },
    }
    writeShellConfig(shellConfig)
  }

  // 2.5 Login item: sync OS state → ShellConfig, then apply
  const sysOpenAtLogin = getLoginItemOpenAtLogin()
  if (sysOpenAtLogin !== shellConfig.autoStart) {
    shellConfig = { ...shellConfig, autoStart: sysOpenAtLogin }
    writeShellConfig(shellConfig)
  }
  syncLoginItemToSystem(shellConfig.autoStart)

  // 3. Register IPC handlers
  registerIpcHandlers({
    gatewayManager,
    readOpenClawConfig,
    writeOpenClawConfig,
    openclawConfigExists,
    readShellConfig,
    writeShellConfig,
    checkPort,
    getUserDataDir,
    getBundledOpenClawPath,
    getVersions: () => getAppVersions(getInstallDir()),
    resizeMainWindow: (width: number, height: number, center?: boolean) => {
      const win = windowManager.getMainWindow()
      if (win && !win.isDestroyed() && !win.isMaximized()) {
        const [currentWidth, currentHeight] = win.getSize()
        if (currentWidth < width || currentHeight < height) {
          win.setSize(Math.max(currentWidth, width), Math.max(currentHeight, height))
          if (center) win.center()
        }
      }
    },
    resizeForMainInterface: () => {
      const win = windowManager.getMainWindow()
      if (win && !win.isDestroyed() && !win.isMaximized()) {
        const display = screen.getDisplayMatching(win.getBounds())
        const workArea = display.workAreaSize
        const targetWidth = Math.max(980, Math.min(1440, workArea.width))
        const targetHeight = Math.max(700, Math.min(960, workArea.height))
        win.setSize(targetWidth, targetHeight)
        win.center()
      }
    },
    setMainWindowTitle: (title: string) => {
      windowManager.setMainWindowTitle(title)
    },
    refreshTrayMenu: () => {
      trayManager.refreshMenu()
    },
    sendToRenderer: (channel: string, ...args: unknown[]) => {
      const win = windowManager.getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, ...args)
      }
    },
  })

  // 4. Main window (packaged: loadFile from asar.unpacked renderer to avoid blank screen)
  logInfo('[OpenClaw] Creating main window...')
  windowManager.createMainWindow()

  // 4.5 Auto-start the local GGUF engine when the primary agent model is local/*
  // (after IPC wiring so writeConfig/readConfig deps are live; failures are
  // non-fatal and surface in the Models panel instead of blocking startup).
  // Note: this is a fallback for post-wizard config changes; the primary
  // pre-gateway start happens earlier in the startup sequence.
  void maybeAutoStartLocalEngine(
    () => readOpenClawConfig(),
    (c) => {
      writeOpenClawConfig(c)
      readOpenClawConfig()
    },
  ).then((coldStart) => {
    if (coldStart && localFirstRequestPending === false) {
      localFirstRequestPending = true
      const win = windowManager.getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_LOCAL_FIRST_REQUEST, 'start')
      }
    }
  })
  logInfo('[OpenClaw] Main window created.')

  // 4.5 Post-update validation if .post-update-pending marker exists
  void runPostUpdateValidationIfNeeded({
    readOpenClawConfig: () => readOpenClawConfig() ?? {},
    readShellConfig: () => readShellConfig(),
    gatewayStatus: () => {
      const s = gatewayManager.getStatus()
      return { running: s.running, status: s.status }
    },
  })

  // Forward electron-updater events to renderer (packaged builds)
  const sendToRenderer = (channel: string, ...args: unknown[]) => {
    const win = windowManager.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
  initAutoUpdater(readShellConfig, sendToRenderer)

  startBackgroundUpdateCheck(
    readShellConfig,
    (partial) => {
      const cfg = readShellConfig()
      writeShellConfig({ ...cfg, ...partial })
    },
    () => checkForUpdates(readShellConfig).then((r) => ({ hasUpdate: r.hasUpdate ?? false, latestVersion: r.latestVersion })),
    (info) => {
      trayManager.setUpdateAvailable(true)
      sendToRenderer(IPC_UPDATE_AVAILABLE, info)
    },
  )

  trayManager.create()
  trayManager.setGatewayStatus(gatewayManager.getStatus().status)


  // 5. Pre-start checks (bundle + config)
  const prestartCheck = runPrestartCheck()
  if (!prestartCheck.ok) {
    const detail =
      prestartCheck.errors.join('\n\n') +
      (prestartCheck.fixSuggestions.length > 0
        ? '\n\nSuggestions:\n' + prestartCheck.fixSuggestions.map((s) => `• ${s}`).join('\n')
        : '')
    logError(`[OpenClaw] Prestart check failed: ${prestartCheck.errors.join('; ')}`)
    dialog.showErrorBox('Startup check failed', detail)
    windowManager.showErrorPage(
      'Startup check failed',
      detail,
    )
    windowManager.showMainWindow()
    return
  }

  // 4.5 Local engine pre-start for local/* primary models.
  // The gateway must NEVER see a dead engine port: a cold llama-server makes
  // the first user message fail with "network connection error" (the engine
  // auto-start used to run async AFTER the gateway was already accepting
  // chats). When the primary agent model is local/* we start the engine here,
  // synchronously, before the gateway spawns below (bounded by the engine's
  // own 120s health wait; GPU→CPU fallback included).
  if (openclawConfigExists()) {
    const cfg0 = readOpenClawConfig()
    const primary0 =
      typeof cfg0?.agents?.defaults?.model === 'string'
        ? cfg0.agents.defaults.model
        : cfg0?.agents?.defaults?.model?.primary
    if (primary0 && primary0.startsWith('local/')) {
      try {
        const coldStart = await maybeAutoStartLocalEngine(
          () => readOpenClawConfig(),
          (c) => {
            writeOpenClawConfig(c)
            readOpenClawConfig()
          },
        )
        if (coldStart && localFirstRequestPending === false) {
          // Engine was started cold — model is being loaded into memory;
          // the UI shows a banner until the first chat request completes.
          localFirstRequestPending = true
          const win = windowManager.getMainWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC_LOCAL_FIRST_REQUEST, 'start')
          }
        }
      } catch (err) {
        logWarn(
          `[OpenClaw] Local engine pre-start failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // 6. If config exists, start gateway from main (don’t wait for renderer)
  if (openclawConfigExists()) {
    const cfg = readOpenClawConfig()
    const gw = cfg?.gateway
    const port = gw?.port ?? DEFAULT_GATEWAY_PORT
    const bind = gw?.bind ?? 'loopback'
    const token = gw?.auth?.token?.trim()
    const force = Boolean(gw?.forcePortOnConflict)
    void gatewayManager.start({ port, bind, token: token || undefined, force }).catch((err) => {
      logError(`[OpenClaw] Failed to auto-start Gateway: ${err instanceof Error ? err.message : String(err)}`)
    })
  } else {
    const configPath = path.join(getUserDataDir(), OPENCLAW_CONFIG_FILE)
    logWarn(`[OpenClaw] openclaw.json not found at ${configPath}; Gateway will not auto-start. Complete the setup wizard first.`)
  }

  app.on('activate', () => {
    if (windowManager.getMainWindow() === null) {
      windowManager.createMainWindow()
      return
    }
    windowManager.showMainWindow()
  })
})

app.on('before-quit', (event) => {
  if (isQuitting) return
  event.preventDefault()
  void cleanupBeforeQuit().finally(() => {
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
