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
   * Start leader election process
   */
  async startElection(): Promise<void> {
    if (this.isLeader) {
      logLeaderElection.warn('Already acting as leader, skipping election')
      return
    }

    logLeaderElection.info('Starting leader election process', { tabId: this.tabId })
    logLeaderElection.startTimer('election', 'Leader election process')

    try {
      this.lockAbortController = new AbortController()
      logLeaderElection.debug('Requesting library lock', { lockName: this.lockName })
      
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
            return
          }

          // We acquired the lock - we're the leader now
          logLeaderElection.info('Acquired library lock, acting as leader', { tabId: this.tabId })
          this.isLeader = true
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
      } else {
        logLeaderElection.error('Error in leader election', error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  /**
   * Wait for leadership to end (lock release)
   */
  private async waitForLeadershipEnd(): Promise<void> {
    return new Promise<void>((resolve) => {
      // This promise resolves when we lose the lock
      // The lock is automatically released when this callback returns
      // So we need to keep it alive until we're told to step down
      
      const checkLeadership = () => {
        if (!this.isLeader) {
          resolve()
        } else {
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
  async stepDown(): Promise<void> {
    if (!this.isLeader) {
      logLeaderElection.warn('Not currently leader, cannot step down')
      return
    }

    logLeaderElection.info('Stepping down from leadership', { tabId: this.tabId })
    
    this.isLeader = false
    this.leaderInfo = null
    this.stopHeartbeat()

    // Release the lock by aborting the operation
    if (this.lockAbortController) {
      logLeaderElection.debug('Aborting lock controller to release leadership')
      this.lockAbortController.abort()
      this.lockAbortController = null
    }

    // Notify callbacks
    if (this.callbacks.onLeaderLost) {
      logLeaderElection.debug('Calling onLeaderLost callback')
      this.callbacks.onLeaderLost()
    }
    
    logLeaderElection.info('Leadership step down completed')
  }

  /**
   * Force leadership transfer (for testing)
   */
  async forceLeadershipTransfer(): Promise<void> {
    if (this.isLeader) {
      await this.stepDown()
      // Wait a bit then try to re-acquire
      setTimeout(() => {
        this.startElection()
      }, 100)
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
    if (this.isLeader) {
      this.stepDown()
    }
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }
    
    if (this.lockAbortController) {
      this.lockAbortController.abort()
    }
  }

  /**
   * Get debugging information
   */
  getDebugInfo(): {
    tabId: TabId
    isLeader: boolean
    leaderInfo: LeaderInfo | null
    hasHeartbeat: boolean
  } {
    return {
      tabId: this.tabId,
      isLeader: this.isLeader,
      leaderInfo: this.leaderInfo,
      hasHeartbeat: this.heartbeatInterval !== null
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

// Debug utilities disabled for type checking
// if (typeof window !== 'undefined') {
//   // Expose leader election to window for debugging
//   (window as any).__leaderElection = leaderElection
//   
//   // Add some debugging functions
//   (window as any).__libraryDebug = {
//     getLeaderInfo: () => leaderElection.getDebugInfo(),
//     forceTransfer: () => leaderElection.forceLeadershipTransfer(),
//     stepDown: () => leaderElection.stepDown(),
//     checkLocks: () => leaderElection.getLockInfo(),
//     startElection: () => leaderElection.startElection()
//   }
// }