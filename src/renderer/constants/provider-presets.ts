/**
 * Мастер установки + LLM API: список провайдеров и пресеты моделей.
 * Выровнено по встроенной версии OpenClaw (package.json `openclawBundleVersion`,
 * build/openclaw/docs/providers, каталог в dist).
 * Дополнительные поля обрабатывает ModelStep: регион moonshot, Cloudflare Gateway,
 * кастомные baseUrl/режимы совместимости и т.п.
 */

import type { ModelProvider } from '../../shared/types'

export interface ProviderOption {
  id: ModelProvider
  label: string
  placeholder: string
}

export interface ModelPreset {
  id: string
  label: string
}

/** Порядок примерно соответствует вариантам openclaw onboard и документации. local — сверху (фокус продукта, встроенный движок). */
export const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  { id: 'local', label: 'Local Model (offline)', placeholder: '—' },
  { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-api03-...' },
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-proj-...' },
  { id: 'deepseek', label: 'DeepSeek', placeholder: 'sk-...' },
  { id: 'openai-codex', label: 'OpenAI Codex (OAuth)', placeholder: 'OAuth via CLI' },
  { id: 'google', label: 'Google Gemini', placeholder: 'AIza...' },
  { id: 'xai', label: 'xAI (Grok)', placeholder: 'xai-...' },
  { id: 'opencode', label: 'OpenCode Zen', placeholder: 'opencode-...' },
  { id: 'vercel-ai-gateway', label: 'Vercel AI Gateway', placeholder: 'vck_...' },
  { id: 'cloudflare-ai-gateway', label: 'Cloudflare AI Gateway', placeholder: 'cf-...' },
  { id: 'minimax', label: 'MiniMax', placeholder: 'minimax-...' },
  { id: 'synthetic', label: 'Synthetic', placeholder: 'synthetic-...' },
  { id: 'moonshot', label: 'Moonshot (Kimi) Global', placeholder: 'sk-...' },
  { id: 'moonshot-cn', label: 'Moonshot (Kimi) China', placeholder: 'sk-...' },
  { id: 'kimi-coding', label: 'Kimi Coding', placeholder: 'kimi-...' },
  { id: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-...' },
  { id: 'mistral', label: 'Mistral', placeholder: 'mistral-...' },
  { id: 'zai', label: 'Z.AI', placeholder: 'zai-...' },
  { id: 'huggingface', label: 'Hugging Face', placeholder: 'hf_...' },
  { id: 'chutes', label: 'Chutes (OAuth)', placeholder: 'OAuth via CLI' },
  { id: 'copilot-proxy', label: 'Copilot Proxy (Local)', placeholder: 'http://localhost:3000/v1' },
  { id: 'github-copilot', label: 'GitHub Copilot', placeholder: 'gho_...' },
  { id: 'groq', label: 'Groq', placeholder: 'gsk_...' },
  { id: 'cerebras', label: 'Cerebras', placeholder: 'cbrs-...' },
  { id: 'kilocode', label: 'Kilo Gateway', placeholder: 'kilo-...' },
  { id: 'venice', label: 'Venice', placeholder: 'venice-...' },
  { id: 'google-vertex', label: 'Google Vertex', placeholder: 'Uses gcloud ADC' },
  { id: 'google-gemini-cli', label: 'Google Gemini CLI', placeholder: 'OAuth via CLI' },
  { id: 'volcengine', label: 'Volcano Engine (Doubao)', placeholder: 'volc-...' },
  { id: 'volcengine-plan', label: 'Volcengine (Coding)', placeholder: 'volc-...' },
  { id: 'byteplus', label: 'BytePlus', placeholder: 'byteplus-...' },
  { id: 'byteplus-plan', label: 'BytePlus (Coding)', placeholder: 'byteplus-...' },
  { id: 'qianfan', label: 'Qianfan', placeholder: 'qianfan-...' },
  { id: 'bedrock', label: 'Amazon Bedrock', placeholder: 'AWS credentials' },
  { id: 'litellm', label: 'LiteLLM (Unified Gateway)', placeholder: 'sk-...' },
  { id: 'together', label: 'Together AI', placeholder: 'tg_...' },
  { id: 'nvidia', label: 'NVIDIA', placeholder: 'nv-...' },
  { id: 'qwen-portal', label: 'Qwen Portal (OAuth)', placeholder: 'OAuth via CLI' },
  { id: 'ollama', label: 'Ollama (Local)', placeholder: 'llama3.3' },
  { id: 'vllm', label: 'vLLM (Local)', placeholder: 'your-model-id' },
  { id: 'lmstudio', label: 'LM Studio (Local)', placeholder: 'your-model-id' },
  { id: 'xiaomi', label: 'Xiaomi MiMo', placeholder: 'xiaomi-...' },
  { id: 'kuae', label: 'Kuae (Coding Plan)', placeholder: 'your_api_key' },
  { id: 'custom', label: 'Custom (OpenAI/Anthropic Compatible)', placeholder: 'Enter API Key' },
] as const

/**
 * Пресеты ID моделей по умолчанию (переопределяются через «Свой ID модели»).
 * Совпадают с текущими дефолтами OpenClaw; провайдеры без пресета — сразу ввод ID вручную.
 */
export const MODELS_BY_PROVIDER: Partial<Record<ModelProvider, readonly ModelPreset[]>> = {
  deepseek: [
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    { id: 'deepseek-chat', label: 'DeepSeek Chat (V3)' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)' },
  ],
  anthropic: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-pro', label: 'GPT-5.4 Pro' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
  ],
  'openai-codex': [
    { id: 'gpt-5.4', label: 'GPT-5.4 (Codex)' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
  ],
  google: [
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
    { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite (Preview)' },
  ],
  xai: [
    { id: 'grok-4', label: 'Grok 4' },
    { id: 'grok-4-0709', label: 'Grok 4 (0709)' },
    { id: 'grok-4-fast-reasoning', label: 'Grok 4 Fast (reasoning)' },
    { id: 'grok-4-fast-non-reasoning', label: 'Grok 4 Fast (non-reasoning)' },
    { id: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 Fast (reasoning)' },
    { id: 'grok-4-1-fast-non-reasoning', label: 'Grok 4.1 Fast (non-reasoning)' },
    { id: 'grok-4.20-reasoning', label: 'Grok 4.20 (reasoning)' },
    { id: 'grok-4.20-non-reasoning', label: 'Grok 4.20 (non-reasoning)' },
    { id: 'grok-code-fast-1', label: 'Grok Code Fast 1' },
  ],
  opencode: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
    { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
  ],
  'vercel-ai-gateway': [
    { id: 'anthropic/claude-opus-4.6', label: 'Anthropic Claude Opus 4.6' },
    { id: 'openai/gpt-5.4', label: 'OpenAI GPT-5.4' },
    { id: 'anthropic/claude-sonnet-4.6', label: 'Anthropic Claude Sonnet 4.6' },
    { id: 'anthropic/claude-sonnet-4.5', label: 'Anthropic Claude Sonnet 4.5' },
    { id: 'google/gemini-3-flash-preview', label: 'Google Gemini 3 Flash' },
  ],
  'cloudflare-ai-gateway': [
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  ],
  // M2.7-only catalog aligns with OpenClaw ≥2026.3.28 (legacy M2 / M2.1 / M2.5 / VL-01 removed upstream).
  minimax: [
    { id: 'MiniMax-M2.7-highspeed', label: 'MiniMax-M2.7-highspeed' },
    { id: 'MiniMax-M2.7', label: 'MiniMax-M2.7' },
  ],
  synthetic: [
    { id: 'hf:MiniMaxAI/MiniMax-M2.5', label: 'MiniMax M2.5 (HF)' },
    { id: 'hf:moonshotai/Kimi-K2-Thinking', label: 'Kimi K2 Thinking (HF)' },
    { id: 'hf:zai-org/GLM-4.7', label: 'GLM 4.7 (HF)' },
    { id: 'hf:deepseek-ai/DeepSeek-R1-0528', label: 'DeepSeek R1 0528 (HF)' },
    { id: 'hf:deepseek-ai/DeepSeek-V3-0324', label: 'DeepSeek V3 0324 (HF)' },
    { id: 'hf:deepseek-ai/DeepSeek-V3.1', label: 'DeepSeek V3.1 (HF)' },
    { id: 'hf:deepseek-ai/DeepSeek-V3.1-Terminus', label: 'DeepSeek V3.1 Terminus (HF)' },
    { id: 'hf:deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek V3.2 (HF)' },
    { id: 'hf:meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B Instruct (HF)' },
    { id: 'hf:meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', label: 'Llama 4 Maverick (HF)' },
    { id: 'hf:moonshotai/Kimi-K2-Instruct-0905', label: 'Kimi K2 Instruct 0905 (HF)' },
    { id: 'hf:openai/gpt-oss-120b', label: 'GPT-OSS 120B (HF)' },
    { id: 'hf:Qwen/Qwen3-235B-A22B-Instruct-2507', label: 'Qwen3 235B Instruct (HF)' },
    { id: 'hf:Qwen/Qwen3-Coder-480B-A35B-Instruct', label: 'Qwen3 Coder 480B (HF)' },
    { id: 'hf:Qwen/Qwen3-VL-235B-A22B-Instruct', label: 'Qwen3 VL 235B (HF)' },
    { id: 'hf:zai-org/GLM-4.5', label: 'GLM 4.5 (HF)' },
    { id: 'hf:zai-org/GLM-4.6', label: 'GLM 4.6 (HF)' },
    { id: 'hf:deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3 (HF)' },
    { id: 'hf:Qwen/Qwen3-235B-A22B-Thinking-2507', label: 'Qwen3 235B Thinking (HF)' },
  ],
  moonshot: [
    { id: 'kimi-k2.5', label: 'Kimi K2.5' },
    { id: 'kimi-k2-0905-preview', label: 'Kimi K2 0905 Preview' },
    { id: 'kimi-k2-turbo-preview', label: 'Kimi K2 Turbo' },
    { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking' },
    { id: 'kimi-k2-thinking-turbo', label: 'Kimi K2 Thinking Turbo' },
  ],
  'moonshot-cn': [
    { id: 'kimi-k2.5', label: 'Kimi K2.5' },
    { id: 'kimi-k2-0905-preview', label: 'Kimi K2 0905 Preview' },
    { id: 'kimi-k2-turbo-preview', label: 'Kimi K2 Turbo' },
    { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking' },
    { id: 'kimi-k2-thinking-turbo', label: 'Kimi K2 Thinking Turbo' },
  ],
  'kimi-coding': [{ id: 'k2p5', label: 'Kimi Coding K2P5' }],
  openrouter: [
    { id: 'auto', label: 'OpenRouter Auto' },
    { id: 'deepseek/deepseek-chat-v3.1', label: 'DeepSeek V3.1' },
    { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1' },
    { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
    { id: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
    { id: 'openai/gpt-5.4', label: 'GPT-5.4' },
    { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    { id: 'qwen/qwen3-coder-480b-a35b-instruct', label: 'Qwen3 Coder 480B' },
    { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick' },
    { id: 'mistralai/mistral-large-latest', label: 'Mistral Large' },
    { id: 'z-ai/glm-4.7', label: 'GLM-4.7' },
  ],
  mistral: [
    { id: 'mistral-large-latest', label: 'Mistral Large Latest' },
    { id: 'mistral-small-latest', label: 'Mistral Small Latest' },
    { id: 'codestral-latest', label: 'Codestral Latest' },
    { id: 'ministral-3b-latest', label: 'Ministral 3B' },
    { id: 'ministral-8b-latest', label: 'Ministral 8B' },
  ],
  zai: [
    { id: 'glm-5', label: 'GLM-5' },
    { id: 'glm-4.7', label: 'GLM-4.7' },
    { id: 'glm-4.6', label: 'GLM-4.6' },
  ],
  huggingface: [
    { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1' },
    { id: 'deepseek-ai/DeepSeek-V3.1', label: 'DeepSeek V3.1' },
    { id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B Instruct' },
    { id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct', label: 'Qwen3 Coder 480B' },
    { id: 'zai-org/GLM-4.7', label: 'GLM 4.7' },
    { id: 'zai-org/GLM-5', label: 'GLM-5' },
  ],
  'copilot-proxy': [
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-pro', label: 'GPT-5.4 Pro' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { id: 'gpt-5.1', label: 'GPT-5.1' },
    { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
    { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
    { id: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
    { id: 'claude-opus-4.5', label: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
    { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
    { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
    { id: 'grok-code-fast-1', label: 'Grok Code Fast 1' },
  ],
  'github-copilot': [
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
    { id: 'llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick 17B' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
    { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill 70B' },
  ],
  cerebras: [
    { id: 'zai-glm-4.7', label: 'GLM 4.7 (Cerebras)' },
    { id: 'zai-glm-4.6', label: 'GLM 4.6 (Cerebras)' },
    { id: 'llama-3.3-70b', label: 'Llama 3.3 70B' },
    { id: 'llama-3.1-8b', label: 'Llama 3.1 8B' },
  ],
  kilocode: [
    { id: 'kilo/auto', label: 'Kilo Auto' },
    { id: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6 (Kilo)' },
    { id: 'openai/gpt-5.4', label: 'GPT-5.4 (Kilo)' },
  ],
  venice: [
    { id: 'llama-3.3-70b', label: 'Llama 3.3 70B' },
    { id: 'llama-4-maverick', label: 'Llama 4 Maverick' },
    { id: 'qwen3-coder-480b-a35b-instruct', label: 'Qwen3 Coder 480B' },
    { id: 'deepseek-r1-0528', label: 'DeepSeek R1 0528' },
  ],
  'google-vertex': [{ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Vertex)' }],
  'google-gemini-cli': [
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
  ],
  volcengine: [
    { id: 'doubao-seed-1-8', label: 'Doubao Seed 1.8' },
    { id: 'doubao-seed-code-preview', label: 'Doubao Seed Code Preview' },
    { id: 'kimi-k2.5', label: 'Kimi K2.5' },
    { id: 'glm-4.7', label: 'GLM 4.7' },
    { id: 'deepseek-v3.2', label: 'DeepSeek V3.2' },
  ],
  'volcengine-plan': [
    { id: 'ark-code-latest', label: 'ARK Code Latest' },
    { id: 'doubao-seed-code', label: 'Doubao Seed Code' },
    { id: 'doubao-seed-code-preview', label: 'Doubao Seed Code Preview' },
    { id: 'kimi-k2.5', label: 'Kimi K2.5' },
    { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking' },
    { id: 'glm-4.7', label: 'GLM 4.7' },
  ],
  byteplus: [
    { id: 'seed-1-8-251228', label: 'Seed 1.8' },
    { id: 'kimi-k2-5-260127', label: 'Kimi K2.5' },
    { id: 'glm-4-7-251222', label: 'GLM 4.7' },
  ],
  'byteplus-plan': [
    { id: 'ark-code-latest', label: 'ARK Code Latest' },
    { id: 'doubao-seed-code', label: 'Doubao Seed Code' },
    { id: 'kimi-k2.5', label: 'Kimi K2.5' },
    { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking' },
    { id: 'glm-4.7', label: 'GLM 4.7' },
  ],
  qianfan: [{ id: 'deepseek-v3.2', label: 'DeepSeek V3.2' }],
  bedrock: [{ id: 'anthropic.claude-3-5-sonnet-20240620-v1:0', label: 'Claude 3.5 Sonnet' }],
  litellm: [
    { id: 'gpt-4o', label: 'gpt-4o (via LiteLLM)' },
    { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5 (via LiteLLM)' },
  ],
  together: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Instruct Turbo' },
    { id: 'Qwen/Qwen3-Coder-480B-A22B-Instruct', label: 'Qwen3 Coder 480B' },
    { id: 'deepseek-ai/DeepSeek-V3.1', label: 'DeepSeek V3.1' },
    { id: 'zai-org/GLM-4.7', label: 'GLM 4.7' },
    { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct', label: 'Llama 4 Maverick 17B' },
  ],
  nvidia: [
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Llama 3.1 Nemotron 70B' },
    { id: 'deepseek-ai/deepseek-r1-671b', label: 'DeepSeek R1 671B' },
    { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
    { id: 'qwen/qwen3-coder-480b-a35b-instruct', label: 'Qwen3 Coder 480B' },
  ],
  'qwen-portal': [
    { id: 'coder-model', label: 'Qwen Coder' },
    { id: 'vision-model', label: 'Qwen Vision' },
  ],
  ollama: [
    { id: 'llama3.3', label: 'Llama 3.3' },
    { id: 'qwen2.5', label: 'Qwen 2.5' },
  ],
  vllm: [{ id: 'your-model-id', label: 'Your model ID' }],
  lmstudio: [{ id: 'your-model-id', label: 'Your model ID' }],
  xiaomi: [
    { id: 'mimo-v2-flash', label: 'MiMo V2 Flash' },
    { id: 'mimo-v2-pro', label: 'MiMo V2 Pro' },
    { id: 'mimo-v2-omni', label: 'MiMo V2 Omni' },
  ],
  kuae: [{ id: 'GLM-4.7', label: 'GLM-4.7' }],
  chutes: [{ id: 'chutes-default', label: 'Chutes (pick in dashboard)' }],
}
