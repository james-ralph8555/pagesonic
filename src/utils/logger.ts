/**
 * Console Logging Utility for OPFS and Library Operations
 * Provides configurable logging levels and structured output
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogContext = 'opfs' | 'leader-election' | 'library-store' | 'broadcast-channel' | 'general'

interface LogEntry {
  timestamp: string
  level: LogLevel
  context: LogContext
  message: string
  data?: any
  duration?: number
  error?: Error
}

class Logger {
  private static instance: Logger
  private logLevel: LogLevel = 'info'
  private enabledContexts: Set<LogContext> = new Set(['opfs', 'leader-election', 'library-store', 'broadcast-channel', 'general'])
  private logs: LogEntry[] = []
  private maxLogs = 1000
  private timers: Map<string, number> = new Map()

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }

  /**
   * Set the minimum log level
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level
    console.log(`[Logger] Log level set to: ${level}`)
  }

  /**
   * Enable/disable logging for specific contexts
   */
  setContextsEnabled(contexts: LogContext[], enabled: boolean): void {
    contexts.forEach(context => {
      if (enabled) {
        this.enabledContexts.add(context)
      } else {
        this.enabledContexts.delete(context)
      }
    })
    console.log(`[Logger] Enabled contexts:`, Array.from(this.enabledContexts))
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
    return levels[level] >= levels[this.logLevel]
  }

  /**
   * Check if a context is enabled
   */
  private isContextEnabled(context: LogContext): boolean {
    return this.enabledContexts.has(context)
  }

  /**
   * Format timestamp
   */
  private formatTimestamp(): string {
    return new Date().toISOString()
  }

  /**
   * Add log entry to history
   */
  private addLogEntry(entry: LogEntry): void {
    this.logs.push(entry)
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs)
    }
  }

  /**
   * Output log to console
   */
  private log(level: LogLevel, context: LogContext, message: string, data?: any, duration?: number, error?: Error): void {
    if (!this.shouldLog(level) || !this.isContextEnabled(context)) {
      return
    }

    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      context,
      message,
      data,
      duration,
      error
    }

    this.addLogEntry(entry)

    const prefix = `[${entry.timestamp}] [${context.toUpperCase()}] [${level.toUpperCase()}]`
    const args = [prefix, message]

    if (duration !== undefined) {
      args.push(`(${duration}ms)`)
    }

    if (data) {
      args.push('\nData:', data)
    }

    if (error) {
      args.push('\nError:', error)
    }

    // Use appropriate console method
    switch (level) {
      case 'debug':
        console.debug(...args)
        break
      case 'info':
        console.info(...args)
        break
      case 'warn':
        console.warn(...args)
        break
      case 'error':
        console.error(...args)
        break
    }
  }

  /**
   * Debug level logging
   */
  debug(context: LogContext, message: string, data?: any): void {
    this.log('debug', context, message, data)
  }

  /**
   * Info level logging
   */
  info(context: LogContext, message: string, data?: any): void {
    this.log('info', context, message, data)
  }

  /**
   * Warning level logging
   */
  warn(context: LogContext, message: string, data?: any): void {
    this.log('warn', context, message, data)
  }

  /**
   * Error level logging
   */
  error(context: LogContext, message: string, error?: Error, data?: any): void {
    this.log('error', context, message, data, undefined, error)
  }

  /**
   * Start timing an operation
   */
  startTimer(key: string, context: LogContext, message: string): void {
    const timerKey = `${context}:${key}`
    this.timers.set(timerKey, performance.now())
    this.debug(context, `⏱️ START: ${message}`)
  }

  /**
   * End timing an operation and log the duration
   */
  endTimer(key: string, context: LogContext, message: string, data?: any): void {
    const timerKey = `${context}:${key}`
    const startTime = this.timers.get(timerKey)
    
    if (startTime !== undefined) {
      const duration = Math.round(performance.now() - startTime)
      this.timers.delete(timerKey)
      this.info(context, `✅ END: ${message}`, data)
      this.debug(context, `⏱️ DURATION: ${message} (${duration}ms)`, { duration })
    } else {
      this.warn(context, `⚠️ Timer not found for: ${key}`)
      this.info(context, `✅ END: ${message}`, data)
    }
  }

  /**
   * Get recent logs
   */
  getRecentLogs(count: number = 100): LogEntry[] {
    return this.logs.slice(-count)
  }

  /**
   * Get logs by context
   */
  getLogsByContext(context: LogContext): LogEntry[] {
    return this.logs.filter(log => log.context === context)
  }

  /**
   * Get logs by level
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(log => log.level === level)
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = []
    this.info('general', 'Logs cleared')
  }

  /**
   * Export logs as formatted text
   */
  exportLogs(): string {
    return this.logs.map(entry => {
      const parts = [entry.timestamp, entry.context.toUpperCase(), entry.level.toUpperCase(), entry.message]
      if (entry.duration !== undefined) {
        parts.push(`(${entry.duration}ms)`)
      }
      if (entry.data) {
        parts.push('\n  Data:', JSON.stringify(entry.data, null, 2))
      }
      if (entry.error) {
        parts.push('\n  Error:', entry.error.message, entry.error.stack)
      }
      return parts.join(' ')
    }).join('\n')
  }

  /**
   * Get debug information
   */
  getDebugInfo(): {
    logLevel: LogLevel
    enabledContexts: LogContext[]
    totalLogs: number
    activeTimers: string[]
    recentLogs: LogEntry[]
  } {
    return {
      logLevel: this.logLevel,
      enabledContexts: Array.from(this.enabledContexts),
      totalLogs: this.logs.length,
      activeTimers: Array.from(this.timers.keys()),
      recentLogs: this.getRecentLogs(20)
    }
  }

  /**
   * Configure logger settings
   */
  configure(config: {
    logLevel?: LogLevel
    enabledContexts?: LogContext[]
    maxLogs?: number
  }): void {
    if (config.logLevel) {
      this.setLogLevel(config.logLevel)
    }
    if (config.enabledContexts) {
      this.setContextsEnabled(config.enabledContexts, true)
    }
    if (config.maxLogs) {
      this.maxLogs = config.maxLogs
    }
    
    this.info('general', 'Logger configuration updated', config)
  }
}

