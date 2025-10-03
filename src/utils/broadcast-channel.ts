/**
 * Broadcast Channel Communication System
 * Handles cross-tab messaging for library operations
 */

import { 
  LibraryMessage, 
  LibraryMessageType, 
  LibraryResponse, 
  MessageId,
  TabId,
  LeaderInfo,
  AddDocumentPayload,
  UpdateDocumentPayload,
  BookmarkPayload,
  ConversionPayload,
  SettingsPayload,
  SearchPayload
} from '@/types/library'

export type MessageHandler = (message: LibraryMessage) => Promise<unknown> | unknown

export interface MessageHandlers {
  [key: string]: MessageHandler
}

export class BroadcastChannelManager {
  private static instance: BroadcastChannelManager
  private channel: BroadcastChannel | null = null
  private handlers: Map<LibraryMessageType, MessageHandler[]> = new Map()
  private pendingRequests: Map<MessageId, {
    resolve: (value: LibraryResponse) => void
    reject: (error: Error) => void
    timeout: number
  }> = new Map()
  private tabId: TabId
  private messageIdCounter = 0
  private _isReady = false
  private messageQueue: LibraryMessage[] = []
  private initializationError: Error | null = null

  private constructor() {
    this.tabId = this.generateTabId()
    try {
      this.channel = new BroadcastChannel('library-channel')
      this.setupChannelListener()
      this._isReady = true
    } catch (error) {
      this.initializationError = error instanceof Error ? error : new Error(String(error))
      console.warn('BroadcastChannel initialization failed, running in single-tab mode', this.initializationError)
    }
  }

  static getInstance(): BroadcastChannelManager {
    if (!BroadcastChannelManager.instance) {
      BroadcastChannelManager.instance = new BroadcastChannelManager()
    }
    return BroadcastChannelManager.instance
  }

  /**
   * Generate a unique message ID
   */
  private generateMessageId(): MessageId {
    return `msg_${Date.now()}_${++this.messageIdCounter}_${this.tabId}`
  }

