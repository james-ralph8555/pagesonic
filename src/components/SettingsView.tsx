import { Component } from 'solid-js'
import { useTTS } from '@/stores/tts'

export const SettingsView: Component = () => {
  const { state: ttsState, models, loadModel, setVoice } = useTTS()
  
  const handleModelLoad = async (modelName: string) => {
    try {
      await loadModel(modelName)
    } catch (error) {
      console.error('Failed to load model:', error)
    }
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
          value="settings"
          onChange={(e) => {
            const value = (e.target as HTMLSelectElement).value as 'pdf' | 'settings'
            window.dispatchEvent(new CustomEvent('app:set-mode', { detail: value }))
          }}
        >
          <option value="pdf">PDF Viewer</option>
          <option value="settings">Settings</option>
        </select>
        <div class="rail-meta">App Settings</div>
      </div>

      <div class="settings-scroll">
        <div class="settings-view">
          <h2>Settings</h2>
      
      <div class="settings-section">
        <h3>TTS Model Selection</h3>
        {!ttsState().isWebGPUSupported && (
          <p class="error" style={{ padding: '0.5rem 0.75rem', margin: '0 0 0.75rem 0' }}>
            WebGPU not supported. Kokoro requires WebGPU; Kitten can run on CPU.
          </p>
        )}
        {ttsState().lastError && (
          <p class="error" style={{ padding: '0.5rem 0.75rem', margin: '0 0 0.75rem 0' }}>
            {ttsState().lastError}
          </p>
        )}
        <div class="model-list">
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
              // Only allow change when a model is loaded
              if (ttsState().model) {
                setVoice(target.value)
              }
            }}
            disabled={!ttsState().model}
          >
            {(ttsState().model?.voices || []).map(voice => (
              <option value={voice}>{voice}</option>
            ))}
          </select>
        </div>
      </div>
      
      <div class="settings-section">
        <h3>System Information</h3>
        <div class="system-info">
          <p><strong>WebGPU Status:</strong> {ttsState().isWebGPUSupported ? 'Supported' : 'Not Supported'}</p>
          {ttsState().model && (
            <p><strong>Loaded Model:</strong> {ttsState().model!.name}</p>
          )}
          <p><strong>Current Voice:</strong> {ttsState().voice}</p>
          <p><strong>Speech Rate:</strong> {ttsState().rate.toFixed(1)}x</p>
          <p><strong>Speech Pitch:</strong> {ttsState().pitch.toFixed(1)}</p>
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
