/**
 * Render Scheduler Module (P0-RDR-003)
 *
 * Centralized scheduler for PDF page rendering.
 * Single authoritative queue controls page renders with priority-based scheduling.
 *
 * Enhanced with adaptive concurrency (P0-RDR-005):
 * - Adjusts max concurrent renders based on device capabilities and runtime pressure
 * - Reduces concurrency under high pressure to prevent jank
 * - Increases concurrency when system is idle for faster throughput
 */

import { logPDF } from './logger'
import { PressureMonitor } from './pressure-monitor'

export type RenderPriority = 'visible' | 'nearby' | 'offscreen'

export interface QueuedRender {
  pageNumber: number
  scale: number
  priority: RenderPriority
  version: number
  resolve: () => void
  reject: (err: Error) => void
}

export interface RenderSchedulerConfig {
  /** Maximum concurrent renders (default: auto-detected, override for manual control) */
  maxConcurrent?: number
  /** Pages to consider "nearby" around visible pages (default: 10) */
  nearbyRadius?: number
  /** Enable adaptive concurrency based on runtime pressure (default: true) */
  adaptive?: boolean
}

const PRIORITY_ORDER: Record<RenderPriority, number> = {
  visible: 0,
  nearby: 1,
  offscreen: 2,
}

/**
 * Global render scheduler for PDF pages.
 * Provides single authoritative queue for render scheduling.
 */
export class RenderScheduler {
  private queue: Map<number, QueuedRender> = new Map()
  private inflight: Set<number> = new Set()
  private maxConcurrent: number
  private baselineConcurrency: number
  private nearbyRadius: number
  private adaptive: boolean
  private versionCounter = 0
  private visiblePages: Set<number> = new Set()
  private totalPages = 0
  private pressureUnsubscribe: (() => void) | null = null

  constructor(config: RenderSchedulerConfig = {}) {
    this.adaptive = config.adaptive ?? true
    this.nearbyRadius = config.nearbyRadius ?? 10

    if (config.maxConcurrent !== undefined) {
      this.maxConcurrent = config.maxConcurrent
      this.baselineConcurrency = config.maxConcurrent
    } else {
      const caps = PressureMonitor.detectCapabilities()
      this.baselineConcurrency = caps.baselineConcurrency
      this.maxConcurrent = this.baselineConcurrency
    }

    if (this.adaptive) {
      PressureMonitor.start()
      this.pressureUnsubscribe = PressureMonitor.onPressureChange((state) => {
        this.adjustConcurrency(state.pressure)
      })
      const recommended = PressureMonitor.getRecommendedConcurrency()
      if (recommended !== this.maxConcurrent) {
        this.maxConcurrent = recommended
        try { console.info('[RenderScheduler] initial adaptive concurrency set to', this.maxConcurrent) } catch {}
      }
    }

    try { console.info('[RenderScheduler] initialized with maxConcurrent=', this.maxConcurrent, 'adaptive=', this.adaptive) } catch {}
  }

  private adjustConcurrency(pressure: 'low' | 'medium' | 'high'): void {
    const oldMax = this.maxConcurrent
    const recommended = PressureMonitor.getRecommendedConcurrency()

    if (recommended !== this.maxConcurrent) {
      this.maxConcurrent = recommended
      try { console.info('[RenderScheduler] adjusted concurrency', oldMax, '->', this.maxConcurrent, '(pressure:', pressure + ')') } catch {}
      this.processQueue()
    }
  }

  /**
   * Update visibility state from the viewer.
   * This drives priority updates for queued renders.
   */
  updateVisibility(
    visiblePages: Set<number>,
    totalPages: number
  ): void {
    this.visiblePages = new Set(visiblePages)
    this.totalPages = totalPages

    // Recompute nearby set
    const nearby = this.computeNearbyPages()

    // Update priorities for queued renders
    for (const [page, render] of this.queue) {
      const newPriority: RenderPriority = visiblePages.has(page)
        ? 'visible'
        : nearby.has(page)
          ? 'nearby'
          : 'offscreen'

      if (newPriority !== render.priority) {
        render.priority = newPriority
        render.version = ++this.versionCounter
        logPDF.debug(`scheduler: page ${page} priority -> ${newPriority}`)
      }
    }

    this.processQueue()
  }

