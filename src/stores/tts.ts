import { createSignal, onCleanup } from 'solid-js'
import { TTSState, TTSModel } from '@/types'

const [state, setState] = createSignal<TTSState>({
  isPlaying: false,
  isPaused: false,
  currentSentence: 0,
  totalSentences: 0,
  voice: 'af_sarah',
  rate: 1.0,
  pitch: 1.0,
  model: null,
  engine: 'local',
  isModelLoading: false,
  isWebGPUSupported: false,
  lastError: null,
  session: undefined,
  systemVoices: [],
  // Chunking/config params (tunable in Settings)
  chunkMaxChars: 280,
  chunkOverlapChars: 24,
  sentenceSplit: true,
  interChunkPauseMs: 120,
  targetSampleRate: 24000
})

// Available TTS models based on architecture
const MODELS: TTSModel[] = [
  {
    name: 'Kokoro TTS',
    size: 82, // 82MB
    voices: ['af_sarah', 'af_nicole', 'am_michael', 'bf_emma', 'bf_isabella'],
    requiresWebGPU: true,
    url: '/models/kokoro-82m.onnx'
  },
  {
    name: 'Kitten TTS',
    size: 15, // 15MB
    voices: ['af_sarah', 'af_nicole', 'am_michael'],
    // Kitten can run on CPU (WASM) and optionally WebGPU if available
    requiresWebGPU: false,
    url: '/models/kitten-15m.onnx'
  }
]

