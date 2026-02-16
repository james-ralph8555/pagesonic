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
 *
 * Enhanced with deterministic cancellation (P0-RDR-006):
 * - RenderTaskManager provides explicit state tracking per page
 * - Cancellation is explicit and validates at async boundaries
 *
 * Instrumented for telemetry (P0-PFV-002):
 * - Emits queue_add, queue_process events for performance monitoring
 */

import { logPDF } from './logger'
import { PressureMonitor } from './pressure-monitor'
import { RenderTaskManager, RenderToken, getRenderTaskManager, resetRenderTaskManager } from './render-cancellation'
import { useTelemetry } from '@/stores/telemetry'

export type RenderPriority = 'visible' | 'nearby' | 'offscreen'

export interface QueuedRender {
  pageNumber: number
  scale: number
  priority: RenderPriority
  token: RenderToken
  resolve: (token: RenderToken) => void
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
  private visiblePages: Set<number> = new Set()
  private totalPages = 0
  private pressureUnsubscribe: (() => void) | null = null
  private taskManager: RenderTaskManager
  private telemetry = useTelemetry()

  constructor(config: RenderSchedulerConfig = {}) {
    this.adaptive = config.adaptive ?? true
    this.nearbyRadius = config.nearbyRadius ?? 10
    this.taskManager = getRenderTaskManager()

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
        logPDF.info('initial adaptive concurrency set to', this.maxConcurrent)
      }
    }

    logPDF.info('initialized', { maxConcurrent: this.maxConcurrent, adaptive: this.adaptive })
  }

  private adjustConcurrency(pressure: 'low' | 'medium' | 'high'): void {
    const oldMax = this.maxConcurrent
    const recommended = PressureMonitor.getRecommendedConcurrency()

    if (recommended !== this.maxConcurrent) {
      this.maxConcurrent = recommended
      logPDF.info('adjusted concurrency', { from: oldMax, to: this.maxConcurrent, pressure })
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
        logPDF.debug(`scheduler: page ${page} priority -> ${newPriority}`)
      }
    }

    this.processQueue()
  }

  /**
   * Acquire a render slot for a page.
   * Returns a RenderToken that must be validated at each async boundary.
   * Resolves when it's this page's turn to render.
   *
   * The token is managed by RenderTaskManager for deterministic cancellation.
   */
  async acquireSlot(pageNumber: number, scale: number): Promise<{ token: RenderToken; release: () => void }> {
    // Begin a new render attempt (cancels any existing render for this page)
    const token = this.taskManager.beginRender(pageNumber, scale)

    const priority = this.getPagePriority(pageNumber)

    // Transition to queued state
    if (!this.taskManager.transitionToQueued(token)) {
      // Token was already cancelled or is stale
      return Promise.reject(new Error('Render cancelled during queue'))
    }

    // Create a promise that resolves when we get a slot
    return new Promise<{ token: RenderToken; release: () => void }>((resolve, reject) => {
      const render: QueuedRender = {
        pageNumber,
        scale,
        priority,
        token,
        resolve: (resolvedToken: RenderToken) => resolve({
          token: resolvedToken,
          release: () => this.releaseSlot(pageNumber),
        }),
        reject,
      }

      this.queue.set(pageNumber, render)
      this.telemetry.emit('render', 'queue_add', undefined, {
        pageNumber,
        priority,
        queueSize: this.queue.size
      })
      logPDF.debug(`scheduler: queue page ${pageNumber} priority ${priority} token #${token.id}`)
      this.processQueue()
    })
  }

  /**
   * Cancel a render for a page.
   * This cancels both queued and in-flight renders.
   * Returns the cancelled token ID, or null if no active render.
   */
  cancelRender(pageNumber: number): number | null {
    // Cancel via task manager
    const tokenId = this.taskManager.cancelRender(pageNumber)

    // Also remove from queue if present
    const queued = this.queue.get(pageNumber)
    if (queued) {
      this.queue.delete(pageNumber)
      queued.reject(new Error('Render cancelled'))
      logPDF.debug(`scheduler: cancelled queued page ${pageNumber}`)
    }

    return tokenId
  }

  /**
   * Validate that a token is still active.
   * Use this at async boundaries before proceeding with render work.
   */
  isTokenActive(token: RenderToken): boolean {
    return this.taskManager.isActive(token)
  }

  /**
   * Check if painting is allowed for a token.
   * This is the final gate before committing canvas content.
   */
  canPaint(token: RenderToken): boolean {
    return this.taskManager.canPaint(token)
  }

  /**
   * Mark a render as completed.
   */
  completeRender(token: RenderToken): boolean {
    return this.taskManager.completeRender(token)
  }

  /**
   * Get the task manager for direct token access.
   */
  getTaskManager(): RenderTaskManager {
    return this.taskManager
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
    tokenStats: ReturnType<RenderTaskManager['getStats']>
  } {
    return {
      queued: this.queue.size,
      inflight: this.inflight.size,
      maxConcurrent: this.maxConcurrent,
      baselineConcurrency: this.baselineConcurrency,
      adaptive: this.adaptive,
      visiblePages: Array.from(this.visiblePages).sort((a, b) => a - b),
      pressureState: this.adaptive ? PressureMonitor.getPressureState() : null,
      tokenStats: this.taskManager.getStats(),
    }
  }

  /**
   * Clear all pending requests and reset state.
   */
  clear(): void {
    const clearedCount = this.queue.size

    // Reject all pending
    for (const render of this.queue.values()) {
      render.reject(new Error('Scheduler cleared'))
    }
    this.queue.clear()
    this.inflight.clear()
    this.visiblePages.clear()
    this.totalPages = 0

    // Clear task manager
    this.taskManager.clear()

    if (this.pressureUnsubscribe) {
      this.pressureUnsubscribe()
      this.pressureUnsubscribe = null
    }

    if (clearedCount > 0) {
      this.telemetry.emit('render', 'queue_clear', undefined, {
        clearedCount
      })
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

      // Check if token is still valid before starting
      if (!this.taskManager.transitionToRendering(next.token)) {
        logPDF.debug(`scheduler: skipped page ${next.pageNumber} token #${next.token.id} (cancelled/stale)`)
        continue
      }

      this.inflight.add(next.pageNumber)
      this.telemetry.emit('render', 'queue_process', undefined, {
        pageNumber: next.pageNumber,
        priority: next.priority,
        queueSize: this.queue.size,
        inflightCount: this.inflight.size
      })
      logPDF.debug(`scheduler: starting page ${next.pageNumber} token #${next.token.id}`)
      next.resolve(next.token)
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
  resetRenderTaskManager()
}
