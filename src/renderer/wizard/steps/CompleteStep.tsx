import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWizardStore } from '@/stores/wizard-store'
import { Button } from '@/components/ui/button'
import {
  Bot,
  Send,
  Settings2,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Pencil,
} from 'lucide-react'
import type { ModelProvider } from '../../../shared/types'

// ─── Display Helpers ──────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<ModelProvider, string> = {
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  google: 'Google Gemini',
  openrouter: 'OpenRouter',
  mistral: 'Mistral',
  minimax: 'MiniMax',
  moonshot: 'Moonshot',
  'moonshot-cn': 'Moonshot (China)',
  'kimi-coding': 'Kimi Coding',
  zai: 'Z.AI',
  opencode: 'OpenCode Zen',
  venice: 'Venice',
  groq: 'Groq',
  xai: 'xAI',
  cerebras: 'Cerebras',
  huggingface: 'Hugging Face',
  'github-copilot': 'GitHub Copilot',
  kilocode: 'Kilo Gateway',
  volcengine: 'Volcano Engine (Doubao)',
  'volcengine-plan': 'Volcengine (Coding)',
  byteplus: 'BytePlus',
  'byteplus-plan': 'BytePlus (Coding)',
  qianfan: 'Qianfan',
  bedrock: 'Amazon Bedrock',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  litellm: 'LiteLLM (Unified Gateway)',
  together: 'Together AI',
  nvidia: 'NVIDIA',
  'qwen-portal': 'Qwen Portal',
  'google-vertex': 'Google Vertex',
  'google-gemini-cli': 'Google Gemini CLI',
  ollama: 'Ollama',
  vllm: 'vLLM',
  lmstudio: 'LM Studio',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  synthetic: 'Synthetic',
  xiaomi: 'Xiaomi MiMo',
  chutes: 'Chutes (OAuth)',
  'copilot-proxy': 'Copilot Proxy (Local)',
  kuae: 'Kuae (Coding Plan)',
  local: 'Local Model (offline)',
  custom: 'Custom',
}

const BIND_LABELS: Record<string, string> = {
  loopback: 'wizard.gateway.loopback',
  lan: 'wizard.gateway.lan',
  auto: 'wizard.gateway.auto',
}

function maskSecret(value: string, visibleStart = 4, visibleEnd = 4): string {
  if (value.length <= visibleStart + visibleEnd) return '••••••••'
  return (
    value.slice(0, visibleStart) +
    '••••••••' +
    value.slice(-visibleEnd)
  )
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

interface SummaryCardProps {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  onEdit?: () => void
}

function SummaryCard({ icon, title, children, onEdit }: SummaryCardProps) {
  const { t } = useTranslation()
  return (
    <div className="min-w-0 flex flex-col">
      {/* Title lives OUTSIDE the card frame so it is never squeezed/truncated */}
      <div className="flex items-center justify-between gap-2 min-w-0 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">
            {icon}
          </div>
          <h3 className="text-sm font-semibold tracking-tight leading-snug break-words">{title}</h3>
        </div>
        {onEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onEdit}
            className="h-8 px-3 text-xs font-semibold shrink-0"
            aria-label={`${t('wizard.complete.edit')} ${title}`}
          >
            <Pencil className="w-3.5 h-3.5" />
            {t('wizard.complete.edit')}
          </Button>
        )}
      </div>
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm min-w-0 flex-1">
        <dl className="space-y-2 text-sm">{children}</dl>
      </section>
    </div>
  )
}

interface SummaryRowProps {
  label: string
  value: React.ReactNode
  /** Full value for title tooltip when truncated */
  title?: string
  /** When true, allow value to wrap instead of truncate (for longer text) */
  wrap?: boolean
  /** Tighter spacing for label/value (used when value needs more horizontal space) */
  compact?: boolean
}

