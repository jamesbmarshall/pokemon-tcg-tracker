/**
 * Browser entry point. configureForServer() runs before the first render so every catalogue
 * request and card image goes through the PokéTracker server from the start.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// standard.css ships the full width + weight axes; the default entry is weight-only
import '@fontsource-variable/mona-sans/standard.css'
import '@fontsource-variable/martian-mono/standard.css'
import './index.css'
import { configureForServer } from './api/client'
import App from './App'

configureForServer()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
