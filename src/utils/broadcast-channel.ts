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
  private channel: BroadcastChannel
  private handlers: Map<LibraryMessageType, MessageHandler[]> = new Map()
  private pendingRequests: Map<MessageId, {
    resolve: (value: LibraryResponse) => void
    reject: (error: Error) => void
    timeout: number
  }> = new Map()
  private tabId: TabId
  private messageIdCounter = 0

  private constructor() {
    this.channel = new BroadcastChannel('library-channel')
    this.tabId = this.generateTabId()
    this.setupChannelListener()
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
    this.channel.addEventListener('message', (event) => {
      const message = event.data as LibraryMessage
      
      // Ignore messages from this tab
      if (message.senderId === this.tabId) {
        return
      }

      this.handleMessage(message)
    })
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

    // Process the message through registered handlers
    const handlers = this.handlers.get(message.type) || []
    if (handlers.length === 0) {
      console.warn(`No handlers registered for message type: ${message.type}`)
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
    const message: LibraryMessage = {
      id: this.generateMessageId(),
      type,
      payload,
      timestamp: Date.now(),
      senderId: this.tabId
    }

    this.channel.postMessage(message)
  }

  /**
   * Send a message and wait for a response
   */
  async request<T = unknown>(
    type: LibraryMessageType, 
    payload: unknown,
    timeoutMs = 30000
  ): Promise<LibraryResponse<T>> {
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
      this.channel.postMessage(message)
    })
  }

  /**
   * Send a success response
   */
  private respond(originalMessage: LibraryMessage, data: unknown): void {
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
   * Get debug information
   */
  getDebugInfo(): {
    tabId: TabId
    handlersCount: number
    pendingRequestsCount: number
    messagesSent: number
  } {
    let handlersCount = 0
    for (const handlers of this.handlers.values()) {
      handlersCount += handlers.length
    }

    return {
      tabId: this.tabId,
      handlersCount,
      pendingRequestsCount: this.pendingRequests.size,
      messagesSent: this.messageIdCounter
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
    this.channel.close()
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

// Debug utilities disabled for type checking
// if (typeof window !== 'undefined') {
//   // Expose broadcast channel to window for debugging
//   (window as any).__broadcastChannel = broadcastChannel
//   
//   // Add debugging functions
//   (window as any).__libraryBroadcastDebug = {
//     getDebugInfo: () => broadcastChannel.getDebugInfo(),
//     broadcast: (type: any, payload: unknown) => broadcastChannel.broadcast(type, payload),
//     getHandlers: () => Array.from((broadcastChannel as any).handlers.keys()),
//     getPendingRequests: () => Array.from((broadcastChannel as any).pendingRequests.keys())
//   }
// }