import { createSignal } from 'solid-js'
import { PDFDocument, PDFPage } from '@/types'

interface PDFState {
  document: PDFDocument | null
  pages: PDFPage[]
  currentPage: number
  scale: number
  isLoading: boolean
  error: string | null
  pdfDoc: any // PDF.js document instance
}

const [state, setState] = createSignal<PDFState>({
  document: null,
  pages: [],
  currentPage: 1,
  scale: 1.0,
  isLoading: false,
  error: null,
  pdfDoc: null
})

export const usePDF = () => {
  const loadPDF = async (file: File) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      const pdfjs = await import('pdfjs-dist')
      // Set worker path - will be copied to public during build
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
      
      const pages: PDFPage[] = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const viewport = page.getViewport({ scale: 1 })
        
        // Extract text content
        const textContent = await page.getTextContent()
        const text = textContent.items.map((item: any) => item.str).join(' ')
        
        pages.push({
          pageNumber: i,
          width: viewport.width,
          height: viewport.height,
          textContent: text
        })
      }
      
      setState({
        document: documentInfo,
        pages,
        currentPage: 1,
        scale: 1.0,
        isLoading: false,
        error: null,
        pdfDoc: pdf
      })
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
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
    loadPDF,
    getCurrentPage,
    extractTextFromPage,
    getAllExtractedText,
    setCurrentPage,
    setScale
  }
}
