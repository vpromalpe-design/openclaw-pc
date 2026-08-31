import { create } from 'zustand'
import type {
  ModelConfig,
  ChannelConfig,
  GatewayWizardConfig,
  VoiceConfig,
  WizardState,
} from '../../shared/types'
import { requiresApiKey } from '@/utils/provider-auth'
import { waitForGatewayReady } from '@/utils/gateway-health'
import type { TFunction } from 'i18next'

// ─── Step Definitions ────────────────────────────────────────────────────────

export const WIZARD_STEP_COUNT = 5

export interface WizardStepDef {
  id: string
  label: string
  skippable?: boolean
}

export const WIZARD_STEPS: readonly WizardStepDef[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'model', label: 'Model', skippable: true },
  { id: 'channel', label: 'Channels', skippable: true },
  { id: 'voice', label: 'Voice', skippable: true },
  { id: 'complete', label: 'Complete' },
] as const

// ─── Default Values ──────────────────────────────────────────────────────────

export function generateAuthToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: 'anthropic',
  apiKey: '',
  modelId: 'claude-opus-4-6',
  moonshotRegion: 'global',
  customProviderId: '',
  customBaseUrl: '',
  customCompatibility: 'openai',
  openrouterBaseUrl: '',
  reasoningLevel: 'medium',
}

const DEFAULT_CHANNEL_CONFIG: ChannelConfig = {
  telegram: null,
  discord: null,
  slack: null,
  whatsapp: null,
  selectedChannel: 'webchat',
  skipChannels: false,
}

const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  provider: 'google',
  apiKey: '',
  skipVoice: false,
}

function createDefaultGatewayConfig(): GatewayWizardConfig {
  return {
    port: 18789,
    bind: 'loopback',
    authToken: generateAuthToken(),
  }
}

// ─── Model test (footer button) ──────────────────────────────────────────────

export type ModelTestStatus = 'idle' | 'testing' | 'success' | 'error'

export interface ModelTestState {
  status: ModelTestStatus
  message: string
}

// ─── Store Types ─────────────────────────────────────────────────────────────

export type DeployPhase = 'idle' | 'writing' | 'starting' | 'success' | 'error'

interface WizardActions {
  /** Advance to the next step, marking current step as completed */
  nextStep: () => void
  /** Go back to the previous step */
  prevStep: () => void
  /** Navigate to a specific step (only previously visited or next available) */
  goToStep: (step: number) => void
  /** Merge partial model configuration into current state */
  setModelConfig: (config: Partial<ModelConfig>) => void
  /** Merge partial channel configuration into current state */
  setChannelConfig: (config: Partial<ChannelConfig>) => void
  /** Merge partial voice configuration into current state */
  setVoiceConfig: (config: Partial<VoiceConfig>) => void
  /** Merge partial gateway configuration into current state */
  setGatewayConfig: (config: Partial<GatewayWizardConfig>) => void
  /** Check whether a given step passes validation */
  isStepValid: (step: number) => boolean
  /** Extract the serializable WizardState (without actions or UI-only fields) */
  getWizardData: () => WizardState
  /** Reset the entire store to initial defaults */
  reset: () => void
  /** Set deploy state */
  setDeployState: (phase: DeployPhase, message: string) => void
  /** Model connection test state (button lives in the wizard footer) */
  testState: ModelTestState
  setTestState: (state: ModelTestState) => void
  /** Trigger deploy (write config, start gateway, wait, redirect) */
  triggerDeploy: (t: TFunction) => Promise<void>
}

interface WizardInternalState extends WizardState {
  /** Per-step completion tracking (indexed by step number) */
  completedSteps: boolean[]
  deployPhase: DeployPhase
  deployMessage: string
  /** Model connection test state (button lives in the wizard footer) */
  testState: ModelTestState
}

export type WizardStore = WizardInternalState & WizardActions

// ─── Initial State ───────────────────────────────────────────────────────────

