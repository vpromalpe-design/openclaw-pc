/**
 * v0.9.46: глобальное контекст-меню для полей ввода.
 * Правый клик на input/textarea (в любом месте приложения, включая мастер
 * настройки и визард) показывает своё меню: Вставить / Копировать / Вырезать /
 * Выделить всё. Вставка/копирование идут через системный буфер (IPC в main),
 * поэтому работают даже там, где Chromium-меню подавлено.
 */

type Editable = HTMLInputElement | HTMLTextAreaElement

const isEditable = (t: EventTarget | null): Editable | null => {
  if (!(t instanceof Element)) return null
  const el = t.closest('input, textarea') as Editable | null
  if (!el) return null
  if (el.disabled || el.readOnly) return null
  return el
}

/** Нативный setter value + input-событие — React-controlled поля тоже обновятся. */
function setValue(el: Editable, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function selectedText(el: Editable): string {
  const s = el.selectionStart ?? el.value.length
  const e = el.selectionEnd ?? el.value.length
  return el.value.slice(s, e)
}

let menuEl: HTMLDivElement | null = null

function closeMenu(): void {
  if (menuEl) {
    menuEl.remove()
    menuEl = null
  }
}

function btn(label: string, danger: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'app-ctx-item' + (danger ? ' danger' : '')
  b.textContent = label
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
    closeMenu()
  })
  return b
}

function showMenu(x: number, y: number, el: Editable): void {
  closeMenu()
  menuEl = document.createElement('div')
  menuEl.className = 'app-ctx-menu'
  const hasSel = selectedText(el).length > 0

  const doPaste = (): void => {
    void window.electronAPI.clipboardRead().then((text) => {
      if (!text) return
      const s = el.selectionStart ?? el.value.length
      const e = el.selectionEnd ?? el.value.length
      const next = el.value.slice(0, s) + text + el.value.slice(e)
      el.focus()
      try {
        setValue(el, next)
        el.setSelectionRange(s + text.length, s + text.length)
      } catch {
        /* readonly-фолбэк — игнор */
      }
    })
  }
  const doCopy = (): void => {
    const t = selectedText(el)
    if (t) void window.electronAPI.clipboardWrite(t)
  }
  const doCut = (): void => {
    const s = el.selectionStart ?? 0
    const e = el.selectionEnd ?? 0
    const t = el.value.slice(s, e)
    if (!t) return
    void window.electronAPI.clipboardWrite(t)
    setValue(el, el.value.slice(0, s) + el.value.slice(e))
  }
  const doSelectAll = (): void => {
    el.focus()
    el.setSelectionRange(0, el.value.length)
  }

  menuEl.appendChild(btn('Вставить', false, doPaste))
  if (hasSel) {
    menuEl.appendChild(btn('Копировать', false, doCopy))
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      menuEl.appendChild(btn('Вырезать', false, doCut))
    }
  }
  menuEl.appendChild(btn('Выделить всё', false, doSelectAll))

  // не даём меню вылезти за экран
  const pad = 8
  menuEl.style.visibility = 'hidden'
  document.body.appendChild(menuEl)
  const mw = menuEl.offsetWidth
  const mh = menuEl.offsetHeight
  menuEl.style.visibility = ''
  menuEl.style.left = Math.max(pad, Math.min(x, window.innerWidth - mw - pad)) + 'px'
  menuEl.style.top = Math.max(pad, Math.min(y, window.innerHeight - mh - pad)) + 'px'

  // клик левой кнопкой где угодно (кроме самого меню) закрывает
  setTimeout(() => {
    document.addEventListener('mousedown', closeOnDown, true)
  }, 0)
}

function closeOnDown(e: MouseEvent): void {
  if (menuEl && !menuEl.contains(e.target as Node)) closeMenu()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeMenu()
}

export function setupInputContextMenu(): void {
  document.addEventListener('contextmenu', (e) => {
    const el = isEditable(e.target)
    if (!el) {
      // вне полей ввода — дефолтное поведение/другие меню
      closeMenu()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    showMenu(e.clientX, e.clientY, el)
  })

  document.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', closeMenu)
  window.addEventListener('resize', closeMenu)
  document.addEventListener('scroll', closeMenu, true)
}
