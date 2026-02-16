import { createSignal } from 'solid-js'
import { PDFDocument, PDFPage } from '@/types'
import { useTelemetry } from './telemetry'
import {
  createExtractionQueue,
  reprioritizeQueue,
  getNextPage
} from '@/utils/extraction-queue'

// Test PDF fixtures for automated browser testing
export const TEST_PDF_FIXTURES = {
  short: '/fixtures/test-short.pdf',
  medium: '/fixtures/test-medium.pdf',
  long: '/fixtures/test-long.pdf'
} as const

export type TestPDFKey = keyof typeof TEST_PDF_FIXTURES

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
      
      // Stage 3: Extract remaining pages in priority order (viewport proximity)
      const extractStartTime = telemetry.emitStart('pdf', 'text_extract_start', { totalPages: numPages })

      // Create extraction queue sorted by proximity to current page
      const extractedPages = new Set<number>([1]) // Page 1 already extracted
      let extractionQueue = createExtractionQueue({
        currentPage: 1,
        totalPages: numPages,
        extractedPages
      })
      let lastCurrentPage = 1

      try { console.info('[PDF] Extraction queue initialized with', numPages - 1, 'pages') } catch {}

      let pageNumber: number | undefined
      while ((pageNumber = getNextPage(extractionQueue, extractedPages)) !== undefined) {
        // Yield to browser between extractions to allow UI updates and scrolling
        await new Promise(resolve => setTimeout(resolve, 0))

        // Check if current page changed and reprioritize queue
        const currentVisiblePage = state().currentPage
        if (currentVisiblePage !== lastCurrentPage) {
          extractionQueue = reprioritizeQueue(extractionQueue, currentVisiblePage, extractedPages)
          lastCurrentPage = currentVisiblePage
        }

        try {
          const page = await pdf.getPage(pageNumber)
          const textContent = await page.getTextContent()
          const text = textContent.items.map((item: any) => item.str).join(' ')

          // Recalculate text offsets (need to account for all previously extracted pages)
          const sortedExtracted = Array.from(extractedPages).sort((a, b) => a - b)
          let calculatedOffset = 0
          for (const extractedPage of sortedExtracted) {
            const pageData = state().pages[extractedPage - 1]
            if (pageData?.textEnd !== undefined) {
              calculatedOffset = Math.max(calculatedOffset, pageData.textEnd + 2)
            }
          }
          // Also account for first page if not in set yet
          if (calculatedOffset === 0 && firstText.length > 0) {
            calculatedOffset = firstText.length + 2
          }

          const pageStart = calculatedOffset
          const pageEnd = pageStart + text.length

          // Update page in state
          setState(prev => ({
            ...prev,
            pages: prev.pages.map((p, idx) =>
              idx === pageNumber! - 1
                ? { ...p, textContent: text, textStart: pageStart, textEnd: pageEnd, textExtracted: true }
                : p
            )
          }))

          extractedPages.add(pageNumber)
        } catch (pageError) {
          console.error(`[PDF] Error extracting page ${pageNumber}:`, pageError)
          extractedPages.add(pageNumber) // Mark as done to avoid infinite retry
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

  const loadPDFFromURL = async (url: string, filename?: string) => {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`)
      }
      const blob = await response.blob()
      const name = filename || url.split('/').pop() || 'document.pdf'
      const file = new File([blob], name, { type: 'application/pdf' })
      await loadPDF(file)
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        isExtracting: false,
        error: error instanceof Error ? error.message : 'Failed to load PDF from URL'
      }))
    }
  }

  const loadTestPDF = async (key: TestPDFKey) => {
    const url = TEST_PDF_FIXTURES[key]
    if (!url) {
      setError(`Unknown test PDF: ${key}. Valid options: ${Object.keys(TEST_PDF_FIXTURES).join(', ')}`)
      return
    }
    await loadPDFFromURL(url, `test-${key}.pdf`)
  }

  const checkAndLoadTestPDF = async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    const testPDF = params.get('test-pdf')
    if (testPDF && testPDF in TEST_PDF_FIXTURES) {
      await loadTestPDF(testPDF as TestPDFKey)
      return true
    }
    return false
  }
  
  return {
    state,
    beginLoading,
    loadPDF,
    loadPDFFromURL,
    loadTestPDF,
    checkAndLoadTestPDF,
    setError,
    getCurrentPage,
    extractTextFromPage,
    getAllExtractedText,
    setCurrentPage,
    setScale
  }
}
