// Minimal audio helpers for playing Float32 PCM via WebAudio

export type PlayHandle = {
  context: AudioContext
  source: AudioBufferSourceNode
  stop: () => void
}

export const ensureAudioContext = (existing?: AudioContext | null): AudioContext => {
  try {
    if (existing && existing.state !== 'closed') return existing
  } catch {}
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
    // Let the browser choose device rate; we’ll set buffer.sampleRate
  } as any)
  return ctx
}

const sanitizeAndNormalize = (input: Float32Array): Float32Array => {
  // Create a copy we can safely mutate
  const pcm = new Float32Array(input.length)
  let maxAbs = 0
  let sum = 0
  for (let i = 0; i < input.length; i++) {
    let v = input[i]
    // Replace NaN/Inf with 0 to avoid blasting speakers
    if (!Number.isFinite(v)) v = 0
    pcm[i] = v
    const a = Math.abs(v)
    if (a > maxAbs) maxAbs = a
    sum += v
  }
  // Heuristic: if values look like int16 range, scale down
  if (maxAbs > 2 && maxAbs <= 40000) {
    const k = 32768
    for (let i = 0; i < pcm.length; i++) pcm[i] = pcm[i] / k
  } else if (maxAbs > 1) {
    // General normalization to prevent clipping
    for (let i = 0; i < pcm.length; i++) pcm[i] = pcm[i] / maxAbs
  }
  // Remove DC offset if significant
  const mean = sum / Math.max(1, pcm.length)
  if (Math.abs(mean) > 1e-3) {
    for (let i = 0; i < pcm.length; i++) pcm[i] -= mean
  }
  // Gentle 5ms fade-in/out to avoid clicks at boundaries
  const sr = 48000 // fade computed against a typical device rate; duration in samples adapts below
  const fadeMs = 5
  const fadeSamples = Math.max(1, Math.floor((sr * fadeMs) / 1000))
  const n = pcm.length
  const f = Math.min(fadeSamples, Math.floor(n / 4))
  for (let i = 0; i < f; i++) {
    const g = i / f
    pcm[i] *= g
    const j = n - 1 - i
    if (j >= 0) pcm[j] *= g
  }
  // Final clamp to [-1, 1]
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]
    pcm[i] = v < -1 ? -1 : v > 1 ? 1 : v
  }
  return pcm
}

export const playPCM = async (
  pcmIn: Float32Array,
  sampleRate: number,
  opts?: { playbackRate?: number; onEnded?: () => void; audioContext?: AudioContext; onInfo?: (info: { finalSampleRate: number; length: number; contextSampleRate: number }) => void }
): Promise<PlayHandle> => {
  const ctx = ensureAudioContext(opts?.audioContext || null)
  const pcm = sanitizeAndNormalize(pcmIn)
  
  // iOS-specific: Handle sample rate differences more gracefully
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  let targetSampleRate = sampleRate
  
  if (isIOS && Math.abs(sampleRate - ctx.sampleRate) > 100) {
    // Resample to match AudioContext sample rate on iOS to avoid issues
    targetSampleRate = ctx.sampleRate
    console.log(`[Audio] iOS: Resampling from ${sampleRate}Hz to ${targetSampleRate}Hz`)
  }

  // Create source buffer at original rate
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate)
  buffer.getChannelData(0).set(pcm)

  // High-quality resampling using OfflineAudioContext when rates differ substantially
  let finalBuffer = buffer
  if (targetSampleRate !== sampleRate) {
    try {
      const frames = Math.max(1, Math.floor((pcm.length / sampleRate) * targetSampleRate))
      const offline = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(1, frames, targetSampleRate)
      const src = offline.createBufferSource()
      src.buffer = buffer
      src.connect(offline.destination)
      src.start()
      const rendered: AudioBuffer = await offline.startRendering()
      finalBuffer = rendered
      console.log('[Audio] Used OfflineAudioContext for high-quality resampling')
    } catch (e) {
      // Fallback to lightweight linear interpolation
      const ratio = targetSampleRate / sampleRate
      const newLength = Math.floor(pcm.length * ratio)
      finalBuffer = ctx.createBuffer(1, newLength, targetSampleRate)
      const oldData = buffer.getChannelData(0)
      const newData = finalBuffer.getChannelData(0)
      for (let i = 0; i < newLength; i++) {
        const srcIndex = i / ratio
        const srcIndexInt = Math.floor(srcIndex)
        const fraction = srcIndex - srcIndexInt
        newData[i] = (oldData[srcIndexInt] || 0) * (1 - fraction) + (oldData[srcIndexInt + 1] || 0) * fraction
      }
      console.warn('[Audio] Offline resample failed; used linear interpolation fallback:', e)
    }
  }

  try {
    opts?.onInfo?.({ finalSampleRate: finalBuffer.sampleRate, length: finalBuffer.length, contextSampleRate: ctx.sampleRate })
  } catch {}
  
  const src = ctx.createBufferSource()
  src.buffer = finalBuffer
  if (opts?.playbackRate && opts.playbackRate > 0) {
    src.playbackRate.value = opts.playbackRate
  }
  
  // iOS-specific: Add gain node for better volume control
  if (isIOS) {
    const gainNode = ctx.createGain()
    gainNode.gain.value = 0.8 // Slightly reduce volume to prevent clipping
    src.connect(gainNode)
    gainNode.connect(ctx.destination as AudioDestinationNode)
    console.log('[Audio] iOS: Added gain node for volume control')
  } else {
    src.connect(ctx.destination as AudioDestinationNode)
  }
  
  // iOS-specific: Ensure context is resumed before starting playback
  if (ctx.state === 'suspended') {
    try {
      console.log('[Audio] Resuming suspended AudioContext...')
      await ctx.resume()
      // Give iOS a moment to properly transition to running state
      if (isIOS) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      console.log('[Audio] Context resumed successfully, state:', ctx.state)
    } catch (err) {
      console.warn('[Audio] Failed to resume suspended context:', err)
      throw err
    }
  }
  
  // Additional delay for iOS to ensure context is fully ready
  if (isIOS) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  
  console.log(`[Audio] Starting playback - samples: ${finalBuffer.length}, sampleRate: ${finalBuffer.sampleRate}`)
  src.start()
  
  src.onended = () => {
    console.log('[Audio] Playback completed')
    try { opts?.onEnded?.() } catch {}
  }
  
  const handle: PlayHandle = {
    context: ctx,
    source: src,
    stop: () => {
      console.log('[Audio] Manual stop requested')
      try { src.onended = null } catch {}
      try { src.stop() } catch {}
    }
  }
  return handle
}

