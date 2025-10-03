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
  DocumentId
} from '@/types/library'
import { opfsManager } from '@/utils/opfs'
import { leaderElection } from '@/utils/leader-election'
import { broadcastChannel } from '@/utils/broadcast-channel'
import { logLibraryStore } from '@/utils/logger'

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
  
  isLeader: false,
  leaderInfo: null,
  
  error: null
})

export const useLibrary = () => {
  let cleanupFunctions: (() => void)[] = []

  // Initialize the library
  const initialize = async () => {
    if (state().isInitialized) {
      logLibraryStore.debug('Library already initialized, skipping')
      return
    }

    logLibraryStore.startTimer('initialize', 'Library initialization')
    logLibraryStore.info('Starting library initialization')
    
    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      // Initialize OPFS
      logLibraryStore.debug('Initializing OPFS')
      await opfsManager.initialize()

      // Load initial data
      logLibraryStore.debug('Loading initial data from OPFS')
      const [index, userSettings, readerSettings] = await Promise.all([
        opfsManager.readIndex(),
        opfsManager.readUserSettings(),
        opfsManager.readReaderSettings()
      ])

      logLibraryStore.info('Data loaded successfully', { 
        documentCount: Object.keys(index).length,
        userSettingsLoaded: !!userSettings,
        readerSettingsLoaded: !!readerSettings
      })

      // Start leader election
      logLibraryStore.debug('Setting up leader election')
      await setupLeaderElection()

      // Setup broadcast channel handlers
      logLibraryStore.debug('Setting up broadcast channel handlers')
      setupBroadcastHandlers()

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
          isLoading: false
        }))
      })

      logLibraryStore.endTimer('initialize', 'Library initialization completed successfully')
    } catch (error) {
      logLibraryStore.error('Failed to initialize library', error instanceof Error ? error : new Error(String(error)))
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to initialize library',
        isLoading: false
      }))
    }
  }

  // Setup leader election
  const setupLeaderElection = async () => {
    logLibraryStore.debug('Setting up leader election callbacks')
    
    const callbacks = {
      onLeaderElected: (leaderInfo: LeaderInfo) => {
        logLibraryStore.info('This tab became leader', { tabId: leaderInfo.tabId })
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
        logLibraryStore.info('This tab lost leadership')
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
        logLibraryStore.debug('Received leader heartbeat', { leaderId: leaderInfo.tabId })
        setState(prev => ({ ...prev, leaderInfo }))
      }
    }

    leaderElection.setCallbacks(callbacks)
    logLibraryStore.debug('Starting leader election process')
    await leaderElection.startElection()
  }

  // Setup broadcast channel message handlers
  const setupBroadcastHandlers = () => {
    // Handle leader notifications
    const unregisterLeaderElected = broadcastChannel.register(
      'LEADER_ELECTED',
      (message: LibraryMessage) => {
        const leaderInfo = message.payload as LeaderInfo
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

  // Lifecycle
  onMount(() => {
    initialize()
  })

  onCleanup(() => {
    // Cleanup all broadcast handlers
    cleanupFunctions.forEach(cleanup => cleanup())
    
    // Cleanup leader election
    leaderElection.cleanup()
    
    // Cleanup broadcast channel
    broadcastChannel.cleanup()
  })

  return {
    // State
    state,
    
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
    
    // Leadership helpers
    isLeader: () => state().isLeader,
    getLeaderInfo: () => state().leaderInfo
  }
}