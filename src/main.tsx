import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// standard.css ships the full width + weight axes; the default entry is weight-only
import '@fontsource-variable/mona-sans/standard.css'
import '@fontsource-variable/martian-mono/standard.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
