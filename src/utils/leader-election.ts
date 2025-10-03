/**
 * Leader Election System using Web Locks API
 * Manages cross-tab leadership for OPFS write operations
 */

import { LeaderInfo, TabId } from '@/types/library'
import { logLeaderElection } from '@/utils/logger'

export interface LeaderECallbacks {
  onLeaderElected?: (leaderInfo: LeaderInfo) => void
  onLeaderLost?: () => void
  onHeartbeat?: (leaderInfo: LeaderInfo) => void
}

export class LeaderElection {
  private static instance: LeaderElection
  private callbacks: LeaderECallbacks = {}
  private isLeader = false
  private leaderInfo: LeaderInfo | null = null
  private lockAbortController: AbortController | null = null
  private heartbeatInterval: number | null = null
  private tabId: TabId
  private lockName = 'opfs-library-write-lock'
  private isHoldingLock = false // Track if we're actively holding the lock
  private initializationState: 'idle' | 'initializing' | 'ready' | 'failed' = 'idle'
  private initializationError: Error | null = null
  private retryCount = 0
  private maxRetries = 3

  private constructor() {
    this.tabId = this.generateTabId()
  }

  static getInstance(): LeaderElection {
    if (!LeaderElection.instance) {
      LeaderElection.instance = new LeaderElection()
    }
    return LeaderElection.instance
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
   * Check if current tab is the leader
   */
  isCurrentLeader(): boolean {
    return this.isLeader
  }

  /**
   * Get current leader info
   */
  getLeaderInfo(): LeaderInfo | null {
    return this.leaderInfo
  }

  /**
   * Set event callbacks
   */
  setCallbacks(callbacks: LeaderECallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  /**
   * Attempt to acquire leadership immediately (non-blocking)
   */
  async attemptLeadership(): Promise<boolean> {
    if (this.isLeader) {
      logLeaderElection.debug('Already acting as leader, skipping attempt')
      return true
    }

    logLeaderElection.info('Attempting to acquire leadership immediately', { tabId: this.tabId })
    logLeaderElection.startTimer('leadershipAttempt', 'Leadership acquisition attempt')

    try {
      let acquired = false
      
      // Try to acquire the lock without waiting
      await navigator.locks.request(
        this.lockName,
        {
          ifAvailable: true // Only acquire if available, don't wait
        },
        async (lock) => {
          if (!lock) {
            // Lock not available, we're a follower
            logLeaderElection.info('Leadership not available, another tab is leader')
            acquired = false
            return
          }

          // We acquired the lock - we're the leader now
          logLeaderElection.info('🎉 Acquired leadership immediately!', { tabId: this.tabId })
          this.isLeader = true
          this.isHoldingLock = true
          this.leaderInfo = {
            id: this.tabId,
            timestamp: Date.now(),
            tabId: this.tabId
          }
          acquired = true

          logLeaderElection.info('Leader elected', { leaderInfo: this.leaderInfo })

          // Notify callbacks
          if (this.callbacks.onLeaderElected) {
            logLeaderElection.debug('Calling onLeaderElected callback')
            this.callbacks.onLeaderElected(this.leaderInfo)
          }

          // Start heartbeat to maintain leadership
          logLeaderElection.debug('Starting heartbeat mechanism')
          this.startHeartbeat()

          // The lock will be held until this function returns
          // We'll keep it held until we lose leadership
          await this.waitForLeadershipEnd()
        }
      )

      logLeaderElection.endTimer('leadershipAttempt', `Leadership acquisition ${acquired ? 'succeeded' : 'failed'}`)
      return acquired

    } catch (error) {
      logLeaderElection.error('Error attempting leadership acquisition', error instanceof Error ? error : new Error(String(error)))
      logLeaderElection.endTimer('leadershipAttempt', 'Leadership acquisition failed with error')
      return false
    }
  }

  /**
   * Start leader election process
   */
  async startElection(): Promise<void> {
    if (this.isLeader) {
      logLeaderElection.warn('Already acting as leader, skipping election')
      return
    }

    if (this.initializationState === 'initializing') {
      logLeaderElection.debug('Election already in progress, waiting...')
      return
    }

    this.initializationState = 'initializing'
    this.initializationError = null

    logLeaderElection.info('Starting leader election process', { tabId: this.tabId, retryCount: this.retryCount })
    logLeaderElection.startTimer('election', 'Leader election process')

    try {
      // First try to acquire leadership immediately
      const acquiredImmediately = await this.attemptLeadership()
      if (acquiredImmediately) {
        logLeaderElection.info('Leadership acquired immediately, no need to wait')
        this.initializationState = 'ready'
        this.retryCount = 0
        return
      }

      // If immediate acquisition failed, wait for leadership with retry logic
      logLeaderElection.info('Leadership not immediately available, entering election wait mode')

      await this.waitForLeadershipWithRetry()

    } catch (error) {
      logLeaderElection.error('Error in leader election', error instanceof Error ? error : new Error(String(error)))
      this.initializationError = error instanceof Error ? error : new Error(String(error))
      this.initializationState = 'failed'
      
      // Attempt retry if we haven't exceeded max retries
      if (this.retryCount < this.maxRetries) {
        this.retryCount++
        logLeaderElection.info(`Retrying leader election (attempt ${this.retryCount} of ${this.maxRetries})`)
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount))
        
        // Reset state and try again
        this.initializationState = 'idle'
        await this.startElection()
      } else {
        logLeaderElection.error('Max retries exceeded for leader election')
        throw new Error('Failed to establish leadership after maximum retries')
      }
    }
  }

