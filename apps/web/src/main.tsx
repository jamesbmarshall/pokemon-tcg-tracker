/**
 * Browser entry point. configureForServer() runs before the first render so every catalogue
 * request and card image goes through the PokéTracker server from the start.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// standard.css ships the full width + weight axes; the default entry is weight-only
import '@fontsource-variable/mona-sans/standard.css'
import '@fontsource-variable/martian-mono/standard.css'
import '@fontsource-variable/source-serif-4/opsz.css'
import './index.css'
import { configureForServer } from './api/client'
import { toast } from './store/toastStore'
import App from './App'

configureForServer()

// Only production builds register a service worker; the dev server behaves like a normal page.
if (!import.meta.env.DEV) {
  // Dynamic import keeps the virtual module (and Workbox) out of the dev server entirely.
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      onNeedRefresh() {
        // registerType: 'prompt' means an update is ready but waiting: reloading now would be
        // silent and could drop in-progress edits, so ask first, same as the manual updater flow.
        toast('A new version of PokéTracker is ready.', { action: { label: 'Reload', run: () => updateSW(true) } })
      },
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
