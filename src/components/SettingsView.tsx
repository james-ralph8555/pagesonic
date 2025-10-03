import { Component, createSignal, createEffect } from 'solid-js'
import { useTTS } from '@/stores/tts'
import { useTheme } from '@/stores/theme'
import { GlassDropdownButton } from './GlassDropdownButton'
import { getIOSInfo } from '@/utils/iosDetection'

export const SettingsView: Component = () => {
  const { 
    state: ttsState, 
    models, 
    loadModel, 
    setVoice, 
    // Phonemizer controls
    setPhonemizer,
    
    // Optional advanced tweak
    // setEspeakTimeoutMs,
    
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
    filterVoicesByBrightnessRange,
    // iOS-specific helpers
    getAudioState,
    unlockAudioIOS,
    // iOS Audio Settings setters
    setIOSPreferredSampleRate,
    setIOSForceResample,
    setIOSFadeDuration,
    setIOSGainLevel,
    setIOSMaxChunkSize,
    setIOSMaxResamplingFrames,
    setIOSMaxRetries,
    setIOSBaseRetryDelay,
    setIOSUseWebAudio,
    setIOSHighQualityResampling,
    setIOSCrossfadeChunkSize,
    setIOSNormalizationHeadroom,
    resetIOSAudioSettings,
    // Testing
    playTestTone
  } = useTTS()
  const { theme, setTheme } = useTheme()
  
  // Helper to access debug log from global scope
  const getDebugLog = () => (typeof window !== 'undefined' ? (window as any).__ios_debug_log || [] : [])
  
  const [refreshingVoices, setRefreshingVoices] = createSignal(false)
  const [voiceMetadata, setVoiceMetadata] = createSignal<any>(null)
  
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
  
  // iOS detection and audio settings
  const [iosInfo] = createSignal(getIOSInfo())
  const [showAdvancedIOS, setShowAdvancedIOS] = createSignal(false)
  
  const handleModelLoad = async (modelName: string) => {
    try {
      await loadModel(modelName)
    } catch (error) {
      console.error('Failed to load model:', error)
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
            { value: 'settings', label: 'Settings' }
          ]}
          onSelect={(value) => {
            window.dispatchEvent(new CustomEvent('app:set-mode', { detail: value as 'pdf' | 'settings' }))
          }}
        />
        <div class="rail-meta">App Settings</div>
      </div>

      <div class="settings-scroll">
        <div class="settings-view">

      <div class="settings-section">
        <h3>Appearance</h3>
        <div class="dropdown">
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
              <p>Uses built-in SpeechSynthesis voices</p>
              <p>Voices: {(ttsState().systemVoices || []).length > 0 ? (ttsState().systemVoices || []).join(', ') : 'none detected'}</p>
              <p class={`status ${ttsState().engine === 'browser' ? 'loaded' : ((ttsState().systemVoices || []).length > 0 ? 'available' : 'incompatible')}`}>
                {ttsState().engine === 'browser' ? 'Currently in use' : (
                  (ttsState().systemVoices || []).length > 0 ? 'Available' : 'Unavailable (no voices). A system speech backend must be installed.'
                )}
              </p>
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
                  <p>Size: {model.size}MB</p>
                  <p>Voices: {model.voices.join(', ')}</p>
                  <p>WebGPU Required: {model.requiresWebGPU ? 'Yes' : 'No'}</p>
                  <p class={`status ${modelStatus.status}`}>
                    {modelStatus.message}
                  </p>
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
        
        {/* Phonemizer selection */}
        {ttsState().model?.name === 'Piper TTS' && ttsState().engine === 'local' && (
          <div class="dropdown">
            <label>Phonemizer:</label>
            <select
              value={ttsState().phonemizer || 'auto'}
              onChange={(e) => setPhonemizer(((e.target as HTMLSelectElement).value as any))}
            >
              <option value="auto">Auto (safe on iOS)</option>
              <option value="espeak">eSpeak (experimental)</option>
              <option value="text">Text (fallback)</option>
            </select>
            <p class="hint">Auto uses eSpeak where reliable; falls back on iOS if it stalls. Choose eSpeak to force higher quality if stable on your device.</p>
          </div>
        )}
        
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
        <div class="dropdown">
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
        <p class="hint">Controls how input text is split for inference/playback. Console logs include chunk indices and timing.</p>
        <div class="dropdown">
          <label>Max chunk size:</label>
          <input
            type="number"
            min="64"
            max="2000"
            step="10"
            value={ttsState().chunkMaxChars}
            onInput={(e) => setChunkMaxChars(parseInt((e.target as HTMLInputElement).value || '280'))}
          />
          <span>{ttsState().chunkMaxChars} chars</span>

          <label>Overlap:</label>
          <input
            type="number"
            min="0"
            max="200"
            step="1"
            value={ttsState().chunkOverlapChars}
            onInput={(e) => setChunkOverlapChars(parseInt((e.target as HTMLInputElement).value || '0'))}
          />
          <span>{ttsState().chunkOverlapChars} chars</span>

          <label>Split by sentence:</label>
          <input
            type="checkbox"
            checked={!!ttsState().sentenceSplit}
            onChange={(e) => setSentenceSplit((e.target as HTMLInputElement).checked)}
          />

          <label>Pause between chunks:</label>
          <input
            type="number"
            min="0"
            max="2000"
            step="20"
            value={ttsState().interChunkPauseMs}
            onInput={(e) => setInterChunkPauseMs(parseInt((e.target as HTMLInputElement).value || '0'))}
          />
          <span>{ttsState().interChunkPauseMs} ms</span>
        </div>
      </div>
      <hr class="section-divider" />
      
      <div class="settings-section">
        <h3>System Information</h3>
        <div class="system-info">
          <p><strong>WebGPU Status:</strong> {ttsState().isWebGPUSupported ? 'Supported' : 'Not Supported'}</p>
          {ttsState().model && (
            <p><strong>Loaded Model:</strong> {ttsState().model!.name}</p>
          )}
          <p><strong>Current Voice:</strong> {(() => {
            if (ttsState().engine === 'browser' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
              const voices = window.speechSynthesis.getVoices()
              const requested = (ttsState().voice || '').toLowerCase()
              const selected = voices.find(v => v.name.toLowerCase() === requested) ||
                               voices.find(v => v.name.toLowerCase().includes(requested))
              return selected?.name || ttsState().voice
            }
            return ttsState().voice
          })()}</p>
          <p><strong>Speech Rate:</strong> {ttsState().rate.toFixed(1)}x</p>
          <p><strong>Speech Pitch:</strong> {ttsState().pitch.toFixed(1)}</p>
          
          {/* iOS Debugging Information */}
          {(() => {
            const isiosDebug = /iPad|iPhone|iPod/.test(navigator.userAgent)
            if (isiosDebug) {
              const audioState = getAudioState()
              return (
                <div style={{ 'margin-top': '1rem', 'padding': '0.75rem', 'background': '#f0f4f8', 'border-radius': '4px', 'font-size': '0.9em' }}>
                  <h4 style={{ 'margin-bottom': '0.5rem', 'color': '#2563eb' }}>📱 iOS Debug Information</h4>
                  <p><strong>User Agent:</strong> {navigator.userAgent}</p>
                  <p><strong>iOS Detected:</strong> {isiosDebug ? 'Yes ✅' : 'No ❌'}</p>
                  <p><strong>Audio Context State:</strong> {audioState?.audioContextState || 'Unknown'}</p>
                  <p><strong>Audio Unlocked:</strong> {audioState?.isAudioUnlocked ? 'Yes ✅' : 'No ❌'}</p>
                  <p><strong>Current Engine:</strong> {ttsState().engine}</p>
                  <p><strong>Web Audio Support:</strong> {typeof window !== 'undefined' && 'AudioContext' in window ? 'Yes' : 'No'}</p>
                  <p><strong>Speech Synthesis Support:</strong> {typeof window !== 'undefined' && 'speechSynthesis' in window ? 'Yes' : 'No'}</p>
                  {audioState?.lastError && (
                    <p style={{ 'color': '#dc2626' }}><strong>Last Audio Error:</strong> {audioState.lastError}</p>
                  )}
                  {ttsState().lastError && (
                    <p style={{ 'color': '#dc2626' }}><strong>Last TTS Error:</strong> {ttsState().lastError}</p>
                  )}
                  <div style={{ 'margin-top': '0.5rem', 'display': 'flex', 'gap': '0.5rem', 'flex-wrap': 'wrap' }}>
                    <button 
                      onClick={async () => {
                        console.log('[iOS Debug] Manual audio unlock triggered')
                        try {
                          const success = await unlockAudioIOS()
                          console.log('[iOS Debug] Manual unlock result:', success)
                          alert(`Audio unlock ${success ? 'succeeded ✅' : 'failed ❌'}`)
                        } catch (error) {
                          console.error('[iOS Debug] Manual unlock error:', error)
                          alert(`Audio unlock failed: ${error}`)
                        }
                      }}
                      style={{ 'padding': '0.25rem 0.5rem', 'font-size': '0.85em' }}
                    >
                      Manual Audio Unlock
                    </button>
                    <button 
                      onClick={async () => {
                        console.log('[iOS Debug] Playing test tone...')
                        try {
                          await playTestTone(440, 1.5) // 440Hz for 1.5 seconds
                          alert('Test tone playback completed! 🎵')
                        } catch (error) {
                          console.error('[iOS Debug] Test tone failed:', error)
                          alert(`Test tone failed: ${error}`)
                        }
                      }}
                      style={{ 'padding': '0.25rem 0.5rem', 'font-size': '0.85em', 'background-color': '#4CAF50', 'color': 'white' }}
                    >
                      Play Test Tone (440Hz)
                    </button>
                    <button 
                      onClick={() => {
                        console.log('[iOS Debug] Audio state check:', audioState)
                        console.log('[iOS Debug] TTS state:', ttsState())
                        alert(`Audio Context: ${audioState?.audioContextState || 'unknown'}\nAudio Unlocked: ${audioState?.isAudioUnlocked ? 'yes' : 'no'}\nEngine: ${ttsState().engine}\niOS Detected: ${audioState?.isIOS ? 'yes' : 'no'}`)
                      }}
                      style={{ 'padding': '0.25rem 0.5rem', 'font-size': '0.85em' }}
                    >
                      Check State
                    </button>
                    <button 
                      onClick={() => {
                        console.log('[iOS Debug] Testing silent audio play...')
                        // Test audio context creation and silent buffer playback
                        if (typeof window !== 'undefined' && 'AudioContext' in window) {
                          try {
                            const ctx = new AudioContext()
                            const silentBuffer = ctx.createBuffer(1, 1, ctx.sampleRate)
                            const source = ctx.createBufferSource()
                            source.buffer = silentBuffer
                            source.connect(ctx.destination)
                            source.start(0)
                            console.log('[iOS Debug] Silent audio test successful')
                            alert('Silent audio test successful ✅')
                          } catch (error) {
                            console.error('[iOS Debug] Silent audio test failed:', error)
                            alert(`Silent audio test failed: ${error}`)
                          }
                        } else {
                          alert('Web Audio API not supported')
                        }
                      }}
                      style={{ 'padding': '0.25rem 0.5rem', 'font-size': '0.85em' }}
                    >
                      Test Silent Audio
                    </button>
                    <button 
                      onClick={() => {
                        const log = audioState?.debugLog || []
                        const logText = log.length > 0 ? log.slice(-10).join('\n') : 'No debug log entries'
                        alert(`Debug Log (last 10 entries):\n${logText}`)
                      }}
                      style={{ 'padding': '0.25rem 0.5rem', 'font-size': '0.85em' }}
                    >
                      Show Debug Log
                    </button>
                    <button 
                      onClick={() => {
                        if (confirm('Clear debug log?')) {
                          const log = getDebugLog()
                          log.length = 0
                          alert('Debug log cleared')
                        }
                      }}
                      style={{ 'padding': '0.25rem 0.5rem', 'font-size': '0.85em' }}
                    >
                      Clear Log
                    </button>
                  </div>
                </div>
              )
            }
            return null
          })()}
          
          {/* Voice metadata for LibriTTS speakers */}
          {ttsState().engine !== 'browser' && getCurrentSpeakerInfo() && (
            <div class="voice-metadata" style={{ 'margin-top': '1rem', 'padding-top': '1rem', 'border-top': '1px solid #ccc' }}>
              <h4 style={{ 'margin-bottom': '0.5rem' }}>Voice Details</h4>
              <p><strong>Display Name:</strong> {getCurrentSpeakerInfo()?.display_name || 'N/A'}</p>
              <p><strong>Description:</strong> {getCurrentSpeakerInfo()?.description || 'N/A'}</p>
              <p><strong>Gender:</strong> {getCurrentSpeakerInfo()?.gender === 'F' ? 'Female' : getCurrentSpeakerInfo()?.gender === 'M' ? 'Male' : 'Unknown'}</p>
              
              {/* Numeric characteristics */}
              <div class="voice-characteristics">
                {getCurrentSpeakerInfo()?.pitch_mean && (
                  <div class="characteristic">
                    <span class="label">Avg Pitch:</span>
                    <span class="value">{Math.round(getCurrentSpeakerInfo().pitch_mean)} Hz</span>
                  </div>
                )}
                {getCurrentSpeakerInfo()?.speaking_rate && (
                  <div class="characteristic">
                    <span class="label">Speaking Rate:</span>
                    <span class="value">{Math.round(getCurrentSpeakerInfo().speaking_rate)} wpm</span>
                  </div>
                )}
                {getCurrentSpeakerInfo()?.brightness && (
                  <div class="characteristic">
                    <span class="label">Brightness:</span>
                    <span class="value">{getCurrentSpeakerInfo().brightness.toFixed(2)}</span>
                  </div>
                )}
              </div>
              
              {/* Rich tags display */}
              {getCurrentSpeakerInfo()?.tags && getCurrentSpeakerInfo()?.tags.length > 0 && (
                <div class="voice-tags">
                  <p><strong>Voice Traits:</strong></p>
                  <div class="tags-list">
                    {getCurrentSpeakerInfo().tags.map((tag: string) => (
                      <span class="voice-tag">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <hr class="section-divider" />
      
      <div class="settings-section">
        <h3>Audio</h3>
        <div class="dropdown">
          <label>Target sample rate:</label>
          <input
            type="number"
            min="8000"
            max="192000"
            step="1000"
            value={ttsState().targetSampleRate}
            onChange={(e) => setTargetSampleRate(parseInt((e.target as HTMLInputElement).value || '24000'))}
          />
          <span>{ttsState().targetSampleRate} Hz</span>
        </div>
        {/* Optional: eSpeak timeout control (hidden by default) */}
        {/*
        {ttsState().model?.name === 'Piper TTS' && ttsState().engine === 'local' && (
          <div class="dropdown">
            <label>eSpeak timeout (ms):</label>
            <input
              type="number"
              min="500"
              max="10000"
              step="100"
              value={ttsState().espeakTimeoutMs || 2000}
              onInput={(e) => setEspeakTimeoutMs(parseInt((e.target as HTMLInputElement).value || '2000'))}
            />
          </div>
        )}
        */}
      </div>
      <hr class="section-divider" />
      
      {/* iOS Audio Settings Section */}
      {iosInfo().isIOS && (
        <div class="settings-section">
          <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
            <h3>iOS Audio Settings 🍎</h3>
            <button 
              onClick={() => setShowAdvancedIOS(!showAdvancedIOS())}
              style={{ 
                'font-size': '0.85em', 
                'padding': '0.25rem 0.5rem', 
                'background': showAdvancedIOS() ? '#2563eb' : '#64748b', 
                'color': 'white', 
                'border': 'none', 
                'border-radius': '4px',
                'cursor': 'pointer'
              }}
            >
              {showAdvancedIOS() ? 'Hide Advanced' : 'Show Advanced'}
            </button>
          </div>
          
          <p class="hint">
            Fine-tune audio playback specifically for iOS Safari to reduce aliasing and improve quality.
          </p>
          
          {/* Basic Settings */}
          <div class="dropdown">
            <label>Preferred Sample Rate:</label>
            <select
              value={ttsState().iosAudioSettings?.preferredSampleRate || 44100}
              onChange={(e) => setIOSPreferredSampleRate(parseInt((e.target as HTMLSelectElement).value))}
            >
              <option value={null as any}>Auto (browser default)</option>
              <option value={22050}>22050 Hz (Lower quality, less memory)</option>
              <option value={44100}>44100 Hz (Recommended for iOS)</option>
              <option value={48000}>48000 Hz (Higher quality)</option>
            </select>
            <p class="hint">Most iOS devices work best with 44100Hz. Choose Auto to let the browser decide.</p>
            
            <div style={{ display: 'flex', 'align-items': 'center', 'gap': '0.5rem', 'margin-top': '1rem' }}>
              <input
                type="checkbox"
                id="forceResample"
                checked={!!ttsState().iosAudioSettings?.forceResampleToPreferred}
                onChange={(e) => setIOSForceResample((e.target as HTMLInputElement).checked)}
              />
              <label for="forceResample" style={{ margin: 0 }}>Force resampling to preferred rate</label>
            </div>
            <p class="hint">May improve quality but uses more processing power.</p>
          </div>
          
          <div class="dropdown">
            <label>Audio Fade Duration: {ttsState().iosAudioSettings?.fadeDurationMs || 10}ms</label>
            <input
              type="range"
              min="0"
              max="50"
              value={ttsState().iosAudioSettings?.fadeDurationMs || 10}
              onInput={(e) => setIOSFadeDuration(parseInt((e.target as HTMLInputElement).value))}
              style={{ width: '100%' }}
            />
            <p class="hint">Longer fades prevent audio clicks but may make transitions less responsive.</p>
          </div>
          
          <div class="dropdown">
            <label>Audio Gain Level: {ttsState().iosAudioSettings?.gainLevel?.toFixed(2) || '0.80'}</label>
            <input
              type="range"
              min="0.1"
              max="2.0"
              step="0.05"
              value={ttsState().iosAudioSettings?.gainLevel || 0.8}
              onInput={(e) => setIOSGainLevel(parseFloat((e.target as HTMLInputElement).value))}
              style={{ width: '100%' }}
            />
            <p class="hint">Higher values increase volume but may cause clipping. Lower values prevent distortion.</p>
          </div>
          
          <div class="dropdown">
            <label>Max Chunk Size: {ttsState().iosAudioSettings?.maxChunkSizeSeconds || 5} seconds</label>
            <input
              type="range"
              min="1"
              max="30"
              value={ttsState().iosAudioSettings?.maxChunkSizeSeconds || 5}
              onInput={(e) => setIOSMaxChunkSize(parseInt((e.target as HTMLInputElement).value))}
              style={{ width: '100%' }}
            />
            <p class="hint">Smaller chunks use less memory but may cause more frequent processing pauses.</p>
          </div>
          
          {/* Advanced Settings */}
          {showAdvancedIOS() && (
            <>
              <h4 style={{ 'margin-top': '1.5rem', 'color': '#64748b' }}>Advanced Settings</h4>
              
              <div class="dropdown">
                <label>Max Resampling Frames: {ttsState().iosAudioSettings?.maxResamplingFrames || 48000}</label>
                <input
                  type="range"
                  min="12000"
                  max="192000"
                  step="6000"
                  value={ttsState().iosAudioSettings?.maxResamplingFrames || 48000}
                  onInput={(e) => setIOSMaxResamplingFrames(parseInt((e.target as HTMLInputElement).value))}
                  style={{ width: '100%' }}
                />
                <p class="hint">Maximum buffer size for high-quality resampling. Lower values save memory.</p>
              </div>
              
              <div class="dropdown">
                <label>Audio Context Retries: {ttsState().iosAudioSettings?.maxRetries || 3}</label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={ttsState().iosAudioSettings?.maxRetries || 3}
                  onInput={(e) => setIOSMaxRetries(parseInt((e.target as HTMLInputElement).value))}
                  style={{ width: '100%' }}
                />
              </div>
              
              <div class="dropdown">
                <label>Retry Delay Base: {ttsState().iosAudioSettings?.baseRetryDelayMs || 150}ms</label>
                <input
                  type="range"
                  min="50"
                  max="2000"
                  step="50"
                  value={ttsState().iosAudioSettings?.baseRetryDelayMs || 150}
                  onInput={(e) => setIOSBaseRetryDelay(parseInt((e.target as HTMLInputElement).value))}
                  style={{ width: '100%' }}
                />
              </div>
              
              <div class="dropdown">
                <label>Crossfade Chunk Size: {ttsState().iosAudioSettings?.crossfadeChunkSize || 100}</label>
                <input
                  type="range"
                  min="10"
                  max="1000"
                  step="10"
                  value={ttsState().iosAudioSettings?.crossfadeChunkSize || 100}
                  onInput={(e) => setIOSCrossfadeChunkSize(parseInt((e.target as HTMLInputElement).value))}
                  style={{ width: '100%' }}
                />
                <p class="hint">Size of crossfade between audio chunks to prevent clicks.</p>
              </div>
              
              <div class="dropdown">
                <label>Normalization Headroom: {((ttsState().iosAudioSettings?.normalizationHeadroom || 0.05) * 100).toFixed(1)}%</label>
                <input
                  type="range"
                  min="0.01"
                  max="0.5"
                  step="0.01"
                  value={ttsState().iosAudioSettings?.normalizationHeadroom || 0.05}
                  onInput={(e) => setIOSNormalizationHeadroom(parseFloat((e.target as HTMLInputElement).value))}
                  style={{ width: '100%' }}
                />
                <p class="hint">Percentage below maximum to leave as headroom to prevent clipping.</p>
              </div>
              
              <div class="dropdown">
                <div style={{ display: 'flex', 'align-items': 'center', 'gap': '0.5rem' }}>
                  <input
                    type="checkbox"
                    id="highQualityResampling"
                    checked={!!ttsState().iosAudioSettings?.enableHighQualityResampling}
                    onChange={(e) => setIOSHighQualityResampling((e.target as HTMLInputElement).checked)}
                  />
                  <label for="highQualityResampling" style={{ margin: 0 }}>Enable high-quality resampling</label>
                </div>
                <p class="hint">Uses OfflineAudioContext for better quality but may use more memory.</p>
              </div>
              
              <div class="dropdown">
                <div style={{ display: 'flex', 'align-items': 'center', 'gap': '0.5rem' }}>
                  <input
                    type="checkbox"
                    id="useWebAudio"
                    checked={!!ttsState().iosAudioSettings?.useWebAudioOnIOS}
                    onChange={(e) => setIOSUseWebAudio((e.target as HTMLInputElement).checked)}
                  />
                  <label for="useWebAudio" style={{ margin: 0 }}>Use WebAudio API (recommended)</label>
                </div>
                <p class="hint">WebAudio provides better control and quality on iOS.</p>
              </div>
            </>
          )}
          
          <div style={{ 'margin-top': '1.5rem', 'display': 'flex', 'gap': '0.5rem' }}>
            <button
              onClick={() => {
                if (confirm('Reset all iOS audio settings to defaults?')) {
                  resetIOSAudioSettings()
                }
              }}
              style={{ 
                'padding': '0.5rem 1rem', 
                'background': '#dc2626', 
                'color': 'white', 
                'border': 'none', 
                'border-radius': '4px',
                'cursor': 'pointer'
              }}
            >
              Reset to Defaults
            </button>
            
            <button
              onClick={async () => {
                try {
                  await playTestTone(440, 2.0) // 2 second test tone
                  alert('Test tone completed! Listen for quality issues.')
                } catch (error) {
                  alert(`Test tone failed: ${error}`)
                }
              }}
              style={{ 
                'padding': '0.5rem 1rem', 
                'background': '#4CAF50', 
                'color': 'white', 
                'border': 'none', 
                'border-radius': '4px',
                'cursor': 'pointer'
              }}
            >
              Test Audio
            </button>
          </div>
          
          {/* iOS Device Info */}
          <div style={{ 
            'margin-top': '1rem', 
            'padding': '0.75rem', 
            'background': '#f8fafc', 
            'border-radius': '4px', 
            'font-size': '0.9em',
            'border': '1px solid #e2e8f0'
          }}>
            <h4 style={{ 'margin-bottom': '0.5rem', 'color': '#475569' }}>Device Information</h4>
            <p><strong>iOS Detected:</strong> {iosInfo().isIOS ? 'Yes' : 'No'}</p>
            <p><strong>Safari Browser:</strong> {iosInfo().isSafari ? 'Yes' : 'No'}</p>
            <p><strong>iOS Version:</strong> {iosInfo().version || 'Unknown'}</p>
            <p><strong>Advanced Audio Support:</strong> {iosInfo().supportsAdvancedAudio ? 'Yes' : 'No'}</p>
          </div>
        </div>
      )}
      
      {iosInfo().isIOS && <hr class="section-divider" />}

      <div class="settings-section">
        <h3>About</h3>
        <div class="about-info">
          <p><strong>PageSonic</strong> - Privacy-preserving PDF viewer with text-to-speech</p>
          <p>Running entirely in your browser for maximum privacy</p>
          <p>Features:</p>
          <ul>
            <li>Local PDF viewing with text extraction</li>
            <li>Browser-based text-to-speech</li>
            <li>No data sent to external servers</li>
            <li>Works offline</li>
          </ul>
        </div>
      </div>
        </div>
      </div>
    </div>
  )
}
