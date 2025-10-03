import { Component, createSignal, For, Show } from 'solid-js'
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
    clearError
  } = useLibrary()

  const [sortBy, setSortBy] = createSignal<'title' | 'author' | 'date' | 'size'>('title')
  const [sortOrder, setSortOrder] = createSignal<'asc' | 'desc'>('asc')

  // Update sort when controls change
  const handleSortChange = () => {
    setSortOptions(sortBy(), sortOrder())
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
          <span>Storage: Loading...</span>
        </div>
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