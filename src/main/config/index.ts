/** Config module re-exports */

export {
  readOpenClawConfig,
  writeOpenClawConfig,
  openclawConfigExists,
  readBundledOpenClawVersion,
  isKernelTwoOrNewer,
} from './openclaw-config.js'

export {
  readShellConfig,
  writeShellConfig,
  getDefaultShellConfig,
} from './shell-config.js'

export {
  runConfigValidate,
  type ConfigValidationResult,
  type ConfigValidationIssue,
} from './config-validate.js'
