import { Component, createSignal, createEffect } from 'solid-js'
import { useTTS } from '@/stores/tts'
import { useTheme } from '@/stores/theme'
import { useLibrary } from '@/stores/library'
import { GlassDropdownButton } from './GlassDropdownButton'
import { LibrarySettings } from './LibrarySettings'
import { logger, logOPFS } from '@/utils/logger'
import { leaderElection } from '@/utils/leader-election'

export const SettingsView: Component = () => {
  const { 
    state: ttsState, 
    models, 
    loadModel, 
    setVoice, 
    
    ensureBrowserEngine, 
    primeSystemVoices, 
    refreshSystemVoices,
    setChunkMaxChars, 
    setChunkOverlapChars, 
    setSentenceSplit, 
    setInterChunkPauseMs, 
    setTargetSampleRate,
    // Voice filtering functions
    getVoiceMetadata,
    getAvailableTags,
    filterVoicesByGender,
    filterVoicesByTags,
    filterVoicesByPitchRange,
    filterVoicesByRateRange,
    filterVoicesByBrightnessRange
  } = useTTS()
  const { theme, setTheme } = useTheme()
  const { state: libraryState, getStorageUsage } = useLibrary()
  
  const [refreshingVoices, setRefreshingVoices] = createSignal(false)
  const [voiceMetadata, setVoiceMetadata] = createSignal<any>(null)
  
  // OPFS & Debug state
  const [logLevel, setLogLevel] = createSignal<'debug' | 'info' | 'warn' | 'error'>('info')
  const [debugInfo, setDebugInfo] = createSignal<any>(null)
  const [storageInfo, setStorageInfo] = createSignal<any>(null)
  const [lockInfo, setLockInfo] = createSignal<any>(null)
  const [recentLogs, setRecentLogs] = createSignal<any[]>([])
  const [refreshingDebug, setRefreshingDebug] = createSignal(false)
  
  // Voice filtering state
  const [availableTags, setAvailableTags] = createSignal<string[]>([])
  const [allSpeakers, setAllSpeakers] = createSignal<any[]>([])
  const [filteredSpeakers, setFilteredSpeakers] = createSignal<any[]>([])
  const [selectedGender, setSelectedGender] = createSignal('all')
  const [selectedTags, setSelectedTags] = createSignal<string[]>([])
  const [pitchRange, setPitchRange] = createSignal({ min: 0, max: 500 })
  const [rateRange, setRateRange] = createSignal({ min: 0, max: 300 })
  const [brightnessRange, setBrightnessRange] = createSignal({ min: 0, max: 1 })
  const [searchQuery, setSearchQuery] = createSignal('')
  
  const handleModelLoad = async (modelName: string) => {
    try {
      await loadModel(modelName)
    } catch (error) {
      console.error('Failed to load model:', error)
    }
  }

  // Refresh debug information
  const refreshDebugInfo = async () => {
    setRefreshingDebug(true)
    try {
      // Get logger debug info
      const loggerDebug = logger.getDebugInfo()
      setDebugInfo(loggerDebug)
      
      // Get storage usage
      const storage = await getStorageUsage()
      setStorageInfo(storage)
      
      // Get lock information
      const locks = await leaderElection.getLockInfo()
      const leaderStatus = await leaderElection.checkLeaderStatus()
      const leaderDebug = leaderElection.getDebugInfo()
      
      setLockInfo({
        locks,
        leaderStatus,
        leaderDebug
      })
      
      // Get recent logs
      const logs = logger.getRecentLogs(50)
      setRecentLogs(logs)
      
    } catch (error) {
      console.error('Failed to refresh debug info:', error)
    } finally {
      setRefreshingDebug(false)
    }
  }

  // Auto-refresh debug info when component mounts
  createEffect(() => {
    refreshDebugInfo()
  })

  // Handle log level change
  const handleLogLevelChange = (newLevel: 'debug' | 'info' | 'warn' | 'error') => {
    setLogLevel(newLevel)
    logger.configure({ logLevel: newLevel })
    logOPFS.info(`Log level changed to: ${newLevel}`)
  }

  // Export debug information
  const exportDebugInfo = () => {
    const info = {
      timestamp: new Date().toISOString(),
      debugInfo: debugInfo(),
      storageInfo: storageInfo(),
      lockInfo: lockInfo(),
      libraryState: {
        isLeader: libraryState().isLeader,
        leaderInfo: libraryState().leaderInfo,
        isInitialized: libraryState().isInitialized,
        documentCount: Object.keys(libraryState().index).length
      },
      logs: logger.exportLogs()
    }
    
    const text = JSON.stringify(info, null, 2)
    
    // Copy to clipboard
    navigator.clipboard.writeText(text).then(() => {
      alert('Debug information copied to clipboard!')
    }).catch(() => {
      // Fallback: open in new window
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pagesonic-debug-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  // Force leadership transfer
  const forceLeadershipTransfer = async () => {
    const currentStatus = libraryState().isLeader ? 'current leader' : 'not currently leader'
    if (confirm(`This will force a leadership transfer (${currentStatus}) and may temporarily disrupt cross-tab synchronization. Continue?`)) {
      try {
        logOPFS.info('User initiated force leadership transfer')
        await leaderElection.forceLeadershipTransfer()
        setTimeout(refreshDebugInfo, 1000) // Refresh after a delay
        
        // Show success feedback
        const newStatus = libraryState().isLeader ? 'Leadership transferred and re-acquired' : 'Leadership transfer initiated'
        logOPFS.info(`Force leadership transfer completed: ${newStatus}`)
      } catch (error) {
        console.error('Failed to force leadership transfer:', error)
        logOPFS.error('Force leadership transfer failed', error instanceof Error ? error : new Error(String(error)))
        alert('Failed to force leadership transfer. Check console for details.')
      }
    }
  }

  // Step down from leadership
  const stepDownFromLeadership = async () => {
    if (confirm('Step down from leadership? Another tab will become the leader if available.')) {
      try {
        await leaderElection.stepDown()
        setTimeout(refreshDebugInfo, 500) // Refresh after a delay
      } catch (error) {
        console.error('Failed to step down from leadership:', error)
        alert('Failed to step down from leadership. Check console for details.')
      }
    }
  }

  // Load voice metadata and initialize filters when component mounts
  createEffect(async () => {
    try {
      const metadata = await getVoiceMetadata()
      const tags = await getAvailableTags()
      setVoiceMetadata({ 'en_US-libritts_r-medium': { speakers: metadata } })
      setAllSpeakers(metadata)
      setFilteredSpeakers(metadata)
      setAvailableTags(tags)
      
      // Set initial ranges based on actual data
      if (metadata.length > 0) {
        const pitches = metadata.map((s: any) => s.pitch_mean).filter((p: any) => p !== null && p !== undefined)
        const rates = metadata.map((s: any) => s.speaking_rate).filter((r: any) => r !== null && r !== undefined)
        const brightnesses = metadata.map((s: any) => s.brightness).filter((b: any) => b !== null && b !== undefined)
        
        if (pitches.length > 0) {
          setPitchRange({ min: Math.min(...pitches), max: Math.max(...pitches) })
        }
        if (rates.length > 0) {
          setRateRange({ min: Math.min(...rates), max: Math.max(...rates) })
        }
        if (brightnesses.length > 0) {
          setBrightnessRange({ min: Math.min(...brightnesses), max: Math.max(...brightnesses) })
        }
      }
    } catch (error) {
      console.warn('Failed to load voice metadata:', error)
    }
  })

  // Apply filters when any filter criteria changes
  createEffect(() => {
    let filtered = [...allSpeakers()]
    
    // Apply gender filter
    if (selectedGender() !== 'all') {
      filtered = filterVoicesByGender(filtered, selectedGender())
    }
    
    // Apply tag filter
    if (selectedTags().length > 0) {
      filtered = filterVoicesByTags(filtered, selectedTags())
    }
    
    // Apply numeric range filters
    filtered = filterVoicesByPitchRange(filtered, pitchRange().min, pitchRange().max)
    filtered = filterVoicesByRateRange(filtered, rateRange().min, rateRange().max)
    filtered = filterVoicesByBrightnessRange(filtered, brightnessRange().min, brightnessRange().max)
    
    // Apply search filter
    if (searchQuery().trim()) {
      const query = searchQuery().toLowerCase()
      filtered = filtered.filter(speaker => 
        speaker.speaker_id.toLowerCase().includes(query) ||
        speaker.display_name.toLowerCase().includes(query) ||
        (speaker.description && speaker.description.toLowerCase().includes(query))
      )
    }
    
    setFilteredSpeakers(filtered)
  })

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    )
  }

  const clearFilters = () => {
    setSelectedGender('all')
    setSelectedTags([])
    setSearchQuery('')
    // Reset ranges to full range
    const speakers = allSpeakers()
    if (speakers.length > 0) {
      const pitches = speakers.map((s: any) => s.pitch_mean).filter((p: any) => p !== null && p !== undefined)
      const rates = speakers.map((s: any) => s.speaking_rate).filter((r: any) => r !== null && r !== undefined)
      const brightnesses = speakers.map((s: any) => s.brightness).filter((b: any) => b !== null && b !== undefined)
      
      if (pitches.length > 0) {
        setPitchRange({ min: Math.min(...pitches), max: Math.max(...pitches) })
      }
      if (rates.length > 0) {
        setRateRange({ min: Math.min(...rates), max: Math.max(...rates) })
      }
      if (brightnesses.length > 0) {
        setBrightnessRange({ min: Math.min(...brightnesses), max: Math.max(...brightnesses) })
      }
    }
  }

  // Get current speaker metadata
  const getCurrentSpeakerInfo = () => {
    const currentVoice = ttsState().voice
    if (!currentVoice || !voiceMetadata()) return null

    const modelData = voiceMetadata()['en_US-libritts_r-medium']
    if (!modelData || !modelData.speakers) return null

    return modelData.speakers.find((speaker: any) => speaker.speaker_id === currentVoice)
  }
  
  const isModelCompatible = (model: any) => {
    if (model.requiresWebGPU && !ttsState().isWebGPUSupported) {
      return false
    }
    return true
  }
  
  const getModelStatus = (model: any) => {
    if (!isModelCompatible(model)) {
      return { status: 'incompatible', message: 'WebGPU required but not supported' }
    }
    if (ttsState().model?.name === model.name) {
      return { status: 'loaded', message: 'Currently loaded' }
    }
    return { status: 'available', message: 'Available to load' }
  }
  
  return (
    <div class="settings-view-wrap">
      <div class="settings-top-rail">
        <GlassDropdownButton
          ariaLabel="Switch view"
          title="Switch view"
          class="rail-btn"
          align="start"
          selectedValue={'settings'}
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
        <div class="rail-meta">App Settings</div>
      </div>

      <div class="settings-scroll">
        <div class="settings-view">

    
      <div class="settings-section">
        <h3>Appearance</h3>
        <div class="dropdown single-line">
          <label>Theme:</label>
          <select
            value={theme()}
            onChange={(e) => setTheme(((e.target as HTMLSelectElement).value as 'dark' | 'light'))}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
      </div>
      <hr class="section-divider" />

      {/* Library Settings Section */}
      <LibrarySettings />
      <hr class="section-divider" />

      <div class="settings-section">
        <h3>TTS Engine / Model</h3>
        {!ttsState().isWebGPUSupported && (
          <p class="error" style={{ padding: '0.5rem 0.75rem', margin: '0 0 0.75rem 0' }}>
            WebGPU not supported. Kokoro requires WebGPU; Piper can run on CPU.
          </p>
        )}
        {ttsState().lastError && (
          <p class="error" style={{ padding: '0.5rem 0.75rem', margin: '0 0 0.75rem 0' }}>
            {ttsState().lastError}
          </p>
        )}
        <div class="model-list">
          <div class="model-item">
            <div class="model-info">
              <h4>Browser TTS (System)</h4>
              <div class="debug-panel" style="margin-top: 0.5rem;">
                <div class="debug-grid compact">
                  <div class="debug-item">
                    <span class="label">Engine:</span>
                    <span class="value">System SpeechSynthesis</span>
                  </div>
                  <div class="debug-item">
                    <span class="label">Available Voices:</span>
                    <span class={`value ${(ttsState().systemVoices || []).length > 0 ? 'status-success' : 'status-error'}`}>
                      {(ttsState().systemVoices || []).length}
                    </span>
                  </div>
                  <div class="debug-item">
                    <span class="label">Status:</span>
                    <span class={`value ${ttsState().engine === 'browser' ? 'status-success' : ((ttsState().systemVoices || []).length > 0 ? 'status-info' : 'status-error')}`}>
                      {ttsState().engine === 'browser' ? 'Active' : (
                        (ttsState().systemVoices || []).length > 0 ? 'Available' : 'Unavailable'
                      )}
                    </span>
                  </div>
                  {(ttsState().systemVoices || []).length > 0 && (
                    <div class="debug-item" style="grid-column: 1 / -1;">
                      <span class="label">Voices:</span>
                      <span style="font-family: monospace; font-size: 0.7rem; color: #94a3b8; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        {(ttsState().systemVoices || []).join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button
                onClick={async () => { await ensureBrowserEngine() }}
                disabled={ttsState().engine === 'browser' || (ttsState().systemVoices || []).length === 0}
                class={ttsState().engine === 'browser' ? 'loaded' : ''}
              >
                {ttsState().engine === 'browser' ? 'Using' : 'Use'}
              </button>
              <button
                onClick={async () => {
                  try {
                    setRefreshingVoices(true)
                    await primeSystemVoices(6000)
                    refreshSystemVoices()
                  } finally {
                    setRefreshingVoices(false)
                  }
                }}
                disabled={refreshingVoices()}
                title="Force browser to load system voices"
              >{refreshingVoices() ? 'Refreshing…' : 'Refresh voices'}</button>
            </div>
          </div>
          {models.map((model) => {
            const modelStatus = getModelStatus(model)
            const isLoaded = ttsState().model?.name === model.name
            
            return (
              <div class="model-item">
                <div class="model-info">
                  <h4>{model.name}</h4>
                  <div class="debug-panel" style="margin-top: 0.5rem;">
                    <div class="debug-grid compact">
                      <div class="debug-item">
                        <span class="label">Size:</span>
                        <span class="value">{model.size} MB</span>
                      </div>
                      <div class="debug-item">
                        <span class="label">Voices:</span>
                        <span class="value">{model.voices.length}</span>
                      </div>
                      <div class="debug-item">
                        <span class="label">WebGPU:</span>
                        <span class={`value ${model.requiresWebGPU ? (ttsState().isWebGPUSupported ? 'status-success' : 'status-error') : 'status-info'}`}>
                          {model.requiresWebGPU ? 'Required' : 'Optional'}
                        </span>
                      </div>
                      <div class="debug-item">
                        <span class="label">Status:</span>
                        <span class={`value ${modelStatus.status === 'loaded' ? 'status-success' : modelStatus.status === 'available' ? 'status-info' : 'status-error'}`}>
                          {modelStatus.message}
                        </span>
                      </div>
                      {model.voices.length > 0 && (
                        <div class="debug-item" style="grid-column: 1 / -1;">
                          <span class="label">Available Voices:</span>
                          <span style="font-family: monospace; font-size: 0.7rem; color: #94a3b8; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            {model.voices.join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleModelLoad(model.name)}
                  disabled={
                    ttsState().isModelLoading || 
                    !isModelCompatible(model) ||
                    isLoaded
                  }
                  class={isLoaded ? 'loaded' : ''}
                >
                  {ttsState().isModelLoading ? 'Loading...' : 
                   isLoaded ? 'Loaded' : 'Load Model'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
      <hr class="section-divider" />

      <div class="settings-section">
        <h3>Voice Settings</h3>
        
          
        {/* Show filtering controls only when Piper TTS is loaded */}
        {ttsState().model?.name === 'Piper TTS' && ttsState().engine === 'local' && (
          <div class="voice-filters">
            {/* Search and Gender controls */}
            <div class="filter-row">
              <div class="filter-group">
                <label>Search:</label>
                <input
                  type="text"
                  placeholder="Voice ID or name..."
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                  class="search-input"
                />
              </div>
              
              <div class="filter-group">
                <label>Gender:</label>
                <div class="gender-buttons">
                  <button
                    class={selectedGender() === 'all' ? 'active' : ''}
                    onClick={() => setSelectedGender('all')}
                  >All</button>
                  <button
                    class={selectedGender() === 'F' ? 'active' : ''}
                    onClick={() => setSelectedGender('F')}
                  >Female</button>
                  <button
                    class={selectedGender() === 'M' ? 'active' : ''}
                    onClick={() => setSelectedGender('M')}
                  >Male</button>
                  <button
                    class={selectedGender() === 'U' ? 'active' : ''}
                    onClick={() => setSelectedGender('U')}
                  >Unknown</button>
                </div>
              </div>
            </div>

            {/* Numeric range controls */}
            <div class="filter-row">
              <div class="filter-group">
                <label>Pitch Range ({Math.round(pitchRange().min)}-{Math.round(pitchRange().max)} Hz):</label>
                <div class="range-inputs">
                  <input
                    type="number"
                    value={Math.round(pitchRange().min)}
                    onInput={(e) => setPitchRange(prev => ({ ...prev, min: parseInt((e.target as HTMLInputElement).value) || 0 }))}
                    min="50"
                    max="300"
                  />
                  <span>-</span>
                  <input
                    type="number"
                    value={Math.round(pitchRange().max)}
                    onInput={(e) => setPitchRange(prev => ({ ...prev, max: parseInt((e.target as HTMLInputElement).value) || 500 }))}
                    min="50"
                    max="300"
                  />
                </div>
              </div>
              
              <div class="filter-group">
                <label>Rate Range ({Math.round(rateRange().min)}-{Math.round(rateRange().max)} wpm):</label>
                <div class="range-inputs">
                  <input
                    type="number"
                    value={Math.round(rateRange().min)}
                    onInput={(e) => setRateRange(prev => ({ ...prev, min: parseInt((e.target as HTMLInputElement).value) || 0 }))}
                    min="50"
                    max="250"
                  />
                  <span>-</span>
                  <input
                    type="number"
                    value={Math.round(rateRange().max)}
                    onInput={(e) => setRateRange(prev => ({ ...prev, max: parseInt((e.target as HTMLInputElement).value) || 300 }))}
                    min="50"
                    max="250"
                  />
                </div>
              </div>
            </div>

            {/* Tag filter */}
            <div class="filter-row">
              <div class="filter-group full-width">
                <label>Traits:</label>
                <div class="tag-filter">
                  <div class="selected-tags">
                    {selectedTags().map(tag => (
                      <span class="tag selected" onClick={() => handleTagToggle(tag)}>
                        {tag} ×
                      </span>
                    ))}
                  </div>
                  <div class="available-tags">
                    {availableTags().slice(0, 20).map(tag => (
                      <span
                        class={`tag ${selectedTags().includes(tag) ? 'selected' : ''}`}
                        onClick={() => handleTagToggle(tag)}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div class="filter-actions">
              <button onClick={clearFilters} class="clear-filters">Clear Filters</button>
              <span class="filter-count">{filteredSpeakers().length} voices found</span>
            </div>
          </div>
        )}

        {/* Voice selector */}
        <div class="dropdown single-line">
          <label>Voice:</label>
          {ttsState().model?.name === 'Piper TTS' && ttsState().engine === 'local' ? (
            <select
              value={ttsState().voice}
              onChange={(e) => {
                const target = e.target as HTMLSelectElement
                setVoice(target.value)
              }}
              disabled={!ttsState().model}
            >
              <option value="">Select a voice...</option>
              {filteredSpeakers().map(speaker => (
                <option value={speaker.speaker_id}>
                  {speaker.display_name} ({speaker.speaker_id})
                </option>
              ))}
            </select>
          ) : (
            <select
              value={ttsState().voice}
              onChange={(e) => {
                const target = e.target as HTMLSelectElement
                // Allow change when a local model is loaded or browser TTS is active
                if (ttsState().model || ttsState().engine === 'browser') {
                  setVoice(target.value)
                }
              }}
              disabled={(!ttsState().model && ttsState().engine !== 'browser') || (ttsState().engine === 'browser' && (ttsState().systemVoices || []).length === 0)}
            >
              {(ttsState().engine === 'browser'
                ? (ttsState().systemVoices || [])
                : (ttsState().model?.voices || [])
              ).map(voice => (
                <option value={voice}>{voice}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      <hr class="section-divider" />

      <div class="settings-section">
        <h3>TTS Chunking</h3>
        <div class="debug-panel">
          <h4>Chunk Configuration</h4>
          <div class="debug-grid compact">
            <div class="debug-item">
              <span class="label">Max chunk size:</span>
              <div class="settings-input-group">
                <input
                  type="number"
                  min="64"
                  max="2000"
                  step="10"
                  value={ttsState().chunkMaxChars}
                  onInput={(e) => setChunkMaxChars(parseInt((e.target as HTMLInputElement).value || '280'))}
                  class="settings-input"
                />
                <span class="settings-input-label">chars</span>
              </div>
            </div>
            <div class="debug-item">
              <span class="label">Overlap:</span>
              <div class="settings-input-group">
                <input
                  type="number"
                  min="0"
                  max="200"
                  step="1"
                  value={ttsState().chunkOverlapChars}
                  onInput={(e) => setChunkOverlapChars(parseInt((e.target as HTMLInputElement).value || '0'))}
                  class="settings-input"
                />
                <span class="settings-input-label">chars</span>
              </div>
            </div>
            <div class="debug-item">
              <span class="label">Split by sentence:</span>
              <input
                type="checkbox"
                checked={!!ttsState().sentenceSplit}
                onChange={(e) => setSentenceSplit((e.target as HTMLInputElement).checked)}
                style="margin: 0; accent-color: #6366f1;"
              />
            </div>
            <div class="debug-item">
              <span class="label">Pause between chunks:</span>
              <div class="settings-input-group">
                <input
                  type="number"
                  min="0"
                  max="2000"
                  step="20"
                  value={ttsState().interChunkPauseMs}
                  onInput={(e) => setInterChunkPauseMs(parseInt((e.target as HTMLInputElement).value || '0'))}
                  class="settings-input"
                />
                <span class="settings-input-label">ms</span>
              </div>
            </div>
          </div>
          <div class="settings-info">
            <div class="settings-info-content">
              <strong>💡 Tip:</strong> Console logs include chunk indices and timing information. Smaller chunks reduce latency but may affect speech flow.
            </div>
          </div>
        </div>
      </div>
      <hr class="section-divider" />
      
      <div class="settings-section">
        <h3>System Information</h3>
        <div class="debug-panel">
          <h4>System Status</h4>
          <div class="debug-grid">
            <div class="debug-item">
              <span class="label">WebGPU Status:</span>
              <span class={`value ${ttsState().isWebGPUSupported ? 'status-success' : 'status-error'}`}>
                {ttsState().isWebGPUSupported ? 'Supported' : 'Not Supported'}
              </span>
            </div>
            {ttsState().model && (
              <div class="debug-item">
                <span class="label">Loaded Model:</span>
                <span class="value status-info">{ttsState().model!.name}</span>
              </div>
            )}
            <div class="debug-item">
              <span class="label">Current Voice:</span>
              <span class="value">{(() => {
                if (ttsState().engine === 'browser' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
                  const voices = window.speechSynthesis.getVoices()
                  const requested = (ttsState().voice || '').toLowerCase()
                  const selected = voices.find(v => v.name.toLowerCase() === requested) ||
                                   voices.find(v => v.name.toLowerCase().includes(requested))
                  return selected?.name || ttsState().voice
                }
                return ttsState().voice
              })()}</span>
            </div>
            <div class="debug-item">
              <span class="label">Speech Rate:</span>
              <span class="value">{ttsState().rate.toFixed(1)}x</span>
            </div>
            <div class="debug-item">
              <span class="label">Speech Pitch:</span>
              <span class="value">{ttsState().pitch.toFixed(1)}</span>
            </div>
          </div>
          
                    
          
          
          {/* Voice metadata for LibriTTS speakers */}
          {ttsState().engine !== 'browser' && getCurrentSpeakerInfo() && (
            <div class="debug-panel" style={{ 'margin-top': '1rem' }}>
              <h4>Voice Details</h4>
              <div class="debug-grid">
                <div class="debug-item">
                  <span class="label">Display Name:</span>
                  <span class="value">{getCurrentSpeakerInfo()?.display_name || 'N/A'}</span>
                </div>
                <div class="debug-item">
                  <span class="label">Description:</span>
                  <span class="value">{getCurrentSpeakerInfo()?.description || 'N/A'}</span>
                </div>
                <div class="debug-item">
                  <span class="label">Gender:</span>
                  <span class={`value ${getCurrentSpeakerInfo()?.gender === 'F' ? 'status-info' : getCurrentSpeakerInfo()?.gender === 'M' ? 'status-success' : 'status-warning'}`}>
                    {getCurrentSpeakerInfo()?.gender === 'F' ? 'Female' : getCurrentSpeakerInfo()?.gender === 'M' ? 'Male' : 'Unknown'}
                  </span>
                </div>
                {getCurrentSpeakerInfo()?.pitch_mean && (
                  <div class="debug-item">
                    <span class="label">Avg Pitch:</span>
                    <span class="value">{Math.round(getCurrentSpeakerInfo().pitch_mean)} Hz</span>
                  </div>
                )}
                {getCurrentSpeakerInfo()?.speaking_rate && (
                  <div class="debug-item">
                    <span class="label">Speaking Rate:</span>
                    <span class="value">{Math.round(getCurrentSpeakerInfo().speaking_rate)} wpm</span>
                  </div>
                )}
                {getCurrentSpeakerInfo()?.brightness && (
                  <div class="debug-item">
                    <span class="label">Brightness:</span>
                    <span class="value">{getCurrentSpeakerInfo().brightness.toFixed(2)}</span>
                  </div>
                )}
              </div>
              
              {/* Voice traits display */}
              {getCurrentSpeakerInfo()?.tags && getCurrentSpeakerInfo()?.tags.length > 0 && (
                <div style="margin-top: 0.75rem;">
                  <div style="font-size: 0.85rem; font-weight: 500; color: #94a3b8; margin-bottom: 0.5rem;">Voice Traits:</div>
                  <div class="settings-traits">
                    {getCurrentSpeakerInfo().tags.map((tag: string) => (
                      <span class="settings-trait">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <hr class="section-divider" />

      {/* OPFS & Locking Status Section */}
      <div class="settings-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3>OPFS & Cross-Tab Status</h3>
          <button 
            onClick={refreshDebugInfo}
            disabled={refreshingDebug()}
            style="font-size: 0.8rem; padding: 0.25rem 0.5rem;"
          >
            {refreshingDebug() ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {/* Storage Information */}
        <div class="debug-panel">
          <h4>Storage Usage</h4>
          {storageInfo() && (
            <div class="debug-grid">
              <div class="debug-item">
                <span class="label">Used:</span>
                <span class="value">{(storageInfo().used / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              <div class="debug-item">
                <span class="label">Quota:</span>
                <span class="value">{(storageInfo().quota / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              <div class="debug-item">
                <span class="label">Available:</span>
                <span class="value">{(storageInfo().available / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              <div class="debug-item">
                <span class="label">Documents:</span>
                <span class="value">{Object.keys(libraryState().index).length}</span>
              </div>
            </div>
          )}
        </div>

        {/* Leadership Status */}
        <div class="debug-panel">
          <h4>Leadership Status</h4>
          {lockInfo() && (
            <div class="debug-grid">
              <div class="debug-item">
                <span class="label">Is Leader:</span>
                <span class={`value ${libraryState().isLeader ? 'leader' : 'follower'}`}>
                  {libraryState().isLeader ? 'Leader' : 'Follower'}
                </span>
              </div>
              <div class="debug-item">
                <span class="label">Tab ID:</span>
                <span class="value" style="font-family: monospace; font-size: 0.8rem;">
                  {lockInfo().leaderDebug?.tabId?.slice(0, 20)}...
                </span>
              </div>
              <div class="debug-item">
                <span class="label">Active Locks:</span>
                <span class="value">{lockInfo().locks?.held?.length || 0}</span>
              </div>
              <div class="debug-item">
                <span class="label">Pending Locks:</span>
                <span class="value">{lockInfo().locks?.pending?.length || 0}</span>
              </div>
            </div>
          )}

          {/* Leadership Actions */}
          <div style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
            {libraryState().isLeader && (
              <button 
                onClick={stepDownFromLeadership}
                style="font-size: 0.8rem; padding: 0.25rem 0.5rem; background: #ff6b6b; color: white; border: none; border-radius: 4px;"
              >
                Step Down as Leader
              </button>
            )}
            <button 
              onClick={forceLeadershipTransfer}
              style="font-size: 0.8rem; padding: 0.25rem 0.5rem; background: #4ecdc4; color: white; border: none; border-radius: 4px;"
              title={!libraryState().isLeader ? "Attempt to acquire leadership (may transfer from other tab)" : "Step down and re-acquire leadership"}
            >
              {!libraryState().isLeader ? 'Take Leadership' : 'Force Transfer'}
            </button>
          </div>
        </div>

        {/* Logging Configuration */}
        <div class="debug-panel">
          <h4>Logging Configuration</h4>
          <div class="debug-grid">
            <div class="debug-item">
              <span class="label">Log Level:</span>
              <select 
                value={logLevel()} 
                onChange={(e) => handleLogLevelChange((e.target as HTMLSelectElement).value as any)}
                style="padding: 0.25rem; border-radius: 4px; border: 1px solid #ccc;"
              >
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
              </select>
            </div>
            <div class="debug-item">
              <span class="label">Total Logs:</span>
              <span class="value">{debugInfo()?.totalLogs || 0}</span>
            </div>
            <div class="debug-item">
              <span class="label">Active Timers:</span>
              <span class="value">{debugInfo()?.activeTimers?.length || 0}</span>
            </div>
          </div>

          {/* Export Actions */}
          <div style="margin-top: 1rem; display: flex; gap: 0.5rem;">
            <button 
              onClick={exportDebugInfo}
              style="font-size: 0.8rem; padding: 0.25rem 0.5rem; background: #95a5a6; color: white; border: none; border-radius: 4px;"
            >
              Export Debug Info
            </button>
            <button 
              onClick={() => logger.clearLogs()}
              style="font-size: 0.8rem; padding: 0.25rem 0.5rem; background: #e74c3c; color: white; border: none; border-radius: 4px;"
            >
              Clear Logs
            </button>
          </div>
        </div>

        {/* Recent Logs */}
        <div class="debug-panel">
          <h4>Recent Logs (Last 50)</h4>
          <div style="max-height: 200px; overflow-y: auto; background: #f8f9fa; padding: 0.5rem; border-radius: 4px; font-family: monospace; font-size: 0.7rem; line-height: 1.3;">
            {recentLogs().length > 0 ? (
              recentLogs().map((log) => (
                <div 
                  style={`margin-bottom: 0.25rem; padding: 0.25rem; border-radius: 2px; ${
                    log.level === 'error' ? 'background: #ffebee; color: #c62828;' :
                    log.level === 'warn' ? 'background: #fff3e0; color: #ef6c00;' :
                    log.level === 'info' ? 'background: #e8f5e8; color: #2e7d32;' :
                    'background: #f5f5f5; color: #666;'
                  }`}
                >
                  <span style="opacity: 0.7;">{log.timestamp?.slice(11, 19)}</span>
                  <span style="font-weight: bold; margin-left: 0.5rem;">[{log.context.toUpperCase()}]</span>
                  <span style="margin-left: 0.5rem;">{log.message}</span>
                  {log.duration && <span style="color: #666;"> ({log.duration}ms)</span>}
                </div>
              ))
            ) : (
              <div style="color: #666; text-align: center; padding: 1rem;">
                No logs available. Try performing some actions to generate logs.
              </div>
            )}
          </div>
        </div>
      </div>
      <hr class="section-divider" />
      
      <div class="settings-section">
        <h3>Audio</h3>
        <div class="debug-panel">
          <h4>Audio Configuration</h4>
          <div class="debug-grid compact">
            <div class="debug-item">
              <span class="label">Target sample rate:</span>
              <div class="settings-input-group">
                <input
                  type="number"
                  min="8000"
                  max="192000"
                  step="1000"
                  value={ttsState().targetSampleRate}
                  onChange={(e) => setTargetSampleRate(parseInt((e.target as HTMLInputElement).value || '24000'))}
                  class="settings-input settings-input-large"
                />
                <span class="settings-input-label">Hz</span>
              </div>
            </div>
            <div class="debug-item">
              <span class="label">Quality Level:</span>
              <span class={`value ${(ttsState().targetSampleRate || 24000) >= 48000 ? 'status-success' : (ttsState().targetSampleRate || 24000) >= 24000 ? 'status-info' : 'status-warning'}`}>
                {(ttsState().targetSampleRate || 24000) >= 48000 ? 'High' : (ttsState().targetSampleRate || 24000) >= 24000 ? 'Standard' : 'Basic'}
              </span>
            </div>
          </div>
          <div class="settings-info success">
            <div class="settings-info-content">
              <strong>🎵 Quality Guide:</strong> 48kHz+ for high-quality output, 24kHz for standard use, 16-22kHz for bandwidth saving
            </div>
          </div>
        </div>
      </div>
      
      <div class="settings-section">
        <h3>About</h3>
        <div class="about-info">
          <p><strong>PageSonic</strong> - PDF viewer with text-to-speech</p>
          <p>Running entirely in your browser for maximum security</p>
          <p>Features:</p>
          <ul>
            <li>Local PDF viewing with text extraction</li>
            <li>Browser-based text-to-speech</li>
            <li>No data sent to external servers</li>
          </ul>
        </div>
      </div>
        </div>
      </div>
    </div>
  )
}
