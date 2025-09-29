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
  isWebGPUSupported: false
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
    setState(prev => ({ ...prev, isModelLoading: true }))
    
    try {
      const model = MODELS.find(m => m.name === modelName)
      if (!model) {
        throw new Error(`Model ${modelName} not found`)
      }
      
      // Check if WebGPU is required and supported
      if (model.requiresWebGPU && !state().isWebGPUSupported) {
        throw new Error('WebGPU required but not supported')
      }
      
      // Load ONNX model (to be implemented)
      const ort = await import('onnxruntime-web/webgpu')
      // Note: session will be used for actual TTS implementation
      const session = await ort.InferenceSession.create(model.url, {
        executionProviders: model.requiresWebGPU ? ['webgpu'] : ['wasm']
      })
      void session // Prevent unused variable warning
      
      setState(prev => ({
        ...prev,
        model,
        isModelLoading: false
      }))
    } catch (error) {
      setState(prev => ({
        ...prev,
        isModelLoading: false
      }))
      throw error
    }
  }
  
  const speak = async (text: string) => {
    if (!state().model) {
      throw new Error('No model loaded')
    }
    
    setState(prev => ({ ...prev, isPlaying: true, isPaused: false }))
    
    try {
      // This will be implemented with actual TTS generation
      console.log('Speaking:', text)
      
      // For now, use browser's SpeechSynthesis as fallback
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.rate = state().rate
        utterance.pitch = state().pitch
        utterance.voice = speechSynthesis.getVoices().find(v => v.name.includes(state().voice)) || null
        utterance.onend = () => {
          setState(prev => ({ ...prev, isPlaying: false, isPaused: false }))
        }
        speechSynthesis.speak(utterance)
      }
    } catch (error) {
      setState(prev => ({ ...prev, isPlaying: false }))
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
