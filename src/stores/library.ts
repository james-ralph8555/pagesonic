/**
 * Library Store with SolidJS Reactive State
 * Manages library data and cross-tab synchronization
 */

import { 
  createSignal, 
  onMount, 
  onCleanup,
  batch
} from 'solid-js'
import { 
  LibraryIndex, 
  DocumentMetadata, 
  BookmarksFile, 
  UserSettings, 
  ReaderSettings,
  LibraryMessage,
  LeaderInfo,
  DocumentId,
  LibraryError,
  LibraryErrorCodes,
  ImportProgress as LibraryImportProgress
} from '@/types/library'
import { opfsManager } from '@/utils/opfs'
import { leaderElection } from '@/utils/leader-election'
import { broadcastChannel } from '@/utils/broadcast-channel'
import { logLibraryStore } from '@/utils/logger'
import { importFile, importFiles, importFolder, ImportProgress, ImportResult } from '@/utils/import'

interface LibraryState {
  // Data
  index: LibraryIndex
  currentDocument: DocumentMetadata | null
  currentBookmarks: BookmarksFile | null
  userSettings: UserSettings
  readerSettings: ReaderSettings
  conversions: Record<string, any>
  
  // UI State
  isLoading: boolean
  isInitialized: boolean
  searchQuery: string
  selectedTags: string[]
  sortBy: 'title' | 'author' | 'date' | 'size' | 'progress'
  sortOrder: 'asc' | 'desc'
  viewMode: 'grid' | 'list'
  
  // Import state
  isImporting: boolean
  importProgress: ImportProgress | null
  
  // Leadership state
  isLeader: boolean
  leaderInfo: LeaderInfo | null
  
  // Error state
  error: string | null
}

const [state, setState] = createSignal<LibraryState>({
  index: {},
  currentDocument: null,
  currentBookmarks: null,
  userSettings: {
    theme: 'auto',
    language: 'en',
    autoImport: false,
    autoConvert: false,
    defaultFormat: 'pdf',
    libraryView: 'grid',
    sortBy: 'title',
    sortOrder: 'asc',
    itemsPerPage: 20,
    showCovers: true,
    autoBackup: false
  },
  readerSettings: {
    fontSize: 16,
    lineHeight: 1.6,
    fontFamily: 'system-ui',
    margin: 20,
    backgroundColor: '#ffffff',
    textColor: '#000000',
    scrollMode: 'paginated',
    autoBookmark: true,
    syncProgress: true
  },
  conversions: {},
  
  isLoading: false,
  isInitialized: false,
  searchQuery: '',
  selectedTags: [],
  sortBy: 'title',
  sortOrder: 'asc',
  viewMode: 'grid',
  
  isImporting: false,
  importProgress: null,
  
  isLeader: false,
  leaderInfo: null,
  
  error: null
})

// Global initialization promise to prevent concurrent initializations
let initializationPromise: Promise<void> | null = null
let initializationInProgress = false
let hasCleanedUp = false // Track if library has been cleaned up to prevent re-initialization
let componentInstances = 0 // Track how many component instances are active

