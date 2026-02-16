import { render } from 'solid-js/web'
import { App } from './App'
import '@/styles/index.css'
import 'pdfjs-dist/web/pdf_viewer.css'
import { useTelemetry } from './stores/telemetry'
import { logger } from './utils/logger'

// Expose telemetry and logger for dev console testing
if (import.meta.env.DEV) {
  ;(window as any).telemetry = useTelemetry()
  ;(window as any).__logger = logger
}

render(() => <App />, document.getElementById('root')!)
