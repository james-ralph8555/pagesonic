/**
 * Comprehensive Library Debug Tools
 * Provides centralized debugging and recovery utilities for the OPFS library system
 */

import { leaderElection } from './leader-election'
import { opfsManager } from './opfs'
import { broadcastChannel } from './broadcast-channel'
import { logLibraryStore } from './logger'
import { getLibraryStoreDebugInfo } from '@/stores/library'

export interface LibraryDiagnostics {
  timestamp: number
  leaderElection: any
  opfs: any
  broadcastChannel: any
  libraryStore: {
    isInitialized: boolean
    isLeader: boolean
    hasError: boolean
    errorMessage: string | null
    componentInstances: number
  }
  recommendations: string[]
  status: 'healthy' | 'degraded' | 'failed' | 'unknown'
}

export interface DebugOptions {
  includeLogs?: boolean
  includeStackTrace?: boolean
  includeState?: boolean
}

class LibraryDebugger {
  private static instance: LibraryDebugger
  private diagnostics: LibraryDiagnostics[] = []
  private maxDiagnostics = 10

  private constructor() {}

  static getInstance(): LibraryDebugger {
    if (!LibraryDebugger.instance) {
      LibraryDebugger.instance = new LibraryDebugger()
    }
    return LibraryDebugger.instance
  }

  /**
   * Run comprehensive diagnostics on the library system
   */
  async runDiagnostics(_options: DebugOptions = {}): Promise<LibraryDiagnostics> {
    const timestamp = Date.now()
    
    try {
      // Get diagnostics from each component
      const [leaderInfo, opfsInfo, broadcastInfo] = await Promise.allSettled([
        leaderElection.getDebugInfo(),
        this.getOPFSInfo(),
        broadcastChannel.getDebugInfo()
      ])

      const leaderData = leaderInfo.status === 'fulfilled' ? leaderInfo.value : { error: leaderInfo.reason }
      const opfsData = opfsInfo.status === 'fulfilled' ? opfsInfo.value : { error: opfsInfo.reason }
      const broadcastData = broadcastInfo.status === 'fulfilled' ? broadcastInfo.value : { error: broadcastInfo.reason }

      // Get library store state
      const libraryStore = this.getLibraryStoreInfo()

      // Generate recommendations
      const recommendations = this.generateRecommendations(leaderData, opfsData, broadcastData, libraryStore)

      // Determine overall status
      const status = this.determineStatus(leaderData, opfsData, broadcastData, libraryStore)

      const diagnostics: LibraryDiagnostics = {
        timestamp,
        leaderElection: leaderData,
        opfs: opfsData,
        broadcastChannel: broadcastData,
        libraryStore,
        recommendations,
        status
      }

      // Store diagnostics
      this.diagnostics.push(diagnostics)
      if (this.diagnostics.length > this.maxDiagnostics) {
        this.diagnostics.shift()
      }

      logLibraryStore.info('Library diagnostics completed', { status, recommendationCount: recommendations.length })
      return diagnostics

    } catch (error) {
      logLibraryStore.error('Diagnostics failed', error instanceof Error ? error : new Error(String(error)))
      
      return {
        timestamp,
        leaderElection: { error: error instanceof Error ? error.message : 'Unknown error' },
        opfs: { error: error instanceof Error ? error.message : 'Unknown error' },
        broadcastChannel: { error: error instanceof Error ? error.message : 'Unknown error' },
        libraryStore: this.getLibraryStoreInfo(),
        recommendations: ['Critical error in diagnostics - check browser console'],
        status: 'failed'
      }
    }
  }

  /**
   * Get OPFS information
   */
  private async getOPFSInfo(): Promise<any> {
    const info = {
      isReady: opfsManager.isReady(),
      hasFailed: opfsManager.hasFailed(),
      error: opfsManager.getInitializationError()?.message || null,
      retryCount: (opfsManager as any).retryCount || 0,
      maxRetries: (opfsManager as any).maxRetries || 0
    }

    // Add storage usage if OPFS is ready
    if (info.isReady) {
      try {
        const usage = await opfsManager.getStorageUsage()
        return { ...info, storageUsage: usage }
      } catch (error) {
        return { ...info, storageUsageError: error instanceof Error ? error.message : 'Unknown error' }
      }
    }

    return info
  }

  /**
   * Get library store information
   */
  private getLibraryStoreInfo(): any {
    try {
      return getLibraryStoreDebugInfo()
    } catch (error) {
      return {
        isInitialized: false,
        isLeader: leaderElection.isCurrentLeader(),
        hasError: true,
        errorMessage: error instanceof Error ? error.message : 'Failed to get store info',
        componentInstances: 0,
        documentCount: 0,
        isLoading: false
      }
    }
  }

