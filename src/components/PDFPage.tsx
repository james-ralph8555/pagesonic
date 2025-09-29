import { Component, createSignal, onMount, onCleanup, createEffect } from 'solid-js'
import { usePDF } from '@/stores/pdf'

interface PDFPageProps {
  pageNumber: number
  scale: number
  isVisible?: boolean
  fitWidth?: boolean
}

export const PDFPage: Component<PDFPageProps> = (props) => {
  const { getCurrentPage } = usePDF()
  const [canvasRef, setCanvasRef] = createSignal<HTMLCanvasElement | null>(null)
  const [textLayerRef, setTextLayerRef] = createSignal<HTMLDivElement | null>(null)
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let renderTask: any = null
  let textLayerBuilder: any = null


  const renderPage = async () => {
    if (!canvasRef() || !props.isVisible) return

    setIsLoading(true)
    setError(null)

    try {
      const page = await getCurrentPage(props.pageNumber)
      if (!page) {
        setError('Page not found')
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
      if (error.name !== 'RenderingCancelledException' && error.name !== 'RenderingCancelled') {
        setError('Failed to render page')
        console.error('Error rendering page:', error)
      }
    } finally {
      setIsLoading(false)
      if (renderTask) {
        renderTask = null
      }
    }
  }

  // Initial render on mount
  onMount(() => {
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

    if (_vis && _canvas) {
      void renderPage()
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
      {isLoading() && (
        <div class="page-loading">
          <div class="loading-spinner">Loading...</div>
        </div>
      )}
      
      {error() && (
        <div class="page-error">
          {error()}
        </div>
      )}
      
      <canvas
        ref={setCanvasRef}
        class="pdf-page-canvas"
        style={{
          display: isLoading() || error() ? 'none' : 'block',
          'max-width': props.fitWidth ? '100%' : 'none',
          height: 'auto'
        }}
      />
      <div
        ref={setTextLayerRef}
        class="pdf-text-layer"
        style={{
          display: isLoading() || error() ? 'none' : 'block'
        }}
      />
    </div>
  )
}
