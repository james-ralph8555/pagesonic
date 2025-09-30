export function mapPhonemesToIds(sentences: string[][], idMap: Record<string, number>) {
  const BOS = "^", EOS = "$", PAD = "_";
  if (!idMap || idMap[BOS] == null || idMap[EOS] == null || idMap[PAD] == null)
    throw new Error("phoneme_id_map is missing core tokens (^, $, _)");

  const ids: number[] = [];
  for (const sent of sentences) {
    ids.push(idMap[BOS], idMap[PAD]);
    for (const p of sent) {
      const id = idMap[p];
      if (id != null) { ids.push(id, idMap[PAD]); }
    }
    ids.push(idMap[EOS]);
  }
  return Int32Array.from(ids); // later convert to BigInt64Array for ORT
}