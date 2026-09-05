/**
 * v0.9.46: буфер «Копировать/Вставить» для файлов Диска.
 * Хранит один скопированный узел (путь/имя/тип) в памяти — не в LS,
 * чтобы не протухал между сессиями молча.
 */

export interface RoyClipItem {
  path: string
  label: string
  kind: 'file' | 'folder'
}

let clip: RoyClipItem | null = null

export function royClipGet(): RoyClipItem | null {
  return clip
}

export function royClipSet(item: RoyClipItem | null): void {
  clip = item
}
