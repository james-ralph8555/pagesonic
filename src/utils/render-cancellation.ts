/**
 * Render Cancellation State Machine (P0-RDR-006)
 *
 * Provides deterministic cancel/replace behavior for PDFPage render tasks.
 * Ensures no stale page paint after rapid zoom/scroll by tracking explicit
 * render states and validating tokens at each async boundary.
 *
 * States:
 * - idle: No active render, can start new render
 * - queued: Waiting for scheduler slot
 * - rendering: Currently rendering page content
 * - completed: Render finished successfully
 * - cancelled: Render was cancelled, should not paint
 */

import { logPDF } from './logger'

export type RenderState = 'idle' | 'queued' | 'rendering' | 'completed' | 'cancelled'

/**
 * Unique token for each render attempt.
 * Used to validate that async operations should continue.
 */
export interface RenderToken {
  /** Unique identifier for this render attempt */
  readonly id: number
  /** Page number being rendered */
  readonly pageNumber: number
  /** Scale at time of request */
  readonly scale: number
  /** Current state of this token */
  state: RenderState
  /** AbortController for cancellation signaling */
  readonly abortController: AbortController
  /** Time when this token was created */
  readonly createdAt: number
}

/**
 * Manages render cancellation state per page.
 * Only one active render per page at a time - new requests cancel old ones.
 */
export class RenderTaskManager {
  private tokens: Map<number, RenderToken> = new Map()
  private idCounter = 0

  /**
   * Begin a new render attempt for a page.
   * Cancels any existing render for this page.
   * Returns the new token to use for this render.
   */
  beginRender(pageNumber: number, scale: number): RenderToken {
    // Cancel any existing render for this page
    this.cancelRender(pageNumber)

    const token: RenderToken = {
      id: ++this.idCounter,
      pageNumber,
      scale,
      state: 'idle',
      abortController: new AbortController(),
      createdAt: performance.now(),
    }

    this.tokens.set(pageNumber, token)
    logPDF.debug(`token: created #${token.id} for page ${pageNumber} scale ${scale.toFixed(2)}`)
    return token
  }

  /**
   * Transition token to queued state.
   * Returns false if token is already cancelled or stale.
   */
  transitionToQueued(token: RenderToken): boolean {
    if (token.state === 'cancelled') {
      logPDF.debug(`token: #${token.id} already cancelled, cannot queue`)
      return false
    }

    const current = this.tokens.get(token.pageNumber)
    if (current !== token) {
      logPDF.debug(`token: #${token.id} is stale (current is #${current?.id}), cannot queue`)
      token.state = 'cancelled'
      return false
    }

    token.state = 'queued'
    logPDF.debug(`token: #${token.id} -> queued`)
    return true
  }

  /**
   * Transition token to rendering state.
   * Returns false if token is cancelled, stale, or abort signaled.
   */
  transitionToRendering(token: RenderToken): boolean {
    if (token.state === 'cancelled') {
      logPDF.debug(`token: #${token.id} already cancelled, cannot render`)
      return false
    }

    if (token.abortController.signal.aborted) {
      logPDF.debug(`token: #${token.id} abort signaled, cannot render`)
      token.state = 'cancelled'
      return false
    }

    const current = this.tokens.get(token.pageNumber)
    if (current !== token) {
      logPDF.debug(`token: #${token.id} is stale (current is #${current?.id}), cannot render`)
      token.state = 'cancelled'
      return false
    }

    token.state = 'rendering'
    logPDF.debug(`token: #${token.id} -> rendering`)
    return true
  }

  /**
   * Mark a render as completed.
   * Returns false if token is stale (different token is now current).
   */
  completeRender(token: RenderToken): boolean {
    const current = this.tokens.get(token.pageNumber)

    if (current !== token) {
      logPDF.debug(`token: #${token.id} is stale (current is #${current?.id}), not marking complete`)
      return false
    }

    if (token.state === 'cancelled') {
      logPDF.debug(`token: #${token.id} was cancelled, not marking complete`)
      return false
    }

    token.state = 'completed'
    logPDF.debug(`token: #${token.id} -> completed`)
    return true
  }

  /**
   * Cancel a render for a specific page.
   * Returns the cancelled token ID, or null if no active render.
   */
  cancelRender(pageNumber: number): number | null {
    const token = this.tokens.get(pageNumber)
    if (!token) return null

    if (token.state !== 'cancelled') {
      logPDF.debug(`token: #${token.id} -> cancelled (page ${pageNumber})`)
      token.state = 'cancelled'
      token.abortController.abort()
    }

    return token.id
  }

  /**
   * Check if a token is still valid for rendering.
   * Use this at async boundaries to detect cancellation.
   */
  isActive(token: RenderToken): boolean {
    if (token.state === 'cancelled') return false
    if (token.abortController.signal.aborted) return false

    const current = this.tokens.get(token.pageNumber)
    return current === token
  }

  /**
   * Check if we can paint (token must be in rendering or completed state).
   * This is the final gate before committing to canvas.
   */
  canPaint(token: RenderToken): boolean {
    if (!this.isActive(token)) return false
    if (token.state !== 'rendering' && token.state !== 'completed') {
      return false
    }
    return true
  }

  /**
   * Get current token for a page (if any).
   */
  getCurrentToken(pageNumber: number): RenderToken | undefined {
    return this.tokens.get(pageNumber)
  }

  /**
   * Get token state for a page.
   */
  getTokenState(pageNumber: number): RenderState | null {
    const token = this.tokens.get(pageNumber)
    return token?.state ?? null
  }

  /**
   * Clear all tokens and cancel all renders.
   */
  clear(): void {
    for (const token of this.tokens.values()) {
      if (token.state !== 'cancelled' && token.state !== 'completed') {
        token.state = 'cancelled'
        token.abortController.abort()
      }
    }
    this.tokens.clear()
    logPDF.debug('token: all tokens cleared')
  }

  /**
   * Get stats for debugging.
   */
  getStats(): {
    activeTokens: number
    byState: Record<RenderState, number>
  } {
    const byState: Record<RenderState, number> = {
      idle: 0,
      queued: 0,
      rendering: 0,
      completed: 0,
      cancelled: 0,
    }

    for (const token of this.tokens.values()) {
      byState[token.state]++
    }

    return {
      activeTokens: this.tokens.size,
      byState,
    }
  }
}

// Singleton instance for app-wide render state management
let globalManager: RenderTaskManager | null = null

export function getRenderTaskManager(): RenderTaskManager {
  if (!globalManager) {
    globalManager = new RenderTaskManager()
  }
  return globalManager
}

export function resetRenderTaskManager(): void {
  if (globalManager) {
    globalManager.clear()
  }
  globalManager = null
}
