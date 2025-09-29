export interface PDFDocument {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: Date
  modificationDate?: Date
}

export interface PDFPage {
  pageNumber: number
  width: number
  height: number
  textContent?: string
}

export interface TTSModel {
  name: string
  size: number
  voices: string[]
  requiresWebGPU: boolean
  url: string
}

export interface TTSState {
  isPlaying: boolean
  isPaused?: boolean
  currentSentence: number
  totalSentences: number
  voice: string
  rate: number
  pitch: number
  model: TTSModel | null
  isModelLoading: boolean
  isWebGPUSupported: boolean
}

export interface ReaderState {
  currentView: 'pdf' | 'reader' | 'settings'
  currentPage: number
  totalPages: number
  scale: number
  extractedText: string[]
  fontSize: number
  lineHeight: number
  fontFamily: string
}

export type AppMode = 'pdf' | 'settings'
