import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
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
  /** v0.9.23 (B): options with human-readable labels. */
  modelOptions: Array<{ id: string; label: string }>
  /** Screen X of the agent row's right edge (fixed-position anchor). */
  anchorX: number
  /** Screen Y of the agent row's vertical center. */
  anchorCenterY: number
  onClose: () => void
  onSetModel: (model: string) => void
  onRemove: () => void
}

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
  anchorCenterY,
  onClose,
  onSetModel,
  onRemove,
}: AgentMenuPortalProps) {
  // v0.9.14+: open to the RIGHT of the agent row. The menu is vertically
  // centered on the row center, but using the menu's MEASURED height — the old
  // fixed MENU_MAX_H/2 + translateY(-50%) formula drifted the menu far upward
  // whenever the actual menu was shorter than 280px.
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const h = el.offsetHeight
    const maxTop = window.innerHeight - h - 8
    setTop(Math.max(8, Math.min(anchorCenterY - h / 2, maxTop)))
  }, [anchorCenterY, agent.id, modelOptions.length])
  const left = anchorX + GAP
  const style: CSSProperties = {
    left,
    top: top ?? anchorCenterY,
  }
  const current = agent.model ?? primaryModel ?? ''
  // v0.9.23 (B): группы «Облачные» / «Локальные» в меню модели агента.
  const cloudModels = modelOptions.filter((o) => !o.id.startsWith('local/'))
  const localModels = modelOptions.filter((o) => o.id.startsWith('local/'))
  const renderItem = (o: { id: string; label: string }) => (
    <button
      key={o.id}
      type="button"
      className={cn('a-model-menu-item', current === o.id && 'active')}
      onClick={() => {
        onSetModel(o.id)
        onClose()
      }}
    >
      <span className="a-model-menu-ic">{o.id.startsWith('local/') ? '💻' : '🧠'}</span>
      <span className="a-model-menu-name">{o.label}</span>
      {current === o.id && <span className="a-model-menu-check">✓</span>}
    </button>
  )

  return createPortal(
    <div
      ref={ref}
      className={cn('a-model-menu portal', top === null && 'a-model-menu-measuring')}
      style={style}
    >
      <div className="a-model-menu-title">Модель · {agent.name}</div>
      <div className="a-model-menu-list">
        {modelOptions.length === 0 && (
          <div className="a-model-menu-empty">моделей нет — добавьте провайдера в Моделях</div>
        )}
        {cloudModels.length > 0 && (
          <>
            <div className="a-model-menu-group">Облачные</div>
            {cloudModels.map(renderItem)}
          </>
        )}
        {localModels.length > 0 && (
          <>
            <div className="a-model-menu-group">Локальные</div>
            {localModels.map(renderItem)}
          </>
        )}
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
