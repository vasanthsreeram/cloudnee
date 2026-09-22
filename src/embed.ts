/** Deterministic, dependency-free embeddings: hashed bag of words, L2 normalized. */

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** Lowercase, split on non-alphanumerics, drop empties. Numbers are kept. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== "");
}

function fnv1a(token: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

/** Unit vector in `dims` dimensions; the sign of each token comes from its hash's low bit. */
export function tokenEmbed(text: string, dims = 64): number[] {
  const vector = new Array<number>(dims).fill(0);
  for (const token of tokenize(text)) {
    const hash = fnv1a(token);
    const index = Math.abs(hash) % dims;
    vector[index] = (vector[index] ?? 0) + (hash & 1 ? 1 : -1);
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }
  const scale = Math.sqrt(norm);
  return vector.map((value) => value / scale);
}

export class TokenEmbedder {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => tokenEmbed(text));
  }
}
