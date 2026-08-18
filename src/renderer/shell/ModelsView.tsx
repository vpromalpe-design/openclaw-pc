import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Cpu,
  Download,
  FolderOpen,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ShellLayout } from './ShellLayout'
import { ProviderLogo } from '@/components/ProviderLogo'
import type {
  ModelTableEntry,
  ModelsViewResult,
  LocalModelInfo,
  LocalEngineState,
} from '../../shared/types'

export interface ModelsViewProps {
  onBack?: () => void
}

const PRESET_IDS = ['qwen3.5-4b', 'qwen3.5-9b', 'qwen3.5-9b-experimental']

function statusLabel(
  status: ModelTableEntry['status'],
  t: (key: string) => string,
): { text: string; cls: string } {
  switch (status) {
    case 'primary':
      return { text: t('shell.models.statusPrimary'), cls: 'bg-green-500/15 text-green-700 dark:text-green-400' }
    case 'fallback':
      return { text: t('shell.models.statusFallback'), cls: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' }
    case 'local':
      return { text: t('shell.models.statusLocal'), cls: 'bg-purple-500/15 text-purple-700 dark:text-purple-400' }
    default:
      return { text: t('shell.models.statusAvailable'), cls: 'bg-muted text-muted-foreground' }
  }
}

function formatBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} GB`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)} MB`
  return `${Math.max(0, Math.round(n / 1000))} KB`
}