  /**
   * Generate a unique tab ID
   */
  private generateTabId(): TabId {
    return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Get current tab ID
   */
  getTabId(): TabId {
    return this.tabId
  }

  /**
   * Setup channel message listener
   */
  private setupChannelListener(): void {
    if (!this.channel) return

    this.channel.addEventListener('message', (event) => {
      const message = event.data as LibraryMessage
      
      // Ignore messages from this tab
      if (message.senderId === this.tabId) {
        return
      }

      this.handleMessage(message)
    })

    // Process any queued messages once handlers are set up
    setTimeout(() => {
      this.processMessageQueue()
    }, 100)
  }

  /**
   * Process queued messages
   */
  private processMessageQueue(): void {
    const queue = this.messageQueue.splice(0)
    queue.forEach(message => {
      this.handleMessage(message)
    })
    if (queue.length > 0) {
      console.log(`[BroadcastChannel] Processed ${queue.length} queued messages`)
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(message: LibraryMessage): Promise<void> {
    // Check if this is a response to a pending request
    const pendingRequest = this.pendingRequests.get(message.id)
    if (pendingRequest) {
      clearTimeout(pendingRequest.timeout)
      this.pendingRequests.delete(message.id)
      
      if (message.type === 'SUCCESS') {
        pendingRequest.resolve(message.payload as LibraryResponse)
      } else if (message.type === 'ERROR') {
        pendingRequest.reject(new Error(message.payload as string))
      }
      return
    }

    // If no handlers are registered yet, queue the message
    const handlers = this.handlers.get(message.type) || []
    if (handlers.length === 0) {
      // Queue the message for later processing
      if (this.messageQueue.length < 50) { // Prevent unlimited queue growth
        this.messageQueue.push(message)
        console.debug(`[BroadcastChannel] Queued message type: ${message.type} (queue size: ${this.messageQueue.length})`)
      } else {
        console.warn(`[BroadcastChannel] Message queue full, dropping message type: ${message.type}`)
      }
      return
    }

    // Execute all handlers for this message type
    const results = await Promise.allSettled(
      handlers.map(handler => this.executeHandler(handler, message))
    )

    // Check if any handler failed
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length > 0) {
      console.error(`Some handlers failed for message type ${message.type}:`, failures)
    }
  }

  /**
   * Execute a single message handler
   */
  private async executeHandler(handler: MessageHandler, message: LibraryMessage): Promise<unknown> {
    try {
      return await handler(message)
    } catch (error) {
      console.error(`Handler failed for message ${message.id}:`, error)
      throw error
    }
  }

  /**
   * Register a handler for a message type
   */
  register(messageType: LibraryMessageType, handler: MessageHandler): () => void {
    if (!this.handlers.has(messageType)) {
      this.handlers.set(messageType, [])
    }
    
    const handlers = this.handlers.get(messageType)!
    handlers.push(handler)

    // Return unregister function
    return () => {
      const index = handlers.indexOf(handler)
      if (index > -1) {
        handlers.splice(index, 1)
      }
    }
  }

  /**
   * Unregister all handlers for a message type
   */
  unregisterAll(messageType: LibraryMessageType): void {
    this.handlers.delete(messageType)
  }

  /**
   * Broadcast a message without expecting a response
   */
  broadcast(type: LibraryMessageType, payload: unknown): void {
    if (!this._isReady || !this.channel) {
      console.warn('[BroadcastChannel] Cannot broadcast - channel not ready')
      return
    }

    const message: LibraryMessage = {
      id: this.generateMessageId(),
      type,
      payload,
      timestamp: Date.now(),
      senderId: this.tabId
    }

    try {
      this.channel.postMessage(message)
    } catch (error) {
      console.error('[BroadcastChannel] Failed to broadcast message:', error)
    }
  }

  /**
   * Send a message and wait for a response
   */
  async request<T = unknown>(
    type: LibraryMessageType, 
    payload: unknown,
    timeoutMs = 30000
  ): Promise<LibraryResponse<T>> {
    if (!this._isReady || !this.channel) {
      throw new Error('Broadcast channel not available - running in single-tab mode')
    }

    const messageId = this.generateMessageId()
    const message: LibraryMessage = {
      id: messageId,
      type,
      payload,
      timestamp: Date.now(),
      senderId: this.tabId
    }

    return new Promise<LibraryResponse<T>>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(messageId)
        reject(new Error(`Request timeout: ${type}`))
      }, timeoutMs)

      // Store the promise resolvers
      this.pendingRequests.set(messageId, {
        resolve: resolve as (value: LibraryResponse) => void,
        reject,
        timeout: timeoutId as any
      })

      // Send the message
      try {
        this.channel!.postMessage(message)
      } catch (error) {
        this.pendingRequests.delete(messageId)
        clearTimeout(timeoutId)
        reject(new Error(`Failed to send request: ${error instanceof Error ? error.message : 'Unknown error'}`))
      }
    })
  }

  /**
   * Send a success response
   */
  private respond(originalMessage: LibraryMessage, data: unknown): void {
    if (!this.channel) return

    const response: LibraryMessage = {
      id: originalMessage.id,
      type: 'SUCCESS',
      payload: {
        success: true,
        data,
        messageId: originalMessage.id
      } as LibraryResponse,
      timestamp: Date.now(),
      senderId: this.tabId
    }

    this.channel.postMessage(response)
  }

  /**
   * Send an error response
   */
  private respondError(originalMessage: LibraryMessage, error: string): void {
    if (!this.channel) return

    const response: LibraryMessage = {
      id: originalMessage.id,
      type: 'ERROR',
      payload: error,
      timestamp: Date.now(),
      senderId: this.tabId
    }

    this.channel.postMessage(response)
  }

  /**
   * Create a request handler that automatically sends responses
   */
  createRequestHandler<T = unknown>(
    handler: (payload: T, message: LibraryMessage) => Promise<unknown> | unknown
  ): MessageHandler {
    return async (message: LibraryMessage) => {
      try {
        const result = await handler(message.payload as T, message)
        this.respond(message, result)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.respondError(message, errorMessage)
      }
    }
  }

  // Convenience methods for common message types

  /**
   * Broadcast leader election notification
   */
  broadcastLeaderElected(leaderInfo: LeaderInfo): void {
    this.broadcast('LEADER_ELECTED', leaderInfo)
  }

  /**
   * Broadcast leader lost notification
   */
  broadcastLeaderLost(): void {
    this.broadcast('LEADER_LOST', null)
  }

  /**
   * Broadcast heartbeat
   */
  broadcastHeartbeat(leaderInfo: LeaderInfo): void {
    this.broadcast('HEARTBEAT', leaderInfo)
  }

  /**
   * Request document addition
   */
  async requestAddDocument(payload: AddDocumentPayload): Promise<LibraryResponse> {
    return this.request('ADD_DOCUMENT', payload)
  }

  /**
   * Request document update
   */
  async requestUpdateDocument(payload: UpdateDocumentPayload): Promise<LibraryResponse> {
    return this.request('UPDATE_DOCUMENT', payload)
  }

  /**
   * Request documents list
   */
  async requestGetDocuments(payload?: SearchPayload): Promise<LibraryResponse> {
    return this.request('GET_DOCUMENTS', payload || {})
  }

  /**
   * Request metadata
   */
  async requestGetMetadata(docId: string): Promise<LibraryResponse> {
    return this.request('GET_METADATA', { docId })
  }

  /**
   * Request bookmarks
   */
  async requestGetBookmarks(docId: string): Promise<LibraryResponse> {
    return this.request('GET_BOOKMARKS', { docId })
  }

  /**
   * Request bookmark addition
   */
  async requestAddBookmark(payload: BookmarkPayload): Promise<LibraryResponse> {
    return this.request('ADD_BOOKMARK', payload)
  }

  /**
   * Request settings
   */
  async requestGetSettings(type: 'user' | 'reader'): Promise<LibraryResponse> {
    return this.request('GET_SETTINGS', { type })
  }

  /**
   * Request settings update
   */
  async requestUpdateSettings(payload: SettingsPayload): Promise<LibraryResponse> {
    return this.request('UPDATE_SETTINGS', payload)
  }

  /**
   * Request conversion start
   */
  async requestStartConversion(payload: ConversionPayload): Promise<LibraryResponse> {
    return this.request('START_CONVERSION', payload)
  }

  /**
   * Request conversion status
   */
  async requestGetConversionStatus(jobId: string): Promise<LibraryResponse> {
    return this.request('GET_CONVERSION_STATUS', { jobId })
  }

  /**
   * Check if broadcast channel is ready
   */
  isReady(): boolean {
    return this._isReady && this.channel !== null
  }

  /**
   * Get initialization error
   */
  getInitializationError(): Error | null {
    return this.initializationError
  }

  /**
   * Get debug information
   */
  getDebugInfo(): {
    tabId: TabId
    handlersCount: number
    pendingRequestsCount: number
    messagesSent: number
    isReady: boolean
    queuedMessagesCount: number
    hasError: boolean
  } {
    let handlersCount = 0
    for (const handlers of this.handlers.values()) {
      handlersCount += handlers.length
    }

    return {
      tabId: this.tabId,
      handlersCount,
      pendingRequestsCount: this.pendingRequests.size,
      messagesSent: this.messageIdCounter,
      isReady: this._isReady,
      queuedMessagesCount: this.messageQueue.length,
      hasError: this.initializationError !== null
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    // Clear all pending requests
    for (const [, request] of this.pendingRequests) {
      clearTimeout(request.timeout)
      request.reject(new Error('Broadcast channel cleanup'))
    }
    this.pendingRequests.clear()

    // Clear all handlers
    this.handlers.clear()

    // Close the channel
    if (this.channel) {
      this.channel.close()
    }
  }
}

