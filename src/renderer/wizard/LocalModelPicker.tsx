import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FolderOpen, Loader2, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { LocalEngineRuntimeInfo } from '../../shared/types'

/** Rough boundary for "too small for agent tasks": 12B at Q4 ≈ 6.5 GB. */
const SMALL_MODEL_BYTES = 6_500_000_000

type DownloadState = 'idle' | 'downloading' | 'done'

type SmallModelKind = 'small' | 'unknown' | 'ok' | null

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
  const [smallModel, setSmallModel] = useState<SmallModelKind>(null)
  const [runtime, setRuntime] = useState<LocalEngineRuntimeInfo | null>(null)
  const [engineInstall, setEngineInstall] = useState<EngineInstallState>('idle')
  const [engineProgress, setEngineProgress] = useState<number | null>(null)
  // v0.10.2 (Bug 2): phase of the engine install — build ZIP download, CUDA
  // runtime ZIP download (second download after the build) or extraction.
  // Lets the tile show «Installing…» while archives are unpacked instead of
  // a percent that jumped back to 0 (CUDA) or stuck at 100 (extract).
  const [enginePhase, setEnginePhase] = useState<
    'engine-download' | 'cuda-runtime-download' | 'engine-extract' | null
  >(null)
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
      if (p.stage === 'engine-download' || p.stage === 'cuda-runtime-download' || p.stage === 'engine-extract') {
        // Both download stages + extraction belong to the engine install; keep
        // the button in the “installing” state through the whole sequence
        // (ZIP → extract → CUDA runtime DLLs).
        setEngineInstall('installing')
        setEnginePhase(p.stage)
        if (typeof p.progress === 'number') {
          setEngineProgress(p.progress)
        }
        return
      }
      if (p.stage === 'engine-installed') {
        // v0.9.3: fired by main only AFTER extract (+ CUDA runtime) finished,
        // so “100 %” and the green “Installed” state now coincide.
        setEngineInstall('done')
        setEngineProgress(null)
        setEnginePhase(null)
        setInstallingVariant(null)
        if (typeof p.variant === 'string') {
          const v = p.variant as EngineVariant
          setRuntime((prev) =>
            prev
              ? {
                  ...prev,
                  installedVariants: [...new Set([...prev.installedVariants, v])],
                }
              : prev,
          )
        }
        void refreshRuntime()
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

  const assessSize = (sizeBytes: number, name: string) => {
    if (sizeBytes > 0) {
      setSmallModel(sizeBytes < SMALL_MODEL_BYTES ? 'small' : 'ok')
      return
    }
    // Unknown size: try to read the parameter count from the model name.
    const m = name.toLowerCase().match(/([0-9]+(?:\.[0-9]+)?)b/)
    if (m) {
      const params = Number.parseFloat(m[1]!)
      setSmallModel(params < 12 ? 'small' : params < 100 ? 'ok' : 'unknown')
      return
    }
    setSmallModel('unknown')
  }

  const handleDownload = async () => {
    const target = customUrl.trim()
    if (!target) return
    setDownloading(true)
    setProgress(0)
    setDownloadState('downloading')
    setSmallModel(null)
    try {
      const res = (await window.electronAPI.localAdd({ url: target })) as {
        custom?: { id: string; fileName?: string; sizeBytes?: number }
      }
      const id = res.custom?.id
      if (!id) throw new Error(t('wizard.model.badCustomUrl'))
      assessSize(res.custom?.sizeBytes ?? 0, res.custom?.fileName ?? id)
      onModelId(id)
      await window.electronAPI.localDownloadStart({ modelId: id })
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
        custom?: { id: string; fileName?: string; sizeBytes?: number }
      }
      const id = added.custom?.id
      if (!id) throw new Error(t('wizard.model.badCustomUrl'))
      assessSize(added.custom?.sizeBytes ?? 0, added.custom?.fileName ?? id)
      onModelId(id)
    } catch (e) {
      onError(e instanceof Error ? e.message : t('wizard.model.downloadFailed'))
    }
  }

  const handleInstallEngine = async (variant: EngineVariant) => {
    if (engineInstall === 'installing') return
    setInstallingVariant(variant)
    setEngineInstall('installing')
    setEnginePhase('engine-download')
    setEngineProgress(0)
    try {
      const next = (await window.electronAPI.localEngineMode({
        installVariant: variant,
      })) as LocalEngineRuntimeInfo
      setRuntime(next)
      setEngineInstall('done')
      setEngineProgress(null)
      setEnginePhase(null)
      setInstallingVariant(null)
    } catch (e) {
      onError(e instanceof Error ? e.message : t('wizard.model.engineInstallFailed'))
      setEngineInstall('idle')
      setEngineProgress(null)
      setEnginePhase(null)
      setInstallingVariant(null)
    }
  }

  const engineProgressPct =
    engineProgress !== null
      ? Math.min(100, Math.max(0, Math.round(engineProgress * 100)))
      : 0

  const progressPct =
    progress !== null ? Math.min(100, Math.max(0, Math.round(progress * 100))) : 0

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted-foreground">
        {t('wizard.model.selectLocalModel')}
      </p>
      <Input
        type="text"
        value={customUrl}
        onChange={(e) => onCustomUrl(e.target.value)}
        placeholder={t('wizard.model.urlPlaceholder')}
        className="font-mono"
      />

      {smallModel === 'small' && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 space-y-1" role="alert">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {t('wizard.model.smallModelWarningTitle')}
          </p>
          <p className="text-xs text-amber-700/90 dark:text-amber-300/90">
            {t('wizard.model.smallModelWarning')}
          </p>
        </div>
      )}
      {smallModel === 'unknown' && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2.5" role="note">
          <p className="flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-300">
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            {t('wizard.model.unknownSizeHint')}
          </p>
        </div>
      )}
      {smallModel === 'ok' && (
        <div className="rounded-xl border border-green-500/40 bg-green-500/10 px-3 py-2.5" role="note">
          <p className="flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            {t('wizard.model.modelReadyGood')}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleDownload()}
          disabled={downloading || !customUrl.trim()}
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
                      {installing && engineProgress !== null && enginePhase !== 'engine-extract' && (
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
                          ? enginePhase === 'engine-extract'
                            ? t('wizard.model.engineExtracting')
                            : enginePhase === 'cuda-runtime-download'
                              ? t('wizard.model.engineRuntimeDownloading', {
                                  percent: engineProgressPct,
                                })
                              : `${engineProgressPct}%`
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
            // v0.9.3: green right away once a model is chosen (file picked or
            // download finished) — no longer gated on modelReady, which could
            // stay false until the engine state refreshed.
            'border-green-500/50 bg-green-500/10',
          ].join(' ')}
        >
          <CheckCircle2
            className="h-8 w-8 shrink-0 text-green-600 dark:text-green-400"
            aria-hidden
          />
          <span className="text-base font-bold text-green-700 dark:text-green-400">
            {t('wizard.model.localPicked')}
          </span>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('wizard.model.localNote')}</p>
    </div>
  )
}
