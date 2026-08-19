import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FolderOpen, Loader2, CheckCircle2 } from 'lucide-react'
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
    id: 'qwen3.5-4b',
    labelKey: 'wizard.model.localNormal',
    size: '~3.2 GB',
  },
  {
    id: 'qwen3.5-9b',
    labelKey: 'wizard.model.localHard',
    size: '~6.1 GB',
  },
]

const CUSTOM_OPTION = '__custom_gguf__'

type DownloadState = 'idle' | 'downloading' | 'done'

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
  const [downloadState, setDownloadState] = useState<DownloadState>('idle')

  useEffect(() => {
    const unsub = window.electronAPI.onLocalProgress((p) => {
      if (p.stage === 'done') {
        setProgress(1)
        setDownloadState('done')
        setDownloading(false)
        return
      }
      if (p.stage === 'error') {
        setProgress(null)
        setDownloadState('idle')
        setDownloading(false)
        return
      }
      if (typeof p.progress === 'number') {
        setProgress(p.progress)
      }
    })
    return unsub
  }, [])

  const isCustom = !LOCAL_PRESETS.some((p) => p.id === modelId)

  const handleDownload = async () => {
    const target = isCustom ? customUrl.trim() : modelId
    if (!target) return
    setDownloading(true)
    setProgress(0)
    setDownloadState('downloading')
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
      setDownloadState('idle')
    } finally {
      setDownloading(false)
    }
  }

  const handlePickFile = async () => {
    try {
      const res = (await window.electronAPI.localPickFile()) as { path: string } | null
      if (!res) return
      const added = (await window.electronAPI.localAdd({ path: res.path })) as {
        custom?: { id: string }
      }
      const id = added.custom?.id
      if (!id) throw new Error(t('wizard.model.badCustomUrl'))
      onModelId(id)
    } catch (e) {
      onError(e instanceof Error ? e.message : t('wizard.model.downloadFailed'))
    }
  }

  const progressPct =
    progress !== null ? Math.min(100, Math.max(0, Math.round(progress * 100))) : 0

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
          className={[
            'relative overflow-hidden',
            downloadState === 'done' && 'btn-success',
          ].join(' ')}
        >
          {downloadState === 'downloading' && progress !== null && (
            <span
              className="absolute inset-y-0 left-0 bg-green-600/35 transition-[width] duration-300"
              style={{ width: `${progressPct}%` }}
            />
          )}
          <span className="relative z-10 inline-flex items-center">
            {downloadState === 'done' ? (
              <CheckCircle2 className="w-4 h-4 mr-1" aria-hidden />
            ) : downloading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden />
            ) : (
              <Download className="w-4 h-4 mr-1" aria-hidden />
            )}
            {downloadState === 'done'
              ? t('wizard.model.downloaded')
              : downloading
                ? `${progressPct}%`
                : t('wizard.model.downloadModel')}
          </span>
        </Button>
        {downloading && (
          <span className="text-xs text-muted-foreground">
            {t('wizard.model.downloadHint')}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handlePickFile()}
        >
          <FolderOpen className="w-4 h-4 mr-1" aria-hidden />
          {t('wizard.model.pickFile')}
        </Button>
      </div>
      {!downloading && modelId && (
        <div className="flex items-center gap-3 rounded-xl border-2 border-green-500/50 bg-green-500/10 px-4 py-3">
          <CheckCircle2 className="h-8 w-8 shrink-0 text-green-600 dark:text-green-400" />
          <span className="text-base font-bold text-green-700 dark:text-green-400">
            {t('wizard.model.localPicked')}
          </span>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('wizard.model.localNote')}</p>
    </div>
  )
}
