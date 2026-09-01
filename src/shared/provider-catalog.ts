/**
 * Единый каталог провайдеров: человеческие названия, endpoint-дефолты и алиасы.
 * Используется и main (запись конфига, таблица «Модели»), и renderer (панели
 * настройки). Значения endpoint-дефолтов выровнены по wizard PROVIDER_SEEDS
 * (setup-handler.ts), чтобы «Модели» в приложении давали тот же результат,
 * что и мастер настройки.
 */

export interface ProviderEndpoint {
  baseUrl: string
  /** OpenClaw `models.providers.*.api`; omit for plugin-native providers. */
  api?: string
  /** Bearer vs x-api-key для anthropic-совместимых хостов. */
  authHeader?: boolean
}

/** Человекочитаемые названия провайдеров (для таблицы «Модели», панелей, меню). */
export const PROVIDER_LABELS: Record<string, string> = {
  local: 'Local Model',
  deepseek: 'DeepSeek',
  'deepseek-direct': 'DeepSeek',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  google: 'Google Gemini',
  'google-vertex': 'Google Vertex',
  'google-gemini-cli': 'Google Gemini CLI',
  openrouter: 'OpenRouter',
  opencode: 'OpenCode Zen',
  mistral: 'Mistral',
  minimax: 'MiniMax',
  moonshot: 'Moonshot (Kimi) Global',
  'moonshot-cn': 'Moonshot (Kimi) China',
  'kimi-coding': 'Kimi Coding',
  zai: 'Z.AI',
  venice: 'Venice',
  groq: 'Groq',
  xai: 'xAI (Grok)',
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
  litellm: 'LiteLLM',
  together: 'Together AI',
  nvidia: 'NVIDIA',
  'qwen-portal': 'Qwen Portal',
  ollama: 'Ollama',
  vllm: 'vLLM',
  lmstudio: 'LM Studio',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  synthetic: 'Synthetic',
  xiaomi: 'Xiaomi MiMo',
  chutes: 'Chutes',
  'copilot-proxy': 'Copilot Proxy',
  kuae: 'Kuae',
  custom: 'Custom',
}

/**
 * Endpoint-дефолты для UI-добавления провайдера из приложения
 * (совпадают с мастером настройки).
 */
export const PROVIDER_ENDPOINTS: Record<string, ProviderEndpoint> = {
  deepseek: { baseUrl: 'https://api.deepseek.com', api: 'openai-completions' },
  anthropic: { baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages' },
  openai: { baseUrl: 'https://api.openai.com/v1', api: 'openai-responses' },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    api: 'openai-completions',
  },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', api: 'openai-completions' },
  cerebras: { baseUrl: 'https://api.cerebras.ai/v1', api: 'openai-completions' },
  opencode: { baseUrl: 'https://opencode.ai/zen/v1', api: 'anthropic-messages', authHeader: true },
  'vercel-ai-gateway': {
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    api: 'openai-completions',
  },
  moonshot: { baseUrl: 'https://api.moonshot.ai/v1', api: 'openai-completions' },
  'moonshot-cn': { baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions' },
  'kimi-coding': { baseUrl: 'https://api.kimi.com/coding/', api: 'anthropic-messages', authHeader: true },
  minimax: { baseUrl: 'https://api.minimaxi.com/anthropic', api: 'anthropic-messages' },
  xai: { baseUrl: 'https://api.x.ai/v1', api: 'openai-completions' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', api: 'openai-completions' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions' },
  litellm: { baseUrl: 'http://localhost:4000', api: 'openai-completions' },
  synthetic: { baseUrl: 'https://api.synthetic.new/anthropic', api: 'anthropic-messages', authHeader: true },
  venice: { baseUrl: 'https://api.venice.ai/api/v1', api: 'openai-completions' },
  together: { baseUrl: 'https://api.together.xyz/v1', api: 'openai-completions' },
  huggingface: { baseUrl: 'https://router.huggingface.co/v1', api: 'openai-completions' },
  zai: { baseUrl: 'https://api.z.ai/api/paas/v4', api: 'openai-completions' },
  xiaomi: { baseUrl: 'https://api.xiaomimimo.com/v1', api: 'openai-completions' },
  qianfan: { baseUrl: 'https://qianfan.baidubce.com/v2', api: 'openai-completions' },
  kilocode: { baseUrl: 'https://api.kilo.ai/api/gateway/', api: 'openai-completions' },
  volcengine: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', api: 'openai-completions' },
  'volcengine-plan': { baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3', api: 'openai-completions' },
  byteplus: { baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3', api: 'openai-completions' },
  'byteplus-plan': { baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3', api: 'openai-completions' },
  nvidia: { baseUrl: 'https://integrate.api.nvidia.com/v1', api: 'openai-completions' },
  chutes: { baseUrl: 'https://api.chutes.ai/v1', api: 'openai-completions' },
  'copilot-proxy': { baseUrl: 'http://localhost:3000/v1', api: 'openai-completions' },
  vllm: { baseUrl: 'http://127.0.0.1:8000/v1', api: 'openai-completions' },
  kuae: { baseUrl: 'https://coding-plan-endpoint.kuaecloud.net/v1', api: 'openai-completions' },
  lmstudio: { baseUrl: 'http://127.0.0.1:1234/v1', api: 'openai-responses' },
  ollama: { baseUrl: 'http://127.0.0.1:11434', api: 'ollama' },
  'cloudflare-ai-gateway': { baseUrl: 'https://gateway.ai.cloudflare.com/v1', api: 'openai-completions' },
}

/**
 * Провайдеры-дубли: конфиг под «реальным» id (deepseek-direct — кастомный
 * OpenAI-совместимый, чтобы не требовать плагин @openclaw/deepseek-provider)
 * скрывает «каноническую» пустую строку (deepseek) в таблице «Модели».
 */
export const PROVIDER_ALIASES: Record<string, string> = {
  'deepseek-direct': 'deepseek',
}

/** Реальный id по алиасу (deepseek-direct → deepseek), иначе сам id. */
export function canonicalProviderId(providerId: string): string {
  return PROVIDER_ALIASES[providerId] ?? providerId
}

export function providerLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId
}