function SummaryRow({ label, value, title, wrap, compact }: SummaryRowProps) {
  const isString = typeof value === 'string'
  return (
    <div className={`flex min-w-0 ${compact ? 'gap-0.5' : 'gap-1'} ${wrap ? 'items-start' : 'items-center'}`}>
      <dt className={`text-muted-foreground text-xs font-medium shrink-0 flex-shrink-0 ${compact ? 'w-16' : 'w-36'}`}>{label}</dt>
      <dd
        className={`font-mono text-xs font-semibold text-foreground min-w-0 flex-1 ${wrap ? 'break-words' : 'overflow-hidden flex items-center justify-end'}`}
        title={title}
      >
        {isString ? (
          wrap ? (
            <span className="break-words min-w-0 text-right">{value}</span>
          ) : (
            <span className="truncate block text-right" title={title ?? value}>{value}</span>
          )
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CompleteStep() {
  const { t } = useTranslation()
  const store = useWizardStore()
  const wizardData = store.getWizardData()
  const { modelConfig, channelConfig, gatewayConfig } = wizardData
  const { deployPhase, deployMessage } = store

  const [showApiKey, setShowApiKey] = useState(false)
  const isDeploying = deployPhase === 'writing' || deployPhase === 'starting'

  const handleEditStep = (step: number) => {
    if (!isDeploying) store.goToStep(step)
  }

  const channelLabels: Record<string, string> = {
    webchat: 'WebChat',
    feishu: 'Feishu',
    telegram: 'Telegram',
    whatsapp: 'WhatsApp',
    discord: 'Discord',
    slack: 'Slack',
  }
  const channelDisplay = channelConfig.skipChannels
    ? t('wizard.complete.webChatOnly')
    : channelLabels[channelConfig.selectedChannel] ?? channelConfig.selectedChannel

  return (
    <div className="space-y-4 sm:space-y-5 max-w-4xl mx-auto flex flex-col h-full">
      <header className="shrink-0">
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">{t('wizard.complete.title')}</h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">{t('wizard.complete.subtitle')}</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5 flex-1 content-start">
        {/* Model Summary */}
        <SummaryCard
          icon={<Bot className="w-4 h-4" />}
          title={t('wizard.complete.modelConfig')}
          onEdit={isDeploying ? undefined : () => handleEditStep(1)}
        >
          <SummaryRow
            label={t('wizard.complete.provider')}
            value={
              modelConfig.provider === 'moonshot-cn' || (modelConfig.provider === 'moonshot' && modelConfig.moonshotRegion === 'cn')
                ? t('wizard.model.moonshotChina')
                : PROVIDER_LABELS[modelConfig.provider]
            }
          />
          <SummaryRow label={t('wizard.complete.defaultModel')} value={modelConfig.modelId} title={modelConfig.modelId} />
          <SummaryRow
            label={t('wizard.complete.apiKey')}
            value={
              <span className="inline-flex items-center gap-1.5 min-w-0 flex-1">
                <span className="truncate">
                  {showApiKey
                    ? modelConfig.apiKey
                    : maskSecret(modelConfig.apiKey)}
                </span>
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  aria-label={showApiKey ? t('wizard.model.hideApiKey') : t('wizard.model.showApiKey')}
                >
                  {showApiKey ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </span>
            }
          />
        </SummaryCard>

        {/* Channel Summary */}
        <SummaryCard
          icon={<Send className="w-4 h-4" />}
          title={t('wizard.complete.channelConfig')}
          onEdit={isDeploying ? undefined : () => handleEditStep(2)}
        >
          <SummaryRow label={t('wizard.complete.channel')} value={channelDisplay} />
          {!channelConfig.skipChannels && channelConfig.selectedChannel === 'telegram' && channelConfig.telegram?.botToken && (
            <SummaryRow label={t('wizard.channel.telegram.botToken')} value={maskSecret(channelConfig.telegram.botToken, 4, 4)} />
          )}
          {!channelConfig.skipChannels && channelConfig.selectedChannel === 'discord' && channelConfig.discord?.token && (
            <SummaryRow label={t('wizard.channel.discord.botToken')} value={maskSecret(channelConfig.discord.token, 4, 4)} />
          )}
          {!channelConfig.skipChannels && channelConfig.selectedChannel === 'whatsapp' && (
            <SummaryRow label={t('wizard.complete.channel')} value={t('wizard.complete.configureViaUI')} wrap compact />
          )}
        </SummaryCard>

        {/* Gateway Summary */}
        <SummaryCard
          icon={<Settings2 className="w-4 h-4" />}
          title={t('wizard.complete.gatewaySettings')}
          onEdit={isDeploying ? undefined : () => handleEditStep(3)}
        >
          <SummaryRow label={t('wizard.complete.port')} value={String(gatewayConfig.port)} />
          <SummaryRow
            label={t('wizard.complete.bindAddress')}
            value={t(BIND_LABELS[gatewayConfig.bind] ?? 'wizard.gateway.auto')}
            wrap
          />
          <SummaryRow
            label={t('wizard.complete.authToken')}
            value={maskSecret(gatewayConfig.authToken, 6, 4)}
          />
        </SummaryCard>
      </div>

      {/* Status bar when deploying */}
      {(deployPhase === 'writing' || deployPhase === 'starting') && (
        <div className="flex items-center gap-3 py-3 px-4 rounded-lg border border-primary/20 bg-primary/5 text-sm">
          <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
          <span className="text-primary">{deployMessage}</span>
          {deployPhase === 'starting' && (
            <span className="text-muted-foreground text-xs">({t('wizard.complete.startHint')})</span>
          )}
        </div>
      )}

      {deployPhase === 'success' && (
        <div className="flex items-center gap-3 py-3 px-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-emerald-600">{deployMessage}</span>
          <span className="text-emerald-600/70 text-xs">{t('wizard.complete.redirecting')}</span>
        </div>
      )}

      {deployPhase === 'error' && (
        <div className="flex items-start gap-3 py-3 px-4 rounded-lg border border-destructive/20 bg-destructive/5">
          <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <span className="text-sm text-destructive">{deployMessage}</span>
        </div>
      )}
    </div>
  )
}
