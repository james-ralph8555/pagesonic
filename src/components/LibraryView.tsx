import { Component, createSignal, For, Show, onMount } from 'solid-js'
import { useLibrary } from '@/stores/library'
import { LibraryIndexItem } from '@/types/library'
import { GlassDropdownButton } from './GlassDropdownButton'

export const LibraryView: Component = () => {
  const {
    state,
    getLibraryItems,
    setSearchQuery,
    setSortOptions,
    setViewMode,
    clearError,
    getStorageUsage
  } = useLibrary()

  const [sortBy, setSortBy] = createSignal<'title' | 'author' | 'date' | 'size'>('title')
  const [sortOrder, setSortOrder] = createSignal<'asc' | 'desc'>('asc')
  const [storageUsage, setStorageUsage] = createSignal<{ used: number; quota: number; available: number } | null>(null)
  const [showDebug, setShowDebug] = createSignal(false)

  // Update sort when controls change
  const handleSortChange = () => {
    setSortOptions(sortBy(), sortOrder())
  }

  // Load storage usage on mount
  onMount(async () => {
    try {
      const usage = await getStorageUsage()
      setStorageUsage(usage)
    } catch (error) {
      console.warn('Failed to get storage usage:', error)
    }
  })

  // Format storage usage for display
  const formatStorageUsage = () => {
    const usage = storageUsage()
    if (!usage) return 'Unknown'
    
    const formatBytes = (bytes: number): string => {
      const units = ['B', 'KB', 'MB', 'GB']
      let size = bytes
      let unitIndex = 0
      
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024
        unitIndex++
      }
      
      return `${size.toFixed(1)} ${units[unitIndex]}`
    }
    
    return `Used: ${formatBytes(usage.used)} | Available: ${formatBytes(usage.available)}`
  }

  const libraryItems = () => getLibraryItems()

  return (
    <>
      {/* Top Navigation Rail */}
      <div class="library-top-rail">
        <GlassDropdownButton
          ariaLabel="Switch view"
          title="Switch view"
          class="rail-btn"
          align="start"
          selectedValue={'library'}
          icon={(
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          )}
          items={[
            { value: 'pdf', label: 'PDF Viewer' },
            { value: 'library', label: 'Library' },
            { value: 'settings', label: 'Settings' }
          ]}
          onSelect={(value) => {
            window.dispatchEvent(new CustomEvent('app:set-mode', { detail: value as 'pdf' | 'library' | 'settings' }))
          }}
        />
        <div class="rail-meta">
          <span>Library</span>
          <Show when={state().isLeader}>
            <span class="leader-badge">Leader</span>
          </Show>
        </div>
      </div>

      <div class="library-view">
        {/* Header */}
        <div class="library-header">
          <h2>Library</h2>
          <div class="library-stats">
            <span class="item-count">{libraryItems().length} items</span>
          </div>
        </div>

      {/* Error Display */}
      <Show when={state().error}>
        <div class="error">
          <p>{state().error}</p>
          <button onClick={clearError}>Dismiss</button>
        </div>
      </Show>

      {/* Loading State */}
      <Show when={state().isLoading}>
        <div class="loading">
          <p>Loading library...</p>
        </div>
      </Show>

      {/* Search and Filters */}
      <div class="library-controls">
        <div class="search-section">
          <input
            type="text"
            placeholder="Search library..."
            class="search-input"
            value={state().searchQuery}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
          />
        </div>

        <div class="filter-section">
          <div class="sort-controls">
            <select 
              value={sortBy()} 
              onChange={(e) => {
                setSortBy(e.currentTarget.value as any)
                handleSortChange()
              }}
            >
              <option value="title">Title</option>
              <option value="author">Author</option>
              <option value="date">Date Added</option>
              <option value="size">Size</option>
            </select>
            
            <select 
              value={sortOrder()} 
              onChange={(e) => {
                setSortOrder(e.currentTarget.value as any)
                handleSortChange()
              }}
            >
              <option value="asc">A-Z</option>
              <option value="desc">Z-A</option>
            </select>
          </div>

          <div class="view-controls">
            <button 
              class={state().viewMode === 'grid' ? 'active' : ''}
              onClick={() => setViewMode('grid')}
            >
              Grid
            </button>
            <button 
              class={state().viewMode === 'list' ? 'active' : ''}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Library Content */}
      <div class="library-content">
        <Show 
          when={libraryItems().length > 0}
          fallback={
            <div class="empty-library">
              <h3>No documents in library</h3>
              <p>Import documents to get started with your library.</p>
              <div class="import-actions">
                <button disabled>Import Files</button>
                <button disabled>Import Folder</button>
              </div>
            </div>
          }
        >
          <div class={`library-items library-items--${state().viewMode}`}>
            <For each={libraryItems()}>
              {(item) => (
                <LibraryItemCard item={item} viewMode={state().viewMode} />
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Storage Info */}
      <div class="library-footer">
        <div class="storage-info">
          <span>Storage: {formatStorageUsage()}</span>
          <button 
            class="debug-toggle"
            onClick={() => setShowDebug(!showDebug())}
            title="Toggle debug information"
          >
            🐛
          </button>
        </div>
        
        {/* Debug Panel */}
        <Show when={showDebug()}>
          <div class="debug-panel">
            <h4>Debug Information</h4>
            <div class="debug-grid">
              <div class="debug-item">
                <span class="debug-label">Tab ID:</span>
                <span class="debug-value">{(window as any).__libraryDebug?.getTabId()?.slice(0, 20)}...</span>
              </div>
              <div class="debug-item">
                <span class="debug-label">Is Leader:</span>
                <span class="debug-value">{state().isLeader ? '✅ Yes' : '❌ No'}</span>
              </div>
              <div class="debug-item">
                <span class="debug-label">Leader Info:</span>
                <span class="debug-value">{state().leaderInfo ? JSON.stringify(state().leaderInfo).slice(0, 50) + '...' : 'None'}</span>
              </div>
              <div class="debug-item">
                <span class="debug-label">Initialized:</span>
                <span class="debug-value">{state().isInitialized ? '✅ Yes' : '❌ No'}</span>
              </div>
            </div>
            <div class="debug-actions">
              <button onClick={() => (window as any).__libraryDebug?.checkLocks()?.then((locks: any) => console.log('Locks:', locks))}>
                Check Locks
              </button>
              <button onClick={() => (window as any).__libraryDebug?.startElection()}>
                Start Election
              </button>
              <button onClick={() => (window as any).__libraryDebug?.stepDown()}>
                Step Down
              </button>
            </div>
          </div>
        </Show>
      </div>
    </div>
    </>
  )
}

