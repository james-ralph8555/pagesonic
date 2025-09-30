import { Component, createSignal, onMount, onCleanup, createEffect } from 'solid-js'
import { usePDF } from '@/stores/pdf'

interface PDFPageProps {
  pageNumber: number
  scale: number
  isVisible?: boolean
  fitWidth?: boolean
}

export const PDFPage: Component<PDFPageProps> = (props) => {
  const { state: pdfState, getCurrentPage } = usePDF()
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

      const viewport = page.getViewport({ scale: props.scale })

      canvas.height = viewport.height
      canvas.width = viewport.width

      // Clear canvas before rendering
      context.clearRect(0, 0, canvas.width, canvas.height)

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
        textLayerBuilder = new TextLayerBuilder({
          pdfPage: page,
          onAppend: (div: HTMLDivElement) => {
            // Important: PDF.js text layer relies on CSS var --total-scale-factor
            // to position/size its absolutely positioned text nodes. Keep it
            // in sync with the viewport scale so it aligns with the canvas.
            div.style.setProperty('--total-scale-factor', String(props.scale))
            container.appendChild(div)
          }
        })
        // Use the same viewport as the canvas to keep perfect alignment
        await textLayerBuilder.render({ viewport })
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
