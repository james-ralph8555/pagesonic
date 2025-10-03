import { Component, createSignal, onMount, onCleanup } from 'solid-js'
import { PDFViewer } from './components/PDFViewer'
import { SettingsView } from './components/SettingsView'
import { LibraryView } from './components/LibraryView'
import { AppMode } from './types'
import { useLibrary } from './stores/library'

export const App: Component = () => {
  const [currentMode, setCurrentMode] = createSignal<AppMode>('pdf')
  
  // Initialize library once at app level, not component level
  const { initialize } = useLibrary()
  
  onMount(() => {
    const handler = (e: Event) => {
      const mode = (e as CustomEvent<AppMode>).detail
      if (mode === 'pdf' || mode === 'settings' || mode === 'library') {
        setCurrentMode(mode)
      }
    }
    window.addEventListener('app:set-mode', handler as EventListener)
    onCleanup(() => window.removeEventListener('app:set-mode', handler as EventListener))
    
    // Initialize library once when app starts
    initialize()
    
    // Add page unload cleanup for proper resource cleanup
    const beforeUnloadHandler = () => {
      // This will be called when the tab is actually closing
      console.log('[App] Page unloading - this should trigger proper cleanup')
    }
    
    const visibilityChangeHandler = () => {
      if (document.visibilityState === 'hidden') {
        console.log('[App] Page hidden - this might be tab close')
      }
    }
    
    window.addEventListener('beforeunload', beforeUnloadHandler)
    document.addEventListener('visibilitychange', visibilityChangeHandler)
    
    onCleanup(() => {
      window.removeEventListener('beforeunload', beforeUnloadHandler)
      document.removeEventListener('visibilitychange', visibilityChangeHandler)
    })
  })
  
  return (
    <div class={"app " + (
      currentMode() === 'pdf' ? 'app--pdf' : 
      currentMode() === 'settings' ? 'app--settings' : 
      'app--library'
    )}>
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
            class={currentMode() === 'library' ? 'active' : ''}
            onClick={() => setCurrentMode('library')}
          >
            Library
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
        {currentMode() === 'library' && <LibraryView />}
        {currentMode() === 'settings' && <SettingsView />}
      </main>
    </div>
  )
}
