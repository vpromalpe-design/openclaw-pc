/**
 * v0.9.42: аватары роя — картинки с диска для агентов и групп.
 * Хранятся пути (копии в userData/avatars) в localStorage по id
 * (agent id или group id). Мини-стор с подпиской — без прокидывания пропсов.
 */
import { useSyncExternalStore } from 'react'
import { EmblemIcon, isEmblemKey } from './emblems'

const LS_KEY = 'openclaw-roy-avatars:v1'

export type AvatarMap = Record<string, string>

let cache: AvatarMap | null = null
const listeners = new Set<() => void>()

function read(): AvatarMap {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(LS_KEY)
    cache = raw ? (JSON.parse(raw) as AvatarMap) : {}
  } catch {
    cache = {}
  }
  return cache!
}

function emit(): void {
  for (const l of listeners) l()
}

function write(next: AvatarMap): void {
  cache = next
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  emit()
}

export function getAvatar(id: string): string | undefined {
  return read()[id]
}

export function setAvatar(id: string, path: string): void {
  const cur = read()
  if (cur[id] === path) return
  write({ ...cur, [id]: path })
}

export function clearAvatar(id: string): void {
  const cur = read()
  if (!cur[id]) return
  const next = { ...cur }
  delete next[id]
  write(next)
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Реактивный доступ к карте аватаров (перерисовка при смене). */
export function useRoyAvatars(): AvatarMap {
  return useSyncExternalStore(subscribe, read, read)
}

/** v0.9.46: голый путь (C:\... или /home/...) → file:// URL для <img>. */
export function royAvatarUrl(p: string): string {
  if (!p) return ''
  if (/^(file|https?|data|blob):/i.test(p)) return p
  const norm = p.replace(/\\/g, '/')
  return 'file:///' + encodeURI(norm.replace(/^\/+/, '')).replace(/#/g, '%23')
}

/**
 * Картинка-аватар с фолбэком на эмодзи (и градиент-кружком).
 * Если avatarPath нет — рендерится эмодзи в кружке (как раньше).
 */
export function AvatarImg({
  avatarPath,
  emoji,
  grad,
  alt,
  className,
}: {
  avatarPath?: string
  emoji: string
  grad?: string
  alt?: string
  className?: string
}) {
  if (avatarPath) {
    return (
      <span className={`roy-avimg ${grad ?? ''} ${className ?? ''}`}>
        <img src={royAvatarUrl(avatarPath)} alt={alt ?? ''} draggable={false} />
      </span>
    )
  }
  if (isEmblemKey(emoji)) {
    // v0.9.45: SVG-эмблема в стиле Liquid Glass (вместо эмодзи)
    return (
      <span className={`roy-avemoji ${grad ?? ''} ${className ?? ''}`}>
        <EmblemIcon k={emoji} size={17} strokeWidth={1.9} />
      </span>
    )
  }
  return <span className={`roy-avemoji ${grad ?? ''} ${className ?? ''}`}>{emoji}</span>
}