export const useTTS = () => {
  // Check WebGPU support on mount
  const checkWebGPU = async () => {
    try {
      if ('gpu' in navigator && typeof (navigator as any).gpu !== 'undefined') {
        const adapter = await (navigator as any).gpu.requestAdapter()
        const supported = !!adapter
        setState(prev => ({ ...prev, isWebGPUSupported: supported }))
      }
    } catch (error) {
      console.warn('WebGPU not supported:', error)
      setState(prev => ({ ...prev, isWebGPUSupported: false }))
    }
  }
  
  checkWebGPU()

  // Initialize browser SpeechSynthesis voices if available
  const refreshSystemVoices = () => {
    try {
      if ('speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices()
        const names = voices.map(v => v.name)
        setState(prev => ({ ...prev, systemVoices: names }))
      }
    } catch {
      // ignore
    }
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    refreshSystemVoices()
    const onVoicesChanged = () => refreshSystemVoices()
    window.speechSynthesis.addEventListener?.('voiceschanged', onVoicesChanged as any)
    // best-effort cleanup when hook instance is discarded
    try { onCleanup(() => window.speechSynthesis.removeEventListener?.('voiceschanged', onVoicesChanged as any)) } catch {}
  }
  
  const loadModel = async (modelName: string) => {
    setState(prev => ({ ...prev, isModelLoading: true, lastError: null }))
    
    try {
      const model = MODELS.find(m => m.name === modelName)
      if (!model) {
        throw new Error(`Model ${modelName} not found`)
      }
      
      // Check if WebGPU is required and supported
      if (model.requiresWebGPU && !state().isWebGPUSupported) {
        throw new Error('WebGPU required but not supported')
      }

      // Verify the model asset exists before attempting to load
      try {
        const head = await fetch(model.url, { method: 'HEAD' })
        if (!head.ok) {
          throw new Error(`Model file not found at ${model.url}`)
        }
      } catch (e) {
        throw new Error(`Model asset missing. Place file at ${model.url}`)
      }

      // Load ORT build for WASM/WebGPU
      const ort = await import('onnxruntime-web') as any
      // Configure ORT asset paths and features; enable threads/SIMD only when COI is granted
      if (ort?.env?.wasm) {
        ort.env.wasm.wasmPaths = '/ort/'
        const coi = (globalThis as any).crossOriginIsolated === true
        ort.env.wasm.numThreads = coi ? (navigator.hardwareConcurrency || 4) : 1
        ort.env.wasm.simd = !!coi
      }
      // Force CPU/WASM for Kitten; require WebGPU for Kokoro
      const eps: ("webgpu" | "wasm")[] = model.requiresWebGPU ? ['webgpu'] : ['wasm']

      const session = await ort.InferenceSession.create(model.url, {
        executionProviders: eps as any,
      })

      setState(prev => ({
        ...prev,
        model,
        engine: 'local',
        isModelLoading: false,
        lastError: null,
        session
      }))
    } catch (error) {
      setState(prev => ({
        ...prev,
        isModelLoading: false,
        lastError: (error as Error)?.message || 'Failed to load TTS model'
      }))
      throw error
    }
  }
  
  // --- Text chunking helpers ---
  const splitIntoSentences = (text: string): string[] => {
    // Simple sentence splitter on punctuation boundaries
    const parts = text
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(Boolean)
    return parts.length > 0 ? parts : [text]
  }

  const chunkText = (text: string): { chunks: string[]; meta: { idx: number; startChar: number; endChar: number }[] } => {
    const { chunkMaxChars, chunkOverlapChars, sentenceSplit } = state()
    const units = sentenceSplit ? splitIntoSentences(text) : [text]
    const chunks: string[] = []
    const meta: { idx: number; startChar: number; endChar: number }[] = []

    let buffer = ''
    let cursor = 0
    const pushChunk = (c: string) => {
      const startChar = cursor
      const endChar = cursor + c.length
      chunks.push(c)
      meta.push({ idx: chunks.length - 1, startChar, endChar })
      cursor = endChar
    }

    const maxLen = Math.max(64, Math.min(2000, chunkMaxChars || 280))
    const overlap = Math.max(0, Math.min(200, chunkOverlapChars || 0))

    const flush = () => {
      if (!buffer.trim()) return
      if (buffer.length <= maxLen) {
        pushChunk(buffer)
        buffer = ''
        return
      }
      // If buffer is too large, hard-wrap on word boundaries with overlap
      let start = 0
      while (start < buffer.length) {
        const end = Math.min(buffer.length, start + maxLen)
        let slice = buffer.slice(start, end)
        if (end < buffer.length) {
          const lastSpace = slice.lastIndexOf(' ')
          if (lastSpace > maxLen * 0.5) {
            slice = slice.slice(0, lastSpace)
          }
        }
        pushChunk(slice)
        if (overlap > 0) {
          start += (slice.length - Math.min(overlap, slice.length))
        } else {
          start += slice.length
        }
      }
      buffer = ''
    }

    for (const u of units) {
      if ((buffer + (buffer ? ' ' : '') + u).length > maxLen * 1.2) {
        flush()
        buffer = u
      } else {
        buffer = buffer ? buffer + ' ' + u : u
      }
    }
    flush()

    return { chunks, meta }
  }

  // --- Playback helpers (browser SpeechSynthesis path) ---
  const speakChunksWithBrowserTTS = async (chunks: string[]) => {
    const { interChunkPauseMs } = state()
    return new Promise<void>((resolve) => {
      let i = 0
      const next = () => {
        if (i >= chunks.length) {
          resolve()
          return
        }
        const text = chunks[i]
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.rate = state().rate
        utterance.pitch = state().pitch
        const voice = speechSynthesis.getVoices().find(v => v.name.toLowerCase().includes(state().voice.toLowerCase())) || null
        utterance.voice = voice
        const chunkIdx = i
        console.log(`[TTS] speak chunk ${chunkIdx + 1}/${chunks.length} (len=${text.length}) rate=${utterance.rate} pitch=${utterance.pitch}`)
        utterance.onend = () => {
          i += 1
          if (interChunkPauseMs && interChunkPauseMs > 0) {
            setTimeout(next, interChunkPauseMs)
          } else {
            next()
          }
        }
        utterance.onerror = (ev) => {
          console.warn('[TTS] chunk error', ev.error)
          i += 1
          next()
        }
        speechSynthesis.speak(utterance)
      }
      next()
    })
  }

  const selectBrowserEngine = () => {
    // Switch to browser SpeechSynthesis engine
    setState(prev => ({
      ...prev,
      engine: 'browser',
      model: null,
      session: undefined,
      isModelLoading: false,
      lastError: null,
      // Pick a sensible default system voice if present
      voice: (prev.systemVoices && prev.systemVoices[0]) ? prev.systemVoices[0] : prev.voice
    }))
  }

  const speak = async (text: string) => {
    setState(prev => ({ ...prev, isPlaying: true, isPaused: false }))
    try {
      const current = state()

      // Prepare chunks + logging
      const t0 = performance.now()
      const { chunks, meta } = chunkText(text)
      console.log(`[TTS] text length=${text.length}, chunks=${chunks.length}`)
      meta.forEach(m => console.log(`[TTS] chunk #${m.idx + 1} chars=[${m.startChar}, ${m.endChar})`))

      // Path 1: Local model (ONNX) — not yet implemented, log clear guidance
      if (current.model && current.session && current.engine === 'local') {
        console.log('Speaking with model:', current.model.name)
        console.warn('[TTS] Local model synthesis not implemented yet for this model. Falling back to browser TTS if available.')
      }

      // Path 2: Browser TTS (chunked) if available
      if ('speechSynthesis' in window) {
        await speakChunksWithBrowserTTS(chunks)
        const t1 = performance.now()
        console.log(`[TTS] all chunks spoken in ${(t1 - t0).toFixed(0)}ms`)
        setState(prev => ({ ...prev, isPlaying: false, isPaused: false }))
        return
      }

      // If no model pipeline yet and no speechSynthesis, error out
      if (!state().model) {
        throw new Error('No TTS available (load a model or enable SpeechSynthesis)')
      }
    } catch (error) {
      setState(prev => ({ ...prev, isPlaying: false, lastError: (error as Error)?.message || 'TTS error' }))
      throw error
    }
  }
  
  const stop = () => {
    setState(prev => ({ ...prev, isPlaying: false, isPaused: false }))
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel()
    }
  }

  const pause = () => {
    if ('speechSynthesis' in window) {
      speechSynthesis.pause()
      setState(prev => ({ ...prev, isPaused: true }))
    }
  }

  const resume = () => {
    if ('speechSynthesis' in window) {
      speechSynthesis.resume()
      setState(prev => ({ ...prev, isPaused: false }))
    }
  }
  
  const setVoice = (voice: string) => {
    setState(prev => ({ ...prev, voice }))
  }
  
  const setRate = (rate: number) => {
    setState(prev => ({ ...prev, rate: Math.max(0.5, Math.min(rate, 2.0)) }))
  }
  
  const setPitch = (pitch: number) => {
    setState(prev => ({ ...prev, pitch: Math.max(0.5, Math.min(pitch, 2.0)) }))
  }

  const setChunkMaxChars = (n: number) => {
    setState(prev => ({ ...prev, chunkMaxChars: Math.max(64, Math.min(n || 280, 2000)) }))
  }

  const setChunkOverlapChars = (n: number) => {
    setState(prev => ({ ...prev, chunkOverlapChars: Math.max(0, Math.min(n || 0, 200)) }))
  }

  const setSentenceSplit = (enabled: boolean) => {
    setState(prev => ({ ...prev, sentenceSplit: !!enabled }))
  }

  const setInterChunkPauseMs = (n: number) => {
    setState(prev => ({ ...prev, interChunkPauseMs: Math.max(0, Math.min(n || 0, 2000)) }))
  }
  
  return {
    state,
    models: MODELS,
    loadModel,
    selectBrowserEngine,
    speak,
    stop,
    pause,
    resume,
    setVoice,
    setRate,
    setPitch,
    setChunkMaxChars,
    setChunkOverlapChars,
    setSentenceSplit,
    setInterChunkPauseMs
  }
}
