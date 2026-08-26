import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Square,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ShellLayout } from './ShellLayout'
import { ProviderLogo } from '@/components/ProviderLogo'
import { MODELS_BY_PROVIDER } from '@/constants/provider-presets'
import type {
  ModelTableEntry,
  ModelsViewResult,
  LocalModelInfo,
  LocalEngineState,
  LocalEngineRuntimeInfo,
  ModelConfig,
} from '../../shared/types'
export interface ModelsViewProps {
  onBack?: () => void
}

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


type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'
type EngineVariant = 'cpu' | 'cuda' | 'vulkan'

/** Sentinel option in the model select: type any model id (OpenRouter etc.). */
const CUSTOM_MODEL_OPTION = '__custom__'

interface ProviderDraft {
  modelId: string
  apiKey: string
  showKey: boolean
  customBaseUrl: string
  customCompatibility: 'openai' | 'anthropic'
  /** OpenRouter: editable endpoint (default https://openrouter.ai/api/v1). */
  openrouterBaseUrl: string
  /** True when the user chose «Свой ID модели» instead of a preset. */
  customModel: boolean
  test: TestStatus
  message: string
}

const emptyDraft = (modelId: string): ProviderDraft => ({
  modelId,
  apiKey: '',
  showKey: false,
  customBaseUrl: '',
  customCompatibility: 'openai',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  customModel: false,
  test: 'idle',
  message: '',
})