  /**
   * Acquire a render slot for a page.
   * Returns a version number for staleness detection.
   * Resolves when it's this page's turn to render.
   */
  async acquireSlot(pageNumber: number, scale: number): Promise<{ version: number; release: () => void }> {
    const priority = this.getPagePriority(pageNumber)
    const version = ++this.versionCounter

    // Create a promise that resolves when we get a slot
    return new Promise<{ version: number; release: () => void }>((resolve) => {
      const render: QueuedRender = {
        pageNumber,
        scale,
        priority,
        version,
        resolve: () => resolve({
          version,
          release: () => this.releaseSlot(pageNumber),
        }),
        reject: () => {}, // Not used in normal flow
      }

      this.queue.set(pageNumber, render)
      logPDF.debug(`scheduler: queue page ${pageNumber} priority ${priority}`)
      this.processQueue()
    })
  }

  /**
   * Cancel a queued render request.
   * Returns true if the request was cancelled, false if already rendering.
   */
  cancelRequest(pageNumber: number): boolean {
    const render = this.queue.get(pageNumber)
    if (render) {
      this.queue.delete(pageNumber)
      logPDF.debug(`scheduler: cancelled queued page ${pageNumber}`)
      return true
    }
    return false
  }

  /**
   * Get the current priority for a page.
   */
  getPagePriority(pageNumber: number): RenderPriority {
    if (this.visiblePages.has(pageNumber)) {
      return 'visible'
    }
    const nearby = this.computeNearbyPages()
    if (nearby.has(pageNumber)) {
      return 'nearby'
    }
    return 'offscreen'
  }

  /**
   * Get scheduler status for debugging.
   */
  getStatus(): {
    queued: number
    inflight: number
    maxConcurrent: number
    baselineConcurrency: number
    adaptive: boolean
    visiblePages: number[]
    pressureState: ReturnType<typeof PressureMonitor.getPressureState> | null
  } {
    return {
      queued: this.queue.size,
      inflight: this.inflight.size,
      maxConcurrent: this.maxConcurrent,
      baselineConcurrency: this.baselineConcurrency,
      adaptive: this.adaptive,
      visiblePages: Array.from(this.visiblePages).sort((a, b) => a - b),
      pressureState: this.adaptive ? PressureMonitor.getPressureState() : null,
    }
  }

  /**
   * Clear all pending requests and reset state.
   */
  clear(): void {
    // Reject all pending
    for (const render of this.queue.values()) {
      render.reject(new Error('Scheduler cleared'))
    }
    this.queue.clear()
    this.inflight.clear()
    this.visiblePages.clear()
    this.totalPages = 0
    this.versionCounter++

    if (this.pressureUnsubscribe) {
      this.pressureUnsubscribe()
      this.pressureUnsubscribe = null
    }

    logPDF.debug('scheduler: cleared')
  }

  /**
   * Internal: compute nearby pages set.
   */
  private computeNearbyPages(): Set<number> {
    const nearby = new Set<number>()
    for (const page of this.visiblePages) {
      for (
        let i = Math.max(1, page - this.nearbyRadius);
        i <= Math.min(this.totalPages, page + this.nearbyRadius);
        i++
      ) {
        if (!this.visiblePages.has(i)) {
          nearby.add(i)
        }
      }
    }
    return nearby
  }

  /**
   * Internal: release a render slot.
   */
  private releaseSlot(pageNumber: number): void {
    this.inflight.delete(pageNumber)
    logPDF.debug(`scheduler: released page ${pageNumber}`)
    this.processQueue()
  }

  /**
   * Internal: process the queue to start ready renders.
   */
  private processQueue(): void {
    while (this.inflight.size < this.maxConcurrent) {
      const next = this.getNextRender()
      if (!next) break

      this.queue.delete(next.pageNumber)
      this.inflight.add(next.pageNumber)
      logPDF.debug(`scheduler: starting page ${next.pageNumber}`)
      next.resolve()
    }
  }

  /**
   * Internal: get next render by priority.
   */
  private getNextRender(): QueuedRender | undefined {
    let best: QueuedRender | undefined

    for (const render of this.queue.values()) {
      // Skip if this page is already in flight
      if (this.inflight.has(render.pageNumber)) continue

      if (!best) {
        best = render
        continue
      }

      // Compare priorities
      const priorityDiff = PRIORITY_ORDER[render.priority] - PRIORITY_ORDER[best.priority]
      if (priorityDiff < 0) {
        // Higher priority (lower number)
        best = render
      } else if (priorityDiff === 0 && render.pageNumber < best.pageNumber) {
        // Same priority, prefer lower page number (reading order)
        best = render
      }
    }

    return best
  }
}

// Singleton instance
let globalScheduler: RenderScheduler | null = null

export function getRenderScheduler(): RenderScheduler {
  if (!globalScheduler) {
    globalScheduler = new RenderScheduler()
  }
  return globalScheduler
}

export function resetRenderScheduler(): void {
  if (globalScheduler) {
    globalScheduler.clear()
  }
  globalScheduler = null
}
