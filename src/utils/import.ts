/**
 * Import utilities for adding documents to the library
 * Handles file validation, metadata extraction, and OPFS storage
 */

import {
  DocumentMetadata,
  DocumentFormat,
  FormatInfo,
  LibraryIndexItem,
  LibraryError,
  LibraryErrorCodes,
  DocumentId,
  ImportProgress as LibraryImportProgress
} from '@/types/library'

// Re-export for convenience
export type ImportProgress = LibraryImportProgress
import { opfsManager } from '@/utils/opfs'

// Supported file types and their formats
export const SUPPORTED_FILE_TYPES: Record<string, DocumentFormat> = {
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/markdown': 'markdown',
  'application/x-mobipocket-ebook': 'mobi'
}

// File size limits (in bytes)
export const FILE_SIZE_LIMITS: Record<DocumentFormat, number> = {
  pdf: 100 * 1024 * 1024, // 100MB
  epub: 50 * 1024 * 1024,  // 50MB
  mobi: 50 * 1024 * 1024,  // 50MB
  txt: 10 * 1024 * 1024,   // 10MB
  html: 20 * 1024 * 1024,  // 20MB
  markdown: 10 * 1024 * 1024 // 10MB
}

// Import result interface
export interface ImportResult {
  success: boolean
  documentId?: DocumentId
  error?: string
  technicalError?: string // For debugging purposes
  metadata?: DocumentMetadata
}

/**
 * Validate a file for import
 */
export async function validateFile(file: File): Promise<{ valid: boolean; format?: DocumentFormat; error?: string }> {
  try {
    // Check file type
    const format = SUPPORTED_FILE_TYPES[file.type]
    if (!format) {
      return { 
        valid: false, 
        error: `Unsupported file type: ${file.type}. Supported types: ${Object.keys(SUPPORTED_FILE_TYPES).join(', ')}` 
      }
    }

    // Check file size
    const maxSize = FILE_SIZE_LIMITS[format]
    if (file.size > maxSize) {
      return { 
        valid: false, 
        error: `File too large. Maximum size for ${format.toUpperCase()} files is ${formatFileSize(maxSize)}` 
      }
    }

    // Check if file is empty
    if (file.size === 0) {
      return { valid: false, error: 'File is empty' }
    }

    return { valid: true, format }
  } catch (error) {
    return { 
      valid: false, 
      error: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }
  }
}

/**
 * Validate PDF file header before processing
 */
async function validatePDFHeader(file: File): Promise<{ valid: boolean; error?: string; isEncrypted?: boolean }> {
  try {
    const header = await file.slice(0, 1024).arrayBuffer()
    const view = new Uint8Array(header)
    const headerStr = String.fromCharCode.apply(null, Array.from(view.slice(0, 8)))

    // Check for PDF signature
    if (!headerStr.startsWith('%PDF-')) {
      return { valid: false, error: 'File does not appear to be a valid PDF document' }
    }

    // Check for encryption indicators in first 1KB
    const content = String.fromCharCode.apply(null, Array.from(view))
    if (content.includes('/Encrypt') || content.includes('/Encrypt ')) {
      return { valid: false, error: 'Password-protected PDFs are not supported', isEncrypted: true }
    }

    return { valid: true }
  } catch (error) {
    return { valid: false, error: 'Failed to validate PDF file header' }
  }
}


/**
 * Extract metadata from PDF file using PDF.js
 */
