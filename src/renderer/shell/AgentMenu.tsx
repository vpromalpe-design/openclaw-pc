import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/** Minimal shape of an agent row (mirrors AgentInfo in EmbeddedShellLayout). */
export interface AgentMenuAgent {
  id: string
  name: string
  model?: string
  isDefault?: boolean
}

interface AgentMenuPortalProps {
  agent: AgentMenuAgent
  primaryModel?: string
  modelOptions: string[]
  /** Screen X of the button's right edge (fixed-position anchor). */
  anchorX: number
  /** Screen Y of the button's bottom edge. */
  anchorY: number
  onClose: () => void
  onSetModel: (model: string) => void
  onRemove: () => void
}

const MENU_MAX_H = 280
const GAP = 6

/**
 * v0.9.14: per-agent model menu, rendered into <body> at fixed screen coords.
 * The old inline version lived inside `.shell-sidebar` (overflow-y: auto),
 * which clipped the menu frame against the sidebar border.
 */
export function AgentMenuPortal({
  agent,
  primaryModel,
  modelOptions,
  anchorX,
  anchorY,
  onClose,
  onSetModel,
  onRemove,
}: AgentMenuPortalProps) {
  const right = Math.max(8, window.innerWidth - anchorX + GAP)
  const openUp = anchorY + MENU_MAX_H + GAP > window.innerHeight
  const style: CSSProperties = openUp
    ? { right, bottom: window.innerHeight - anchorY + GAP }
    : { right, top: anchorY + GAP }
  const current = agent.model ?? primaryModel ?? ''

  return createPortal(
    <div className="a-model-menu portal" style={style}>
      <div className="a-model-menu-title">Модель · {agent.name}</div>
      <div className="a-model-menu-list">
        {modelOptions.length === 0 && (
          <div className="a-model-menu-empty">моделей нет — добавьте провайдера в Моделях</div>
        )}
        {modelOptions.map((m) => (
          <button
            key={m}
            type="button"
            className={cn('a-model-menu-item', current === m && 'active')}
            onClick={() => {
              onSetModel(m)
              onClose()
            }}
          >
            <span className="a-model-menu-ic">{'🧠'}</span>
            <span className="a-model-menu-name">{m}</span>
            {current === m && <span className="a-model-menu-check">✓</span>}
          </button>
        ))}
      </div>
      {agent.isDefault ? (
        <div className="a-model-menu-sep" />
      ) : (
        <>
          <div className="a-model-menu-sep" />
          <button type="button" className="a-model-menu-remove" onClick={onRemove}>
            <span className="a-model-menu-remove-ic">✕</span>
            <span className="a-model-menu-remove-name">Удалить агента и все чаты</span>
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
