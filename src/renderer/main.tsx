import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initI18n } from './i18n'
import './styles/globals.css'

// Debug: if this prints, the shell renderer loaded
console.info('[OpenClaw] Renderer started', typeof window.electronAPI !== 'undefined' ? '(IPC OK)' : '(IPC missing)')

/**
 * Liquid Glass is a dark theme; apply it at startup so every screen (panels,
 * settings, wizard) gets white-on-glass text instead of the light-theme tokens
 * (dark text on the dark glass background). The only way to opt into the
 * light theme is explicitly choosing «Светлая» in Settings.
 */
async function applyStartupTheme(): Promise<void> {
  try {
    const cfg = await window.electronAPI.shellGetConfig()
    const theme = cfg?.theme
    if (theme === 'light') {
      document.documentElement.classList.remove('dark')
    } else {
      // default / system / unknown → dark (Liquid Glass)
      document.documentElement.classList.add('dark')
    }
  } catch {
    document.documentElement.classList.add('dark')
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
