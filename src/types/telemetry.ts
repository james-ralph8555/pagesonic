/**
 * Telemetry Types for Performance Monitoring
 * 
 * Event catalog for capturing PDF load/render, TTS synthesis, and general perf metrics.
 * Designed for ring buffer storage and snapshot export.
 */

// Core event categories
export type TelemetryCategory = 'pdf' | 'tts' | 'render' | 'app'

// Base event structure
export interface TelemetryEventBase {
  id: string
  timestamp: number
  category: TelemetryCategory
  name: string
  duration?: number
  metadata?: Record<string, unknown>
}

// PDF Events
export type PDFEventName = 
  | 'pdf_load_start'
  | 'pdf_load_complete'
  | 'pdf_load_error'
  | 'page_render_start'
  | 'page_render_complete'
  | 'page_render_error'
  | 'text_extract_start'
  | 'text_extract_complete'
  | 'viewport_change'

export interface PDFEvent extends TelemetryEventBase {
  category: 'pdf'
  name: PDFEventName
  metadata?: {
    pageNumber?: number
    totalPages?: number
    fileSize?: number
    scale?: number
    errorMessage?: string
  }
}

// TTS Events
export type TTSEventName =
  | 'tts_model_init_start'
  | 'tts_model_init_complete'
  | 'tts_model_init_error'
  | 'tts_synth_start'
  | 'tts_synth_complete'
  | 'tts_synth_error'
  | 'tts_playback_start'
  | 'tts_playback_complete'
  | 'tts_playback_error'
  | 'tts_engine_switch'

export interface TTSEvent extends TelemetryEventBase {
  category: 'tts'
  name: TTSEventName
  metadata?: {
    engine?: 'local' | 'browser'
    model?: string
    voice?: string
    chunkIndex?: number
    totalChunks?: number
    textLength?: number
    sampleRate?: number
    errorMessage?: string
  }
}

// Render Events
export type RenderEventName =
  | 'frame_render'
  | 'scroll_start'
  | 'scroll_end'
  | 'canvas_create'
  | 'canvas_destroy'
  | 'queue_add'
  | 'queue_process'
  | 'queue_clear'

export interface RenderEvent extends TelemetryEventBase {
  category: 'render'
  name: RenderEventName
  metadata?: {
    visiblePages?: number[]
    queueSize?: number
    frameTime?: number
    scrollPosition?: number
  }
}

// App Events
export type AppEventName =
  | 'app_init'
  | 'app_error'
  | 'memory_warning'
  | 'visibility_change'

export interface AppEvent extends TelemetryEventBase {
  category: 'app'
  name: AppEventName
  metadata?: {
    visible?: boolean
    memoryUsage?: number
    errorMessage?: string
    errorStack?: string
  }
}

// Union type for all events
export type TelemetryEvent = PDFEvent | TTSEvent | RenderEvent | AppEvent

// Snapshot for export and analysis
export interface TelemetrySnapshot {
  version: 1
  capturedAt: number
  sessionId: string
  eventCount: number
  events: TelemetryEvent[]
  summary: {
    pdf: {
      loadCount: number
      avgLoadTime: number
      pageRenderCount: number
      avgPageRenderTime: number
      errors: number
    }
    tts: {
      initCount: number
      avgInitTime: number
      synthCount: number
      avgSynthTime: number
      playbackCount: number
      errors: number
    }
    render: {
      frameCount: number
      avgFrameTime: number
      scrollCount: number
      maxQueueSize: number
    }
    app: {
      errorCount: number
      memoryWarningCount: number
    }
  }
}

// Configuration for telemetry store
export interface TelemetryConfig {
  maxEvents: number
  enabledCategories: TelemetryCategory[]
  samplingRate: number // 0-1, fraction of events to capture
}
