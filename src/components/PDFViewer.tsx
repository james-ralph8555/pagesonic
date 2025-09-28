import { Component, createSignal } from 'solid-js'
import { usePDF } from '@/stores/pdf'
import { useTTS } from '@/stores/tts'

export const PDFViewer: Component = () => {
  const { state: pdfState, loadPDF, setCurrentPage, setScale } = usePDF()
  const { } = useTTS()
  const [fileInput, setFileInput] = createSignal<HTMLInputElement | null>(null)
  
  const handleFileSelect = (event: Event) => {
    const target = event.target as HTMLInputElement
    const file = target.files?.[0]
    if (file && file.type === 'application/pdf') {
      loadPDF(file)
    }
  }
  
  const handlePrevPage = () => {
    setCurrentPage(pdfState().currentPage - 1)
  }
  
  const handleNextPage = () => {
    setCurrentPage(pdfState().currentPage + 1)
  }
  
  const handleZoomIn = () => {
    setScale(pdfState().scale + 0.1)
  }
  
  const handleZoomOut = () => {
    setScale(pdfState().scale - 0.1)
  }
  
  return (
    <div class="pdf-viewer">
      <div class="pdf-controls">
        <input
          ref={setFileInput}
          type="file"
          accept=".pdf"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <button onClick={() => fileInput()?.click()}>Open PDF</button>
        
        {pdfState().document && (
          <>
            <button onClick={handlePrevPage} disabled={pdfState().currentPage <= 1}>
              Previous
            </button>
            <span>
              Page {pdfState().currentPage} of {pdfState().pages.length}
            </span>
            <button 
              onClick={handleNextPage} 
              disabled={pdfState().currentPage >= pdfState().pages.length}
            >
              Next
            </button>
            <button onClick={handleZoomOut}>Zoom Out</button>
            <span>{Math.round(pdfState().scale * 100)}%</span>
            <button onClick={handleZoomIn}>Zoom In</button>
          </>
        )}
      </div>
      
      {pdfState().isLoading && (
        <div class="loading">Loading PDF...</div>
      )}
      
      {pdfState().error && (
        <div class="error">{pdfState().error}</div>
      )}
      
      <div class="pdf-content">
        {pdfState().document && (
          <div class="pdf-info">
            <h3>{pdfState().document?.title || 'Untitled Document'}</h3>
            <p>Author: {pdfState().document?.author || 'Unknown'}</p>
          </div>
        )}
        
        <div class="pdf-pages">
          {/* PDF pages will be rendered here using PDF.js */}
          <div class="placeholder-page">
            <p>PDF content will appear here</p>
            <p>Scale: {pdfState().scale.toFixed(1)}x</p>
          </div>
        </div>
      </div>
    </div>
  )
}