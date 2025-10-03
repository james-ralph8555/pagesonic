import { createSignal } from 'solid-js'
import { TTSState, TTSModel } from '@/types'
import { ensureAudioContext, playPCM, suspend as suspendAudio, resume as resumeAudio, close as closeAudio } from '@/utils/audio'
import { cleanForTTS } from '@/tts/textCleaner'
import { getPref, setPref } from '@/utils/idb'
import { isIOSDevice } from '@/utils/iosDetection'

// Shared, app-wide TTS state
const [state, setState] = createSignal<TTSState>({
  isPlaying: false,
  isPaused: false,
  currentSentence: 0,
  totalSentences: 0,
  // Will be set to a valid voice when an engine/model is selected
  voice: '',
  rate: 1.0,
  pitch: 1.0,
  model: null,
  engine: 'local',
  isModelLoading: false,
  isWebGPUSupported: false,
  lastError: null,
  systemVoices: [],
  phonemizer: 'auto',
  espeakTimeoutMs: 4000,
  // Chunking/config params (tunable in Settings)
  chunkMaxChars: 280,
  chunkOverlapChars: 24,
  sentenceSplit: true,
  interChunkPauseMs: 120,
  targetSampleRate: 22050
})

// Available TTS models
const MODELS: TTSModel[] = [
  {
    name: 'Piper TTS',
    size: 75, // 75MB
    // Actual voices are loaded from voices.json at init time
    voices: [],
    requiresWebGPU: false,
    url: '/tts-model/en_US-libritts_r-medium.onnx'
  }
]

