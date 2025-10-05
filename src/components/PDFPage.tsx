import { Component, createSignal, onMount, onCleanup, createEffect } from 'solid-js'
import { usePDF } from '@/stores/pdf'
import { useTTS } from '@/stores/tts'

interface PDFPageProps {
  pageNumber: number
  scale: number
  isVisible?: boolean
  fitWidth?: boolean
}

export const PDFPage: Component<PDFPageProps> = (props) => {
  const { state: pdfState, getCurrentPage } = usePDF()
  const { state: ttsState } = useTTS()
  const [canvasRef, setCanvasRef] = createSignal<HTMLCanvasElement | null>(null)
  const [textLayerRef, setTextLayerRef] = createSignal<HTMLDivElement | null>(null)
  // Removed unused isLoading signal; rendering is driven by hasRendered/error
  const [error, setError] = createSignal<string | null>(null)
  const [hasRendered, setHasRendered] = createSignal(false)
  let renderTask: any = null
  let textLayerBuilder: any = null
  let lastRenderedScale = 0
  let lastRequestedScale = -1
  let lastVisible = false
  let requestVersion = 0

  // Simple global concurrency limiter across page renders to reduce jank
  // and avoid large bursts that can snap scroll position.
  const MAX_CONCURRENT = 2
  const waiters: (() => void)[] = (globalThis as any).__pdfRenderWaiters || ((globalThis as any).__pdfRenderWaiters = [])
  const inflightRef: { count: number } = (globalThis as any).__pdfRenderInflight || ((globalThis as any).__pdfRenderInflight = { count: 0 })
  const acquire = async () => {
    if (inflightRef.count >= MAX_CONCURRENT) {
      await new Promise<void>(resolve => waiters.push(resolve))
    }
    inflightRef.count++
  }
  const release = () => {
    inflightRef.count = Math.max(0, inflightRef.count - 1)
    const next = waiters.shift()
    if (next) next()
  }


  const renderPage = async () => {
    const myVersion = ++requestVersion
    if (!canvasRef() || !props.isVisible) {
      if (!props.isVisible) {
        console.log('[PDFPage] skip render page', props.pageNumber, 'visible=false')
      }
      return
    }

    console.info('[PDFPage] queue render page', props.pageNumber, 'scale', props.scale)
    setError(null)
    lastRequestedScale = props.scale

    try {
      await acquire()
      // Re-check visibility and staleness after acquiring a slot
      if (myVersion !== requestVersion || !props.isVisible) {
        console.log('[PDFPage] abort before start', props.pageNumber, '(invisible or superseded)')
        return
      }
      console.info('[PDFPage] start render page', props.pageNumber)
      const page = await getCurrentPage(props.pageNumber)
      if (!page) {
        setError('Page not found')
        console.error('[PDFPage] page not found', props.pageNumber)
        return
      }

      const canvas = canvasRef()!
      const context = canvas.getContext('2d')
      if (!context) return

      // Get device pixel ratio for high DPI rendering
      const devicePixelRatio = window.devicePixelRatio || 1
      
      // Create viewport with normal scale for responsive layout
      const viewport = page.getViewport({ scale: props.scale })

      // Calculate CSS dimensions (responsive)
      const cssWidth = viewport.width
      const cssHeight = viewport.height
      
      // Set canvas internal resolution to device pixel ratio for crisp rendering
      // but cap it to avoid excessive memory usage on very high DPI displays
      const maxPixelRatio = Math.min(devicePixelRatio, 2) // Cap at 2x for performance
      canvas.width = cssWidth * maxPixelRatio
      canvas.height = cssHeight * maxPixelRatio
      
      // Set CSS dimensions to maintain responsive layout
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`

      // Scale context to match the internal resolution
      context.scale(maxPixelRatio, maxPixelRatio)

      // Clear canvas before rendering (use CSS dimensions)
      context.clearRect(0, 0, cssWidth, cssHeight)

      // Cancel any existing render task
      if (renderTask) {
        renderTask.cancel()
        renderTask = null
      }
      if (textLayerBuilder && typeof textLayerBuilder.cancel === 'function') {
        try { textLayerBuilder.cancel() } catch {}
        textLayerBuilder = null
      }

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
        enableWebGL: false,
        renderInteractiveForms: false
      }

      renderTask = page.render(renderContext)
      await renderTask.promise
      setHasRendered(true)
      lastRenderedScale = props.scale
      console.info('[PDFPage] finished render page', props.pageNumber)

      // Render selectable text layer on top of the canvas using TextLayerBuilder
      const container = textLayerRef()
      if (container) {
        container.innerHTML = ''

        const viewerMod: any = await import('pdfjs-dist/web/pdf_viewer')
        const { TextLayerBuilder } = viewerMod
        // Calculate the actual pixel ratio used for rendering
        const devicePixelRatio = window.devicePixelRatio || 1
        const actualPixelRatio = Math.min(devicePixelRatio, 2)
        
        textLayerBuilder = new TextLayerBuilder({
          pdfPage: page,
          onAppend: (div: HTMLDivElement) => {
            // Important: PDF.js text layer relies on CSS var --total-scale-factor
            // to position/size its absolutely positioned text nodes. Keep it
            // in sync with the viewport scale so it aligns with the canvas.
            // Use the actual pixel ratio for proper text layer alignment.
            div.style.setProperty('--total-scale-factor', String(props.scale * actualPixelRatio))
            container.appendChild(div)
          }
        })
        // Use the same viewport as the canvas to keep perfect alignment
        await textLayerBuilder.render({ viewport })
        // Try applying any active highlight after layer renders
        try { applyCurrentHighlight() } catch {}
      }
    } catch (err) {
      const error = err as any
      // Ignore benign cancellations that occur when visibility flips or re-render happens
      const name = (error && (error.name || error.message)) || ''
      const isCancel = (
        name === 'RenderingCancelledException' ||
        name === 'RenderingCancelled' ||
        name === 'AbortException' ||
        (typeof error?.message === 'string' && /cancel/i.test(error.message))
      )
      if (!isCancel) {
        setError('Failed to render page')
        console.error('Error rendering page:', error)
      }
      if (isCancel) {
        console.log('[PDFPage] canceled render page', props.pageNumber)
      }
    } finally {
      if (renderTask) {
        renderTask = null
      }
      release()
    }
  }

  // Initial render on mount
  onMount(() => {
    console.info('[PDFPage] mount page', props.pageNumber)
    if (props.isVisible) {
      renderPage()
    }
  })

  // Reactive updates when relevant props/signals change
  createEffect(() => {
    // Explicitly read reactive sources to track dependencies
    // Touch reactive props to establish dependencies without unused locals
    void props.pageNumber
    void props.scale
    const _vis = props.isVisible
    const _canvas = canvasRef()
    const becameInvisible = lastVisible && !_vis
    lastVisible = !!_vis

    // If we became invisible, cancel any in-flight work to free the lane
    if (becameInvisible) {
      // Invalidate pending work
      requestVersion++
      if (renderTask) {
        try { renderTask.cancel() } catch {}
        renderTask = null
      }
      if (textLayerBuilder && typeof textLayerBuilder.cancel === 'function') {
        try { textLayerBuilder.cancel() } catch {}
      }
      return
    }

    if (_vis && _canvas) {
      const EPS = 1e-3
      const needsFirst = !hasRendered()
      const scaleChanged = Math.abs((props.scale || 0) - (lastRenderedScale || 0)) > EPS
      const sameRequest = Math.abs((props.scale || 0) - (lastRequestedScale || 0)) <= EPS
      // Avoid duplicate queueing when nothing relevant changed
      if (needsFirst || scaleChanged) {
        void renderPage()
      } else if (!renderTask && !sameRequest) {
        void renderPage()
      }
    }
  })

  onCleanup(() => {
    if (renderTask) {
      renderTask.cancel()
    }
    if (textLayerBuilder && typeof textLayerBuilder.cancel === 'function') {
      try { textLayerBuilder.cancel() } catch {}
    }
  })

  // --- Highlight handling ---
  const clearHighlights = () => {
    const container = textLayerRef()
    if (!container) return
    const layer = (container.querySelector('.textLayer') as HTMLElement) || container
    const marks = Array.from(layer.querySelectorAll('.tts-highlight')) as HTMLElement[]
    if (marks.length === 0) return
    for (const mark of marks) {
      const parent = mark.parentNode as HTMLElement | null
      const text = mark.textContent || ''
      // Replace the highlight span with a text node
      const textNode = document.createTextNode(text)
      mark.replaceWith(textNode)
      // Normalize parent to merge adjacent text nodes
      try { parent?.normalize() } catch {}
    }
    // Also remove any empty spans accidentally created
    const spans = Array.from(layer.querySelectorAll('span')) as HTMLSpanElement[]
    for (const s of spans) {
      if (s.childNodes.length === 0) s.remove()
    }
  }

  const applyCurrentHighlight = () => {
    const s = ttsState()
    const current = (s.currentChunkText || '').trim()
    if (!current) { clearHighlights(); return }
    const container = textLayerRef()
    if (!container) return
    const layer = (container.querySelector('.textLayer') as HTMLElement) || container
    const pageMeta = pdfState().pages[props.pageNumber - 1]
    if (!pageMeta || !pageMeta.textContent) { clearHighlights(); return }

    // First, clear previous highlights on this page
    clearHighlights()
    
    // Determine intersection of current chunk range with this page's range
    const chunkStart = typeof s.currentChunkStart === 'number' ? s.currentChunkStart! : null
    const chunkEnd = typeof s.currentChunkEnd === 'number' ? s.currentChunkEnd! : null
    let startIdx: number
    let endIdx: number
    if (chunkStart !== null && chunkEnd !== null && typeof pageMeta.textStart === 'number' && typeof pageMeta.textEnd === 'number') {
      const pageStart = pageMeta.textStart!
      const pageEnd = pageMeta.textEnd!
      const ovStart = Math.max(pageStart, chunkStart)
      const ovEnd = Math.min(pageEnd, chunkEnd)
      if (ovEnd <= ovStart) return // no overlap on this page
      // Convert to page-local indices
      startIdx = ovStart - pageStart
      endIdx = ovEnd - pageStart
    } else {
      // Fallback: try to find the full chunk within this page's text content
      const pageText = pageMeta.textContent
      const localStart = pageText.indexOf(current)
      if (localStart < 0) return
      startIdx = localStart
      endIdx = localStart + current.length
    }

    const spans = Array.from(layer.querySelectorAll('span')) as HTMLSpanElement[]
    if (spans.length === 0) return

    // Walk spans and compute combined positions with a single space between nodes,
    // matching the construction in pdf.ts (items.join(' ')).
    let pos = 0
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i]
      const text = s.textContent || ''
      const nodeStart = pos
      const nodeEnd = nodeStart + text.length

      const hlStart = Math.max(0, startIdx - nodeStart)
      const hlEnd = Math.min(text.length, endIdx - nodeStart)
      const hasOverlap = hlEnd > hlStart
      if (hasOverlap) {
        // Split into before/mid/after and wrap mid with highlight span
        const before = text.slice(0, hlStart)
        const mid = text.slice(hlStart, hlEnd)
        const after = text.slice(hlEnd)
        const frag = document.createDocumentFragment()
        if (before) frag.appendChild(document.createTextNode(before))
        if (mid) {
          const mark = document.createElement('span')
          mark.className = 'tts-highlight'
          mark.textContent = mid
          frag.appendChild(mark)
        }
        if (after) frag.appendChild(document.createTextNode(after))
        // Replace span contents
        s.textContent = ''
        s.appendChild(frag)
      }

      // Advance pos, adding a space between nodes (except last) to mirror join(' ')
      pos = nodeEnd + 1
      if (i === spans.length - 1) pos = nodeEnd
      // Early exit if we've passed the end
      if (pos > endIdx) break
    }
  }

  // Re-apply highlight when TTS chunk changes or after render completes
  createEffect(() => {
    void ttsState().currentChunkText
    if (props.isVisible && hasRendered()) {
      try { applyCurrentHighlight() } catch {}
    }
  })

  return (
    <div class="pdf-page-container" data-page={props.pageNumber}>
      
      {error() && (
        <div class="page-error">
          {error()}
        </div>
      )}

      {(() => {
        const meta = pdfState().pages[props.pageNumber - 1]
        if (!meta) return null
        const w = Math.max(1, Math.round(meta.width * props.scale))
        const h = Math.max(1, Math.round(meta.height * props.scale))
        // Show placeholder only until the first successful render
        const showPlaceholder = !hasRendered()
        return (
          <div
            class="pdf-page-placeholder"
            style={{
              display: showPlaceholder ? 'block' : 'none',
              width: `${w}px`,
              height: `${h}px`
            }}
          />
        )
      })()}
      
      <canvas
        ref={setCanvasRef}
        class="pdf-page-canvas"
        style={{
          // Keep canvas visible once rendered to avoid layout thrash
          display: (error() || !hasRendered()) ? 'none' : 'block',
          'max-width': props.fitWidth ? '100%' : 'none',
          height: 'auto'
          // Note: width and height will be set programmatically for DPI scaling
        }}
      />
      <div
        ref={setTextLayerRef}
        class="pdf-text-layer"
        style={{
          // Mirror canvas visibility
          display: (error() || !hasRendered()) ? 'none' : 'block'
        }}
      />
    </div>
  )
}
