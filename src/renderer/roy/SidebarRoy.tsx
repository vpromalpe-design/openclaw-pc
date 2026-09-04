import { useState, useMemo } from 'react'
import { ChevronRight, HardDrive, Pencil, Plus, Rocket, Trash2, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RoyGroup, RoyDiskNode } from './types'
import { GRADS } from './data'

/* ── Sidebar: «Группы» — list of roy groups under «Агенты» ───────────── */

export interface RoyGroupsListProps {
  groups: RoyGroup[]
  activeId: string | null
  onOpen: (id: string) => void
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
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

export function RoyGroupsList({ groups, activeId, onOpen, onCreate, onRename, onRemove }: RoyGroupsListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const membersOf = (g: RoyGroup) => g.members.length

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
              <span className={cn('rg-av', g.grad)}>{g.emoji}</span>
              {editingId === g.id ? (
                <InlineName g={g} onDone={(name) => { setEditingId(null); onRename(g.id, name) }} />
              ) : (
                <>
                  <span className="rg-body">
                    <span className="rg-name">{g.name}</span>
                    <span className="rg-sub">
                      {membersOf(g)} уч. · лидер {g.head === 'main' ? 'main' : 'вы'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="rg-more"
                    title="Меню группы"
                    onClick={(e) => { e.stopPropagation(); setMenuId(menuId === g.id ? null : g.id) }}
                  >
                    ⋯
                  </button>
                  {menuId === g.id && (
                    <div className="rg-menu" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => { setMenuId(null); setEditingId(g.id) }}>
                        <Pencil size={13} /> Переименовать
                      </button>
                      <button type="button" onClick={() => { setMenuId(null); onOpen(g.id) }}>
                        <Rocket size={13} /> Открыть арену
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setMenuId(null)
                          if (window.confirm(`Удалить группу «${g.name}»? Участники-агенты останутся.`)) onRemove(g.id)
                        }}
                      >
                        <Trash2 size={13} /> Удалить группу
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Sidebar: «Диск» — кнопка + выезжающий дровер с деревом ─────────── */

export interface RoyDiskProps {
  roots: RoyDiskNode[]
  onOpenFile: (node: RoyDiskNode) => void
  onDragFile: (e: React.DragEvent, node: RoyDiskNode) => void
}

function DiskNodeRow({ node, depth, onOpenFile, onDragFile }: { node: RoyDiskNode; depth: number; onOpenFile: (node: RoyDiskNode) => void; onDragFile: (e: React.DragEvent, node: RoyDiskNode) => void }) {
  const [open, setOpen] = useState(depth === 0)
  const isFolder = node.kind === 'folder'

  return (
    <div>
      <div
        className={cn('roy-drow', isFolder && 'folder', depth === 0 && 'root')}
        style={{ paddingLeft: 6 + depth * 13 }}
        draggable={!isFolder}
        onDragStart={(e) => onDragFile(e, node)}
        onDoubleClick={() => {
          if (isFolder) setOpen((o) => !o)
          else onOpenFile(node)
        }}
        onClick={() => isFolder && setOpen((o) => !o)}
        title={isFolder ? node.label : `${node.label} — открыть (двойной клик)`}
      >
        {isFolder ? (
          <span className="roy-dchev">{open ? '▾' : '▸'}</span>
        ) : (
          <span className="roy-dchev" />
        )}
        <span className="roy-dico">{node.emoji}</span>
        <span className="roy-dname">{node.label}</span>
        {node.info && <span className="roy-dinfo">{node.info}</span>}
      </div>
      {isFolder && open && node.children && (
        <div>
          {node.children.map((c) => (
            <DiskNodeRow key={c.id} node={c} depth={depth + 1} onOpenFile={onOpenFile} onDragFile={onDragFile} />
          ))}
        </div>
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
      title={open ? 'Закрыть диск' : 'Открыть диск — файлы для агентов (перетаскивай на арену)'}
    >
      <span className="roy-disk-btn-ic"><HardDrive size={15} strokeWidth={1.9} /></span>
      <span className="roy-disk-btn-t">Диск</span>
      <span className="roy-disk-btn-cnt">{fileCount}</span>
      <span className="roy-disk-btn-ch">{open ? '▾' : '▸'}</span>
    </button>
  )
}

/** Дровер-панель с деревом диска: закрывается крестиком, кликом по кнопке, Escape. */
export function RoyDiskDrawer({ open, roots, onOpenFile, onDragFile, onClose }: RoyDiskProps & { open: boolean; onClose: () => void }) {
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
        <span className="roy-disk-drawer-sub">{fileCount} файлов — тяни на арену</span>
        <button type="button" className="roy-disk-drawer-x" title="Закрыть диск" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="roy-disk-tree">
        {roots.map((r) => (
          <DiskNodeRow key={r.id} node={r} depth={0} onOpenFile={onOpenFile} onDragFile={onDragFile} />
        ))}
      </div>
      <div className="roy-disk-note">
        💡 тяни файл на арену, чтобы раздать агентам · двойной клик — открыть
      </div>
    </div>
  )
}

export function gradClass(g: RoyGroup): string {
  return GRADS.includes(g.grad as (typeof GRADS)[number]) ? g.grad : 'g0'
}
