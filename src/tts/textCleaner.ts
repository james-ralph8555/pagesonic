export function cleanForTTS(input: string): string {
  if (!input) return "";
  return input
    // strip emojis and control weirdness
    .replace(/[\u{1F300}-\u{1FAFF}\u{200D}\u{FE0F}]/gu, "")
    .replace(/[""''"""]/g, "")
    .replace(/[()\\]/g, "")
    .replace(/\s+—\s+/g, ". ")
    // keep latin-ish + basic punctuation
    .replace(/[^\u0000-\u024F.,!?;:\-\s0-9a-zA-Z]/g, "")
    .trim();
}