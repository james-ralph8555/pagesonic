/**
 * Core types and interfaces for the OPFS library system
 * Based on Calibre-like library design with leader/follower architecture
 */

// OPFS Directory structure constants
export const OPFS_STRUCTURE = {
  ROOT: '/',
  INDEX: '/index.json',
  SETTINGS_DIR: '/settings/',
  USER_SETTINGS: '/settings/user.json',
  READER_SETTINGS: '/settings/reader.json',
  COVERS_DIR: '/covers/',
  DOCS_DIR: '/docs/',
  CONVERSIONS_DIR: '/conversions/',
  TEMP_DIR: '/tmp/'
} as const

// Document format types
export type DocumentFormat = 'pdf' | 'epub' | 'mobi' | 'txt' | 'html' | 'markdown'
export type ConversionType = 'text' | 'audio'

// index.json structure - main library index
export interface LibraryIndexItem {
  id: string // documentId - UUID or content hash
  title: string
  authors: string[]
  updated: number // epoch milliseconds
  formats: DocumentFormat[] // available formats
  hasAudio: boolean
  coverPath?: string // relative path under covers/
  tags?: string[]
  language?: string
  size?: number // total size in bytes
  progress?: number // reading progress 0-100
}

export type LibraryIndex = Record<string, LibraryIndexItem>
export type LibraryIndexVersion = { version: number; index: LibraryIndex }

// metadata.json structure - per-document full metadata
export interface DocumentMetadata {
  id: string
  title: string
  authors: string[]
  series?: string
  seriesIndex?: number
  tags?: string[]
  language?: string
  description?: string
  publishDate?: string
  publisher?: string
  isbn?: string
  cover?: string // relative path to cover image
  createdAt: number
  updatedAt: number
  formats: Record<DocumentFormat, FormatInfo>
  audio?: AudioInfo
  custom?: Record<string, unknown> // extensible fields
}

export interface FormatInfo {
  path: string
  size: number
  created: number
  converter?: string // name/version of converter
  checksum?: string
}

export interface AudioInfo {
  full?: string
  chunks?: AudioChunk[]
  manifestPath?: string
  duration?: number
  sampleRate?: number
}

export interface AudioChunk {
  id: string
  path: string
  start: number // start time in seconds
  end: number // end time in seconds
  title?: string
  chapter?: number
  size?: number
}

// bookmarks.json structure
export interface Bookmark {
  id: string
  created: number
  updated: number
  type: 'text' | 'audio'
  // For text, location can be CSS selector, CFI (EPUB), or page number
  location: string
  endLocation?: string
  text?: string // selected text content
  style?: {
    color?: string
    underline?: boolean
    bold?: boolean
    note?: string
  }
  tags?: string[]
}

export interface BookmarksFile {
  docId: string
  version: number
  bookmarks: Bookmark[]
  lastModified: number
}

// Conversion job tracking
export interface ConversionStatus {
  jobId: string
  docId: string
  type: ConversionType
  sourceFormat: DocumentFormat
  targetFormat: DocumentFormat | 'audio'
  progress: number // 0-100
  state: 'pending' | 'running' | 'complete' | 'failed' | 'cancelled'
  error?: string
  started: number
  updated: number
  estimatedCompletion?: number
  outputPath?: string
}

// User settings
export interface UserSettings {
  theme: 'light' | 'dark' | 'auto'
  language: string
  autoImport: boolean
  autoConvert: boolean
  defaultFormat: DocumentFormat
  libraryView: 'grid' | 'list'
  sortBy: 'title' | 'author' | 'date' | 'size' | 'progress'
  sortOrder: 'asc' | 'desc'
  itemsPerPage: number
  showCovers: boolean
  autoBackup: boolean
  lastBackup?: number
}

export interface ReaderSettings {
  fontSize: number
  lineHeight: number
  fontFamily: string
  margin: number
  backgroundColor: string
  textColor: string
  scrollMode: 'paginated' | 'continuous'
  autoBookmark: boolean
  syncProgress: boolean
}

// Broadcast channel message types
export interface LibraryMessage {
  id: string
  type: LibraryMessageType
  payload: unknown
  timestamp: number
  senderId: string
}

