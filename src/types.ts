/** Shared contracts. Implementations live beside this file. */

export type Audience = "owner" | "public";
export type AliasKind = "phone" | "name" | "ontology";

export interface SqlDb {
  exec(sql: string): void | Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] | Promise<T[]>;
  run(sql: string, params?: unknown[]): void | Promise<void>;
  /** One atomic group of statements. D1 needs `batch`; interactive BEGIN/COMMIT does not survive across calls. */
  batch?(statements: { sql: string; params?: unknown[] }[]): void | Promise<void>;
}

export interface ExtractedEntity {
  name: string;
  type?: string;
}

export interface ExtractedEdge {
  source: string;
  relation: string;
  target: string;
  sourceType?: string;
  targetType?: string;
}

export interface Extraction {
  entities: ExtractedEntity[];
  edges: ExtractedEdge[];
}

export interface Extractor {
  extract(text: string): Promise<Extraction>;
}

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorPoint {
  id: string;
  values: number[];
  metadata: Record<string, string>;
}

export interface VectorHit {
  id: string;
  /** Cosine similarity, higher is nearer. Distance used in ranking is 1 - similarity. */
  similarity: number;
  metadata: Record<string, string>;
}

export interface VectorIndex {
  upsert(points: VectorPoint[]): Promise<void>;
  query(
    values: number[],
    topK: number,
    filter: { orgId: string; kind?: string },
  ): Promise<VectorHit[]>;
}

export interface StoredEdge {
  id: string;
  orgId: string;
  sourceId: string;
  sourceName: string;
  relation: string;
  targetId: string;
  targetName: string;
  path: string;
  chunkId: string;
  importance: number;
  feedbackWeight: number;
  supersededBy: string | null;
  createdAt: number;
  text: string;
}

export interface EntityRecord {
  orgId: string;
  entityId: string;
  displayName: string;
  entityType: string;
}

export interface RememberInput {
  orgId: string;
  path: string;
  markdown: string;
  links?: { alias: string; name: string; kind: "phone" | "name" }[];
  now?: number;
}

export interface RememberResult {
  status: "unchanged" | "written";
  hash: string;
  edgeIds: string[];
}

export interface RecallHit {
  edge: StoredEdge;
  score: number;
}

export interface RecallInput {
  orgId: string;
  query: string;
  audience?: Audience;
  topK?: number;
  wideK?: number;
  /** Cognee's default is 0, which leaves feedback out of the score. */
  feedbackInfluence?: number;
}

export interface CloudneeDeps {
  store: GraphStore;
  vectors: VectorIndex;
  embedder: Embedder;
  extractor: Extractor;
  clock?: () => number;
}

export interface GraphStore {
  upsertEntity(entity: EntityRecord): Promise<void>;
  upsertAlias(alias: {
    orgId: string;
    alias: string;
    entityId: string;
    kind: AliasKind;
  }): Promise<void>;
  resolveAlias(orgId: string, alias: string): Promise<string | null>;
  getEntity(orgId: string, entityId: string): Promise<EntityRecord | null>;
  listEntities(orgId: string): Promise<EntityRecord[]>;
  ontologyAliases(orgId: string): Promise<{ alias: string; canonical: string }[]>;
  getNote(orgId: string, path: string): Promise<{ hash: string; body: string; updatedAt: number } | null>;
  putNote(orgId: string, path: string, hash: string, body: string, updatedAt: number): Promise<void>;
  listEdges(orgId: string): Promise<StoredEdge[]>;
  replaceEdges(orgId: string, edges: StoredEdge[]): Promise<void>;
  setFeedbackWeight(orgId: string, edgeId: string, weight: number): Promise<void>;
  enqueueFeedback(
    orgId: string,
    edgeIds: string[],
    score: number,
    implicit: boolean,
    now: number,
  ): Promise<void>;
  pendingFeedback(): Promise<
    { id: number; orgId: string; edgeId: string; score: number; implicit: boolean }[]
  >;
  markFeedbackApplied(ids: number[], now: number): Promise<void>;
}
