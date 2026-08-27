/**
 * Soft UI sounds — ported 1:1 from the approved signature glass style mockup
 * (openclaw-pc-mockup-glass (4).html):
 *   - «тук»: low warm knock  (185 → 115 Hz, vol 0.13) on buttons/items
 *   - «пук»: softer, rounder  (255 → 165 Hz, vol 0.11) on opening menus
 * Web Audio API, no assets needed.
 */

let actx: AudioContext | null = null

function ensureAudio(): AudioContext | null {
  if (!actx) {
    try {
      actx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    } catch {
      actx = null
    }
  }
  if (actx && actx.state === 'suspended') {
    void actx.resume()
  }
  return actx
}

function knock(f1: number, f2: number, dur: number, vol: number): void {
  const a = ensureAudio()
  if (!a) return
  const t = a.currentTime
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(f1, t)
  o.frequency.exponentialRampToValueAtTime(f2, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06)
  o.connect(g)
  g.connect(a.destination)
  o.start(t)
  o.stop(t + dur + 0.1)
}

/** Soft «тук»: low warm knock. */
export function tuk(): void {
  knock(185, 115, 0.075, 0.13)
}

/** Softer «пук»: slightly higher, rounder. */
export function puk(): void {
  knock(255, 165, 0.09, 0.11)
}

/**
 * Attach «тук» to every clickable element of the shell chrome, and «пук»
 * (open) / «тук» (close) to the menu triggers — mirroring the mockup.
 * Safe to call multiple times: guards against duplicate listeners.
 */
export function installShellSounds(): () => void {
  if (typeof document === 'undefined') return () => {}

  const onKnock = (e: Event): void => {
    // Ignore the menu trigger buttons here — they play puk/tuk below.
    if ((e.target as HTMLElement | null)?.closest?.('.shell-pill, .shell-icon-btn')) return
    tuk()
  }
  document.addEventListener('pointerdown', onKnock, { capture: false })

  const onTrigger = (e: Event): void => {
    const t = e.target as HTMLElement
    if (!t || typeof t.closest !== 'function') return
    const trigger = t.closest('.shell-pill, .shell-icon-btn') as HTMLElement | null
    if (!trigger) return
    const m = trigger.nextElementSibling
    if (m && m.classList.contains('shell-menu') && !m.classList.contains('open')) {
      puk()
    } else {
      tuk()
    }
  }
  document.addEventListener('pointerdown', onTrigger, { capture: false })

  return () => {
    document.removeEventListener('pointerdown', onKnock)
    document.removeEventListener('pointerdown', onTrigger)
  }
}
