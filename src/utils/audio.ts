// Minimal audio helpers for playing Float32 PCM via WebAudio

export type PlayHandle = {
  context: AudioContext
  source: AudioBufferSourceNode
  stop: () => void
}

// iOS detection and preferred sample rate
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
const getPreferredSampleRate = () => {
  if (isIOS) {
    // iOS Safari prefers 44100Hz for better compatibility
    return 44100
  }
  // Let the browser decide for other platforms
  return null
}

export const ensureAudioContext = (existing?: AudioContext | null): AudioContext => {
  try {
    if (existing && existing.state !== 'closed') return existing
  } catch {}
  
  const preferredSampleRate = getPreferredSampleRate()
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: preferredSampleRate || undefined
  } as any)
  
  console.log(`[Audio] Created AudioContext with sampleRate: ${ctx.sampleRate}Hz${isIOS ? ' (iOS optimized)' : ''}`)
  return ctx
}

const sanitizeAndNormalize = (input: Float32Array): Float32Array => {
  // iOS memory optimization: Process in chunks for very large buffers
  const maxChunkSize = isIOS ? 22050 * 5 : 22050 * 10 // 5s for iOS, 10s for others at 22kHz
  
  if (input.length > maxChunkSize) {
    console.log(`[Audio] Processing large audio buffer in chunks: ${input.length} samples`)
    return processLargeBuffer(input, maxChunkSize)
  }
  
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
  
  // Enhanced normalization with iOS-specific optimizations
  if (maxAbs > 2 && maxAbs <= 40000) {
    // Values look like int16 range, scale down appropriately
    const k = 32768
    for (let i = 0; i < pcm.length; i++) pcm[i] = pcm[i] / k
    console.log(`[Audio] Scaled int16-range audio by 1/${k}`)
  } else if (maxAbs > 1) {
    // General normalization to prevent clipping
    const scale = Math.min(1.0, 0.95 / maxAbs) // Leave 5% headroom
    for (let i = 0; i < pcm.length; i++) pcm[i] = pcm[i] * scale
    console.log(`[Audio] Normalized audio with max value ${maxAbs.toFixed(3)}, scale: ${scale.toFixed(3)}`)
  }
  
  // Remove DC offset if significant
  const mean = sum / Math.max(1, pcm.length)
  if (Math.abs(mean) > 1e-3) {
    for (let i = 0; i < pcm.length; i++) pcm[i] -= mean
    console.log(`[Audio] Removed DC offset: ${mean.toFixed(6)}`)
  }
  
  // iOS-specific: Longer fade to prevent clicks and audio artifacts
  const baseSr = 48000
  const fadeMs = isIOS ? 10 : 5 // Longer fade for iOS
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

// Helper function for processing large buffers in chunks
function processLargeBuffer(input: Float32Array, chunkSize: number): Float32Array {
  const output = new Float32Array(input.length)
  
  for (let offset = 0; offset < input.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, input.length)
    const chunk = input.slice(offset, end)
    
    // Process each chunk individually
    let maxAbs = 0
    let sum = 0
    
    // Find max and sum for normalization
    for (let i = 0; i < chunk.length; i++) {
      const v = chunk[i]
      if (Number.isFinite(v)) {
        maxAbs = Math.max(maxAbs, Math.abs(v))
        sum += v
      }
    }
    
    // Apply normalization to chunk
    let scale = 1.0
    if (maxAbs > 2 && maxAbs <= 40000) {
      scale = 1 / 32768
    } else if (maxAbs > 1) {
      scale = Math.min(1.0, 0.95 / maxAbs)
    }
    
    // Remove DC offset and apply scaling
    const mean = sum / Math.max(1, chunk.length)
    for (let i = 0; i < chunk.length; i++) {
      let v = chunk[i]
      if (!Number.isFinite(v)) v = 0
      v = (v - mean) * scale
      output[offset + i] = v < -0.99 ? -0.99 : v > 0.99 ? 0.99 : v
    }
  }
  
  // Apply cross-fade between chunks to prevent clicks
  const crossfadeSize = Math.min(100, Math.floor(chunkSize / 10))
  for (let offset = crossfadeSize; offset < output.length - crossfadeSize; offset += chunkSize) {
    const chunkEnd = Math.min(offset + crossfadeSize, output.length - crossfadeSize)
    for (let i = 0; i < crossfadeSize && offset + i < chunkEnd; i++) {
      const fade = i / crossfadeSize
      const prevIdx = offset + i - 1
      const currIdx = offset + i
      if (prevIdx >= 0 && currIdx < output.length) {
        output[currIdx] = output[prevIdx] * (1 - fade) + output[currIdx] * fade
      }
    }
  }
  
  console.log(`[Audio] Processed large buffer in chunks: ${Math.ceil(input.length / chunkSize)} chunks`)
  return output
}