// Export singleton instance
export const broadcastChannel = BroadcastChannelManager.getInstance()

// Auto-cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    broadcastChannel.cleanup()
  })
}

// Debug utilities for troubleshooting broadcast channel
if (typeof window !== 'undefined') {
  // Add debugging functions using the singleton instance
  (window as any).__libraryBroadcastDebug = {
    getDebugInfo: () => broadcastChannel.getDebugInfo(),
    isReady: () => broadcastChannel.isReady(),
    getError: () => broadcastChannel.getInitializationError()?.message || 'No error',
    broadcast: (type: any, payload: unknown) => {
      try {
        broadcastChannel.broadcast(type, payload)
        return 'Message broadcasted'
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    },
    getHandlers: () => Array.from((broadcastChannel as any).handlers.keys()),
    getPendingRequests: () => Array.from((broadcastChannel as any).pendingRequests.keys()),
    getQueuedMessages: () => (broadcastChannel as any).messageQueue.length,
    getTabId: () => broadcastChannel.getTabId(),
    // Comprehensive diagnostic
    diagnose: () => {
      const info = broadcastChannel.getDebugInfo()
      return {
        currentTab: {
          tabId: info.tabId,
          isReady: info.isReady,
          hasError: info.hasError,
          errorMessage: broadcastChannel.getInitializationError()?.message
        },
        handlers: {
          registeredTypes: Array.from((broadcastChannel as any).handlers.keys()),
          totalHandlers: info.handlersCount,
          pendingRequests: info.pendingRequestsCount,
          queuedMessages: info.queuedMessagesCount
        },
        suggestions: [
          !info.isReady ? 'Broadcast channel not ready - single-tab mode' : null,
          info.hasError ? 'Initialization error occurred - check browser support' : null,
          info.handlersCount === 0 ? 'No handlers registered - messages will be queued' : null,
          info.queuedMessagesCount > 0 ? `${info.queuedMessagesCount} messages queued` : null,
          info.pendingRequestsCount > 0 ? `${info.pendingRequestsCount} pending requests` : null
        ].filter(Boolean)
      }
    }
  }
  
  console.log('[BroadcastChannel] Debug utilities available at window.__libraryBroadcastDebug')
  console.log('[BroadcastChannel] Try: window.__libraryBroadcastDebug.diagnose() for a full check')
}