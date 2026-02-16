import { Component, createSignal, onMount, onCleanup, createEffect } from 'solid-js'
import { usePDF } from '@/stores/pdf'
import { useTTS } from '@/stores/tts'
import { logPDF } from '@/utils/logger'
import { getRenderScheduler } from '@/utils/render-scheduler'

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
  const [error, setError] = createSignal<string | null>(null)
  const [hasRendered, setHasRendered] = createSignal(false)
  let renderTask: any = null
  let textLayerBuilder: any = null
  let lastRenderedScale = 0
  let lastRequestedScale = -1
  let lastVisible = false
  let currentVersion = 0
  let releaseSlot: (() => void) | null = null

  // Get the centralized render scheduler
  const scheduler = getRenderScheduler()

  const renderPage = async () => {
    const myVersion = ++currentVersion
    if (!canvasRef() || !props.isVisible) {
      if (!props.isVisible) {
        logPDF.debug(`skip render page ${props.pageNumber} visible=false`)
      }
      return
    }

    logPDF.debug(`queue render page ${props.pageNumber} scale ${props.scale}`)
    setError(null)
    lastRequestedScale = props.scale

    try {
      // Acquire a render slot from the scheduler
      const slot = await scheduler.acquireSlot(props.pageNumber, props.scale)
      releaseSlot = slot.release

      // Re-check staleness after acquiring slot
      if (myVersion !== currentVersion || !props.isVisible) {
        logPDF.debug(`abort before start page ${props.pageNumber} (invisible or superseded)`)
        slot.release()
        releaseSlot = null
        return
      }

      logPDF.debug(`start render page ${props.pageNumber}`)
      const page = await getCurrentPage(props.pageNumber)
      if (!page) {
        setError('Page not found')
        console.error('[PDFPage] page not found', props.pageNumber)
        return
      }

      // Check staleness again after async
      if (myVersion !== currentVersion) {
        logPDF.debug(`abort mid-render page ${props.pageNumber} (superseded)`)
        return
      }

      const canvas = canvasRef()!
      const context = canvas.getContext('2d')
      if (!context) return

      const devicePixelRatio = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale: props.scale })

      const cssWidth = viewport.width
      const cssHeight = viewport.height

      const maxPixelRatio = Math.min(devicePixelRatio, 2)
      canvas.width = cssWidth * maxPixelRatio
      canvas.height = cssHeight * maxPixelRatio

      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`

      context.scale(maxPixelRatio, maxPixelRatio)
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

      // Check staleness after render completes
      if (myVersion !== currentVersion) {
        logPDF.debug(`abort post-render page ${props.pageNumber} (superseded)`)
        return
      }

      setHasRendered(true)
      lastRenderedScale = props.scale
      logPDF.debug(`finished render page ${props.pageNumber}`)

      // Render selectable text layer
      const container = textLayerRef()
      if (container && myVersion === currentVersion) {
        container.innerHTML = ''

        const viewerMod: any = await import('pdfjs-dist/web/pdf_viewer')
        const { TextLayerBuilder } = viewerMod
        const actualPixelRatio = Math.min(devicePixelRatio, 2)

        textLayerBuilder = new TextLayerBuilder({
          pdfPage: page,
          onAppend: (div: HTMLDivElement) => {
            div.style.setProperty('--total-scale-factor', String(props.scale * actualPixelRatio))
            container.appendChild(div)
          }
        })
        await textLayerBuilder.render({ viewport })
        try { applyCurrentHighlight() } catch {}
      }
    } catch (err) {
      const error = err as any
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
        logPDF.debug(`canceled render page ${props.pageNumber}`)
      }
    } finally {
      if (renderTask) {
        renderTask = null
      }
      if (releaseSlot) {
        releaseSlot()
        releaseSlot = null
      }
    }
  }

  onMount(() => {
    logPDF.debug(`mount page ${props.pageNumber}`)
    if (props.isVisible) {
      renderPage()
    }
  })

  createEffect(() => {
    void props.pageNumber
    void props.scale
    const _vis = props.isVisible
    const _canvas = canvasRef()
    const becameInvisible = lastVisible && !_vis
    lastVisible = !!_vis

    // If we became invisible, cancel any in-flight work
    if (becameInvisible) {
      currentVersion++
      scheduler.cancelRequest(props.pageNumber)
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

      if (needsFirst || scaleChanged) {
        void renderPage()
      } else if (!renderTask && !sameRequest) {
        void renderPage()
      }
    }
  })

  onCleanup(() => {
    currentVersion++
    scheduler.cancelRequest(props.pageNumber)
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
      const textNode = document.createTextNode(text)
      mark.replaceWith(textNode)
      try { parent?.normalize() } catch {}
    }
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

    clearHighlights()

    const chunkStart = typeof s.currentChunkStart === 'number' ? s.currentChunkStart! : null
    const chunkEnd = typeof s.currentChunkEnd === 'number' ? s.currentChunkEnd! : null
    let startIdx: number
    let endIdx: number
    if (chunkStart !== null && chunkEnd !== null && typeof pageMeta.textStart === 'number' && typeof pageMeta.textEnd === 'number') {
      const pageStart = pageMeta.textStart!
      const pageEnd = pageMeta.textEnd!
      const ovStart = Math.max(pageStart, chunkStart)
      const ovEnd = Math.min(pageEnd, chunkEnd)
      if (ovEnd <= ovStart) return
      startIdx = ovStart - pageStart
      endIdx = ovEnd - pageStart
    } else {
      const pageText = pageMeta.textContent
      const localStart = pageText.indexOf(current)
      if (localStart < 0) return
      startIdx = localStart
      endIdx = localStart + current.length
    }

    const spans = Array.from(layer.querySelectorAll('span')) as HTMLSpanElement[]
    if (spans.length === 0) return

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
        s.textContent = ''
        s.appendChild(frag)
      }

      pos = nodeEnd + 1
      if (i === spans.length - 1) pos = nodeEnd
      if (pos > endIdx) break
    }
  }

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
          display: (error() || !hasRendered()) ? 'none' : 'block',
          'max-width': props.fitWidth ? '100%' : 'none',
          height: 'auto'
        }}
      />
      <div
        ref={setTextLayerRef}
        class="pdf-text-layer"
        style={{
          display: (error() || !hasRendered()) ? 'none' : 'block'
        }}
      />
    </div>
  )
}
