import * as ort from "onnxruntime-web";
import { cleanForTTS } from "./textCleaner";
import { chunkText } from "./chunker";
import { cachedFetchArrayBuffer, cachedFetchJSON } from "./modelCache";
import { textToPhonemeSentencesEspeak, textToPhonemeSentencesText } from "./phonemes";
import { mapPhonemesToIds } from "./ids";

export type TTSConfig = {
  audio: { sample_rate: number };
  phoneme_type: "espeak" | "text";
  phoneme_id_map: Record<string, number>;
  num_speakers: number;
  speaker_id_map?: Record<string, number>;
  inference?: { noise_scale?: number; length_scale?: number; noise_w?: number; }
};

export class RawAudio {
  constructor(public audio: Float32Array, public sr: number) {}
  toWavBlob(): Blob {
    const buffer = encodeWav16(this.audio, this.sr);
    return new Blob([buffer], { type: "audio/wav" });
  }
}

export class PiperLikeTTS {
  private cfg!: TTSConfig;
  private session!: ort.InferenceSession;

  static async create(modelURL: string, cfgURL: string) {
    // Configure ORT WASM for iOS/Safari and set asset paths
    try {
      const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      const isProd = (typeof import.meta !== 'undefined') && (import.meta as any)?.env?.PROD
      if (ort?.env?.wasm) {
        // Point to external ORT artifacts only for production builds to avoid Vite dev import errors
        if (isProd) {
          ort.env.wasm.wasmPaths = '/ort/'
        }
        ort.env.wasm.simd = true
        const coi = (globalThis as any).crossOriginIsolated === true
        // Avoid threads on iOS or when COI isn’t available
        ort.env.wasm.numThreads = (isiOS || !coi) ? 1 : (navigator.hardwareConcurrency || 4)
      }
    } catch {}

    const [modelAB, cfg] = await Promise.all([
      cachedFetchArrayBuffer(modelURL),
      cachedFetchJSON<TTSConfig>(cfgURL)
    ]);
    const session = await ort.InferenceSession.create(modelAB, {
      executionProviders: [{ name: "wasm" }]
    });
    const t = new PiperLikeTTS();
    t.cfg = cfg; t.session = session;
    return t;
  }

  getSampleRate() { return this.cfg.audio.sample_rate; }
  getSpeakers(): { id: number; name: string }[] {
    if ((this.cfg.num_speakers ?? 1) <= 1) return [{ id: 0, name: "Voice 1" }];
    // sort by mapped numeric ID asc
    const entries = Object.entries(this.cfg.speaker_id_map ?? {}).sort((a,b)=>a[1]-b[1]);
    return entries.map(([,id]) => ({ id, name: `Voice ${id+1}` }));
  }

  async synthesizeChunk(text: string, opts?: { speakerId?: number; lengthScale?: number; noiseScale?: number; noiseWScale?: number }): Promise<RawAudio> {
    // Skip synthesis for empty or non-speakable chunks to avoid ORT shape {0}
    if (!text.trim()) return new RawAudio(new Float32Array(0), this.getSampleRate());

    // Prefer espeak phonemization when configured, but add a safe timeout + fallback on iOS/Safari
    const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const useEspeak = this.cfg.phoneme_type === 'espeak'
    let sentences: string[][]
    if (useEspeak) {
      try {
        const timeoutMs = isiOS ? 1500 : 4000
        const res = await Promise.race([
          textToPhonemeSentencesEspeak(text),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('phonemizer timeout')), timeoutMs))
        ])
        // If we got here, phonemizer returned successfully
        sentences = res as unknown as string[][]
      } catch {
        // Fall back to simple text-based phonemes if espeak fails or times out
        sentences = textToPhonemeSentencesText(text)
      }
    } else {
      sentences = textToPhonemeSentencesText(text)
    }

    const ids32 = mapPhonemesToIds(sentences, this.cfg.phoneme_id_map);
    // If cleaning/phonemization produced no tokens (e.g., punctuation-only), return silence
    if (!ids32 || ids32.length === 0) {
      return new RawAudio(new Float32Array(0), this.getSampleRate());
    }
    const ids64 = BigInt64Array.from(ids32 as unknown as number[], v => BigInt(v));

    const N = BigInt(ids64.length);
    if (N === 0n) {
      return new RawAudio(new Float32Array(0), this.getSampleRate());
    }
    const scales = Float32Array.from([
      opts?.noiseScale ?? this.cfg.inference?.noise_scale ?? 0.333,
      opts?.lengthScale ?? this.cfg.inference?.length_scale ?? 1.0,
      opts?.noiseWScale ?? this.cfg.inference?.noise_w ?? 0.333,
    ]);

    const inputs: Record<string, ort.Tensor> = {
      input: new ort.Tensor("int64", ids64, [1, Number(N)]),
      input_lengths: new ort.Tensor("int64", BigInt64Array.from([N]), [1]),
      scales: new ort.Tensor("float32", scales, [3]),
    };
    if ((this.cfg.num_speakers ?? 1) > 1) {
      const sid = BigInt(opts?.speakerId ?? 0);
      inputs["sid"] = new ort.Tensor("int64", BigInt64Array.from([sid]), [1]);
    }

    const out = await this.session.run(inputs);
    const outName = this.session.outputNames[0] ?? "output";
    const data = out[outName].data as Float32Array | number[];
    const f32 = data instanceof Float32Array ? data : Float32Array.from(data);
    return new RawAudio(f32, this.getSampleRate());
  }

  async *stream(text: string, opts?: { speakerId?: number; lengthScale?: number; noiseScale?: number; noiseWScale?: number }) {
    const cleaned = cleanForTTS(text);
    for (const chunk of chunkText(cleaned)) {
      const audio = await this.synthesizeChunk(chunk, opts);
      yield { text: chunk, audio };
    }
  }
}

/** WAV encoder (mono, 16-bit) */
function encodeWav16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => { for (let i=0;i<s.length;i++) view.setUint8(o+i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE"); writeStr(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits
  writeStr(36, "data"); view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}
