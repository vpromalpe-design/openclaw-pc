/**
 * v0.9.45: роли агентов роя — промт-роль, влияющий на ответы агента.
 * Хранится по id агента в localStorage (как аватары). Мини-стор с подпиской.
 * Роль задаётся: при создании агента, в меню агента ⋯ («Роль агента»),
 * в карточке агента на арене. Координатор видит роли всех участников —
 * они вшиваются в промпты миссий/задач.
 */
import { useSyncExternalStore } from 'react'

const LS_KEY = 'openclaw-roy-roles:v1'

export type RoyRoleMap = Record<string, string>

let cache: RoyRoleMap | null = null
const listeners = new Set<() => void>()

function read(): RoyRoleMap {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(LS_KEY)
    cache = raw ? (JSON.parse(raw) as RoyRoleMap) : {}
  } catch {
    cache = {}
  }
  return cache!
}

function emit(): void {
  for (const l of listeners) l()
}

function write(next: RoyRoleMap): void {
  cache = next
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  emit()
}

export function getRoyRole(id: string): string | undefined {
  const v = read()[id]
  return v && v.trim() ? v : undefined
}

export function setRoyRole(id: string, text: string): void {
  const cur = read()
  const v = text.trim()
  if ((cur[id] ?? '') === v) return
  const next = { ...cur }
  if (v) next[id] = v
  else delete next[id]
  write(next)
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Реактивный доступ к карте ролей (перерисовка при смене). */
export function useRoyRoles(): RoyRoleMap {
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * v0.9.45: заметка о роли для промпта самому агенту («Твоя роль в рое…»).
 * Возвращает '' если роль не задана.
 */
export function royRoleNote(id: string): string {
  const role = getRoyRole(id)
  return role ? `\n\n🎭 ТВОЯ РОЛЬ В РОЕ: ${role}\nДействуй строго в этой роли и не выходи из неё (если задача противоречит роли — сообщи).` : ''
}

/**
 * v0.9.45: сводка ролей участников для координатора/лидера.
 * nameOf — карта id → имя (для читаемости).
 */
export function royRolesSummary(ids: string[], nameOf: (id: string) => string | undefined): string {
  const parts: string[] = []
  for (const id of ids) {
    const role = getRoyRole(id)
    const nm = nameOf(id)
    parts.push(role ? `- ${id}${nm ? ` (${nm})` : ''}: ${role}` : `- ${id}${nm ? ` (${nm})` : ''}: роль не задана`)
  }
  if (parts.length === 0) return ''
  return `\nРоли участников (учитывай при распределении подзадач):\n${parts.join('\n')}`
}
