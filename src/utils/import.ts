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
import { logLibraryStore } from '@/utils/logger'

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
 * Extract metadata from PDF file using PDF.js
 */
export async function extractPDFMetadata(file: File): Promise<Partial<DocumentMetadata>> {
  try {
    // Dynamic import to avoid loading PDF.js until needed
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'

    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
    const metadata = await pdf.getMetadata()
    const info = metadata.info as any || {}

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
        // Use current time if date parsing fails
      }
    }

    if (info.ModDate) {
      try {
        documentMetadata.updatedAt = new Date(info.ModDate).getTime()
      } catch {
        // Use creation time if modification date parsing fails
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

    return documentMetadata
  } catch (error) {
    logLibraryStore.warn('Failed to extract PDF metadata, using basic info', error)
    // Fallback to basic metadata
    return {
      title: file.name.replace(/\.(pdf|epub|mobi|txt|html|md)$/i, ''),
      authors: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
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
  const logPrefix = `[Import:${file.name}]`
  let documentId: DocumentId | null = null

  try {
    // Update progress
    progressCallback?.({ stage: 'validating', progress: 10, currentFile: file.name })

    // Validate file
    const validation = await validateFile(file)
    if (!validation.valid) {
      throw new LibraryError(validation.error || 'Invalid file', LibraryErrorCodes.VALIDATION_ERROR)
    }

    if (!validation.format) {
      throw new LibraryError('Unknown file format', LibraryErrorCodes.INVALID_FORMAT)
    }

    // Generate document ID
    documentId = await generateDocumentId(file)
    logLibraryStore.info(`${logPrefix} Generated document ID: ${documentId}`)

    // Update progress
    progressCallback?.({ stage: 'extracting', progress: 30, currentFile: file.name })

    // Extract metadata
    let metadata: Partial<DocumentMetadata> = {
      id: documentId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    if (validation.format === 'pdf') {
      const pdfMetadata = await extractPDFMetadata(file)
      metadata = { ...metadata, ...pdfMetadata, id: documentId }
    } else {
      // Basic metadata for other formats
      metadata.title = file.name.replace(/\.(pdf|epub|mobi|txt|html|md)$/i, '')
      metadata.authors = []
    }

    // Ensure required fields
    if (!metadata.title) {
      metadata.title = file.name
    }
    if (!metadata.authors || metadata.authors.length === 0) {
      metadata.authors = ['Unknown Author']
    }

    // Update progress
    progressCallback?.({ stage: 'extracting', progress: 60, currentFile: file.name })

    // Create directory structure
    const docDir = `docs/${documentId}`
    await opfsManager.getDirectory(docDir)

    // Store the file
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || validation.format
    const fileName = `file.${fileExtension}`
    const filePath = `${docDir}/${fileName}`

    // Read file as ArrayBuffer and store
    const arrayBuffer = await file.arrayBuffer()
    await opfsManager.writeBinaryFile(filePath, arrayBuffer)

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
      formats: { [validation.format]: formatInfo } as Record<DocumentFormat, FormatInfo>,
      ...(metadata.publisher && { publisher: metadata.publisher }),
      ...(metadata.description && { description: metadata.description }),
      ...(metadata.language && { language: metadata.language }),
      ...(metadata.tags && { tags: metadata.tags }),
      ...(metadata.custom && { custom: metadata.custom })
    }

    // Store metadata
    await opfsManager.writeDocumentMetadata(completeMetadata)

    // Update progress
    progressCallback?.({ stage: 'validating', progress: 90, currentFile: file.name })

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
    const currentIndex = await opfsManager.readIndex()
    currentIndex[documentId] = indexItem
    await opfsManager.writeIndex(currentIndex)

    // Update progress
    progressCallback?.({ stage: 'complete', progress: 100, currentFile: file.name })

    logLibraryStore.info(`${logPrefix} Successfully imported document`, {
      documentId,
      title: completeMetadata.title,
      format: validation.format,
      size: file.size
    })

    return {
      success: true,
      documentId,
      metadata: completeMetadata
    }

  } catch (error) {
    logLibraryStore.error(`${logPrefix} Import failed`, error instanceof Error ? error : new Error(String(error)))

    // Update progress with error
    progressCallback?.({ 
      stage: 'error', 
      progress: 0, 
      currentFile: file.name,
      error: error instanceof Error ? error.message : 'Unknown error'
    })

    // Cleanup on failure
    if (documentId) {
      try {
        await opfsManager.removeDirectory(`docs/${documentId}`, true)
      } catch (cleanupError) {
        logLibraryStore.warn(`${logPrefix} Failed to cleanup failed import`, cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)))
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
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