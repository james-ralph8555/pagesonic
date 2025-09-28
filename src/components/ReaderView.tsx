import { Component } from 'solid-js'
import { usePDF } from '@/stores/pdf'
import { useTTS } from '@/stores/tts'

export const ReaderView: Component = () => {
  const { state: pdfState } = usePDF()
  const { state: ttsState, speak, stop } = useTTS()
  
  const handlePlay = () => {
    if (pdfState().document) {
      speak("Sample text from PDF will be spoken here")
    }
  }
  
  const handleStop = () => {
    stop()
  }
  
  return (
    <div class="reader-view">
      <div class="reader-controls">
        <h3>Reader Mode</h3>
        <button onClick={handlePlay} disabled={ttsState().isPlaying}>
          Play
        </button>
        <button onClick={handleStop} disabled={!ttsState().isPlaying}>
          Stop
        </button>
        
        <div class="voice-controls">
          <label>Voice:</label>
          <select>
            {(ttsState().model?.voices || []).map(voice => (
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
          />
          
          <label>Pitch:</label>
          <input 
            type="range" 
            min="0.5" 
            max="2" 
            step="0.1" 
            value={ttsState().pitch}
          />
        </div>
      </div>
      
      <div class="reader-content">
        {pdfState().document ? (
          <div class="extracted-text">
            <h2>{(pdfState().document?.title) || 'Untitled Document'}</h2>
            <div class="text-content">
              {/* Extracted text will appear here */}
              <p>This is where the extracted text from the PDF will be displayed.</p>
              <p>Text extraction will be implemented using PDF.js getTextContent().</p>
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