export type LibraryMessageType = 
  // Leader/Follower messages
  | 'LEADER_ELECTED'
  | 'LEADER_LOST'
  | 'HEARTBEAT'
  
  // Library operations
  | 'ADD_DOCUMENT'
  | 'UPDATE_DOCUMENT'
  | 'DELETE_DOCUMENT'
  | 'GET_DOCUMENTS'
  | 'SEARCH_DOCUMENTS'
  
  // Metadata operations
  | 'UPDATE_METADATA'
  | 'GET_METADATA'
  
  // Bookmark operations
  | 'ADD_BOOKMARK'
  | 'UPDATE_BOOKMARK'
  | 'DELETE_BOOKMARK'
  | 'GET_BOOKMARKS'
  
  // Settings operations
  | 'UPDATE_SETTINGS'
  | 'GET_SETTINGS'
  
  // Conversion operations
  | 'START_CONVERSION'
  | 'CANCEL_CONVERSION'
  | 'GET_CONVERSION_STATUS'
  | 'CONVERSION_PROGRESS'
  
  // Import/Export
  | 'IMPORT_LIBRARY'
  | 'EXPORT_LIBRARY'
  
  // Responses
  | 'SUCCESS'
  | 'ERROR'
  | 'NOT_FOUND'

// Message payload types
export interface AddDocumentPayload {
  file: File
  metadata?: Partial<DocumentMetadata>
}

export interface UpdateDocumentPayload {
  docId: string
  metadata: Partial<DocumentMetadata>
}

export interface BookmarkPayload {
  docId: string
  bookmark: Omit<Bookmark, 'id' | 'created' | 'updated'>
}

export interface ConversionPayload {
  docId: string
  type: ConversionType
  targetFormat: DocumentFormat | 'audio'
  options?: Record<string, unknown>
}

export interface SettingsPayload {
  settings: Partial<UserSettings | ReaderSettings>
  type: 'user' | 'reader'
}

export interface SearchPayload {
  query?: string
  tags?: string[]
  authors?: string[]
  formats?: DocumentFormat[]
  limit?: number
  offset?: number
}

// Response types
export interface LibraryResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  messageId: string
}

// Library store state interface
export interface LibraryState {
  // Data
  index: LibraryIndex
  documents: Record<string, LibraryIndexItem>
  settings: {
    user: UserSettings
    reader: ReaderSettings
  }
  
  // UI state
  currentView: 'grid' | 'list'
  selectedDocument?: string
  searchQuery: string
  sortBy: 'title' | 'author' | 'date' | 'size' | 'progress'
  sortOrder: 'asc' | 'desc'
  
  // Async state
  isLoading: boolean
  error?: string
  
  // Import state
  isImporting: boolean
  importProgress?: ImportProgress
  
  // Leader election state
  isLeader: boolean
  leaderInfo?: LeaderInfo
  isReady: boolean
}

// Leader election types
export interface LeaderInfo {
  id: string
  timestamp: number
  tabId: string
}

// Import/Export types
export interface LibraryExport {
  version: number
  exportedAt: number
  index: LibraryIndex
  settings: {
    user: UserSettings
    reader: ReaderSettings
  }
  documents: Record<string, {
    metadata: DocumentMetadata
    bookmarks: Bookmark[]
  }>
}

export interface ImportProgress {
  stage: 'parsing' | 'extracting' | 'validating' | 'importing' | 'complete' | 'error'
  progress: number
  currentFile?: string
  totalFiles?: number
  error?: string
}

// Error types
export class LibraryError extends Error {
  constructor(
    message: string,
    public code: string,
    public docId?: string,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'LibraryError'
  }
}

export const LibraryErrorCodes = {
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',
  INVALID_FORMAT: 'INVALID_FORMAT',
  CORRUPTION_DETECTED: 'CORRUPTION_DETECTED',
  LEADER_REQUIRED: 'LEADER_REQUIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONVERSION_FAILED: 'CONVERSION_FAILED',
  IMPORT_FAILED: 'IMPORT_FAILED',
  EXPORT_FAILED: 'EXPORT_FAILED'
} as const

// Utility types
export type DocumentId = string
export type JobId = string
export type BookmarkId = string
export type MessageId = string
export type TabId = string