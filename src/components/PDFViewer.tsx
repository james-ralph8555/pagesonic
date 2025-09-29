import { Component, createSignal, onMount, onCleanup, For, createEffect } from 'solid-js'
import { usePDF } from '@/stores/pdf'
import { useTTS } from '@/stores/tts'
import { PDFPage } from './PDFPage'

export const PDFViewer: Component = () => {
  const { state: pdfState, loadPDF } = usePDF()
  const {} = useTTS()

  const [fileInput, setFileInput] = createSignal<HTMLInputElement | null>(null)
  const [viewportH, setViewportH] = createSignal<number>(window.innerHeight)
  const [showRail, setShowRail] = createSignal<boolean>(true)
  let hideTimer: number | undefined

  const RAIL_HEIGHT = 56 // px
  const V_PADDING = 24 // px padding around pages

  const handleFileSelect = (event: Event) => {
    const target = event.target as HTMLInputElement
    const file = target.files?.[0]
    if (file && file.type === 'application/pdf') {
      loadPDF(file)
    }
  }

  const scaleForPage = (pageIndex: number) => {
    const page = pdfState().pages[pageIndex]
    if (!page) return 1
    const availableH = viewportH() - RAIL_HEIGHT - V_PADDING * 2
    const scale = Math.max(0.1, availableH / page.height)
    return scale
  }

  const onResize = () => setViewportH(window.innerHeight)

  const pokeUI = () => {
    setShowRail(true)
    if (hideTimer) window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(() => setShowRail(false), 2000)
  }

  onMount(() => {
    window.addEventListener('resize', onResize)
    document.addEventListener('mousemove', pokeUI)
    document.addEventListener('scroll', pokeUI, { passive: true })
    // Start hidden after a moment for immersion
    hideTimer = window.setTimeout(() => setShowRail(false), 1500)
  })

  onCleanup(() => {
    window.removeEventListener('resize', onResize)
    document.removeEventListener('mousemove', pokeUI)
    document.removeEventListener('scroll', pokeUI)
    if (hideTimer) window.clearTimeout(hideTimer)
  })

  createEffect(() => {
    // Recompute when pages change (new document)
    pdfState().pages.length
    pokeUI()
  })

  return (
    <div class="pdf-viewer">
      <div class={"pdf-top-rail" + (showRail() ? '' : ' hidden')}>
        <select
          class="rail-select"
          aria-label="Switch tab"
          value="pdf"
          onChange={(e) => {
            const value = (e.target as HTMLSelectElement).value as 'pdf' | 'reader' | 'settings'
            window.dispatchEvent(new CustomEvent('app:set-mode', { detail: value }))
          }}
        >
          <option value="pdf">PDF Viewer</option>
          <option value="reader">Reader Mode</option>
          <option value="settings">Settings</option>
        </select>
        <input
          ref={setFileInput}
          type="file"
          accept=".pdf"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <button class="rail-btn" onClick={() => fileInput()?.click()}>Open</button>
        <div class="rail-meta">
          {pdfState().document
            ? <span>{pdfState().document?.title || 'Untitled Document'} · {pdfState().pages.length} pages</span>
            : <span>No PDF loaded</span>
          }
        </div>
      </div>

      <div class="pdf-scroll">
        {pdfState().isLoading && (
          <div class="loading">Loading PDF...</div>
        )}

        {pdfState().error && (
          <div class="error">{pdfState().error}</div>
        )}

        <div class="pdf-pages">
          {pdfState().document ? (
            <For each={pdfState().pages}>
              {(p, i) => (
                <PDFPage
                  pageNumber={p.pageNumber}
                  scale={scaleForPage(i())}
                  isVisible={true}
                />
              )}
            </For>
          ) : (
            <div class="placeholder-page">
              <p>No PDF loaded</p>
              <p>Click "Open" to select a file</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