export async function extractPDFMetadata(
  file: File,
  progressCallback?: (progress: number, status?: string) => void
): Promise<Partial<DocumentMetadata>> {
  progressCallback?.(5, 'Validating PDF file...')

  // Early PDF validation
  const pdfValidation = await validatePDFHeader(file)
  if (!pdfValidation.valid) {
    throw new Error(pdfValidation.error || 'Invalid PDF file')
  }

  progressCallback?.(10, 'PDF validation passed')

  try {
    // Read file
    progressCallback?.(25, 'Reading PDF file...')
    const arrayBuffer = await file.arrayBuffer()
    progressCallback?.(35, 'File read successfully')

    // Import PDF.js
    progressCallback?.(40, 'Loading PDF processing library...')
    const pdfjs = await import('pdfjs-dist')

    // Set worker source if not already set
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'
    }

    progressCallback?.(50, 'Initializing PDF processor...')

    // Load PDF
    const loadingTask = pdfjs.getDocument({
      data: arrayBuffer,
      disableAutoFetch: true,
      disableStream: true,
      disableFontFace: true,
      verbosity: 0
    })

    const pdf = await loadingTask.promise
    progressCallback?.(70, 'PDF loaded successfully')

    // Get metadata
    progressCallback?.(80, 'Extracting PDF metadata...')
    const metadata = await pdf.getMetadata()
    const info = (metadata as any).info || {}

    // Extract basic metadata
    const documentMetadata: Partial<DocumentMetadata> = {
      title: info.Title || file.name.replace(/\.(pdf|epub|mobi|txt|html|md)$/i, ''),
      authors: info.Author ? [info.Author] : [],
      publisher: info.Producer || undefined,
      description: info.Subject || undefined,
      language: info.Language || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    // Parse dates if available
    if (info.CreationDate) {
      try {
        documentMetadata.createdAt = new Date(info.CreationDate).getTime()
      } catch {
        // Keep default time
      }
    }

    if (info.ModDate) {
      try {
        documentMetadata.updatedAt = new Date(info.ModDate).getTime()
      } catch {
        // Keep creation time
      }
    }

    // Extract keywords as tags
    if (info.Keywords) {
      documentMetadata.tags = info.Keywords.split(',').map((tag: string) => tag.trim()).filter(Boolean)
    }

    // Extract additional metadata
    if (info.Creator) {
      documentMetadata.custom = { ...documentMetadata.custom, creator: info.Creator }
    }

    progressCallback?.(95, 'Finalizing metadata...')
    return documentMetadata

  } catch (error) {
    // Return fallback metadata
    return {
      title: file.name.replace(/\.(pdf|epub|mobi|txt|html|md)$/i, ''),
      authors: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      description: 'PDF processing failed - using basic information',
      tags: ['pdf-error'],
      custom: {
        pdfError: error instanceof Error ? error.message : 'Unknown PDF error'
      }
    }
  }
}

/**
 * Generate a unique document ID
 */
export function generateDocumentId(file: File): Promise<DocumentId> {
  return new Promise((resolve) => {
    // Simple implementation using file name and timestamp
    // In production, you might want to use content hash for better deduplication
    const timestamp = Date.now()
    const random = Math.random().toString(36).substr(2, 9)
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase()
    const docId = `${sanitizedName}-${timestamp}-${random}`
    resolve(docId)
  })
}

/**
 * Import a single file into the library
 */