export function ModelsView({ onBack }: ModelsViewProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<ModelsViewResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [downloads, setDownloads] = useState<Record<string, number>>({})
  const [customUrl, setCustomUrl] = useState('')
  const [addingCustom, setAddingCustom] = useState(false)
  const [engineBusy, setEngineBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.electronAPI.modelsViewList()
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
    const unsub = window.electronAPI.onLocalProgress((p) => {
      if (p.modelId && typeof p.progress === 'number') {
        const id = p.modelId
        setDownloads((d) => ({ ...d, [id]: p.progress as number }))
      }
      if (p.stage === 'done' || p.stage === 'error') {
        void load()
      }
    })
    return unsub
  }, [load])

  const chainIds = useCallback((): string[] => {
    if (!data) return []
    const ids = data.entries
      .filter((e) => e.priority !== null)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((e) => `${e.providerId}/${e.modelId}`)
    return ids
  }, [data])

  const handleMove = async (entry: ModelTableEntry, dir: -1 | 1) => {
    if (!data) return
    const chain = chainIds()
    const idx = chain.findIndex((c) => c.startsWith(`${entry.providerId}/`))
    if (idx < 0) return
    const swap = idx + dir
    if (swap < 0 || swap >= chain.length) return
    const next = [...chain]
    ;[next[idx], next[swap]] = [next[swap]!, next[idx]!]
    await applyPriority(next[0]!, next.slice(1))
  }

  const handleMakePrimary = async (entry: ModelTableEntry) => {
    if (!data) return
    const chain = chainIds()
    const rest = chain.filter((c) => !c.startsWith(`${entry.providerId}/`))
    await applyPriority(`${entry.providerId}/${entry.modelId}`, rest)
  }

  const handleRemoveFromChain = async (entry: ModelTableEntry) => {
    if (!data) return
    const chain = chainIds()
    const rest = chain.filter((c) => !c.startsWith(`${entry.providerId}/`))
    await applyPriority(rest[0] ?? null, rest.slice(1))
  }

  const applyPriority = async (primary: string | null, fallbacks: string[]) => {
    setApplying(true)
    setError(null)
    try {
      await window.electronAPI.modelsViewApply({ primary, fallbacks, restart: true })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.applyFailed'))
    } finally {
      setApplying(false)
    }
  }

  const handleDownload = async (modelId: string) => {
    setError(null)
    try {
      await window.electronAPI.localDownloadStart({ modelId })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.downloadFailed'))
    }
  }

  const handleAddCustom = async () => {
    const url = customUrl.trim()
    if (!url) return
    setAddingCustom(true)
    setError(null)
    try {
      const res = (await window.electronAPI.localAdd({ url })) as {
        custom?: { id: string; fileName: string }
      }
      const id = res.custom?.id
      if (!id) throw new Error(t('shell.models.badCustomUrl'))
      setCustomUrl('')
      await window.electronAPI.localDownloadStart({ modelId: id })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.downloadFailed'))
    } finally {
      setAddingCustom(false)
    }
  }

  const handlePickFile = async () => {
    setError(null)
    try {
      const res = (await window.electronAPI.localPickFile()) as { path: string } | null
      if (!res) return
      const added = (await window.electronAPI.localAdd({ path: res.path })) as {
        custom?: { id: string }
      }
      if (!added.custom?.id) throw new Error(t('shell.models.badCustomUrl'))
      setCustomUrl('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.downloadFailed'))
    }
  }

  const handleRemoveModel = async (model: LocalModelInfo) => {
    setError(null)
    try {
      await window.electronAPI.localRemove({ id: model.id })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.removeFailed'))
    }
  }

  const handleEngineStart = async (modelId: string) => {
    setEngineBusy(true)
    setError(null)
    try {
      await window.electronAPI.localEngineStart({ modelId })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.engineStartFailed'))
    } finally {
      setEngineBusy(false)
    }
  }

  const handleEngineStop = async () => {
    setEngineBusy(true)
    try {
      await window.electronAPI.localEngineStop()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.engineStopFailed'))
    } finally {
      setEngineBusy(false)
    }
  }

  const defaultBack = () => {
    window.location.hash = ''
  }
  const onBackFn = onBack ?? defaultBack

  if (loading && !data) {
    return (
      <ShellLayout title={t('shell.nav.models')} onBack={onBackFn}>
        <p className="text-sm text-muted-foreground" role="status">
          {t('shell.models.loading')}
        </p>
      </ShellLayout>
    )
  }

  const engineState: LocalEngineState | null = data?.engineState ?? null
  const localModels: LocalModelInfo[] = data?.localModels ?? []

  return (
    <ShellLayout title={t('shell.nav.models')} onBack={onBackFn}>
      <div className="flex flex-col gap-6 max-w-3xl">
        {error && (
          <div
            className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Priority table */}
        <section className="rounded-lg border border-border bg-card p-4" aria-label={t('shell.models.tableAria')}>
          <div className="flex items-center gap-2 mb-1">
            <Cpu className="w-4 h-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-medium">{t('shell.models.tableTitle')}</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{t('shell.models.tableDesc')}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-2 font-medium">#</th>
                  <th className="py-2 pr-2 font-medium">{t('shell.models.colProvider')}</th>
                  <th className="py-2 pr-2 font-medium">{t('shell.models.colModel')}</th>
                  <th className="py-2 pr-2 font-medium">{t('shell.models.colStatus')}</th>
                  <th className="py-2 font-medium text-right">{t('shell.models.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.entries ?? []).map((e) => {
                  const st = statusLabel(e.status, t)
                  return (
                    <tr key={e.providerId} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-2 text-muted-foreground tabular-nums">
                        {e.priority !== null ? e.priority + 1 : '—'}
                      </td>
                      <td className="py-2 pr-2">
                        <span className="flex items-center gap-2">
                          <ProviderLogo providerId={e.providerId} className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="font-medium capitalize">{e.providerId}</span>
                        </span>
                      </td>
                      <td className="py-2 pr-2 font-mono text-xs max-w-[180px] truncate">{e.modelId || '—'}</td>
                      <td className="py-2 pr-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${st.cls}`}>
                          {st.text}
                        </span>
                      </td>
                      <td className="py-2">
                        <div className="flex items-center justify-end gap-1">
                          {!e.isLocal && e.priority !== null && e.priority > 0 && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title={t('shell.models.moveUp')}
                              onClick={() => void handleMove(e, -1)} disabled={applying}>
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {!e.isLocal && e.priority !== null && e.priority < (data?.fallbacks.length ?? 0) && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title={t('shell.models.moveDown')}
                              onClick={() => void handleMove(e, 1)} disabled={applying}>
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {!e.isLocal && e.priority !== null && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title={t('shell.models.removeFromChain')}
                              onClick={() => void handleRemoveFromChain(e)} disabled={applying}>
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {!e.isLocal && e.status !== 'primary' && e.modelId && (
                            <Button variant="outline" size="sm" className="h-7"
                              onClick={() => void handleMakePrimary(e)} disabled={applying}>
                              {t('shell.models.connect')}
                            </Button>
                          )}
                          {e.isLocal && (
                            <Button variant="outline" size="sm" className="h-7"
                              onClick={() => void handleMakePrimary(e)} disabled={applying}>
                              {t('shell.models.connect')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Local models */}
        <section className="rounded-lg border border-border bg-card p-4" aria-label={t('shell.models.localAria')}>
          <div className="flex items-center gap-2 mb-1">
            <Download className="w-4 h-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-medium">{t('shell.models.localTitle')}</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{t('shell.models.localDesc')}</p>

          {engineState?.running && (
            <div className="flex items-center justify-between rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm mb-3">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                {t('shell.models.engineRunning', { model: engineState.modelId ?? '' })}
              </span>
              <Button variant="outline" size="sm" className="h-7" onClick={() => void handleEngineStop()} disabled={engineBusy}>
                <Square className="h-3.5 w-3.5 mr-1" />
                {t('shell.models.engineStop')}
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {PRESET_IDS.map((presetId) => {
              const model = localModels.find((m) => m.id === presetId)
              const progress = downloads[presetId] ?? model?.progress ?? 0
              const downloading = model?.status === 'downloading' || progress > 0 && progress < 1 && !model?.downloaded
              return (
                <div key={presetId} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {presetName(presetId, t)}
                      {presetId.endsWith('-experimental') && (
                        <span className="ml-2 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                          {t('shell.models.experimentalBadge')}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{presetDesc(presetId, t)}</p>
                    {model?.downloaded && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatBytes(model.sizeBytes)} · {t('shell.models.ready')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-3">
                    {!model?.downloaded && !downloading && (
                      <Button variant="outline" size="sm" className="h-7" onClick={() => void handleDownload(presetId)}>
                        <Download className="h-3.5 w-3.5 mr-1" />
                        {t('shell.models.download')}
                      </Button>
                    )}
                    {downloading && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="relative overflow-hidden h-7 min-w-[150px] border-green-500/40 text-green-700 dark:text-green-300 hover:bg-green-500/10 hover:text-green-700 dark:hover:text-green-300"
                        onClick={() => void window.electronAPI.localDownloadCancel()}
                        title={t('shell.models.cancel')}
                      >
                        <span
                          className="absolute inset-y-0 left-0 bg-green-500/25 dark:bg-green-500/30 transition-[width] duration-300"
                          style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }}
                          aria-hidden
                        />
                        <span className="relative inline-flex items-center gap-1">
                          {t('shell.models.downloading', { percent: Math.min(100, Math.round(progress * 100)) })}
                        </span>
                      </Button>
                    )}
                    {model?.downloaded && (
                      <>
                        {engineState?.running && engineState.modelId === model.id ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {t('shell.models.active')}
                          </span>
                        ) : (
                          <Button variant="outline" size="sm" className="h-7" onClick={() => void handleEngineStart(model.id)} disabled={engineBusy}>
                            <Play className="h-3.5 w-3.5 mr-1" />
                            {t('shell.models.run')}
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title={t('shell.models.remove')}
                          onClick={() => void handleRemoveModel(model)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Custom GGUF URL */}
          <div className="mt-3 flex gap-2">
            <Input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder={t('shell.models.customUrlPlaceholder')}
              className="font-mono text-sm"
            />
            <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => void handleAddCustom()} disabled={addingCustom || !customUrl.trim()}>
              {addingCustom ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Plus className="w-4 h-4 mr-1" />}
              {t('shell.models.addCustom')}
            </Button>
            <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => void handlePickFile()}>
              <FolderOpen className="w-4 h-4 mr-1" aria-hidden />
              {t('shell.models.pickFile')}
            </Button>
          </div>
        </section>

        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            {t('shell.feishu.refresh')}
          </Button>
          <Button size="sm" onClick={() => void applyPriority(chainIds()[0] ?? null, chainIds().slice(1))} disabled={applying}>
            {applying ? <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden /> : <RefreshCw className="w-4 h-4 mr-1" aria-hidden />}
            {t('shell.models.applyRestart')}
          </Button>
        </div>
      </div>
    </ShellLayout>
  )
}

function presetName(id: string, t: (key: string) => string): string {
  switch (id) {
    case 'qwen3.5-4b':
      return t('shell.models.presetNormal')
    case 'qwen3.5-9b':
      return t('shell.models.presetHard')
    case 'qwen3.5-9b-experimental':
      return t('shell.models.presetExperimental')
    default:
      return id
  }
}

function presetDesc(id: string, t: (key: string) => string): string {
  switch (id) {
    case 'qwen3.5-4b':
      return t('shell.models.presetNormalDesc')
    case 'qwen3.5-9b':
      return t('shell.models.presetHardDesc')
    case 'qwen3.5-9b-experimental':
      return t('shell.models.presetExperimentalDesc')
    default:
      return ''
  }
}
