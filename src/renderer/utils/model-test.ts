import { requiresApiKey } from '@/utils/provider-auth'
import type { ModelConfig, ModelProvider } from '../../shared/types'

/** Providers that support an automatic connection test in the wizard. */
export const TESTABLE_PROVIDERS = new Set<ModelProvider>([
  'deepseek',
  'anthropic',
  'openai',
  'google',
  'moonshot',
  'moonshot-cn',
  'openrouter',
  'kuae',
  'custom',
  'local',
])

/** Whether the wizard connection test can run for the current model config. */
export function canTestModel(modelConfig: ModelConfig): boolean {
  return Boolean(
    modelConfig.provider &&
      modelConfig.modelId.trim() &&
      TESTABLE_PROVIDERS.has(modelConfig.provider) &&
      (modelConfig.provider !== 'custom' ||
        (modelConfig.apiKey.trim() &&
          modelConfig.customProviderId?.trim() &&
          modelConfig.customBaseUrl?.trim())) &&
      (modelConfig.provider !== 'openrouter' ||
        Boolean((modelConfig.openrouterBaseUrl ?? '').trim())) &&
      (!requiresApiKey(modelConfig.provider) || modelConfig.apiKey.trim()),
  )
}
