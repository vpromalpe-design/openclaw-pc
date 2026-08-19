import { useTranslation } from 'react-i18next'
import { Brain, Cpu, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWizardStore } from '@/stores/wizard-store'
import openclawLogo from '@/assets/openclaw-logo.png'

interface FeatureCardProps {
  icon: React.ReactNode
  title: string
  description: string
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2 transition-all hover:border-primary/30 hover:shadow-sm">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
          {icon}
        </div>
        <h3 className="text-sm font-semibold leading-tight">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {description}
      </p>
    </div>
  )
}

const FEATURE_KEYS = ['local', 'model', 'channel'] as const

const FEATURE_ICONS = [
  <Cpu key="cpu" className="w-5 h-5" />,
  <Brain key="brain" className="w-5 h-5" />,
  <MessageSquare key="msg" className="w-5 h-5" />,
]

export function WelcomeStep() {
  const { t } = useTranslation()
  const store = useWizardStore()

  return (
    <div className="flex flex-col items-center justify-center gap-5 sm:gap-6 max-w-3xl mx-auto min-h-[calc(100dvh-230px)]">
      <header className="text-center space-y-2.5">
        <img
          src={openclawLogo}
          alt="OpenClaw"
          className="mx-auto w-16 h-16 rounded-2xl object-contain shadow-md shadow-primary/10"
        />
        <h2 className="text-xl font-semibold tracking-tight">
          {t('wizard.welcome.title')}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
          {t('wizard.welcome.subtitle')}
        </p>
      </header>

      <section aria-label="Features" className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
        {FEATURE_KEYS.map((key, i) => (
          <FeatureCard
            key={key}
            icon={FEATURE_ICONS[i]}
            title={t(`wizard.welcome.features.${key}.title`)}
            description={t(`wizard.welcome.features.${key}.description`)}
          />
        ))}
      </section>

      <div className="flex justify-center pt-2">
        <Button size="lg" onClick={store.nextStep}>
          {t('wizard.nav.startSetup')}
        </Button>
      </div>
    </div>
  )
}