export async function importFile(
  file: File,
  progressCallback?: (progress: LibraryImportProgress) => void
): Promise<ImportResult> {
  let documentId: DocumentId | null = null

  try {
    progressCallback?.({ stage: 'validating', progress: 10, currentFile: file.name })

    // Validate file
    const validation = await validateFile(file)
    if (!validation.valid) {
      throw new LibraryError(validation.error || 'Invalid file', LibraryErrorCodes.VALIDATION_ERROR)
    }

    if (!('format' in validation) || !validation.format) {
      throw new LibraryError('Unknown file format', LibraryErrorCodes.INVALID_FORMAT)
    }

    const fileFormat = validation.format

    // Generate document ID
    documentId = await generateDocumentId(file)

    // Update progress
    progressCallback?.({ stage: 'extracting', progress: 30, currentFile: file.name })

    // Extract metadata
    let metadata: Partial<DocumentMetadata> = {
      id: documentId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    try {
      if (fileFormat === 'pdf') {
        progressCallback?.({ stage: 'extracting', progress: 35, currentFile: file.name, status: 'Starting PDF analysis...' })

        const pdfMetadata = await extractPDFMetadata(file, (stageProgress, status) => {
          const overallProgress = 35 + (stageProgress * 0.25)
          progressCallback?.({
            stage: 'extracting',
            progress: overallProgress,
            currentFile: file.name,
            status: status || 'Processing PDF...'
          })
        })

        metadata = { ...metadata, ...pdfMetadata, id: documentId }
      } else {
        metadata.title = file.name.replace(/\.(pdf|epub|mobi|txt|html|md)$/i, '')
        metadata.authors = []
      }
    } catch (metadataError) {
      metadata = {
        id: documentId,
        title: file.name,
        authors: ['Unknown Author'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        description: 'Metadata extraction failed - basic info used',
        tags: ['import-error'],
        custom: {
          criticalError: metadataError instanceof Error ? metadataError.message : 'Unknown metadata error'
        }
      }
    }

    // Ensure required fields
    if (!metadata.title) {
      metadata.title = file.name
    }
    if (!metadata.authors || metadata.authors.length === 0) {
      metadata.authors = ['Unknown Author']
    }

    progressCallback?.({ stage: 'importing', progress: 65, currentFile: file.name, status: 'Creating document directory...' })

    // Create directory structure
    const docDir = `docs/${documentId}`

    // Ensure OPFS is ready
    if (!opfsManager.isReady()) {
      await opfsManager.initialize()
    }

    await opfsManager.getDirectory(docDir, true)

    progressCallback?.({ stage: 'importing', progress: 70, currentFile: file.name, status: 'Directory created, storing file...' })

    // Store the file
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || fileFormat
    const fileName = `file.${fileExtension}`
    const filePath = `${docDir}/${fileName}`

    progressCallback?.({ stage: 'importing', progress: 72, currentFile: file.name, status: 'Reading file content...' })
    const arrayBuffer = await file.arrayBuffer()

    progressCallback?.({ stage: 'importing', progress: 75, currentFile: file.name, status: 'File read, writing to storage...' })
    await opfsManager.writeBinaryFile(filePath, arrayBuffer)

    progressCallback?.({ stage: 'importing', progress: 80, currentFile: file.name, status: 'File stored successfully' })

    // Create format info
    const formatInfo: FormatInfo = {
      path: filePath,
      size: file.size,
      created: Date.now(),
      converter: 'import'
    }

    // Complete metadata
    const completeMetadata: DocumentMetadata = {
      id: documentId,
      title: metadata.title!,
      authors: metadata.authors!,
      createdAt: metadata.createdAt!,
      updatedAt: metadata.updatedAt!,
      formats: { [fileFormat]: formatInfo } as Record<DocumentFormat, FormatInfo>,
      ...(metadata.publisher && { publisher: metadata.publisher }),
      ...(metadata.description && { description: metadata.description }),
      ...(metadata.language && { language: metadata.language }),
      ...(metadata.tags && { tags: metadata.tags }),
      ...(metadata.custom && { custom: metadata.custom })
    }

    progressCallback?.({ stage: 'importing', progress: 82, currentFile: file.name, status: 'Storing document metadata...' })
    await opfsManager.writeDocumentMetadata(completeMetadata)

    progressCallback?.({ stage: 'importing', progress: 87, currentFile: file.name, status: 'Creating library index entry...' })

    // Create library index entry
    const indexItem: LibraryIndexItem = {
      id: documentId,
      title: completeMetadata.title,
      authors: completeMetadata.authors,
      updated: completeMetadata.updatedAt,
      formats: Object.keys(completeMetadata.formats) as DocumentFormat[],
      hasAudio: false,
      size: file.size,
      ...(completeMetadata.tags && { tags: completeMetadata.tags }),
      ...(completeMetadata.language && { language: completeMetadata.language })
    }

    // Update library index
    progressCallback?.({ stage: 'importing', progress: 90, currentFile: file.name, status: 'Reading library index...' })
    const currentIndex = await opfsManager.readIndex()

    progressCallback?.({ stage: 'importing', progress: 93, currentFile: file.name, status: 'Updating library index...' })
    currentIndex[documentId] = indexItem

    await opfsManager.writeIndex(currentIndex)

    progressCallback?.({ stage: 'complete', progress: 100, currentFile: file.name })

    return {
      success: true,
      documentId,
      metadata: completeMetadata
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown import error'

    // Create user-friendly error message
    let userFriendlyMessage = errorMessage
    if (errorMessage.includes('leadership')) {
      userFriendlyMessage = 'Library sync issue detected. Please try again in a few moments.'
    } else if (errorMessage.includes('Invalid PDF') || errorMessage.includes('corrupted')) {
      userFriendlyMessage = 'The file appears to be corrupted or not a valid PDF document.'
    } else if (errorMessage.includes('password') || errorMessage.includes('encrypted')) {
      userFriendlyMessage = 'Password-protected files are not currently supported.'
    } else if (errorMessage.includes('storage') || errorMessage.includes('quota')) {
      userFriendlyMessage = 'Storage issue detected. Please check your browser permissions and available disk space.'
    } else if (errorMessage.includes('directory') || errorMessage.includes('file system')) {
      userFriendlyMessage = 'File system error occurred. Please try again.'
    }

    progressCallback?.({
      stage: 'error',
      progress: 0,
      currentFile: file.name,
      error: userFriendlyMessage
    })

    // Cleanup on failure
    if (documentId) {
      try {
        await opfsManager.removeDirectory(`docs/${documentId}`, true)
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      success: false,
      error: userFriendlyMessage,
      technicalError: errorMessage
    }
  }
}

/**
 * Import multiple files
 */
export async function importFiles(
  files: FileList | File[], 
  progressCallback?: (progress: LibraryImportProgress) => void
): Promise<{ results: ImportResult[]; successful: number; failed: number }> {
  const results: ImportResult[] = []
  let successful = 0
  let failed = 0
  const totalFiles = files.length

  // Helper to safely calculate progress
  const safeProgress = (value: number, fallback: number = 0): number => {
    if (typeof value !== 'number' || !isFinite(value)) {
      return fallback
    }
    return Math.max(0, Math.min(100, value))
  }

  // Helper to safely call progress callback
  const safeProgressCallback = (progress: LibraryImportProgress) => {
    try {
      const safeProgressData = {
        ...progress,
        progress: safeProgress(progress.progress),
        currentFile: progress.currentFile || 'Unknown file',
        totalFiles: safeProgress(progress.totalFiles || 0)
      }
      progressCallback?.(safeProgressData)
    } catch (error) {
      console.warn('Progress callback failed:', error)
    }
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const fileProgress = safeProgress((i / totalFiles) * 100)
    
    safeProgressCallback({
      stage: 'validating',
      progress: fileProgress,
      currentFile: file.name,
      totalFiles
    })

    try {
      const result = await importFile(file, (fileProgress) => {
        try {
          // Adjust progress to be within the overall batch progress
          const batchProgress = safeProgress((i / totalFiles) * 100)
          const overallProgress = safeProgress(fileProgress.progress + batchProgress)
          const adjustedProgress = safeProgress(overallProgress / 2) // Scale to 0-50% for batch
          
          safeProgressCallback({
            ...fileProgress,
            progress: adjustedProgress,
            currentFile: file.name,
            totalFiles
          })
        } catch (error) {
          console.warn('File progress calculation failed:', error)
          safeProgressCallback({
            stage: fileProgress.stage || 'processing',
            progress: safeProgress((i / totalFiles) * 50), // Use simple progress as fallback
            currentFile: file.name,
            totalFiles
          })
        }
      })

      results.push(result)
      if (result.success) {
        successful++
      } else {
        failed++
      }
    } catch (error) {
      console.error(`Import failed for file ${file.name}:`, error)
      results.push({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown import error'
      })
      failed++
    }
  }

  return { results, successful, failed }
}

/**
 * Handle folder import (browser implementation)
 */
export async function importFolder(
  directoryHandle: FileSystemDirectoryHandle,
  progressCallback?: (progress: LibraryImportProgress) => void
): Promise<{ results: ImportResult[]; successful: number; failed: number }> {
  const files: File[] = []
  const totalCount = await countFilesInDirectory(directoryHandle)

  progressCallback?.({
    stage: 'validating',
    progress: 0,
    totalFiles: totalCount
  })

  // Recursively collect all supported files
  await collectFilesFromDirectory(directoryHandle, files, totalCount, progressCallback)

  // Import all collected files
  return await importFiles(files, progressCallback)
}

/**
 * Helper function to count files in directory
 */
async function countFilesInDirectory(directoryHandle: FileSystemDirectoryHandle): Promise<number> {
  let count = 0
  
  try {
    // @ts-ignore - DirectoryHandle iteration may not be fully typed
    for await (const entry of directoryHandle.values()) {
      if (entry.name.startsWith('.')) continue // Skip hidden files
      
      if (entry.kind === 'file') {
        const extension = entry.name.split('.').pop()?.toLowerCase()
        if (extension && Object.values(SUPPORTED_FILE_TYPES).includes(extension as DocumentFormat)) {
          count++
        }
      } else if (entry.kind === 'directory') {
        count += await countFilesInDirectory(entry as FileSystemDirectoryHandle)
      }
    }
  } catch (error) {
    console.warn('Directory iteration not supported, falling back to empty count')
  }
  
  return count
}

/**
 * Helper function to collect files from directory
 */
async function collectFilesFromDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  files: File[],
  totalCount: number,
  progressCallback?: (progress: LibraryImportProgress) => void
): Promise<void> {
  let processedCount = 0
  try {
    // @ts-ignore - DirectoryHandle iteration may not be fully typed
    for await (const entry of directoryHandle.values()) {
      if (entry.name.startsWith('.')) continue // Skip hidden files
    
    if (entry.kind === 'file') {
      const fileHandle = entry as FileSystemFileHandle
      const extension = entry.name.split('.').pop()?.toLowerCase()
      
      if (extension && Object.values(SUPPORTED_FILE_TYPES).includes(extension as DocumentFormat)) {
        const file = await fileHandle.getFile()
        files.push(file)
        
        processedCount++
        const progress = (processedCount / totalCount) * 50 // First 50% for collection
        progressCallback?.({
          stage: 'validating',
          progress,
          currentFile: file.name,
          totalFiles: totalCount
        })
      }
    } else if (entry.kind === 'directory') {
      await collectFilesFromDirectory(entry as FileSystemDirectoryHandle, files, totalCount, progressCallback)
    }
  }
  } catch (error) {
    console.warn('Directory file collection not supported', error)
  }
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB']
  if (bytes === 0) return '0 B'
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i]
}