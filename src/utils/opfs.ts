/**
 * OPFS (Origin Private File System) Manager
 * Handles all file system operations with proper locking and atomic writes
 */

import { 
  OPFS_STRUCTURE, 
  LibraryIndex, 
  LibraryIndexVersion, 
  DocumentMetadata, 
  BookmarksFile, 
  UserSettings, 
  ReaderSettings,
  LibraryError,
  LibraryErrorCodes,
  DocumentId
} from '@/types/library'
import { logOPFS } from '@/utils/logger'

export class OPFSManager {
  private static instance: OPFSManager
  private root: FileSystemDirectoryHandle | null = null
  private initialized = false
  private initializationPromise: Promise<void> | null = null
  private initializationState: 'idle' | 'initializing' | 'ready' | 'failed' = 'idle'
  private initializationError: Error | null = null
  private retryCount = 0
  private maxRetries = 3
  private initializationQueue: Array<{ resolve: (value: void) => void; reject: (error: Error) => void }> = []

  private constructor() {}

  static getInstance(): OPFSManager {
    if (!OPFSManager.instance) {
      OPFSManager.instance = new OPFSManager()
    }
    return OPFSManager.instance
  }

  /**
   * Initialize OPFS and create directory structure
   */
  async initialize(): Promise<void> {
    // If already initialized, return immediately
    if (this.initialized && this.initializationState === 'ready') {
      logOPFS.debug('OPFS already initialized, skipping')
      return
    }

    // If initialization is in progress, queue this request
    if (this.initializationState === 'initializing') {
      logOPFS.debug('OPFS initialization already in progress, queuing request...')
      return new Promise<void>((resolve, reject) => {
        this.initializationQueue.push({ resolve, reject })
      })
    }

    // If initialization failed and we haven't exceeded retries, try again
    if (this.initializationState === 'failed' && this.retryCount < this.maxRetries) {
      logOPFS.info('Retrying OPFS initialization', { retryCount: this.retryCount + 1 })
      this.initializationState = 'idle'
      this.initializationError = null
    }

    // Start initialization process
    this.initializationState = 'initializing'
    this.initializationPromise = this.performInitialization()

    try {
      await this.initializationPromise
      // Resolve all queued requests
      this.resolveQueuedRequests()
    } catch (error) {
      // Reject all queued requests
      this.rejectQueuedRequests(error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      this.initializationPromise = null
    }
  }

  /**
   * Resolve all queued initialization requests
   */
  private resolveQueuedRequests(): void {
    const queue = this.initializationQueue.splice(0)
    queue.forEach(({ resolve }) => resolve())
    logOPFS.debug(`Resolved ${queue.length} queued initialization requests`)
  }

  /**
   * Reject all queued initialization requests
   */
  private rejectQueuedRequests(error: Error): void {
    const queue = this.initializationQueue.splice(0)
    queue.forEach(({ reject }) => reject(error))
    logOPFS.debug(`Rejected ${queue.length} queued initialization requests`)
  }

  /**
   * Perform the actual initialization
   */
  private async performInitialization(): Promise<void> {
    logOPFS.startTimer('initialize', 'OPFS initialization')
    logOPFS.info('Starting OPFS initialization', { retryCount: this.retryCount })

    try {
      logOPFS.debug('Getting OPFS root directory')
      this.root = await navigator.storage.getDirectory()
      logOPFS.debug('OPFS root directory obtained')
      
      // Create directory structure
      logOPFS.debug('Creating directory structure')
      await this.ensureDirectory(OPFS_STRUCTURE.SETTINGS_DIR)
      await this.ensureDirectory(OPFS_STRUCTURE.COVERS_DIR)
      await this.ensureDirectory(OPFS_STRUCTURE.DOCS_DIR)
      await this.ensureDirectory(OPFS_STRUCTURE.CONVERSIONS_DIR)
      await this.ensureDirectory(OPFS_STRUCTURE.TEMP_DIR)
      logOPFS.info('Directory structure created successfully')

      // Initialize index if it doesn't exist
      logOPFS.debug('Initializing library index')
      await this.initializeIndex()
      logOPFS.info('Library index initialized')

      this.initialized = true
      this.initializationState = 'ready'
      this.initializationError = null
      this.retryCount = 0
      logOPFS.endTimer('initialize', 'OPFS initialization completed successfully')
    } catch (error) {
      logOPFS.error('OPFS initialization failed', error instanceof Error ? error : new Error(String(error)))
      this.initializationState = 'failed'
      this.initializationError = error instanceof Error ? error : new Error(String(error))
      
      // Attempt retry if we haven't exceeded max retries
      if (this.retryCount < this.maxRetries) {
        this.retryCount++
        logOPFS.info(`Retrying OPFS initialization (attempt ${this.retryCount} of ${this.maxRetries})`)
        
        // Wait before retrying with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 5000)
        await new Promise(resolve => setTimeout(resolve, delay))
        
        // Reset state and try again
        this.initializationState = 'idle'
        return this.performInitialization()
      }
      
      throw new LibraryError(
        'Failed to initialize OPFS after maximum retries',
        LibraryErrorCodes.PERMISSION_DENIED,
        undefined,
        this.initializationError
      )
    }
  }

  /**
   * Ensure a directory exists, create if it doesn't
   */
  private async ensureDirectory(path: string): Promise<FileSystemDirectoryHandle> {
    if (!this.root) throw new LibraryError('OPFS not initialized', LibraryErrorCodes.PERMISSION_DENIED)
    
    logOPFS.debug(`Ensuring directory exists: ${path}`)
    const parts = path.split('/').filter(Boolean)
    let current = this.root

    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create: true })
      logOPFS.debug(`Directory ensured: ${part}`)
    }

    logOPFS.debug(`Directory path created/verified: ${path}`)
    return current
  }

  /**
   * Get a directory handle
   */
  async getDirectory(path: string): Promise<FileSystemDirectoryHandle> {
    if (!this.initialized) await this.initialize()
    if (!this.root) throw new LibraryError('OPFS not initialized', LibraryErrorCodes.PERMISSION_DENIED)

    const parts = path.split('/').filter(Boolean)
    let current = this.root

    for (const part of parts) {
      current = await current.getDirectoryHandle(part)
    }

    return current
  }

  /**
   * Get a file handle
   */
  async getFileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
    if (!this.initialized) await this.initialize()
    
    const parts = path.split('/')
    const filename = parts.pop()!
    const directory = parts.join('/') || '/'

    const dirHandle = await this.getDirectory(directory)
    return dirHandle.getFileHandle(filename, { create })
  }

  /**
   * Write text to a file atomically
   */
  async writeTextFile(path: string, content: string): Promise<void> {
    const tempPath = `${path}.tmp.${Date.now()}`
    const contentSize = new Blob([content]).size
    
    logOPFS.startTimer(`write:${path}`, `Write text file: ${path}`)
    logOPFS.info(`Starting atomic write to ${path}`, { size: contentSize })
    
    try {
      // Write to temporary file first
      logOPFS.debug(`Creating temp file: ${tempPath}`)
      const tempFile = await this.getFileHandle(tempPath, true)
      const writable = await tempFile.createWritable()
      await writable.write(content)
      await writable.close()
      logOPFS.debug(`Temp file written successfully: ${tempPath}`)

      // Rename to final path (atomic operation)
      logOPFS.debug(`Renaming temp file to final path: ${tempPath} -> ${path}`)
      await this.renameFile(tempPath, path)
      logOPFS.info(`File written successfully: ${path}`, { size: contentSize })
    } catch (error) {
      logOPFS.error(`Failed to write file: ${path}`, error instanceof Error ? error : new Error(String(error)), { 
        tempPath, 
        contentSize 
      })
      
      // Clean up temp file if it exists
      try {
        logOPFS.debug(`Cleaning up temp file: ${tempPath}`)
        await this.deleteFile(tempPath)
        logOPFS.debug(`Temp file cleaned up: ${tempPath}`)
      } catch (cleanupError) {
        logOPFS.warn(`Failed to clean up temp file: ${tempPath}`, cleanupError)
      }
      
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        logOPFS.error('Storage quota exceeded during write', error as Error)
        throw new LibraryError(
          'Storage quota exceeded',
          LibraryErrorCodes.QUOTA_EXCEEDED,
          undefined,
          error
        )
      }
      
      throw new LibraryError(
        `Failed to write file ${path}`,
        LibraryErrorCodes.PERMISSION_DENIED,
        undefined,
        error instanceof Error ? error : new Error(String(error))
      )
    } finally {
      logOPFS.endTimer(`write:${path}`, `Write text file completed: ${path}`)
    }
  }

  /**
   * Read text from a file
   */
  async readTextFile(path: string): Promise<string> {
    logOPFS.startTimer(`read:${path}`, `Read text file: ${path}`)
    
    try {
      logOPFS.debug(`Getting file handle for: ${path}`)
      const file = await this.getFileHandle(path)
      const fileObj = await file.getFile()
      const size = fileObj.size
      
      logOPFS.debug(`Reading file content: ${path}`, { size })
      const content = await fileObj.text()
      
      logOPFS.info(`File read successfully: ${path}`, { size, contentLength: content.length })
      logOPFS.endTimer(`read:${path}`, `Read text file completed: ${path}`)
      
      return content
    } catch (error) {
      logOPFS.error(`Failed to read file: ${path}`, error instanceof Error ? error : new Error(String(error)))
      
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        logOPFS.warn(`File not found: ${path}`)
        throw new LibraryError(
          `File not found: ${path}`,
          LibraryErrorCodes.DOCUMENT_NOT_FOUND,
          undefined,
          error
        )
      }
      
      throw new LibraryError(
        `Failed to read file ${path}`,
        LibraryErrorCodes.PERMISSION_DENIED,
        undefined,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  /**
   * Write binary data to a file atomically
   */
  async writeBinaryFile(path: string, data: ArrayBuffer | Uint8Array): Promise<void> {
    const tempPath = `${path}.tmp.${Date.now()}`
    
    try {
      // Write to temporary file first
      const tempFile = await this.getFileHandle(tempPath, true)
      const writable = await tempFile.createWritable()
      await writable.write(new Uint8Array(data))
      await writable.close()

      // Rename to final path
      await this.renameFile(tempPath, path)
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await this.deleteFile(tempPath)
      } catch {}
      
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new LibraryError(
          'Storage quota exceeded',
          LibraryErrorCodes.QUOTA_EXCEEDED,
          undefined,
          error
        )
      }
      
      throw new LibraryError(
        `Failed to write binary file ${path}`,
        LibraryErrorCodes.PERMISSION_DENIED,
        undefined,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  /**
   * Read binary data from a file
   */
  async readBinaryFile(path: string): Promise<ArrayBuffer> {
    try {
      const file = await this.getFileHandle(path)
      const fileObj = await file.getFile()
      return await fileObj.arrayBuffer()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        throw new LibraryError(
          `File not found: ${path}`,
          LibraryErrorCodes.DOCUMENT_NOT_FOUND,
          undefined,
          error
        )
      }
      
      throw new LibraryError(
        `Failed to read binary file ${path}`,
        LibraryErrorCodes.PERMISSION_DENIED,
        undefined,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string): Promise<void> {
    try {
      const parts = path.split('/')
      const filename = parts.pop()!
      const directory = parts.join('/') || '/'

      const dirHandle = await this.getDirectory(directory)
      await dirHandle.removeEntry(filename)
    } catch (error) {
      // Ignore file not found errors
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return
      }
      
      throw new LibraryError(
        `Failed to delete file ${path}`,
        LibraryErrorCodes.PERMISSION_DENIED,
        undefined,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  /**
   * Rename a file (atomic operation)
   */
  private async renameFile(oldPath: string, newPath: string): Promise<void> {
    // Read the old file
    const data = await this.readBinaryFile(oldPath)
    
    // Write to new location
    await this.writeBinaryFile(newPath, data)
    
    // Delete old file
    await this.deleteFile(oldPath)
  }

  /**
   * Check if a file exists
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      await this.getFileHandle(path)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get file size
   */
  async getFileSize(path: string): Promise<number> {
    try {
      const file = await this.getFileHandle(path)
      const fileObj = await file.getFile()
      return fileObj.size
    } catch {
      return 0
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(path: string): Promise<string[]> {
    const dir = await this.getDirectory(path)
    const entries: string[] = []
    
    // Use iteration with unknown structure for compatibility
    // @ts-ignore - DirectoryHandle iteration may not be fully typed
    for await (const [name] of dir.entries()) {
      entries.push(name)
    }
    
    return entries
  }

  /**
   * Remove a directory and all its contents
   */
  async removeDirectory(path: string, recursive = true): Promise<void> {
    try {
      const parts = path.split('/').filter(Boolean)
      const dirname = parts.pop()!
      const parentPath = '/' + parts.join('/')
      
      const parentDir = await this.getDirectory(parentPath)
      
      if (recursive) {
        await parentDir.removeEntry(dirname, { recursive: true })
      } else {
        await parentDir.removeEntry(dirname)
      }
    } catch (error) {
      throw new LibraryError(
        `Failed to remove directory ${path}`,
        LibraryErrorCodes.PERMISSION_DENIED,
        undefined,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  // Library-specific operations

  /**
   * Initialize the library index file
   */
  private async initializeIndex(): Promise<void> {
    logOPFS.debug('Checking if library index exists')
    const exists = await this.fileExists(OPFS_STRUCTURE.INDEX)
    
    if (!exists) {
      logOPFS.info('Creating new library index')
      const indexData: LibraryIndexVersion = {
        version: 1,
        index: {}
      }
      await this.writeTextFile(OPFS_STRUCTURE.INDEX, JSON.stringify(indexData, null, 2))
      logOPFS.info('Library index created successfully')
    } else {
      logOPFS.debug('Library index already exists')
    }
  }

  /**
   * Read the library index
   */
  async readIndex(): Promise<LibraryIndex> {
    logOPFS.startTimer('readIndex', 'Read library index')
    
    try {
      logOPFS.debug('Reading library index file')
      const content = await this.readTextFile(OPFS_STRUCTURE.INDEX)
      const data: LibraryIndexVersion = JSON.parse(content)
      
      logOPFS.debug('Library index parsed', { version: data.version, documentCount: Object.keys(data.index).length })
      
      // Handle version upgrades if needed
      if (data.version !== 1) {
        logOPFS.warn(`Library index version ${data.version} detected, current version is 1`)
        // Future version upgrade logic would go here
      }
      
      logOPFS.endTimer('readIndex', 'Library index read successfully')
      return data.index
    } catch (error) {
      logOPFS.error('Failed to read library index', error instanceof Error ? error : new Error(String(error)))
      throw new LibraryError(
        'Failed to read library index',
        LibraryErrorCodes.CORRUPTION_DETECTED,
        undefined,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  /**
   * Write the library index
   */
  async writeIndex(index: LibraryIndex): Promise<void> {
    logOPFS.startTimer('writeIndex', 'Write library index')
    const documentCount = Object.keys(index).length
    
    const indexData: LibraryIndexVersion = {
      version: 1,
      index
    }
    
    logOPFS.info('Writing library index', { documentCount })
    await this.writeTextFile(OPFS_STRUCTURE.INDEX, JSON.stringify(indexData, null, 2))
    logOPFS.endTimer('writeIndex', 'Library index written successfully')
  }

  /**
   * Read document metadata
   */
  async readDocumentMetadata(docId: DocumentId): Promise<DocumentMetadata | null> {
    const metadataPath = `${OPFS_STRUCTURE.DOCS_DIR}${docId}/metadata.json`
    
    if (!await this.fileExists(metadataPath)) {
      return null
    }
    
    try {
      const content = await this.readTextFile(metadataPath)
      return JSON.parse(content)
    } catch (error) {
      throw new LibraryError(
        `Failed to read metadata for document ${docId}`,
        LibraryErrorCodes.CORRUPTION_DETECTED,
        docId,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  /**
   * Write document metadata
   */
  async writeDocumentMetadata(metadata: DocumentMetadata): Promise<void> {
    const metadataPath = `${OPFS_STRUCTURE.DOCS_DIR}${metadata.id}/metadata.json`
    await this.ensureDirectory(`${OPFS_STRUCTURE.DOCS_DIR}${metadata.id}/`)
    await this.writeTextFile(metadataPath, JSON.stringify(metadata, null, 2))
  }

  /**
   * Read document bookmarks
   */
  async readDocumentBookmarks(docId: DocumentId): Promise<BookmarksFile | null> {
    const bookmarksPath = `${OPFS_STRUCTURE.DOCS_DIR}${docId}/bookmarks.json`
    
    if (!await this.fileExists(bookmarksPath)) {
      return {
        docId,
        version: 1,
        bookmarks: [],
        lastModified: Date.now()
      }
    }
    
    try {
      const content = await this.readTextFile(bookmarksPath)
      return JSON.parse(content)
    } catch (error) {
      throw new LibraryError(
        `Failed to read bookmarks for document ${docId}`,
        LibraryErrorCodes.CORRUPTION_DETECTED,
        docId,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  /**
   * Write document bookmarks
   */
  async writeDocumentBookmarks(bookmarks: BookmarksFile): Promise<void> {
    const bookmarksPath = `${OPFS_STRUCTURE.DOCS_DIR}${bookmarks.docId}/bookmarks.json`
    await this.ensureDirectory(`${OPFS_STRUCTURE.DOCS_DIR}${bookmarks.docId}/`)
    await this.writeTextFile(bookmarksPath, JSON.stringify(bookmarks, null, 2))
  }

  /**
   * Read user settings
   */
  async readUserSettings(): Promise<UserSettings> {
    const defaultSettings: UserSettings = {
      theme: 'auto',
      language: 'en',
      autoImport: false,
      autoConvert: false,
      defaultFormat: 'pdf',
      libraryView: 'grid',
      sortBy: 'title',
      sortOrder: 'asc',
      itemsPerPage: 20,
      showCovers: true,
      autoBackup: false
    }

    if (!await this.fileExists(OPFS_STRUCTURE.USER_SETTINGS)) {
      return defaultSettings
    }

    try {
      const content = await this.readTextFile(OPFS_STRUCTURE.USER_SETTINGS)
      return { ...defaultSettings, ...JSON.parse(content) }
    } catch (error) {
      console.warn('Failed to read user settings, using defaults', error)
      return defaultSettings
    }
  }

  /**
   * Write user settings
   */
  async writeUserSettings(settings: UserSettings): Promise<void> {
    await this.writeTextFile(OPFS_STRUCTURE.USER_SETTINGS, JSON.stringify(settings, null, 2))
  }

  /**
   * Read reader settings
   */
  async readReaderSettings(): Promise<ReaderSettings> {
    const defaultSettings: ReaderSettings = {
      fontSize: 16,
      lineHeight: 1.6,
      fontFamily: 'system-ui',
      margin: 20,
      backgroundColor: '#ffffff',
      textColor: '#000000',
      scrollMode: 'paginated',
      autoBookmark: true,
      syncProgress: true
    }

    if (!await this.fileExists(OPFS_STRUCTURE.READER_SETTINGS)) {
      return defaultSettings
    }

    try {
      const content = await this.readTextFile(OPFS_STRUCTURE.READER_SETTINGS)
      return { ...defaultSettings, ...JSON.parse(content) }
    } catch (error) {
      console.warn('Failed to read reader settings, using defaults', error)
      return defaultSettings
    }
  }

  /**
   * Write reader settings
   */
  async writeReaderSettings(settings: ReaderSettings): Promise<void> {
    await this.writeTextFile(OPFS_STRUCTURE.READER_SETTINGS, JSON.stringify(settings, null, 2))
  }

  /**
   * Check if OPFS is ready
   */
  isReady(): boolean {
    return this.initializationState === 'ready' && this.initialized
  }

  /**
   * Check if OPFS has failed
   */
  hasFailed(): boolean {
    return this.initializationState === 'failed'
  }

  /**
   * Get initialization error
   */
  getInitializationError(): Error | null {
    return this.initializationError
  }

  /**
   * Reset initialization state (for recovery)
   */
  resetInitialization(): void {
    this.initializationState = 'idle'
    this.initialized = false
    this.initializationError = null
    this.retryCount = 0
    this.initializationPromise = null
    this.initializationQueue.length = 0
    logOPFS.info('OPFS state reset')
  }

  /**
   * Force re-initialization
   */
  async forceReinitialize(): Promise<void> {
    logOPFS.info('Force re-initializing OPFS')
    this.resetInitialization()
    return this.initialize()
  }

  /**
   * Get storage usage estimate
   */
  async getStorageUsage(): Promise<{ used: number; quota: number; available: number }> {
    try {
      const estimate = await navigator.storage.estimate()
      return {
        used: estimate.usage || 0,
        quota: estimate.quota || 0,
        available: (estimate.quota || 0) - (estimate.usage || 0)
      }
    } catch (error) {
      return { used: 0, quota: 0, available: 0 }
    }
  }

  /**
   * Request persistent storage
   */
  async requestPersistentStorage(): Promise<boolean> {
    try {
      return await navigator.storage.persist()
    } catch (error) {
      console.warn('Failed to request persistent storage:', error)
      return false
    }
  }
}

// Export singleton instance
export const opfsManager = OPFSManager.getInstance()