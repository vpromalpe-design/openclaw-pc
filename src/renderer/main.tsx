import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initI18n } from './i18n'
import './styles/globals.css'

// Debug: if this prints, the shell renderer loaded
console.info('[OpenClaw] Renderer started', typeof window.electronAPI !== 'undefined' ? '(IPC OK)' : '(IPC missing)')

/**
 * Liquid Glass Light is the default theme (v0.9.9+). The light palette is the
 * base token set; the .dark class switches the whole UI to the dark palette.
 */
async function applyStartupTheme(): Promise<void> {
  try {
    const cfg = await window.electronAPI.shellGetConfig()
    const theme = cfg?.theme
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      // default / system / unknown → light (Liquid Glass Light)
      document.documentElement.classList.remove('dark')
    }
  } catch {
    document.documentElement.classList.remove('dark')
  }
}

async function bootstrap(): Promise<void> {
  await Promise.all([initI18n(), applyStartupTheme()])
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void bootstrap()
