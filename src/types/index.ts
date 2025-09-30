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
  // Which engine is active for TTS
  engine?: 'local' | 'browser'
  isModelLoading: boolean
  isWebGPUSupported: boolean
  lastError?: string | null
  // Opaque handle to the loaded ONNX session (if any)
  session?: unknown
  // Available system voices for browser SpeechSynthesis
  systemVoices?: string[]
  // Chunking / synthesis parameters
  chunkMaxChars?: number
  chunkOverlapChars?: number
  sentenceSplit?: boolean
  interChunkPauseMs?: number
  targetSampleRate?: number
  // iOS-specific audio debugging info
  audioState?: {
    contextState?: string
    audioUnlocked?: boolean
    lastError?: string
  }
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
