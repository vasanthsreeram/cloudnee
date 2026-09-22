/** Entity identity: name normalization, similarity, and Cognee's merge gate. */

export interface MergeMember {
  name: string;
  type: string;
  vector?: readonly number[];
}

/** Lowercase and drop every character outside [a-z0-9]. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Entity ids are normalized names, so two spellings of one name share a row. */
export function entityIdForName(name: string): string {
  return normalizeName(name);
}

/** Cosine similarity over the common prefix; a zero-length norm scores 0. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function shouldMergeEntities(
  a: MergeMember,
  b: MergeMember,
  opts?: { threshold?: number; allowCrossType?: boolean },
): boolean {
  const threshold = opts?.threshold ?? 0.85;
  const allowCrossType = opts?.allowCrossType ?? false;
  const nameA = normalizeName(a.name);
  const nameB = normalizeName(b.name);
  if (nameA === "" || nameB === "") return false;
  const sameType = allowCrossType || a.type === b.type;
  if (nameA === nameB) return sameType;
  if (!sameType) return false;
  const vectorA = a.vector;
  const vectorB = b.vector;
  if (!vectorA || !vectorB || vectorA.length === 0 || vectorB.length === 0) return false;
  return cosineSimilarity(vectorA, vectorB) >= threshold;
}
