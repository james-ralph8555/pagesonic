import { Component } from 'solid-js'
import { useTTS } from '@/stores/tts'

export const SettingsView: Component = () => {
  const { state: ttsState, models, loadModel } = useTTS()
  
  const handleModelLoad = (modelName: string) => {
    loadModel(modelName).catch(error => {
      console.error('Failed to load model:', error)
    })
  }
  
  return (
    <div class="settings-view">
      <h2>Settings</h2>
      
      <div class="settings-section">
        <h3>TTS Model Selection</h3>
        <div class="model-list">
          {models.map((model) => (
            <div class="model-item">
              <div class="model-info">
                <h4>{model.name}</h4>
                <p>Size: {model.size}MB</p>
                <p>Voices: {model.voices.join(', ')}</p>
                <p>WebGPU Required: {model.requiresWebGPU ? 'Yes' : 'No'}</p>
                <p>WebGPU Supported: {ttsState().isWebGPUSupported ? 'Yes' : 'No'}</p>
              </div>
              <button
                onClick={() => handleModelLoad(model.name)}
                disabled={ttsState().isModelLoading}
              >
                {ttsState().isModelLoading ? 'Loading...' : 'Load Model'}
              </button>
            </div>
          ))}
        </div>
      </div>
      
      <div class="settings-section">
        <h3>WebGPU Status</h3>
        <p>WebGPU is {ttsState().isWebGPUSupported ? 'supported' : 'not supported'} on this device</p>
      </div>
      
      <div class="settings-section">
        <h3>About</h3>
        <p>PageSonic - Privacy-preserving PDF viewer with text-to-speech</p>
        <p>Running entirely in your browser for maximum privacy</p>
      </div>
    </div>
  )
}