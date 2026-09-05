import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { RoyDiskNode, RoyGroup } from './types'
import { GRADS } from './data'
import { MicDictate } from '../components/MicDictate'

/* ── Create-group modal (sidebar «Группы» → ＋) ───────────────────────── */

const ROY_EMOJIS = ['🐝', '🚀', '🛰', '🧠', '⚡', '🎯', '👾', '📡', '🦾', '🗂']
const GRAD_NAMES = ['синий', 'фиолет', 'розов', 'зелёный', 'янтарь', 'коралл']

export function RoyCreateModal({
  onCreate,
  onClose,
}: {
  onCreate: (name: string, emoji: string, grad: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🐝')
  const [grad, setGrad] = useState<string>('g0')

  const submit = () => {
    if (!name.trim()) return
    onCreate(name.trim(), emoji, grad)
  }

  return (
    <div className="roy-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="roy-modal" style={{ width: 'min(480px, 94vw)' }}>
        <div className="rm-head">
          <div className="rm-title">🐝 Новая группа (рой)</div>
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
          <MicDictate onText={(t) => setName((v) => (v ? v + ' ' + t : t))} />
        </div>

        <label className="rcy-label">Эмблема</label>
        <div className="rcy-emojis">
          {ROY_EMOJIS.map((em) => (
            <button
              key={em}
              type="button"
              className={cn('rcy-emoji', emoji === em && 'sel')}
              onClick={() => setEmoji(em)}
            >
              {em}
            </button>
          ))}
        </div>

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
            🐝 Создать рой
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
  const [emoji, setEmoji] = useState(g.emoji || '🐝')
  const [grad, setGrad] = useState<string>(g.grad || 'g0')
  const emojis = ['🐝', '🚀', '🛰', '🧠', '⚡', '🎯', '👾', '📡', '🦾', '🗂', '🦞', '🔬', '🎨', '📚', '💡']
  const emojiPick = emojis.includes(emoji) ? emoji : emojis[0]

  const submit = () => onSave(emojiPick, grad)

  return (
    <div className="roy-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="roy-modal" style={{ width: 'min(480px, 94vw)' }}>
        <div className="rm-head">
          <div className="rm-title">🎨 {g.name} — эмблема и цвет</div>
          <button type="button" className="rm-close" onClick={onClose}>✕</button>
        </div>

        <div className="rcy-label">Эмблема</div>
        <div className="rcy-emojis">
          {emojis.map((em) => (
            <button
              key={em}
              type="button"
              className={cn('rcy-emoji', emojiPick === em && 'sel')}
              onClick={() => setEmoji(em)}
            >
              {em}
            </button>
          ))}
        </div>

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
