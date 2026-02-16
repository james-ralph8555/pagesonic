/**
 * Visibility Controller Module (P0-RDR-004)
 *
 * Unified controller for page visibility tracking.
 * Consolidates IntersectionObserver and scroll-based seeding into a single authority.
 * No duplicate visibility paths remain - this is the sole source of truth.
 */

import { logPDF } from './logger'

export interface VisibilityControllerConfig {
  /** IntersectionObserver root margin (default: '300px 0px') */
  rootMargin?: string
  /** Pages to render before/after viewport center (default: 10) */
  seedWindowRadius?: number
}

export interface VisibilityState {
  /** All pages that should be rendered (union of IO + seed window) */
  visiblePages: Set<number>
  /** Current center page in viewport, or null if undetermined */
  centerPage: number | null
}

export type VisibilityCallback = (state: VisibilityState) => void

/**
 * Unified visibility controller for PDF page rendering.
 *
 * This is the single authority for determining which pages should be rendered.
 * It combines:
 * 1. IntersectionObserver - tracks actual viewport intersection
 * 2. Scroll-based seeding - proactively renders pages near scroll center
 *
 * The controller merges these sources and emits unified visibility updates.
 */
export class VisibilityController {
  private io: IntersectionObserver | null = null
  private ioVisible: Set<number> = new Set()
  private seedFirst = 1
  private seedLast = 1
  private lastSeedCenter: number | null = null
  private scrollRoot: HTMLElement | null = null
  private totalPages = 0
  private callback: VisibilityCallback | null = null
  private scrollListenerAttached = false
  private rafPending = false

  private readonly rootMargin: string
  private readonly seedWindowRadius: number

  constructor(config: VisibilityControllerConfig = {}) {
    this.rootMargin = config.rootMargin ?? '300px 0px'
    this.seedWindowRadius = config.seedWindowRadius ?? 10
  }

  /**
   * Attach the controller to a scroll container.
   * Sets up IntersectionObserver and scroll listener.
   */
  attach(
    scrollRoot: HTMLElement,
    totalPages: number,
    callback: VisibilityCallback
  ): void {
    this.detach()
    this.scrollRoot = scrollRoot
    this.totalPages = totalPages
    this.callback = callback

    // Setup IntersectionObserver
    this.setupIntersectionObserver()

    // Setup scroll listener
    if (!this.scrollListenerAttached && this.scrollRoot) {
      this.scrollRoot.addEventListener('scroll', this.onScroll, { passive: true })
      this.scrollListenerAttached = true
      logPDF.debug('VisibilityController: attached scroll listener')
    }

    // Initial seeding from current scroll position
    requestAnimationFrame(() => {
      this.seedFromScroll()
      this.observeAllPages()
    })
  }

  /**
   * Detach the controller and cleanup resources.
   */
  detach(): void {
    if (this.io) {
      this.io.disconnect()
      this.io = null
    }
    if (this.scrollRoot && this.scrollListenerAttached) {
      this.scrollRoot.removeEventListener('scroll', this.onScroll)
      this.scrollListenerAttached = false
    }
    this.ioVisible.clear()
    this.seedFirst = 1
    this.seedLast = 1
    this.lastSeedCenter = null
    this.scrollRoot = null
    this.callback = null
    this.rafPending = false
    logPDF.debug('VisibilityController: detached')
  }

  /**
   * Update total page count (e.g., when new document loads).
   */
  setTotalPages(total: number): void {
    this.totalPages = total
    // Re-seed visibility with new page count
    if (this.scrollRoot) {
      this.seedFromScroll()
    }
  }

  /**
   * Rebind observer to new page elements (call when pages change).
   */
  rebind(): void {
    if (!this.io || !this.scrollRoot) return

    this.io.disconnect()
    this.ioVisible.clear()
    requestAnimationFrame(() => {
      this.observeAllPages()
      this.seedFromScroll()
    })
    logPDF.debug('VisibilityController: rebound observer')
  }

  /**
   * Get current visibility state.
   */
  getState(): VisibilityState {
    const visiblePages = this.computeMergedVisibility()
    return {
      visiblePages,
      centerPage: this.lastSeedCenter,
    }
  }

  // --- Private methods ---

  private setupIntersectionObserver(): void {
    if (!this.scrollRoot) return

    this.io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pnAttr = entry.target.getAttribute('data-page')
          const pn = pnAttr ? parseInt(pnAttr, 10) : NaN
          if (!Number.isFinite(pn)) continue

          if (entry.isIntersecting) {
            this.ioVisible.add(pn)
            logPDF.rateLimited('io-add', 100, 'debug', 'IO intersect add page', pn)
          } else {
            this.ioVisible.delete(pn)
            logPDF.rateLimited('io-remove', 100, 'debug', 'IO intersect remove page', pn)
          }
        }
        this.emitUpdate()
      },
      {
        root: this.scrollRoot,
        rootMargin: this.rootMargin,
        threshold: 0,
      }
    )

    logPDF.debug('VisibilityController: setup IntersectionObserver')
  }

  private observeAllPages(): void {
    if (!this.io || !this.scrollRoot) return

    const nodes = this.scrollRoot.querySelectorAll('.pdf-page-container')
    logPDF.debug(`VisibilityController: observing ${nodes.length} page nodes`)
    nodes.forEach((n) => this.io!.observe(n))
  }

  private readonly onScroll = (): void => {
    // Throttle via rAF
    if (this.rafPending) return
    this.rafPending = true
    requestAnimationFrame(() => {
      this.rafPending = false
      this.seedFromScroll()
    })
  }

  private seedFromScroll(): void {
    if (!this.scrollRoot) return

    try {
      const rootRect = this.scrollRoot.getBoundingClientRect()
      const nodes = Array.from(
        this.scrollRoot.querySelectorAll('.pdf-page-container')
      ) as HTMLElement[]

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
        // Fallback to first page if nothing intersects
        if (this.totalPages > 0) {
          logPDF.debug('VisibilityController: no intersecting pages; fallback to 1')
          this.seedFirst = 1
          this.seedLast = 1
          this.lastSeedCenter = 1
          this.emitUpdate()
        }
        return
      }

      // Skip if center hasn't changed
      if (centerPage === this.lastSeedCenter) return

      this.lastSeedCenter = centerPage

      // Include a window around the center page
      this.seedFirst = Math.max(1, centerPage - this.seedWindowRadius)
      this.seedLast = Math.min(this.totalPages, centerPage + this.seedWindowRadius)

      logPDF.debug(
        `VisibilityController: seed from scroll center=${centerPage} window=${this.seedFirst}-${this.seedLast}`
      )

      this.emitUpdate()
    } catch {
      // Non-fatal; IO will fill in
    }
  }

  private computeMergedVisibility(): Set<number> {
    const merged = new Set<number>()

    // Add seed window
    for (let p = this.seedFirst; p <= this.seedLast; p++) {
      merged.add(p)
    }

    // Add IO-visible pages
    this.ioVisible.forEach((p) => merged.add(p))

    // Fallback to page 1 if empty but pages exist
    if (merged.size === 0 && this.totalPages > 0) {
      merged.add(1)
    }

    return merged
  }

  private emitUpdate(): void {
    if (!this.callback) return

    const state = this.getState()
    this.callback(state)
  }
}

// Singleton instance for convenience
let globalController: VisibilityController | null = null

export function getVisibilityController(): VisibilityController {
  if (!globalController) {
    globalController = new VisibilityController()
  }
  return globalController
}

export function resetVisibilityController(): void {
  if (globalController) {
    globalController.detach()
  }
  globalController = null
}
