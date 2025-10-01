import { Component, createSignal, onMount, onCleanup, For, createEffect } from 'solid-js'
import { usePDF } from '@/stores/pdf'
import { useTTS } from '@/stores/tts'
import { PDFPage } from './PDFPage'
import { GlassDropdownButton } from './GlassDropdownButton'
import { SelectionToolbar } from './SelectionToolbar'

export const PDFViewer: Component = () => {
  const { state: pdfState, loadPDF, getAllExtractedText } = usePDF()
  const { state: ttsState, speak, pause, resume, models, loadModel, ensureBrowserEngine } = useTTS()
  const [selectedModel, setSelectedModel] = createSignal<string>('Kokoro TTS')

  const [fileInput, setFileInput] = createSignal<HTMLInputElement | null>(null)
  const [viewportW, setViewportW] = createSignal<number>(window.innerWidth)
  const [showRail, setShowRail] = createSignal<boolean>(true)
  let hideTimer: number | undefined
  let scrollRoot: HTMLDivElement | null = null

  // Track which pages are (near) visible to lazily render
  const [visiblePages, setVisiblePages] = createSignal<Set<number>>(new Set([1]))
  let io: IntersectionObserver | null = null
  let lastSeedCenter = 0
  let scrollListenerAttached = false
  // Track IO-visible pages and a scroll-seeded window; recompute union for visibility
  const ioVisible = new Set<number>()
  let seedFirst = 1
  let seedLast = 1
  // Number of pages to eagerly render before/after the viewport center
  const SEED_WINDOW_RADIUS = 10

  const recomputeVisiblePages = () => {
    setVisiblePages(prev => {
      const next = new Set<number>()
      for (let p = seedFirst; p <= seedLast; p++) next.add(p)
      ioVisible.forEach(p => next.add(p))
      if (next.size === 0 && pdfState().pages.length > 0) next.add(1)
      // If equal, return prev to avoid triggering downstream effects
      if (prev.size === next.size) {
        let equal = true
        for (const p of prev) { if (!next.has(p)) { equal = false; break } }
        if (equal) return prev
      }
      console.info('[PDFViewer] visiblePages size ->', next.size, 'pages:', Array.from(next).slice(0, 10), next.size > 10 ? '…' : '')
      return next
    })
  }

  // Zoom controls
  const [zoom, setZoom] = createSignal<number>(1.0) // 1.0 = 100%
  const [fitWidth, setFitWidth] = createSignal<boolean>(false)
  // Track the current (center) page in view
  const [currentPage, setCurrentPage] = createSignal<number>(1)
  const [pageInput, setPageInput] = createSignal<string>('1')
  let pageInputEl: HTMLInputElement | null = null
  // Keep current/total page bubbles visually equal width
  let staticBubbleEl: HTMLDivElement | null = null
  const [pageBubbleWidth, setPageBubbleWidth] = createSignal<number>(0)

  const measurePageBubble = () => {
    if (!staticBubbleEl) return
    const w = staticBubbleEl.offsetWidth || 0
    if (w && w !== pageBubbleWidth()) setPageBubbleWidth(w)
  }

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
    // Measure page bubble width once content mounts
    requestAnimationFrame(measurePageBubble)
    
    // Setup IntersectionObserver to drive page visibility
    const setupIO = () => {
      if (!scrollRoot) return
      if (io) io.disconnect()
      if (!scrollListenerAttached && scrollRoot) {
        scrollRoot.addEventListener('scroll', onScrollRoot, { passive: true })
        scrollListenerAttached = true
        console.info('[PDFViewer] Attached scroll listener to .pdf-scroll')
      }
      console.info('[PDFViewer] Setting up IntersectionObserver')
      io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const pnAttr = entry.target.getAttribute('data-page')
          const pn = pnAttr ? parseInt(pnAttr, 10) : NaN
          if (!Number.isFinite(pn)) continue
          if (entry.isIntersecting) {
            ioVisible.add(pn)
            console.log('[PDFViewer] IO intersect add page', pn)
          } else {
            ioVisible.delete(pn)
            // Keep pruned offscreen pages out of the render set
            console.log('[PDFViewer] IO intersect remove page', pn)
          }
        }
        recomputeVisiblePages()
      }, {
        root: scrollRoot,
        rootMargin: '300px 0px',
        threshold: 0
      })

      // Observe all page containers
      const observeAll = () => {
        if (!io) return
        const nodes = scrollRoot!.querySelectorAll('.pdf-page-container')
        console.info('[PDFViewer] Observing', nodes.length, 'page nodes')
        nodes.forEach(n => io!.observe(n))
      }
      // Wait a tick for DOM to settle
      requestAnimationFrame(() => {
        observeAll()
        // Seed visible pages based on current scroll position rather than page 1
        seedVisibleFromScroll()
      })
    }

    setupIO()
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

  // Re-measure when page count changes (e.g., PDF loaded)
  createEffect(() => {
    // Track dependency
    void pdfState().pages.length
    requestAnimationFrame(measurePageBubble)
  })

  // Seed initial visible pages from current scroll position
  const seedVisibleFromScroll = () => {
    try {
      if (!scrollRoot) return
      const rootRect = scrollRoot.getBoundingClientRect()
      const nodes = Array.from(scrollRoot.querySelectorAll('.pdf-page-container')) as HTMLElement[]
      // Find the first page that intersects the scroll viewport
      let centerPage: number | null = null
      for (const n of nodes) {
        const r = n.getBoundingClientRect()
        const intersects = r.bottom >= rootRect.top && r.top <= rootRect.bottom
        if (intersects) {
          const pnAttr = n.getAttribute('data-page')
          const pn = pnAttr ? parseInt(pnAttr, 10) : NaN
          if (Number.isFinite(pn)) {
            centerPage = pn
            break
          }
        }
      }
      if (!centerPage) {
        // Fallback to first page if nothing intersects (e.g., empty container)
        if (pdfState().pages.length > 0) {
          console.info('[PDFViewer] seed: no intersecting pages; fallback to 1')
          seedFirst = 1
          seedLast = 1
          setCurrentPage(1)
          recomputeVisiblePages()
        }
        return
      }
      if (centerPage === lastSeedCenter) return
      lastSeedCenter = centerPage
      setCurrentPage(centerPage)
      // Include a window around the center page to start rendering nearby
      seedFirst = Math.max(1, centerPage - SEED_WINDOW_RADIUS)
      seedLast = Math.min(pdfState().pages.length, centerPage + SEED_WINDOW_RADIUS)
      console.info('[PDFViewer] seed from scroll: center', centerPage, 'window', seedFirst, ' - ', seedLast)
      recomputeVisiblePages()
    } catch {
      // Non-fatal; IO will fill in
    }
  }

  const onScrollRoot = () => {
    // Throttle via rAF; multiple scroll events collapse naturally
    requestAnimationFrame(() => seedVisibleFromScroll())
  }

  const clampPage = (pn: number) => {
    const total = pdfState().pages.length || 1
    return Math.min(Math.max(1, Math.floor(pn)), total)
  }

  const scrollToPage = (pn: number) => {
    if (!scrollRoot) return
    const target = scrollRoot.querySelector(`.pdf-page-container[data-page="${pn}"]`) as HTMLElement | null
    if (!target) return
    // Compute target scrollTop to center the page within the scrollRoot
    const rootRect = scrollRoot.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const currentScroll = scrollRoot.scrollTop
    const offsetWithinRoot = (targetRect.top - rootRect.top) + currentScroll
    const centerTop = Math.max(0, offsetWithinRoot - (scrollRoot.clientHeight / 2) + (target.clientHeight / 2))
    scrollRoot.scrollTo({ top: centerTop, behavior: 'smooth' })
    setCurrentPage(pn)
  }

  onCleanup(() => {
    window.removeEventListener('resize', onResize)
    document.removeEventListener('mousemove', pokeUI)
    document.removeEventListener('scroll', pokeUI)
    if (hideTimer) window.clearTimeout(hideTimer)
    if (io) io.disconnect()
    if (scrollRoot) scrollRoot.removeEventListener('scroll', onScrollRoot)
    scrollListenerAttached = false
  })

  // Keep the dropdown selection in sync with the actual TTS state
  createEffect(() => {
    const s = ttsState()
    if (s.engine === 'browser') {
      setSelectedModel('Browser TTS')
    } else if (s.model?.name) {
      setSelectedModel(s.model.name)
    }
  })

  // Keep the page input text in sync with currentPage when not editing
  createEffect(() => {
    const cp = currentPage()
    const active = document.activeElement
    if (!pageInputEl || active !== pageInputEl) {
      setPageInput(String(cp))
    }
  })

  createEffect(() => {
    // Recompute when pages change (new document)
    pdfState().pages.length
    pokeUI()
    // Keep page input in sync when document changes
    setPageInput(String(currentPage()))
    // When a new document loads, re-bind IO to new nodes
    if (scrollRoot && io) {
      io.disconnect()
      ioVisible.clear()
      requestAnimationFrame(() => {
        if (!io || !scrollRoot) return
        const nodes = scrollRoot.querySelectorAll('.pdf-page-container')
        nodes.forEach(n => io!.observe(n))
        console.info('[PDFViewer] Rebinding observer to', nodes.length, 'page nodes')
      })
      // Seed visible pages based on current scroll position
      requestAnimationFrame(() => seedVisibleFromScroll())
      // Ensure scroll listener is attached for dynamic seeding
      if (!scrollListenerAttached) {
        scrollRoot.addEventListener('scroll', onScrollRoot, { passive: true })
        scrollListenerAttached = true
        console.info('[PDFViewer] Attached scroll listener to .pdf-scroll (rebinding)')
      }
    }
  })

  return (
    <div class="pdf-viewer">
      <div class={"pdf-top-rail" + (showRail() ? '' : ' hidden')}>
        <input
          ref={setFileInput}
          type="file"
          accept=".pdf"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <GlassDropdownButton
          ariaLabel="Menu"
          title="Menu"
          class="rail-btn"
          align="start"
          selectedValues={['pdf', selectedModel()]}
          errorValues={(() => {
            const errors: string[] = []
            // Add Browser TTS to errors if no voices available and lastError present
            if (
              selectedModel() === 'Browser TTS' &&
              'speechSynthesis' in window &&
              (ttsState().systemVoices || []).length === 0 &&
              !!ttsState().lastError &&
              ttsState().engine !== 'browser'
            ) {
              errors.push('Browser TTS')
            }
            // Add models with WebGPU requirement but no WebGPU support
            models.forEach(m => {
              if (m.requiresWebGPU && !ttsState().isWebGPUSupported && m.name === selectedModel()) {
                errors.push(m.name)
              }
            })
            return errors
          })()}
          icon={(
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          )}
          items={[
            { value: 'open', label: 'Open' },
            { value: 'nav-header', label: 'Navigation', isHeader: true },
            { value: 'pdf', label: 'PDF Viewer' },
            { value: 'settings', label: 'Settings' },
            { value: 'model-header', label: 'Models', isHeader: true },
            { value: 'Browser TTS', label: 'Browser TTS (System)', disabled: !('speechSynthesis' in window) },
            ...models.map(m => ({
              value: m.name,
              label: m.name + (m.requiresWebGPU ? ' (WebGPU)' : ''),
              disabled: !!(m.requiresWebGPU && !ttsState().isWebGPUSupported)
            }))
          ]}
          onSelect={async (v) => {
            if (v === 'open') {
              fileInput()?.click()
            } else if (v === 'pdf' || v === 'settings') {
              window.dispatchEvent(new CustomEvent('app:set-mode', { detail: v as 'pdf' | 'settings' }))
            } else if (v === 'Browser TTS') {
              setSelectedModel(v)
              try {
                await ensureBrowserEngine()
              } catch (e) { /* handled in store */ }
            } else if (v !== 'nav-header' && v !== 'model-header') {
              setSelectedModel(v)
              try {
                await loadModel(v)
              } catch (e) { /* handled in store */ }
            }
          }}
        />
        <div class="rail-meta">
          {pdfState().document
            ? (
              <>
                <span>{pdfState().document?.title || 'Untitled Document'}</span>
                <div class="page-selector" role="status" aria-live="polite">
                  <div
                    class="rail-btn page-bubble"
                    style={{ width: pageBubbleWidth() ? `${pageBubbleWidth()}px` : undefined }}
                    aria-label="Current page"
                  >
                    <input
                      ref={el => (pageInputEl = el)}
                      class="bubble-input"
                      type="text"
                      inputmode="numeric"
                      pattern="[0-9]*"
                      value={pageInput()}
                      onInput={(e) => {
                        // Only allow digits, keep non-empty to avoid uncontrolled state
                        const v = (e.currentTarget.value || '').replace(/[^0-9]/g, '')
                        setPageInput(v || '')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const v = clampPage(parseInt(pageInput() || '0', 10) || 0)
                          setPageInput(String(v))
                          scrollToPage(v)
                          ;(e.currentTarget as HTMLInputElement).blur()
                        } else if (e.key === 'Escape') {
                          setPageInput(String(currentPage()))
                          ;(e.currentTarget as HTMLInputElement).blur()
                        }
                      }}
                      onBlur={() => {
                        const v = clampPage(parseInt(pageInput() || '0', 10) || 0)
                        setPageInput(String(v))
                        if (v !== currentPage()) scrollToPage(v)
                      }}
                      title="Go to page"
                    />
                  </div>
                  <span class="slash">/</span>
                  <div
                    class="rail-btn page-bubble page-bubble--static"
                    ref={el => (staticBubbleEl = el)}
                    aria-label="Total pages"
                    title="Total pages"
                  >
                    <span class="maxpage">{pdfState().pages.length}</span>
                  </div>
                </div>
              </>
            )
            : <span>No PDF loaded</span>
          }
        </div>
      </div>

      <div class="pdf-scroll" ref={el => { scrollRoot = el }}>
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
                  isVisible={visiblePages().has(p.pageNumber)}
                  fitWidth={fitWidth()}
                />
              )}
            </For>
          ) : (
            <div class="liquid-glass-placeholder">
              <div class="liquid-glass-shadow"></div>
              <div class="liquid-glass-content">
                <div class="placeholder-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <line x1="3" y1="6" x2="21" y2="6"/>
                    <line x1="3" y1="12" x2="21" y2="12"/>
                    <line x1="3" y1="18" x2="21" y2="18"/>
                  </svg>
                </div>
                <h2>No PDF loaded</h2>
                <p>Click the menu icon <span class="icon-ref">☰</span> in the top-left corner, then select "Open" to load a PDF file</p>
              </div>
            </div>
          )}
        </div>
        <SelectionToolbar />
        {/* Bottom-right FAB menu */}
        {(() => {
          const [open, setOpen] = createSignal(false)
          let rootEl: HTMLDivElement | undefined
          const close = () => setOpen(false)
          const toggle = () => setOpen(v => !v)
          const onDocClick = (e: MouseEvent) => {
            if (!rootEl) return
            const t = e.target as Node
            if (!rootEl.contains(t)) close()
          }
          const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
          onMount(() => { document.addEventListener('click', onDocClick); document.addEventListener('keydown', onKey) })
          onCleanup(() => { document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey) })

          const zoomLabel = () => {
            if (fitWidth() && pdfState().pages.length > 0) {
              const first = pdfState().pages[0]
              const availableW = Math.max(100, viewportW() - H_PADDING)
              const base = Math.max(0.1, availableW / first.width)
              return `${(base * 100).toFixed(0)}%`
            }
            return `${(zoom() * 100).toFixed(0)}%`
          }

          const canTTS = () => !!pdfState().document && (!!ttsState().model || ('speechSynthesis' in window))
          const isPlaying = () => ttsState().isPlaying
          const isPaused = () => ttsState().isPaused

          return (
            <div ref={el => (rootEl = el!)} class="pdf-fab">
              <button
                type="button"
                class="rail-btn fab-trigger"
                aria-haspopup="menu"
                aria-expanded={open()}
                aria-label="Viewer menu"
                title="Viewer menu"
                onClick={toggle}
              >
                {/* Hamburger icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <line x1="3" y1="12" x2="21" y2="12"/>
                  <line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>
              {open() && (
                <div class="glass-menu align-end from-bottom menu-grid" role="menu">
                  {/* Row 1: −, +, {current%} (click to reset) */}
                  <button
                    class="glass-menu-item"
                    aria-label="Zoom out"
                    title="Zoom out (-)"
                    disabled={zoom() <= 0.25}
                    onClick={() => setZoom(z => Math.max(0.25, +(z - 0.1).toFixed(2)))}
                    style={{ 'grid-column': '1' }}
                  >
                    −
                  </button>
                  <button
                    class="glass-menu-item"
                    aria-label="Zoom in"
                    title="Zoom in (+)"
                    disabled={zoom() >= 4}
                    onClick={() => setZoom(z => Math.min(4, +(z + 0.1).toFixed(2)))}
                    style={{ 'grid-column': '2' }}
                  >
                    +
                  </button>
                  <button
                    class="glass-menu-item zoom-chip"
                    aria-label="Reset zoom"
                    title="Reset to 100%"
                    onClick={() => setZoom(1.0)}
                    style={{ 'grid-column': '3' }}
                  >
                    {zoomLabel()}
                  </button>

                  {/* Divider between rows */}
                  <div class="glass-menu-separator" style={{ 'grid-column': '1 / -1' }} />

                  {/* Row 2: Fit Width (label stays static; color indicates state) */}
                  <button
                    class={"glass-menu-item" + (fitWidth() ? ' active' : '')}
                    aria-pressed={fitWidth()}
                    onClick={() => setFitWidth(v => !v)}
                    title={fitWidth() ? 'Disable fit width (F)' : 'Fit to width (F)'}
                    style={{ 'grid-column': '1 / -1' }}
                  >
                    Fit Width
                  </button>

                  {/* Divider between rows */}
                  <div class="glass-menu-separator" style={{ 'grid-column': '1 / -1' }} />

                  {/* Row 3: Play and Pause on same row */}
                  <button
                    class="glass-menu-item"
                    aria-label={isPlaying() ? 'Resume' : 'Play'}
                    title={isPlaying() ? 'Resume reading' : 'Play reading'}
                    disabled={!canTTS()}
                    onClick={() => {
                      try {
                        if (isPlaying()) {
                          if (isPaused()) {
                            resume()
                          }
                        } else {
                          const text = getAllExtractedText()
                          if (text && text.trim()) void speak(text)
                        }
                      } catch (err) { console.error('TTS error:', err) }
                    }}
                    style={{ 'grid-column': '1 / span 2' }}
                  >
                    {isPlaying() ? 'Resume' : 'Play'}
                  </button>
                  <button
                    class="glass-menu-item"
                    aria-label="Pause"
                    title="Pause reading"
                    disabled={!canTTS() || !isPlaying() || isPaused()}
                    onClick={() => { try { if (isPlaying() && !isPaused()) pause() } catch {} }}
                    style={{ 'grid-column': '3' }}
                  >
                    Pause
                  </button>
                </div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
