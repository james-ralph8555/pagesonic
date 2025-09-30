import { createSignal, onCleanup } from 'solid-js'
import { TTSState, TTSModel } from '@/types'
import { ensureAudioContext, playPCM, suspend as suspendAudio, resume as resumeAudio, close as closeAudio } from '@/utils/audio'

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
  // WebAudio handles to control local model playback
  let audioCtx: AudioContext | null = null
  let activeStop: (() => void) | null = null
  let stopRequested = false
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
    // Cleanup IDL handler when this hook instance is torn down
    try { onCleanup(() => { try { (window.speechSynthesis as any).onvoiceschanged = null } catch {} }) } catch {}
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    ensureSystemVoices()
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
        console.log(`[TTS] speak chunk ${chunkIdx + 1}/${chunks.length} (len=${text.length}) rate=${utterance.rate} pitch=${utterance.pitch}`)
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
      return true
    } catch (e) {
      setState(prev => ({ ...prev, lastError: (e as Error)?.message || 'Failed to enable Browser TTS' }))
      return false
    }
  }

  const speak = async (text: string) => {
    // Clear any queued/busy utterances to prevent piling up
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { speechSynthesis.cancel() } catch {}
    }
    setState(prev => ({ ...prev, isPlaying: true, isPaused: false }))
    stopRequested = false
    try {
      const current = state()

      // Prepare chunks + logging
      const t0 = performance.now()
      const { chunks, meta } = chunkText(text)
      console.log(`[TTS] text length=${text.length}, chunks=${chunks.length}`)
      meta.forEach(m => console.log(`[TTS] chunk #${m.idx + 1} chars=[${m.startChar}, ${m.endChar})`))

      // Path 1: Local model (ONNX)
      if (current.model && current.session && current.engine === 'local') {
        console.log('Speaking with model:', current.model.name)
        const ort = await import('onnxruntime-web') as any

        // Ensure an AudioContext exists
        audioCtx = ensureAudioContext(audioCtx)

        const runChunk = async (chunk: string) => {
          // Heuristic feeds builder for Kitten-style models
          const session: any = current.session
          const inMeta = session.inputMetadata || {}
          const inNames: string[] = session.inputNames || Object.keys(inMeta)

          const feeds: Record<string, any> = {}

          const toCodes = (s: string) => {
            // Basic UTF-8 code units; many small TTS models accept bytes or codepoints
            const codes: number[] = []
            for (let i = 0; i < s.length; i++) codes.push(s.charCodeAt(i) & 0xff)
            return codes
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
          for (const name of inNames) {
            const meta = inMeta[name] || { type: 'tensor(float)' }
            const type = (meta?.type || '').toString()
            const elemType = (type.match(/tensor\(([^)]+)\)/)?.[1]) || type
            const dims = (meta?.dimensions && meta.dimensions.length > 0) ? meta.dimensions.map((d: any) => (typeof d === 'number' ? d : -1)) : []

            if (/text|chars|tokens|input_ids/i.test(name)) {
              const codes = toCodes(chunk)
              const shape = (dims.length > 0)
                ? dims.map((d: number, idx: number) => (d === -1 ? (idx === dims.length - 1 ? codes.length : 1) : d))
                : [1, codes.length]
              // Prefer int64 unless metadata explicitly asks otherwise
              const wanted = /64/.test((elemType || '').toLowerCase()) ? 'int64' : (/32|uint8|int8/.test((elemType || '').toLowerCase()) ? elemType : 'int64')
              feeds[name] = makeIntTensor(wanted, codes, shape)
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
          if (stopRequested) return
          const handle = await playPCM(pcm, sr, {
            audioContext: audioCtx!,
            playbackRate: Math.max(0.5, Math.min(current.rate || 1.0, 2.0)),
            onEnded: () => { /* handled by sequencing below */ }
          })
          activeStop = handle.stop
          // Wait for buffer duration approximately before proceeding
          const seconds = (pcm.length / sr) / (Math.max(0.5, Math.min(current.rate || 1.0, 2.0)))
          await new Promise(res => setTimeout(res, Math.max(0, seconds * 1000)))
        }

        // Sequentially synthesize and play each chunk
        for (let i = 0; i < chunks.length; i++) {
          if (stopRequested) break
          await runChunk(chunks[i])
          if (stopRequested) break
          const pause = current.interChunkPauseMs || 0
          if (pause > 0) await new Promise(res => setTimeout(res, pause))
        }

        if (!stopRequested) {
          const t1 = performance.now()
          console.log(`[TTS] all chunks synthesized in ${(t1 - t0).toFixed(0)}ms`)
        }
        setState(prev => ({ ...prev, isPlaying: false, isPaused: false }))
        return
      }

      // Path 2: Browser TTS (chunked) if available
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
    stopRequested = true
    setState(prev => ({ ...prev, isPlaying: false, isPaused: false }))
    try { if (activeStop) activeStop() } catch {}
    activeStop = null
    if ('speechSynthesis' in window) {
      try { speechSynthesis.cancel() } catch {}
    }
    // Try to close audio context gracefully
    try { closeAudio(audioCtx) } catch {}
    audioCtx = null
  }

  const pause = () => {
    let paused = false
    if ('speechSynthesis' in window) {
      try { speechSynthesis.pause(); paused = true } catch {}
    }
    if (audioCtx) {
      suspendAudio(audioCtx).then(() => {}).catch(() => {})
      paused = true
    }
    if (paused) setState(prev => ({ ...prev, isPaused: true }))
  }

  const resume = () => {
    let resumed = false
    if ('speechSynthesis' in window) {
      try { speechSynthesis.resume(); resumed = true } catch {}
    }
    if (audioCtx) {
      resumeAudio(audioCtx).then(() => {}).catch(() => {})
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
    setInterChunkPauseMs
  }
}
