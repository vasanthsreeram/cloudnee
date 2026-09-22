import type { VectorHit, VectorIndex, VectorPoint } from "./types.ts";

interface StoredPoint {
  values: number[];
  metadata: Record<string, string>;
  insertedAt: number;
}

function cosine(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < length; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/**
 * In-process VectorIndex. Points inserted less than `lagMs` ago stay hidden from
 * queries, which mirrors Vectorize's eventual consistency against D1.
 */
export class MemoryVectorIndex implements VectorIndex {
  private readonly points = new Map<string, StoredPoint>();
  private readonly lagMs: number;
  private readonly clock: () => number;

  constructor(opts?: { lagMs?: number; clock?: () => number }) {
    this.lagMs = opts?.lagMs ?? 0;
    this.clock = opts?.clock ?? Date.now;
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    const insertedAt = this.clock();
    for (const point of points) {
      this.points.set(point.id, {
        values: [...point.values],
        metadata: { ...point.metadata },
        insertedAt,
      });
    }
  }

  async query(
    values: number[],
    topK: number,
    filter: { orgId: string; kind?: string },
  ): Promise<VectorHit[]> {
    const now = this.clock();
    const hits: VectorHit[] = [];
    for (const [id, point] of this.points) {
      if (point.metadata.orgId !== filter.orgId) continue;
      if (filter.kind !== undefined && point.metadata.kind !== filter.kind) continue;
      if (this.lagMs > 0 && now < point.insertedAt + this.lagMs) continue;
      hits.push({ id, similarity: cosine(values, point.values), metadata: { ...point.metadata } });
    }
    hits.sort((left, right) => right.similarity - left.similarity);
    return hits.slice(0, Math.max(0, topK));
  }
}
