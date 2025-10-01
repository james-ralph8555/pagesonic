import { createSignal } from 'solid-js'
import { TTSState, TTSModel } from '@/types'
import { ensureAudioContext, playPCM, suspend as suspendAudio, resume as resumeAudio, close as closeAudio, generateTestTone, playPCMDebug } from '@/utils/audio'
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
  ;(globalThis as any).__is_ios ||= /iPad|iPhone|iPod/.test(navigator.userAgent) as boolean
  ;(globalThis as any).__audio_unlocked_ios ||= false as boolean
  ;(globalThis as any).__audio_context_unlock_attempted_ios ||= false as boolean
  ;(globalThis as any).__ios_debug_log ||= [] as string[]
  ;(globalThis as any).__last_audio_error ||= null as string | null
  const isiOS = (globalThis as any).__is_ios as boolean
  const getAudioUnlocked = () => (globalThis as any).__audio_unlocked_ios as boolean
  const setAudioUnlocked = (v: boolean) => { (globalThis as any).__audio_unlocked_ios = v }
  const getDebugLog = () => (globalThis as any).__ios_debug_log as string[]
  const addToDebugLog = (message: string) => {
    const log = getDebugLog()
    log.push(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${message}`)
    // Keep only last 50 entries
    if (log.length > 50) log.shift()
  }
  const setLastError = (error: string | null) => { (globalThis as any).__last_audio_error = error }

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
      // Gate WebGPU off on iOS regardless of adapter availability
      if (isiOS) {
        setState(prev => ({ ...prev, isWebGPUSupported: false }))
        return
      }
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
  
  // iOS audio context unlock functions
  const unlockAudioContextIOS = async () => {
    if (!isiOS) {
      addToDebugLog('unlockAudioContextIOS called on non-iOS device')
      return true
    }
    
    if (getAudioUnlocked()) {
      addToDebugLog('Audio already unlocked')
      return true
    }
    
    addToDebugLog('Starting audio unlock attempt')
    setLastError(null)
    
    let audioCtx = getAudioCtx()
    if (!audioCtx) {
      addToDebugLog('Creating new AudioContext')
      audioCtx = ensureAudioContext(null)
      setAudioCtx(audioCtx)
    }
    
    try {
      // Ensure context is in a proper state
      addToDebugLog(`AudioContext state: ${audioCtx.state}`)
      if (audioCtx.state === 'closed') {
        addToDebugLog('Creating new AudioContext (previous was closed)')
        audioCtx = ensureAudioContext(null)
        setAudioCtx(audioCtx)
        addToDebugLog(`New AudioContext state: ${audioCtx.state}`)
      }
      
      // Resume the context if suspended
      if (audioCtx.state === 'suspended') {
        addToDebugLog('Resuming suspended AudioContext')
        await audioCtx.resume()
        // Give it a moment to take effect
        await new Promise(resolve => setTimeout(resolve, 100))
        addToDebugLog(`AudioContext state after resume: ${audioCtx.state}`)
      }
      
      // Create and play a silent buffer to unlock audio
      addToDebugLog('Creating and playing silent buffer')
      const silentBuffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate)
      const silentSource = audioCtx.createBufferSource()
      silentSource.buffer = silentBuffer
      silentSource.connect(audioCtx.destination)
      
      // Play silent sound
      silentSource.start(0)
      
      // Wait a moment for the buffer to actually play
      await new Promise(resolve => setTimeout(resolve, 50))
      
      // Verify the context is running
      const finalState = audioCtx.state
      addToDebugLog(`Final AudioContext state: ${finalState}`)
      if (finalState === 'running') {
        setAudioUnlocked(true)
        addToDebugLog('✅ Audio context unlocked successfully')
        console.log('[TTS] iOS audio context unlocked successfully (state: running)')
        return true
      } else {
        const errorMsg = `Audio context state after unlock: ${finalState}`
        addToDebugLog(`❌ ${errorMsg}`)
        console.warn('[TTS] iOS audio context state after unlock attempt:', finalState)
        setLastError(errorMsg)
        return false
      }
    } catch (error) {
      const errorMsg = `Failed to unlock audio context: ${error}`
      addToDebugLog(`❌ ${errorMsg}`)
      console.warn('[TTS] Failed to unlock iOS audio context:', error)
      setLastError(errorMsg)
      return false
    }
  }
  
  const setupIOSAudioUnlock = () => {
    if (!isiOS) return
    
    const unlockOnInteraction = async () => {
      if (getAudioUnlocked()) return
      
      try {
        const success = await unlockAudioContextIOS()
        if (success) {
          console.log('[TTS] iOS audio unlocked successfully via user interaction')
          // Remove listeners after successful unlock
          document.removeEventListener('touchstart', unlockOnInteraction)
          document.removeEventListener('touchend', unlockOnInteraction)
          document.removeEventListener('click', unlockOnInteraction)
        } else {
          console.log('[TTS] iOS audio unlock failed, will retry on next interaction')
        }
      } catch (error) {
        console.error('[TTS] Error during iOS audio unlock:', error)
      }
    }
    
    // Set up listeners for user interactions (remove once: true to allow retries)
    document.addEventListener('touchstart', unlockOnInteraction, { passive: true })
    document.addEventListener('touchend', unlockOnInteraction, { passive: true })
    document.addEventListener('click', unlockOnInteraction, { passive: true })
    
    console.log('[TTS] iOS audio unlock listeners configured (retry enabled)')
  }
  
  // Initialize iOS audio unlock on mount
  if (isiOS) {
    setupIOSAudioUnlock()
  }

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
    console.log('[TTS] 🎵 Starting Piper TTS synthesis for text:', text.substring(0, 50) + (text.length > 50 ? '...' : ''))
    addToDebugLog('=== Piper TTS Synthesis Started ===')
    addToDebugLog(`Text length: ${text.length} characters`)
    addToDebugLog(`Selected voice: ${state().voice}`)
    addToDebugLog(`Current rate: ${state().rate}`)
    
    const piperWorker = getPiperWorker()
    if (!piperWorker || !isPiperInitialized()) {
      const errorMsg = `Piper TTS not initialized - worker: ${!!piperWorker}, initialized: ${isPiperInitialized()}`
      console.error('[TTS] ❌', errorMsg)
      addToDebugLog(`❌ ERROR: ${errorMsg}`)
      
      // Add detailed worker state debugging
      if (piperWorker) {
        addToDebugLog(`🔍 Worker details - readyState: ${(piperWorker as any).readyState || 'unknown'}`)
        try {
          // Try to ping the worker to see if it's responsive
          const testMessage = { type: 'ping', timestamp: Date.now() }
          piperWorker.postMessage(testMessage)
          addToDebugLog('📡 Sent ping message to worker to test responsiveness')
        } catch (err) {
          addToDebugLog(`❌ Worker communication test failed: ${err}`)
        }
      }
      
      throw new Error('Piper TTS not initialized')
    }
    
    addToDebugLog('✅ Piper worker and initialization verified')
    addToDebugLog(`🔍 Worker state - readyState: ${(piperWorker as any).readyState || 'unknown'}`)
    
    // Test worker communication before starting synthesis
    try {
      const pingStart = Date.now()
      const pingHandler = (e: MessageEvent) => {
        if (e.data?.type === 'pong') {
          const latency = Date.now() - pingStart
          addToDebugLog(`📡 Worker communication test successful - latency: ${latency}ms`)
          piperWorker.removeEventListener('message', pingHandler)
        }
      }
      piperWorker.addEventListener('message', pingHandler)
      piperWorker.postMessage({ type: 'ping', timestamp: pingStart })
      
      // Remove ping handler after timeout to avoid hanging
      setTimeout(() => {
        piperWorker.removeEventListener('message', pingHandler)
        addToDebugLog('⚠️ Worker ping test timed out')
      }, 1000)
    } catch (err) {
      addToDebugLog(`❌ Worker communication test failed: ${err}`)
    }

    const cleaned = cleanForTTS(text)
    console.log('[TTS] Text cleaned, length:', cleaned.length)
    addToDebugLog(`Text cleaned length: ${cleaned.length}`)
    
    // Ensure iOS audio context is unlocked before proceeding
    if (isiOS) {
      console.log('[TTS] iOS detected, checking audio context unlock...')
      addToDebugLog('🍎 iOS device detected - checking audio unlock')
      const unlocked = await unlockAudioContextIOS()
      console.log('[TTS] iOS audio unlock result:', unlocked)
      addToDebugLog(`iOS audio unlock result: ${unlocked ? '✅ SUCCESS' : '❌ FAILED'}`)
      if (!unlocked) {
        console.warn('[TTS] iOS audio context not unlocked, playback may fail')
        addToDebugLog('⚠️ WARNING: Audio context not unlocked, playback may fail')
      }
    }
    
    // Sequential playback queue to avoid overlapping streamed chunks
    return new Promise<void>((resolve, reject) => {
      if (!piperWorker) return reject(new Error('Piper worker not initialized'))

      // Use WebAudio on iOS to avoid HTMLAudio autoplay quirks
      const useWebAudio = isiOS === true
      addToDebugLog(`🔊 Playback mode: ${useWebAudio ? 'WebAudio' : 'HTMLAudio'} (iOS: ${isiOS})`)
      
      const queue: { url?: string; f32?: Float32Array; sr?: number }[] = []
      let playing = false
      let done = false
      let currentAudio: HTMLAudioElement | null = null
      let currentHandle: { stop: () => void } | null = null
      let chunkCount = 0
      
      // Ensure a single AudioContext exists for WebAudio path and is resumed
      let audioCtx = getAudioCtx()
      if (useWebAudio) {
        addToDebugLog('🎛️ Setting up WebAudio context...')
        audioCtx = ensureAudioContext(audioCtx)
        setAudioCtx(audioCtx)
        addToDebugLog(`AudioContext state: ${audioCtx.state}, sampleRate: ${audioCtx.sampleRate}`)
        
        // On iOS, ensure audio context is running before playback
        if (isiOS && audioCtx.state === 'suspended') {
          console.log('[TTS] Resuming audio context for Piper TTS...')
          addToDebugLog('🍎 Resuming suspended AudioContext for iOS...')
          // Use the async function to handle the resume
          ;(async () => {
            try {
              await audioCtx.resume()
              // Give it a moment to take effect
              await new Promise(resolve => setTimeout(resolve, 100))
              if (audioCtx.state === 'running') {
                console.log('[TTS] Audio context successfully resumed for Piper TTS')
                addToDebugLog('✅ AudioContext successfully resumed')
              } else {
                console.warn('[TTS] Audio context state after resume:', audioCtx.state)
                addToDebugLog(`⚠️ AudioContext state after resume: ${audioCtx.state}`)
              }
            } catch (err) {
              console.warn('[TTS] Failed to resume audio context:', err)
              addToDebugLog(`❌ Failed to resume AudioContext: ${err}`)
            }
          })()
        } else if (isiOS) {
          addToDebugLog(`✅ AudioContext already running: ${audioCtx.state}`)
        }
      }

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
        
        // Simplified iOS audio context management - ensure it's running once
        if (isiOS && audioCtx && audioCtx.state === 'suspended') {
          try {
            addToDebugLog('🍎 Resuming AudioContext before WebAudio playback...')
            await audioCtx.resume()
            // Give iOS a moment to properly transition
            await new Promise(resolve => setTimeout(resolve, 50))
            addToDebugLog(`AudioContext state after resume: ${audioCtx.state}`)
            console.log('[TTS] iOS audio context resumed for playback')
          } catch (err) {
            addToDebugLog(`❌ Failed to resume AudioContext: ${err}`)
            console.warn('[TTS] Failed to resume iOS audio context:', err)
          }
        }
        
        if (useWebAudio && item.f32 && item.sr && audioCtx) {
          // Play via WebAudio buffer
          const f32 = item.f32
          const sr = item.sr
          const playbackRate = Math.max(0.5, Math.min(state().rate || 1.0, 2.0))
          
          console.log('[TTS] 🎵 Playing WebAudio chunk - samples:', f32.length, 'sampleRate:', sr, 'audioCtx.state:', audioCtx.state)
          addToDebugLog(`🎵 Starting WebAudio playback: ${f32.length} samples at ${sr}Hz`)
          addToDebugLog(`🎛️ Playback rate: ${playbackRate}, AudioContext state: ${audioCtx.state}`)
          
          ;(async () => {
            try {
              // Final context state check for iOS
              if (isiOS && audioCtx.state === 'suspended') {
                addToDebugLog('⚠️ AudioContext still suspended, attempting final resume...')
                await audioCtx.resume()
                await new Promise(resolve => setTimeout(resolve, 25))
              }
              
              const handle = await playPCM(f32, sr, { 
                audioContext: audioCtx!, 
                playbackRate,
                onEnded: () => {
                  addToDebugLog('✅ WebAudio chunk playback completed')
                }
              })
              
              console.log('[TTS] ✅ WebAudio handle created successfully')
              addToDebugLog('✅ WebAudio playback handle created')
              
              currentHandle = handle
              setActiveStop(() => { 
                addToDebugLog('⏹️ WebAudio stop requested')
                try { handle.stop() } catch {} 
              })
              
              // Pause/resume controls via AudioContext
              setPiperPauseFn(() => { 
                addToDebugLog('⏸️ WebAudio pause requested')
                setPiperIsPaused(true)
                try { audioCtx!.suspend() } catch {} 
              })
              
              setPiperResumeFn(() => { 
                addToDebugLog('▶️ WebAudio resume requested')
                setPiperIsPaused(false)
                try { audioCtx!.resume() } catch {} 
              })
              
              // Schedule next after duration with better timing accuracy
              const seconds = (f32.length / sr) / playbackRate
              console.log('[TTS] ⏱️ Scheduled next chunk in', seconds.toFixed(2), 'seconds')
              addToDebugLog(`⏱️ Next chunk scheduled in ${seconds.toFixed(2)}s`)
              
              setTimeout(() => {
                console.log('[TTS] WebAudio chunk finished, scheduling next')
                addToDebugLog('✅ WebAudio chunk finished, scheduling next')
                playing = false
                currentHandle = null
                
                const pause = Math.max(0, state().interChunkPauseMs || 0)
                if (pause > 0) {
                  addToDebugLog(`⏸️ Inter-chunk pause: ${pause}ms`)
                  setTimeout(() => startNext(), pause)
                } else {
                  startNext()
                }
              }, Math.max(0, seconds * 1000))
              
            } catch (err) {
              console.error('[TTS] ❌ WebAudio Piper chunk error:', err)
              addToDebugLog(`❌ WebAudio playback failed: ${err}`)
              playing = false
              currentHandle = null
              
              // On iOS, if WebAudio fails, try HTMLAudio fallback
              if (isiOS) {
                addToDebugLog('🔄 Attempting HTMLAudio fallback after WebAudio failure')
                // Convert WebAudio data to HTMLAudio format and requeue
                queue.unshift({ url: undefined, f32, sr })
              }
              
              setTimeout(() => startNext(), 100)
            }
          })()
        } else {
          // Fallback: HTMLAudio with WAV blob URL (enhanced for iOS)
          const url = item.url!
          const audio = new Audio(url)
          
          // iOS-specific HTMLAudio setup
          if (isiOS) {
            audio.preload = 'auto'
            // Set volume to prevent silent playback issues
            audio.volume = Math.max(0.1, Math.min(1.0, 1.0))
          }
          
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
            console.warn('[TTS] Piper chunk playback error', audio.error)
            try { URL.revokeObjectURL(url) } catch {}
            playing = false
            currentAudio = null
            // On iOS, if HTMLAudio fails, try to fallback to WebAudio if available
            if (isiOS && audioCtx && item.f32 && item.sr) {
              console.log('[TTS] iOS HTMLAudio failed, attempting WebAudio fallback')
              queue.unshift({ f32: item.f32, sr: item.sr })
              setTimeout(() => startNext(), 50)
            } else {
              startNext()
            }
          }
          
          // iOS-specific playback with retry logic
          const playWithRetry = async (retries = 2) => {
            try {
              await audio.play()
            } catch (err: any) {
              console.warn(`[TTS] HTMLAudio play failed (attempt ${3 - retries}):`, err)
              if (retries > 0 && err.name !== 'NotAllowedError') {
                setTimeout(() => playWithRetry(retries - 1), 100)
              } else {
                audio.onerror?.(new Event('error') as any)
              }
            }
          }
          
          if (isiOS) {
            // On iOS, add a small delay before attempting playback
            setTimeout(() => playWithRetry(), 10)
          } else {
            playWithRetry()
          }
        }
      }

      const onMessage = (e: MessageEvent<any>) => {
        if (getStopRequested()) { cleanup(); return resolve() }
        const d = e.data
        if (!d || !d.status) return
        
        chunkCount++
        const statusMsg = d.status === 'stream' ? '(chunk received)' : 
                         d.status === 'complete' ? '(generation complete)' : 
                         d.status === 'error' ? '(error)' : ''
        
        console.log('[TTS] 📨 Worker message #' + chunkCount + ':', d.status, statusMsg)
        addToDebugLog(`📨 Worker message: ${d.status} ${statusMsg}`)
        
        if (d.status === 'stream') {
          try {
            // Prefer WebAudio path when Float32 is provided
            if (useWebAudio && d.chunk?.f32 && d.chunk?.sr) {
              const f32 = new Float32Array(d.chunk.f32)
              console.log('[TTS] 🎵 Enqueued WebAudio chunk - samples:', f32.length, 'sampleRate:', d.chunk.sr)
              addToDebugLog(`🎵 WebAudio chunk enqueued: ${f32.length} samples at ${d.chunk.sr}Hz`)
              
              // Analyze audio data for debugging
              if (f32.length > 0) {
                const maxValue = Math.max(...f32.map(Math.abs))
                const avgValue = f32.reduce((sum, val) => sum + Math.abs(val), 0) / f32.length
                addToDebugLog(`📊 Audio analysis - max: ${maxValue.toFixed(4)}, avg: ${avgValue.toFixed(4)}`)
                if (maxValue < 0.0001) {
                  addToDebugLog('⚠️ WARNING: Audio data appears to be silent or near-silent')
                } else {
                  addToDebugLog('✅ Audio data has signal content')
                }
              } else {
                addToDebugLog('❌ ERROR: Empty audio buffer received')
              }
              
              queue.push({ f32, sr: d.chunk.sr })
            } else {
              const url = URL.createObjectURL(d.chunk.audio)
              console.log('[TTS] 🔊 Enqueued HTMLAudio chunk')
              addToDebugLog('🔊 HTMLAudio chunk enqueued with blob URL')
              queue.push({ url })
            }
            
            addToDebugLog(`📋 Queue size: ${queue.length} chunks`)
            if (!playing) {
              addToDebugLog('▶️ Starting playback (was idle)')
              startNext()
            }
          } catch (err) {
            console.error('[TTS] Failed to enqueue Piper chunk:', err)
            addToDebugLog(`❌ ERROR: Failed to enqueue chunk: ${err}`)
          }
        } else if (d.status === 'complete') {
          console.log('[TTS] ✅ Worker reported generation complete')
          addToDebugLog('✅ Worker synthesis complete')
          done = true
          tryResolve()
        } else if (d.status === 'error') {
          console.error('[TTS] ❌ Worker reported error:', d.data)
          addToDebugLog(`❌ ERROR: Worker synthesis failed: ${d.data}`)
          cleanup()
          reject(new Error(String(d.data || 'Piper TTS error')))
        } else {
          addToDebugLog(`ℹ️ Unknown worker status: ${d.status}`)
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
      
      addToDebugLog(`🎤 Voice mapping: "${vName}" -> speakerId: ${speakerId}`)
      addToDebugLog(`⚙️ Synthesis parameters: speed=${state().rate}, speakerId=${speakerId}`)
      
      piperWorker.addEventListener('message', onMessage as any)
      
      const synthesisRequest = {
        type: 'generate',
        text: cleaned,
        speakerId,
        speed: state().rate
      }
      
      console.log('[TTS] 📤 Sending synthesis request to worker:', synthesisRequest)
      addToDebugLog('📤 Sending synthesis request to Piper worker')
      addToDebugLog(`Request type: ${synthesisRequest.type}`)
      addToDebugLog(`Request text length: ${synthesisRequest.text.length}`)
      addToDebugLog(`Request speakerId: ${synthesisRequest.speakerId}`)
      addToDebugLog(`Request speed: ${synthesisRequest.speed}`)
      
      piperWorker.postMessage(synthesisRequest)
      addToDebugLog('✅ Synthesis request sent, waiting for worker response...')
    })
  }

  // Test tone generation for debugging audio pipeline
  const playTestTone = async (frequency: number = 440, duration: number = 1.0): Promise<void> => {
    addToDebugLog(`🎵 Starting test tone playback: ${frequency}Hz for ${duration}s`)
    
    if (isiOS) {
      const unlocked = await unlockAudioContextIOS()
      if (!unlocked) {
        addToDebugLog('❌ Failed to unlock audio for test tone')
        throw new Error('Audio context not unlocked for test tone')
      }
    }
    
    try {
      let audioCtx = getAudioCtx()
      audioCtx = ensureAudioContext(audioCtx)
      setAudioCtx(audioCtx)
      
      const testTone = generateTestTone(frequency, duration, audioCtx.sampleRate)
      addToDebugLog(`🎵 Generated test tone: ${testTone.length} samples at ${audioCtx.sampleRate}Hz`)
      
      const handle = await playPCMDebug(testTone, audioCtx.sampleRate, `test tone ${frequency}Hz`, {
        audioContext: audioCtx,
        onEnded: () => {
          addToDebugLog('✅ Test tone playback completed')
        }
      })
      
      addToDebugLog('✅ Test tone playback started')
      return new Promise((resolve) => {
        setTimeout(() => {
          handle.stop()
          addToDebugLog('⏹️ Test tone stopped')
          resolve()
        }, duration * 1000 + 100)
      })
    } catch (error) {
      addToDebugLog(`❌ Test tone playback failed: ${error}`)
      throw error
    }
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

  // iOS-specific helpers
  const getAudioState = () => ({
    isIOS: isiOS,
    isAudioUnlocked: isiOS ? getAudioUnlocked() : null,
    audioContextState: getAudioCtx()?.state || null,
    debugLog: isiOS ? getDebugLog() : null,
    lastError: isiOS ? (globalThis as any).__last_audio_error : null
  })
  
  const unlockAudioIOS = async () => {
    if (!isiOS) return true
    return await unlockAudioContextIOS()
  }
  
  // Expose manual unlock function globally for iOS debugging
  if (typeof window !== 'undefined') {
    ;(window as any).triggerAudioUnlock = unlockAudioIOS
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
    setTargetSampleRate,
    // Voice filtering functions
    getVoiceMetadata,
    getAvailableTags,
    filterVoicesByGender,
    filterVoicesByTags,
    filterVoicesByPitchRange,
    filterVoicesByRateRange,
    filterVoicesByBrightnessRange,
    getVoiceMetadataById,
    // Testing and debugging
    playTestTone,
    // iOS-specific helpers
    getAudioState,
    unlockAudioIOS
  }
}