  /**
   * Generate recommendations based on diagnostics
   */
  private generateRecommendations(leaderData: any, opfsData: any, broadcastData: any, libraryStore: any): string[] {
    const recommendations: string[] = []

    // Leader election recommendations
    if (leaderData.hasError || leaderData.initializationState === 'failed') {
      recommendations.push('Leader election failed - try window.__libraryDebug.resetState() and restart')
    }
    if (leaderData.retryCount > 0) {
      recommendations.push(`Leader election retried ${leaderData.retryCount} times - check network connectivity`)
    }
    if (!leaderData.isLeader && !leaderData.hasHeartbeat) {
      recommendations.push('No active leader found - try window.__libraryDebug.attemptLeadership()')
    }

    // OPFS recommendations
    if (opfsData.hasFailed) {
      recommendations.push('OPFS initialization failed - try window.__libraryDebug.forceReinitialize()')
    }
    if (opfsData.error) {
      recommendations.push(`OPFS error: ${opfsData.error} - check browser storage permissions`)
    }
    if (opfsData.retryCount > 0) {
      recommendations.push(`OPFS retried ${opfsData.retryCount} times - storage may be unavailable`)
    }

    // Broadcast channel recommendations
    if (!broadcastData.isReady) {
      recommendations.push('Broadcast channel not ready - running in single-tab mode')
    }
    if (broadcastData.hasError) {
      recommendations.push('Broadcast channel error - check browser privacy settings')
    }
    if (broadcastData.queuedMessagesCount > 10) {
      recommendations.push('High message queue - handlers may not be registered properly')
    }

    // Library store recommendations
    if (libraryStore.hasError) {
      recommendations.push('Library store has error - try refreshing the page')
    }
    if (libraryStore.componentInstances > 1) {
      recommendations.push('Multiple component instances detected - check for memory leaks')
    }

    // Add positive recommendations when everything looks good
    if (recommendations.length === 0) {
      recommendations.push('All systems operating normally ✅')
    }

    return recommendations
  }

  /**
   * Determine overall system status
   */
  private determineStatus(leaderData: any, opfsData: any, broadcastData: any, libraryStore: any): 'healthy' | 'degraded' | 'failed' | 'unknown' {
    let failures = 0
    let warnings = 0

    // Check leader election
    if (leaderData.error || leaderData.initializationState === 'failed') failures++
    else if (leaderData.retryCount > 0 || !leaderData.isLeader) warnings++

    // Check OPFS
    if (opfsData.error || opfsData.hasFailed) failures++
    else if (opfsData.retryCount > 0) warnings++

    // Check broadcast channel
    if (broadcastData.error) failures++
    else if (!broadcastData.isReady || broadcastData.queuedMessagesCount > 5) warnings++

    // Check library store
    if (libraryStore.hasError) failures++

    if (failures > 0) return 'failed'
    if (warnings > 0) return 'degraded'
    return 'healthy'
  }

  /**
   * Attempt automatic recovery
   */
  async attemptRecovery(): Promise<string> {
    logLibraryStore.info('Attempting automatic recovery')
    
    try {
      const diagnostics = await this.runDiagnostics()
      const actions: string[] = []

      // Reset failed components
      if (diagnostics.leaderElection.hasError || diagnostics.leaderElection.initializationState === 'failed') {
        leaderElection.resetInitialization()
        actions.push('Reset leader election')
      }

      if (diagnostics.opfs.hasFailed) {
        opfsManager.resetInitialization()
        actions.push('Reset OPFS manager')
      }

      // Try to reinitialize
      if (actions.length > 0) {
        logLibraryStore.info('Recovery actions performed', { actions })
        
        // Wait a moment for systems to reset
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // Check if recovery worked
        const postRecoveryDiagnostics = await this.runDiagnostics()
        
        if (postRecoveryDiagnostics.status === 'healthy') {
          return `Recovery successful! Actions: ${actions.join(', ')}`
        } else {
          return `Partial recovery. Actions: ${actions.join(', ')}. Status: ${postRecoveryDiagnostics.status}`
        }
      } else {
        return 'No recovery actions needed - system appears healthy'
      }

    } catch (error) {
      return `Recovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  /**
   * Get diagnostic history
   */
  getDiagnosticHistory(): LibraryDiagnostics[] {
    return [...this.diagnostics]
  }

  /**
   * Clear diagnostic history
   */
  clearHistory(): void {
    this.diagnostics = []
    logLibraryStore.info('Diagnostic history cleared')
  }
}

// Export singleton instance
export const libraryDebugger = LibraryDebugger.getInstance()

// Add to global debug utilities
if (typeof window !== 'undefined') {
  (window as any).__librarySystemDebug = {
    // Comprehensive diagnostics
    diagnose: async (options?: DebugOptions) => {
      try {
        const result = await libraryDebugger.runDiagnostics(options)
        console.log('Library System Diagnostics:', result)
        return result
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Unknown error' }
      }
    },

    // Automatic recovery
    recover: async () => {
      try {
        const result = await libraryDebugger.attemptRecovery()
        console.log('Library Recovery Result:', result)
        return result
      } catch (error) {
        return `Recovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    },

    // Diagnostic history
    getHistory: () => libraryDebugger.getDiagnosticHistory(),
    clearHistory: () => {
      libraryDebugger.clearHistory()
      return 'Diagnostic history cleared'
    },

    // Quick status check
    status: async () => {
      const diagnostics = await libraryDebugger.runDiagnostics()
      return {
        status: diagnostics.status,
        leader: diagnostics.leaderElection.isLeader,
        opfsReady: diagnostics.opfs.isReady,
        broadcastReady: diagnostics.broadcastChannel.isReady,
        errors: [
          diagnostics.leaderElection.error,
          diagnostics.opfs.error,
          diagnostics.broadcastChannel.error,
          diagnostics.libraryStore.errorMessage
        ].filter(Boolean)
      }
    }
  }

  console.log('[LibrarySystem] Comprehensive debug utilities available at window.__librarySystemDebug')
  console.log('[LibrarySystem] Try: await window.__librarySystemDebug.diagnose() for full system check')
  console.log('[LibrarySystem] Try: await window.__librarySystemDebug.recover() for automatic recovery')
  console.log('[LibrarySystem] Try: await window.__librarySystemDebug.status() for quick status check')
}