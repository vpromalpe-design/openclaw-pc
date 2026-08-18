import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const LOCAL_PRESETS = [
  {
    id: 'qwen2.5-0.5b',
    labelKey: 'wizard.model.localNormal',
    size: '~470 MB',
  },
  {
    id: 'qwen2.5-3b',
    labelKey: 'wizard.model.localHard',
    size: '~1.9 GB',
  },
  {
    id: 'qwen2.5-3b-experimental',
    labelKey: 'wizard.model.localExperimental',
    size: '~1.9 GB',
    experimental: true,
  },
]

const CUSTOM_OPTION = '__custom_gguf__'

export interface LocalModelPickerProps {
  modelId: string
  customUrl: string
  onModelId: (id: string) => void
  onCustomUrl: (url: string) => void
  onError: (msg: string) => void
}

export function LocalModelPicker({
  modelId,
  customUrl,
  onModelId,
  onCustomUrl,
  onError,
}: LocalModelPickerProps) {
  const { t } = useTranslation()
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)

  const isCustom = !LOCAL_PRESETS.some((p) => p.id === modelId)

  const handleDownload = async () => {
    const target = isCustom ? customUrl.trim() : modelId
    if (!target) return
    setDownloading(true)
    setProgress(0)
    try {
      if (isCustom) {
        const res = (await window.electronAPI.localAdd({ url: target })) as {
          custom?: { id: string }
        }
        const id = res.custom?.id
        if (!id) throw new Error(t('wizard.model.badCustomUrl'))
        onModelId(id)
        await window.electronAPI.localDownloadStart({ modelId: id })
      } else {
        await window.electronAPI.localDownloadStart({ modelId: target })
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : t('wizard.model.downloadFailed'))
      setProgress(null)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-2.5">
      <Select
        value={isCustom ? CUSTOM_OPTION : modelId}
        onValueChange={(v) => {
          if (v === CUSTOM_OPTION) {
            onModelId('')
          } else {
            onModelId(v)
          }
        }}
      >
        <SelectTrigger id="local-model-select" className="w-full">
          <SelectValue placeholder={t('wizard.model.selectLocalModel')} />
        </SelectTrigger>
        <SelectContent>
          {LOCAL_PRESETS.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              <span className="flex items-center justify-between gap-4">
                <span>
                  {t(m.labelKey)}
                  {m.experimental && (
                    <span className="ml-2 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                      {t('wizard.model.experimentalBadge')}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{m.size}</span>
              </span>
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_OPTION}>{t('wizard.model.customGguf')}</SelectItem>
        </SelectContent>
      </Select>

      {isCustom && (
        <Input
          type="text"
          value={customUrl}
          onChange={(e) => onCustomUrl(e.target.value)}
          placeholder="https://…/model.gguf"
          className="font-mono"
        />
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleDownload()}
          disabled={
            downloading || (isCustom ? !customUrl.trim() : !modelId)
          }
        >
          {downloading ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden />
          ) : (
            <Download className="w-4 h-4 mr-1" aria-hidden />
          )}
          {downloading
            ? progress !== null && progress > 0
              ? `${Math.round(progress * 100)}%`
              : t('wizard.model.downloading')
            : t('wizard.model.downloadModel')}
        </Button>
        {downloading && (
          <span className="text-xs text-muted-foreground">
            {t('wizard.model.downloadHint')}
          </span>
        )}
        {!downloading && modelId && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
            {t('wizard.model.localPicked')}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('wizard.model.localNote')}</p>
    </div>
  )
}
