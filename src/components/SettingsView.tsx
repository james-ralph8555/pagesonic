import { Component, createSignal, createEffect } from 'solid-js'
import { useTTS } from '@/stores/tts'

export const SettingsView: Component = () => {
  const { state: ttsState, models, loadModel, setVoice, ensureBrowserEngine, primeSystemVoices, refreshSystemVoices,
    setChunkMaxChars, setChunkOverlapChars, setSentenceSplit, setInterChunkPauseMs, setTargetSampleRate } = useTTS()
  const [refreshingVoices, setRefreshingVoices] = createSignal(false)
  const [voiceMetadata, setVoiceMetadata] = createSignal<any>(null)
  
  const handleModelLoad = async (modelName: string) => {
    try {
      await loadModel(modelName)
    } catch (error) {
      console.error('Failed to load model:', error)
    }
  }

  // Load voice metadata when component mounts
  createEffect(async () => {
    try {
      const response = await fetch('/tts-model/voices.json')
      if (response.ok) {
        const data = await response.json()
        setVoiceMetadata(data)
      }
    } catch (error) {
      console.warn('Failed to load voice metadata:', error)
    }
  })

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
        <select
          class="rail-select"
          aria-label="Switch tab"
          onChange={(e) => {
            const value = (e.target as HTMLSelectElement).value as 'pdf' | 'settings'
            window.dispatchEvent(new CustomEvent('app:set-mode', { detail: value }))
          }}
        >
          <option value="pdf">PDF Viewer</option>
          <option value="settings" selected>Settings</option>
        </select>
        <div class="rail-meta">App Settings</div>
      </div>

      <div class="settings-scroll">
        <div class="settings-view">
          <h2>Settings</h2>
      
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

      <div class="settings-section">
        <h3>Voice Settings</h3>
        <div class="voice-controls">
          <label>Voice:</label>
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
        </div>
      </div>

      <div class="settings-section">
        <h3>TTS Chunking</h3>
        <p class="hint">Controls how input text is split for inference/playback. Console logs include chunk indices and timing.</p>
        <div class="voice-controls">
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
          
          {/* Voice metadata for LibriTTS speakers */}
          {ttsState().engine !== 'browser' && getCurrentSpeakerInfo() && (
            <div class="voice-metadata" style={{ 'margin-top': '1rem', 'padding-top': '1rem', 'border-top': '1px solid #ccc' }}>
              <h4 style={{ 'margin-bottom': '0.5rem' }}>Voice Details</h4>
              <p><strong>Display Name:</strong> {getCurrentSpeakerInfo()?.display_name || 'N/A'}</p>
              <p><strong>Description:</strong> {getCurrentSpeakerInfo()?.description || 'N/A'}</p>
              <p><strong>Gender:</strong> {getCurrentSpeakerInfo()?.gender || 'N/A'}</p>
              <p><strong>Accent:</strong> {getCurrentSpeakerInfo()?.accent || 'N/A'}</p>
              <p><strong>Subset:</strong> {getCurrentSpeakerInfo()?.subset || 'N/A'}</p>
              {getCurrentSpeakerInfo()?.pitch_mean && (
                <p><strong>Avg Pitch:</strong> {Math.round(getCurrentSpeakerInfo().pitch_mean)} Hz</p>
              )}
              {getCurrentSpeakerInfo()?.speaking_rate && (
                <p><strong>Speaking Rate:</strong> {Math.round(getCurrentSpeakerInfo().speaking_rate)} wpm</p>
              )}
              {getCurrentSpeakerInfo()?.brightness && (
                <p><strong>Brightness:</strong> {getCurrentSpeakerInfo().brightness.toFixed(2)}</p>
              )}
            </div>
          )}
        </div>
      </div>
      
      <div class="settings-section">
        <h3>Audio</h3>
        <div class="voice-controls">
          <label>Target sample rate:</label>
          <input
            type="number"
            min="8000"
            max="192000"
            step="1000"
            value={ttsState().targetSampleRate}
            onInput={(e) => setTargetSampleRate(parseInt((e.target as HTMLInputElement).value || '24000'))}
          />
          <span>{ttsState().targetSampleRate} Hz</span>
        </div>
      </div>

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
