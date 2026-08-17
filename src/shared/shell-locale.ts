/**
 * Supported UI locales for the desktop shell (renderer i18n + persisted ShellConfig.locale).
 */
import { APP_NAME } from './constants.js'

export const SHELL_SUPPORTED_LOCALES = ['en', 'zh-CN', 'zh-TW', 'fr', 'ja', 'ko', 'es', 'ru'] as const

export type ShellLocale = (typeof SHELL_SUPPORTED_LOCALES)[number]

/** Follow OS / Electron locale string → supported shell locale */
export function normalizeToShellLocale(electronLocale: string): ShellLocale {
  const lower = electronLocale.toLowerCase()
  if (lower.startsWith('zh')) {
    if (lower.includes('tw') || lower.includes('hk') || lower.includes('hant')) return 'zh-TW'
    return 'zh-CN'
  }
  if (lower.startsWith('fr')) return 'fr'
  if (lower.startsWith('ja')) return 'ja'
  if (lower.startsWith('ko')) return 'ko'
  if (lower.startsWith('es')) return 'es'
  if (lower.startsWith('ru') || lower.startsWith('be') || lower.startsWith('uk')) return 'ru'
  if ((SHELL_SUPPORTED_LOCALES as readonly string[]).includes(lower)) {
    return lower as ShellLocale
  }
  return 'en'
}

/** Native window title before renderer paints (bootstrap / errors) */
export function getLocalizedShellWindowTitle(locale: ShellLocale): string {
  if (locale === 'zh-CN' || locale === 'zh-TW') {
    return 'OpenClaw 桌面版'
  }
  if (locale === 'ru') {
    return 'OpenClaw Desktop'
  }
  return APP_NAME
}
