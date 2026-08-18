import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Loader2, MessageSquareText, ShieldCheck } from 'lucide-react'
import { useWizardStore } from '@/stores/wizard-store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

type ChannelTab = 'webchat' | 'telegram' | 'whatsapp' | 'discord'

interface ChannelTabOption {
  id: ChannelTab
  label: string
  description: string
}

// WebChat first — it's the headline (autonomous, always-on) channel.
const CHANNEL_TABS: readonly ChannelTabOption[] = [
  {
    id: 'webchat',
    label: 'WebChat',
    description: 'wizard.channel.webchat.description',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    description: 'wizard.channel.telegram.description',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    description: 'wizard.channel.whatsapp.description',
  },
  {
    id: 'discord',
    label: 'Discord',
    description: 'wizard.channel.discord.description',
  },
] as const

export function ChannelStep() {
  const { t } = useTranslation()
  const { channelConfig, setChannelConfig } = useWizardStore()

  const activeTab = channelConfig.selectedChannel

  const hasTelegramRequired = !!channelConfig.telegram?.botToken?.trim()
  const hasTelegramUserId = !!channelConfig.telegram?.userId?.trim()
  const hasDiscordRequired = !!channelConfig.discord?.token?.trim()
  const showTelegramValidation = !channelConfig.skipChannels && activeTab === 'telegram'
  const showDiscordValidation = !channelConfig.skipChannels && activeTab === 'discord'
  const validationMessage = useMemo(() => {
    if (showTelegramValidation)
      return hasTelegramRequired && hasTelegramUserId
        ? t('wizard.channel.telegram.configDone')
        : hasTelegramRequired
          ? t('wizard.channel.telegram.userIdMissing')
          : t('wizard.channel.telegram.configMissing')
    if (showDiscordValidation)
      return hasDiscordRequired
        ? t('wizard.channel.discord.configDone')
        : t('wizard.channel.discord.configMissing')
    return null
  }, [
    hasTelegramRequired,
    hasTelegramUserId,
    hasDiscordRequired,
    showTelegramValidation,
    showDiscordValidation,
    t,
  ])

  const handleSkipChannelsChange = (checked: boolean) => {
    setChannelConfig({ skipChannels: checked })
  }

  const handleTabChange = (tab: ChannelTab) => {
    setChannelConfig({ selectedChannel: tab, skipChannels: false })
  }

  const updateTelegramField = (key: 'botToken' | 'userId' | 'proxy', value: string) => {
    setChannelConfig({
      telegram: { ...(channelConfig.telegram ?? {}), [key]: value },
    })
  }

  const updateDiscordField = (key: 'token', value: string) => {
    setChannelConfig({
      discord: { ...(channelConfig.discord ?? {}), [key]: value },
    })
  }

  return (
    <div className="space-y-5 sm:space-y-6 max-w-3xl mx-auto">
      <header>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">{t('wizard.channel.title')}</h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">{t('wizard.channel.subtitle')}</p>
      </header>

      <section className="rounded-lg border border-border p-3 sm:p-4 space-y-3 sm:space-y-4">
        <div className="flex flex-wrap gap-2.5" role="tablist" aria-label="Channel type">
          {CHANNEL_TABS.map((tab) => {
            const isActive = activeTab === tab.id
            const isWebChat = tab.id === 'webchat'
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleTabChange(tab.id)}
                className={[
                  'h-12 rounded-lg px-5 text-sm font-semibold transition-colors',
                  isWebChat
                    ? isActive
                      ? 'border-2 border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20'
                      : 'border-2 border-primary/60 bg-primary/10 text-primary hover:bg-primary/15'
                    : isActive
                      ? 'border-2 border-primary bg-primary/10 text-primary'
                      : 'border border-input bg-background text-foreground hover:border-primary/40',
                ].join(' ')}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {t(CHANNEL_TABS.find((tab) => tab.id === activeTab)?.description ?? '')}
        </p>

        {activeTab === 'webchat' ? (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 sm:p-4 space-y-3 sm:space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{t('wizard.channel.webchat.title')}</p>
              <p className="text-xs text-muted-foreground">
                {t('wizard.channel.webchat.description')}
              </p>
            </div>

            <label
              htmlFor="skip-channels-checkbox"
              className="inline-flex items-center gap-2 cursor-pointer rounded-md border border-border px-3 py-2 bg-background hover:bg-muted/50 transition-colors"
            >
              <Checkbox
                id="skip-channels-checkbox"
                checked={channelConfig.skipChannels}
                onCheckedChange={(checked) =>
                  handleSkipChannelsChange(checked === true)
                }
              />
              <span className="text-sm font-medium">{t('wizard.channel.skipChannels')}</span>
            </label>
          </div>
        ) : activeTab === 'telegram' ? (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 sm:p-4 space-y-3 sm:space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{t('wizard.channel.telegram.title')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('wizard.channel.telegram.description')}
                </p>
              </div>
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
              >
                @BotFather
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <fieldset className="space-y-1.5">
              <label htmlFor="telegram-bot-token" className="text-sm font-medium">
                {t('wizard.channel.telegram.botToken')} <span className="text-destructive">*</span>
              </label>
              <Input
                id="telegram-bot-token"
                type="password"
                value={channelConfig.telegram?.botToken ?? ''}
                onChange={(e) => updateTelegramField('botToken', e.target.value)}
                placeholder="123456789:AAH..."
                className="font-mono"
                disabled={channelConfig.skipChannels}
              />
            </fieldset>
            <fieldset className="space-y-1.5">
              <label htmlFor="telegram-user-id" className="text-sm font-medium">
                {t('wizard.channel.telegram.userId')} <span className="text-destructive">*</span>
              </label>
              <Input
                id="telegram-user-id"
                type="text"
                inputMode="numeric"
                value={channelConfig.telegram?.userId ?? ''}
                onChange={(e) => updateTelegramField('userId', e.target.value)}
                placeholder="123456789"
                className="font-mono"
                disabled={channelConfig.skipChannels}
              />
              <p className="text-xs text-muted-foreground">{t('wizard.channel.telegram.userIdHint')}</p>
            </fieldset>
            <fieldset className="space-y-1.5">
              <label htmlFor="telegram-proxy" className="text-sm font-medium">
                {t('wizard.channel.telegram.proxy')}{" "}
                <span className="text-muted-foreground font-normal">({t('wizard.channel.telegram.optional')})</span>
              </label>
              <Input
                id="telegram-proxy"
                type="text"
                value={channelConfig.telegram?.proxy ?? ''}
                onChange={(e) => updateTelegramField('proxy', e.target.value)}
                placeholder="http://127.0.0.1:7890"
                className="font-mono"
                disabled={channelConfig.skipChannels}
              />
              <p className="text-xs text-muted-foreground">{t('wizard.channel.telegram.proxyHint')}</p>
            </fieldset>
            <TelegramTokenTest token={channelConfig.telegram?.botToken ?? ''} proxy={channelConfig.telegram?.proxy ?? ''} disabled={channelConfig.skipChannels} />
            {validationMessage && (
              <p className={['text-xs inline-flex items-center gap-1.5', hasTelegramRequired ? 'text-emerald-600' : 'text-amber-600'].join(' ')}>
                <MessageSquareText className="w-3.5 h-3.5" />
                {validationMessage}
              </p>
            )}
          </div>
        ) : activeTab === 'discord' ? (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 sm:p-4 space-y-3 sm:space-y-4">
            <p className="text-sm font-medium text-foreground">{t('wizard.channel.discord.title')}</p>
            <p className="text-xs text-muted-foreground">
              {t('wizard.channel.discord.description')}
            </p>
            <fieldset className="space-y-1.5">
              <label htmlFor="discord-token" className="text-sm font-medium">
                {t('wizard.channel.discord.botToken')} <span className="text-destructive">*</span>
              </label>
              <Input
                id="discord-token"
                type="password"
                value={channelConfig.discord?.token ?? ''}
                onChange={(e) => updateDiscordField('token', e.target.value)}
                placeholder="discord-bot-token"
                className="font-mono"
                disabled={channelConfig.skipChannels}
              />
            </fieldset>
            {validationMessage && (
              <p className={['text-xs inline-flex items-center gap-1.5', hasDiscordRequired ? 'text-emerald-600' : 'text-amber-600'].join(' ')}>
                <MessageSquareText className="w-3.5 h-3.5" />
                {validationMessage}
              </p>
            )}
          </div>
        ) : activeTab === 'whatsapp' ? (
          <div className="rounded-md border border-dashed border-border p-4 sm:p-6 flex flex-col items-center gap-2 text-center">
            <MessageSquareText className="w-6 h-6 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">{t('wizard.channel.whatsapp.title')}</p>
            <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
              {t('wizard.channel.whatsapp.description')}
            </p>
          </div>
        ) : null}
      </section>
    </div>
  )
}

/** Inline token probe — validates the BotFather token via getMe before finishing setup. */
function TelegramTokenTest({
  token,
  proxy,
  disabled,
}: {
  token: string
  proxy: string
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handleTest = async () => {
    setStatus('testing')
    setMessage('')
    try {
      const result = await window.electronAPI.wizardTestTelegram({ botToken: token, proxy: proxy.trim() || undefined })
      if (result.ok) {
        setStatus('success')
        setMessage(t('wizard.channel.telegram.testOk', { botName: result.botName ?? '' }))
      } else {
        setStatus('error')
        const key =
          result.message === 'missing-token' || result.message === 'malformed-token'
            ? 'wizard.channel.telegram.testMalformed'
            : result.message === 'invalid-token'
              ? 'wizard.channel.telegram.testInvalidToken'
              : result.message === 'network-blocked'
                ? 'wizard.channel.telegram.testNetworkBlocked'
                : result.message === 'network-through-proxy'
                  ? 'wizard.channel.telegram.testNetworkViaProxy'
                  : result.message?.startsWith('proxy-unsupported')
                    ? 'wizard.channel.telegram.testProxyUnsupported'
                    : 'wizard.channel.telegram.testGeneric'
        setMessage(t(key, { message: result.message ?? '' }))
      }
    } catch {
      setStatus('error')
      setMessage(t('wizard.channel.telegram.testGeneric', { message: 'IPC error' }))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant={status === 'success' ? 'default' : 'outline'}
        size="lg"
        className={[
          'w-fit transition-colors',
          status === 'success' &&
            'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 hover:text-white shadow-sm shadow-emerald-600/30',
        ].join(' ')}
        onClick={handleTest}
        disabled={disabled || status === 'testing' || !token.trim()}
      >
        {status === 'testing' ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <ShieldCheck className="w-5 h-5" />
        )}
        {status === 'testing'
          ? t('wizard.channel.telegram.testing')
          : status === 'success'
            ? t('wizard.channel.telegram.connected')
            : t('wizard.channel.telegram.test')}
      </Button>
      {status === 'success' && (
        <p className="text-xs inline-flex items-center gap-1.5 text-emerald-600">
          <MessageSquareText className="w-3.5 h-3.5" />
          {message}
        </p>
      )}
      {status === 'error' && (
        <p className="text-xs inline-flex items-center gap-1.5 text-amber-600">{message}</p>
      )}
    </div>
  )
}
