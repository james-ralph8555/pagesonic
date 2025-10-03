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
  
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
  console.log(`[Audio] Created AudioContext with sampleRate: ${ctx.sampleRate}Hz`)
  return ctx
}

const sanitizeAndNormalize = (input: Float32Array): Float32Array => {
  // Create a copy we can safely mutate
  const pcm = new Float32Array(input.length)
  let maxAbs = 0
  let sum = 0
  let invalidSamples = 0
  
  for (let i = 0; i < input.length; i++) {
    let v = input[i]
    // Replace NaN/Inf with 0 to avoid blasting speakers
    if (!Number.isFinite(v)) {
      v = 0
      invalidSamples++
    }
    pcm[i] = v
    const a = Math.abs(v)
    if (a > maxAbs) maxAbs = a
    sum += v
  }
  
  if (invalidSamples > 0) {
    console.warn(`[Audio] Found and replaced ${invalidSamples} invalid audio samples`)
  }
  
  // Basic normalization to prevent clipping
  const headroom = 0.95
  if (maxAbs > 2 && maxAbs <= 40000) {
    // Values look like int16 range, scale down appropriately
    const k = 32768
    for (let i = 0; i < pcm.length; i++) pcm[i] = pcm[i] / k
    console.log(`[Audio] Scaled int16-range audio by 1/${k}`)
  } else if (maxAbs > 1) {
    // General normalization to prevent clipping
    const scale = Math.min(1.0, headroom / maxAbs)
    for (let i = 0; i < pcm.length; i++) pcm[i] = pcm[i] * scale
    console.log(`[Audio] Normalized audio with max value ${maxAbs.toFixed(3)}, scale: ${scale.toFixed(3)}`)
  }
  
  // Remove DC offset if significant
  const mean = sum / Math.max(1, pcm.length)
  if (Math.abs(mean) > 1e-3) {
    for (let i = 0; i < pcm.length; i++) pcm[i] -= mean
    console.log(`[Audio] Removed DC offset: ${mean.toFixed(6)}`)
  }
  
  // Simple fade to prevent clicks
  const baseSr = 48000
  const fadeMs = 5
  const fadeSamples = Math.max(1, Math.floor((baseSr * fadeMs) / 1000))
  const n = pcm.length
  const f = Math.min(fadeSamples, Math.floor(n / 8)) // Smaller fraction for safety
  
  for (let i = 0; i < f; i++) {
    const g = i / f
    pcm[i] *= g
    const j = n - 1 - i
    if (j >= 0) pcm[j] *= g
  }
  
  // Final clamp to [-1, 1] with safety margin
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]
    pcm[i] = v < -0.99 ? -0.99 : v > 0.99 ? 0.99 : v
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
  
  let targetSampleRate = sampleRate
  
  // Resample to match AudioContext sample rate if needed
  if (Math.abs(sampleRate - ctx.sampleRate) > 100) {
    targetSampleRate = ctx.sampleRate
    console.log(`[Audio] Resampling from ${sampleRate}Hz to ${targetSampleRate}Hz`)
  }

  // Create source buffer at original rate
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate)
  buffer.getChannelData(0).set(pcm)

  // High-quality resampling using OfflineAudioContext when rates differ
  let finalBuffer = buffer
  if (targetSampleRate !== sampleRate) {
    try {
      const frames = Math.max(1, Math.floor((pcm.length / sampleRate) * targetSampleRate))
      
      // Use OfflineAudioContext for high-quality resampling
      const offline = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(1, frames, targetSampleRate)
      const src = offline.createBufferSource()
      src.buffer = buffer
      src.connect(offline.destination)
      src.start()
      const rendered: AudioBuffer = await offline.startRendering()
      finalBuffer = rendered
      console.log(`[Audio] Used OfflineAudioContext for high-quality resampling: ${sampleRate}Hz → ${targetSampleRate}Hz`)
    } catch (e) {
      console.warn('[Audio] OfflineAudioContext failed, using direct playback:', e)
      // Fallback: just use the original buffer
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
  
  src.connect(ctx.destination as AudioDestinationNode)
  
  // Ensure context is resumed before starting playback
  if (ctx.state === 'suspended') {
    await ctx.resume()
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