export const playPCM = async (
  pcmIn: Float32Array,
  sampleRate: number,
  opts?: { playbackRate?: number; onEnded?: () => void; audioContext?: AudioContext; onInfo?: (info: { finalSampleRate: number; length: number; contextSampleRate: number }) => void }
): Promise<PlayHandle> => {
  const ctx = ensureAudioContext(opts?.audioContext || null)
  const pcm = sanitizeAndNormalize(pcmIn)
  
  // iOS-specific: Handle sample rate differences more gracefully
  let targetSampleRate = sampleRate
  
  // Always resample to preferred rate on iOS for better compatibility
  if (isIOS) {
    const preferredRate = 44100
    if (Math.abs(sampleRate - preferredRate) > 100) {
      targetSampleRate = preferredRate
      console.log(`[Audio] iOS: Resampling from ${sampleRate}Hz to ${targetSampleRate}Hz (iOS optimized)`)
    }
  } else if (Math.abs(sampleRate - ctx.sampleRate) > 100) {
    // Resample to match AudioContext sample rate on other platforms if needed
    targetSampleRate = ctx.sampleRate
    console.log(`[Audio] Resampling from ${sampleRate}Hz to ${targetSampleRate}Hz`)
  }

  // Create source buffer at original rate
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate)
  buffer.getChannelData(0).set(pcm)

  // High-quality resampling using OfflineAudioContext when rates differ substantially
  let finalBuffer = buffer
  if (targetSampleRate !== sampleRate) {
    try {
      const frames = Math.max(1, Math.floor((pcm.length / sampleRate) * targetSampleRate))
      
      // iOS-specific: Use smaller buffer sizes to avoid memory issues
      const maxFrames = isIOS ? 48000 : 96000 // 1s at 48kHz for iOS, 2s for others
      
      if (frames <= maxFrames) {
        // Single pass resampling for shorter buffers
        const offline = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(1, frames, targetSampleRate)
        const src = offline.createBufferSource()
        src.buffer = buffer
        src.connect(offline.destination)
        src.start()
        const rendered: AudioBuffer = await offline.startRendering()
        finalBuffer = rendered
        console.log(`[Audio] Used OfflineAudioContext for high-quality resampling: ${sampleRate}Hz → ${targetSampleRate}Hz`)
      } else {
        // Chunked resampling for longer buffers (iOS memory optimization)
        console.log(`[Audio] Using chunked resampling for long buffer: ${frames} frames`)
        finalBuffer = await chunkedResample(buffer, sampleRate, targetSampleRate, maxFrames)
      }
    } catch (e) {
      // Enhanced fallback to cubic interpolation for better quality
      console.warn('[Audio] OfflineAudioContext failed, using cubic interpolation fallback:', e)
      finalBuffer = cubicInterpolationResample(buffer, sampleRate, targetSampleRate, ctx)
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
  await ensureAudioContextRunning(ctx)
  
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

// Enhanced AudioContext state management for iOS
async function ensureAudioContextRunning(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'running') {
    return
  }
  
  const maxRetries = isIOS ? 3 : 2
  const baseDelay = isIOS ? 150 : 50
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Audio] Resuming AudioContext (attempt ${attempt}/${maxRetries}), current state: ${ctx.state}`)
      
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }
      
      // iOS needs extra time to transition to 'running' state
      const retryDelay = baseDelay * attempt
      await new Promise(resolve => setTimeout(resolve, retryDelay))
      
      // Check if the context transitioned to running state
      if (ctx.state !== 'suspended') {
        console.log(`[Audio] ✅ AudioContext resumed successfully after ${attempt} attempt(s), state: ${ctx.state}`)
        // Only return if we have a valid, non-closed context state
        if (ctx.state === 'interrupted' || ctx.state === 'closed') {
          console.warn(`[Audio] ⚠️ Context in unexpected state: ${ctx.state}`)
        }
        return
      } else {
        console.warn(`[Audio] ⚠️ AudioContext still suspended after resume attempt ${attempt}`)
      }
    } catch (err) {
      console.warn(`[Audio] ❌ Resume attempt ${attempt} failed:`, err)
      
      if (attempt === maxRetries) {
        throw new Error(`Failed to resume AudioContext after ${maxRetries} attempts: ${err}`)
      }
      
      // Wait before retrying
      const retryDelay = baseDelay * attempt
      await new Promise(resolve => setTimeout(resolve, retryDelay))
    }
  }
}

// Enhanced resampling helper functions
async function chunkedResample(buffer: AudioBuffer, fromRate: number, toRate: number, maxFrames: number): Promise<AudioBuffer> {
  const samples = buffer.getChannelData(0)
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: toRate })
  
  // Process in chunks to avoid memory issues on iOS
  const chunkDuration = Math.min(maxFrames / toRate, 1.0) // max 1 second chunks
  const chunkSamples = Math.floor(chunkDuration * fromRate)
  const outputChunks: Float32Array[] = []
  
  for (let offset = 0; offset < samples.length; offset += chunkSamples) {
    const chunkEnd = Math.min(offset + chunkSamples, samples.length)
    const chunkData = samples.slice(offset, chunkEnd)
    
    if (chunkData.length === 0) break
    
    const chunkBuffer = ctx.createBuffer(1, chunkData.length, fromRate)
    chunkBuffer.getChannelData(0).set(chunkData)
    
    const offline = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(1, chunkData.length, toRate)
    const src = offline.createBufferSource()
    src.buffer = chunkBuffer
    src.connect(offline.destination)
    src.start()
    
    const rendered = await offline.startRendering()
    outputChunks.push(rendered.getChannelData(0))
  }
  
  // Combine all chunks
  const totalOutputLength = outputChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const finalBuffer = ctx.createBuffer(1, totalOutputLength, toRate)
  const finalData = finalBuffer.getChannelData(0)
  
  let outputOffset = 0
  for (const chunk of outputChunks) {
    finalData.set(chunk, outputOffset)
    outputOffset += chunk.length
  }
  
  await ctx.close()
  console.log(`[Audio] Chunked resampling completed: ${samples.length} samples → ${totalOutputLength} samples`)
  return finalBuffer
}

function cubicInterpolationResample(buffer: AudioBuffer, fromRate: number, toRate: number, ctx: AudioContext): AudioBuffer {
  const inputData = buffer.getChannelData(0)
  const ratio = fromRate / toRate
  const outputLength = Math.floor(inputData.length / ratio)
  const outputBuffer = ctx.createBuffer(1, outputLength, toRate)
  const outputData = outputBuffer.getChannelData(0)
  
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio
    const srcIndexInt = Math.floor(srcIndex)
    const fraction = srcIndex - srcIndexInt
    
    // Cubic interpolation using 4 points
    const p0 = inputData[Math.max(0, srcIndexInt - 1)] || 0
    const p1 = inputData[srcIndexInt] || 0
    const p2 = inputData[Math.min(inputData.length - 1, srcIndexInt + 1)] || 0
    const p3 = inputData[Math.min(inputData.length - 1, srcIndexInt + 2)] || 0
    
    // Cubic interpolation formula
    const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3
    const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3
    const c = -0.5 * p0 + 0.5 * p2
    const d = p1
    
    const t = fraction
    outputData[i] = a * t * t * t + b * t * t + c * t + d
  }
  
  console.log(`[Audio] Cubic interpolation resampling: ${inputData.length} samples → ${outputLength} samples`)
  return outputBuffer
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

// Enhanced audio quality analysis function
function analyzeAudioQuality(pcm: Float32Array, sampleRate: number): {
  maxValue: number
  avgValue: number
  rmsValue: number
  dcOffset: number
  hasSignal: boolean
  qualityScore: number
  issues: string[]
} {
  const absValues = pcm.map(Math.abs)
  const maxValue = Math.max(...absValues)
  const avgValue = absValues.reduce((sum, val) => sum + val, 0) / pcm.length
  const rmsValue = Math.sqrt(pcm.reduce((sum, val) => sum + val * val, 0) / pcm.length)
  const dcOffset = pcm.reduce((sum, val) => sum + val, 0) / pcm.length
  
  const issues: string[] = []
  let qualityScore = 100
  
  // Check for silence
  if (maxValue < 0.0001) {
    issues.push('🔇 Audio appears to be silent or near-silent')
    qualityScore -= 50
  }
  
  // Check for clipping
  if (maxValue > 0.99) {
    issues.push('📈 Audio may be clipping (max value too high)')
    qualityScore -= 20
  }
  
  // Check for DC offset
  if (Math.abs(dcOffset) > 0.01) {
    issues.push(`⚡ High DC offset detected: ${dcOffset.toFixed(6)}`)
    qualityScore -= 10
  }
  
  // Check for low dynamic range
  const dynamicRange = maxValue / (avgValue + 1e-10)
  if (dynamicRange < 3) {
    issues.push(`📊 Low dynamic range: ${dynamicRange.toFixed(2)}`)
    qualityScore -= 15
  }
  
  // Check RMS level
  if (rmsValue < 0.05) {
    issues.push('🔉 Low RMS level (audio may be too quiet)')
    qualityScore -= 10
  } else if (rmsValue > 0.8) {
    issues.push('📢 High RMS level (audio may be too loud)')
    qualityScore -= 10
  }
  
  // Check for potential sample rate issues
  if (sampleRate < 16000) {
    issues.push(`📵 Low sample rate: ${sampleRate}Hz (may sound muffled)`)
    qualityScore -= 25
  } else if (sampleRate > 48000) {
    issues.push(`📶 Very high sample rate: ${sampleRate}Hz (may cause compatibility issues)`)
    qualityScore -= 5
  }
  
  const hasSignal = maxValue > 0.0001 && rmsValue > 0.001
  
  return {
    maxValue,
    avgValue,
    rmsValue,
    dcOffset,
    hasSignal,
    qualityScore: Math.max(0, qualityScore),
    issues
  }
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
  console.log(`[Audio Debug] Platform info: ${isIOS ? 'iOS Safari' : 'Other browser'}`)
  
  // Pre-analysis of raw input
  const rawAnalysis = analyzeAudioQuality(pcmIn, sampleRate)
  console.log(`[Audio Debug] 📊 Raw audio analysis - Quality: ${rawAnalysis.qualityScore}/100`)
  if (rawAnalysis.issues.length > 0) {
    console.log(`[Audio Debug] ⚠️ Raw audio issues:`, rawAnalysis.issues)
  }
  
  const pcm = sanitizeAndNormalize(pcmIn)
  
  // Post-analysis after processing
  const processedAnalysis = analyzeAudioQuality(pcm, sampleRate)
  console.log(`[Audio Debug] 📊 Processed audio analysis - Quality: ${processedAnalysis.qualityScore}/100`)
  console.log(`[Audio Debug] 📈 Max: ${processedAnalysis.maxValue.toFixed(4)}, Avg: ${processedAnalysis.avgValue.toFixed(4)}, RMS: ${processedAnalysis.rmsValue.toFixed(4)}`)
  console.log(`[Audio Debug] ⚡ DC Offset: ${processedAnalysis.dcOffset.toFixed(6)}`)
  
  if (processedAnalysis.issues.length > 0) {
    console.log(`[Audio Debug] ⚠️ Processed audio issues:`, processedAnalysis.issues)
  }
  
  if (!processedAnalysis.hasSignal) {
    console.warn('[Audio Debug] ❌ CRITICAL: No audio signal detected after processing!')
  }
  
  // Sample rate compatibility check
  if (isIOS && Math.abs(sampleRate - 44100) > 1000) {
    console.warn(`[Audio Debug] 🍎 iOS WARNING: Non-optimal sample rate ${sampleRate}Hz (44100Hz preferred)`)
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
  console.log(`[Audio Debug] 📋 Buffer info: ${pcm.length} samples, ${(pcm.length / sampleRate).toFixed(2)}s duration`)
  
  // Use enhanced AudioContext management
  await ensureAudioContextRunning(ctx)
  
  const startTime = ctx.currentTime
  src.start()
  console.log(`[Audio Debug] ▶️ Started playback at context time: ${startTime}`)
  
  src.onended = () => {
    const endTime = ctx.currentTime
    const actualDuration = endTime - startTime
    const expectedDuration = pcm.length / sampleRate
    
    console.log(`[Audio Debug] ✅ Playback completed`)
    console.log(`[Audio Debug] ⏱️ Duration: expected ${expectedDuration.toFixed(3)}s, actual ${actualDuration.toFixed(3)}s`)
    
    if (Math.abs(actualDuration - expectedDuration) > 0.1) {
      console.warn(`[Audio Debug] ⚠️ Duration mismatch: ${(actualDuration - expectedDuration).toFixed(3)}s`)
    }
    
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
