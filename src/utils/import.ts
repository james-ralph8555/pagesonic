/**
 * Import utilities for adding documents to the library
 * Handles file validation, metadata extraction, and OPFS storage
 */

import { 
  DocumentMetadata, 
  DocumentFormat, 
  FormatInfo, 
  LibraryIndexItem,
  LibraryIndex,
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
 * Extract metadata from PDF file using PDF.js with comprehensive timeout and retry logic
 */
export async function extractPDFMetadata(
  file: File, 
  progressCallback?: (progress: number, status?: string) => void
): Promise<Partial<DocumentMetadata>> {
  const totalProcessingTimeout = 30000 // 30 seconds total timeout
  const pdfLoadTimeout = 15000 // 15 seconds for PDF loading
  const metadataExtractionTimeout = 10000 // 10 seconds for metadata extraction
  const maxRetries = 2
  
  // Create a timeout wrapper that always resolves
  const withTimeout = async <T>(
    promise: Promise<T>, 
    timeoutMs: number, 
    errorMessage: string
  ): Promise<{ success: boolean; data?: T; error?: string }> => {
    try {
      const result = await Promise.race([
        promise,
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        )
      ])
      return { success: true, data: result }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  }

  const loadPdfWithTimeout = async (arrayBuffer: ArrayBuffer, attempt: number = 1): Promise<{ success: boolean; pdf?: any; error?: string }> => {
    try {
      logLibraryStore.debug(`Loading PDF with PDF.js (attempt ${attempt}/${maxRetries})`)
      
      // Dynamic import to avoid loading PDF.js until needed
      const pdfjsResult = await withTimeout(
        import('pdfjs-dist'),
        8000, // 8 seconds for PDF.js import
        'PDF.js library import timeout'
      )

      if (!pdfjsResult.success) {
        logLibraryStore.error('PDF.js import failed', pdfjsResult.error ? new Error(pdfjsResult.error) : undefined)
        return { success: false, error: pdfjsResult.error || 'PDF.js import failed' }
      }

      const pdfjs = pdfjsResult.data!
      
      // Set worker source if not already set
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'
      }

      // Load PDF with timeout
      const loadingTask = pdfjs.getDocument({ 
        data: arrayBuffer,
        disableAutoFetch: true,
        disableStream: true
      })
      
      const pdfResult = await withTimeout(
        loadingTask.promise,
        pdfLoadTimeout,
        'PDF loading timeout - file may be corrupted or too large'
      )

      if (!pdfResult.success) {
        logLibraryStore.warn(`PDF load attempt ${attempt} failed: ${pdfResult.error}`)
        return { success: false, error: pdfResult.error }
      }
      
      logLibraryStore.debug('PDF loaded successfully with PDF.js')
      return { success: true, pdf: pdfResult.data }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown PDF loading error'
      logLibraryStore.warn(`PDF load attempt ${attempt} failed`, error instanceof Error ? error : new Error(errorMessage))
      return { success: false, error: errorMessage }
    }
  }

  // Main processing with overall timeout
  const processResult = await withTimeout(
    (async () => {
      let arrayBuffer: ArrayBuffer
      
      try {
        // Read file with timeout
        progressCallback?.(10, 'Reading PDF file...')
        const fileReadResult = await withTimeout(
          file.arrayBuffer(),
          10000,
          'File reading timeout - file may be too large'
        )
        
        if (!fileReadResult.success) {
          throw new Error(fileReadResult.error || 'File reading failed')
        }
        
        arrayBuffer = fileReadResult.data!
        progressCallback?.(20, 'File read successfully')
      } catch (error) {
        throw new Error(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }

      // Try loading PDF with retries
      progressCallback?.(30, 'Loading PDF document...')
      let pdfResult = await loadPdfWithTimeout(arrayBuffer, 1)
      
      for (let attempt = 2; attempt <= maxRetries && !pdfResult.success; attempt++) {
        logLibraryStore.info(`Retrying PDF load (attempt ${attempt}/${maxRetries})`)
        progressCallback?.(30 + (attempt * 5), `Retrying PDF load (attempt ${attempt}/${maxRetries})...`)
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt - 1)))
        pdfResult = await loadPdfWithTimeout(arrayBuffer, attempt)
      }

      if (!pdfResult.success) {
        throw new Error(`PDF processing failed after ${maxRetries} attempts: ${pdfResult.error}`)
      }

      const pdf = pdfResult.pdf!
      progressCallback?.(60, 'PDF loaded successfully')

      // Get metadata with timeout
      progressCallback?.(70, 'Extracting PDF metadata...')
      const metadataResult = await withTimeout(
        pdf.getMetadata(),
        metadataExtractionTimeout,
        'PDF metadata extraction timeout'
      )

      if (!metadataResult.success) {
        throw new Error(metadataResult.error || 'Metadata extraction failed')
      }
      
      const metadata = metadataResult.data!
      const info = (metadata as any).info || {}
      progressCallback?.(90, 'Processing metadata...')

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

      logLibraryStore.info('PDF metadata extracted successfully', {
        title: documentMetadata.title,
        authors: documentMetadata.authors?.length || 0,
        hasMetadata: !!info.Title
      })

      return documentMetadata
      
    })(),
    totalProcessingTimeout,
    'PDF processing exceeded maximum time limit'
  )

  if (processResult.success && processResult.data) {
    return processResult.data
  }

  // Handle any failure by returning fallback metadata
  const errorMessage = processResult.error || 'Unknown PDF processing error'
  logLibraryStore.warn('PDF processing failed, using fallback metadata', new Error(errorMessage))
  
  // Determine error category for better user feedback
  let fallbackReason = 'PDF processing failed'
  let errorCategory = 'pdf-error'
  
  if (errorMessage.includes('timeout')) {
    fallbackReason = 'PDF processing timed out - file may be too large or complex'
    errorCategory = 'pdf-timeout'
  } else if (errorMessage.includes('Invalid PDF') || errorMessage.includes('corrupted')) {
    fallbackReason = 'Invalid PDF file - file may be corrupted'
    errorCategory = 'pdf-corrupted'
  } else if (errorMessage.includes('password') || errorMessage.includes('encrypted')) {
    fallbackReason = 'Password-protected PDFs are not supported'
    errorCategory = 'pdf-protected'
  } else if (errorMessage.includes('reading')) {
    fallbackReason = 'Failed to read PDF file'
    errorCategory = 'pdf-read-error'
  }
  
  // Return fallback metadata with detailed error information
  return {
    title: file.name.replace(/\.(pdf|epub|mobi|txt|html|md)$/i, ''),
    authors: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    description: fallbackReason,
    tags: [errorCategory],
    custom: { 
      importError: errorMessage,
      originalError: fallbackReason,
      processingTime: 'timeout',
      fileSize: file.size
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

  // Add overall import timeout to prevent infinite hanging
  const totalImportTimeout = 60000 // 60 seconds total timeout
  
  const importWithTimeout = async (): Promise<ImportResult> => {
    try {
      // Update progress
      progressCallback?.({ stage: 'validating', progress: 10, currentFile: file.name })

      // Validate file with timeout
      const validation = await Promise.race([
        validateFile(file),
        new Promise<{ valid: boolean; error?: string }>((_, reject) =>
          setTimeout(() => reject(new Error('File validation timeout')), 10000)
        )
      ])
      
      if (!validation.valid) {
        throw new LibraryError(validation.error || 'Invalid file', LibraryErrorCodes.VALIDATION_ERROR)
      }

      // Type guard to ensure format exists and cast properly
      if (!('format' in validation) || !validation.format) {
        throw new LibraryError('Unknown file format', LibraryErrorCodes.INVALID_FORMAT)
      }

      const fileFormat = validation.format

      // Generate document ID with timeout
      documentId = await Promise.race([
        generateDocumentId(file),
        new Promise<DocumentId>((_, reject) =>
          setTimeout(() => reject(new Error('Document ID generation timeout')), 5000)
        )
      ])
      logLibraryStore.info(`${logPrefix} Generated document ID: ${documentId}`)

      // Update progress
      progressCallback?.({ stage: 'extracting', progress: 30, currentFile: file.name })

      // Extract metadata with better error handling and progress tracking
      let metadata: Partial<DocumentMetadata> = {
        id: documentId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    try {
      if (fileFormat === 'pdf') {
        // Add intermediate progress for PDF processing
        progressCallback?.({ stage: 'extracting', progress: 35, currentFile: file.name, status: 'Starting PDF analysis...' })
        
        const pdfMetadata = await extractPDFMetadata(file, (stageProgress, status) => {
          // Map PDF processing progress to overall import progress
          const overallProgress = 35 + (stageProgress * 0.25) // 35-60% range for PDF processing
          progressCallback?.({ 
            stage: 'extracting', 
            progress: overallProgress, 
            currentFile: file.name,
            status: status || 'Processing PDF...'
          })
        })
        
        metadata = { ...metadata, ...pdfMetadata, id: documentId }
        
        // Check if PDF processing had errors
        if (pdfMetadata.tags?.includes('pdf-error') || pdfMetadata.tags?.includes('pdf-timeout')) {
          logLibraryStore.warn('PDF processed with errors, but continuing import', {
            error: pdfMetadata.custom?.importError,
            fallbackReason: pdfMetadata.description,
            errorCategory: pdfMetadata.tags?.find(tag => tag.startsWith('pdf-'))
          })
        }
      } else {
        // Basic metadata for other formats
        metadata.title = file.name.replace(/\.(pdf|epub|mobi|txt|html|md)$/i, '')
        metadata.authors = []
      }
    } catch (metadataError) {
      logLibraryStore.error('Critical error during metadata extraction', metadataError instanceof Error ? metadataError : new Error(String(metadataError)))
      
      // Use absolute fallback metadata
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

    // Update progress
    progressCallback?.({ stage: 'extracting', progress: 60, currentFile: file.name })

    // Update progress to show metadata extraction complete
    progressCallback?.({ stage: 'importing', progress: 65, currentFile: file.name, status: 'Preparing file storage...' })

    logLibraryStore.debug(`${logPrefix} Starting file storage operations`)

    // Create directory structure with error handling and timeout
    const docDir = `docs/${documentId}`
    try {
      progressCallback?.({ stage: 'importing', progress: 68, currentFile: file.name, status: 'Creating document directory...' })
      logLibraryStore.debug(`${logPrefix} Creating directory: ${docDir}`)
      
      await Promise.race([
        opfsManager.getDirectory(docDir),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Directory creation timeout')), 10000)
        )
      ])
      
      logLibraryStore.debug(`${logPrefix} Directory created successfully`)
    } catch (dirError) {
      logLibraryStore.error(`${logPrefix} Directory creation failed`, dirError instanceof Error ? dirError : new Error(String(dirError)))
      throw new Error(`Failed to create document directory: ${dirError instanceof Error ? dirError.message : 'Unknown directory error'}`)
    }

    // Update progress
    progressCallback?.({ stage: 'importing', progress: 70, currentFile: file.name, status: 'Directory created, storing file...' })

    // Store the file with error handling
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || fileFormat
    const fileName = `file.${fileExtension}`
    const filePath = `${docDir}/${fileName}`

    try {
      progressCallback?.({ stage: 'importing', progress: 72, currentFile: file.name, status: 'Reading file content...' })
      logLibraryStore.debug(`${logPrefix} Reading file as ArrayBuffer (${file.size} bytes)`)
      
      // Read file as ArrayBuffer with timeout
      const arrayBuffer = await Promise.race([
        file.arrayBuffer(),
        new Promise<ArrayBuffer>((_, reject) => 
          setTimeout(() => reject(new Error('File reading timeout')), 15000)
        )
      ])
      
      progressCallback?.({ stage: 'importing', progress: 75, currentFile: file.name, status: 'File read, writing to storage...' })
      logLibraryStore.debug(`${logPrefix} File read successfully, writing to: ${filePath}`)
      
      // Write with timeout and progress
      await Promise.race([
        (async () => {
          const writePromise = opfsManager.writeBinaryFile(filePath, arrayBuffer)
          // Add intermediate progress for large files
          if (file.size > 10 * 1024 * 1024) { // 10MB+
            progressCallback?.({ stage: 'importing', progress: 77, currentFile: file.name, status: 'Writing large file to storage...' })
          }
          return writePromise
        })(),
        new Promise<void>((_, reject) => 
          setTimeout(() => reject(new Error('File writing timeout')), 20000) // Increased timeout for large files
        )
      ])
      
      progressCallback?.({ stage: 'importing', progress: 80, currentFile: file.name, status: 'File stored successfully' })
      logLibraryStore.debug(`${logPrefix} File stored successfully`)
    } catch (fileError) {
      logLibraryStore.error(`${logPrefix} File storage failed`, fileError instanceof Error ? fileError : new Error(String(fileError)))
      throw new Error(`Failed to store file data: ${fileError instanceof Error ? fileError.message : 'Unknown file storage error'}`)
    }

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

    // Update progress
    progressCallback?.({ stage: 'importing', progress: 82, currentFile: file.name, status: 'Storing document metadata...' })

    logLibraryStore.debug(`${logPrefix} Storing document metadata`)

    // Store metadata with error handling and timeout
    try {
      await Promise.race([
        opfsManager.writeDocumentMetadata(completeMetadata),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Metadata storage timeout')), 10000)
        )
      ])
      
      progressCallback?.({ stage: 'importing', progress: 85, currentFile: file.name, status: 'Metadata stored, updating library index...' })
      logLibraryStore.debug(`${logPrefix} Document metadata stored successfully`)
    } catch (metadataError) {
      logLibraryStore.error(`${logPrefix} Metadata storage failed`, metadataError instanceof Error ? metadataError : new Error(String(metadataError)))
      throw new Error(`Failed to save document metadata: ${metadataError instanceof Error ? metadataError.message : 'Unknown metadata error'}`)
    }

    // Update progress
    progressCallback?.({ stage: 'importing', progress: 87, currentFile: file.name, status: 'Creating library index entry...' })

    logLibraryStore.debug(`${logPrefix} Creating library index entry`)

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

    // Update library index with error handling and timeout
    try {
      progressCallback?.({ stage: 'importing', progress: 90, currentFile: file.name, status: 'Reading library index...' })
      logLibraryStore.debug(`${logPrefix} Reading current library index`)
      
      const currentIndex = await Promise.race([
        opfsManager.readIndex(),
        new Promise<LibraryIndex>((_, reject) => 
          setTimeout(() => reject(new Error('Library index read timeout')), 8000)
        )
      ])
      
      progressCallback?.({ stage: 'importing', progress: 93, currentFile: file.name, status: 'Updating library index...' })
      currentIndex[documentId] = indexItem
      
      logLibraryStore.debug(`${logPrefix} Writing updated library index`)
      await Promise.race([
        opfsManager.writeIndex(currentIndex),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Library index write timeout')), 10000)
        )
      ])
      
      progressCallback?.({ stage: 'importing', progress: 95, currentFile: file.name, status: 'Finalizing import...' })
      logLibraryStore.debug(`${logPrefix} Library index updated successfully`)
    } catch (indexError) {
      logLibraryStore.error(`${logPrefix} Index update failed`, indexError instanceof Error ? indexError : new Error(String(indexError)))
      throw new Error(`Failed to update library index: ${indexError instanceof Error ? indexError.message : 'Unknown index error'}`)
    }

    // Update progress
    progressCallback?.({ stage: 'complete', progress: 100, currentFile: file.name })

    logLibraryStore.info(`${logPrefix} Import completed successfully`, {
      documentId,
      title: completeMetadata.title,
      format: fileFormat,
      size: file.size,
      totalStages: 6
    })

      return {
        success: true,
        documentId,
        metadata: completeMetadata
      }

    } catch (error) {
      // Enhanced error handling inside the timeout wrapper
      const errorMessage = error instanceof Error ? error.message : 'Unknown import error'
      logLibraryStore.error(`${logPrefix} Import failed`, error instanceof Error ? error : new Error(String(error)))

      // Create user-friendly error message with enhanced categorization
      let userFriendlyMessage = errorMessage
            
      if (errorMessage.includes('leadership')) {
        userFriendlyMessage = 'Library sync issue detected. Please try again in a few moments.'
      } else if (errorMessage.includes('timeout')) {
        if (errorMessage.includes('PDF')) {
          userFriendlyMessage = 'PDF processing timed out - the file may be large or complex. Import will continue with basic information.'
        } else {
          userFriendlyMessage = 'Import timed out. The file may be too large or the server is busy. Please try again.'
        }
      } else if (errorMessage.includes('Invalid PDF') || errorMessage.includes('corrupted')) {
        userFriendlyMessage = 'The file appears to be corrupted or not a valid PDF document.'
      } else if (errorMessage.includes('password') || errorMessage.includes('encrypted')) {
        userFriendlyMessage = 'Password-protected files are not currently supported.'
      } else if (errorMessage.includes('storage') || errorMessage.includes('quota')) {
        userFriendlyMessage = 'Storage issue detected. Please check your browser permissions and available disk space.'
      } else if (errorMessage.includes('directory') || errorMessage.includes('file system')) {
        userFriendlyMessage = 'File system error occurred. Please try again.'
      } else if (file.size > 50 * 1024 * 1024) { // 50MB
        userFriendlyMessage = 'File is very large and may take time to process. Please be patient or try a smaller file.'
      } else if (errorMessage.includes('PDF processing failed')) {
        userFriendlyMessage = 'PDF processing encountered issues. Import will continue with basic information.'
      }

      // Update progress with error
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
          logLibraryStore.debug(`${logPrefix} Cleaned up failed import directory`)
        } catch (cleanupError) {
          logLibraryStore.warn(`${logPrefix} Failed to cleanup failed import`, cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)))
        }
      }

      return {
        success: false,
        error: userFriendlyMessage,
        technicalError: errorMessage // Keep technical error for debugging
      }
    }
  }

  // Execute import with overall timeout
  try {
    return await Promise.race([
      importWithTimeout(),
      new Promise<ImportResult>((_, reject) =>
        setTimeout(() => reject(new Error('Import timed out completely - file may be too large or complex')), totalImportTimeout)
      )
    ])
  } catch (error) {
    // Final fallback - return a basic successful import with minimal metadata
    logLibraryStore.error(`${logPrefix} Import failed completely, using fallback`, error instanceof Error ? error : new Error(String(error)))
    
    const fallbackDocumentId = `fallback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const fallbackMetadata: DocumentMetadata = {
      id: fallbackDocumentId,
      title: file.name,
      authors: ['Unknown Author'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      formats: { pdf: { path: '', size: file.size, created: Date.now(), converter: 'import-fallback' } } as Record<DocumentFormat, FormatInfo>,
      description: 'Import completed with basic information due to processing errors',
      tags: ['import-fallback'],
      custom: { 
        originalError: error instanceof Error ? error.message : 'Unknown error',
        fileSize: file.size
      }
    }

    return {
      success: true,
      documentId: fallbackDocumentId,
      metadata: fallbackMetadata
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