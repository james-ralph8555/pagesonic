/**
 * Extraction Priority Queue (P0-RDR-002)
 *
 * Prioritizes PDF text extraction by viewport proximity.
 * Extracts current visible page first, then adjacent pages, then remainder.
 */

export interface ExtractionTask {
  pageNumber: number
  priority: number // Lower = higher priority
}

export interface ExtractionQueueConfig {
  /** Current visible page number (1-indexed) */
  currentPage: number
  /** Total pages in document */
  totalPages: number
  /** Pages already extracted (1-indexed) */
  extractedPages: Set<number>
}

/**
 * Calculate extraction priority for a page.
 * Lower numbers = higher priority.
 * Priority 0 = current page, 1 = adjacent, 2 = next ring, etc.
 */
export function calculatePriority(pageNumber: number, currentPage: number): number {
  return Math.abs(pageNumber - currentPage)
}

/**
 * Create a priority-sorted extraction queue.
 * Returns page numbers in extraction order (current page first, then by proximity).
 */
export function createExtractionQueue(config: ExtractionQueueConfig): number[] {
  const { currentPage, totalPages, extractedPages } = config

  // Build list of pages that need extraction
  const pendingPages: number[] = []
  for (let i = 1; i <= totalPages; i++) {
    if (!extractedPages.has(i)) {
      pendingPages.push(i)
    }
  }

  // Sort by proximity to current page (lower distance = higher priority)
  pendingPages.sort((a, b) => {
    const priorityA = calculatePriority(a, currentPage)
    const priorityB = calculatePriority(b, currentPage)
    return priorityA - priorityB
  })

  return pendingPages
}

/**
 * Re-prioritize queue when current page changes.
 * Returns new queue with updated order based on new viewport position.
 */
export function reprioritizeQueue(
  queue: number[],
  newCurrentPage: number,
  extractedPages: Set<number>
): number[] {
  // Filter out already-extracted pages
  const remaining = queue.filter(page => !extractedPages.has(page))

  // Re-sort by new priority
  remaining.sort((a, b) => {
    const priorityA = calculatePriority(a, newCurrentPage)
    const priorityB = calculatePriority(b, newCurrentPage)
    return priorityA - priorityB
  })

  return remaining
}

/**
 * Get the next page to extract from the queue.
 * Returns undefined if queue is empty or page already extracted.
 */
export function getNextPage(queue: number[], extractedPages: Set<number>): number | undefined {
  // Find first page that hasn't been extracted yet
  for (const page of queue) {
    if (!extractedPages.has(page)) {
      return page
    }
  }
  return undefined
}