function createInitialState(): WizardInternalState {
  return {
    currentStep: 0,
    completedSteps: Array.from({ length: WIZARD_STEP_COUNT }, () => false),
    modelConfig: { ...DEFAULT_MODEL_CONFIG },
    channelConfig: { ...DEFAULT_CHANNEL_CONFIG },
    voiceConfig: { ...DEFAULT_VOICE_CONFIG },
    gatewayConfig: createDefaultGatewayConfig(),
    deployPhase: 'idle',
    deployMessage: '',
    testState: { status: 'idle', message: '' },
  }
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useWizardStore = create<WizardStore>((set, get) => ({
  ...createInitialState(),

  nextStep: () =>
    set((state) => {
      const next = state.currentStep + 1
      if (next >= WIZARD_STEP_COUNT) return state
      const completedSteps = [...state.completedSteps]
      completedSteps[state.currentStep] = true
      return { currentStep: next, completedSteps }
    }),

  prevStep: () =>
    set((state) => {
      if (state.currentStep <= 0) return state
      return { currentStep: state.currentStep - 1 }
    }),

  goToStep: (step) => {
    if (step < 0 || step >= WIZARD_STEP_COUNT) return
    const { completedSteps, currentStep } = get()
    const canNavigate =
      step <= currentStep ||
      completedSteps[step] ||
      (step > 0 && completedSteps[step - 1])
    if (canNavigate) {
      set({ currentStep: step })
    }
  },

  setModelConfig: (config) =>
    set((state) => ({
      modelConfig: { ...state.modelConfig, ...config },
      // Any config change invalidates the previous test result.
      testState: { status: 'idle', message: '' },
    })),

  setChannelConfig: (config) =>
    set((state) => ({
      channelConfig: { ...state.channelConfig, ...config },
    })),

  setVoiceConfig: (config) =>
    set((state) => ({
      voiceConfig: { ...state.voiceConfig, ...config },
    })),

  setGatewayConfig: (config) =>
    set((state) => ({
      gatewayConfig: { ...state.gatewayConfig, ...config },
    })),

  isStepValid: (step) => {
    const state = get()
    switch (step) {
      case 0:
        return true
      case 1:
        if (state.modelConfig.provider === 'local') {
          // Local engine: a model id (preset or custom) is enough; no API key.
          return Boolean(state.modelConfig.modelId.trim())
        }
        if (!state.modelConfig.provider || !state.modelConfig.modelId.trim()) {
          return false
        }
        if (state.modelConfig.provider === 'cloudflare-ai-gateway') {
          return Boolean(
            state.modelConfig.apiKey.trim() &&
              state.modelConfig.cloudflareAccountId?.trim() &&
              state.modelConfig.cloudflareGatewayId?.trim(),
          )
        }
        if (state.modelConfig.provider === 'custom') {
          return Boolean(
            state.modelConfig.apiKey.trim() &&
              state.modelConfig.customProviderId?.trim() &&
              state.modelConfig.customBaseUrl?.trim(),
          )
        }
        if (requiresApiKey(state.modelConfig.provider)) {
          return Boolean(state.modelConfig.apiKey.trim())
        }
        return true
      case 2:
        if (state.channelConfig.skipChannels) return true
        switch (state.channelConfig.selectedChannel) {
          case 'telegram':
            return Boolean(state.channelConfig.telegram?.botToken?.trim())
          case 'discord':
            return Boolean(state.channelConfig.discord?.token?.trim())
          case 'whatsapp':
            return true
          case 'webchat':
            return true
          default:
            return true
        }
      case 3:
        // Voice step: always skippable — either the user configured a
        // provider/key or pressed «Пропустить»; never block the wizard.
        return true
      case 4:
        return true
      default:
        return false
    }
  },

  getWizardData: () => {
    const { currentStep, modelConfig, channelConfig, voiceConfig, gatewayConfig } = get()
    return { currentStep, modelConfig, channelConfig, voiceConfig, gatewayConfig }
  },

  reset: () => set(createInitialState()),

  setDeployState: (phase, message) => set({ deployPhase: phase, deployMessage: message }),

  setTestState: (testState) => set({ testState }),

  triggerDeploy: async (t) => {
    const state = get()
    const wizardData = state.getWizardData()
    set({ deployPhase: 'writing', deployMessage: t('wizard.complete.writing') })

    let result: { ok: boolean; port?: number; error?: string; phase?: string }
    try {
      result = await window.electronAPI.wizardCompleteSetup(wizardData)
    } catch {
      set({ deployPhase: 'error', deployMessage: t('wizard.complete.errorConfig') })
      return
    }

    if (!result.ok) {
      const phaseMessages: Record<string, string> = {
        config: t('wizard.complete.errorConfig'),
        auth: t('wizard.complete.errorAuth'),
        gateway: t('wizard.complete.errorGateway'),
      }
      set({
        deployPhase: 'error',
        deployMessage: (result.phase && phaseMessages[result.phase]) ?? result.error ?? t('wizard.complete.errorGeneral'),
      })
      return
    }

    set({ deployPhase: 'starting', deployMessage: t('wizard.complete.starting') })
    const port = wizardData.gatewayConfig.port
    let redirected = false

    const navigate = () => {
      if (redirected) return
      redirected = true
      set({ deployPhase: 'success', deployMessage: t('wizard.complete.success') })
      setTimeout(() => {
        void (async () => {
          try {
            const shellConfig = await window.electronAPI.shellGetConfig()
            if (!shellConfig?.onboardingMainWindowExpanded) {
              await window.electronAPI.shellResizeForMainInterface()
              await window.electronAPI.shellSetConfig({ onboardingMainWindowExpanded: true })
            }
          } catch {
            // Ignore one-shot expand flag write errors; still navigate to main UI
          } finally {
            // Do not navigate the top-level document to the gateway URL: the Control UI is meant to
            // load inside EmbeddedShellLayout's iframe (with token from config). A full window
            // navigation to http://127.0.0.1 often yields a blank page in packaged builds.
            window.location.hash = ''
            window.location.reload()
          }
        })()
      }, 800)
    }

    window.electronAPI.onGatewayStatusChange((status: { status: string; port?: number }) => {
      if (status.status === 'running') navigate()
      if (status.status === 'error') set({ deployPhase: 'error', deployMessage: t('shell.dashboard.errorHint') })
    })

    const poll = async () => {
      const ready = await waitForGatewayReady(port)
      if (ready) navigate()
      else set({ deployPhase: 'error', deployMessage: 'Gateway did not become ready within 5 minutes.' })
    }

    try {
      const gwStatus = await window.electronAPI.gatewayStatus()
      if (gwStatus?.status === 'running') navigate()
      else if (gwStatus?.status === 'error') set({ deployPhase: 'error', deployMessage: t('shell.dashboard.errorHint') })
    } catch { /* ignore */ }

    void poll()
  },
}))
