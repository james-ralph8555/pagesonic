import { Component, createSignal, onMount, onCleanup } from 'solid-js'
import { PDFViewer } from './components/PDFViewer'
import { ReaderView } from './components/ReaderView'
import { SettingsView } from './components/SettingsView'
import { AppMode } from './types'

export const App: Component = () => {
  const [currentMode, setCurrentMode] = createSignal<AppMode>('pdf')
  
  onMount(() => {
    const handler = (e: Event) => {
      const mode = (e as CustomEvent<AppMode>).detail
      if (mode === 'pdf' || mode === 'reader' || mode === 'settings') {
        setCurrentMode(mode)
      }
    }
    window.addEventListener('app:set-mode', handler as EventListener)
    onCleanup(() => window.removeEventListener('app:set-mode', handler as EventListener))
  })
  
  return (
    <div class={"app " + (currentMode() === 'pdf' ? 'app--pdf' : '')}>
      <header class="app-header">
        <h1>PageSonic</h1>
        <p>PDF Reader with Text-to-Speech</p>
        <nav class="app-nav">
          <button
            class={currentMode() === 'pdf' ? 'active' : ''}
            onClick={() => setCurrentMode('pdf')}
          >
            PDF Viewer
          </button>
          <button
            class={currentMode() === 'reader' ? 'active' : ''}
            onClick={() => setCurrentMode('reader')}
          >
            Reader Mode
          </button>
          <button
            class={currentMode() === 'settings' ? 'active' : ''}
            onClick={() => setCurrentMode('settings')}
          >
            Settings
          </button>
        </nav>
      </header>
      
      <main class="app-main">
        {currentMode() === 'pdf' && <PDFViewer />}
        {currentMode() === 'reader' && <ReaderView />}
        {currentMode() === 'settings' && <SettingsView />}
      </main>
    </div>
  )
}
