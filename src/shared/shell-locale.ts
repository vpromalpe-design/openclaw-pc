/**
 * Supported UI locales for the desktop shell (renderer i18n + persisted ShellConfig.locale).
 */
import { APP_NAME } from './constants.js'

export const SHELL_SUPPORTED_LOCALES = ['en', 'zh-CN', 'ru'] as const

export type ShellLocale = (typeof SHELL_SUPPORTED_LOCALES)[number]

/** Follow OS / Electron locale string → supported shell locale */
export function normalizeToShellLocale(electronLocale: string): ShellLocale {
  const lower = electronLocale.toLowerCase()
  if (lower.startsWith('zh')) return 'zh-CN'
  if (lower.startsWith('ru') || lower.startsWith('be') || lower.startsWith('uk')) return 'ru'
  if ((SHELL_SUPPORTED_LOCALES as readonly string[]).includes(lower)) {
    return lower as ShellLocale
  }
  return 'en'
}

/** Native window title before renderer paints (bootstrap / errors) */
export function getLocalizedShellWindowTitle(locale: ShellLocale): string {
  if (locale === 'zh-CN') {
    return 'OpenClaw 桌面版'
  }
  if (locale === 'ru') {
    return 'OpenClaw PC'
  }
  return APP_NAME
}
