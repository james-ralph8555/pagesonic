import { Component, createSignal } from 'solid-js'
import { PDFViewer } from './components/PDFViewer'
import { ReaderView } from './components/ReaderView'
import { SettingsView } from './components/SettingsView'
import { AppMode } from './types'

export const App: Component = () => {
  const [currentMode, setCurrentMode] = createSignal<AppMode>('pdf')
  
  return (
    <div class="app">
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