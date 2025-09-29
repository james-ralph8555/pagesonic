import { Component, createSignal, onCleanup, onMount } from 'solid-js'
import { useTTS } from '@/stores/tts'
import { usePDF } from '@/stores/pdf'

function isInTextLayer(node: Node | null): boolean {
  let el: HTMLElement | null = null
  if (!node) return false
  if (node.nodeType === Node.ELEMENT_NODE) {
    el = node as HTMLElement
  } else if (node.parentElement) {
    el = node.parentElement
  }
  while (el) {
    if (el.classList?.contains('textLayer') || el.classList?.contains('pdf-text-layer')) {
      return true
    }
    el = el.parentElement
  }
  return false
}

export const SelectionToolbar: Component = () => {
  const [visible, setVisible] = createSignal(false)
  const [pos, setPos] = createSignal<{ top: number; left: number }>({ top: 0, left: 0 })
  const [placement, setPlacement] = createSignal<'above' | 'below'>('above')
  let scrollEl: HTMLElement | null = null
  const { speak } = useTTS()
  const { state: pdfState } = usePDF()

  const updateFromSelection = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setVisible(false)
      return
    }

    // Only show for selections inside the PDF text layer
    const anchorOk = isInTextLayer(sel.anchorNode)
    const focusOk = isInTextLayer(sel.focusNode)
    if (!anchorOk && !focusOk) {
      setVisible(false)
      return
    }

    let rect: DOMRect | null = null
    try {
      const range = sel.getRangeAt(0)
      rect = range.getBoundingClientRect()
    } catch {
      rect = null
    }

    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setVisible(false)
      return
    }

    // Decide placement: prefer above, but if near top rail or screen top, place below
    const padding = 8
    const rail = document.querySelector('.pdf-top-rail') as HTMLElement | null
    const railH = rail?.offsetHeight ?? 56
    const spaceAbove = rect.top
    const spaceBelow = window.innerHeight - rect.bottom
    let where: 'above' | 'below' = 'above'
    if (spaceAbove < railH + 16 && spaceBelow > 40) {
      where = 'below'
    } else if (spaceBelow < 16 && spaceAbove > spaceBelow) {
      where = 'above'
    }

    const left = Math.min(
      window.innerWidth - 8,
      Math.max(8, rect.left + rect.width / 2)
    )

    let top: number
    if (where === 'above') {
      top = Math.max(railH + 8, rect.top - padding)
    } else {
      top = Math.min(window.innerHeight - 8, rect.bottom + padding)
    }

    setPlacement(where)
    setPos({ top, left })
    setVisible(true)
  }

  const hideOnInput = () => setVisible(false)

  onMount(() => {
    document.addEventListener('selectionchange', updateFromSelection)
    window.addEventListener('resize', updateFromSelection)
    // Reposition on scroll (including the nested PDF scroll container)
    document.addEventListener('scroll', updateFromSelection, { passive: true })
    scrollEl = document.querySelector('.pdf-scroll') as HTMLElement | null
    if (scrollEl) scrollEl.addEventListener('scroll', updateFromSelection, { passive: true })
    // Also update once after mouseup to catch end-of-drag selection
    const onMouseUp = () => setTimeout(updateFromSelection, 0)
    document.addEventListener('mouseup', onMouseUp)
    
    // Cleanup for mouseup
    onCleanup(() => {
      document.removeEventListener('mouseup', onMouseUp)
    })
  })

  onCleanup(() => {
    document.removeEventListener('selectionchange', updateFromSelection)
    window.removeEventListener('resize', updateFromSelection)
    document.removeEventListener('scroll', updateFromSelection)
    if (scrollEl) scrollEl.removeEventListener('scroll', updateFromSelection)
  })

  // Helpers to get selection text and page context
  const getActiveSelection = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
    try {
      const range = sel.getRangeAt(0)
      const text = sel.toString()
      return { sel, range, text }
    } catch {
      return null
    }
  }

  const findSelectionStartPage = (node: Node): number | null => {
    let el: HTMLElement | null = (node as HTMLElement)?.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : (node.parentElement as HTMLElement | null)
    while (el) {
      if (el.classList?.contains('pdf-page-container')) {
        const pn = el.getAttribute('data-page')
        if (pn) return Number(pn)
      }
      el = el.parentElement
    }
    return null
  }

  const handleSpeakSelection = async (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const active = getActiveSelection()
    const text = active?.text?.trim()
    if (!text) return
    try {
      await speak(text)
    } catch (err) {
      console.error('Speak selection failed:', err)
    }
  }

  const handleStartHere = async (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const active = getActiveSelection()
    const text = active?.text?.trim()
    const range = active?.range
    if (!text || !range) return

    // Determine page number where selection starts
    const startNode = range.startContainer
    const startPage = findSelectionStartPage(startNode)
    if (!startPage) {
      // Fallback to reading only the selection if page not found
      try { await speak(text) } catch (err) { console.error(err) }
      return
    }

    // Build text from selection start to end of document
    const pages = pdfState().pages
    const current = pages[startPage - 1]?.textContent || ''
    let fromIndex = 0
    // Try to locate the selected text within the page text to slice from there
    const idx = current.indexOf(text)
    if (idx >= 0) fromIndex = idx

    const chunks: string[] = []
    chunks.push(current.slice(fromIndex))
    for (let i = startPage; i < pages.length; i++) {
      chunks.push(pages[i].textContent || '')
    }
    const full = chunks.join('\n\n').trim()
    if (!full) return
    try {
      await speak(full)
    } catch (err) {
      console.error('Start speech here failed:', err)
    }
  }

  return (
    <div
      class={"selection-toolbar" + (visible() ? '' : ' hidden') + ` ${placement()}`}
      style={{
        top: `${pos().top}px`,
        left: `${pos().left}px`,
      }}
    >
      <button class="icon-btn" aria-label="Highlight" title="Highlight" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        {/* Highlighter icon */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M3 16.5l4.5 4.5 3-3-4.5-4.5-3 3zm5.6-5.6l4.5 4.5L21 7.5 16.5 3 8.6 10.9zM15 6l3 3"/>
        </svg>
      </button>
      <button class="icon-btn" aria-label="Bookmark" title="Bookmark" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        {/* Bookmark icon */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M6 2h12a1 1 0 0 1 1 1v18l-7-4-7 4V3a1 1 0 0 1 1-1z"/>
        </svg>
      </button>
      <button class="icon-btn" aria-label="Speak" title="Speak" onMouseDown={handleSpeakSelection}>
        {/* Speaker icon */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M4 9v6h4l5 4V5L8 9H4z"/>
          <path d="M16 8a5 5 0 0 1 0 8" fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>
      </button>
      <button class="icon-btn" aria-label="Start Speech Here" title="Start Speech Here" onMouseDown={handleStartHere}>
        {/* Play-circle icon */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.5 6.5l6 3.5-6 3.5v-7z"/>
        </svg>
      </button>
    </div>
  )
}
