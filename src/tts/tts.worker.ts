/// <reference lib="webworker" />
import { PiperLikeTTS, RawAudio } from "./core";

let tts: PiperLikeTTS | null = null;

type InitMsg = { type: "init"; modelURL: string; cfgURL: string };
type GenMsg  = { type: "generate"; text: string; speakerId?: number; speed?: number };
type PrevMsg = { type: "preview"; text: string; speakerId?: number; speed?: number };
type Msg = InitMsg | GenMsg | PrevMsg;

self.addEventListener("message", async (e: MessageEvent<any>) => {
  const m = e.data as Msg | { type: 'ping'; timestamp?: number };
  try {
    // lightweight liveness check
    if ((m as any)?.type === 'ping') {
      (self as any).postMessage({ type: 'pong', timestamp: (m as any)?.timestamp ?? Date.now() });
      return;
    }
    const mm = m as Msg;
    if (mm.type === "init") {
      tts = await PiperLikeTTS.create(mm.modelURL, mm.cfgURL);
      const voices = tts.getSpeakers();
      (self as any).postMessage({ status: "ready", voices });
      return;
    }
    if (!tts) {
      (self as any).postMessage({ status: "error", data: "Model not initialized" });
      return;
    }
    const lengthScale = (mm as any).speed ? 1.0 / (mm as any).speed : undefined;

    if (mm.type === "preview") {
      let first: RawAudio | null = null;
      for await (const { audio } of tts.stream(mm.text, { speakerId: (mm as any).speakerId, lengthScale })) {
        first = audio; break;
      }
      if (first) (self as any).postMessage({ status: "preview", audio: first.toWavBlob() });
      return;
    }

    if (mm.type === "generate") {
      const chunks: RawAudio[] = [];
      for await (const { text, audio } of tts.stream(mm.text, { speakerId: (mm as any).speakerId, lengthScale })) {
        // Send both a WAV Blob (fallback) and a copy of Float32Array buffer for WebAudio consumers
        const wav = audio.toWavBlob();
        const f32Copy = new Float32Array(audio.audio); // copy to avoid detached ArrayBuffer
        // Transfer the underlying ArrayBuffer when possible for performance/stability
        try {
          (self as any).postMessage({
            status: "stream",
            chunk: { text, audio: wav, sr: audio.sr, f32: f32Copy.buffer }
          }, [f32Copy.buffer]);
        } catch {
          // Fallback without transfer list if environment disallows it
          (self as any).postMessage({
            status: "stream",
            chunk: { text, audio: wav, sr: audio.sr, f32: f32Copy.buffer }
          });
        }
        chunks.push(audio);
      }
      // Merge chunks
      const sr = chunks[0]?.sr ?? 22050;
      let total = 0; for (const c of chunks) total += c.audio.length;
      let merged = new Float32Array(total);
      let o = 0; for (const c of chunks) { merged.set(c.audio, o); o += c.audio.length; }
      // normalize and light trim
      normalize(merged, 0.9); merged = trim(merged, 0.002, Math.floor(sr * 0.02));
      const finalBlob = new RawAudio(merged, sr).toWavBlob();
      (self as any).postMessage({ status: "complete", audio: finalBlob });
    }
  } catch (err: any) {
    (self as any).postMessage({ status: "error", data: String(err?.message ?? err) });
  }
});

function normalize(f32: Float32Array, target = 0.9) {
  let max = 1e-9; for (let i = 0; i < f32.length; i++) max = Math.max(max, Math.abs(f32[i]));
  const g = Math.min(4, target / max);
  if (g < 1) for (let i = 0; i < f32.length; i++) f32[i] *= g;
}
function trim(f32: Float32Array, thresh = 0.002, pad = 480) {
  let s = 0, e = f32.length - 1;
  while (s < e && Math.abs(f32[s]) < thresh) s++;
  while (e > s && Math.abs(f32[e]) < thresh) e--;
  s = Math.max(0, s - pad); e = Math.min(f32.length, e + pad);
  return f32.slice(s, e);
}
