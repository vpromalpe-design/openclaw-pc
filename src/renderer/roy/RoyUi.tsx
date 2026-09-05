import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { RoyDiskNode, RoyGroup } from './types'
import { GRADS } from './data'
import { MicDictate } from '../components/MicDictate'
import { EMBLEM_KEYS, EmblemIcon, isEmblemKey } from './emblems'
import { AvatarImg } from './avatar'
import { getRoyRole, setRoyRole } from './roles'

/* ── Create-group modal (sidebar «Группы» → ＋) ───────────────────────── */

const GRAD_NAMES = ['синий', 'фиолет', 'розов', 'зелёный', 'янтарь', 'коралл']

/** Выбор картинки-аватара без копирования (для превью до создания группы). */
async function pickAvatarImage(): Promise<string | null> {
  try {
    const res = await window.electronAPI.royAvatarSave({})
    if (res?.ok && res.picked) return res.picked
    return null
  } catch {
    return null
  }
}

function EmblemPicker({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  return (
    <div className="rcy-emojis">
      {EMBLEM_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className={cn('rcy-emoji', value === k && 'sel')}
          title={k}
          onClick={() => onChange(k)}
        >
          <EmblemIcon k={k} size={18} strokeWidth={1.9} />
        </button>
      ))}
    </div>
  )
}

