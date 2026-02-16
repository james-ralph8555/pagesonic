import { createSignal } from 'solid-js'
import { PDFDocument, PDFPage } from '@/types'
import { useTelemetry } from './telemetry'

interface PDFState {
  document: PDFDocument | null
  mimeType: string | null
  pages: PDFPage[]
  currentPage: number
  scale: number
  isLoading: boolean
  isExtracting: boolean // Background text extraction in progress
  error: string | null
  pdfDoc: any // PDF.js document instance
}

const [state, setState] = createSignal<PDFState>({
  document: null,
  mimeType: null,
  pages: [],
  currentPage: 1,
  scale: 1.0,
  isLoading: false,
  isExtracting: false,
  error: null,
  pdfDoc: null
})

export const usePDF = () => {
  const telemetry = useTelemetry()

  const beginLoading = () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))
  }

  const setError = (message: string) => {
    setState(prev => ({ ...prev, isLoading: false, error: message }))
  }

  const loadPDF = async (file: File) => {
    const loadStartTime = telemetry.emitStart('pdf', 'pdf_load_start', { fileSize: file.size })
    setState(prev => ({ ...prev, isLoading: true, error: null, isExtracting: false }))
    
    try {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'
      
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
      
      // Extract metadata
      const metadata = await pdf.getMetadata()
      const info = metadata.info as any || {}
      const documentInfo: PDFDocument = {
        title: info.Title || file.name.replace('.pdf', ''),
        author: info.Author || '',
        subject: info.Subject || '',
        keywords: info.Keywords || '',
        creator: info.Creator || '',
        producer: info.Producer || '',
        creationDate: info.CreationDate ? new Date(info.CreationDate) : undefined,
        modificationDate: info.ModDate ? new Date(info.ModDate) : undefined
      }
      
      // Stage 1: Get all page dimensions quickly (no text extraction yet)
      const numPages = pdf.numPages
      const pages: PDFPage[] = []
      
      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i)
        const viewport = page.getViewport({ scale: 1 })
        pages.push({
          pageNumber: i,
          width: viewport.width,
          height: viewport.height,
          textContent: undefined,
          textStart: undefined,
          textEnd: undefined,
          textExtracted: false
        })
      }
      
      // Stage 2: Extract first page text immediately for faster first paint
      const firstPage = await pdf.getPage(1)
      const firstTextContent = await firstPage.getTextContent()
      const firstText = firstTextContent.items.map((item: any) => item.str).join(' ')
      pages[0] = {
        ...pages[0],
        textContent: firstText,
        textStart: 0,
        textEnd: firstText.length,
        textExtracted: true
      }
      
      // Set state to allow first page to render immediately
      setState({
        document: documentInfo,
        mimeType: file.type,
        pages,
        currentPage: 1,
        scale: 1.0,
        isLoading: false,
        isExtracting: true,
        error: null,
        pdfDoc: pdf
      })
      
      const firstPaintDuration = telemetry.emitEnd(loadStartTime, 'pdf', 'pdf_load_complete', {
        totalPages: numPages,
        staged: true,
        firstPageReady: true
      })
      try { console.info('[PDF] First page ready in', firstPaintDuration, 'ms ·', numPages, 'pages total') } catch {}
      
      // Stage 3: Extract remaining pages in background
      const extractStartTime = telemetry.emitStart('pdf', 'text_extract_start', { totalPages: numPages })
      let offset = firstText.length + 2 // Account for separator
      
      for (let i = 2; i <= numPages; i++) {
        try {
          const page = await pdf.getPage(i)
          const textContent = await page.getTextContent()
          const text = textContent.items.map((item: any) => item.str).join(' ')
          
          const pageStart = offset
          const pageEnd = pageStart + text.length
          
          // Update page in state
          setState(prev => ({
            ...prev,
            pages: prev.pages.map((p, idx) =>
              idx === i - 1
                ? { ...p, textContent: text, textStart: pageStart, textEnd: pageEnd, textExtracted: true }
                : p
            )
          }))
          
          offset = pageEnd + (i < numPages ? 2 : 0)
        } catch (pageError) {
          console.error(`[PDF] Error extracting page ${i}:`, pageError)
        }
      }
      
      telemetry.emitEnd(extractStartTime, 'pdf', 'text_extract_complete', { totalPages: numPages })
      setState(prev => ({ ...prev, isExtracting: false }))
      try { console.info('[PDF] Full text extraction complete for', documentInfo.title || '(untitled)') } catch {}
      
    } catch (error) {
      telemetry.emit('pdf', 'pdf_load_error', undefined, {
        errorMessage: error instanceof Error ? error.message : 'Failed to load PDF'
      })
      setState(prev => ({
        ...prev,
        isLoading: false,
        isExtracting: false,
        error: error instanceof Error ? error.message : 'Failed to load PDF'
      }))
    }
  }
  
  const getCurrentPage = async (pageNumber?: number) => {
    if (!state().pdfDoc) return null
    try {
      const pn = pageNumber ?? state().currentPage
      return await state().pdfDoc.getPage(pn)
    } catch (error) {
      console.error('Error getting current page:', error)
      return null
    }
  }
  
  const extractTextFromPage = async (pageNumber: number) => {
    if (!state().pdfDoc) return ''
    try {
      const page = await state().pdfDoc.getPage(pageNumber)
      const textContent = await page.getTextContent()
      return textContent.items.map((item: any) => item.str).join(' ')
    } catch (error) {
      console.error('Error extracting text from page:', error)
      return ''
    }
  }
  
  const getAllExtractedText = () => {
    return state().pages.map(page => page.textContent || '').join('\n\n')
  }
  
  const setCurrentPage = (page: number) => {
    setState(prev => { 
      const newPage = Math.max(1, Math.min(page, prev.pages.length))
      return { 
        ...prev, 
        currentPage: newPage 
      }
    })
  }
  
  const setScale = (scale: number) => {
    setState(prev => ({ 
      ...prev, 
      scale: Math.max(0.1, Math.min(scale, 3.0)) 
    }))
  }
  
  return {
    state,
    beginLoading,
    loadPDF,
    setError,
    getCurrentPage,
    extractTextFromPage,
    getAllExtractedText,
    setCurrentPage,
    setScale
  }
}