export const suspend = async (ctx?: AudioContext | null) => {
  if (!ctx) return
  try { if (ctx.state === 'running') await ctx.suspend() } catch {}
}

export const resume = async (ctx?: AudioContext | null) => {
  if (!ctx) return
  try { if (ctx.state === 'suspended') await ctx.resume() } catch {}
}

export const close = async (ctx?: AudioContext | null) => {
  if (!ctx) return
  try { if (ctx.state !== 'closed') await ctx.close() } catch {}
}

// Test tone generation for debugging audio pipeline
export const generateTestTone = (frequency: number = 440, duration: number = 1.0, sampleRate: number = 22050): Float32Array => {
  const samples = Math.floor(duration * sampleRate)
  const tone = new Float32Array(samples)
  
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate
    // Generate sine wave with envelope to avoid clicks
    const envelope = Math.sin(Math.PI * i / samples) * 0.5 // Smooth envelope
    tone[i] = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.3 // Low volume
  }
  
  return tone
}

// Enhanced debug version of playPCM with detailed logging
export const playPCMDebug = async (
  pcmIn: Float32Array,
  sampleRate: number,
  label: string = 'audio',
  opts?: { playbackRate?: number; onEnded?: () => void; audioContext?: AudioContext }
): Promise<PlayHandle> => {
  console.log(`[Audio Debug] 🎵 Starting playback of ${label}: ${pcmIn.length} samples at ${sampleRate}Hz`)
  
  const ctx = ensureAudioContext(opts?.audioContext || null)
  console.log(`[Audio Debug] AudioContext state: ${ctx.state}, sampleRate: ${ctx.sampleRate}`)
  
  const pcm = sanitizeAndNormalize(pcmIn)
  
  // Analyze the audio data
  const maxValue = Math.max(...pcm.map(Math.abs))
  const avgValue = pcm.reduce((sum, val) => sum + Math.abs(val), 0) / pcm.length
  console.log(`[Audio Debug] 📊 Audio analysis - max: ${maxValue.toFixed(4)}, avg: ${avgValue.toFixed(4)}`)
  
  if (maxValue < 0.0001) {
    console.warn('[Audio Debug] ⚠️ WARNING: Audio data appears to be silent or near-silent')
  }
  
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate)
  buffer.getChannelData(0).set(pcm)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  if (opts?.playbackRate && opts.playbackRate > 0) {
    src.playbackRate.value = opts.playbackRate
  }
  src.connect(ctx.destination)
  
  console.log(`[Audio Debug] 🔗 Connected buffer source to AudioContext destination`)
  
  // iOS-specific: Ensure context is resumed before starting playback
  if (ctx.state === 'suspended') {
    console.log('[Audio Debug] Resuming suspended AudioContext...')
    try {
      await ctx.resume()
      // Give iOS a moment to properly transition to running state
      if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      console.log('[Audio Debug] ✅ Context resumed successfully, state:', ctx.state)
    } catch (err) {
      console.warn('[Audio Debug] ❌ Failed to resume suspended context:', err)
      throw err
    }
  }
  
  // Additional delay for iOS to ensure context is fully ready
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  
  const startTime = ctx.currentTime
  src.start()
  console.log(`[Audio Debug] ▶️ Started playback at context time: ${startTime}`)
  
  src.onended = () => {
    const endTime = ctx.currentTime
    const actualDuration = endTime - startTime
    console.log(`[Audio Debug] ✅ Playback completed - actual duration: ${actualDuration.toFixed(3)}s`)
    try { opts?.onEnded?.() } catch {}
  }
  
  const handle: PlayHandle = {
    context: ctx,
    source: src,
    stop: () => {
      console.log(`[Audio Debug] ⏹️ Manual stop requested for ${label}`)
      try { src.onended = null } catch {}
      try { src.stop() } catch {}
    }
  }
  return handle
}
