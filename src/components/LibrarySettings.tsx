/**
 * Library Settings Component
 * Library management settings with import/export functionality (stubs)
 */

import { Component, createSignal, onMount } from 'solid-js'
import { useLibrary } from '@/stores/library'

export const LibrarySettings: Component = () => {
  const { state, updateUserSettings, getStorageUsage, refreshLibrary } = useLibrary()
  const [isExporting, setIsExporting] = createSignal(false)
  const [isImporting, setIsImporting] = createSignal(false)
  const [importMessage, setImportMessage] = createSignal('')
  const [exportMessage, setExportMessage] = createSignal('')
  const [storageUsage, setStorageUsage] = createSignal<{ used: number; quota: number; available: number } | null>(null)

  // Load storage usage on mount
  onMount(async () => {
    try {
      const usage = await getStorageUsage()
      setStorageUsage(usage)
    } catch (error) {
      console.warn('Failed to get storage usage:', error)
    }
  })

  // Handle import (stub implementation)
  const handleImport = async () => {
    setIsImporting(true)
    setImportMessage('')
    
    try {
      // Simulate import process
      await new Promise(resolve => setTimeout(resolve, 2000))
      setImportMessage('Import functionality coming soon! This will allow you to import documents from various sources.')
    } catch (error) {
      setImportMessage('Import failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsImporting(false)
    }
  }

  // Handle export (stub implementation)
  const handleExport = async () => {
    setIsExporting(true)
    setExportMessage('')
    
    try {
      // Simulate export process
      await new Promise(resolve => setTimeout(resolve, 2000))
      setExportMessage('Export functionality coming soon! This will allow you to export your library data and documents.')
    } catch (error) {
      setExportMessage('Export failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsExporting(false)
    }
  }

  // Handle settings update
  const handleSettingChange = async (setting: string, value: any) => {
    try {
      await updateUserSettings({ [setting]: value })
    } catch (error) {
      console.error('Failed to update setting:', error)
    }
  }

  // Format storage usage
  const formatStorageUsage = (): string => {
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
    
    const used = formatBytes(usage.used)
    const quota = formatBytes(usage.quota)
    const percentage = usage.quota > 0 ? Math.round((usage.used / usage.quota) * 100) : 0
    
    return `${used} / ${quota} (${percentage}%)`
  }

  // Refresh library data
  const handleRefreshLibrary = async () => {
    try {
      await refreshLibrary()
    } catch (error) {
      console.error('Failed to refresh library:', error)
    }
  }

  return (
    <div class="library-settings">
      <h3>📚 Library Settings</h3>
      
      {/* Storage Management */}
      <div class="settings-section">
        <h4>💾 Storage Management</h4>
        
        <div class="storage-info">
          <div class="storage-usage-display">
            <span class="storage-label">Storage Usage:</span>
            <span class="storage-value">{formatStorageUsage()}</span>
          </div>
          
          {storageUsage() && (
            <div class="storage-bar">
              <div 
                class="storage-bar-fill" 
                style={`width: ${Math.round((storageUsage()!.used / storageUsage()!.quota) * 100)}%`}
              ></div>
            </div>
          )}
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <input
              type="checkbox"
              checked={state().userSettings.autoBackup}
              onChange={(e) => handleSettingChange('autoBackup', e.target.checked)}
            />
            Enable automatic backups
          </label>
          <span class="setting-description">Automatically backup library data to prevent data loss</span>
        </div>

        <div class="setting-actions">
          <button 
            class="secondary-btn"
            onClick={handleRefreshLibrary}
            disabled={state().isLoading}
          >
            🔄 Refresh Library
          </button>
        </div>
      </div>

      {/* Import/Export */}
      <div class="settings-section">
        <h4>📥 Import / Export</h4>
        
        <div class="import-export-controls">
          <div class="control-group">
            <h5>Import Documents</h5>
            <p class="control-description">Import documents from your device or cloud storage</p>
            <button 
              class="primary-btn"
              onClick={handleImport}
              disabled={isImporting()}
            >
              {isImporting() ? '⏳ Importing...' : '📥 Import Documents'}
            </button>
            {importMessage() && (
              <div class={`message ${importMessage().includes('failed') ? 'error' : 'info'}`}>
                {importMessage()}
              </div>
            )}
          </div>

          <div class="control-group">
            <h5>Export Library</h5>
            <p class="control-description">Export your library data and documents for backup or migration</p>
            <button 
              class="primary-btn"
              onClick={handleExport}
              disabled={isExporting()}
            >
              {isExporting() ? '⏳ Exporting...' : '📤 Export Library'}
            </button>
            {exportMessage() && (
              <div class={`message ${exportMessage().includes('failed') ? 'error' : 'info'}`}>
                {exportMessage()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Display Settings */}
      <div class="settings-section">
        <h4>🎨 Display Settings</h4>
        
        <div class="setting-item">
          <label class="setting-label">Default View</label>
          <select
            value={state().userSettings.libraryView}
            onChange={(e) => handleSettingChange('libraryView', e.target.value)}
            class="setting-select"
          >
            <option value="grid">Grid View</option>
            <option value="list">List View</option>
          </select>
          <span class="setting-description">Choose how documents are displayed in the library</span>
        </div>

        <div class="setting-item">
          <label class="setting-label">Items per page</label>
          <input
            type="number"
            min="10"
            max="100"
            step="10"
            value={state().userSettings.itemsPerPage}
            onChange={(e) => handleSettingChange('itemsPerPage', parseInt(e.target.value))}
            class="setting-input"
          />
          <span class="setting-description">Number of items to show per page (when pagination is implemented)</span>
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <input
              type="checkbox"
              checked={state().userSettings.showCovers}
              onChange={(e) => handleSettingChange('showCovers', e.target.checked)}
            />
            Show document covers
          </label>
          <span class="setting-description">Display cover images for documents in grid view</span>
        </div>
      </div>

      {/* Advanced Settings */}
      <div class="settings-section">
        <h4>⚙️ Advanced Settings</h4>
        
        <div class="setting-item">
          <label class="setting-label">Default Format</label>
          <select
            value={state().userSettings.defaultFormat}
            onChange={(e) => handleSettingChange('defaultFormat', e.target.value)}
            class="setting-select"
          >
            <option value="pdf">PDF</option>
            <option value="epub">EPUB</option>
            <option value="mobi">MOBI</option>
            <option value="txt">TXT</option>
          </select>
          <span class="setting-description">Default format for new document imports</span>
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <input
              type="checkbox"
              checked={state().userSettings.autoImport}
              onChange={(e) => handleSettingChange('autoImport', e.target.checked)}
            />
            Auto-import new files
          </label>
          <span class="setting-description">Automatically import supported files when they're detected</span>
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <input
              type="checkbox"
              checked={state().userSettings.autoConvert}
              onChange={(e) => handleSettingChange('autoConvert', e.target.checked)}
            />
            Auto-convert documents
          </label>
          <span class="setting-description">Automatically convert documents to preferred format when importing</span>
        </div>
      </div>

      {/* Library Information */}
      <div class="settings-section">
        <h4>ℹ️ Library Information</h4>
        
        <div class="library-info">
          <div class="info-item">
            <span class="info-label">Total Documents:</span>
            <span class="info-value">{Object.keys(state().index).length}</span>
          </div>
          
          <div class="info-item">
            <span class="info-label">Storage Used:</span>
            <span class="info-value">{storageUsage() ? `${(storageUsage()!.used / 1024 / 1024).toFixed(1)} MB` : 'Unknown'}</span>
          </div>
          
          <div class="info-item">
            <span class="info-label">Sync Status:</span>
            <span class="info-value">
              {state().isLeader ? '🟢 Leader (Active)' : '🔄 Follower (Syncing)'}
            </span>
          </div>

          <div class="info-item">
            <span class="info-label">Library Version:</span>
            <span class="info-value">1.0</span>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div class="settings-section danger-zone">
        <h4>⚠️ Danger Zone</h4>
        
        <div class="danger-description">
          <p>These actions cannot be undone. Please be careful.</p>
        </div>

        <div class="danger-actions">
          <button 
            class="danger-btn"
            onClick={() => {
              if (confirm('This will clear all library data. Are you sure?')) {
                // TODO: Implement library reset
                console.warn('Library reset not implemented yet')
              }
            }}
          >
            🗑️ Clear Library Data
          </button>
        </div>
      </div>
    </div>
  )
}