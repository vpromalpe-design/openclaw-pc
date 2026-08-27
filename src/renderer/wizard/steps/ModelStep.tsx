import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useWizardStore } from '@/stores/wizard-store'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getProviderAuthMode, requiresApiKey } from '@/utils/provider-auth'
import { ProviderLogo } from '@/components/ProviderLogo'
import { LocalModelPicker } from '../LocalModelPicker'
import { XCircle, Eye, EyeOff } from 'lucide-react'
import { TESTABLE_PROVIDERS, canTestModel } from '@/utils/model-test'
import type { ModelProvider, ReasoningLevel } from '../../../shared/types'
import { PROVIDER_OPTIONS, MODELS_BY_PROVIDER } from '@/constants/provider-presets'

const CUSTOM_MODEL_OPTION = '__custom__'

// ─── Component ───────────────────────────────────────────────────────────────

export function ModelStep() {
  const { t } = useTranslation()
  const { modelConfig, setModelConfig } = useWizardStore()
  const testState = useWizardStore((s) => s.testState)
  const setTestState = useWizardStore((s) => s.setTestState)
  const [showApiKey, setShowApiKey] = useState(false)
  const [useCustomModel, setUseCustomModel] = useState(() => {
    const presets = MODELS_BY_PROVIDER[modelConfig.provider]
    if (!presets) return true
    return !presets.some((m) => m.id === modelConfig.modelId) && modelConfig.modelId !== ''
  })
  const [customLocalUrl, setCustomLocalUrl] = useState('')

  const providerPresets = MODELS_BY_PROVIDER[modelConfig.provider]
  const hasPresets = Boolean(providerPresets)
  const authMode = getProviderAuthMode(modelConfig.provider)
  const apiKeyRequired = requiresApiKey(modelConfig.provider)

  const handleProviderChange = useCallback(
    (provider: ModelProvider) => {
      const presets = MODELS_BY_PROVIDER[provider]
      const nextAuthMode = getProviderAuthMode(provider)
      const shouldClearApiKey = nextAuthMode === 'oauth' || nextAuthMode === 'none'
      setModelConfig({
        provider,
        // Local: no bundled presets — the user adds their own GGUF
        // by URL or from disk (v0.9.0).
        modelId:
          provider === 'local'
            ? ''
            : (presets?.[0]?.id ?? ''),
        ...(shouldClearApiKey ? { apiKey: '' } : {}),
        moonshotRegion: provider === 'moonshot-cn' ? 'cn' : provider === 'moonshot' ? modelConfig.moonshotRegion ?? 'global' : 'global',
        customProviderId: provider === 'custom' ? modelConfig.customProviderId ?? '' : '',
        customBaseUrl: provider === 'custom' ? modelConfig.customBaseUrl ?? '' : '',
        customCompatibility: provider === 'custom' ? modelConfig.customCompatibility ?? 'openai' : undefined,
        openrouterBaseUrl:
          provider === 'openrouter'
            ? (modelConfig.openrouterBaseUrl ?? 'https://openrouter.ai/api/v1')
            : '',
        cloudflareAccountId: provider === 'cloudflare-ai-gateway' ? modelConfig.cloudflareAccountId ?? '' : '',
        cloudflareGatewayId: provider === 'cloudflare-ai-gateway' ? modelConfig.cloudflareGatewayId ?? '' : '',
      })
      setUseCustomModel(!presets)
      setTestState({ status: 'idle', message: '' })
    },
    [
      modelConfig.cloudflareAccountId,
      modelConfig.cloudflareGatewayId,
      modelConfig.customBaseUrl,
      modelConfig.customCompatibility,
      modelConfig.customProviderId,
      modelConfig.moonshotRegion,
      modelConfig.openrouterBaseUrl,
      setModelConfig,
      setTestState,
    ],
  )

  const handleModelSelect = useCallback(
    (value: string) => {
      if (value === CUSTOM_MODEL_OPTION) {
        setUseCustomModel(true)
        setModelConfig({ modelId: '' })
      } else {
        setUseCustomModel(false)
        setModelConfig({ modelId: value })
      }
    },
    [setModelConfig],
  )

  const getProviderOptionLabel = useCallback(
    (p: (typeof PROVIDER_OPTIONS)[number]) => {
      if (p.id === 'custom') {
        return t('wizard.model.provider.customLabel')
      }
      return t(`wizard.model.providerNames.${p.id}`, { defaultValue: p.label })
    },
    [t],
  )

  const renderProviderItem = (p: (typeof PROVIDER_OPTIONS)[number]) => {
    const isLocal = p.id === 'local'
    return (
      <span className="flex w-full items-center gap-2.5">
        <ProviderLogo providerId={p.id} className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{getProviderOptionLabel(p)}</span>
        {isLocal && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            {t('wizard.model.providerNames.localBadge', { defaultValue: 'Local' })}
          </span>
        )}
      </span>
    )
  }

  const currentPlaceholder =
    modelConfig.provider === 'custom'
      ? t('wizard.model.provider.customPlaceholder')
      : PROVIDER_OPTIONS.find((p) => p.id === modelConfig.provider)?.placeholder ?? 'Enter API Key'

  return (
    <div className="space-y-5 sm:space-y-6 max-w-2xl mx-auto">
      <header>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">{t('wizard.model.title')}</h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">{t('wizard.model.subtitle')}</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
        {/* Provider */}
        <fieldset className="space-y-1.5">
          <label htmlFor="provider-select" className="text-sm font-medium">
            {t('wizard.model.providerTitle')} <span className="text-destructive">*</span>
          </label>
          <Select
            value={modelConfig.provider}
            onValueChange={(v) => handleProviderChange(v as ModelProvider)}
          >
            <SelectTrigger id="provider-select" className="w-full">
              <SelectValue placeholder={t('wizard.model.selectProvider')} />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_OPTIONS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {renderProviderItem(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </fieldset>

        {/* Model ID */}
        <fieldset className="space-y-1.5">
          <label htmlFor="model-id-input" className="text-sm font-medium">
            {t('wizard.model.defaultModel')} <span className="text-destructive">*</span>
          </label>

          {modelConfig.provider === 'local' ? (
            <LocalModelPicker
              modelId={modelConfig.modelId}
              customUrl={customLocalUrl}
              onModelId={(id) => {
                setModelConfig({ modelId: id })
                setTestState({ status: 'idle', message: '' })
              }}
              onCustomUrl={(url) => setCustomLocalUrl(url)}
              onError={(msg) => setTestState({ status: 'error', message: msg })}
            />
          ) : hasPresets && !useCustomModel ? (
            <Select
              value={modelConfig.modelId}
              onValueChange={handleModelSelect}
            >
              <SelectTrigger id="model-id-input" className="w-full">
                <SelectValue placeholder={t('wizard.model.selectModel')} />
              </SelectTrigger>
              <SelectContent>
                {providerPresets!.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_MODEL_OPTION}>{t('wizard.model.customModelId')}</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div className="space-y-2">
              <Input
                id="model-id-input"
                type="text"
                value={modelConfig.modelId}
                onChange={(e) => {
                  setModelConfig({ modelId: e.target.value })
                  setTestState({ status: 'idle', message: '' })
                }}
                placeholder={
                  modelConfig.provider === 'openrouter'
                    ? 'anthropic/claude-sonnet-4-20250514'
                    : modelConfig.provider === 'custom'
                      ? 'provider/model-id'
                      : t('wizard.model.enterModelId')
                }
                className="font-mono"
              />
              {hasPresets && (
                <button
                  type="button"
                  onClick={() => {
                    setUseCustomModel(false)
                    const firstPreset = providerPresets![0]
                    setModelConfig({ modelId: firstPreset.id })
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  {t('wizard.model.backToPresets')}
                </button>
              )}
            </div>
          )}
        </fieldset>
      </div>

      {modelConfig.provider === 'moonshot' && (
        <fieldset className="space-y-1.5">
          <label htmlFor="moonshot-region-select" className="text-sm font-medium">
            {t('wizard.model.moonshotEndpoint')}
          </label>
          <Select
            value={modelConfig.moonshotRegion ?? 'global'}
            onValueChange={(v) => {
              setModelConfig({ moonshotRegion: v as 'global' | 'cn' })
              setTestState({ status: 'idle', message: '' })
            }}
          >
            <SelectTrigger id="moonshot-region-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">{t('wizard.model.moonshotGlobal')}</SelectItem>
              <SelectItem value="cn">{t('wizard.model.moonshotChina')}</SelectItem>
            </SelectContent>
          </Select>
        </fieldset>
      )}

      {modelConfig.provider === 'cloudflare-ai-gateway' && (
        <fieldset className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
            <div className="space-y-1.5">
              <label htmlFor="cloudflare-account-id" className="text-sm font-medium">
                Cloudflare Account ID <span className="text-destructive">*</span>
              </label>
              <Input
                id="cloudflare-account-id"
                type="text"
                value={modelConfig.cloudflareAccountId ?? ''}
                onChange={(e) => {
                  setModelConfig({ cloudflareAccountId: e.target.value })
                  setTestState({ status: 'idle', message: '' })
                }}
                placeholder="your-account-id"
                className="font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cloudflare-gateway-id" className="text-sm font-medium">
                Cloudflare Gateway ID <span className="text-destructive">*</span>
              </label>
              <Input
                id="cloudflare-gateway-id"
                type="text"
                value={modelConfig.cloudflareGatewayId ?? ''}
                onChange={(e) => {
                  setModelConfig({ cloudflareGatewayId: e.target.value })
                  setTestState({ status: 'idle', message: '' })
                }}
                placeholder="your-gateway-id"
                className="font-mono"
              />
            </div>
          </div>
        </fieldset>
      )}

      {modelConfig.provider === 'openrouter' && (
        <fieldset className="space-y-1.5">
          <label htmlFor="openrouter-base-url" className="text-sm font-medium">
            {t('wizard.model.apiBaseUrl')} <span className="text-destructive">*</span>
          </label>
          <Input
            id="openrouter-base-url"
            type="text"
            value={modelConfig.openrouterBaseUrl ?? 'https://openrouter.ai/api/v1'}
            onChange={(e) => {
              setModelConfig({ openrouterBaseUrl: e.target.value })
              setTestState({ status: 'idle', message: '' })
            }}
            placeholder="https://openrouter.ai/api/v1"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">{t('wizard.model.openrouterBaseUrlHint')}</p>
        </fieldset>
      )}

      {/* Reasoning level */}
      {modelConfig.provider !== 'local' && (
        <fieldset className="space-y-1.5">
          <label htmlFor="reasoning-level-select" className="text-sm font-medium">
            {t('wizard.model.reasoningLevel')}
          </label>
          <Select
            value={modelConfig.reasoningLevel ?? 'medium'}
            onValueChange={(v) => {
              setModelConfig({ reasoningLevel: v as ReasoningLevel })
              setTestState({ status: 'idle', message: '' })
            }}
          >
            <SelectTrigger id="reasoning-level-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t('wizard.model.reasoningOff')}</SelectItem>
              <SelectItem value="minimum">{t('wizard.model.reasoningMinimum')}</SelectItem>
              <SelectItem value="medium">{t('wizard.model.reasoningMedium')}</SelectItem>
              <SelectItem value="high">{t('wizard.model.reasoningHigh')}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('wizard.model.reasoningLevelDesc')}</p>
        </fieldset>
      )}

      {/* API Key */}
      {modelConfig.provider !== 'local' && (
      <fieldset className="space-y-1.5">
        <label htmlFor="api-key-input" className="text-sm font-medium">
          {t('wizard.model.apiKey')} {apiKeyRequired && <span className="text-destructive">*</span>}
        </label>
        <div className="relative">
          <Input
            id="api-key-input"
            type={showApiKey ? 'text' : 'password'}
            value={modelConfig.apiKey}
            onChange={(e) => {
              setModelConfig({ apiKey: e.target.value })
              setTestState({ status: 'idle', message: '' })
            }}
            placeholder={currentPlaceholder}
            autoComplete="off"
            disabled={authMode === 'oauth' || authMode === 'none'}
            className="pr-10 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowApiKey((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={showApiKey ? t('wizard.model.hideApiKey') : t('wizard.model.showApiKey')}
          >
            {showApiKey ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
        {authMode === 'oauth' && (
          <p className="text-xs text-muted-foreground">
            {t('wizard.model.oauthHint')}
          </p>
        )}
        {authMode === 'none' && (
          <p className="text-xs text-muted-foreground">
            {t('wizard.model.noKeyHint')}
          </p>
        )}
        {(authMode === 'api_key' || authMode === 'optional') && (
          <p className="text-xs text-muted-foreground">
            {t('wizard.model.apiKeyStored')}
          </p>
        )}
      </fieldset>
      )}

      {/* Custom Provider Settings */}
      {modelConfig.provider === 'custom' && (
        <fieldset className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
            <div className="space-y-1.5">
              <label htmlFor="custom-provider-id" className="text-sm font-medium">
                {t('wizard.model.providerId')} <span className="text-destructive">*</span>
              </label>
              <Input
                id="custom-provider-id"
                type="text"
                value={modelConfig.customProviderId ?? ''}
                onChange={(e) => {
                  setModelConfig({ customProviderId: e.target.value })
                  setTestState({ status: 'idle', message: '' })
                }}
                placeholder="custom-provider"
                className="font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="custom-base-url" className="text-sm font-medium">
                {t('wizard.model.apiBaseUrl')} <span className="text-destructive">*</span>
              </label>
              <Input
                id="custom-base-url"
                type="text"
                value={modelConfig.customBaseUrl ?? ''}
                onChange={(e) => {
                  setModelConfig({ customBaseUrl: e.target.value })
                  setTestState({ status: 'idle', message: '' })
                }}
                placeholder="https://llm.example.com/v1"
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="custom-compatibility" className="text-sm font-medium">
              {t('wizard.model.compatibility')}
            </label>
            <Select
              value={modelConfig.customCompatibility ?? 'openai'}
              onValueChange={(v) =>
                setModelConfig({ customCompatibility: v as 'openai' | 'anthropic' })
              }
            >
              <SelectTrigger id="custom-compatibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
              <SelectItem value="openai">{t('wizard.model.openaiCompatible')}</SelectItem>
              <SelectItem value="anthropic">{t('wizard.model.anthropicCompatible')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </fieldset>
      )}

      {/* Test Connection hint — the button itself lives in the footer next to «Далее» */}
      <div className="space-y-3">
        {testState.status === 'error' && (
          <p className="inline-flex items-center gap-1.5 text-sm text-destructive">
            <XCircle className="w-4 h-4 shrink-0" />
            {testState.message}
          </p>
        )}

        {testState.status === 'idle' && canTestModel(modelConfig) && (
          <p className="text-xs text-muted-foreground">
            {t('wizard.model.testHint')}
          </p>
        )}

        {testState.status === 'idle' && !TESTABLE_PROVIDERS.has(modelConfig.provider) && (
          <p className="text-xs text-muted-foreground">
            {t('wizard.model.noTestHint')}
          </p>
        )}
      </div>
    </div>
  )
}
