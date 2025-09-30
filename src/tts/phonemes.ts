import { phonemize } from "phonemizer";

export async function textToPhonemeSentencesEspeak(text: string, voice = "en-us"): Promise<string[][]> {
  const ph = await phonemize(text, voice); // returns string or array; normalize to string
  const str = Array.isArray(ph) ? ph.join(" ") : String(ph);
  return str.split(/[.!?]+/).map(s => s.trim()).filter(Boolean).map(s => [...s.normalize("NFD")]);
}

export function textToPhonemeSentencesText(text: string): string[][] {
  return text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean).map(s => [...s.normalize("NFD")]);
}