import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2, AlertTriangle, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ShellLayout } from './ShellLayout'
import { setRoyRole } from '../roy/roles'
import { setAvatar, royAvatarUrl } from '../roy/avatar'

export interface AgentSettingsViewProps {
  /** Back navigation when embedded in parent layout */
  onBack?: () => void
  /** Called with the new agent id after successful creation (parent switches to it) */
  onAgentCreated?: (agentId: string) => void
}

function defaultNavigateBack() {
  window.location.hash = ''
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Add agent panel (v0.9.12, п.1.4): name + language model picked from the
 * connected providers. Writes `agents.list[]`; the gateway hot-reloads it
 * (server-reload-handlers watches `agents.list`), so no gateway restart.
 */
export function AgentSettingsView({ onBack, onAgentCreated }: AgentSettingsViewProps = {}) {
  const handleBack = onBack ?? defaultNavigateBack

  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [role, setRole] = useState('')
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .modelsList()
      .then((res) => {
        if (cancelled) return
        const opts = (res?.models ?? [])
          .map((m) => (m.provider ? `${m.provider}/${m.id}` : m.id))
          .filter((id): id is string => Boolean(id))
        setModelOptions(Array.from(new Set(opts)).sort())
        if (opts.length > 0 && !model) {
          setModel(opts[0])
        }
      })
      .catch(() => {
        /* non-fatal — empty picker */
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createAgent = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || saveState === 'saving') return
    setSaveState('saving')
    setSaveError('')
    try {
      const res = await window.electronAPI.agentsAdd({
        name: trimmed,
        model: model.trim() || undefined,
      })
      if (res.ok && res.id) {
        setSaveState('saved')
        // v0.9.45: роль в рое + аватар — сразу по id нового агента.
        if (role.trim()) setRoyRole(res.id, role.trim())
        if (avatarSrc) {
          try {
            const av = await window.electronAPI.royAvatarSave({ id: res.id, src: avatarSrc })
            // v0.9.47: храним data URL — file:// картинки блокируются webSecurity
            if (av?.ok && av.dataUrl) setAvatar(res.id, av.dataUrl)
          } catch {
            /* некритично — аватар можно задать позже */
          }
        }
        // Give the user a moment to see «Создан ✓», then open the new agent.
        setTimeout(() => onAgentCreated?.(res.id!), 700)
      } else {
        setSaveState('error')
        setSaveError(res.error ?? 'Ошибка при создании агента')
      }
    } catch (err) {
      setSaveState('error')
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }, [name, model, role, avatarSrc, saveState, onAgentCreated])

  const nameHint =
    name.trim().length === 0
      ? 'Введите имя агента, например researcher'
      : `id агента: ${name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/gi, '-')
          .replace(/^-+|-+$/g, '') || 'agent'}`

  return (
    <ShellLayout title="Добавить агента" onBack={handleBack}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5 p-6">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Имя агента</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="например: researcher"
            autoFocus
            maxLength={64}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createAgent()
            }}
          />
          <p className="text-xs text-muted-foreground">{nameHint}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Аватар</label>
          <div className="flex items-center gap-3">
            {avatarPreview || avatarSrc ? (
              <img
                src={avatarPreview ?? royAvatarUrl(avatarSrc ?? '')}
                alt=""
                className="h-14 w-14 rounded-full border border-border object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-border text-lg text-muted-foreground">
                👤
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  // v0.9.47: превью — data URL (file:// не грузится с openclaw-shell://)
                  void window.electronAPI
                    .royAvatarSave({})
                    .then((r) => {
                      if (!r.ok) return
                      if (r.picked) setAvatarSrc(r.picked)
                      if (r.dataUrl) setAvatarPreview(r.dataUrl)
                    })
                }}
              >
                Выбрать картинку…
              </Button>
              {avatarSrc && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAvatarSrc(null)
                    setAvatarPreview(null)
                  }}
                >
                  ✕ Убрать
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Виден в рое на арене и в чатах. Картинка копируется в папку аватаров приложения.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Языковая модель</label>
          <select
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {modelOptions.length === 0 && (
              <option value="">— моделей нет, добавьте провайдера в «Модели» —</option>
            )}
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Используется как модель по умолчанию для этого агента (agents.list[].model).
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Роль в рое (промт агента)</label>
          <Textarea
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Например: ты дизайнер — делаешь макеты, иконки и стили. Отвечай на русском."
            rows={3}
            maxLength={2000}
          />
          <p className="text-xs text-muted-foreground">
            Необязательно. Роль видна лидеру роя — он строит план миссии с учётом ролей участников.
            Поменять можно позже: меню агента → «Роль агента» или карточка агента на арене.
          </p>
        </div>

        {saveState === 'error' && (
          <div className="flex items-start gap-2 rounded-xl border border-red-300/60 bg-red-500/10 px-3 py-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted-foreground">
            Агент появится в списке «Агенты» со своим рядом вкладок чата.
          </p>
          <Button
            type="button"
            onClick={() => void createAgent()}
            disabled={!name.trim() || saveState === 'saving' || saveState === 'saved'}
          >
            {saveState === 'saving' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : saveState === 'saved' ? (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            ) : (
              <UserPlus className="mr-2 h-4 w-4" />
            )}
            {saveState === 'saved' ? 'Создан ✓' : 'Создать агента'}
          </Button>
        </div>
      </div>
    </ShellLayout>
  )
}
