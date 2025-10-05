import { Component, createSignal, For, Show, onMount } from 'solid-js'
import { useLibrary } from '@/stores/library'
import { useTheme } from '@/stores/theme'
import { LibraryIndexItem } from '@/types/library'
import { GlassDropdownButton } from './GlassDropdownButton'
import { usePDF } from '@/stores/pdf'
import { opfsManager } from '@/utils/opfs'

export const LibraryView: Component = () => {
  const {
    state,
    setState,
    getLibraryItems,
    setSearchQuery,
    setSortOptions,
    setViewMode,
    clearError,
    getStorageUsage,
    importMultipleFiles,
    clearImportProgress,
    synchronizeLeaderState,
    ensureLeadership,
    updateDocumentMetadata,
    deleteDocument,
    getDocumentMetadata
  } = useLibrary()
  const { loadPDF, beginLoading, setError: setPDFError } = usePDF()

  // Initialize theme to ensure CSS variables are set
  useTheme()

  const [sortBy, setSortBy] = createSignal<'title' | 'author' | 'date' | 'size'>('title')
  const [sortOrder, setSortOrder] = createSignal<'asc' | 'desc'>('asc')
  const [storageUsage, setStorageUsage] = createSignal<{ used: number; quota: number; available: number } | null>(null)
  const [showDebug, setShowDebug] = createSignal(false)
  const [showEditModal, setShowEditModal] = createSignal(false)
  const [editingDocId, setEditingDocId] = createSignal<string | null>(null)
  const [editTitle, setEditTitle] = createSignal('')
  const [editAuthors, setEditAuthors] = createSignal('')
  const [editTags, setEditTags] = createSignal('')
  const [editLanguage, setEditLanguage] = createSignal('')
  const [editDescription, setEditDescription] = createSignal('')
  const [isSavingEdit, setIsSavingEdit] = createSignal(false)
  
  // Refs for file inputs
  let fileInputRef: HTMLInputElement | undefined
  let directoryInputRef: HTMLInputElement | undefined

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

  // Import handlers
  const handleImportFiles = () => {
    fileInputRef?.click()
  }

  const handleImportFolder = () => {
    directoryInputRef?.click()
  }

  const handleFileSelect = async (event: Event) => {
    const target = event.target as HTMLInputElement
    const files = target.files
    if (!files || files.length === 0) return

    try {
      await importMultipleFiles(files)
    } catch (error) {
      console.error('Import failed:', error)
    } finally {
      // Reset input
      target.value = ''
    }
  }

  const handleDirectorySelect = async (event: Event) => {
    const target = event.target as HTMLInputElement
    const files = target.files
    if (!files || files.length === 0) return

    try {
      // For directory import, we'll handle it as multiple files for now
      // In the future, we could enhance this to preserve directory structure
      await importMultipleFiles(files)
    } catch (error) {
      console.error('Directory import failed:', error)
    } finally {
      // Reset input
      target.value = ''
    }
  }

  // Clear import progress when component unmounts or user dismisses
  const handleDismissImportProgress = () => {
    clearImportProgress()
  }

  // Open a library item in the PDF viewer
  const openInViewer = async (item: LibraryIndexItem) => {
    // Instantly navigate to viewer and show loading indicator
    window.dispatchEvent(new CustomEvent('app:set-mode', { detail: 'pdf' }))
    beginLoading()

    // Continue loading the file in the background
    ;(async () => {
      try {
        const meta = await getDocumentMetadata(item.id)
        if (!meta) throw new Error('Document metadata not found')
        const pdfInfo = meta.formats && (meta.formats as Record<string, any>)['pdf']
        if (!pdfInfo?.path) throw new Error('PDF format not available for this document')

        const path = pdfInfo.path.startsWith('/') ? pdfInfo.path : '/' + pdfInfo.path
        const data = await opfsManager.readBinaryFile(path)
        const fileName = `${meta.title || item.title || 'document'}.pdf`
        const blob = new Blob([data], { type: 'application/pdf' })
        const file = new File([blob], fileName, { type: 'application/pdf' })

        await loadPDF(file)
      } catch (e) {
        console.error('Failed to open document in viewer:', e)
        const msg = e instanceof Error ? e.message : 'Failed to open document'
        // Surface error in the viewer
        setPDFError(msg)
        // Also record in library state for completeness
        setState(prev => ({ ...prev, error: msg }))
      }
    })()
  }

  // Edit metadata handlers
  const openEditModal = async (item: LibraryIndexItem) => {
    setEditingDocId(item.id)
    setShowEditModal(true)
    try {
      const meta = await getDocumentMetadata(item.id)
      if (meta) {
        setEditTitle(meta.title || '')
        setEditAuthors((meta.authors || []).join(', '))
        setEditTags((meta.tags || []).join(', '))
        setEditLanguage(meta.language || '')
        setEditDescription(meta.description || '')
      } else {
        // Fallback to index values
        setEditTitle(item.title || '')
        setEditAuthors((item.authors || []).join(', '))
        setEditTags((item.tags || []).join(', '))
        setEditLanguage(item.language || '')
        setEditDescription('')
      }
    } catch (e) {
      // Minimal fallback
      setEditTitle(item.title || '')
      setEditAuthors((item.authors || []).join(', '))
      setEditTags((item.tags || []).join(', '))
      setEditLanguage(item.language || '')
      setEditDescription('')
    }
  }

  const closeEditModal = () => {
    setShowEditModal(false)
    setEditingDocId(null)
  }

  const handleSaveEdit = async () => {
    if (!editingDocId()) return
    setIsSavingEdit(true)
    try {
      const updates = {
        title: editTitle().trim(),
        authors: editAuthors().split(',').map(a => a.trim()).filter(Boolean),
        tags: editTags().split(',').map(t => t.trim()).filter(Boolean),
        language: editLanguage().trim(),
        description: editDescription().trim()
      }
      await updateDocumentMetadata(editingDocId()!, updates)
      closeEditModal()
    } catch (e) {
      console.error('Failed to save metadata:', e)
    } finally {
      setIsSavingEdit(false)
    }
  }

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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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
        {/* Always-visible import actions */}
        <div class="import-actions" style="margin-bottom: 1rem; display: flex; gap: 0.5rem;">
          <button onClick={handleImportFiles} disabled={state().isImporting}>
            {state().isImporting ? 'Importing...' : 'Import Files'}
          </button>
          <button onClick={handleImportFolder} disabled={state().isImporting}>
            {state().isImporting ? 'Importing...' : 'Import Folder'}
          </button>
        </div>
        <Show 
          when={libraryItems().length > 0}
          fallback={
            <div class="empty-library">
              <h3>No documents in library</h3>
              <p>Import documents to get started with your library.</p>
              <div class="import-actions">
                <button onClick={handleImportFiles} disabled={state().isImporting}>
                  {state().isImporting ? 'Importing...' : 'Import Files'}
                </button>
                <button onClick={handleImportFolder} disabled={state().isImporting}>
                  {state().isImporting ? 'Importing...' : 'Import Folder'}
                </button>
              </div>
            </div>
          }
        >
          <div class={`library-items library-items--${state().viewMode}`}>
            <For each={libraryItems()}>
              {(item) => (
                <LibraryItemCard 
                  item={item} 
                  viewMode={state().viewMode}
                  onOpen={() => openInViewer(item)}
                  onEdit={() => openEditModal(item)}
                  onDelete={async () => {
                    if (confirm(`Delete "${item.title}"? This cannot be undone.`)) {
                      await deleteDocument(item.id)
                    }
                  }}
                />
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
              <button onClick={async () => {
                console.log('🔄 Synchronizing leader state...')
                try {
                  const changed = await synchronizeLeaderState()
                  console.log(`Leader state synchronization ${changed ? 'changed state' : 'no change needed'}`)
                } catch (error) {
                  console.error('Leader state sync failed:', error)
                }
              }}>
                Sync Leader State
              </button>
              <button onClick={async () => {
                console.log('🔧 Ensuring leadership...')
                try {
                  const hasLeadership = await ensureLeadership()
                  console.log(`Leadership ensure result: ${hasLeadership ? '✅ Leader' : '❌ Not leader'}`)
                } catch (error) {
                  console.error('Leadership ensure failed:', error)
                }
              }}>
                Ensure Leadership
              </button>
              <button onClick={async () => {
                console.log('🚨 Running quick fix...')
                try {
                  const result = await (window as any).__libraryDebug?.quickFix()
                  console.log('Quick fix result:', result)
                  // Also sync state after quick fix
                  await synchronizeLeaderState()
                } catch (error) {
                  console.error('Quick fix failed:', error)
                }
              }}>
                Quick Fix
              </button>
            </div>
          </div>
        </Show>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.epub,.mobi,.txt,.html,.md"
        style="display: none"
        onChange={handleFileSelect}
      />
      <input
        ref={directoryInputRef}
        type="file"
        multiple
        {...({ webkitdirectory: "" } as any)}
        style="display: none"
        onChange={handleDirectorySelect}
      />

      {/* Import Progress Modal */}
      <Show when={state().isImporting || state().importProgress}>
        <div class="import-progress-overlay" onClick={handleDismissImportProgress}>
          <div class="import-progress-modal" onClick={(e) => e.stopPropagation()}>
            <div class="import-progress-header">
              <h3>Importing Documents</h3>
              <button class="close-btn" onClick={handleDismissImportProgress}>×</button>
            </div>
            
            <Show when={state().importProgress}>
              {(progress) => (
                <div class="import-progress-content">
                  <div class="progress-stage" data-stage={progress().stage}>
                    Stage: {progress().stage.charAt(0).toUpperCase() + progress().stage.slice(1)}
                  </div>
                  
                  <div class="progress-bar-container">
                    <div 
                      class="progress-bar-fill" 
                      style={`width: ${progress().progress}%`}
                    ></div>
                  </div>
                  
                  <div class="progress-details">
                    <Show when={progress().currentFile}>
                      <div class="current-file">
                        {progress().currentFile}
                      </div>
                    </Show>
                    
                    <Show when={progress().totalFiles}>
                      <div class="file-count">
                        {progress().totalFiles} files
                      </div>
                    </Show>
                    
                    <div class="progress-percentage">
                      {Math.round(progress().progress)}%
                    </div>
                  </div>
                  
                  <Show when={progress().error}>
                    <div class="progress-error">
                      Error: {progress().error}
                      <Show when={progress().error?.includes('leader tab') || progress().error?.includes('leadership')}>
                        <div class="progress-error-actions">
                          <button 
                            class="retry-leadership-btn"
                            onClick={async () => {
                              try {
                                console.log('🔄 Manually fixing leadership issue...')
                                const result = await (window as any).__libraryDebug?.quickFix()
                                console.log('Leadership fix result:', result)
                                
                                // Try the import again by clearing error and re-triggering file selection
                                clearError()
                                
                                // Show success message briefly
                                setState(prev => ({ 
                                  ...prev, 
                                  error: 'Leadership issue resolved. Please try importing again.',
                                  importProgress: null
                                }))
                                
                                setTimeout(() => {
                                  setState(prev => ({ ...prev, error: null }))
                                }, 3000)
                              } catch (error) {
                                console.error('Manual leadership fix failed:', error)
                                setState(prev => ({ 
                                  ...prev, 
                                  error: 'Leadership fix failed. Try refreshing the page or closing other browser tabs.'
                                }))
                              }
                            }}
                          >
                            🔄 Fix Leadership
                          </button>
                          <button 
                            class="refresh-page-btn"
                            onClick={() => {
                              window.location.reload()
                            }}
                          >
                            🔄 Refresh Page
                          </button>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
            
            <div class="import-progress-footer">
              <Show when={!state().isImporting}>
                <button class="primary-btn" onClick={handleDismissImportProgress}>
                  {state().importProgress?.stage === 'complete' ? 'Done' : 'Close'}
                </button>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      {/* Edit Metadata Modal */}
      <Show when={showEditModal()}>
        <div class="import-progress-overlay" onClick={closeEditModal}>
          <div class="import-progress-modal" onClick={(e) => e.stopPropagation()}>
            <div class="import-progress-header">
              <h3>Edit Metadata</h3>
              <button class="close-btn" onClick={closeEditModal}>×</button>
            </div>
            <div class="import-progress-content">
              <label>
                <div style="margin-bottom: 0.25rem; color: var(--text-secondary)">Title</div>
                <input type="text" value={editTitle()} onInput={(e) => setEditTitle(e.currentTarget.value)} />
              </label>
              <label>
                <div style="margin-bottom: 0.25rem; color: var(--text-secondary)">Authors (comma-separated)</div>
                <input type="text" value={editAuthors()} onInput={(e) => setEditAuthors(e.currentTarget.value)} />
              </label>
              <label>
                <div style="margin-bottom: 0.25rem; color: var(--text-secondary)">Tags (comma-separated)</div>
                <input type="text" value={editTags()} onInput={(e) => setEditTags(e.currentTarget.value)} />
              </label>
              <label>
                <div style="margin-bottom: 0.25rem; color: var(--text-secondary)">Language</div>
                <input type="text" value={editLanguage()} onInput={(e) => setEditLanguage(e.currentTarget.value)} />
              </label>
              <label>
                <div style="margin-bottom: 0.25rem; color: var(--text-secondary)">Description</div>
                <textarea rows={4} value={editDescription()} onInput={(e) => setEditDescription(e.currentTarget.value)} />
              </label>
              <div style="display:flex; gap: 0.5rem; justify-content: flex-end;">
                <button class="secondary-btn" onClick={closeEditModal} disabled={isSavingEdit()}>Cancel</button>
                <button class="primary-btn" onClick={handleSaveEdit} disabled={isSavingEdit()}>
                  {isSavingEdit() ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
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
  onOpen?: () => void
  onEdit?: () => void
  onDelete?: () => void
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
        <h3 
          class="item-title"
          onClick={(e) => { e.stopPropagation(); props.onOpen?.() }}
          style="cursor: pointer;"
          title="Open in PDF viewer"
        >
          {props.item.title}
        </h3>
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
        <div class="item-actions">
          <button class="action-btn" title="Edit" onClick={(e) => { e.stopPropagation(); props.onEdit?.() }}>✏️</button>
          <button class="action-btn" title="Delete" onClick={(e) => { e.stopPropagation(); props.onDelete?.() }}>🗑️</button>
        </div>
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