interface LibraryItemCardProps {
  item: LibraryIndexItem
  viewMode: 'grid' | 'list'
}

const LibraryItemCard: Component<LibraryItemCardProps> = (props) => {
  return (
    <div class={`library-item library-item--${props.viewMode}`}>
      <div class="item-cover">
        <div class="cover-placeholder">
          <span>{props.item.title.charAt(0).toUpperCase()}</span>
        </div>
      </div>
      
      <div class="item-info">
        <h3 class="item-title">{props.item.title}</h3>
        <p class="item-author">
          {props.item.authors.length > 0 ? props.item.authors.join(', ') : 'Unknown Author'}
        </p>
        <div class="item-meta">
          <span class="item-format">{props.item.formats?.[0]?.toUpperCase() || 'PDF'}</span>
          <Show when={props.item.size}>
            <span class="item-size">{formatFileSize(props.item.size!)}</span>
          </Show>
          <Show when={props.item.progress !== undefined}>
            <span class="item-progress">
              {Math.round(props.item.progress! * 100)}% complete
            </span>
          </Show>
        </div>
        <Show when={props.item.tags && props.item.tags.length > 0}>
          <div class="item-tags">
            <For each={props.item.tags}>
              {(tag) => <span class="tag">{tag}</span>}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}

const formatFileSize = (bytes: number): string => {
  const sizes = ['B', 'KB', 'MB', 'GB']
  if (bytes === 0) return '0 B'
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i]
}