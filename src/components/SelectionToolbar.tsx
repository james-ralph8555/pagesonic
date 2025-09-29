import { Component, createSignal, onCleanup, onMount } from 'solid-js'

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

    // Position just above the selection, centered
    const padding = 8
    const top = Math.max(8, rect.top - padding)
    const left = Math.min(
      window.innerWidth - 8,
      Math.max(8, rect.left + rect.width / 2)
    )

    setPos({ top, left })
    setVisible(true)
  }

  const hideOnInput = () => setVisible(false)

  onMount(() => {
    document.addEventListener('selectionchange', updateFromSelection)
    window.addEventListener('resize', updateFromSelection)
    // Hide on scroll to avoid stale positioning; will re-show on next selection
    document.addEventListener('scroll', hideOnInput, { passive: true })
  })

  onCleanup(() => {
    document.removeEventListener('selectionchange', updateFromSelection)
    window.removeEventListener('resize', updateFromSelection)
    document.removeEventListener('scroll', hideOnInput)
  })

  const noop = (label: string) => (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    // Placeholder action
    console.debug(`[SelectionToolbar] ${label} clicked`)
  }

  return (
    <div
      class={"selection-toolbar" + (visible() ? '' : ' hidden')}
      style={{
        top: `${pos().top}px`,
        left: `${pos().left}px`,
      }}
    >
      <button class="icon-btn" aria-label="Highlight" title="Highlight" onMouseDown={noop('highlight')}>
        {/* Highlighter icon */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M3 16.5l4.5 4.5 3-3-4.5-4.5-3 3zm5.6-5.6l4.5 4.5L21 7.5 16.5 3 8.6 10.9zM15 6l3 3"/>
        </svg>
      </button>
      <button class="icon-btn" aria-label="Bookmark" title="Bookmark" onMouseDown={noop('bookmark')}>
        {/* Bookmark icon */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M6 2h12a1 1 0 0 1 1 1v18l-7-4-7 4V3a1 1 0 0 1 1-1z"/>
        </svg>
      </button>
      <button class="icon-btn" aria-label="Speak" title="Speak" onMouseDown={noop('speak')}>
        {/* Speaker icon */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M4 9v6h4l5 4V5L8 9H4z"/>
          <path d="M16 8a5 5 0 0 1 0 8" fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>
      </button>
      <button class="icon-btn" aria-label="Start Speech Here" title="Start Speech Here" onMouseDown={noop('start-speech-here')}>
        {/* Play-circle icon */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.5 6.5l6 3.5-6 3.5v-7z"/>
        </svg>
      </button>
    </div>
  )
}

