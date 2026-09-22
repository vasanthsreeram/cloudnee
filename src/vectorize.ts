import type { VectorHit, VectorIndex, VectorPoint } from "./types.ts";

/** Structural Vectorize binding, mirroring the pieces the adapter needs. */
export interface VectorizeLike {
  upsert(
    vectors: { id: string; values: number[]; metadata?: Record<string, string> }[],
  ): Promise<unknown>;
  query(
    vector: number[],
    options: {
      topK: number;
      returnMetadata: "all" | "none" | "indexed";
      filter?: Record<string, string>;
    },
  ): Promise<{ matches?: { id: string; score?: number; metadata?: Record<string, unknown> }[] }>;
}

export function vectorizeIndex(index: VectorizeLike): VectorIndex {
  return {
    async upsert(points: VectorPoint[]): Promise<void> {
      await index.upsert(
        points.map((point) => ({
          id: point.id,
          values: point.values,
          metadata: point.metadata,
        })),
      );
    },
    async query(
      values: number[],
      topK: number,
      filter: { orgId: string; kind?: string },
    ): Promise<VectorHit[]> {
      const metadata: Record<string, string> = { orgId: filter.orgId };
      if (filter.kind !== undefined) metadata.kind = filter.kind;
      const result = await index.query(values, {
        topK,
        returnMetadata: "all",
        filter: metadata,
      });
      return (result.matches ?? []).map((match) => ({
        id: match.id,
        similarity: match.score ?? 0,
        metadata: stringMetadata(match.metadata),
      }));
    },
  };
}

function stringMetadata(raw: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    out[key] = String(value);
  }
  return out;
}