  /**
   * Wait for leadership with retry logic
   */
  private async waitForLeadershipWithRetry(): Promise<void> {
    try {
      this.lockAbortController = new AbortController()
      logLeaderElection.debug('Requesting library lock (blocking mode)', { lockName: this.lockName })
      
      // Request the named lock - this will block until we become the leader
      await navigator.locks.request(
        this.lockName,
        {
          signal: this.lockAbortController.signal,
          ifAvailable: false // Must wait for the lock
        },
        async (lock) => {
          if (!lock) {
            // Couldn't acquire lock, we're a follower
            logLeaderElection.info('Could not acquire lock, acting as follower')
            this.initializationState = 'ready'
            this.retryCount = 0
            return
          }

          // We acquired the lock - we're the leader now
          logLeaderElection.info('Acquired library lock after waiting, acting as leader', { tabId: this.tabId })
          this.isLeader = true
          this.isHoldingLock = true
          this.leaderInfo = {
            id: this.tabId,
            timestamp: Date.now(),
            tabId: this.tabId
          }

          logLeaderElection.info('Leader elected', { leaderInfo: this.leaderInfo })

          // Notify callbacks
          if (this.callbacks.onLeaderElected) {
            logLeaderElection.debug('Calling onLeaderElected callback')
            this.callbacks.onLeaderElected(this.leaderInfo)
          }

          // Start heartbeat to maintain leadership
          logLeaderElection.debug('Starting heartbeat mechanism')
          this.startHeartbeat()

          // The lock will be held until this function returns
          // We'll keep it held until we lose leadership
          await this.waitForLeadershipEnd()
        }
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        logLeaderElection.info('Leader election aborted')
        this.initializationState = 'ready'
      } else {
        throw error
      }
    }
  }

  /**
   * Wait for leadership to end (lock release)
   */
  private async waitForLeadershipEnd(): Promise<void> {
    return new Promise<void>((resolve) => {
      // This promise resolves when we lose leadership (stepDown is called)
      // The lock will be held as long as this async function doesn't return
      logLeaderElection.debug('Starting to wait for leadership end')
      
      const checkLeadership = () => {
        if (!this.isLeader) {
          logLeaderElection.info('Leadership ended, releasing lock')
          resolve()
        } else {
          // Check every second if we should step down
          setTimeout(checkLeadership, 1000)
        }
      }
      
      checkLeadership()
    })
  }

  /**
   * Start heartbeat to maintain leadership
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      logLeaderElection.debug('Stopping existing heartbeat interval')
      clearInterval(this.heartbeatInterval)
    }

    logLeaderElection.info('Starting heartbeat mechanism', { interval: 5000 })
    this.heartbeatInterval = setInterval(() => {
      if (this.isLeader && this.leaderInfo) {
        this.leaderInfo.timestamp = Date.now()
        logLeaderElection.debug('Heartbeat sent', { 
          leaderId: this.leaderInfo.id, 
          timestamp: this.leaderInfo.timestamp 
        })
        
        if (this.callbacks.onHeartbeat) {
          this.callbacks.onHeartbeat(this.leaderInfo)
        }
      }
    }, 5000) as any // Heartbeat every 5 seconds
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * Step down from leadership
   */
  async stepDown(source?: string): Promise<void> {
    if (!this.isLeader) {
      logLeaderElection.warn('Not currently leader, cannot step down', { 
        source: source || 'unknown',
        tabId: this.tabId 
      })
      return
    }

    // Prevent accidental step down from cleanup
    if (source === 'cleanup' && this.isHoldingLock) {
      logLeaderElection.warn('⚠️ Preventing step down from cleanup while actively holding lock', { 
        tabId: this.tabId 
      })
      return
    }

    logLeaderElection.info('🔄 Stepping down from leadership', { 
      source: source || 'unknown',
      tabId: this.tabId,
      stackTrace: new Error().stack?.split('\n').slice(1, 4).map(line => line.trim())
    })
    
    this.isLeader = false
    this.leaderInfo = null
    this.isHoldingLock = false
    this.stopHeartbeat()

    // Release the lock by aborting the operation
    if (this.lockAbortController) {
      logLeaderElection.debug('Aborting lock controller to release leadership', { 
        source: source || 'unknown' 
      })
      this.lockAbortController.abort()
      this.lockAbortController = null
    }

    // Notify callbacks
    if (this.callbacks.onLeaderLost) {
      logLeaderElection.debug('Calling onLeaderLost callback', { 
        source: source || 'unknown' 
      })
      this.callbacks.onLeaderLost()
    }
    
    logLeaderElection.info('Leadership step down completed', { 
      source: source || 'unknown' 
    })
  }

