import { StrictMode } from 'react'
import './i18n'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { seedRefexApps } from './seeds/seedRefexApps'
import { seedRefexItsmApp } from './seeds/seedRefexItsm'
import { seedRefexLeadTracker } from './seeds/seedRefexLeadTracker'

/** All Refex Kissflow apps (Dev + Prod), then template/scheduler overlays */
seedRefexApps()
seedRefexItsmApp()
seedRefexLeadTracker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