export const useTTS = () => {
  // Make TTS store globally available for audio utilities
  if (typeof window !== 'undefined') {
    ;(window as any).__tts_store = { state }
  }
  
  // WebAudio handles to control local model playback (shared singleton)
  // These are module-scoped singletons to ensure all useTTS() callers share the same worker/context.
  // Without this, different components calling useTTS() would have isolated workers.
  ;(globalThis as any).__tts_audioCtx ||= null as AudioContext | null
  ;(globalThis as any).__tts_activeStop ||= null as (() => void) | null
  ;(globalThis as any).__tts_stopRequested ||= false as boolean
  ;(globalThis as any).__piper_worker ||= null as Worker | null
  ;(globalThis as any).__piper_initialized ||= false as boolean
  ;(globalThis as any).__piper_voiceNameToId ||= null as Record<string, number> | null
  ;(globalThis as any).__piper_voiceList ||= null as string[] | null
  ;(globalThis as any).__piper_pauseFn ||= null as (() => void) | null
  ;(globalThis as any).__piper_resumeFn ||= null as (() => void) | null
  ;(globalThis as any).__piper_isPaused ||= false as boolean
  ;(globalThis as any).__tts_autoload_done ||= false as boolean

  const getAudioCtx = () => (globalThis as any).__tts_audioCtx as AudioContext | null
  const setAudioCtx = (ctx: AudioContext | null) => { (globalThis as any).__tts_audioCtx = ctx }
  const getActiveStop = () => (globalThis as any).__tts_activeStop as (() => void) | null
  const setActiveStop = (fn: (() => void) | null) => { (globalThis as any).__tts_activeStop = fn }
  const getStopRequested = () => (globalThis as any).__tts_stopRequested as boolean
  const setStopRequested = (v: boolean) => { (globalThis as any).__tts_stopRequested = v }
  const getPiperWorker = () => (globalThis as any).__piper_worker as Worker | null
  const setPiperWorker = (w: Worker | null) => { (globalThis as any).__piper_worker = w }
  const isPiperInitialized = () => (globalThis as any).__piper_initialized as boolean
  const setPiperInitialized = (v: boolean) => { (globalThis as any).__piper_initialized = v }
  const getPiperVoiceMap = () => (globalThis as any).__piper_voiceNameToId as Record<string, number> | null
  const setPiperVoiceMap = (m: Record<string, number> | null) => { (globalThis as any).__piper_voiceNameToId = m }
  const getPiperVoices = () => (globalThis as any).__piper_voiceList as string[] | null
  const setPiperVoices = (arr: string[] | null) => { (globalThis as any).__piper_voiceList = arr }
  const getPiperPauseFn = () => (globalThis as any).__piper_pauseFn as (() => void) | null
  const setPiperPauseFn = (fn: (() => void) | null) => { (globalThis as any).__piper_pauseFn = fn }
  const getPiperResumeFn = () => (globalThis as any).__piper_resumeFn as (() => void) | null
  const setPiperResumeFn = (fn: (() => void) | null) => { (globalThis as any).__piper_resumeFn = fn }
  const getPiperIsPaused = () => (globalThis as any).__piper_isPaused as boolean
  const setPiperIsPaused = (v: boolean) => { (globalThis as any).__piper_isPaused = v }
  
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
        setState(prev => {
          const next = { ...prev, systemVoices: names }
          // If using browser engine and current voice is not in list, pick first available
          if (prev.engine === 'browser' && names.length > 0 && !names.includes(prev.voice)) {
            next.voice = names[0]
          }
          return next
        })
      }
    } catch {
      // ignore
    }
  }
  
  // Exposed primer that tries harder: poke synthesis with a silent utterance and wait longer
  const primeSystemVoices = async (timeoutMs = 5000) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false
    // If already present, just refresh and return
    refreshSystemVoices()
    if ((state().systemVoices?.length || 0) > 0) return true

    let resolved = false
    const onVoices = () => {
      if (!resolved) {
        refreshSystemVoices()
        resolved = (state().systemVoices?.length || 0) > 0
      }
    }
    try { (speechSynthesis as any).onvoiceschanged = onVoices } catch {}
    try { speechSynthesis.addEventListener?.('voiceschanged', onVoices as any) } catch {}
    // Kick the engine: speak a near-empty utterance at volume 0
    try {
      const u = new SpeechSynthesisUtterance('.')
      u.volume = 0
      u.rate = 1
      u.pitch = 1
      u.onend = () => { /* noop */ }
      speechSynthesis.speak(u)
      // Cancel quickly; goal is initialization
      setTimeout(() => { try { speechSynthesis.cancel() } catch {} }, 60)
    } catch {}
    // Also cancel any existing queue to avoid piling up
    try { speechSynthesis.cancel() } catch {}

    const start = Date.now()
    while ((state().systemVoices?.length || 0) === 0 && Date.now() - start < timeoutMs) {
      await new Promise(res => setTimeout(res, 120))
      refreshSystemVoices()
      if ((state().systemVoices?.length || 0) > 0) break
    }
    // Cleanup listeners
    try { (speechSynthesis as any).onvoiceschanged = null } catch {}
    try { speechSynthesis.removeEventListener?.('voiceschanged', onVoices as any) } catch {}

    return (state().systemVoices?.length || 0) > 0
  }
  
  const ensureSystemVoices = async () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    // Initial refresh
    refreshSystemVoices()
    // Attach both IDL and event listener forms for broad compatibility
    const onVoicesChanged = () => refreshSystemVoices()
    try { (window.speechSynthesis as any).onvoiceschanged = onVoicesChanged } catch {}
    try { window.speechSynthesis.addEventListener?.('voiceschanged', onVoicesChanged as any) } catch {}
    // Poll a few times as a fallback to late-loading voices
    let tries = 0
    while ((state().systemVoices?.length || 0) === 0 && tries < 25) {
      await new Promise(res => setTimeout(res, 120))
      refreshSystemVoices()
      tries++
    }
    // Note: avoid using onCleanup here; this store may be imported outside a Solid root.
    // We rely on one-time listeners for the app lifetime to prevent Solid warnings.
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    ensureSystemVoices()
  }
  
  // Phonemizer preference setters
  const setPhonemizer = async (mode: 'auto' | 'espeak' | 'text') => {
    setState(prev => ({ ...prev, phonemizer: mode }))
    try { await setPref('tts.phonemizer', mode) } catch {}
  }
  const setEspeakTimeoutMs = (ms: number) => {
    setState(prev => ({ ...prev, espeakTimeoutMs: Math.max(500, Math.min(ms || 0, 10000)) }))
  }

  // --- Piper TTS Integration ---
  const initPiperTTS = async () => {
    if (isPiperInitialized()) return
    
    try {
      // Initialize Piper worker
      let piperWorker = getPiperWorker()
      if (!piperWorker) {
        piperWorker = new Worker(new URL('../tts/tts.worker.ts', import.meta.url), { type: 'module' })
        setPiperWorker(piperWorker)
      }
      
      // Wait for worker to be ready
      await new Promise<void>((resolve, reject) => {
        if (!piperWorker) return reject(new Error('Worker not created'))
        
        const onMessage = (e: MessageEvent) => {
          if (e.data.status === 'ready') {
            piperWorker?.removeEventListener('message', onMessage)
            resolve()
          } else if (e.data.status === 'error') {
            piperWorker?.removeEventListener('message', onMessage)
            reject(new Error(e.data.data))
          }
        }
        
        piperWorker.addEventListener('message', onMessage)
        piperWorker.postMessage({
          type: 'init',
          modelURL: '/tts-model/en_US-libritts_r-medium.onnx',
          cfgURL: '/tts-model/en_US-libritts_r-medium.onnx.json'
        })
      })
      // Load voices list from voices.json (preferred) or model cfg as fallback
      try {
        let voiceList: string[] | null = null
        let voiceMap: Record<string, number> | null = null
        try {
          const res = await fetch('/tts-model/voices.json')
          if (res.ok) {
            const json = await res.json()
            const key = 'en_US-libritts_r-medium'
            const entry = json?.[key]
            const idMap = (entry && entry.speaker_id_map) || null
            if (idMap && typeof idMap === 'object') {
              const entries = Object.entries(idMap as Record<string, number>)
              // sort by numeric id asc
              entries.sort((a, b) => (a[1] - b[1]))
              voiceList = entries.map(([label]) => label)
              voiceMap = Object.fromEntries(entries)
            }
          }
        } catch {}
        // Fallback: load cfg directly
        if (!voiceList || !voiceMap) {
          try {
            const res2 = await fetch('/tts-model/en_US-libritts_r-medium.onnx.json')
            if (res2.ok) {
              const cfg = await res2.json()
              const idMap = cfg?.speaker_id_map
              if (idMap && typeof idMap === 'object') {
                const entries = Object.entries(idMap as Record<string, number>)
                entries.sort((a, b) => (a[1] - b[1]))
                voiceList = entries.map(([label]) => label)
                voiceMap = Object.fromEntries(entries)
              } else {
                // Single speaker model
                voiceList = ['default']
                voiceMap = { default: 0 }
              }
            }
          } catch {}
        }
        // Persist in singletons for later lookup
        if (voiceList && voiceMap) {
          setPiperVoices(voiceList)
          setPiperVoiceMap(voiceMap)
        }
      } catch {}

      setPiperInitialized(true)
      setState(prev => ({ ...prev, lastError: null }))
    } catch (error) {
      setState(prev => ({ ...prev, lastError: (error as Error)?.message || 'Failed to initialize Piper TTS' }))
      throw error
    }
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

      // Special handling for Piper TTS
      if (model.name === 'Piper TTS') {
        await initPiperTTS()
        // Prepare voices from loaded metadata
        const loadedVoices = getPiperVoices() || []
        const selectedVoice = loadedVoices.length > 0
          ? (loadedVoices.includes(state().voice) ? state().voice : loadedVoices[0])
          : (state().voice || 'default')
        const piperModel: TTSModel = { ...model, voices: loadedVoices }
        setState(prev => ({
          ...prev,
          model: piperModel,
          engine: 'local',
          isModelLoading: false,
          lastError: null,
          voice: selectedVoice
        }))
        // Persist successful selection
        try { await setPref('tts.selected', { engine: 'local', model: model.name }) } catch {}
        return
      }

      // Load ORT build for WASM/WebGPU (for Kokoro)
      const ort = await import('onnxruntime-web') as any
      // Configure ORT asset paths and features; enable threads/SIMD only when COI is granted
      if (ort?.env?.wasm) {
        // IMPORTANT: Avoid pointing to /public assets in Vite dev.
        // Vite forbids importing ESM from /public during dev; only set external paths in production builds.
        const isProd = (typeof import.meta !== 'undefined') && (import.meta as any)?.env?.PROD
        if (isProd) {
          ort.env.wasm.wasmPaths = '/ort/'
        }
        const coi = (globalThis as any).crossOriginIsolated === true
        ort.env.wasm.numThreads = coi ? (navigator.hardwareConcurrency || 4) : 1
        ort.env.wasm.simd = !!coi
      }
      // Force CPU/WASM for non-WebGPU models
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
      // Persist successful selection
      try { await setPref('tts.selected', { engine: 'local', model: model.name }) } catch {}
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

  const chunkTextForTTS = (text: string): { chunks: string[]; meta: { idx: number; startChar: number; endChar: number }[] } => {
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
        // If we've reached the end of the buffer, stop to avoid overlap underflow
        if (end >= buffer.length) break
        // Ensure forward progress even when slice.length <= overlap
        const effectiveOverlap = Math.min(overlap, Math.max(0, slice.length - 1))
        start += (slice.length - effectiveOverlap)
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
  const waitForSystemVoices = async (timeoutMs = 4000) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const have = speechSynthesis.getVoices()
    if (have && have.length > 0) return
    await new Promise<void>((resolve) => {
      let done = false
      const onVoices = () => { if (!done) { done = true; resolve() } }
      try { (speechSynthesis as any).onvoiceschanged = onVoices } catch {}
      try { speechSynthesis.addEventListener?.('voiceschanged', onVoices as any) } catch {}
      const t = setTimeout(() => { if (!done) { done = true; resolve() } }, timeoutMs)
      // Also poke the synthesis queue to encourage voice init in some browsers
      try { speechSynthesis.cancel() } catch {}
      // Fallback polling in case event never fires
      let tries = 0
      const poll = setInterval(() => {
        const vs = speechSynthesis.getVoices()
        if (vs && vs.length > 0) {
          clearInterval(poll)
          onVoices()
        } else if (++tries > Math.ceil(timeoutMs / 120)) {
          clearInterval(poll)
        }
      }, 120)
      // Cleanup once resolved
      const cleanup = () => {
        try { (speechSynthesis as any).onvoiceschanged = null } catch {}
        try { speechSynthesis.removeEventListener?.('voiceschanged', onVoices as any) } catch {}
        clearTimeout(t)
      }
      // Ensure cleanup after resolve
      Promise.resolve().then(() => cleanup())
    })
  }

  const speakChunksWithBrowserTTS = async (chunks: string[]) => {
    const { interChunkPauseMs } = state()
    return new Promise<void>((resolve, reject) => {
      const voices = speechSynthesis.getVoices()
      const requested = state().voice?.toLowerCase?.() || ''
      const selected = voices.find(v => v.name.toLowerCase().includes(requested)) || voices[0] || null
      let okCount = 0
      let errCount = 0
      let i = 0
      const next = () => {
        if (i >= chunks.length) {
          if (okCount === 0 && errCount > 0) {
            reject(new Error('Browser TTS failed to synthesize speech'))
          } else {
            resolve()
          }
          return
        }
        const text = chunks[i]
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.rate = state().rate
        utterance.pitch = state().pitch
        utterance.voice = selected
        if (!utterance.lang && selected?.lang) utterance.lang = selected.lang
        const chunkIdx = i
        const vName = selected?.name || state().voice || 'unknown'
        console.log(`[TTS] speak chunk ${chunkIdx + 1}/${chunks.length} (len=${text.length}) voice=${vName} rate=${utterance.rate} pitch=${utterance.pitch} sr=n/a`)
        utterance.onstart = () => {
          // Consider this chunk successful once speech starts
        }
        utterance.onend = () => {
          okCount += 1
          i += 1
          if (interChunkPauseMs && interChunkPauseMs > 0) {
            setTimeout(next, interChunkPauseMs)
          } else {
            next()
          }
        }
        utterance.onerror = (ev) => {
          console.warn('[TTS] chunk error', ev.error)
          errCount += 1
          i += 1
          next()
        }
        speechSynthesis.speak(utterance)
      }
      next()
    })
  }

  const selectBrowserEngine = () => {
    // Switch to browser SpeechSynthesis engine (unsafe: does not validate voices)
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

  // Validates that browser SpeechSynthesis has voices before enabling
  const ensureBrowserEngine = async (): Promise<boolean> => {
    try {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setState(prev => ({ ...prev, lastError: 'SpeechSynthesis unavailable in this browser' }))
        return false
      }
      // Try to load/prime voices
      await primeSystemVoices(6000)
      refreshSystemVoices()
      const names = state().systemVoices || []
      if (!names || names.length === 0) {
        setState(prev => ({
          ...prev,
          lastError: 'No SpeechSynthesis voices available. Install a system speech backend.'
        }))
        return false
      }
      // Enable browser engine with a valid default voice
      setState(prev => ({
        ...prev,
        engine: 'browser',
        model: null,
        session: undefined,
        isModelLoading: false,
        lastError: null,
        voice: names.includes(prev.voice) ? prev.voice : names[0]
      }))
      // Persist successful selection
      try { await setPref('tts.selected', { engine: 'browser', model: 'browser' }) } catch {}
      return true
    } catch (e) {
      setState(prev => ({ ...prev, lastError: (e as Error)?.message || 'Failed to enable Browser TTS' }))
      return false
    }
  }


  // Attempt to auto-load previously selected engine/model on first use
  ;(async () => {
    try {
      const done = (globalThis as any).__tts_autoload_done as boolean
      if (done) return
      ;(globalThis as any).__tts_autoload_done = true
      
      // On iOS, always use browser SpeechSynthesis
      if (isIOSDevice()) {
        await ensureBrowserEngine()
        return
      }
      
      const pref = await getPref<any>('tts.selected')
      const ph = await getPref<'auto' | 'espeak' | 'text'>('tts.phonemizer')
      if (ph) setState(prev => ({ ...prev, phonemizer: ph }))
      if (!pref) return
      if (pref.engine === 'browser') {
        await ensureBrowserEngine()
      } else if (pref.engine === 'local' && typeof pref.model === 'string' && pref.model) {
        // Only auto-load if compatible; loadModel will validate
        await loadModel(pref.model)
      }
    } catch {
      // ignore auto-load failures; user can select manually
    }
  })()

  const speakWithPiperTTS = async (text: string) => {
    console.log('[TTS] Starting Piper TTS synthesis for text:', text.substring(0, 50) + (text.length > 50 ? '...' : ''))
    
    const piperWorker = getPiperWorker()
    if (!piperWorker || !isPiperInitialized()) {
      throw new Error('Piper TTS not initialized')
    }

    const cleaned = cleanForTTS(text)
    console.log('[TTS] Text cleaned, length:', cleaned.length)
    
    // Sequential playback queue to avoid overlapping streamed chunks
    return new Promise<void>((resolve, reject) => {
      if (!piperWorker) return reject(new Error('Piper worker not initialized'))

      const queue: { url?: string; f32?: Float32Array; sr?: number }[] = []
      let playing = false
      let done = false
      let currentAudio: HTMLAudioElement | null = null
      let currentHandle: { stop: () => void } | null = null
      
      // Ensure a single AudioContext exists and is resumed
      let audioCtx = getAudioCtx()
      audioCtx = ensureAudioContext(audioCtx)
      setAudioCtx(audioCtx)

      const cleanup = () => {
        try { piperWorker.removeEventListener('message', onMessage as any) } catch {}
        try { if (currentAudio) { currentAudio.onended = null as any; currentAudio.onerror = null as any; currentAudio.pause() } } catch {}
        try { if (currentHandle) { currentHandle.stop() } } catch {}
        currentAudio = null
        currentHandle = null
        while (queue.length > 0) {
          const u = queue.shift()!
          try { if (u.url) URL.revokeObjectURL(u.url) } catch {}
        }
        setActiveStop(null)
        setPiperPauseFn(null)
        setPiperResumeFn(null)
        setPiperIsPaused(false)
      }

      const tryResolve = () => {
        if (done && !playing && queue.length === 0) {
          cleanup()
          resolve()
        }
      }

      const startNext = async () => {
        if (getPiperIsPaused()) return
        if (getStopRequested()) { cleanup(); return resolve() }
        if (playing) return
        const item = queue.shift()
        if (!item) return tryResolve()
        playing = true
        
        if (item.f32 && item.sr && audioCtx) {
          // Play via WebAudio buffer
          const f32 = item.f32
          const sr = item.sr
          const playbackRate = Math.max(0.5, Math.min(state().rate || 1.0, 2.0))
          
          console.log('[TTS] Playing WebAudio chunk - samples:', f32.length, 'sampleRate:', sr)
          
          ;(async () => {
            try {
              const handle = await playPCM(f32, sr, { 
                audioContext: audioCtx!, 
                playbackRate,
                onEnded: () => {
                  console.log('[TTS] WebAudio chunk playback completed')
                }
              })
              
              console.log('[TTS] WebAudio handle created successfully')
              
              currentHandle = handle
              setActiveStop(() => { 
                try { handle.stop() } catch {} 
              })
              
              // Pause/resume controls via AudioContext
              setPiperPauseFn(() => { 
                setPiperIsPaused(true)
                try { audioCtx!.suspend() } catch {} 
              })
              
              setPiperResumeFn(() => { 
                setPiperIsPaused(false)
                try { audioCtx!.resume() } catch {} 
              })
              
              // Schedule next after duration
              const seconds = (f32.length / sr) / playbackRate
              console.log('[TTS] Scheduled next chunk in', seconds.toFixed(2), 'seconds')
              
              setTimeout(() => {
                console.log('[TTS] WebAudio chunk finished, scheduling next')
                playing = false
                currentHandle = null
                
                const pause = Math.max(0, state().interChunkPauseMs || 0)
                if (pause > 0) {
                  setTimeout(() => startNext(), pause)
                } else {
                  startNext()
                }
              }, Math.max(0, seconds * 1000))
              
            } catch (err) {
              console.error('[TTS] WebAudio Piper chunk error:', err)
              playing = false
              currentHandle = null
              setTimeout(() => startNext(), 100)
            }
          })()
        } else {
          // Fallback: HTMLAudio with WAV blob URL
          const url = item.url!
          const audio = new Audio(url)
          
          currentAudio = audio
          setActiveStop(() => {
            try { audio.pause() } catch {}
            try { audio.currentTime = audio.duration || 0 } catch {}
            try { URL.revokeObjectURL(url) } catch {}
          })
          
          setPiperPauseFn(() => {
            setPiperIsPaused(true)
            try { audio.pause() } catch {}
          })
          
          setPiperResumeFn(() => {
            setPiperIsPaused(false)
            try {
              if (currentAudio) {
                currentAudio.play().catch(() => {})
              } else if (!playing) {
                startNext()
              }
            } catch {}
          })
          
          audio.onended = () => {
            try { URL.revokeObjectURL(url) } catch {}
            playing = false
            currentAudio = null
            const pause = Math.max(0, state().interChunkPauseMs || 0)
            if (pause > 0) setTimeout(() => startNext(), pause)
            else startNext()
          }
          
          audio.onerror = () => {
            console.warn('[TTS] Piper chunk playback error', audio.error)
            try { URL.revokeObjectURL(url) } catch {}
            playing = false
            currentAudio = null
            startNext()
          }
          
          audio.play().catch(() => {
            setTimeout(() => startNext(), 100)
          })
        }
      }

      const onMessage = (e: MessageEvent<any>) => {
        if (getStopRequested()) { cleanup(); return resolve() }
        const d = e.data
        if (!d || !d.status) return
        
        if (d.status === 'stream') {
          try {
            // Prefer WebAudio path when Float32 is provided
            if (d.chunk?.f32 && d.chunk?.sr) {
              const f32 = new Float32Array(d.chunk.f32)
              console.log('[TTS] Enqueued WebAudio chunk - samples:', f32.length, 'sampleRate:', d.chunk.sr)
              queue.push({ f32, sr: d.chunk.sr })
            } else {
              const url = URL.createObjectURL(d.chunk.audio)
              console.log('[TTS] Enqueued HTMLAudio chunk')
              queue.push({ url })
            }
            
            if (!playing) {
              startNext()
            }
          } catch (err) {
            console.error('[TTS] Failed to enqueue Piper chunk:', err)
          }
        } else if (d.status === 'complete') {
          console.log('[TTS] Worker reported generation complete')
          done = true
          tryResolve()
        } else if (d.status === 'error') {
          console.error('[TTS] Worker reported error:', d.data)
          cleanup()
          reject(new Error(String(d.data || 'Piper TTS error')))
        }
      }

      // Resolve speakerId from selected voice using voices.json map; fallback to 0
      const m = getPiperVoiceMap() || {}
      const vName = (state().voice || '').trim()
      let speakerId = 0
      if (typeof m[vName] === 'number') {
        speakerId = m[vName]!
      } else {
        const match = vName.match(/voice\s+(\d+)/i)
        if (match) {
          const n = parseInt(match[1] || '1', 10)
          if (!Number.isNaN(n) && n > 0) speakerId = n - 1
        }
      }
      
      piperWorker.addEventListener('message', onMessage as any)
      
      const phonemeType = state().phonemizer === 'auto' ? undefined : state().phonemizer
      const synthesisRequest = {
        type: 'generate',
        text: cleaned,
        speakerId,
        speed: state().rate,
        phonemeType,
        espeakTimeoutMs: state().espeakTimeoutMs
      }
      
      console.log('[TTS] Sending synthesis request to worker')
      piperWorker.postMessage(synthesisRequest)
    })
  }

  
  const speak = async (text: string) => {
    // Clear any queued/busy utterances to prevent piling up
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { speechSynthesis.cancel() } catch {}
    }
    setState(prev => ({ ...prev, isPlaying: true, isPaused: false }))
    setStopRequested(false)
    
    try {
      // Simple platform detection: iOS uses SpeechSynthesis, others use Piper TTS
      if (isIOSDevice()) {
        console.log('[TTS] iOS detected, using SpeechSynthesis')
        await speakWithBrowserTTS(text)
      } else {
        console.log('[TTS] Non-iOS device detected, using Piper TTS')
        await speakWithPiperTTS(text)
      }
      
      setState(prev => ({ ...prev, isPlaying: false, isPaused: false }))
    } catch (error) {
      setState(prev => ({ ...prev, isPlaying: false, lastError: (error as Error)?.message || 'TTS error' }))
      throw error
    }
  }

  const speakWithBrowserTTS = async (text: string) => {
    console.log('[TTS] Starting SpeechSynthesis for text:', text.substring(0, 50) + (text.length > 50 ? '...' : ''))
    
    if (!('speechSynthesis' in window)) {
      throw new Error('SpeechSynthesis not available on this platform')
    }
    
    // Ensure voices are initialized
    await waitForSystemVoices()
    
    const { chunks } = chunkTextForTTS(text)
    await speakChunksWithBrowserTTS(chunks)
    
    console.log('[TTS] SpeechSynthesis completed')
  }
  
  const stop = () => {
    setStopRequested(true)
    setState(prev => ({ ...prev, isPlaying: false, isPaused: false }))
    const activeStop = getActiveStop()
    try { if (activeStop) activeStop() } catch {}
    setActiveStop(null)
    // Reset Piper pause controls
    try { const p = getPiperPauseFn(); if (p) p() } catch {}
    setPiperPauseFn(null)
    setPiperResumeFn(null)
    setPiperIsPaused(false)
    if ('speechSynthesis' in window) {
      try { speechSynthesis.cancel() } catch {}
    }
    // Try to close audio context gracefully
    const audioCtx = getAudioCtx()
    try { closeAudio(audioCtx) } catch {}
    setAudioCtx(null)
  }

  const pause = () => {
    let paused = false
    // Piper path: pause HTMLAudio playback via exposed control
    if (state().model?.name === 'Piper TTS' && state().engine === 'local') {
      const pf = getPiperPauseFn()
      if (pf) { try { pf() } catch {} }
      paused = true
    }
    if ('speechSynthesis' in window) {
      try { speechSynthesis.pause(); paused = true } catch {}
    }
    {
      const audioCtx = getAudioCtx()
      if (audioCtx) suspendAudio(audioCtx).then(() => {}).catch(() => {})
      paused = true
    }
    if (paused) setState(prev => ({ ...prev, isPaused: true }))
  }

  const resume = () => {
    let resumed = false
    // Piper path: resume HTMLAudio playback via exposed control
    if (state().model?.name === 'Piper TTS' && state().engine === 'local') {
      const rf = getPiperResumeFn()
      if (rf) { try { rf() } catch {} }
      resumed = true
    }
    if ('speechSynthesis' in window) {
      try { speechSynthesis.resume(); resumed = true } catch {}
    }
    {
      const audioCtx = getAudioCtx()
      if (audioCtx) resumeAudio(audioCtx).then(() => {}).catch(() => {})
      resumed = true
    }
    if (resumed) setState(prev => ({ ...prev, isPaused: false }))
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

  const setTargetSampleRate = (n: number) => {
    const v = Math.max(8000, Math.min(n || 24000, 192000))
    setState(prev => ({ ...prev, targetSampleRate: v }))
  }

  // --- Voice filtering functions for enhanced UI ---
  const getVoiceMetadata = async () => {
    try {
      const response = await fetch('/tts-model/voices.json')
      if (response.ok) {
        const data = await response.json()
        return data['en_US-libritts_r-medium']?.speakers || []
      }
    } catch (error) {
      console.warn('Failed to load voice metadata:', error)
    }
    return []
  }

  const getAvailableTags = async () => {
    const speakers = await getVoiceMetadata()
    const allTags = new Set<string>()
    speakers.forEach((speaker: any) => {
      if (speaker.tags && Array.isArray(speaker.tags)) {
        speaker.tags.forEach((tag: any) => allTags.add(tag))
      }
    })
    return Array.from(allTags).sort()
  }

  const filterVoicesByGender = (speakers: any[], gender: string) => {
    if (!gender || gender === 'all') return speakers
    return speakers.filter((speaker: any) => speaker.gender === gender)
  }

  const filterVoicesByTags = (speakers: any[], selectedTags: string[]) => {
    if (!selectedTags || selectedTags.length === 0) return speakers
    return speakers.filter((speaker: any) => {
      if (!speaker.tags || !Array.isArray(speaker.tags)) return false
      return selectedTags.every((tag: any) => speaker.tags.includes(tag))
    })
  }

  const filterVoicesByPitchRange = (speakers: any[], minPitch: number, maxPitch: number) => {
    return speakers.filter((speaker: any) => {
      if (speaker.pitch_mean === null || speaker.pitch_mean === undefined) return true
      return speaker.pitch_mean >= minPitch && speaker.pitch_mean <= maxPitch
    })
  }

  const filterVoicesByRateRange = (speakers: any[], minRate: number, maxRate: number) => {
    return speakers.filter((speaker: any) => {
      if (speaker.speaking_rate === null || speaker.speaking_rate === undefined) return true
      return speaker.speaking_rate >= minRate && speaker.speaking_rate <= maxRate
    })
  }

  const filterVoicesByBrightnessRange = (speakers: any[], minBrightness: number, maxBrightness: number) => {
    return speakers.filter((speaker: any) => {
      if (speaker.brightness === null || speaker.brightness === undefined) return true
      return speaker.brightness >= minBrightness && speaker.brightness <= maxBrightness
    })
  }

  const getVoiceMetadataById = async (speakerId: string) => {
    const speakers = await getVoiceMetadata()
    return speakers.find((speaker: any) => speaker.speaker_id === speakerId)
  }

    
  return {
    state,
    models: MODELS,
    loadModel,
    setPhonemizer,
    setEspeakTimeoutMs,
    selectBrowserEngine,
    ensureBrowserEngine,
    primeSystemVoices,
    refreshSystemVoices,
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
    setInterChunkPauseMs,
    setTargetSampleRate,
    // Voice filtering functions
    getVoiceMetadata,
    getAvailableTags,
    filterVoicesByGender,
    filterVoicesByTags,
    filterVoicesByPitchRange,
    filterVoicesByRateRange,
    filterVoicesByBrightnessRange,
    getVoiceMetadataById
  }
}