export const useLibrary = () => {
  let cleanupFunctions: (() => void)[] = []

  // Track component instance
  componentInstances++
  const instanceId = Math.random().toString(36).substr(2, 9)
  logLibraryStore.debug('Library component instance created', { 
    totalInstances: componentInstances,
    instanceId
  })

  // Initialize the library
  const initialize = async () => {
    // If we have multiple instances and one is already initialized, just return
    if (state().isInitialized && componentInstances > 1) {
      logLibraryStore.debug('Library already initialized for another instance, reusing')
      return
    }

    // Additional check to prevent re-initialization when component re-mounts after cleanup
    if (state().isInitialized && hasCleanedUp) {
      logLibraryStore.info('Library was cleaned up, re-initializing for new component instance')
      // Reset state for fresh initialization
      setState(prev => ({ ...prev, isInitialized: false, isLeader: false, leaderInfo: null }))
      hasCleanedUp = false
    }

    if (state().isInitialized) {
      logLibraryStore.debug('Library already initialized, skipping')
      return
    }

    // If initialization is already in progress, wait for it
    if (initializationPromise) {
      logLibraryStore.debug('Library initialization already in progress, waiting...')
      await initializationPromise
      return
    }

    // Start initialization if not already in progress
    if (!initializationInProgress) {
      initializationInProgress = true
      initializationPromise = performInitialization()
    }

    try {
      await initializationPromise
    } finally {
      initializationInProgress = false
      initializationPromise = null
    }
  }

  // Separate function for the actual initialization logic
  const performInitialization = async () => {
    logLibraryStore.startTimer('initialize', 'Library initialization')
    logLibraryStore.info('Starting library initialization')
    
    setState(prev => ({ ...prev, isLoading: true, error: null }))

    let opfsInitialized = false
    let leaderElectionSetup = false
    let fallbackMode = false

    try {
      // Initialize OPFS with fallback handling
      logLibraryStore.debug('Initializing OPFS')
      try {
        await opfsManager.initialize()
        opfsInitialized = true
      } catch (opfsError) {
        logLibraryStore.error('OPFS initialization failed, attempting fallback mode', opfsError instanceof Error ? opfsError : new Error(String(opfsError)))
        
        // Try to reset and retry once
        if (opfsManager.hasFailed()) {
          logLibraryStore.info('OPFS failed, attempting reset and retry')
          opfsManager.resetInitialization()
          
          try {
            await opfsManager.initialize()
            opfsInitialized = true
            logLibraryStore.info('OPFS initialization succeeded after reset')
          } catch (retryError) {
            logLibraryStore.error('OPFS retry also failed, entering limited mode', retryError instanceof Error ? retryError : new Error(String(retryError)))
            fallbackMode = true
          }
        } else {
          fallbackMode = true
        }
      }

      // Load initial data (only if OPFS is available)
      let index: LibraryIndex = {}
      let userSettings: UserSettings = state().userSettings
      let readerSettings: ReaderSettings = state().readerSettings
      
      if (opfsInitialized) {
        try {
          logLibraryStore.debug('Loading initial data from OPFS')
          const loadedData = await Promise.all([
            opfsManager.readIndex(),
            opfsManager.readUserSettings(),
            opfsManager.readReaderSettings()
          ])
          
          index = loadedData[0]
          userSettings = loadedData[1]
          readerSettings = loadedData[2]

          logLibraryStore.info('Data loaded successfully', { 
            documentCount: Object.keys(index).length,
            userSettingsLoaded: !!userSettings,
            readerSettingsLoaded: !!readerSettings
          })
        } catch (dataError) {
          logLibraryStore.warn('Failed to load some data, using defaults', dataError instanceof Error ? dataError : new Error(String(dataError)))
          // Continue with defaults
        }
      } else {
        logLibraryStore.info('OPFS not available, using default settings in offline mode')
      }

      // Setup broadcast channel handlers
      logLibraryStore.debug('Setting up broadcast channel handlers')
      try {
        setupBroadcastHandlers()
      } catch (broadcastError) {
        logLibraryStore.warn('Failed to setup broadcast handlers, continuing in single-tab mode', broadcastError instanceof Error ? broadcastError : new Error(String(broadcastError)))
      }

      // Start leader election
      logLibraryStore.debug('Setting up leader election')
      try {
        await setupLeaderElection()
        leaderElectionSetup = true
      } catch (leaderError) {
        logLibraryStore.warn('Leader election failed, continuing in single-tab mode', leaderError instanceof Error ? leaderError : new Error(String(leaderError)))
      }

      // Update state with whatever we successfully loaded
      batch(() => {
        setState(prev => ({
          ...prev,
          index,
          userSettings,
          readerSettings,
          viewMode: userSettings.libraryView,
          sortBy: userSettings.sortBy,
          sortOrder: userSettings.sortOrder,
          isInitialized: true,
          isLoading: false,
          error: fallbackMode ? 'Library running in limited mode - some features may be unavailable' : null
        }))
      })

      logLibraryStore.endTimer('initialize', `Library initialization completed${fallbackMode ? ' in fallback mode' : ' successfully'}`)
      
      // Log final state for debugging
      logLibraryStore.info('Library initialization complete', {
        documentCount: Object.keys(index).length,
        isLeader: state().isLeader,
        leaderInfo: state().leaderInfo,
        tabId: leaderElection.getTabId(),
        opfsInitialized,
        leaderElectionSetup,
        fallbackMode
      })
      
    } catch (error) {
      logLibraryStore.error('Critical error in library initialization', error instanceof Error ? error : new Error(String(error)))
      setState(prev => ({
        ...prev,
        error: 'Library initialization failed. Please refresh the page.',
        isLoading: false
      }))
    }
  }

  // Setup leader election
  const setupLeaderElection = async () => {
    logLibraryStore.info('Setting up leader election callbacks')
    
    const callbacks = {
      onLeaderElected: (leaderInfo: LeaderInfo) => {
        logLibraryStore.info('🎉 This tab became leader', { tabId: leaderInfo.tabId })
        batch(() => {
          setState(prev => ({
            ...prev,
            isLeader: true,
            leaderInfo
          }))
        })
        
        logLibraryStore.debug('Broadcasting leader elected event')
        broadcastChannel.broadcastLeaderElected(leaderInfo)
      },
      
      onLeaderLost: () => {
        logLibraryStore.info('😞 This tab lost leadership')
        batch(() => {
          setState(prev => ({
            ...prev,
            isLeader: false,
            leaderInfo: null
          }))
        })
        
        logLibraryStore.debug('Broadcasting leader lost event')
        broadcastChannel.broadcastLeaderLost()
      },
      
      onHeartbeat: (leaderInfo: LeaderInfo) => {
        logLibraryStore.debug('💓 Received leader heartbeat', { leaderId: leaderInfo.tabId })
        setState(prev => ({ ...prev, leaderInfo }))
      }
    }

    leaderElection.setCallbacks(callbacks)
    
    // Check if any leader currently exists
    logLibraryStore.info('Checking for existing leadership')
    try {
      // Check if leader election is already ready
      if (leaderElection.isReady()) {
        logLibraryStore.info('Leader election already ready, checking status')
        const info = leaderElection.getDebugInfo()
        if (info.isLeader) {
          logLibraryStore.info('This tab is already the leader')
          return
        }
      }
      
      const hasLeader = await leaderElection.checkLeaderStatus()
      logLibraryStore.info('Existing leadership check completed', { hasLeader })
      
      if (hasLeader) {
        logLibraryStore.info('Active leader found, entering follower mode and waiting for leadership')
        // If there's already a leader, start the normal election process (will wait)
        await leaderElection.startElection()
      } else {
        logLibraryStore.info('No active leader found, attempting to acquire leadership')
        // If no leader exists, try to acquire leadership immediately
        const acquired = await leaderElection.attemptLeadership()
        if (!acquired) {
          logLibraryStore.info('Leadership acquisition failed, another tab may have taken it')
          // If immediate acquisition failed, start normal election process
          await leaderElection.startElection()
        } else {
          logLibraryStore.info('🎉 Successfully acquired leadership on first attempt')
        }
      }
      
      logLibraryStore.info('Leader election process completed successfully')
      
      // Perform final state synchronization to ensure consistency
      await synchronizeLeaderState()
      
    } catch (error) {
      logLibraryStore.error('Failed to start leader election', error instanceof Error ? error : new Error(String(error)))
      // Don't throw - allow the library to function in follower mode
      logLibraryStore.warn('Leader election failed, continuing in limited mode')
      
      // Even if election failed, try to sync whatever state we have
      try {
        await synchronizeLeaderState()
      } catch (syncError) {
        logLibraryStore.warn('Failed to sync leader state after election failure', syncError instanceof Error ? syncError : new Error(String(syncError)))
      }
    }
  }

  // Setup broadcast channel message handlers
  const setupBroadcastHandlers = () => {
    logLibraryStore.debug('Setting up broadcast channel handlers')
    
    // Handle leader notifications
    const unregisterLeaderElected = broadcastChannel.register(
      'LEADER_ELECTED',
      (message: LibraryMessage) => {
        const leaderInfo = message.payload as LeaderInfo
        logLibraryStore.debug('Received LEADER_ELECTED message', { leaderInfo, myTabId: leaderElection.getTabId() })
        if (leaderInfo.tabId !== leaderElection.getTabId()) {
          setState(prev => ({
            ...prev,
            leaderInfo,
            isLeader: false
          }))
        }
      }
    )

    const unregisterLeaderLost = broadcastChannel.register(
      'LEADER_LOST',
      () => {
        setState(prev => ({
          ...prev,
          leaderInfo: null,
          isLeader: false
        }))
      }
    )

    const unregisterHeartbeat = broadcastChannel.register(
      'HEARTBEAT',
      (message: LibraryMessage) => {
        const leaderInfo = message.payload as LeaderInfo
        if (leaderInfo.tabId !== leaderElection.getTabId()) {
          setState(prev => ({ ...prev, leaderInfo }))
        }
      }
    )

    // Handle data updates
    const unregisterDocumentsUpdate = broadcastChannel.register(
      'GET_DOCUMENTS',
      broadcastChannel.createRequestHandler(async () => {
        return state().index
      })
    )

    const unregisterMetadataUpdate = broadcastChannel.register(
      'GET_METADATA',
      broadcastChannel.createRequestHandler(async (payload: { docId: string }) => {
        return await opfsManager.readDocumentMetadata(payload.docId)
      })
    )

    const unregisterBookmarksUpdate = broadcastChannel.register(
      'GET_BOOKMARKS',
      broadcastChannel.createRequestHandler(async (payload: { docId: string }) => {
        return await opfsManager.readDocumentBookmarks(payload.docId)
      })
    )

    const unregisterSettingsUpdate = broadcastChannel.register(
      'GET_SETTINGS',
      broadcastChannel.createRequestHandler(async (payload: { type: 'user' | 'reader' }) => {
        return payload.type === 'user' ? state().userSettings : state().readerSettings
      })
    )

    cleanupFunctions.push(
      unregisterLeaderElected,
      unregisterLeaderLost,
      unregisterHeartbeat,
      unregisterDocumentsUpdate,
      unregisterMetadataUpdate,
      unregisterBookmarksUpdate,
      unregisterSettingsUpdate
    )
  }

  // Computed values

  // Get sorted and filtered library items
  const getLibraryItems = () => {
    const items = Object.values(state().index)
    const query = state().searchQuery.toLowerCase().trim()
    const selectedTags = state().selectedTags

    return items
      .filter(item => {
        // Filter by search query
        if (query) {
          const matchesTitle = item.title.toLowerCase().includes(query)
          const matchesAuthors = item.authors.some(author => 
            author.toLowerCase().includes(query)
          )
          if (!matchesTitle && !matchesAuthors) return false
        }

        // Filter by tags
        if (selectedTags.length > 0) {
          const itemTags = item.tags || []
          const hasAllTags = selectedTags.every(tag => itemTags.includes(tag))
          if (!hasAllTags) return false
        }

        return true
      })
      .sort((a, b) => {
        const sortBy = state().sortBy
        const sortOrder = state().sortOrder
        let comparison = 0

        switch (sortBy) {
          case 'title':
            comparison = a.title.localeCompare(b.title)
            break
          case 'author':
            comparison = (a.authors[0] || '').localeCompare(b.authors[0] || '')
            break
          case 'date':
            comparison = a.updated - b.updated
            break
          case 'size':
            comparison = (a.size || 0) - (b.size || 0)
            break
          case 'progress':
            comparison = (a.progress || 0) - (b.progress || 0)
            break
        }

        return sortOrder === 'asc' ? comparison : -comparison
      })
  }

  // Get document metadata
  const getDocumentMetadata = async (docId: DocumentId): Promise<DocumentMetadata | null> => {
    // Check cache first
    if (state().currentDocument?.id === docId) {
      return state().currentDocument
    }

    try {
      if (state().isLeader) {
        // Leader can read directly from OPFS
        const metadata = await opfsManager.readDocumentMetadata(docId)
        setState(prev => ({ ...prev, currentDocument: metadata }))
        return metadata
      } else {
        // Follower requests from leader
        const response = await broadcastChannel.requestGetMetadata(docId)
        if (response.success && response.data) {
          const metadata = response.data as DocumentMetadata
          setState(prev => ({ ...prev, currentDocument: metadata }))
          return metadata
        }
      }
    } catch (error) {
      console.error(`Failed to get metadata for document ${docId}:`, error)
    }

    return null
  }

  // Get document bookmarks
  const getDocumentBookmarks = async (docId: DocumentId): Promise<BookmarksFile | null> => {
    // Check cache first
    if (state().currentBookmarks?.docId === docId) {
      return state().currentBookmarks
    }

    try {
      if (state().isLeader) {
        // Leader can read directly from OPFS
        const bookmarks = await opfsManager.readDocumentBookmarks(docId)
        setState(prev => ({ ...prev, currentBookmarks: bookmarks }))
        return bookmarks
      } else {
        // Follower requests from leader
        const response = await broadcastChannel.requestGetBookmarks(docId)
        if (response.success && response.data) {
          const bookmarks = response.data as BookmarksFile
          setState(prev => ({ ...prev, currentBookmarks: bookmarks }))
          return bookmarks
        }
      }
    } catch (error) {
      console.error(`Failed to get bookmarks for document ${docId}:`, error)
    }

    return null
  }

  // Update user settings
  const updateUserSettings = async (settings: Partial<UserSettings>): Promise<void> => {
    logLibraryStore.startTimer('updateUserSettings', 'Update user settings')
    logLibraryStore.debug('Updating user settings', { settings })
    
    try {
      const newSettings = { ...state().userSettings, ...settings }
      
      if (state().isLeader) {
        logLibraryStore.debug('Writing user settings directly to OPFS (leader)')
        await opfsManager.writeUserSettings(newSettings)
      } else {
        logLibraryStore.debug('Requesting leader to update user settings (follower)')
        await broadcastChannel.requestUpdateSettings({
          settings,
          type: 'user'
        })
      }

      setState(prev => ({ ...prev, userSettings: newSettings }))
      logLibraryStore.endTimer('updateUserSettings', 'User settings updated successfully')
    } catch (error) {
      logLibraryStore.error('Failed to update user settings', error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  // Update reader settings
  const updateReaderSettings = async (settings: Partial<ReaderSettings>): Promise<void> => {
    try {
      const newSettings = { ...state().readerSettings, ...settings }
      
      if (state().isLeader) {
        // Leader writes directly to OPFS
        await opfsManager.writeReaderSettings(newSettings)
      } else {
        // Follower requests leader to update
        await broadcastChannel.requestUpdateSettings({
          settings,
          type: 'reader'
        })
      }

      setState(prev => ({ ...prev, readerSettings: newSettings }))
    } catch (error) {
      console.error('Failed to update reader settings:', error)
      throw error
    }
  }

  // Set search query
  const setSearchQuery = (query: string) => {
    setState(prev => ({ ...prev, searchQuery: query }))
  }

  // Set selected tags
  const setSelectedTags = (tags: string[]) => {
    setState(prev => ({ ...prev, selectedTags: tags }))
  }

  // Set sort options
  const setSortOptions = (sortBy: string, sortOrder: 'asc' | 'desc') => {
    batch(() => {
      setState(prev => ({ 
        ...prev, 
        sortBy: sortBy as any,
        sortOrder 
      }))
      
      // Persist to user settings
      updateUserSettings({ sortBy: sortBy as any, sortOrder })
    })
  }

  // Set view mode
  const setViewMode = (mode: 'grid' | 'list') => {
    batch(() => {
      setState(prev => ({ ...prev, viewMode: mode }))
      updateUserSettings({ libraryView: mode })
    })
  }

  // Clear error
  const clearError = () => {
    setState(prev => ({ ...prev, error: null }))
  }

  // Refresh library data
  const refreshLibrary = async () => {
    if (!state().isLeader) return

    try {
      setState(prev => ({ ...prev, isLoading: true }))
      const index = await opfsManager.readIndex()
      setState(prev => ({ 
        ...prev, 
        index, 
        isLoading: false 
      }))
    } catch (error) {
      console.error('Failed to refresh library:', error)
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to refresh library',
        isLoading: false
      }))
    }
  }

  // Get storage usage
  const getStorageUsage = async () => {
    return await opfsManager.getStorageUsage()
  }

  // Import methods

  // Import a single file
  const importSingleFile = async (file: File): Promise<ImportResult> => {
    logLibraryStore.info(`Starting import of file: ${file.name}`)
    
    try {
      setState(prev => ({ 
        ...prev, 
        isImporting: true, 
        error: null,
        importProgress: { stage: 'validating', progress: 0, currentFile: file.name }
      }))

      // Ensure leadership with retry logic (simplified for single file)
      let hasLeadership = false
      try {
        hasLeadership = await ensureLeadership()
        if (!hasLeadership) {
          setState(prev => ({ 
            ...prev, 
            importProgress: { 
              ...prev.importProgress!, 
              progress: 5,
              error: 'Acquiring leadership...'
            }
          }))
          
          // Try once more with force fallback
          await (window as any).__libraryDebug?.quickFix()
          await new Promise(resolve => setTimeout(resolve, 500))
          hasLeadership = await ensureLeadership()
        }
      } catch (leadershipError) {
        logLibraryStore.warn('Leadership acquisition failed for single file import', leadershipError instanceof Error ? leadershipError : new Error(String(leadershipError)))
        
        // Check if we can proceed in single-tab mode
        try {
          const lockInfo = await leaderElection.getLockInfo()
          const hasActiveLocks = lockInfo.held.length > 0 || lockInfo.pending.length > 0
          if (!hasActiveLocks) {
            logLibraryStore.info('No active locks, proceeding with single file import')
            hasLeadership = true
          }
        } catch (lockError) {
          // Leadership check failed
        }
      }

      if (!hasLeadership) {
        throw new LibraryError('Import requires leader tab. Please refresh the page and try again.', LibraryErrorCodes.LEADER_REQUIRED)
      }

      const result = await importFile(file, (progress) => {
        setState(prev => ({ ...prev, importProgress: progress }))
      })

      if (result.success) {
        // Refresh library index to show the new document
        try {
          await refreshLibrary()
        } catch (refreshError) {
          logLibraryStore.warn('Failed to refresh library after single file import', refreshError instanceof Error ? refreshError : new Error(String(refreshError)))
        }
        
        setState(prev => ({ 
          ...prev, 
          isImporting: false, 
          importProgress: { stage: 'complete', progress: 100, currentFile: file.name }
        }))

        logLibraryStore.info(`Successfully imported file: ${file.name}`, { documentId: result.documentId })
      } else {
        setState(prev => ({ 
          ...prev, 
          isImporting: false, 
          error: result.error || 'Import failed',
          importProgress: { 
            stage: 'error', 
            progress: 0, 
            currentFile: file.name, 
            error: result.error 
          }
        }))
      }

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown import error'
      logLibraryStore.error(`Import failed for file: ${file.name}`, error instanceof Error ? error : new Error(String(error)))
      
      setState(prev => ({ 
        ...prev, 
        isImporting: false, 
        error: errorMessage,
        importProgress: { 
          stage: 'error', 
          progress: 0, 
          currentFile: file.name, 
          error: errorMessage 
        }
      }))

      return { success: false, error: errorMessage }
    }
  }

  // Import multiple files
  const importMultipleFiles = async (files: FileList | File[]): Promise<{ results: ImportResult[]; successful: number; failed: number }> => {
    const fileArray = Array.from(files)
    logLibraryStore.info(`Starting batch import of ${fileArray.length} files`)

    try {
      setState(prev => ({ 
        ...prev, 
        isImporting: true, 
        error: null,
        importProgress: { 
          stage: 'validating', 
          progress: 0, 
          totalFiles: fileArray.length 
        }
      }))

      // Ensure leadership with retry logic
      let hasLeadership = false
      let leadershipAttempts = 0
      const maxLeadershipAttempts = 3
      
      while (leadershipAttempts < maxLeadershipAttempts && !hasLeadership) {
        leadershipAttempts++
        
        try {
          hasLeadership = await ensureLeadership()
          
          if (!hasLeadership) {
            logLibraryStore.warn(`Leadership attempt ${leadershipAttempts} failed, retrying...`)
            
            // Update progress to show leadership acquisition attempt
            setState(prev => ({ 
              ...prev, 
              importProgress: { 
                ...prev.importProgress!, 
                progress: 5,
                error: leadershipAttempts < maxLeadershipAttempts 
                  ? `Acquiring leadership (attempt ${leadershipAttempts}/${maxLeadershipAttempts})...`
                  : 'Failed to acquire leadership'
              } as LibraryImportProgress
            } as LibraryState))
            
            if (leadershipAttempts < maxLeadershipAttempts) {
              // Wait and try again
              await new Promise(resolve => setTimeout(resolve, 1000))
              
              // Try to force leadership as last resort
              if (leadershipAttempts === maxLeadershipAttempts - 1) {
                logLibraryStore.warn('Final attempt: trying to force leadership')
                try {
                  await (window as any).__libraryDebug?.quickFix()
                  await new Promise(resolve => setTimeout(resolve, 500))
                  hasLeadership = await ensureLeadership()
                } catch (forceError) {
                  logLibraryStore.error('Force leadership attempt failed', forceError instanceof Error ? forceError : new Error(String(forceError)))
                }
              }
            }
          }
        } catch (error) {
          logLibraryStore.error(`Leadership attempt ${leadershipAttempts} threw error`, error instanceof Error ? error : new Error(String(error)))
          
          // Continue trying if leadership check throws
          if (leadershipAttempts < maxLeadershipAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }
      }

      // If still no leadership after all attempts, try to proceed anyway in single-tab mode
      if (!hasLeadership) {
        logLibraryStore.warn('Unable to acquire leadership, attempting to proceed in single-tab mode')
        
        // Check if we're likely in a single-tab scenario
        try {
          const lockInfo = await leaderElection.getLockInfo()
          const hasActiveLocks = lockInfo.held.length > 0 || lockInfo.pending.length > 0
          
          if (!hasActiveLocks) {
            logLibraryStore.info('No active locks detected, proceeding with import')
            hasLeadership = true // Override for single-tab mode
          } else {
            throw new LibraryError(
              `Import requires leader tab after ${maxLeadershipAttempts} attempts. Please try refreshing the page or closing other tabs.`, 
              LibraryErrorCodes.LEADER_REQUIRED
            )
          }
        } catch (lockError) {
          throw new LibraryError(
            `Import requires leader tab after ${maxLeadershipAttempts} attempts. Please refresh the page and try again.`, 
            LibraryErrorCodes.LEADER_REQUIRED
          )
        }
      }

      // Now proceed with import
      setState(prev => ({ 
        ...prev, 
        importProgress: { 
          ...prev.importProgress!, 
          stage: 'validating',
          progress: 10,
          error: undefined
        } as LibraryImportProgress
      } as LibraryState))

      const results = await importFiles(fileArray, (progress) => {
        setState(prev => ({ ...prev, importProgress: progress }))
      })

      // Refresh library index to show new documents
      if (hasLeadership) {
        try {
          await refreshLibrary()
        } catch (refreshError) {
          logLibraryStore.warn('Failed to refresh library after import', refreshError instanceof Error ? refreshError : new Error(String(refreshError)))
        }
      }

      const finalProgress = results.successful > 0 
        ? { stage: 'complete' as const, progress: 100, totalFiles: fileArray.length }
        : { 
            stage: 'error' as const, 
            progress: 0, 
            totalFiles: fileArray.length,
            error: results.failed > 0 ? 'Some files failed to import' : 'All files failed to import'
          } as LibraryImportProgress

      setState(prev => ({ 
        ...prev, 
        isImporting: false, 
        importProgress: finalProgress
      } as LibraryState))

      logLibraryStore.info(`Batch import completed`, { 
        total: fileArray.length,
        successful: results.successful,
        failed: results.failed,
        hasLeadership
      })

      return results
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown import error'
      logLibraryStore.error(`Batch import failed`, error instanceof Error ? error : new Error(String(error)))
      
      setState(prev => ({ 
        ...prev, 
        isImporting: false, 
        error: errorMessage,
        importProgress: { 
          stage: 'error', 
          progress: 0, 
          totalFiles: fileArray.length,
          error: errorMessage 
        }
      }))

      return { 
        results: [], 
        successful: 0, 
        failed: fileArray.length 
      }
    }
  }

  // Import folder
  const importDirectory = async (directoryHandle: FileSystemDirectoryHandle): Promise<{ results: ImportResult[]; successful: number; failed: number }> => {
    // Ensure leadership before proceeding with import
    const hasLeadership = await ensureLeadership()
    if (!hasLeadership) {
      throw new LibraryError('Import requires leader tab. Please refresh the page and try again.', LibraryErrorCodes.LEADER_REQUIRED)
    }

    logLibraryStore.info(`Starting directory import: ${directoryHandle.name}`)

    try {
      setState(prev => ({ 
        ...prev, 
        isImporting: true, 
        error: null,
        importProgress: { 
          stage: 'validating', 
          progress: 0,
          currentFile: directoryHandle.name
        }
      }))

      const results = await importFolder(directoryHandle, (progress) => {
        setState(prev => ({ ...prev, importProgress: progress }))
      })

      // Refresh library index to show new documents
      await refreshLibrary()

      const finalProgress = results.successful > 0 
        ? { stage: 'complete' as const, progress: 100 }
        : { 
            stage: 'error' as const, 
            progress: 0,
            error: 'No files were successfully imported'
          } as LibraryImportProgress

      setState(prev => ({ 
        ...prev, 
        isImporting: false, 
        importProgress: finalProgress
      } as LibraryState))

      logLibraryStore.info(`Directory import completed`, { 
        directory: directoryHandle.name,
        successful: results.successful,
        failed: results.failed
      })

      return results
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown import error'
      logLibraryStore.error(`Directory import failed`, error instanceof Error ? error : new Error(String(error)))
      
      setState(prev => ({ 
        ...prev, 
        isImporting: false, 
        error: errorMessage,
        importProgress: { 
          stage: 'error', 
          progress: 0,
          error: errorMessage 
        }
      }))

      return { 
        results: [], 
        successful: 0, 
        failed: 0 
      }
    }
  }

  // Clear import progress
  const clearImportProgress = () => {
    setState(prev => ({ 
      ...prev, 
      isImporting: false, 
      importProgress: null 
    }))
  }

  // Synchronize leader state between election system and library store
  const synchronizeLeaderState = async (): Promise<boolean> => {
    logLibraryStore.info('Synchronizing leader state', { 
      isLeaderElection: leaderElection.isCurrentLeader(),
      isLeaderStore: state().isLeader,
      tabId: leaderElection.getTabId()
    })

    // Wait a moment for any pending callbacks to propagate
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Check multiple times to ensure consistency
    let isActuallyLeader = false
    let attempts = 0
    const maxAttempts = 3
    
    while (attempts < maxAttempts) {
      attempts++
      isActuallyLeader = leaderElection.isCurrentLeader()
      
      logLibraryStore.debug(`Leadership check attempt ${attempts}: ${isActuallyLeader}`)
      
      // If we get a consistent result, break early
      if (attempts > 1 && isActuallyLeader === leaderElection.isCurrentLeader()) {
        break
      }
      
      // Wait between checks
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    const storeThinksIsLeader = state().isLeader

    if (isActuallyLeader !== storeThinksIsLeader) {
      logLibraryStore.warn('Leader state mismatch detected, synchronizing', {
        isActuallyLeader,
        storeThinksIsLeader,
        attempts
      })

      if (isActuallyLeader) {
        const leaderInfo = leaderElection.getLeaderInfo()
        if (leaderInfo) {
          logLibraryStore.info('Setting library store to leader state', { leaderInfo })
          batch(() => {
            setState(prev => ({
              ...prev,
              isLeader: true,
              leaderInfo
            }))
          })
        } else {
          logLibraryStore.warn('Leader election says we are leader but no leader info available')
          // Create fallback leader info
          const fallbackLeaderInfo = {
            id: leaderElection.getTabId(),
            timestamp: Date.now(),
            tabId: leaderElection.getTabId()
          }
          batch(() => {
            setState(prev => ({
              ...prev,
              isLeader: true,
              leaderInfo: fallbackLeaderInfo
            }))
          })
        }
      } else {
        logLibraryStore.info('Setting library store to follower state')
        batch(() => {
          setState(prev => ({
            ...prev,
            isLeader: false,
            leaderInfo: null
          }))
        })
      }

      // Wait for state update to propagate
      await new Promise(resolve => setTimeout(resolve, 50))
      
      // Verify the synchronization worked
      const finalLeaderState = state().isLeader
      if (finalLeaderState === isActuallyLeader) {
        logLibraryStore.info('Leader state synchronization completed successfully', {
          newIsLeader: finalLeaderState,
          leaderInfo: state().leaderInfo
        })
      } else {
        logLibraryStore.error('Leader state synchronization failed to update store', new Error('Expected leader state does not match actual'), {
          expected: isActuallyLeader,
          actual: finalLeaderState
        })
      }
      
      return true
    }

    logLibraryStore.debug('Leader state already synchronized')
    return false
  }

  // Ensure leadership with fallback recovery
  const ensureLeadership = async (): Promise<boolean> => {
    logLibraryStore.info('Ensuring leadership for import operation')

    // First, synchronize current state
    await synchronizeLeaderState()
    
    if (state().isLeader) {
      logLibraryStore.info('Leadership confirmed after synchronization')
      return true
    }

    logLibraryStore.warn('Not leader after sync, attempting to acquire leadership')
    
    // Try multiple approaches to acquire leadership
    const attempts = [
      { name: 'immediate acquisition', action: () => leaderElection.attemptLeadership() },
      { name: 'election process', action: () => leaderElection.startElection() },
      { name: 'force leadership', action: () => (window as any).__libraryDebug?.forceLeadership() }
    ]

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]
      logLibraryStore.info(`Leadership attempt ${i + 1}: ${attempt.name}`)
      
      try {
        if (i === 0) {
          // Immediate acquisition
          const acquired = await attempt.action()
          if (acquired) {
            logLibraryStore.info('Leadership acquired successfully')
            // Wait a moment for callbacks to propagate
            await new Promise(resolve => setTimeout(resolve, 200))
            await synchronizeLeaderState()
            if (state().isLeader) {
              return true
            }
          }
        } else if (i === 1) {
          // Full election process
          await attempt.action()
          // Wait for election to complete
          await new Promise(resolve => setTimeout(resolve, 1000))
          await synchronizeLeaderState()
          if (state().isLeader) {
            return true
          }
        } else if (i === 2) {
          // Force leadership (emergency)
          const result = await attempt.action()
          logLibraryStore.warn('Emergency force leadership result:', result)
          // Wait for force to take effect
          await new Promise(resolve => setTimeout(resolve, 500))
          await synchronizeLeaderState()
          if (state().isLeader) {
            logLibraryStore.warn('Leadership acquired via emergency override')
            return true
          }
        }
        
        // Wait between attempts
        if (i < attempts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 800))
        }
        
      } catch (error) {
        logLibraryStore.error(`Leadership attempt ${i + 1} failed`, error instanceof Error ? error : new Error(String(error)))
      }
    }

    logLibraryStore.error('Failed to ensure leadership after all attempts - import may not work')
    
    // Final state check and emergency fallback
    await synchronizeLeaderState()
    if (state().isLeader) {
      logLibraryStore.info('Leadership finally available after all attempts')
      return true
    }
    
    // As a last resort, try bypassing leadership check for single-tab scenarios
    try {
      const lockInfo = await leaderElection.getLockInfo()
      const hasActiveLocks = lockInfo.held.length > 0 || lockInfo.pending.length > 0
      
      if (!hasActiveLocks) {
        logLibraryStore.warn('No active locks detected, allowing import in single-tab mode')
        return true
      }
    } catch (error) {
      logLibraryStore.warn('Could not check lock info for fallback', error instanceof Error ? error : new Error(String(error)))
    }
    
    return false
  }

  // Lifecycle
  onMount(() => {
    logLibraryStore.info('Library component mounted')
    initialize()
  })

  onCleanup(() => {
    componentInstances--
    logLibraryStore.info('🧹 Library component cleanup called', { 
      isLeader: state().isLeader,
      tabId: leaderElection.getTabId(),
      visibility: document.visibilityState,
      remainingInstances: componentInstances,
      hasCleanedUp
    })
    
    // Only perform full cleanup if this is the last instance and the page is hidden
    // This prevents cleanup during view switching or component remounts
    if (componentInstances === 0 && document.visibilityState === 'hidden') {
      logLibraryStore.info('Last component instance and page hidden - performing full cleanup')
      hasCleanedUp = true
      
      // Cleanup all broadcast handlers
      cleanupFunctions.forEach(cleanup => cleanup())
      
      // Cleanup leader election
      leaderElection.cleanup()
      
      // Cleanup broadcast channel
      broadcastChannel.cleanup()
      
      // Reset initialization state for potential future re-initialization
      initializationInProgress = false
      initializationPromise = null
      
      logLibraryStore.info('Library cleanup completed')
    } else if (componentInstances === 0) {
      logLibraryStore.info('Last component instance, but page still visible - performing light cleanup')
      
      // Only cleanup handlers but keep systems running for potential re-mount
      cleanupFunctions.forEach(cleanup => cleanup())
      
      // Reset initialization state but keep leader election running
      setState(prev => ({ ...prev, isInitialized: false }))
    } else {
      logLibraryStore.info('Other component instances still active - deferring cleanup')
      // Only cleanup this instance's handlers
      cleanupFunctions.forEach(cleanup => cleanup())
    }
  })

  return {
    // State
    state,
    setState,
    
    // Computed
    getLibraryItems,
    
    // Actions
    initialize,
    refreshLibrary,
    getDocumentMetadata,
    getDocumentBookmarks,
    updateUserSettings,
    updateReaderSettings,
    setSearchQuery,
    setSelectedTags,
    setSortOptions,
    setViewMode,
    clearError,
    getStorageUsage,
    
    // Import actions
    importSingleFile,
    importMultipleFiles,
    importDirectory,
    clearImportProgress,
    
    // Leadership helpers
    isLeader: () => state().isLeader,
    getLeaderInfo: () => state().leaderInfo,
    synchronizeLeaderState,
    ensureLeadership,
    
    // Debug helpers
    getInstanceInfo: () => ({
      instanceId,
      totalInstances: componentInstances,
      hasCleanedUp
    })
  }
}

// Export debug functions for external access
export const getLibraryStoreDebugInfo = () => {
  const currentState = state()
  return {
    isInitialized: currentState.isInitialized,
    isLeader: currentState.isLeader,
    hasError: !!currentState.error,
    errorMessage: currentState.error,
    componentInstances,
    hasCleanedUp,
    documentCount: Object.keys(currentState.index).length,
    isLoading: currentState.isLoading
  }
}