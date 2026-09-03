import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { RoyDiskNode } from './types'
import { GRADS } from './data'

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

        <div className="rm-target">Рой = несколько агентов во главе с main. Арена появится в центре.</div>

        <label className="rcy-label" htmlFor="roy-name">Название</label>
        <input
          id="roy-name"
          className="roy-inline-name rcy-name"
          placeholder="Например: Продакшн-рой"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

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

  return (
    <div className="roy-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="roy-modal big roy-fv" style={{ width: 'min(720px, 96vw)' }}>
        <div className="rm-head">
          <div className="rm-title">
            <span className="roy-fv-ico">{node.emoji}</span> {node.label}
            {node.info && <span className="roy-fv-info">{node.info}</span>}
          </div>
          <div className="roy-fv-actions">
            <button type="button" className="roy-btn ghost" onClick={() => void copy()}>
              {copied ? '✓ Скопировано' : '⧉ Копировать'}
            </button>
            <button type="button" className="rm-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <pre className="roy-fv-content">{content}</pre>
        <div className="roy-fv-foot">виртуальный файл · рой v0.9.34</div>
      </div>
    </div>
  )
}