  /**
   * Force leadership transfer (for testing)
   */
  async forceLeadershipTransfer(): Promise<void> {
    logLeaderElection.info('Force leadership transfer requested', { 
      isLeader: this.isLeader, 
      tabId: this.tabId 
    })
    
    if (this.isLeader) {
      logLeaderElection.info('Currently leader, stepping down first')
      await this.stepDown('force-transfer')
      // Wait a bit then try to re-acquire
      setTimeout(() => {
        logLeaderElection.info('Attempting to re-acquire leadership after stepping down')
        this.startElection()
      }, 100)
    } else {
      logLeaderElection.info('Not currently leader, attempting to acquire leadership')
      // Try to acquire leadership immediately
      const acquired = await this.attemptLeadership()
      if (!acquired) {
        logLeaderElection.info('Could not acquire leadership immediately, starting full election process')
        await this.startElection()
      }
    }
  }

  /**
   * Check if a leader is currently active
   */
  async checkLeaderStatus(): Promise<boolean> {
    try {
      logLeaderElection.debug('Checking leader status')
      const locks = await navigator.locks.query()
      const libraryLock = locks.held?.find(lock => lock.name === this.lockName)
      const hasLeader = libraryLock !== undefined
      
      logLeaderElection.debug('Leader status checked', { 
        hasLeader, 
        heldLocks: locks.held?.length || 0,
        pendingLocks: locks.pending?.length || 0
      })
      
      return hasLeader
    } catch (error) {
      logLeaderElection.warn('Could not check leader status', error instanceof Error ? error : new Error(String(error)))
      return false
    }
  }

  /**
   * Get information about current locks
   */
  async getLockInfo(): Promise<{ held: string[]; pending: string[] }> {
    try {
      logLeaderElection.debug('Getting lock information')
      const locks = await navigator.locks.query()
      const held = locks.held?.map(lock => lock.name || '').filter(Boolean) || []
      const pending = locks.pending?.map(lock => lock.name || '').filter(Boolean) || []
      
      logLeaderElection.debug('Lock information retrieved', { held, pending })
      
      return { held, pending }
    } catch (error) {
      logLeaderElection.warn('Could not get lock info', error instanceof Error ? error : new Error(String(error)))
      return { held: [], pending: [] }
    }
  }

  /**
   * Cleanup when tab is closing
   */
  cleanup(): void {
    logLeaderElection.info('🧹 Leader election cleanup called', { 
      isLeader: this.isLeader,
      tabId: this.tabId,
      stackTrace: new Error().stack?.split('\n').slice(1, 4).map(line => line.trim())
    })
    
    // Only step down if this is actually a tab close, not just component cleanup
    // We can detect this by checking if the page is actually unloading
    if (this.isLeader && document.visibilityState === 'hidden') {
      logLeaderElection.warn('⚠️ Not stepping down during cleanup - may not be actual tab close')
      // Don't step down immediately, give it a delay to see if it's a real tab close
      setTimeout(() => {
        if (this.isLeader && document.visibilityState === 'hidden') {
          logLeaderElection.info('Delayed cleanup confirmed - stepping down')
          this.stepDown('delayed-cleanup')
        }
      }, 1000)
      return
    }
    
    if (this.isLeader) {
      this.stepDown('cleanup')
    }
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    
    if (this.lockAbortController) {
      this.lockAbortController.abort()
      this.lockAbortController = null
    }
  }

  /**
   * Check if leader election is ready
   */
  isReady(): boolean {
    return this.initializationState === 'ready'
  }

  /**
   * Check if leader election has failed
   */
  hasFailed(): boolean {
    return this.initializationState === 'failed'
  }

  /**
   * Get initialization error
   */
  getInitializationError(): Error | null {
    return this.initializationError
  }

  /**
   * Reset initialization state (for recovery)
   */
  resetInitialization(): void {
    this.initializationState = 'idle'
    this.initializationError = null
    this.retryCount = 0
    logLeaderElection.info('Leader election state reset')
  }

