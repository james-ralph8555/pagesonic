import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logger, logOPFS, logLibraryStore } from './logger'

describe('Logger', () => {
  beforeEach(() => {
    logger.clearLogs()
  })

  it('should provide a singleton logger instance', () => {
    expect(logger).toBeDefined()
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
  })

  it('should provide context-specific log helpers', () => {
    expect(logOPFS).toBeDefined()
    expect(typeof logOPFS.debug).toBe('function')
    expect(typeof logOPFS.info).toBe('function')
    
    expect(logLibraryStore).toBeDefined()
    expect(typeof logLibraryStore.debug).toBe('function')
  })

  it('should log messages with context', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    
    logger.info('opfs', 'test message')
    expect(consoleSpy).toHaveBeenCalled()
    
    consoleSpy.mockRestore()
  })

  it('should track logs in history', () => {
    logger.info('opfs', 'test message 1')
    logger.info('library-store', 'test message 2')
    
    const recentLogs = logger.getRecentLogs(10)
    expect(recentLogs.length).toBeGreaterThanOrEqual(2)
  })

  it('should filter logs by context', () => {
    logger.info('opfs', 'opfs message')
    logger.info('library-store', 'library message')
    
    const opfsLogs = logger.getLogsByContext('opfs')
    expect(opfsLogs.some(log => log.message === 'opfs message')).toBe(true)
  })

  it('should filter logs by level', () => {
    logger.info('opfs', 'info message')
    logger.warn('opfs', 'warn message')
    
    const warnLogs = logger.getLogsByLevel('warn')
    expect(warnLogs.some(log => log.message === 'warn message')).toBe(true)
  })

  it('should export logs as formatted text', () => {
    logger.info('opfs', 'export test')
    
    const exported = logger.exportLogs()
    expect(typeof exported).toBe('string')
    expect(exported).toContain('export test')
  })

  it('should provide debug information', () => {
    logger.info('opfs', 'debug info test')
    
    const debugInfo = logger.getDebugInfo()
    expect(debugInfo).toHaveProperty('logLevel')
    expect(debugInfo).toHaveProperty('enabledContexts')
    expect(debugInfo).toHaveProperty('totalLogs')
    expect(debugInfo.totalLogs).toBeGreaterThanOrEqual(1)
  })
})
