import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Key,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  Upload,
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
import { PROVIDER_OPTIONS, MODELS_BY_PROVIDER } from '@/constants/provider-presets'
import type { ModelProvider, ModelConfig } from '../../shared/types'
import type { ProvidersListResult } from '../../shared/electron-api'

export interface ProviderViewProps {
  onBack?: () => void
}

function formatTestMessage(msg: string | undefined, t: (key: string) => string): string {
  if (!msg) return t('shell.llmApi.unknownError')
  if (msg.toLowerCase().includes('401') || msg.toLowerCase().includes('403') || msg.toLowerCase().includes('unauthorized'))
    return t('shell.llmApi.authFailed')
  if (msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('limit'))
    return t('shell.llmApi.rateLimit')
  if (msg.toLowerCase().includes('network') || msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('econnrefused'))
    return t('shell.llmApi.networkErrorMsg')
  return msg.length > 120 ? `${msg.slice(0, 117)}...` : msg
}

export function ProviderView({ onBack }: ProviderViewProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<ProvidersListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testMessage, setTestMessage] = useState<string>('')
  const [newProfile, setNewProfile] = useState({ profileId: '', provider: '' as ModelProvider, apiKey: '' })
  const [importJson, setImportJson] = useState('')
  const [importResult, setImportResult] = useState<{ imported: number; errors: string[] } | null>(null)
  const [defaultPrimary, setDefaultPrimary] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.electronAPI.providersList()
      setData(res)
      setDefaultPrimary(res.modelDefaults?.primary ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.llmApi.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const handleTest = async () => {
    const { provider, apiKey, modelId } = testForm
    if (!provider || !apiKey || !modelId) return
    if (provider === 'custom' && (!customBaseUrl || !customProviderId)) return
    setTestState('testing')
    setTestMessage('')
    try {
      const cfg: ModelConfig = {
        provider,
        apiKey,
        modelId,
        customBaseUrl: provider === 'custom' ? customBaseUrl : undefined,
        customProviderId: provider === 'custom' ? customProviderId : undefined,
        customCompatibility: provider === 'custom' ? 'openai' : undefined,
      }
      const res = await window.electronAPI.providersTest(cfg)
      if (res.ok) {
        setTestState('ok')
        setTestMessage(t('shell.llmApi.connectionSuccess'))
      } else {
        setTestState('fail')
        setTestMessage(formatTestMessage(res.message, t))
      }
    } catch (e) {
      setTestState('fail')
      setTestMessage(e instanceof Error ? e.message : t('shell.llmApi.testFailed'))
    }
  }

  const [testForm, setTestForm] = useState({
    provider: '' as ModelProvider | '',
    modelId: '',
    apiKey: '',
  })
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customProviderId, setCustomProviderId] = useState('')

  const testModelOpts = testForm.provider ? MODELS_BY_PROVIDER[testForm.provider] ?? [] : []

  const handleSaveProfile = async () => {
    const { profileId, provider, apiKey } = newProfile
    if (!profileId.trim() || !provider || !apiKey.trim()) return
    setSaving(true)
    try {
      await window.electronAPI.providersSaveProfile({ profileId: profileId.trim(), provider, apiKey })
      setNewProfile({ profileId: '', provider: '' as ModelProvider, apiKey: '' })
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.llmApi.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteProfile = async (profileId: string, provider: string) => {
    try {
      await window.electronAPI.providersDeleteProfile({ profileId, provider })
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.llmApi.deleteFailed'))
    }
  }

  const handleExport = async () => {
    try {
      const json = await window.electronAPI.providersExport({ maskKeys: true })
      await navigator.clipboard.writeText(json)
      setImportResult({ imported: 0, errors: [] })
      setTimeout(() => setImportResult(null), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.llmApi.exportFailed'))
    }
  }

  const handleImport = async () => {
    if (!importJson.trim()) return
    try {
      const res = await window.electronAPI.providersImport(importJson.trim())
      setImportResult(res)
      setImportJson('')
      void load()
    } catch (e) {
      setImportResult({ imported: 0, errors: [e instanceof Error ? e.message : t('shell.llmApi.importFailed')] })
    }
  }

  const handleSetDefault = async () => {
    if (!defaultPrimary.trim()) return
    setSaving(true)
    try {
      await window.electronAPI.providersSetModelDefaults({ primary: defaultPrimary.trim() })
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shell.llmApi.updateFailed'))
    } finally {
      setSaving(false)
    }
  }

  const defaultBack = () => {
    window.location.hash = ''
  }
  const onBackFn = onBack ?? defaultBack

  if (loading && !data) {
    return (
      <ShellLayout title={t('shell.nav.llmApi')} onBack={onBackFn}>
        <p className="text-sm text-muted-foreground" role="status">
          {t('shell.llmApi.loading')}
        </p>
      </ShellLayout>
    )
  }

  return (
    <ShellLayout title={t('shell.nav.llmApi')} onBack={onBackFn}>
      <div className="mx-auto flex flex-col gap-6 max-w-2xl">
        {error && (
          <div
            className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Default model */}
        <section className="rounded-lg border border-border bg-card p-4" aria-label={t('shell.llmApi.defaultModelAria')}>
          <div className="flex items-center gap-2 mb-3">
            <Key className="w-4 h-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-medium">{t('shell.llmApi.defaultModelSection')}</h2>
          </div>
          <div className="flex gap-2">
            <Input
              value={defaultPrimary}
              onChange={(e) => setDefaultPrimary(e.target.value)}
              placeholder={t('shell.llmApi.defaultModelPlaceholder')}
              className="font-mono text-sm"
            />
            <Button size="sm" onClick={handleSetDefault} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : t('shell.llmApi.set')}
            </Button>
          </div>
        </section>

        {/* Providers list */}
        <section className="rounded-lg border border-border bg-card p-4" aria-label={t('shell.llmApi.providersAria')}>
          <h2 className="text-sm font-medium mb-3">{t('shell.llmApi.providersSection')}</h2>
          {data?.providers && data.providers.length > 0 ? (
            <ul className="space-y-2">
              {data.providers.map((p) => (
                <li
                  key={p.providerId}
                  className="flex items-center justify-between py-2 border-b border-border last:border-0"
                >
                  <span className="font-medium">{p.providerId}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.baseUrl ?? t('shell.llmApi.defaultEndpoint')} · {p.hasApiKey ? t('shell.llmApi.keySet') : t('shell.llmApi.noKey')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('shell.llmApi.noProviders')}</p>
          )}
        </section>

        {/* Auth profiles */}
        <section className="rounded-lg border border-border bg-card p-4" aria-label={t('shell.llmApi.authProfilesAria')}>
          <h2 className="text-sm font-medium mb-3">{t('shell.llmApi.authProfilesSection')}</h2>
          {data?.profiles && data.profiles.length > 0 ? (
            <ul className="space-y-2">
              {data.profiles.map((prof) => (
                <li
                  key={prof.profileId}
                  className="flex items-center justify-between py-2 border-b border-border last:border-0"
                >
                  <span>
                    <span className="font-medium">{prof.profileId}</span>
                    <span className="text-muted-foreground text-sm ml-2">({prof.provider})</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {prof.hasKey ? t('shell.llmApi.keySet') : t('shell.llmApi.noKey')}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteProfile(prof.profileId, prof.provider)}
                      aria-label={t('shell.llmApi.deleteProfileAria', { id: prof.profileId })}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('shell.llmApi.noProfiles')}</p>
          )}

          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">{t('shell.llmApi.addProfile')}</p>
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder={t('shell.llmApi.profileIdPlaceholder')}
                value={newProfile.profileId}
                onChange={(e) => setNewProfile((p) => ({ ...p, profileId: e.target.value }))}
                className="w-32"
              />
              <Select
                value={newProfile.provider || undefined}
                onValueChange={(v) => setNewProfile((p) => ({ ...p, provider: (v || '') as ModelProvider }))}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t('shell.llmApi.providerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="password"
                placeholder={t('shell.llmApi.apiKeyPlaceholder')}
                value={newProfile.apiKey}
                onChange={(e) => setNewProfile((p) => ({ ...p, apiKey: e.target.value }))}
                className="w-48"
              />
              <Button size="sm" onClick={handleSaveProfile} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
                {t('shell.llmApi.add')}
              </Button>
            </div>
          </div>
        </section>

        {/* Test connection */}
        <section className="rounded-lg border border-border bg-card p-4" aria-label={t('shell.llmApi.testConnectionAria')}>
          <h2 className="text-sm font-medium mb-3">{t('shell.llmApi.testConnectionSection')}</h2>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Select
                value={testForm.provider || undefined}
                onValueChange={(v) =>
                  setTestForm((f) => ({
                    ...f,
                    provider: (v || '') as ModelProvider | '',
                    modelId: '',
                  }))
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t('shell.llmApi.providerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {testForm.provider === 'custom' ? (
                <>
                  <Input
                    placeholder={t('shell.llmApi.providerIdPlaceholder')}
                    value={customProviderId}
                    onChange={(e) => setCustomProviderId(e.target.value)}
                    className="w-32"
                  />
                  <Input
                    placeholder={t('shell.llmApi.baseUrlPlaceholder')}
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    className="w-48"
                  />
                </>
              ) : null}
              {testModelOpts.length > 0 ? (
                <Select
                  value={testForm.modelId && testModelOpts.some((m) => m.id === testForm.modelId) ? testForm.modelId : undefined}
                  onValueChange={(v) => setTestForm((f) => ({ ...f, modelId: v || '' }))}
                  disabled={!testForm.provider}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder={t('shell.llmApi.modelPresetPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {testModelOpts.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Input
                placeholder={testModelOpts.length > 0 ? t('shell.llmApi.orCustomModelId') : t('shell.llmApi.modelIdPlaceholder')}
                value={testForm.modelId}
                onChange={(e) => setTestForm((f) => ({ ...f, modelId: e.target.value }))}
                className="w-48"
              />
              <Input
                type="password"
                placeholder={t('shell.llmApi.apiKeyPlaceholder')}
                value={testForm.apiKey}
                onChange={(e) => setTestForm((f) => ({ ...f, apiKey: e.target.value }))}
                className="w-48"
              />
              <Button
                size="sm"
                onClick={handleTest}
                disabled={
                  testState === 'testing' ||
                  !testForm.provider ||
                  !testForm.apiKey ||
                  !testForm.modelId ||
                  (testForm.provider === 'custom' && (!customBaseUrl || !customProviderId))
                }
              >
                {testState === 'testing' ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                ) : (
                  t('shell.llmApi.test')
                )}
              </Button>
            </div>
            {testState === 'ok' && (
              <p className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400" role="status">
                <CheckCircle2 className="w-4 h-4" aria-hidden />
                {testMessage}
              </p>
            )}
            {testState === 'fail' && (
              <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
                <XCircle className="w-4 h-4" aria-hidden />
                {testMessage}
              </p>
            )}
          </div>
        </section>

        {/* Import / Export */}
        <section className="rounded-lg border border-border bg-card p-4" aria-label={t('shell.llmApi.importExportAria')}>
          <h2 className="text-sm font-medium mb-3">{t('shell.llmApi.importExportSection')}</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleExport}>
              <Copy className="w-4 h-4 mr-1" aria-hidden />
              {t('shell.llmApi.exportCopy')}
            </Button>
          </div>
          <div className="mt-3">
            <textarea
              className="w-full min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder={t('shell.llmApi.pasteJsonPlaceholder')}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
            />
            <Button size="sm" className="mt-2" onClick={handleImport} disabled={!importJson.trim()}>
              <Upload className="w-4 h-4 mr-1" aria-hidden />
              {t('shell.llmApi.import')}
            </Button>
            {importResult && (
              <p className="text-sm mt-2">
                {t('shell.llmApi.importedCount', { count: importResult.imported })}{' '}
                {importResult.errors.length > 0 && (
                  <span className="text-destructive">{importResult.errors.join(', ')}</span>
                )}
              </p>
            )}
          </div>
        </section>
      </div>
    </ShellLayout>
  )
}