export function ModelsView({ onBack }: ModelsViewProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<ModelsViewResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [customUrl, setCustomUrl] = useState('')
  const [addingCustom, setAddingCustom] = useState(false)
  const [engineBusy, setEngineBusy] = useState(false)
  const [installingVariant, setInstallingVariant] = useState<EngineVariant | null>(null)
  const [engineProgress, setEngineProgress] = useState<number | null>(null)
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({})
  const [savingProvider, setSavingProvider] = useState<string | null>(null)
  const [selectedLocal, setSelectedLocal] = useState<string>('')
  const [localTest, setLocalTest] = useState<TestStatus>('idle')
  const [localTestMsg, setLocalTestMsg] = useState('')
  const [smallModelWarning, setSmallModelWarning] = useState<string | null>(null)
  const [ctxSize, setCtxSize] = useState(32768)
  const [ctxApplying, setCtxApplying] = useState(false)

  const assessSize = (sizeBytes: number, name: string) => {
    if (sizeBytes > 0 && sizeBytes < 6_500_000_000) {
      setSmallModelWarning(t('shell.models.smallModelWarning'))
      return
    }
    const m = name.toLowerCase().match(/([0-9]+(?:\.[0-9]+)?)b/)
    if (m) {
      const params = Number.parseFloat(m[1]!)
      setSmallModelWarning(params < 12 ? t('shell.models.smallModelWarning') : null)
      return
    }
    setSmallModelWarning(t('shell.models.unknownSizeHint'))
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.electronAPI.modelsViewList()
      setData(res)
      setSelectedLocal((cur) => {
        if (cur) return cur
        const downloaded = (res.localModels ?? []).filter((m) => m.downloaded)
        return downloaded[0]?.id ?? ''
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
    void (async () => {
      try {
        const cfg = await window.electronAPI.shellGetConfig()
        if (typeof cfg.localModelContextSize === 'number' && cfg.localModelContextSize > 0) {
          setCtxSize(cfg.localModelContextSize)
        }
      } catch {
        // non-fatal: keep default
      }
    })()
    const unsub = window.electronAPI.onLocalProgress((p) => {
      // Engine binary / CUDA runtime downloads carry no modelId — surface
      // their progress in the engine section banner (v0.8.30).
      if (
        (p.stage === 'engine-download' || p.stage === 'cuda-runtime-download') &&
        typeof p.progress === 'number'
      ) {
        setEngineProgress(p.progress as number)
      }
      if (p.stage === 'done' || p.stage === 'error' || p.stage === 'engine-installed') {
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
    if (entry.isLocal) {
      // Local: actually start the engine with this model (config sync + the
      // gateway restart happen inside the local:engineStart handler).
      if (!entry.modelId) return
      setEngineBusy(true)
      setError(null)
      try {
        await window.electronAPI.localEngineStart({ modelId: entry.modelId })
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : t('shell.models.engineStartFailed'))
      } finally {
        setEngineBusy(false)
      }
      return
    }
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

  const handleInstallEngine = async (variant: EngineVariant) => {
    if (installingVariant) return
    setInstallingVariant(variant)
    setEngineProgress(0)
    setError(null)
    try {
      const runtime = (await window.electronAPI.localEngineMode({
        installVariant: variant,
      })) as LocalEngineRuntimeInfo
      setData((d) => (d ? { ...d, runtime } : d))
      setEngineProgress(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.engineInstallFailed'))
    } finally {
      setInstallingVariant(null)
      setEngineProgress(null)
    }
  }

  const handleAddCustom = async () => {
    const url = customUrl.trim()
    if (!url) return
    setAddingCustom(true)
    setError(null)
    setSmallModelWarning(null)
    try {
      const res = (await window.electronAPI.localAdd({ url })) as {
        custom?: { id: string; fileName?: string; sizeBytes?: number }
      }
      const id = res.custom?.id
      if (!id) throw new Error(t('shell.models.badCustomUrl'))
      assessSize(res.custom?.sizeBytes ?? 0, res.custom?.fileName ?? id)
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
    setSmallModelWarning(null)
    try {
      const res = (await window.electronAPI.localPickFile()) as { path: string } | null
      if (!res) return
      const added = (await window.electronAPI.localAdd({ path: res.path })) as {
        custom?: { id: string; fileName?: string; sizeBytes?: number }
      }
      if (!added.custom?.id) throw new Error(t('shell.models.badCustomUrl'))
      assessSize(added.custom?.sizeBytes ?? 0, added.custom?.fileName ?? added.custom.id)
      setCustomUrl('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.downloadFailed'))
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

  // ─── Provider expandable panel ────────────────────────────────────────────

  const toggleProviderPanel = (entry: ModelTableEntry) => {
    setExpandedProvider((cur) => {
      const next = cur === entry.providerId ? null : entry.providerId
      if (next && !drafts[entry.providerId]) {
        const presets =
          MODELS_BY_PROVIDER[entry.providerId as keyof typeof MODELS_BY_PROVIDER] ?? []
        const draft = emptyDraft(entry.modelId ?? '')
        // A model that is not one of the bundled presets (e.g. a custom
        // OpenRouter model id) must open the panel in custom-input mode.
        draft.customModel =
          presets.length === 0 ||
          !presets.some((m) => m.id === entry.modelId) ||
          !entry.modelId
        setDrafts((d) => ({
          ...d,
          [entry.providerId]: draft,
        }))
      }
      return next
    })
  }

  const updateDraft = (providerId: string, patch: Partial<ProviderDraft>) => {
    setDrafts((d) => ({
      ...d,
      [providerId]: { ...(d[providerId] ?? emptyDraft('')), ...patch },
    }))
  }

  const handleTestProvider = async (entry: ModelTableEntry) => {
    const draft = drafts[entry.providerId]
    if (!draft) return
    const modelId = draft.modelId.trim()
    const apiKey = draft.apiKey.trim()
    if (!modelId) return
    updateDraft(entry.providerId, { test: 'testing', message: '' })
    try {
      if (entry.isLocal) {
        // Local: start the engine, then send a real chat completion and
        // require an actual model answer.
        const res = (await window.electronAPI.localEngineStart({
          modelId,
          test: true,
        })) as {
          ok?: boolean
          engineState?: LocalEngineState
          test?: { ok: boolean; message: string }
        }
        if (res?.test?.ok) {
          updateDraft(entry.providerId, { test: 'ok', message: t('shell.models.connectionOk') })
        } else {
          updateDraft(entry.providerId, {
            test: 'fail',
            message: res?.test?.message ?? t('shell.models.testFailed'),
          })
        }
        await load()
        return
      }
      if (!apiKey) {
        updateDraft(entry.providerId, { test: 'fail', message: t('shell.models.apiKeyRequired') })
        return
      }
      const cfg: ModelConfig = {
        provider: entry.providerId as ModelConfig['provider'],
        apiKey,
        modelId,
        customBaseUrl:
          entry.providerId === 'custom' && draft.customBaseUrl.trim()
            ? draft.customBaseUrl.trim()
            : undefined,
        customCompatibility:
          entry.providerId === 'custom' ? draft.customCompatibility : undefined,
        openrouterBaseUrl:
          entry.providerId === 'openrouter' && draft.openrouterBaseUrl.trim()
            ? draft.openrouterBaseUrl.trim()
            : undefined,
      }
      const res = await window.electronAPI.providersTest(cfg)
      if (res.ok) {
        updateDraft(entry.providerId, { test: 'ok', message: t('shell.models.connectionOk') })
      } else {
        updateDraft(entry.providerId, {
          test: 'fail',
          message: res.message ?? t('shell.models.testFailed'),
        })
      }
    } catch (e) {
      updateDraft(entry.providerId, {
        test: 'fail',
        message: e instanceof Error ? e.message : t('shell.models.testFailed'),
      })
    }
  }

  const handleSaveProvider = async (entry: ModelTableEntry) => {
    const draft = drafts[entry.providerId]
    if (!draft) return
    setSavingProvider(entry.providerId)
    setError(null)
    try {
      const config: Record<string, unknown> = {}
      if (draft.apiKey.trim()) config.apiKey = draft.apiKey.trim()
      if (draft.modelId.trim()) {
        config.models = [{ id: draft.modelId.trim(), name: draft.modelId.trim() }]
      }
      if (entry.providerId === 'custom') {
        if (draft.customBaseUrl.trim()) config.baseUrl = draft.customBaseUrl.trim()
        config.compatibility = draft.customCompatibility
      }
      // OpenRouter: persist the endpoint + api flavour so the gateway can
      // actually reach the model (seed default is used when left untouched).
      if (entry.providerId === 'openrouter') {
        if (draft.openrouterBaseUrl.trim()) config.baseUrl = draft.openrouterBaseUrl.trim()
        config.api = 'openai-completions'
      }
      await window.electronAPI.providersSaveProviderConfig({
        providerId: entry.providerId,
        config,
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.saveFailed'))
    } finally {
      setSavingProvider(null)
    }
  }

  // ─── Local model test ─────────────────────────────────────────────────────

  const handleLocalTest = async () => {
    if (!selectedLocal) return
    setLocalTest('testing')
    setLocalTestMsg('')
    setEngineBusy(true)
    setError(null)
    try {
      const state = data?.engineState
      if (state?.running && state.modelId !== selectedLocal) {
        await window.electronAPI.localEngineStop()
      }
      const res = (await window.electronAPI.localEngineStart({
        modelId: selectedLocal,
        test: true,
      })) as {
        ok?: boolean
        engineState?: LocalEngineState
        test?: { ok: boolean; message: string }
      }
      await load()
      if (res?.test?.ok) {
        setLocalTest('ok')
        setLocalTestMsg(t('shell.models.localTestOk'))
      } else {
        setLocalTest('fail')
        setLocalTestMsg(res?.test?.message ?? t('shell.models.testFailed'))
      }
    } catch (e) {
      setLocalTest('fail')
      setLocalTestMsg(e instanceof Error ? e.message : t('shell.models.testFailed'))
    } finally {
      setEngineBusy(false)
    }
  }

  // v0.9.13: context window (n_ctx) slider — applies immediately with engine restart.
  const handleCtxSizeChange = async (value: number) => {
    const v = Math.min(32768, Math.max(512, Math.round(value)))
    setCtxSize(v)
    setCtxApplying(true)
    setError(null)
    try {
      await window.electronAPI.shellSetConfig({ localModelContextSize: v })
      if (engineState?.running) {
        // Restart the engine so -c takes effect. Start may adopt the running
        // server, so stop first.
        await window.electronAPI.localEngineStop()
        if (selectedLocal) {
          await window.electronAPI.localEngineStart({ modelId: selectedLocal })
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.applyFailed'))
    } finally {
      setCtxApplying(false)
    }
  }

  const handleLocalMove = async (dir: -1 | 1) => {
    if (!selectedLocal) return
    const idx = downloadedLocalModels.findIndex((m) => m.id === selectedLocal)
    const swap = idx + dir
    if (idx < 0 || swap < 0 || swap >= downloadedLocalModels.length) return
    const ids = downloadedLocalModels.map((m) => m.id)
    ;[ids[idx], ids[swap]] = [ids[swap]!, ids[idx]!]
    setEngineBusy(true)
    try {
      await window.electronAPI.localEngineReorder(ids)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.models.applyFailed'))
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
  const runtime = data?.runtime ?? null
  const installedVariants: EngineVariant[] = runtime?.installedVariants ?? []
  const downloadedLocalModels = localModels.filter((m) => m.downloaded)
  const selectedIdx = downloadedLocalModels.findIndex((m) => m.id === selectedLocal)
  const localConnected =
    selectedLocal !== '' &&
    engineState?.running &&
    engineState.modelId === selectedLocal

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
                  const expanded = expandedProvider === e.providerId
                  const draft = drafts[e.providerId]
                  const providerPresets = MODELS_BY_PROVIDER[e.providerId as keyof typeof MODELS_BY_PROVIDER] ?? []
                  return (
                    <ProviderRowGroup
                      key={e.providerId}
                      entry={e}
                      st={st}
                      expanded={expanded}
                      draft={draft}
                      providerPresets={providerPresets}
                      fallbackCount={data?.fallbacks.length ?? 0}
                      applying={applying}
                      saving={savingProvider === e.providerId}
                      connected={Boolean(engineState?.running && engineState.modelId === e.modelId)}
                      engineBusy={engineBusy}
                      onToggle={() => toggleProviderPanel(e)}
                      onMove={(dir) => void handleMove(e, dir)}
                      onMakePrimary={() => void handleMakePrimary(e)}
                      onRemoveFromChain={() => void handleRemoveFromChain(e)}
                      onEngineStop={() => void handleEngineStop()}
                      onDraft={(patch) => updateDraft(e.providerId, patch)}
                      onTest={() => void handleTestProvider(e)}
                      onSave={() => void handleSaveProvider(e)}
                      t={t}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Local models — v0.9.11: id anchor for ⚙ → «Локальный движок» scroll (п.1.1) */}
        <section id="local-model-section" className="rounded-lg border border-border bg-card p-4" aria-label={t('shell.models.localAria')}
          style={{ scrollMarginTop: 12 }}>
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

          {/* Active local model + connection test */}
          <div className="rounded-md border border-border p-3 space-y-2.5 mb-3">
            <label htmlFor="local-active-select" className="text-sm font-medium block">
              {t('shell.models.localActive')}
            </label>
            <div className="flex items-center gap-1.5">
              <Select
                value={selectedLocal}
                onValueChange={(v) => {
                  setSelectedLocal(v)
                  setLocalTest('idle')
                  setLocalTestMsg('')
                }}
              >
                <SelectTrigger id="local-active-select" className="w-full">
                  <SelectValue placeholder={t('shell.models.localSelectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {downloadedLocalModels.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.fileName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                title={t('shell.models.moveUp')}
                disabled={!selectedLocal || selectedIdx <= 0 || engineBusy}
                onClick={() => void handleLocalMove(-1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                title={t('shell.models.moveDown')}
                disabled={!selectedLocal || selectedIdx < 0 || selectedIdx >= downloadedLocalModels.length - 1 || engineBusy}
                onClick={() => void handleLocalMove(1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
            {downloadedLocalModels.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('shell.models.noLocalModels')}</p>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleLocalTest()}
                disabled={!selectedLocal || engineBusy || localTest === 'testing'}
                className={[localTest === 'ok' && 'btn-success'].join(' ')}
              >
                {localTest === 'testing' ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden />
                ) : localTest === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 mr-1" aria-hidden />
                ) : (
                  <Zap className="w-4 h-4 mr-1" aria-hidden />
                )}
                {localTest === 'testing'
                  ? t('shell.models.testing')
                  : localTest === 'ok'
                    ? t('shell.models.connected')
                    : t('shell.models.testConnection')}
              </Button>
              {localConnected && (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400" role="status">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  {t('shell.models.connected')}
                </span>
              )}
              {localTest === 'fail' && (
                <span className="inline-flex items-center gap-1.5 text-sm text-destructive" role="alert">
                  <XCircle className="w-4 h-4" />
                  {localTestMsg}
                </span>
              )}
              {localTest === 'ok' && !localConnected && (
                <span className="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle2 className="w-4 h-4" />
                  {localTestMsg}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('shell.models.localTestHint')}</p>
          </div>

          {/* Context window (n_ctx) — v0.9.13 */}
          <div className="rounded-md border border-border p-3 space-y-2.5 mb-3">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="local-ctx-size" className="text-sm font-medium block">
                {t('shell.models.ctxTitle')}
              </label>
              <span className="text-sm font-semibold tabular-nums">
                {ctxSize.toLocaleString('ru-RU')} {t('shell.models.ctxTokens')}
              </span>
            </div>
            <input
              id="local-ctx-size"
              type="range"
              min={512}
              max={32768}
              step={512}
              value={ctxSize}
              disabled={ctxApplying}
              onChange={(e) => void handleCtxSizeChange(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>512</span>
              <span>16k</span>
              <span>32k</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('shell.models.ctxHint')}
            </p>
            {ctxApplying && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5" role="status">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                {t('shell.models.ctxApplying')}
              </p>
            )}
          </div>

          {/* llama.cpp engine binaries (CPU / CUDA / Vulkan) — v0.8.30 */}
          <div className="rounded-md border border-border p-3 space-y-2.5 mb-3">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-muted-foreground" aria-hidden />
              <label className="text-sm font-medium block">
                {t('shell.models.engineTitle')}
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('shell.models.engineDesc')}
            </p>
            {engineProgress !== null && (
              <div
                className="relative overflow-hidden rounded-md border border-green-500/40 px-3 py-2 text-sm text-green-700 dark:text-green-300"
                role="status"
              >
                <span
                  className="absolute inset-y-0 left-0 bg-green-500/25 dark:bg-green-500/30 transition-[width] duration-300"
                  style={{ width: `${Math.min(100, Math.round(engineProgress * 100))}%` }}
                  aria-hidden
                />
                <span className="relative inline-flex items-center gap-1.5">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                  {t('shell.models.engineDownloading', {
                    percent: Math.min(100, Math.round(engineProgress * 100)),
                  })}
                </span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {([
                {
                  id: 'cpu' as const,
                  label: t('shell.models.engineCpu'),
                  desc: t('shell.models.engineCpuDesc'),
                },
                {
                  id: 'cuda' as const,
                  label: t('shell.models.engineCuda'),
                  desc: t('shell.models.engineCudaDesc'),
                },
                {
                  id: 'vulkan' as const,
                  label: t('shell.models.engineVulkan'),
                  desc: t('shell.models.engineVulkanDesc'),
                },
              ] as Array<{ id: EngineVariant; label: string; desc: string }>).map(
                (v) => {
                  const installed = installedVariants.includes(v.id)
                  const recommended =
                    (runtime?.gpuVendor === 'nvidia' && v.id === 'cuda') ||
                    ((runtime?.gpuVendor === 'amd' ||
                      runtime?.gpuVendor === 'intel') &&
                      v.id === 'vulkan')
                  const installing = installingVariant === v.id
                  return (
                    <div
                      key={v.id}
                      className={[
                        'flex flex-col gap-1.5 rounded-lg border p-2.5',
                        installed
                          ? 'border-green-500/40 bg-green-500/10'
                          : 'border-muted bg-muted/60',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-sm font-semibold">{v.label}</span>
                        {installed ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" aria-hidden />
                        ) : recommended ? (
                          <span className="text-[10px] font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">
                            {t('shell.models.engineRecommended')}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{v.desc}</p>
                      {installed ? (
                        <span className="text-xs font-medium text-green-700 dark:text-green-400">
                          {t('shell.models.engineInstalled')}
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 justify-start"
                          disabled={installingVariant !== null}
                          onClick={() => void handleInstallEngine(v.id)}
                        >
                          {installing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" aria-hidden />
                          ) : (
                            <Download className="h-3.5 w-3.5 mr-1" aria-hidden />
                          )}
                          {installing
                            ? t('shell.models.engineInstalling')
                            : t('shell.models.engineInstall')}
                        </Button>
                      )}
                    </div>
                  )
                },
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {smallModelWarning && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 space-y-1" role="alert">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  {t('shell.models.smallModelWarningTitle')}
                </p>
                <p className="text-xs text-amber-700/90 dark:text-amber-300/90">
                  {smallModelWarning}
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t('shell.models.localDesc')}
            </p>
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

// ─── Provider row + expandable settings panel ───────────────────────────────

interface ProviderRowGroupProps {
  entry: ModelTableEntry
  st: { text: string; cls: string }
  expanded: boolean
  draft?: ProviderDraft
  providerPresets: readonly { id: string; label: string }[]
  fallbackCount: number
  applying: boolean
  saving: boolean
  connected?: boolean
  engineBusy?: boolean
  onToggle: () => void
  onMove: (dir: -1 | 1) => void
  onMakePrimary: () => void
  onRemoveFromChain: () => void
  onEngineStop: () => void
  onDraft: (patch: Partial<ProviderDraft>) => void
  onTest: () => void
  onSave: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}

function ProviderRowGroup({
  entry,
  st,
  expanded,
  draft,
  providerPresets,
  fallbackCount,
  applying,
  saving,
  connected,
  engineBusy,
  onToggle,
  onMove,
  onMakePrimary,
  onRemoveFromChain,
  onEngineStop,
  onDraft,
  onTest,
  onSave,
  t,
}: ProviderRowGroupProps) {
  const e = entry
  return (
    <>
      <tr className="border-b border-border/60 last:border-0">
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
                onClick={onMove.bind(null, -1)} disabled={applying}>
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
            )}
            {!e.isLocal && e.priority !== null && e.priority < fallbackCount && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title={t('shell.models.moveDown')}
                onClick={onMove.bind(null, 1)} disabled={applying}>
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
            )}
            {!e.isLocal && e.priority !== null && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title={t('shell.models.removeFromChain')}
                onClick={onRemoveFromChain} disabled={applying}>
                <XCircle className="h-3.5 w-3.5" />
              </Button>
            )}
            {!e.isLocal && (
              <Button
                variant={expanded ? 'secondary' : 'outline'}
                size="sm"
                className="h-7"
                onClick={onToggle}
                title={t('shell.models.configure')}
              >
                <Settings2 className="h-3.5 w-3.5 mr-1" />
                {t('shell.models.configure')}
              </Button>
            )}
            {/* v0.9.0: one toggle button — Connect when idle, Disconnect when in use (same for local & API). */}
            {!e.isLocal && e.status !== 'primary' && e.status !== 'fallback' && e.modelId && (
              <Button variant="outline" size="sm" className="h-7"
                onClick={onMakePrimary} disabled={applying}>
                <Zap className="h-3.5 w-3.5 mr-1" />
                {t('shell.models.connect')}
              </Button>
            )}
            {!e.isLocal && (e.status === 'primary' || e.status === 'fallback') && (
              <Button variant="outline" size="sm" className="h-7 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={onRemoveFromChain} disabled={applying}>
                {t('shell.models.disconnect')}
              </Button>
            )}
            {e.isLocal && (
              connected ? (
                <Button variant="outline" size="sm" className="h-7 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={onEngineStop} disabled={applying || engineBusy}>
                  {t('shell.models.disconnect')}
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="h-7" onClick={onMakePrimary} disabled={applying}>
                  <Zap className="h-3.5 w-3.5 mr-1" />
                  {t('shell.models.connect')}
                </Button>
              )
            )}
          </div>
        </td>
      </tr>
      {expanded && draft && !e.isLocal && (
        <tr className="border-b border-border/60 bg-muted/30 last:border-0">
          <td colSpan={5} className="py-3 px-2">
            <div className="rounded-md border border-border bg-card p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold capitalize">
                  {t('shell.models.configureTitle', { provider: e.providerId })}
                </p>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle} title={t('shell.models.close')}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Model */}
              <div className="space-y-1.5">
                <label htmlFor={`cfg-model-${e.providerId}`} className="text-xs font-medium">
                  {t('shell.models.colModel')}
                </label>
                {providerPresets.length > 0 && !draft.customModel ? (
                  <Select
                    value={draft.modelId}
                    onValueChange={(v) => {
                      if (v === CUSTOM_MODEL_OPTION) {
                        onDraft({ customModel: true, modelId: '', test: 'idle', message: '' })
                      } else {
                        onDraft({ modelId: v, test: 'idle', message: '' })
                      }
                    }}
                  >
                    <SelectTrigger id={`cfg-model-${e.providerId}`} className="w-full">
                      <SelectValue placeholder={t('shell.models.selectModel')} />
                    </SelectTrigger>
                    <SelectContent>
                      {providerPresets.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_MODEL_OPTION}>
                        {t('wizard.model.customModelId')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-2">
                    <Input
                      id={`cfg-model-${e.providerId}`}
                      type="text"
                      value={draft.modelId}
                      onChange={(ev) => onDraft({ modelId: ev.target.value, test: 'idle', message: '' })}
                      placeholder={t('shell.models.modelIdPlaceholder')}
                      className="font-mono"
                    />
                    {providerPresets.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          onDraft({
                            customModel: false,
                            modelId: providerPresets[0]!.id,
                            test: 'idle',
                            message: '',
                          })
                        }
                        className="text-xs text-primary hover:underline"
                      >
                        {t('wizard.model.backToPresets')}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* API key */}
              <div className="space-y-1.5">
                <label htmlFor={`cfg-key-${e.providerId}`} className="text-xs font-medium">
                  {t('shell.models.apiKey')}
                </label>
                <div className="relative">
                  <Input
                    id={`cfg-key-${e.providerId}`}
                    type={draft.showKey ? 'text' : 'password'}
                    value={draft.apiKey}
                    onChange={(ev) => onDraft({ apiKey: ev.target.value, test: 'idle', message: '' })}
                    placeholder={e.hasApiKey ? t('shell.models.keyAlreadySet') : t('shell.models.apiKeyPlaceholder')}
                    className="pr-10 font-mono"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => onDraft({ showKey: !draft.showKey })}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={draft.showKey ? t('shell.models.hideKey') : t('shell.models.showKey')}
                  >
                    {draft.showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* OpenRouter extras: editable endpoint — the panel used to only
                  offer Model + API key, which is not enough to configure
                  OpenRouter (v0.9.14). */}
              {e.providerId === 'openrouter' && (
                <div className="space-y-1.5">
                  <label htmlFor={`cfg-orurl-${e.providerId}`} className="text-xs font-medium">
                    {t('wizard.model.apiBaseUrl')}
                  </label>
                  <Input
                    id={`cfg-orurl-${e.providerId}`}
                    type="text"
                    value={draft.openrouterBaseUrl}
                    onChange={(ev) =>
                      onDraft({ openrouterBaseUrl: ev.target.value, test: 'idle', message: '' })
                    }
                    placeholder="https://openrouter.ai/api/v1"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('wizard.model.openrouterBaseUrlHint')}
                  </p>
                </div>
              )}

              {/* Custom provider extras */}
              {e.providerId === 'custom' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor={`cfg-baseurl-${e.providerId}`} className="text-xs font-medium">
                      {t('shell.models.baseUrl')}
                    </label>
                    <Input
                      id={`cfg-baseurl-${e.providerId}`}
                      type="text"
                      value={draft.customBaseUrl}
                      onChange={(ev) => onDraft({ customBaseUrl: ev.target.value, test: 'idle', message: '' })}
                      placeholder="https://llm.example.com/v1"
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor={`cfg-compat-${e.providerId}`} className="text-xs font-medium">
                      {t('shell.models.compatibility')}
                    </label>
                    <Select
                      value={draft.customCompatibility}
                      onValueChange={(v) => onDraft({ customCompatibility: v as 'openai' | 'anthropic' })}
                    >
                      <SelectTrigger id={`cfg-compat-${e.providerId}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">{t('shell.models.openaiCompatible')}</SelectItem>
                        <SelectItem value="anthropic">{t('shell.models.anthropicCompatible')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onTest}
                  disabled={!draft.modelId.trim() || draft.test === 'testing'}
                  className={[draft.test === 'ok' && 'btn-success'].join(' ')}
                >
                  {draft.test === 'testing' ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden />
                  ) : draft.test === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 mr-1" aria-hidden />
                  ) : (
                    <Zap className="w-4 h-4 mr-1" aria-hidden />
                  )}
                  {draft.test === 'testing'
                    ? t('shell.models.testing')
                    : draft.test === 'ok'
                      ? t('shell.models.connected')
                      : t('shell.models.testConnection')}
                </Button>
                {draft.test === 'ok' && (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400" role="status">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    {t('shell.models.connected')}
                  </span>
                )}
                {draft.test === 'fail' && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-destructive" role="alert">
                    <XCircle className="w-4 h-4" />
                    {draft.message}
                  </span>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={onSave}
                  disabled={saving || (!draft.apiKey.trim() && !draft.modelId.trim())}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden /> : <CheckCircle2 className="w-4 h-4 mr-1" aria-hidden />}
                  {t('shell.models.save')}
                </Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

