import { createSignal } from 'solid-js'
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
  isModelLoading: false,
  isWebGPUSupported: false,
  lastError: null,
  session: undefined
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

      // Load ORT build for WASM
      const ort = await import('onnxruntime-web') as any
      // Configure WASM paths explicitly for ORT
      if (ort?.env?.wasm) {
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/'
        ort.env.wasm.numThreads = 1
        ort.env.wasm.proxy = false
      }
      // Force CPU/WASM for Kitten; require WebGPU for Kokoro
      const eps: ("webgpu" | "wasm")[] = model.requiresWebGPU ? ['webgpu'] : ['wasm']

      const session = await ort.InferenceSession.create(model.url, {
        executionProviders: eps as any,
      })

      setState(prev => ({
        ...prev,
        model,
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
  
  const speak = async (text: string) => {
    setState(prev => ({ ...prev, isPlaying: true, isPaused: false }))
    try {
      // If a local model is loaded, future: synthesize via ONNX session
      if (state().model && state().session) {
        console.log('Speaking with model:', state().model.name)
        // TODO: Generate audio via ONNX and play via AudioContext
        // Temporary: fall through to SpeechSynthesis until model pipeline is implemented
      }

      // Fallback: use browser SpeechSynthesis if available
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.rate = state().rate
        utterance.pitch = state().pitch
        // Try to match voice by substring; otherwise let system default
        const voice = speechSynthesis.getVoices().find(v => v.name.toLowerCase().includes(state().voice.toLowerCase())) || null
        utterance.voice = voice
        utterance.onend = () => {
          setState(prev => ({ ...prev, isPlaying: false, isPaused: false }))
        }
        speechSynthesis.speak(utterance)
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
  
  return {
    state,
    models: MODELS,
    loadModel,
    speak,
    stop,
    pause,
    resume,
    setVoice,
    setRate,
    setPitch
  }
}
