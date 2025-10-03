/**
 * Leader Election System using Web Locks API
 * Manages cross-tab leadership for OPFS write operations
 */

import { LeaderInfo, TabId } from '@/types/library'

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
      console.warn('Already acting as leader')
      return
    }

    try {
      this.lockAbortController = new AbortController()
      
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
            console.log('Could not acquire lock, acting as follower')
            return
          }

          // We acquired the lock - we're the leader now
          console.log('Acquired library lock, acting as leader')
          this.isLeader = true
          this.leaderInfo = {
            id: this.tabId,
            timestamp: Date.now(),
            tabId: this.tabId
          }

          // Notify callbacks
          if (this.callbacks.onLeaderElected) {
            this.callbacks.onLeaderElected(this.leaderInfo)
          }

          // Start heartbeat to maintain leadership
          this.startHeartbeat()

          // The lock will be held until this function returns
          // We'll keep it held until we lose leadership
          await this.waitForLeadershipEnd()
        }
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.log('Leader election aborted')
      } else {
        console.error('Error in leader election:', error)
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
      clearInterval(this.heartbeatInterval)
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.isLeader && this.leaderInfo) {
        this.leaderInfo.timestamp = Date.now()
        
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
      return
    }

    console.log('Stepping down from leadership')
    
    this.isLeader = false
    this.leaderInfo = null
    this.stopHeartbeat()

    // Release the lock by aborting the operation
    if (this.lockAbortController) {
      this.lockAbortController.abort()
      this.lockAbortController = null
    }

    // Notify callbacks
    if (this.callbacks.onLeaderLost) {
      this.callbacks.onLeaderLost()
    }
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
      const locks = await navigator.locks.query()
      const libraryLock = locks.held?.find(lock => lock.name === this.lockName)
      return libraryLock !== undefined
    } catch (error) {
      console.warn('Could not check leader status:', error)
      return false
    }
  }

  /**
   * Get information about current locks
   */
  async getLockInfo(): Promise<{ held: string[]; pending: string[] }> {
    try {
      const locks = await navigator.locks.query()
      return {
        held: locks.held?.map(lock => lock.name || '').filter(Boolean) || [],
        pending: locks.pending?.map(lock => lock.name || '').filter(Boolean) || []
      }
    } catch (error) {
      console.warn('Could not get lock info:', error)
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