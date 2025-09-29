import { Component, createSignal, onMount, onCleanup, For, createEffect } from 'solid-js'
import { usePDF } from '@/stores/pdf'
import { useTTS } from '@/stores/tts'
import { PDFPage } from './PDFPage'
import { SelectionToolbar } from './SelectionToolbar'

export const PDFViewer: Component = () => {
  const { state: pdfState, loadPDF, getAllExtractedText } = usePDF()
  const { state: ttsState, speak, stop, models, loadModel } = useTTS()
  const [selectedModel, setSelectedModel] = createSignal<string>('Kokoro TTS')

  const [fileInput, setFileInput] = createSignal<HTMLInputElement | null>(null)
  const [viewportW, setViewportW] = createSignal<number>(window.innerWidth)
  const [showRail, setShowRail] = createSignal<boolean>(true)
  let hideTimer: number | undefined

  // Zoom controls
  const [zoom, setZoom] = createSignal<number>(1.0) // 1.0 = 100%
  const [fitWidth, setFitWidth] = createSignal<boolean>(false)

  const H_PADDING = 16 * 2 // matches .pdf-pages horizontal padding

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
    if (fitWidth()) {
      const availableW = Math.max(100, viewportW() - H_PADDING)
      // In fit-width mode, compute absolute scale from container width only
      // Do not multiply by current zoom to avoid double-scaling and CSS clamping artifacts
      const base = Math.max(0.1, availableW / page.width)
      return base
    }
    // Actual size baseline, zoom multiplies
    return 1 * zoom()
  }

  const onResize = () => {
    setViewportW(window.innerWidth)
  }

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
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTyping = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        (target as HTMLElement).isContentEditable
      )
      if (isTyping) return

      const step = 0.1
      if (e.key === '+' || e.key === '=' ) {
        e.preventDefault()
        setZoom(z => Math.min(4, +(z + step).toFixed(2)))
      } else if (e.key === '-' || e.key === '_' ) {
        e.preventDefault()
        setZoom(z => Math.max(0.25, +(z - step).toFixed(2)))
      } else if (e.key === '0') {
        e.preventDefault()
        setZoom(1.0)
      } else if (e.key.toLowerCase() === 'f') {
        // Do not hijack browser find (Ctrl/Cmd+F) or other modified combos
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
        e.preventDefault()
        setFitWidth(v => !v)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    onCleanup(() => document.removeEventListener('keydown', onKeyDown))
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
            const value = (e.target as HTMLSelectElement).value as 'pdf' | 'settings'
            window.dispatchEvent(new CustomEvent('app:set-mode', { detail: value }))
          }}
        >
          <option value="pdf">PDF Viewer</option>
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
        <div style="display: inline-flex; gap: 6px; align-items: center;">
          <select
            class="rail-select"
            aria-label="Select TTS model"
            value={selectedModel()}
            onChange={(e) => setSelectedModel((e.target as HTMLSelectElement).value)}
          >
            {models.map(m => (
              <option value={m.name}>
                {m.name}{m.requiresWebGPU ? ' (WebGPU)' : ''}
              </option>
            ))}
          </select>
          <button
            class="rail-btn"
            disabled={ttsState().isModelLoading || ttsState().model?.name === selectedModel() || (models.find(m => m.name === selectedModel())?.requiresWebGPU && !ttsState().isWebGPUSupported)}
            title={!ttsState().isWebGPUSupported && models.find(m => m.name === selectedModel())?.requiresWebGPU ? 'WebGPU required' : 'Load TTS model'}
            onClick={async () => {
              try { await loadModel(selectedModel()) } catch (e) { /* handled in store */ }
            }}
          >{ttsState().isModelLoading
              ? 'Loading…'
              : (ttsState().model?.name === selectedModel() ? 'Loaded' : 'Load')}
          </button>
          <span class="rail-meta" title={`WebGPU ${ttsState().isWebGPUSupported ? 'supported' : 'not supported'}`}>
            {ttsState().isWebGPUSupported ? 'WebGPU ✓' : 'WebGPU ×'}
          </span>
        </div>
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
                  fitWidth={fitWidth()}
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
        <SelectionToolbar />
        <div class="pdf-zoom-controls">
          <button
            class="zoom-btn"
            aria-label="Zoom out"
            title="Zoom out (-)"
            onClick={() => setZoom(z => Math.max(0.25, +(z - 0.1).toFixed(2)))}
          >−</button>
          <div class="zoom-display" title="Reset to 100%" onClick={() => setZoom(1.0)}>
            {(() => {
              if (fitWidth() && pdfState().pages.length > 0) {
                const first = pdfState().pages[0]
                const availableW = Math.max(100, viewportW() - H_PADDING)
                const base = Math.max(0.1, availableW / first.width)
                return `${(base * 100).toFixed(0)}%`
              }
              return `${(zoom() * 100).toFixed(0)}%`
            })()}
          </div>
          <button
            class="zoom-btn"
            aria-label="Zoom in"
            title="Zoom in (+)"
            onClick={() => setZoom(z => Math.min(4, +(z + 0.1).toFixed(2)))}
          >+</button>
          <button
            class={"zoom-toggle" + (fitWidth() ? ' active' : '')}
            aria-pressed={fitWidth()}
            title={fitWidth() ? 'Disable fit width (F)' : 'Fit to width (F)'}
            onClick={() => setFitWidth(v => !v)}
          >{fitWidth() ? 'Fit Width ✓' : 'Fit Width'}</button>
          <button
            class="zoom-btn"
            aria-label={ttsState().isPlaying ? 'Pause' : 'Play'}
            title={ttsState().isPlaying ? 'Pause reading' : 'Play reading'}
            disabled={!pdfState().document || (!ttsState().model && !('speechSynthesis' in window))}
            onClick={() => {
              try {
                if (ttsState().isPlaying) {
                  // Toggle pause via SpeechSynthesis if available, otherwise stop
                  if ('speechSynthesis' in window) {
                    if ((window.speechSynthesis as any).paused) {
                      // resume
                      window.speechSynthesis.resume()
                    } else {
                      window.speechSynthesis.pause()
                    }
                  } else {
                    stop()
                  }
                } else {
                  const text = getAllExtractedText()
                  if (text && text.trim()) {
                    void speak(text)
                  }
                }
              } catch (err) {
                console.error('TTS error:', err)
              }
            }}
          >{(() => {
            if (ttsState().isPlaying) {
              if ('speechSynthesis' in window && (window.speechSynthesis as any).paused) return 'Resume'
              return 'Pause'
            }
            return 'Play'
          })()}</button>
        </div>
      </div>
    </div>
  )
}
