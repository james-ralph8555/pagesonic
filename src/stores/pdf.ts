import { createSignal } from 'solid-js'
import { PDFDocument, PDFPage } from '@/types'

interface PDFState {
  document: PDFDocument | null
  pages: PDFPage[]
  currentPage: number
  scale: number
  isLoading: boolean
  error: string | null
}

const [state, setState] = createSignal<PDFState>({
  document: null,
  pages: [],
  currentPage: 1,
  scale: 1.0,
  isLoading: false,
  error: null
})

export const usePDF = () => {
  const loadPDF = async (file: File) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      // This will be implemented with PDF.js
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.js'
      
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
      
      const documentInfo: PDFDocument = {
        title: '', // Will be implemented with actual PDF.js metadata
        author: '',
        subject: '',
        keywords: '',
        creator: '',
        producer: '',
        creationDate: undefined,
        modificationDate: undefined
      }
      
      const pages: PDFPage[] = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        pages.push({
          pageNumber: i,
          width: page.getViewport({ scale: 1 }).width,
          height: page.getViewport({ scale: 1 }).height
        })
      }
      
      setState({
        document: documentInfo,
        pages,
        currentPage: 1,
        scale: 1.0,
        isLoading: false,
        error: null
      })
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load PDF'
      }))
    }
  }
  
  const setCurrentPage = (page: number) => {
    setState(prev => ({ ...prev, currentPage: Math.max(1, Math.min(page, prev.pages.length)) }))
  }
  
  const setScale = (scale: number) => {
    setState(prev => ({ ...prev, scale: Math.max(0.1, Math.min(scale, 3.0)) }))
  }
  
  return {
    state,
    loadPDF,
    setCurrentPage,
    setScale
  }
}