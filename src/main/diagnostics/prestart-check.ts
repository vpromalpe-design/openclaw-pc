/**
 * Pre-start validation: bundle integrity, config presence, JSON5 parse.
 */

import path from 'node:path'
import { app } from 'electron'
import type { OpenClawValidationResult } from '../utils/openclaw-validate.js'
import { validateOpenclawResources } from '../utils/openclaw-validate.js'
import { getBundledOpenClawDir, getInstallDir, getUserDataDir } from '../utils/paths.js'
import { OPENCLAW_CONFIG_FILE } from '../../shared/constants.js'
import fs from 'node:fs'
import JSON5 from 'json5'
import { getLogAggregator } from './log-aggregator.js'

export interface PrestartCheckResult {
  ok: boolean
  bundleCheck: OpenClawValidationResult
  bundleManifestOk: boolean
  configExists: boolean
  configParseable: boolean
  errors: string[]
  fixSuggestions: string[]
}

export function runPrestartCheck(): PrestartCheckResult {
  const aggregator = getLogAggregator()
  const errors: string[] = []
  const fixSuggestions: string[] = []

  const openclawDir = getBundledOpenClawDir()
  const bundleCheck = validateOpenclawResources(openclawDir)
  let bundleManifestOk = true

  if (!bundleCheck.ok) {
    errors.push(`Bundle incomplete: missing ${bundleCheck.missing.join(', ')}`)
    fixSuggestions.push('OpenClaw bundle is incomplete. Reinstall the application.')
    aggregator.append('install-validation', 'error', `Bundle check failed: ${bundleCheck.missing.join(', ')}`)
  } else {
    aggregator.append('install-validation', 'info', 'Bundle check passed')
  }

  // Detect mixed/stale installer contents (e.g. app.asar version differs from bundle-manifest shellVersion).
  if (app.isPackaged) {
    try {
      const manifestPath = path.join(getInstallDir(), 'resources', 'bundle-manifest.json')
      if (fs.existsSync(manifestPath)) {
        const raw = fs.readFileSync(manifestPath, 'utf-8')
        const parsed = JSON.parse(raw) as { shellVersion?: string; bundledOpenClawVersion?: string }
        const manifestShell = parsed.shellVersion?.trim()
        const appVersion = app.getVersion().trim()
        if (manifestShell && appVersion && manifestShell !== appVersion) {
          bundleManifestOk = false
          errors.push(
            `Bundle manifest mismatch: shellVersion=${manifestShell}, appVersion=${appVersion}`,
          )
          fixSuggestions.push('Installer package appears mixed/stale. Reinstall from a verified release artifact.')
          aggregator.append(
            'install-validation',
            'error',
            `Bundle manifest mismatch: shellVersion=${manifestShell}, appVersion=${appVersion}`,
          )
        } else {
          aggregator.append('install-validation', 'info', 'Bundle manifest version check passed')
        }
      } else {
        bundleManifestOk = false
        errors.push('Bundle manifest missing: resources/bundle-manifest.json')
        fixSuggestions.push('Installer package appears incomplete. Reinstall from a verified release artifact.')
        aggregator.append('install-validation', 'error', 'Bundle manifest missing')
      }
    } catch (err) {
      bundleManifestOk = false
      errors.push(`Bundle manifest parse error: ${err instanceof Error ? err.message : String(err)}`)
      fixSuggestions.push('Installer package appears corrupted. Reinstall from a verified release artifact.')
      aggregator.append(
        'install-validation',
        'error',
        `Bundle manifest parse failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const configPath = path.join(getUserDataDir(), OPENCLAW_CONFIG_FILE)
  const configExists = fs.existsSync(configPath)

  if (!configExists) {
    aggregator.append('install-validation', 'info', `Config not found (wizard will run): ${configPath}`)
  }

  let configParseable = !configExists
  if (configExists) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8')
      JSON5.parse(raw)
      configParseable = true
      aggregator.append('install-validation', 'info', 'Config parse check passed')
    } catch (err) {
      errors.push(`openclaw.json parse error: ${err instanceof Error ? err.message : String(err)}`)
      fixSuggestions.push('openclaw.json is invalid. Fix or remove it and run the setup wizard again.')
      aggregator.append('install-validation', 'error', `Config parse failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const ok = bundleCheck.ok && bundleManifestOk && (configExists ? configParseable : true)

  return {
    ok,
    bundleCheck,
    bundleManifestOk,
    configExists,
    configParseable,
    errors,
    fixSuggestions,
  }
}
