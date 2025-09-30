import { Component, createSignal } from 'solid-js'
import { usePDF } from '@/stores/pdf'
import { useTTS } from '@/stores/tts'

export const ReaderView: Component = () => {
  const { state: pdfState, getAllExtractedText } = usePDF()
  const { state: ttsState, speak, stop, setVoice, setRate, setPitch, loadModel, selectBrowserEngine } = useTTS()
  const [fontSize, setFontSize] = createSignal(16)
  const [lineHeight] = createSignal(1.6)
  
  const handlePlay = () => {
    const text = getAllExtractedText()
    if (text && text.trim()) {
      speak(text)
    }
  }
  
  const handleStop = () => {
    stop()
  }
  
  const handleVoiceChange = (event: Event) => {
    const target = event.target as HTMLSelectElement
    setVoice(target.value)
  }
  
  const handleRateChange = (event: Event) => {
    const target = event.target as HTMLInputElement
    setRate(parseFloat(target.value))
  }
  
  const handlePitchChange = (event: Event) => {
    const target = event.target as HTMLInputElement
    setPitch(parseFloat(target.value))
  }
  
  const handleFontSizeChange = (event: Event) => {
    const target = event.target as HTMLInputElement
    setFontSize(parseInt(target.value))
  }
  
  const handleLoadModel = async (modelName: string) => {
    try {
      if (!modelName) return
      if (modelName === 'Browser TTS') {
        selectBrowserEngine()
      } else {
        await loadModel(modelName)
      }
    } catch (error) {
      console.error('Failed to load model:', error)
    }
  }
  
  const extractedText = () => getAllExtractedText()
  
  return (
    <div class="reader-view">
      <div class="reader-controls">
        <h3>Reader Mode</h3>
        
        <div class="tts-controls">
          <button onClick={handlePlay} disabled={!pdfState().document || ttsState().isPlaying}>
            Play
          </button>
          <button onClick={handleStop} disabled={!ttsState().isPlaying}>
            Stop
          </button>
        </div>
        
        <div class="model-controls">
          <label>TTS Model:</label>
          <select 
            onChange={(e) => handleLoadModel(e.target.value)}
            disabled={ttsState().isModelLoading}
          >
            <option value="">Select engine/model...</option>
            <option value="Browser TTS">Browser TTS (System)</option>
            <option value="Kokoro TTS">Kokoro TTS (82MB)</option>
            <option value="Kitten TTS">Kitten TTS (15MB)</option>
          </select>
          {ttsState().isModelLoading && <span class="loading-model">Loading model...</span>}
        </div>
        
        <div class="voice-controls">
          <label>Voice:</label>
          <select 
            value={ttsState().voice}
            onChange={handleVoiceChange}
            disabled={!ttsState().model && ttsState().engine !== 'browser'}
          >
            {(ttsState().engine === 'browser'
              ? (ttsState().systemVoices || [])
              : (ttsState().model?.voices || [])
            ).map(voice => (
              <option value={voice}>{voice}</option>
            ))}
          </select>
          
          <label>Speed:</label>
          <input 
            type="range" 
            min="0.5" 
            max="2" 
            step="0.1" 
            value={ttsState().rate}
            onChange={handleRateChange}
          />
          <span>{ttsState().rate.toFixed(1)}x</span>
          
          <label>Pitch:</label>
          <input 
            type="range" 
            min="0.5" 
            max="2" 
            step="0.1" 
            value={ttsState().pitch}
            onChange={handlePitchChange}
          />
          <span>{ttsState().pitch.toFixed(1)}</span>
        </div>
        
        <div class="text-controls">
          <label>Font Size:</label>
          <input 
            type="range" 
            min="12" 
            max="24" 
            step="1" 
            value={fontSize()}
            onChange={handleFontSizeChange}
          />
          <span>{fontSize()}px</span>
        </div>
      </div>
      
      <div class="reader-content">
        {pdfState().document ? (
          <div class="extracted-text">
            <h2>{(pdfState().document?.title) || 'Untitled Document'}</h2>
            <div class="text-content" style={{
              'font-size': `${fontSize()}px`,
              'line-height': lineHeight()
            }}>
              {extractedText() ? (
                extractedText().split('\n\n').map((paragraph, index) => (
                  <p data-index={index}>{paragraph}</p>
                ))
              ) : (
                <p class="no-text">No text content found in this PDF.</p>
              )}
            </div>
          </div>
        ) : (
          <div class="no-document">
            <p>No PDF loaded. Please open a PDF document first.</p>
          </div>
        )}
      </div>
    </div>
  )
}