export function RoyCreateModal({
  onCreate,
  onClose,
}: {
  onCreate: (name: string, emoji: string, grad: string, avatarSrc?: string | null) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState<string>(EMBLEM_KEYS[0])
  const [grad, setGrad] = useState<string>('g0')
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)

  const submit = () => {
    if (!name.trim()) return
    onCreate(name.trim(), emoji, grad, avatarSrc)
  }

  return (
    <div className="roy-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="roy-modal" style={{ width: 'min(480px, 94vw)' }}>
        <div className="rm-head">
          <div className="rm-title">Новая группа (рой)</div>
          <button type="button" className="rm-close" onClick={onClose}>✕</button>
        </div>

        <div className="rm-target">Рой = несколько агентов + координатор. Добавь участников — первый станет главным (тумблер на арене).</div>

        <label className="rcy-label" htmlFor="roy-name">Название</label>
        <div className="roy-micwrap">
          <input
            id="roy-name"
            className="roy-inline-name rcy-name"
            placeholder="Например: Продакшн-рой"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <MicDictate appear={name.trim().length > 0} onText={(t) => setName((v) => (v ? v + ' ' + t : t))} />
        </div>

        <label className="rcy-label">Аватар (необязательно)</label>
        <div className="rcy-avatar">
          <span className={cn('rcy-avatar-prev', grad)}>
            {avatarSrc ? (
              <img src={avatarSrc} alt="" draggable={false} />
            ) : (
              <EmblemIcon k={emoji} size={22} strokeWidth={1.9} />
            )}
          </span>
          <button
            type="button"
            className="roy-btn"
            title="Выбрать картинку с диска (jpg/png/webp)"
            onClick={() => void pickAvatarImage().then((p) => p && setAvatarSrc(p))}
          >
            🖼 Выбрать картинку
          </button>
          {avatarSrc && (
            <button type="button" className="roy-btn ghost" title="Убрать картинку — останется эмблема" onClick={() => setAvatarSrc(null)}>
              ✕ Убрать
            </button>
          )}
        </div>

        <label className="rcy-label">Эмблема</label>
        <EmblemPicker value={emoji} onChange={setEmoji} />

        <label className="rcy-label">Цвет</label>
        <div className="rcy-grads">
          {GRADS.map((g, i) => (
            <button
              key={g}
              type="button"
              className={cn('rcy-grad', g, grad === g && 'sel')}
              title={GRAD_NAMES[i]}
              onClick={() => setGrad(g)}
            >
              <span className={cn('rcy-grad-dot', g)} />
            </button>
          ))}
        </div>

        <div className="rm-foot">
          <button type="button" className="roy-btn ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="roy-btn primary" disabled={!name.trim()} onClick={submit}>
            <EmblemIcon k={emoji} size={15} strokeWidth={2} /> Создать рой
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── v0.9.42: смена эмблемы/цвета существующей группы ────────────────── */

export function RoyEmblemModal({
  g,
  onSave,
  onClose,
}: {
  g: RoyGroup
  onSave: (emoji: string, grad: string) => void
  onClose: () => void
}) {
  const [emoji, setEmoji] = useState<string>(isEmblemKey(g.emoji) ? g.emoji : EMBLEM_KEYS[0])
  const [grad, setGrad] = useState<string>(g.grad || 'g0')

  const submit = () => onSave(emoji, grad)

  return (
    <div className="roy-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="roy-modal" style={{ width: 'min(480px, 94vw)' }}>
        <div className="rm-head">
          <div className="rm-title">🎨 {g.name} — эмблема и цвет</div>
          <button type="button" className="rm-close" onClick={onClose}>✕</button>
        </div>

        <div className="roy-emb-preview-row">
          <AvatarImg emoji={emoji} grad={grad} alt={g.name} className="roy-emb-preview" />
          <div className="roy-emb-preview-note">так группа выглядит в меню и на арене</div>
        </div>

        <div className="rcy-label">Эмблема</div>
        <EmblemPicker value={emoji} onChange={setEmoji} />

        <div className="rcy-label">Цвет</div>
        <div className="rcy-grads">
          {GRADS.map((g2, i) => (
            <button
              key={g2}
              type="button"
              className={cn('rcy-grad', g2, grad === g2 && 'sel')}
              title={['синий', 'фиолет', 'розов', 'зелёный', 'янтарь', 'коралл'][i]}
              onClick={() => setGrad(g2)}
            >
              <span className={cn('rcy-grad-dot', g2)} />
            </button>
          ))}
        </div>

        <div className="rm-foot">
          <button type="button" className="roy-btn ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="roy-btn primary" onClick={submit}>
            💾 Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── File viewer window (double-click on a Disk file) ─────────────────── */

export function RoyFileViewer({
  node,
  content,
  onClose,
}: {
  node: RoyDiskNode
  content: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }
  const openInSystem = async () => {
    try {
      if (!node.path) return
      // v0.9.42: баг «не работает для файла с Диска» — показываем файл/папку
      // в проводнике (showItemInFolder), а не открываем программой по умолчанию.
      const res = await window.electronAPI.royShowInFolder(node.path)
      if (!res.ok && res.error) {
        // фолбек: старый способ (открыть ассоциированной программой)
        const err2 = await window.electronAPI.systemOpenPath(node.path)
        if (err2) window.alert(`Не удалось открыть в системе:\n${res.error}\n${err2}`)
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="roy-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="roy-modal big roy-fv" style={{ width: 'min(720px, 96vw)' }}>
        <div className="rm-head">
          <div className="rm-title">
            <span className="roy-fv-ico">{node.emoji}</span> {node.label}
            {node.info && <span className="roy-fv-info">{node.info}</span>}
          </div>
          <div className="roy-fv-actions">
            {node.path && (
              <button type="button" className="roy-btn" title="Открыть в проводнике" onClick={() => void openInSystem()}>
                📂 Открыть в системе
              </button>
            )}
            <button type="button" className="roy-btn ghost" onClick={() => void copy()}>
              {copied ? '✓ Скопировано' : '⧉ Копировать'}
            </button>
            <button type="button" className="rm-close" onClick={onClose}>✕</button>
          </div>
        </div>
        {node.path && <div className="roy-fv-path">{node.path}</div>}
        <pre className="roy-fv-content">{content}</pre>
        <div className="roy-fv-foot">{node.path ? 'реальный файл с диска · папка проекта/workspace' : 'рой v0.9.39'}</div>
      </div>
    </div>
  )
}

/**
 * v0.9.45: форма «Роль агента» — промт-роль в рое. Используется в меню ⋯
 * агента (layout) и в карточке агента на арене (ArenaRoy). Текст роли
 * вшивается в промпты задач агента (royRoleNote) и виден координатору.
 */
export function RoyRoleForm({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [text, setText] = useState(getRoyRole(agentId) ?? '')
  const save = () => {
    setRoyRole(agentId, text)
    onClose()
  }
  return (
    <div className="roy-role-form">
      <div className="roy-role-hint">
        Промт-роль добавляется к каждой задаче этого агента и направляет его ответы.
        Координатор роя видит роли всех участников и учитывает их в плане работ.
      </div>
      <div className="roy-micwrap">
        <textarea
          className="roy-role-ta"
          placeholder={'Например: \'Ты — фронтенд-разработчик. Стек React + TS. Отвечаешь кодом и краткими пояснениями, проверяешь сборку перед ответом.\''}
          value={text}
          autoFocus
          rows={6}
          onChange={(e) => setText(e.target.value)}
        />
        <MicDictate appear={text.trim().length > 0} onText={(t) => setText((v) => (v ? v + ' ' + t : t))} />
      </div>
      <div className="rm-foot">
        {text.trim() && (
          <button type="button" className="roy-btn ghost" title="Убрать роль — агент снова без роли" onClick={() => { setText(''); setRoyRole(agentId, ''); onClose() }}>
            ✕ Без роли
          </button>
        )}
        <button type="button" className="roy-btn ghost" onClick={onClose}>Отмена</button>
        <button type="button" className="roy-btn primary" disabled={!text.trim()} onClick={save}>
          💾 Сохранить роль
        </button>
      </div>
    </div>
  )
}
