import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, ClipboardPaste, Copy, FilePenLine, HardDrive, Image as ImageIcon, Pencil, Plus, Rocket, Trash2, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RoyGroup, RoyDiskNode } from './types'
import { GRADS } from './data'
import { useRoyAvatars, AvatarImg } from './avatar'
import { royClipGet, royClipSet } from './fsclip'

/* ── Sidebar: «Группы» — list of roy groups under «Агенты» ───────────── */

export interface RoyGroupsListProps {
  groups: RoyGroup[]
  activeId: string | null
  onOpen: (id: string) => void
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  /** v0.9.42: сменить аватар группы (картинка с диска) */
  onAvatar: (g: RoyGroup) => void
  /** v0.9.42: сменить эмблему/цвет группы */
  onEmblem: (g: RoyGroup) => void
}

/** Small inline editor used for «rename» (double-click on a group row). */
function InlineName({ g, onDone }: { g: RoyGroup; onDone: (name: string) => void }) {
  const [v, setV] = useState(g.name)
  return (
    <input
      className="roy-inline-name"
      value={v}
      autoFocus
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(v)
        if (e.key === 'Escape') onDone(g.name)
      }}
    />
  )
}

export function RoyGroupsList({ groups, activeId, onOpen, onCreate, onRename, onRemove, onAvatar, onEmblem }: RoyGroupsListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ g: RoyGroup; x: number; y: number; up: boolean } | null>(null)
  const avatars = useRoyAvatars()
  const membersOf = (g: RoyGroup) => g.members.length

  const openMenu = (e: React.MouseEvent, g: RoyGroup) => {
    e.stopPropagation()
    if (menu && menu.g.id === g.id) {
      setMenu(null)
      return
    }
    const r = e.currentTarget.getBoundingClientRect()
    const up = r.bottom + 190 > window.innerHeight
    setMenu({ g, x: r.right - 6, y: up ? r.top - 6 : r.bottom + 6, up })
  }

  const groupAvatar = (g: RoyGroup) => avatars[g.id]

  return (
    <div className="shell-side-group roy-groups">
      <div className="shell-g-title">
        Группы
        <span className="plus" title="Новая группа (рой)" onClick={onCreate}>
          <Plus size={13} />
        </span>
      </div>

      {groups.length === 0 && (
        <button type="button" className="roy-groups-empty" onClick={onCreate} title="Создать группу (рой)">
          <span className="rg-ic"><Users size={14} /></span>
          <span className="rg-t">Создай первый рой</span>
          <ChevronRight size={14} className="rg-go" />
        </button>
      )}

      {groups.length > 0 && (
        <div className="roy-groups-scroll">
          {groups.map((g) => (
            <div
              key={g.id}
              className={cn('roy-group-row', activeId === g.id && 'active')}
              onClick={() => onOpen(g.id)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditingId(g.id)
              }}
              title="Открыть арену (двойной клик — переименовать)"
            >
              <AvatarImg
                avatarPath={groupAvatar(g)}
                emoji={g.emoji}
                grad={g.grad}
                alt={g.name}
                className="rg-av"
              />
              {editingId === g.id ? (
                <InlineName g={g} onDone={(name) => { setEditingId(null); onRename(g.id, name) }} />
              ) : (
                <>
                  <span className="rg-body">
                    <span className="rg-name">{g.name}</span>
                    <span className="rg-sub">
                      {membersOf(g)} уч. · глава {g.head === 'main' ? 'координатор' : 'вы'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="rg-more"
                    title="Меню группы"
                    onClick={(e) => openMenu(e, g)}
                  >
                    ⋯
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* v0.9.42: меню группы — порталом в body, справа от кнопки (не обрезается скроллом) */}
      {menu &&
        createPortal(
          <div
            className={cn('rg-menu rg-menu-pop', menu.up && 'up')}
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="rg-menu-back" onMouseDown={() => setMenu(null)} onClick={() => setMenu(null)} />
            <button type="button" onClick={() => { const g = menu.g; setMenu(null); setEditingId(g.id) }}>
              <Pencil size={13} /> Переименовать
            </button>
            <button type="button" onClick={() => { const g = menu.g; setMenu(null); onEmblem(g) }}>
              🎨 Эмблема и цвет
            </button>
            <button type="button" onClick={() => { const g = menu.g; setMenu(null); onAvatar(g) }}>
              <ImageIcon size={13} /> Сменить аватар
            </button>
            <button type="button" onClick={() => { const g = menu.g; setMenu(null); onOpen(g.id) }}>
              <Rocket size={13} /> Открыть арену
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                const g = menu.g
                setMenu(null)
                if (window.confirm(`Удалить группу «${g.name}»? Участники-агенты останутся.`)) onRemove(g.id)
              }}
            >
              <Trash2 size={13} /> Удалить группу
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}

/* ── Sidebar: «Диск» — кнопка + выезжающий дровер с деревом ─────────── */

export interface RoyDiskProps {
  roots: RoyDiskNode[]
  onOpenFile: (node: RoyDiskNode) => void
  onDragFile: (e: React.DragEvent, node: RoyDiskNode) => void
  /** v0.9.46: дерево изменилось (переименовали/удалили/вставили) — перечитать */
  onMutated?: () => void
}

function DiskNodeRow({ node, depth, onOpenFile, onDragFile, onMutated }: { node: RoyDiskNode; depth: number; onOpenFile: (node: RoyDiskNode) => void; onDragFile: (e: React.DragEvent, node: RoyDiskNode) => void; onMutated?: () => void }) {
  const [open, setOpen] = useState(depth === 0)
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [armDel, setArmDel] = useState(false)
  const isFolder = node.kind === 'folder'

  const doMutate = (): void => {
    if (onMutated) onMutated()
  }

  // ── операции ──
  const doRename = async (name: string): Promise<void> => {
    const v = name.trim()
    if (!v || v === node.label || !node.path) return
    const res = await window.electronAPI.royFsRename({ path: node.path, name: v })
    if (res?.ok) doMutate()
  }
  const doDelete = async (): Promise<void> => {
    if (!node.path) return
    const res = await window.electronAPI.royFsDelete(node.path)
    if (res?.ok) {
      if (royClipGet()?.path === node.path) royClipSet(null)
      doMutate()
    }
  }
  const doCopy = (): void => {
    royClipSet({ path: node.path ?? '', label: node.label, kind: node.kind })
  }
  const doPasteHere = async (): Promise<void> => {
    const c = royClipGet()
    if (!c || !node.path) return
    const res = await window.electronAPI.royFsCopy({ src: c.path, destDir: node.path })
    if (res?.ok) doMutate()
  }

  const clip = royClipGet()

  const rowInner = (
    <div
      className={cn('roy-drow', isFolder && 'folder', depth === 0 && 'root')}
      style={{ paddingLeft: 6 + depth * 13 }}
      draggable
      onDragStart={(e) => onDragFile(e, node)}
      onDoubleClick={(e) => {
        e.preventDefault()
        if (isFolder) setOpen((o) => !o)
        else onOpenFile(node)
      }}
      onClick={() => isFolder && setOpen((o) => !o)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setArmDel(false)
        setRenaming(false)
        setCtx({ x: e.clientX, y: e.clientY })
      }}
      title={
        isFolder
          ? `${node.label} — перетащи на арену как папку проекта, раскрой (клик); правый клик — меню`
          : `${node.label} — открыть (двойной клик); правый клик — меню`
      }
    >
      {isFolder ? (
        <span className="roy-dchev">{open ? '▾' : '▸'}</span>
      ) : (
        <span className="roy-dchev" />
      )}
      <span className="roy-dico">{node.emoji}</span>
      {renaming ? (
        <input
          className="roy-inline-name disk-rename"
          defaultValue={node.label}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onKeyDown={async (e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              const v = (e.target as HTMLInputElement).value
              setRenaming(false)
              void doRename(v)
            }
            if (e.key === 'Escape') setRenaming(false)
          }}
          onBlur={(e) => {
            setRenaming(false)
            void doRename(e.target.value)
          }}
        />
      ) : (
        <span className="roy-dname">{node.label}</span>
      )}
      {node.info && <span className="roy-dinfo">{node.info}</span>}
    </div>
  )

  return (
    <div>
      {rowInner}
      {isFolder && open && node.children && (
        <div>
          {node.children.map((c) => (
            <DiskNodeRow key={c.id} node={c} depth={depth + 1} onOpenFile={onOpenFile} onDragFile={onDragFile} onMutated={onMutated} />
          ))}
        </div>
      )}

      {/* v0.9.46: контекст-меню диска (правый клик) — порталом в body */}
      {ctx &&
        createPortal(
          <div
            className="rg-menu rg-menu-pop disk-ctx"
            style={{ left: ctx.x, top: ctx.y }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="rg-menu-back" onMouseDown={() => setCtx(null)} onClick={() => setCtx(null)} />
            <button
              type="button"
              onClick={() => {
                setCtx(null)
                setRenaming(true)
              }}
            >
              <FilePenLine size={13} /> Переименовать
            </button>
            <button
              type="button"
              onClick={() => {
                doCopy()
                setCtx(null)
              }}
            >
              <Copy size={13} /> Копировать
            </button>
            {isFolder && clip && (
              <button
                type="button"
                onClick={() => {
                  setCtx(null)
                  void doPasteHere()
                }}
              >
                <ClipboardPaste size={13} /> Вставить «{clip.label}»
              </button>
            )}
            <button
              type="button"
              className={armDel ? 'danger' : ''}
              onClick={() => {
                if (!armDel) {
                  setArmDel(true)
                  return
                }
                setCtx(null)
                void doDelete()
              }}
            >
              <Trash2 size={13} /> {armDel ? 'Точно удалить?' : 'Удалить'}
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}

/** Кнопка-переключатель «Диск» в сайдбаре (вместо всегда-открытого дерева). */
export function RoyDiskButton({ fileCount, open, onToggle }: { fileCount: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={cn('roy-disk-btn', open && 'open')}
      onClick={onToggle}
      title={open ? 'Закрыть диск' : 'Открыть диск — файлы и папки для агентов (перетаскивай на арену)'}
    >
      <span className="roy-disk-btn-ic"><HardDrive size={15} strokeWidth={1.9} /></span>
      <span className="roy-disk-btn-t">Диск</span>
      <span className="roy-disk-btn-cnt">{fileCount}</span>
      <span className="roy-disk-btn-ch">{open ? '▾' : '▸'}</span>
    </button>
  )
}

/** Дровер-панель с деревом диска: закрывается крестиком, кликом по кнопке, Escape. */
export function RoyDiskDrawer({ open, roots, onOpenFile, onDragFile, onClose, onMutated }: RoyDiskProps & { open: boolean; onClose: () => void }) {
  const fileCount = useMemo(() => {
    const count = (ns: RoyDiskNode[]): number =>
      ns.reduce((n, x) => n + (x.kind === 'file' ? 1 : x.children ? count(x.children) : 0), 0)
    return count(roots)
  }, [roots])

  if (!open) return null
  return (
    <div className="roy-disk-drawer">
      <div className="roy-disk-drawer-head">
        <span className="roy-disk-drawer-title"><HardDrive size={14} /> Диск</span>
        <span className="roy-disk-drawer-sub">{fileCount} файлов — тяни на арену (папки тоже)</span>
        <button type="button" className="roy-disk-drawer-x" title="Закрыть диск" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="roy-disk-tree">
        {roots.map((r) => (
          <DiskNodeRow key={r.id} node={r} depth={0} onOpenFile={onOpenFile} onDragFile={onDragFile} onMutated={onMutated} />
        ))}
      </div>
      <div className="roy-disk-note">
        💡 тяни файл или папку на арену · двойной клик — открыть · правый клик — переименовать / копировать / вставить / удалить
      </div>
    </div>
  )
}

export function gradClass(g: RoyGroup): string {
  return GRADS.includes(g.grad as (typeof GRADS)[number]) ? g.grad : 'g0'
}
