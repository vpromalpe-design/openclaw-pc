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
import type { LocalEngineRuntimeInfo } from '../../shared/types'

const LOCAL_PRESETS = [
  {
    id: 'gemma4-v2',
    labelKey: 'wizard.model.localPreset',
    size: '~6.9 GB',
  },
]

const CUSTOM_OPTION = '__custom_gguf__'

type DownloadState = 'idle' | 'downloading' | 'done'

type EngineInstallState = 'idle' | 'installing' | 'done'

type EngineVariant = 'cpu' | 'cuda' | 'vulkan'

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
  const [installingVariant, setInstallingVariant] = useState<EngineVariant | null>(null)

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

  const handleInstallEngine = async (variant: EngineVariant) => {
    if (engineInstall === 'installing') return
    setInstallingVariant(variant)
    setEngineInstall('installing')
    setEngineProgress(0)
    try {
      const next = (await window.electronAPI.localEngineMode({
        installVariant: variant,
      })) as LocalEngineRuntimeInfo
      setRuntime(next)
      setEngineInstall('done')
      setEngineProgress(null)
      setInstallingVariant(null)
    } catch (e) {
      onError(e instanceof Error ? e.message : t('wizard.model.engineInstallFailed'))
      setEngineInstall('idle')
      setEngineProgress(null)
      setInstallingVariant(null)
    }
  }

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

      {/* Where does it run: CPU / CUDA / Vulkan — v0.8.30: every variant is
          always offered because GPU detection is unreliable on many laptops
          (reports "none" even with an NVIDIA GPU present), which previously
          hid the CUDA/Vulkan install buttons entirely. */}
      {runtime && (
        <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('wizard.model.whereRuns')}
          </p>
          <div className="grid grid-cols-1 gap-2">
            {(
              [
                {
                  id: 'cpu' as const,
                  label: 'CPU',
                  desc: t('wizard.model.cpuDesc'),
                  recommended: false,
                },
                {
                  id: 'cuda' as const,
                  label: 'CUDA',
                  desc: t('wizard.model.cudaDesc'),
                  recommended: runtime.gpuVendor === 'nvidia',
                },
                {
                  id: 'vulkan' as const,
                  label: 'Vulkan',
                  desc: t('wizard.model.vulkanDesc'),
                  recommended:
                    runtime.gpuVendor === 'amd' ||
                    runtime.gpuVendor === 'intel',
                },
              ] as Array<{
                id: EngineVariant
                label: string
                desc: string
                recommended: boolean
              }>
            ).map((v) => {
              const installed = runtime.installedVariants.includes(v.id)
              const installing =
                engineInstall === 'installing' && installingVariant === v.id
              return (
                <div
                  key={v.id}
                  className={[
                    'flex items-center justify-between gap-2 rounded-lg border p-2.5',
                    installed
                      ? 'border-green-500/40 bg-green-500/10'
                      : 'border-muted bg-muted/60',
                  ].join(' ')}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {v.label}
                      {v.recommended && !installed && (
                        <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">
                          {t('wizard.model.recommended')}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{v.desc}</p>
                  </div>
                  {installed ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400 shrink-0">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      {t('wizard.model.engineInstalled')}
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="relative overflow-hidden shrink-0"
                      onClick={() => void handleInstallEngine(v.id)}
                      disabled={engineInstall === 'installing'}
                    >
                      {installing && engineProgress !== null && (
                        <span
                          className="absolute inset-y-0 left-0 bg-green-600/35 transition-[width] duration-300"
                          style={{ width: `${engineProgressPct}%` }}
                          aria-hidden
                        />
                      )}
                      <span className="relative z-10 inline-flex items-center">
                        {installing ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden />
                        ) : (
                          <Download className="w-4 h-4 mr-1" aria-hidden />
                        )}
                        {installing
                          ? `${engineProgressPct}%`
                          : v.id === 'cpu'
                            ? t('wizard.model.downloadCpu')
                            : v.id === 'cuda'
                              ? t('wizard.model.downloadCuda')
                              : t('wizard.model.downloadVulkan')}
                      </span>
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
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
