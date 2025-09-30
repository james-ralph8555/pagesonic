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

export const playPCM = async (
  pcm: Float32Array,
  sampleRate: number,
  opts?: { playbackRate?: number; onEnded?: () => void; audioContext?: AudioContext }
): Promise<PlayHandle> => {
  const ctx = ensureAudioContext(opts?.audioContext || null)
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate)
  buffer.getChannelData(1 - 1).set(pcm)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  if (opts?.playbackRate && opts.playbackRate > 0) {
    src.playbackRate.value = opts.playbackRate
  }
  src.connect(ctx.destination)
  await ctx.resume().catch(() => {})
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
