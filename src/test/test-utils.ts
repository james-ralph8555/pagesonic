/**
 * Test utilities and helpers for PageSonic testing
 */

/**
 * Mock performance API for tests
 */
export function mockPerformance() {
  if (typeof global.performance === 'undefined') {
    global.performance = {
      now: () => Date.now(),
      mark: () => undefined as unknown as PerformanceMark,
      measure: () => undefined as unknown as PerformanceMeasure,
      getEntriesByName: () => [],
      getEntriesByType: () => [],
      clearMarks: () => {},
      clearMeasures: () => {},
      clearResourceTimings: () => {},
      setResourceTimingBufferSize: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      timeOrigin: Date.now(),
      toJSON: () => ({}),
    } as unknown as Performance
  }
}

/**
 * Mock IndexedDB for tests
 * Returns a mock IDBFactory that can be used in tests
 */
export function mockIndexedDB(): Partial<IDBFactory> {
  return {
    open: () => ({}) as IDBOpenDBRequest,
    deleteDatabase: () => ({}) as IDBOpenDBRequest,
  }
}

/**
 * Wait for async operations in tests
 */
export function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Create a mock request for testing
 */
export function createMockRequest<T>(result: T, error: Error | null = null): IDBRequest {
  const request = {
    result,
    error,
    readyState: 'done',
    onsuccess: null,
    onerror: null,
    transaction: null,
  } as unknown as IDBRequest

  // Simulate async completion
  setTimeout(() => {
    if (error && request.onerror) {
      request.onerror(new Event('error'))
    } else if (request.onsuccess) {
      request.onsuccess(new Event('success'))
    }
  }, 0)

  return request
}

/**
 * Mock worker for testing TTS and other worker-based features
 */
export function createMockWorker(): Partial<Worker> {
  let messageHandler: ((event: MessageEvent) => void) | null = null

  return {
    postMessage: (_data: unknown) => {
      // Simulate worker response
      setTimeout(() => {
        if (messageHandler) {
          messageHandler(new MessageEvent('message', { data: { type: 'ready' } }))
        }
      }, 0)
    },
    terminate: () => {},
    addEventListener: (_type: string, handler: EventListener) => {
      messageHandler = handler as ((event: MessageEvent) => void)
    },
    removeEventListener: () => {
      messageHandler = null
    },
  }
}

/**
 * Get a mock PDF.js document for testing
 */
export function createMockPDFDocument(): any {
  return {
    numPages: 3,
    getPage: async (pageNumber: number) => ({
      pageNumber,
      getViewport: ({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
        scale,
      }),
      render: () => ({
        promise: Promise.resolve(null),
      }),
    }),
    getMetadata: async () => ({
      title: 'Test PDF',
      author: 'Test Author',
      subject: 'Test Subject',
    }),
    destroy: () => {},
  }
}

/**
 * Wait for condition with timeout
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 1000,
  interval = 50
): Promise<void> {
  const startTime = Date.now()

  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms`)
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }
}
