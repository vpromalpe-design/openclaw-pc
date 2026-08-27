import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initI18n } from './i18n'
import './styles/globals.css'

// Debug: if this prints, the shell renderer loaded
console.info('[OpenClaw] Renderer started', typeof window.electronAPI !== 'undefined' ? '(IPC OK)' : '(IPC missing)')

/**
 * v0.9.0: тёмная тема — единственная (светлая удалена по решению Дамира).
 */
async function applyStartupTheme(): Promise<void> {
  document.documentElement.classList.add('dark')
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
