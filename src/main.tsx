import { render } from 'solid-js/web'
import { App } from './App'
import '@/styles/index.css'
import 'pdfjs-dist/web/pdf_viewer.css'
import { useTelemetry } from './stores/telemetry'

// Expose telemetry for dev console testing
if (import.meta.env.DEV) {
  ;(window as any).telemetry = useTelemetry()
}

render(() => <App />, document.getElementById('root')!)
