/**
 * Pressure Monitor Module (P0-RDR-005)
 *
 * Monitors device capabilities and runtime pressure to inform adaptive concurrency.
 * Uses PerformanceObserver for long task detection and provides a pressure score.
 */

import { logPDF } from './logger'

export interface DeviceCapabilities {
  cpuCores: number
  deviceMemory: number
  isMobile: boolean
  isLowEnd: boolean
  baselineConcurrency: number
}

export interface PressureState {
  pressure: 'low' | 'medium' | 'high'
  score: number
  longTaskCount: number
  avgFrameTime: number
  lastUpdate: number
}

type PressureChangeListener = (state: PressureState) => void

const FRAME_TIME_SAMPLES = 10
const PRESSURE_SAMPLE_WINDOW = 5000
const HIGH_PRESSURE_THRESHOLD = 0.7
const MEDIUM_PRESSURE_THRESHOLD = 0.4

class PressureMonitorImpl {
  private deviceCapabilities: DeviceCapabilities | null = null
  private pressureState: PressureState = {
    pressure: 'low',
    score: 0,
    longTaskCount: 0,
    avgFrameTime: 16.67,
    lastUpdate: Date.now()
  }
  private longTaskObserver: PerformanceObserver | null = null
  private frameTimes: number[] = []
  private lastFrameTime = 0
  private rafId: number | null = null
  private listeners: Set<PressureChangeListener> = new Set()
  private longTaskWindow: number[] = []
  private totalLongTaskCount = 0

  detectCapabilities(): DeviceCapabilities {
    if (this.deviceCapabilities) {
      return this.deviceCapabilities
    }

    const cpuCores = navigator.hardwareConcurrency || 4
    const deviceMemory = (navigator as any).deviceMemory || 8
    const isMobile = this.detectMobile()
    const isLowEnd = this.detectLowEnd(cpuCores, deviceMemory, isMobile)

    let baselineConcurrency: number
    if (isLowEnd) {
      baselineConcurrency = 1
    } else if (isMobile) {
      baselineConcurrency = Math.min(2, cpuCores)
    } else {
      baselineConcurrency = Math.min(4, Math.max(2, Math.floor(cpuCores / 2)))
    }

    this.deviceCapabilities = {
      cpuCores,
      deviceMemory,
      isMobile,
      isLowEnd,
      baselineConcurrency
    }

    try { console.info('[PressureMonitor] detected device capabilities', this.deviceCapabilities) } catch {}
    return this.deviceCapabilities
  }

  private detectMobile(): boolean {
    const ua = navigator.userAgent.toLowerCase()
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua)
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    const isSmallScreen = window.innerWidth < 768
    return isMobileUA || (isTouchDevice && isSmallScreen)
  }

  private detectLowEnd(cpuCores: number, memory: number, isMobile: boolean): boolean {
    if (cpuCores <= 2) return true
    if (memory <= 2) return true
    if (isMobile && cpuCores <= 4) return true
    if (isMobile && memory <= 4) return true
    return false
  }

  start(): void {
    this.detectCapabilities()
    this.startLongTaskObserver()
    this.startFrameMonitor()
    logPDF.debug('PressureMonitor: started monitoring')
  }

  stop(): void {
    if (this.longTaskObserver) {
      this.longTaskObserver.disconnect()
      this.longTaskObserver = null
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.listeners.clear()
    logPDF.debug('PressureMonitor: stopped monitoring')
  }

  private startLongTaskObserver(): void {
    if (!('PerformanceObserver' in window)) return

    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'longtask') {
            const now = Date.now()
            this.longTaskWindow.push(now)
            this.longTaskWindow = this.longTaskWindow.filter(t => now - t < PRESSURE_SAMPLE_WINDOW)
            this.totalLongTaskCount++
            this.updatePressure()
          }
        }
      })
      this.longTaskObserver.observe({ entryTypes: ['longtask'] })
    } catch {
      logPDF.debug('PressureMonitor: longtask observer not supported')
    }
  }

  private startFrameMonitor(): void {
    const measureFrame = (timestamp: number) => {
      if (this.lastFrameTime > 0) {
        const frameTime = timestamp - this.lastFrameTime
        this.frameTimes.push(frameTime)
        if (this.frameTimes.length > FRAME_TIME_SAMPLES) {
          this.frameTimes.shift()
        }
      }
      this.lastFrameTime = timestamp
      this.rafId = requestAnimationFrame(measureFrame)
    }
    this.rafId = requestAnimationFrame(measureFrame)
  }

  private updatePressure(): void {
    const now = Date.now()
    const recentLongTasks = this.longTaskWindow.filter(t => now - t < PRESSURE_SAMPLE_WINDOW).length

    const avgFrameTime = this.frameTimes.length > 0
      ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
      : 16.67

    const frameTimeFactor = Math.min(1, avgFrameTime / 33.33)
    const longTaskFactor = Math.min(1, recentLongTasks / 10)

    const score = (frameTimeFactor * 0.6) + (longTaskFactor * 0.4)

    let pressure: 'low' | 'medium' | 'high'
    if (score >= HIGH_PRESSURE_THRESHOLD) {
      pressure = 'high'
    } else if (score >= MEDIUM_PRESSURE_THRESHOLD) {
      pressure = 'medium'
    } else {
      pressure = 'low'
    }

    const prevState = this.pressureState.pressure
    this.pressureState = {
      pressure,
      score,
      longTaskCount: this.totalLongTaskCount,
      avgFrameTime,
      lastUpdate: now
    }

    if (pressure !== prevState) {
      try { console.info('[PressureMonitor] pressure changed', prevState, '->', pressure, { score: score.toFixed(2), avgFrameTime: avgFrameTime.toFixed(1), recentLongTasks }) } catch {}
      this.notifyListeners()
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.pressureState)
      } catch {}
    }
  }

  getPressureState(): PressureState {
    this.updatePressure()
    return { ...this.pressureState }
  }

  getCapabilities(): DeviceCapabilities | null {
    return this.deviceCapabilities ? { ...this.deviceCapabilities } : null
  }

  onPressureChange(listener: PressureChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getRecommendedConcurrency(): number {
    const caps = this.deviceCapabilities || this.detectCapabilities()
    const state = this.getPressureState()

    let multiplier = 1
    switch (state.pressure) {
      case 'high':
        multiplier = 0.5
        break
      case 'medium':
        multiplier = 0.75
        break
      case 'low':
        multiplier = 1
        break
    }

    const recommended = Math.max(1, Math.round(caps.baselineConcurrency * multiplier))
    return recommended
  }
}

export const PressureMonitor = new PressureMonitorImpl()
