import { createSignal } from 'solid-js'
import { TTSState, TTSModel } from '@/types'
import { ensureAudioContext, playPCM, suspend as suspendAudio, resume as resumeAudio, close as closeAudio } from '@/utils/audio'
import { cleanForTTS } from '@/tts/textCleaner'
import { getPref, setPref } from '@/utils/idb'
// Note: Piper streaming provides its own chunking; avoid double chunking here

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
  session: undefined,
  systemVoices: [],
  // Chunking/config params (tunable in Settings)
  chunkMaxChars: 280,
  chunkOverlapChars: 24,
  sentenceSplit: true,
  interChunkPauseMs: 120,
  targetSampleRate: 22050
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
    name: 'Piper TTS',
    size: 75, // 75MB
    // Actual voices are loaded from voices.json at init time
    voices: [],
    requiresWebGPU: false,
    url: '/tts-model/en_US-libritts_r-medium.onnx'
  }
]

export const useTTS = () => {
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
      const pref = await getPref<any>('tts.selected')
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
    const piperWorker = getPiperWorker()
    if (!piperWorker || !isPiperInitialized()) {
      throw new Error('Piper TTS not initialized')
    }

    const cleaned = cleanForTTS(text)
    // Sequential playback queue to avoid overlapping streamed chunks
    return new Promise<void>((resolve, reject) => {
      if (!piperWorker) return reject(new Error('Piper worker not initialized'))

      const queue: string[] = []
      let playing = false
      let done = false
      let currentAudio: HTMLAudioElement | null = null

      const cleanup = () => {
        try { piperWorker.removeEventListener('message', onMessage as any) } catch {}
        try { if (currentAudio) { currentAudio.onended = null as any; currentAudio.onerror = null as any; currentAudio.pause() } } catch {}
        currentAudio = null
        while (queue.length > 0) { const u = queue.shift()!; try { URL.revokeObjectURL(u) } catch {} }
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

      const startNext = () => {
        if (getPiperIsPaused()) return
        if (getStopRequested()) { cleanup(); return resolve() }
        if (playing) return
        const url = queue.shift()
        if (!url) return tryResolve()
        playing = true
        const audio = new Audio(url)
        currentAudio = audio
        setActiveStop(() => {
          try { audio.pause() } catch {}
          try { audio.currentTime = audio.duration || 0 } catch {}
          try { URL.revokeObjectURL(url) } catch {}
        })
        // Expose pause/resume controls for Piper playback
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
          console.warn('[TTS] Piper chunk playback error')
          try { URL.revokeObjectURL(url) } catch {}
          playing = false
          currentAudio = null
          startNext()
        }
        audio.play().catch(err => {
          console.warn('[TTS] Failed to play Piper chunk:', err)
          audio.onerror?.(new Event('error') as any)
        })
      }

      const onMessage = (e: MessageEvent<any>) => {
        if (getStopRequested()) { cleanup(); return resolve() }
        const d = e.data
        if (!d || !d.status) return
        if (d.status === 'stream') {
          try {
            const url = URL.createObjectURL(d.chunk.audio)
            queue.push(url)
            if (!playing) startNext()
          } catch (err) {
            console.warn('[TTS] Failed to enqueue Piper chunk:', err)
          }
        } else if (d.status === 'complete') {
          done = true
          tryResolve()
        } else if (d.status === 'error') {
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
      piperWorker.postMessage({
        type: 'generate',
        text: cleaned,
        speakerId,
        speed: state().rate
      })
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
      const current = state()

      // Prepare chunks + logging
      const t0 = performance.now()
      const { chunks, meta } = chunkTextForTTS(text)
      const eng = current.engine
      const modelName = current.model?.name || 'Browser TTS'
      console.log(`[TTS] text length=${text.length}, chunks=${chunks.length}, engine=${eng}, model=${modelName}, voice=${current.voice}, rate=${current.rate.toFixed(2)}, pitch=${current.pitch.toFixed(2)}, targetSr=${current.targetSampleRate}`)
      meta.forEach(m => console.log(`[TTS] chunk #${m.idx + 1} chars=[${m.startChar}, ${m.endChar})`))

      // Path 1: Piper TTS
      if (current.model?.name === 'Piper TTS' && current.engine === 'local') {
        console.log(`[TTS] Speaking with Piper TTS`)
        await speakWithPiperTTS(text)
        const t1 = performance.now()
        console.log(`[TTS] Piper TTS completed in ${(t1 - t0).toFixed(0)}ms`)
        setState(prev => ({ ...prev, isPlaying: false, isPaused: false }))
        return
      }

      // Path 2: Local model (ONNX) for Kokoro
      if (current.model && current.session && current.engine === 'local' && current.model?.name !== 'Piper TTS') {
        console.log(`[TTS] Speaking with model=${current.model.name}, voice=${current.voice}`)
        const ort = await import('onnxruntime-web') as any

        // Ensure an AudioContext exists
        const audioCtx = ensureAudioContext(getAudioCtx())
        setAudioCtx(audioCtx)

        const runChunk = async (chunk: string) => {
          // Generic feeds builder for ONNX models
          const session: any = current.session
          const inMeta = session.inputMetadata || {}
          const inNames: string[] = session.inputNames || Object.keys(inMeta)

          const toCodes = (s: string) => {
            // UTF-8 encode; safer than charCode for non-ASCII
            try {
              const bytes = new TextEncoder().encode(s)
              return Array.from(bytes)
            } catch {
              const codes: number[] = []
              for (let i = 0; i < s.length; i++) codes.push(s.charCodeAt(i) & 0xff)
              return codes
            }
          }

          const makeIntTensor = (dtype: string, arr: number[], dims: number[]) => {
            const dt = (dtype || '').toLowerCase()
            if (dt.includes('64')) {
              const big = new BigInt64Array(arr.map(n => BigInt(n)))
              return new ort.Tensor('int64', big, dims)
            }
            if (dt.includes('32')) return new ort.Tensor('int32', Int32Array.from(arr), dims)
            if (dt.includes('uint8') || dt.includes('ubyte') || dt === 'byte') return new ort.Tensor('uint8', Uint8Array.from(arr), dims)
            // Default to int64 for id-like tensors to avoid ORT int32/int64 mismatch
            const big = new BigInt64Array(arr.map(n => BigInt(n)))
            return new ort.Tensor('int64', big, dims)
          }

          const zeroTensor = (dtypeRaw: string, dims: number[]) => {
            const dtype = (dtypeRaw || '').toLowerCase()
            const norm =
              dtype.includes('int64') ? 'int64' :
              dtype.includes('int32') ? 'int32' :
              dtype.includes('uint8') ? 'uint8' :
              dtype.includes('float16') ? 'float16' :
              dtype.includes('bfloat16') ? 'bfloat16' :
              dtype.includes('float64') || dtype.includes('double') ? 'float64' :
              dtype.includes('float') ? 'float32' :
              dtype.includes('bool') ? 'bool' :
              dtype.includes('string') ? 'string' : 'float32'
            const shape = (dims && dims.length > 0) ? dims.map((d: any) => (typeof d === 'number' && d > 0 ? d : 1)) : [1]
            const size = shape.reduce((a: number, b: number) => a * b, 1)
            switch (norm) {
              case 'int64': return new ort.Tensor('int64', new BigInt64Array(size), shape)
              case 'int32': return new ort.Tensor('int32', new Int32Array(size), shape)
              case 'uint8': return new ort.Tensor('uint8', new Uint8Array(size), shape)
              case 'float64': return new ort.Tensor('float64', new Float64Array(size), shape)
              case 'float16': return new ort.Tensor('float16', new Uint16Array(size), shape)
              case 'bfloat16': return new ort.Tensor('bfloat16', new Uint16Array(size), shape)
              case 'bool': return new ort.Tensor('bool', new Uint8Array(size), shape)
              case 'string': return new ort.Tensor('string', Array(size).fill(''), shape)
              default: return new ort.Tensor('float32', new Float32Array(size), shape)
            }
          }

          const voiceIdFromState = () => {
            const voices = (current.model?.voices || [])
            const idx = Math.max(0, voices.indexOf(current.voice))
            return idx < 0 ? 0 : idx
          }

          // Fill feeds based on common input names
          const feeds: Record<string, any> = {}
          for (const name of inNames) {
            const meta = inMeta[name] || { type: 'tensor(float)' }
            const type = (meta?.type || '').toString()
            const elemType = (type.match(/tensor\(([^)]+)\)/)?.[1]) || type
            const dims = (meta?.dimensions && meta.dimensions.length > 0) ? meta.dimensions.map((d: any) => (typeof d === 'number' ? d : -1)) : []

            if (/text|chars|tokens|input_ids/i.test(name)) {
              // If model expects string tensor input, pass the raw text directly.
              const elem = (elemType || '').toLowerCase()
              if (elem.includes('string')) {
                const shape = (dims.length > 0)
                  ? dims.map((d: number) => (typeof d === 'number' && d > 0 ? d : 1))
                  : [1]
                feeds[name] = new ort.Tensor('string', Array(shape.reduce((a:number,b:number)=>a*b,1)).fill('').map((_,i)=> i===0? chunk : ''), shape)
              } else {
                const codes = toCodes(chunk)
                const shape = (dims.length > 0)
                  ? dims.map((d: number, idx: number) => (d === -1 ? (idx === dims.length - 1 ? codes.length : 1) : d))
                  : [1, codes.length]
                // Prefer int64 unless metadata explicitly asks otherwise
                const wanted = /64/.test(elem) ? 'int64' : (/32|uint8|int8/.test(elem) ? elemType : 'int64')
                feeds[name] = makeIntTensor(wanted, codes, shape)
              }
              continue
            }
            if (/length|len/i.test(name)) {
              // Many TTS graphs expect lengths as int64
              const wanted = /64/.test((elemType || '').toLowerCase()) ? 'int64' : 'int64'
              feeds[name] = makeIntTensor(wanted, [chunk.length], [1])
              continue
            }
            if (/speaker|voice|spk|sid/i.test(name)) {
              const vid = voiceIdFromState()
              // Speaker ids are commonly int64 in ONNX graphs
              const wanted = /64/.test((elemType || '').toLowerCase()) ? 'int64' : 'int64'
              feeds[name] = makeIntTensor(wanted, [vid], [1])
              continue
            }
            if (/style|cond(itioning)?|prompt|emb(edding)?/i.test(name)) {
              // Provide a style/conditioning embedding placeholder. Prefer model-declared dims.
              const rawDims: any[] = (inMeta[name]?.dimensions as any) || []
              let d1 = 1
              let d2 = 256
              if (Array.isArray(rawDims) && rawDims.length > 0) {
                if (rawDims.length >= 2) {
                  d1 = typeof rawDims[0] === 'number' && rawDims[0] > 0 ? rawDims[0] : 1
                  const last = rawDims[1]
                  d2 = typeof last === 'number' && last > 0 ? last : 256
                } else if (rawDims.length === 1) {
                  const only = rawDims[0]
                  const val = typeof only === 'number' && only > 0 ? only : 256
                  d1 = 1; d2 = val
                }
              }
              const dims2 = [d1, d2]
              feeds[name] = zeroTensor(elemType || 'float32', dims2)
              continue
            }
            if (/rate|speed/i.test(name)) {
              // Provide nominal speaking rate; many models ignore this
              const r = Math.max(0.5, Math.min(current.rate || 1.0, 2.0))
              feeds[name] = new ort.Tensor('float32', Float32Array.from([r]), [1])
              continue
            }
            if (/pitch/i.test(name)) {
              const p = Math.max(0.5, Math.min(current.pitch || 1.0, 2.0))
              feeds[name] = new ort.Tensor('float32', Float32Array.from([p]), [1])
              continue
            }
          }

          // Provide default zero tensors for any remaining required inputs (e.g., 'style')
          for (const name of inNames) {
            if (feeds[name]) continue
            const meta = inMeta[name] || {}
            const type = (meta?.type || '').toString()
            const elemType = (type.match(/tensor\(([^)]+)\)/)?.[1]) || type
            // If dimensions are unknown but the input looks like a style/conditioning embedding,
            // provide a rank-2 tensor with a trivial second dim to satisfy expected rank.
            let dims: number[]
            if (meta?.dimensions && meta.dimensions.length > 0) {
              dims = meta.dimensions.map((d: any) => (typeof d === 'number' && d > 0 ? d : 1))
            } else if (/style|cond(itioning)?|prompt|emb(edding)?/i.test(name)) {
              dims = [1, 1]
            } else {
              dims = [1]
            }
            feeds[name] = zeroTensor(elemType, dims)
          }

          const outputs = await session.run(feeds)
          // Attempt to locate waveform tensor and sample rate
          const outNames = Object.keys(outputs)
          let audioName = outNames.find(n => /audio|wave|pcm/i.test(n)) || outNames[0]
          const audioTensor: any = outputs[audioName]
          let data = audioTensor?.data as Float32Array | number[]
          if (!data) throw new Error('Model did not return audio tensor')
          let pcm = data instanceof Float32Array ? data : Float32Array.from(data)
          // Flatten if 2D [1, T] or [T, 1]
          if ((audioTensor?.dims?.length || 0) > 1) {
            const flat = new Float32Array(audioTensor.data.length)
            flat.set(audioTensor.data as any)
            pcm = flat
          }
          // Sample rate extraction
          let sr = current.targetSampleRate || 24000
          const srName = outNames.find(n => /(sample|sampling).*rate|^sr$/i.test(n))
          if (srName) {
            const srT: any = outputs[srName]
            const v = Array.isArray(srT?.data) ? (srT.data[0]) : (srT?.data ? (srT.data as any)[0] : null)
            const num = typeof v === 'bigint' ? Number(v) : Number(v)
            if (!Number.isNaN(num) && num > 8000 && num < 192000) sr = num
          }

          // Play the audio chunk
          if (getStopRequested()) return
          const handle = await playPCM(pcm, sr, {
            audioContext: audioCtx!,
            playbackRate: Math.max(0.5, Math.min(current.rate || 1.0, 2.0)),
            onEnded: () => { /* handled by sequencing below */ }
          })
          setActiveStop(handle.stop)
          // Wait for buffer duration approximately before proceeding
          const seconds = (pcm.length / sr) / (Math.max(0.5, Math.min(current.rate || 1.0, 2.0)))
          console.log(`[TTS] synthesized chunk: voice=${current.voice}, sr=${sr}, samples=${pcm.length}, durSec=${seconds.toFixed(2)}`)
          await new Promise(res => setTimeout(res, Math.max(0, seconds * 1000)))
        }

        // Sequentially synthesize and play each chunk
        for (let i = 0; i < chunks.length; i++) {
          if (getStopRequested()) break
          await runChunk(chunks[i])
          if (getStopRequested()) break
          const pause = current.interChunkPauseMs || 0
          if (pause > 0) await new Promise(res => setTimeout(res, pause))
        }

        if (!getStopRequested()) {
          const t1 = performance.now()
          console.log(`[TTS] all chunks synthesized in ${(t1 - t0).toFixed(0)}ms`)
        }
        setState(prev => ({ ...prev, isPlaying: false, isPaused: false }))
        return
      }

      // Path 3: Browser TTS (chunked) if available
      if ('speechSynthesis' in window) {
        // Ensure voices are initialized before selecting; prime if needed
        await primeSystemVoices().catch(() => {})
        await waitForSystemVoices()
        const vs = speechSynthesis.getVoices()
        if (!vs || vs.length === 0) {
          throw new Error('No SpeechSynthesis voices available on this platform')
        }
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
  
  return {
    state,
    models: MODELS,
    loadModel,
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
    setTargetSampleRate
  }
}