  /**
   * Get debugging information
   */
  getDebugInfo(): {
    tabId: TabId
    isLeader: boolean
    leaderInfo: LeaderInfo | null
    hasHeartbeat: boolean
    isHoldingLock: boolean
    initializationState: 'idle' | 'initializing' | 'ready' | 'failed'
    retryCount: number
    maxRetries: number
    hasError: boolean
  } {
    return {
      tabId: this.tabId,
      isLeader: this.isLeader,
      leaderInfo: this.leaderInfo,
      hasHeartbeat: this.heartbeatInterval !== null,
      isHoldingLock: this.isHoldingLock,
      initializationState: this.initializationState,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      hasError: this.initializationError !== null
    }
  }
}

// Export singleton instance
export const leaderElection = LeaderElection.getInstance()

// Auto-cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    leaderElection.cleanup()
  })
  
  // Also cleanup on page visibility change to handle tab switching
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && leaderElection.isCurrentLeader()) {
      console.log('Tab hidden, but maintaining leadership')
    }
  })
}

// Debug utilities for troubleshooting leader election
if (typeof window !== 'undefined') {
  // Add debugging functions using the singleton instance
  (window as any).__libraryDebug = {
    getLeaderInfo: () => leaderElection.getDebugInfo(),
    forceTransfer: () => leaderElection.forceLeadershipTransfer(),
    stepDown: () => leaderElection.stepDown(),
    checkLocks: () => leaderElection.getLockInfo(),
    startElection: async () => {
      try {
        await leaderElection.startElection()
        return 'Election started'
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    },
    attemptLeadership: async () => {
      try {
        const acquired = await leaderElection.attemptLeadership()
        return `Leadership ${acquired ? 'acquired' : 'not available'}`
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    },
    isLeader: () => leaderElection.isCurrentLeader(),
    getTabId: () => leaderElection.getTabId(),
    checkLeaderStatus: async () => {
      try {
        const hasLeader = await leaderElection.checkLeaderStatus()
        return `Active leader: ${hasLeader}`
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    },
    isReady: () => leaderElection.isReady(),
    hasFailed: () => leaderElection.hasFailed(),
    getError: () => leaderElection.getInitializationError()?.message || 'No error',
    resetState: () => {
      leaderElection.resetInitialization()
      return 'State reset - try starting election again'
    },
    // Comprehensive diagnostic
    diagnose: async () => {
      try {
        const info = leaderElection.getDebugInfo()
        const locks = await leaderElection.getLockInfo()
        const hasLeader = await leaderElection.checkLeaderStatus()
        
        return {
          currentTab: {
            tabId: info.tabId,
            isLeader: info.isLeader,
            hasHeartbeat: info.hasHeartbeat,
            leaderInfo: info.leaderInfo,
            initializationState: info.initializationState,
            retryCount: info.retryCount,
            maxRetries: info.maxRetries,
            hasError: info.hasError
          },
          locks: {
            held: locks.held,
            pending: locks.pending,
            hasActiveLock: hasLeader
          },
          suggestions: [
            !info.isLeader && !hasLeader && info.initializationState !== 'initializing' ? 'No active leader - try attemptLeadership()' : null,
            info.isLeader ? 'This tab is the leader ✅' : 'This tab is a follower',
            !info.hasHeartbeat && info.isLeader ? 'Leader has no heartbeat - issue detected' : null,
            locks.held.length === 0 ? 'No locks held - this is unexpected' : null,
            info.initializationState === 'failed' ? 'Initialization failed - try resetState() and restart' : null,
            info.initializationState === 'initializing' ? 'Election in progress - please wait' : null,
            info.retryCount > 0 ? `Retry attempts: ${info.retryCount}/${info.maxRetries}` : null
          ].filter(Boolean)
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Unknown error' }
      }
    },
    // Quick fix attempt
    quickFix: async () => {
      try {
        const status = await leaderElection.checkLeaderStatus()
        const info = leaderElection.getDebugInfo()
        
        if (info.initializationState === 'failed') {
          leaderElection.resetInitialization()
          return 'State reset - try starting election again'
        }
        
        if (!info.isLeader && !status && info.initializationState !== 'initializing') {
          // No leader and we're not leader - try to take leadership
          const acquired = await leaderElection.attemptLeadership()
          return acquired ? 'Leadership acquired successfully!' : 'Leadership acquisition failed'
        } else if (info.isLeader) {
          return 'Already the leader - no action needed'
        } else {
          return 'Another tab appears to be the leader or election in progress'
        }
      } catch (error) {
        return `Quick fix failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
  
  console.log('[LeaderElection] Debug utilities available at window.__libraryDebug')
  console.log('[LeaderElection] Try: await window.__libraryDebug.diagnose() for a full check')
  console.log('[LeaderElection] Try: await window.__libraryDebug.quickFix() for automatic recovery')
}