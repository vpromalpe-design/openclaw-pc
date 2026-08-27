/**
 * Tray context menu strings (main process). Kept in sync with shell locales.
 */
import { app } from 'electron'
import type { ShellConfig } from '../../shared/types.js'
import {
  SHELL_SUPPORTED_LOCALES,
  normalizeToShellLocale,
  type ShellLocale,
} from '../../shared/shell-locale.js'

export interface TrayMenuStrings {
  openApp: string
  updateAvailable: string
  gatewayRunning: string
  gatewayStarting: string
  gatewayError: string
  gatewayStopped: string
  restartGateway: string
  openConfigDir: string
  settings: string
  settingsGeneral: string
  about: string
  quit: string
}

const EN: TrayMenuStrings = {
  openApp: 'Open OpenClaw',
  updateAvailable: 'Update available',
  gatewayRunning: 'Gateway: Running',
  gatewayStarting: 'Gateway: Starting',
  gatewayError: 'Gateway: Error',
  gatewayStopped: 'Gateway: Stopped',
  restartGateway: 'Restart Gateway',
  openConfigDir: 'Open config directory',
  settings: 'Settings',
  settingsGeneral: 'General',
  about: 'About',
  quit: 'Quit',
}

const ZH_CN: TrayMenuStrings = {
  openApp: '打开 OpenClaw',
  updateAvailable: '有更新可用',
  gatewayRunning: '网关：运行中',
  gatewayStarting: '网关：启动中',
  gatewayError: '网关：错误',
  gatewayStopped: '网关：已停止',
  restartGateway: '重启网关',
  openConfigDir: '打开配置目录',
  settings: '设置',
  settingsGeneral: '常规',
  about: '关于',
  quit: '退出',
}

const RU: TrayMenuStrings = {
  openApp: 'Открыть OpenClaw',
  updateAvailable: 'Доступно обновление',
  gatewayRunning: 'Шлюз: запущен',
  gatewayStarting: 'Шлюз: запускается',
  gatewayError: 'Шлюз: ошибка',
  gatewayStopped: 'Шлюз: остановлен',
  restartGateway: 'Перезапустить шлюз',
  openConfigDir: 'Открыть папку конфигурации',
  settings: 'Настройки',
  settingsGeneral: 'Общие',
  about: 'О приложении',
  quit: 'Выход',
}

const BY_LOCALE: Record<ShellLocale, TrayMenuStrings> = {
  en: EN,
  'zh-CN': ZH_CN,
  ru: RU,
}

export function getTrayMenuStrings(locale: ShellLocale): TrayMenuStrings {
  return BY_LOCALE[locale] ?? EN
}

/** Resolve active shell UI locale: persisted ShellConfig.locale, else OS locale. */
export function resolveTrayLocale(readShellConfig: () => ShellConfig): ShellLocale {
  const cfg = readShellConfig()
  const raw = cfg.locale
  if (typeof raw === 'string' && (SHELL_SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
    return raw as ShellLocale
  }
  return normalizeToShellLocale(app.getLocale())
}

