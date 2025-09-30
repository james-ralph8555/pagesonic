/// <reference lib="webworker" />
import { PiperLikeTTS, RawAudio } from "./core";

let tts: PiperLikeTTS | null = null;

type InitMsg = { type: "init"; modelURL: string; cfgURL: string };
type GenMsg  = { type: "generate"; text: string; speakerId?: number; speed?: number };
type PrevMsg = { type: "preview"; text: string; speakerId?: number; speed?: number };
type Msg = InitMsg | GenMsg | PrevMsg;

self.addEventListener("message", async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      tts = await PiperLikeTTS.create(m.modelURL, m.cfgURL);
      const voices = tts.getSpeakers();
      (self as any).postMessage({ status: "ready", voices });
      return;
    }
    if (!tts) {
      (self as any).postMessage({ status: "error", data: "Model not initialized" });
      return;
    }
    const lengthScale = m.speed ? 1.0 / m.speed : undefined;

    if (m.type === "preview") {
      let first: RawAudio | null = null;
      for await (const { audio } of tts.stream(m.text, { speakerId: m.speakerId, lengthScale })) {
        first = audio; break;
      }
      if (first) (self as any).postMessage({ status: "preview", audio: first.toWavBlob() });
      return;
    }

    if (m.type === "generate") {
      const chunks: RawAudio[] = [];
      for await (const { text, audio } of tts.stream(m.text, { speakerId: m.speakerId, lengthScale })) {
        (self as any).postMessage({ status: "stream", chunk: { text, audio: audio.toWavBlob() } });
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