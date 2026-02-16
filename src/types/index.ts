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
  // Global text offsets within getAllExtractedText() aggregation
  textStart?: number
  textEnd?: number
  // Track extraction status for staged loading
  textExtracted?: boolean
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
  // Active chunk info for UI highlighting
  currentChunkIndex?: number | null
  currentChunkText?: string | null
  currentChunkStart?: number | null
  currentChunkEnd?: number | null
  voice: string
  rate: number
  pitch: number
  model: TTSModel | null
  // Which engine is active for TTS
  engine?: 'local' | 'browser'
  isModelLoading: boolean
  isWebGPUSupported: boolean
  lastError?: string | null
  // Available system voices for browser SpeechSynthesis
  systemVoices?: string[]
  // Chunking / synthesis parameters
  chunkMaxChars?: number
  chunkOverlapChars?: number
  sentenceSplit?: boolean
  interChunkPauseMs?: number
  targetSampleRate?: number
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


export type AppMode = 'pdf' | 'settings' | 'library'

// Re-export telemetry types
export type {
  TelemetryCategory,
  TelemetryEventBase,
  PDFEventName,
  PDFEvent,
  TTSEventName,
  TTSEvent,
  RenderEventName,
  RenderEvent,
  AppEventName,
  AppEvent,
  TelemetryEvent,
  TelemetrySnapshot,
  TelemetryConfig
} from './telemetry'
