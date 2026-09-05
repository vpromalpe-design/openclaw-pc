/**
 * v0.9.45: авторские SVG-эмблемы групп в стиле Liquid Glass (контурные,
 * stroke currentColor — цвет даёт контекст/градиент группы). Старые группы
 * с эмодзи продолжают работать: EmblemIcon рендерит ключ как эмодзи-текст,
 * если его нет в наборе.
 */
import type { ReactNode } from 'react'

export const EMBLEM_KEYS = [
  'bot',
  'sat',
  'radar',
  'target',
  'shield',
  'star',
  'flame',
  'crystal',
  'crown',
  'bolt',
  'atom',
  'rocket',
  'spark',
  'wave',
  'hex',
  'moon',
] as const

export type EmblemKey = (typeof EMBLEM_KEYS)[number]

const ICONS: Record<string, ReactNode> = {
  bot: (
    <>
      <rect x="5" y="8" width="14" height="10" rx="3" />
      <path d="M12 8V5.5" />
      <path d="M9 5.5h6" />
      <path d="M9.2 12.6h.01M14.8 12.6h.01" />
      <path d="M9 16.4h6" />
    </>
  ),
  sat: (
    <>
      <rect x="9" y="9" width="6" height="6" rx="1.4" />
      <path d="M12 9V4" />
      <path d="M10.6 6.5 8.5 8.6M13.4 6.5l2.1 2.1" />
      <path d="M12 15v5" />
      <path d="M10.6 17.5 8.5 15.4M13.4 17.5l2.1-2.1" />
    </>
  ),
  radar: (
    <>
      <path d="M4.5 13.5a7.5 7.5 0 0 1 15 0" />
      <path d="M8 13.5a4 4 0 0 1 8 0" />
      <path d="M12 13.5V4.5" />
      <path d="M12 4.5 13.8 3" />
      <circle cx="12" cy="13.5" r="1.4" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="12" cy="12" r="1.2" />
      <path d="M12 3.8V2M12 22v-1.8M3.8 12H2M22 12h-1.8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.2 18.5 5.6v5.2c0 4.1-2.7 6.9-6.5 8.4-3.8-1.5-6.5-4.3-6.5-8.4V5.6z" />
      <path d="m8.9 11.8 2.2 2.2 4-4.4" />
    </>
  ),
  star: (
    <path d="m12 3.4 2.5 5.2 5.7.7-4.2 3.9 1.1 5.7-5.1-2.8-5.1 2.8 1.1-5.7L3.8 9.3l5.7-.7z" />
  ),
  flame: (
    <>
      <path d="M12 3.4c2 3.4 5.4 4.9 5.4 8.8a5.4 5.4 0 0 1-10.8 0c0-3.9 3.4-5.4 5.4-8.8z" />
      <path d="M9.6 16.2a2.6 2.6 0 0 0 2.4 2.5" />
    </>
  ),
  crystal: (
    <>
      <path d="M12 3 18.6 8 12 20.8 5.4 8z" />
      <path d="M5.4 8h13.2" />
      <path d="M12 8v12.8" />
    </>
  ),
  crown: (
    <>
      <path d="m4.2 8.5 3.6 3 4.2-6 4.2 6 3.6-3-1.7 8.3H5.9z" />
      <path d="M5.9 19.2h12.2" />
    </>
  ),
  bolt: (
    <path d="M13.2 2.6 4.6 13.4h6.2l-1.4 8 8.6-10.8h-6.2z" />
  ),
  atom: (
    <>
      <circle cx="12" cy="12" r="1.8" />
      <ellipse cx="12" cy="12" rx="10" ry="4.1" />
      <ellipse cx="12" cy="12" rx="10" ry="4.1" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4.1" transform="rotate(120 12 12)" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 3c2.8 1.9 4.3 5.3 4.3 8.3L12 19.8l-4.3-8.5C7.7 8.3 9.2 4.9 12 3z" />
      <circle cx="12" cy="9.6" r="1.6" />
      <path d="M7.7 11.4 3.4 12.4l2.2-1.9M16.3 11.4l4.3 1-2.2-1.9" />
      <path d="M8.2 16.4 5 19.2M15.8 16.4l3.2 2.8" />
    </>
  ),
  spark: (
    <path d="M12 2.8c.7 4.9 4.3 8.5 9.2 9.2-4.9.7-8.5 4.3-9.2 9.2-.7-4.9-4.3-8.5-9.2-9.2 4.9-.7 8.5-4.3 9.2-9.2z" />
  ),
  wave: (
    <path d="M3 12.4c1.9-4.6 4.4-4.6 6.3 0s4.4 4.6 6.3 0 4.4-4.6 5.4-1" />
  ),
  hex: (
    <>
      <path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z" />
      <path d="M12 7.6 16.6 10v4.9L12 17.5l-4.6-2.6V10z" />
    </>
  ),
  moon: (
    <path d="M20.2 14.2A8.2 8.2 0 1 1 9.8 3.8a6.6 6.6 0 0 0 10.4 10.4z" />
  ),
}

export function isEmblemKey(k: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICONS, k)
}

/** Эмблема группы: SVG по ключу; неизвестный ключ — как текст (старые эмодзи). */
export function EmblemIcon({
  k,
  size = 20,
  strokeWidth = 1.8,
  className,
}: {
  k: string
  size?: number
  strokeWidth?: number
  className?: string
}) {
  const node = ICONS[k]
  if (!node) {
    return (
      <span className={className} style={{ fontSize: size * 0.92, lineHeight: 1 }}>
        {k}
      </span>
    )
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {node}
    </svg>
  )
}
