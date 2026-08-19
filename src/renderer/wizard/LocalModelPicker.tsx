import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FolderOpen, Loader2, CheckCircle2, Cpu, MonitorUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { LocalEngineRuntimeInfo } from '../../shared/types'

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

type EngineInstallState = 'idle' | 'installing' | 'done'

/** Map the detected GPU vendor to the llama.cpp build it needs. */
function gpuVariantFor(
  gpu: LocalEngineRuntimeInfo['gpuVendor'],
): 'cuda' | 'vulkan' | null {
  if (gpu === 'nvidia') return 'cuda'
  if (gpu === 'amd' || gpu === 'intel' || gpu === 'other') return 'vulkan'
  return null
}

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
  const [runtime, setRuntime] = useState<LocalEngineRuntimeInfo | null>(null)
  const [engineInstall, setEngineInstall] = useState<EngineInstallState>('idle')
  const [engineProgress, setEngineProgress] = useState<number | null>(null)

  const refreshRuntime = async () => {
    try {
      setRuntime(await window.electronAPI.localEngineMode({}))
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    void refreshRuntime()
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.onLocalProgress((p) => {
      if (p.stage === 'engine-download') {
        setEngineInstall('installing')
        if (typeof p.progress === 'number') {
          setEngineProgress(p.progress)
        }
        if (p.progress === 1) {
          setEngineInstall('done')
          setEngineProgress(null)
          void refreshRuntime()
        }
        return
      }
      if (p.stage === 'done') {
        setProgress(1)
        setDownloadState('done')
        setDownloading(false)
        void refreshRuntime()
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

  const handleInstallEngine = async () => {
    const variant = runtime ? gpuVariantFor(runtime.gpuVendor) : null
    if (!variant) return
    setEngineInstall('installing')
    setEngineProgress(0)
    try {
      setRuntime(await window.electronAPI.localEngineMode({ installVariant: variant }))
      setEngineInstall('done')
      setEngineProgress(null)
    } catch (e) {
      onError(e instanceof Error ? e.message : t('wizard.model.engineInstallFailed'))
      setEngineInstall('idle')
      setEngineProgress(null)
    }
  }

  const gpuVariant = runtime ? gpuVariantFor(runtime.gpuVendor) : null
  const gpuInstalled =
    gpuVariant !== null && runtime?.installedVariants.includes(gpuVariant)
  const isGpuAvailable =
    runtime?.gpuVendor !== 'none' && runtime?.gpuVendor !== undefined
  const engineProgressPct =
    engineProgress !== null
      ? Math.min(100, Math.max(0, Math.round(engineProgress * 100)))
      : 0

  const modelReady =
    runtime?.models.some(
      (m) => m.id === modelId && m.downloaded && m.status === 'ready',
    ) ?? false

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

      {/* Where does it run: CPU / GPU (CUDA) */}
      {runtime && (
        <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('wizard.model.whereRuns')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {/* CPU — always ready */}
            <div className="flex items-start gap-2 rounded-lg border border-green-500/40 bg-green-500/10 p-2.5">
              <Cpu className="h-4 w-4 shrink-0 mt-0.5 text-green-600 dark:text-green-400" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold">CPU</p>
                <p className="text-xs text-green-700 dark:text-green-400">
                  {t('wizard.model.cpuReady')}
                </p>
              </div>
            </div>
            {/* GPU — needs CUDA / Vulkan build */}
            <div
              className={[
                'flex items-start gap-2 rounded-lg border p-2.5',
                gpuInstalled
                  ? 'border-green-500/40 bg-green-500/10'
                  : 'border-muted bg-muted/60',
              ].join(' ')}
            >
              <MonitorUp
                className={[
                  'h-4 w-4 shrink-0 mt-0.5',
                  gpuInstalled
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-muted-foreground',
                ].join(' ')}
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold">GPU</p>
                {isGpuAvailable ? (
                  <p
                    className={[
                      'text-xs',
                      gpuInstalled
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-muted-foreground',
                    ].join(' ')}
                  >
                    {runtime.gpuName || t('wizard.model.gpuUnknown')}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('wizard.model.gpuNone')}
                  </p>
                )}
              </div>
            </div>
          </div>

          {isGpuAvailable && gpuVariant && !gpuInstalled && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                {gpuVariant === 'cuda'
                  ? t('wizard.model.cudaHint')
                  : t('wizard.model.vulkanHint')}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleInstallEngine()}
                disabled={engineInstall === 'installing'}
                className={[
                  'relative overflow-hidden',
                  engineInstall === 'done' && 'btn-success',
                ].join(' ')}
              >
                {engineInstall === 'installing' && engineProgress !== null && (
                  <span
                    className="absolute inset-y-0 left-0 bg-green-600/35 transition-[width] duration-300"
                    style={{ width: `${engineProgressPct}%` }}
                  />
                )}
                <span className="relative z-10 inline-flex items-center">
                  {engineInstall === 'done' ? (
                    <CheckCircle2 className="w-4 h-4 mr-1" aria-hidden />
                  ) : engineInstall === 'installing' ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden />
                  ) : (
                    <Download className="w-4 h-4 mr-1" aria-hidden />
                  )}
                  {engineInstall === 'done'
                    ? t('wizard.model.engineInstalled')
                    : engineInstall === 'installing'
                      ? `${engineProgressPct}%`
                      : gpuVariant === 'cuda'
                        ? t('wizard.model.downloadCuda')
                        : t('wizard.model.downloadVulkan')}
                </span>
              </Button>
            </div>
          )}
        </div>
      )}
      {!downloading && modelId && (
        <div
          className={[
            'flex items-center gap-3 rounded-xl border-2 px-4 py-3',
            modelReady
              ? 'border-green-500/50 bg-green-500/10'
              : 'border-muted bg-muted/40',
          ].join(' ')}
        >
          <CheckCircle2
            className={[
              'h-8 w-8 shrink-0',
              modelReady
                ? 'text-green-600 dark:text-green-400'
                : 'text-muted-foreground/60',
            ].join(' ')}
          />
          <span
            className={[
              'text-base font-bold',
              modelReady
                ? 'text-green-700 dark:text-green-400'
                : 'text-muted-foreground',
            ].join(' ')}
          >
            {t('wizard.model.localPicked')}
          </span>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('wizard.model.localNote')}</p>
    </div>
  )
}
