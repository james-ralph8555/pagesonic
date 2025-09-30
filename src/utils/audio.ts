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
  opts?: { playbackRate?: number; onEnded?: () => void; audioContext?: AudioContext }
): Promise<PlayHandle> => {
  const ctx = ensureAudioContext(opts?.audioContext || null)
  const pcm = sanitizeAndNormalize(pcmIn)
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate)
  buffer.getChannelData(0).set(pcm)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  if (opts?.playbackRate && opts.playbackRate > 0) {
    src.playbackRate.value = opts.playbackRate
  }
  src.connect(ctx.destination)
  
  // iOS-specific: Ensure context is resumed before starting playback
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(err => {
      console.warn('[Audio] Failed to resume suspended context:', err)
    })
  }
  
  // Add a small delay for iOS to ensure context is fully ready
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  
  src.start()
  src.onended = () => {
    try { opts?.onEnded?.() } catch {}
  }
  const handle: PlayHandle = {
    context: ctx,
    source: src,
    stop: () => {
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
