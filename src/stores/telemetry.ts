import { createSignal } from 'solid-js'
import type {
  TelemetryEvent,
  TelemetrySnapshot,
  TelemetryConfig,
  TelemetryCategory,
  PDFEventName,
  TTSEventName,
  RenderEventName,
  AppEventName
} from '@/types/telemetry'

const DEFAULT_CONFIG: TelemetryConfig = {
  maxEvents: 1000,
  enabledCategories: ['pdf', 'tts', 'render', 'app'],
  samplingRate: 1
}

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
const generateSessionId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

interface TelemetryState {
  events: TelemetryEvent[]
  config: TelemetryConfig
  sessionId: string
  enabled: boolean
}

const [state, setState] = createSignal<TelemetryState>({
  events: [],
  config: DEFAULT_CONFIG,
  sessionId: generateSessionId(),
  enabled: true
})

export const useTelemetry = () => {
  const emit = <C extends TelemetryCategory>(
    category: C,
    name: C extends 'pdf' ? PDFEventName 
         : C extends 'tts' ? TTSEventName
         : C extends 'render' ? RenderEventName
         : AppEventName,
    duration?: number,
    metadata?: Record<string, unknown>
  ) => {
    const s = state()
    if (!s.enabled) return
    if (!s.config.enabledCategories.includes(category)) return
    if (Math.random() > s.config.samplingRate) return

    const event: TelemetryEvent = {
      id: generateId(),
      timestamp: Date.now(),
      category,
      name,
      duration,
      metadata
    } as TelemetryEvent

    setState(prev => {
      const events = [...prev.events, event]
      if (events.length > prev.config.maxEvents) {
        events.shift()
      }
      return { ...prev, events }
    })
  }

  const emitStart = <C extends TelemetryCategory>(
    category: C,
    name: C extends 'pdf' ? PDFEventName 
         : C extends 'tts' ? TTSEventName
         : C extends 'render' ? RenderEventName
         : AppEventName,
    metadata?: Record<string, unknown>
  ) => {
    emit(category, name, undefined, metadata)
    return Date.now()
  }

  const emitEnd = <C extends TelemetryCategory>(
    startTime: number,
    category: C,
    name: C extends 'pdf' ? PDFEventName 
         : C extends 'tts' ? TTSEventName
         : C extends 'render' ? RenderEventName
         : AppEventName,
    metadata?: Record<string, unknown>
  ) => {
    const duration = Date.now() - startTime
    emit(category, name, duration, metadata)
    return duration
  }

  const getEvents = () => state().events

  const getEventsByCategory = (category: TelemetryCategory) => 
    state().events.filter(e => e.category === category)

  const clear = () => {
    setState(prev => ({ ...prev, events: [] }))
  }

  const configure = (config: Partial<TelemetryConfig>) => {
    setState(prev => ({
      ...prev,
      config: { ...prev.config, ...config }
    }))
  }

  const setEnabled = (enabled: boolean) => {
    setState(prev => ({ ...prev, enabled }))
  }

  const resetSession = () => {
    setState(prev => ({
      ...prev,
      events: [],
      sessionId: generateSessionId()
    }))
  }

  const getSnapshot = (): TelemetrySnapshot => {
    const s = state()
    const events = s.events

    const pdfEvents = events.filter(e => e.category === 'pdf')
    const ttsEvents = events.filter(e => e.category === 'tts')
    const renderEvents = events.filter(e => e.category === 'render')
    const appEvents = events.filter(e => e.category === 'app')

    const avgDuration = (evts: TelemetryEvent[]) => {
      const withDuration = evts.filter(e => e.duration !== undefined)
      if (withDuration.length === 0) return 0
      return withDuration.reduce((sum, e) => sum + (e.duration || 0), 0) / withDuration.length
    }

    const pdfLoads = pdfEvents.filter(e => e.name === 'pdf_load_complete')
    const pageRenders = pdfEvents.filter(e => e.name === 'page_render_complete')
    const pdfErrors = pdfEvents.filter(e => e.name.endsWith('_error'))

    const ttsInits = ttsEvents.filter(e => e.name === 'tts_model_init_complete')
    const ttsSynths = ttsEvents.filter(e => e.name === 'tts_synth_complete')
    const ttsPlaybacks = ttsEvents.filter(e => e.name === 'tts_playback_complete')
    const ttsErrors = ttsEvents.filter(e => e.name.endsWith('_error'))

    const frames = renderEvents.filter(e => e.name === 'frame_render')
    const scrolls = renderEvents.filter(e => e.name === 'scroll_start')
    const maxQueueSize = Math.max(
      0,
      ...renderEvents
        .filter(e => e.metadata?.queueSize !== undefined)
        .map(e => (e.metadata?.queueSize as number) || 0)
    )

    return {
      version: 1,
      capturedAt: Date.now(),
      sessionId: s.sessionId,
      eventCount: events.length,
      events,
      summary: {
        pdf: {
          loadCount: pdfLoads.length,
          avgLoadTime: avgDuration(pdfLoads),
          pageRenderCount: pageRenders.length,
          avgPageRenderTime: avgDuration(pageRenders),
          errors: pdfErrors.length
        },
        tts: {
          initCount: ttsInits.length,
          avgInitTime: avgDuration(ttsInits),
          synthCount: ttsSynths.length,
          avgSynthTime: avgDuration(ttsSynths),
          playbackCount: ttsPlaybacks.length,
          errors: ttsErrors.length
        },
        render: {
          frameCount: frames.length,
          avgFrameTime: avgDuration(frames),
          scrollCount: scrolls.length,
          maxQueueSize
        },
        app: {
          errorCount: appEvents.filter(e => e.name === 'app_error').length,
          memoryWarningCount: appEvents.filter(e => e.name === 'memory_warning').length
        }
      }
    }
  }

  const exportJSON = () => {
    const snapshot = getSnapshot()
    return JSON.stringify(snapshot, null, 2)
  }

  const downloadSnapshot = (filename = 'telemetry-snapshot.json') => {
    const json = exportJSON()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return {
    state,
    emit,
    emitStart,
    emitEnd,
    getEvents,
    getEventsByCategory,
    clear,
    configure,
    setEnabled,
    resetSession,
    getSnapshot,
    exportJSON,
    downloadSnapshot
  }
}
