const MIN = 4;
const MAX = 500;

export function chunkText(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n").map(s => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    const l = /[.!?]$/.test(line) ? line : line + ".";
    const sentences = l.split(/(?<=[.!?])(?=\s+|$)/);
    let cur = "";
    for (const s of sentences) {
      const st = s.trim(); if (!st) continue;
      if (st.length > MAX) { // split long ones by words
        const words = st.split(" ");
        let acc = "";
        for (const w of words) {
          const p = acc ? `${acc} ${w}` : w;
          if (p.length <= MAX) acc = p; else { if (acc) out.push(acc); acc = w; }
        }
        if (acc) cur = acc;
        continue;
      }
      const p = cur ? `${cur} ${st}` : st;
      if (p.length > MAX) { if (cur) out.push(cur); cur = st; }
      else if (p.length < MIN) cur = p; else { if (cur) out.push(cur); cur = st; }
    }
    if (cur) out.push(cur);
  }
  return out;
}