// Export singleton instance
export const logger = Logger.getInstance()

// Export convenience functions for specific contexts
export const logOPFS = {
  debug: (message: string, data?: any) => logger.debug('opfs', message, data),
  info: (message: string, data?: any) => logger.info('opfs', message, data),
  warn: (message: string, data?: any) => logger.warn('opfs', message, data),
  error: (message: string, error?: Error, data?: any) => logger.error('opfs', message, error, data),
  startTimer: (key: string, message: string) => logger.startTimer(key, 'opfs', message),
  endTimer: (key: string, message: string, data?: any) => logger.endTimer(key, 'opfs', message, data)
}

export const logLeaderElection = {
  debug: (message: string, data?: any) => logger.debug('leader-election', message, data),
  info: (message: string, data?: any) => logger.info('leader-election', message, data),
  warn: (message: string, data?: any) => logger.warn('leader-election', message, data),
  error: (message: string, error?: Error, data?: any) => logger.error('leader-election', message, error, data),
  startTimer: (key: string, message: string) => logger.startTimer(key, 'leader-election', message),
  endTimer: (key: string, message: string, data?: any) => logger.endTimer(key, 'leader-election', message, data)
}

export const logLibraryStore = {
  debug: (message: string, data?: any) => logger.debug('library-store', message, data),
  info: (message: string, data?: any) => logger.info('library-store', message, data),
  warn: (message: string, data?: any) => logger.warn('library-store', message, data),
  error: (message: string, error?: Error, data?: any) => logger.error('library-store', message, error, data),
  startTimer: (key: string, message: string) => logger.startTimer(key, 'library-store', message),
  endTimer: (key: string, message: string, data?: any) => logger.endTimer(key, 'library-store', message, data)
}

export const logBroadcastChannel = {
  debug: (message: string, data?: any) => logger.debug('broadcast-channel', message, data),
  info: (message: string, data?: any) => logger.info('broadcast-channel', message, data),
  warn: (message: string, data?: any) => logger.warn('broadcast-channel', message, data),
  error: (message: string, error?: Error, data?: any) => logger.error('broadcast-channel', message, error, data),
  startTimer: (key: string, message: string) => logger.startTimer(key, 'broadcast-channel', message),
  endTimer: (key: string, message: string, data?: any) => logger.endTimer(key, 'broadcast-channel', message, data)
}