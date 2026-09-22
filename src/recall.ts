/** The read path: alias resolution, current/history reads, and triplet recall. */

import { tokenize } from "./embed.ts";
import { applyFeedbackWeight } from "./feedback.ts";
import { normalizeName } from "./identity.ts";
import { expandQuery } from "./ontology.ts";
import { canReadPath } from "./permissions.ts";
import {
  DEFAULT_TOP_K,
  DEFAULT_WIDE_K,
  TRIPLET_DISTANCE_PENALTY,
  scoreTriplet,
  topK,
} from "./rank.ts";
import type {
  Audience,
  CloudneeDeps,
  GraphStore,
  RecallHit,
  RecallInput,
  StoredEdge,
} from "./types.ts";

const MIN_TOKEN_LENGTH = 3;
const DEFAULT_AUDIENCE: Audience = "owner";

/** Teach the ontology a synonym; ontology aliases expand queries, never resolve an entity. */
export async function teachAlias(
  store: GraphStore,
  orgId: string,
  alias: string,
  canonical: string,
): Promise<void> {
  const normalizedAlias = normalizeName(alias);
  const canonicalId = normalizeName(canonical);
  if (!normalizedAlias || !canonicalId) return;
  await store.upsertAlias({ orgId, alias: normalizedAlias, entityId: canonicalId, kind: "ontology" });
}

/** Resolve a phone/name/ontology handle to a stored entity id, or null. */
export async function resolveToEntity(
  store: GraphStore,
  orgId: string,
  aliasOrName: string,
): Promise<string | null> {
  const key = normalizeName(aliasOrName);
  if (!key) return null;
  const aliased = await store.resolveAlias(orgId, key);
  if (aliased) return aliased;
  const entity = await store.getEntity(orgId, key);
  return entity ? entity.entityId : null;
}

/** Current edges touching the resolved entity, filtered by audience. */
export async function readCurrent(
  store: GraphStore,
  orgId: string,
  aliasOrName: string,
  audience: Audience = DEFAULT_AUDIENCE,
): Promise<StoredEdge[]> {
  const entityId = await resolveToEntity(store, orgId, aliasOrName);
  if (!entityId) return [];
  const edges = await store.listEdges(orgId);
  return edges.filter(
    (edge) =>
      edge.supersededBy === null &&
      (edge.sourceId === entityId || edge.targetId === entityId) &&
      canReadPath(edge.path, audience),
  );
}

/** Every edge touching the resolved entity, superseded rows included, newest first. */
export async function history(
  store: GraphStore,
  orgId: string,
  aliasOrName: string,
  audience: Audience = DEFAULT_AUDIENCE,
): Promise<StoredEdge[]> {
  const entityId = await resolveToEntity(store, orgId, aliasOrName);
  if (!entityId) return [];
  const edges = await store.listEdges(orgId);
  return edges
    .filter(
      (edge) =>
        (edge.sourceId === entityId || edge.targetId === entityId) &&
        canReadPath(edge.path, audience),
    )
    .sort((left, right) => right.createdAt - left.createdAt);
}

/** Expand, embed, and rank the current edges as source/relation/target triplets. */
export async function recall(
  deps: CloudneeDeps,
  input: RecallInput,
): Promise<{ hits: RecallHit[] }> {
  const audience = input.audience ?? DEFAULT_AUDIENCE;
  const topKCount = input.topK ?? DEFAULT_TOP_K;
  const wideK = input.wideK ?? DEFAULT_WIDE_K;
  const feedbackInfluence = input.feedbackInfluence ?? 0;

  const aliases = await deps.store.ontologyAliases(input.orgId);
  const query = expandQuery(input.query, aliases);
  if (query.trim() === "") return { hits: [] };

  const [queryVector] = await deps.embedder.embed([query]);

  const entityDistances = new Map<string, number>();
  const edgeDistances = new Map<string, number>();
  if (queryVector) {
    const entityHits = await deps.vectors.query(queryVector, wideK, {
      orgId: input.orgId,
      kind: "entity",
    });
    for (const hit of entityHits) {
      const entityId = hit.metadata.entityId;
      if (!entityId) continue;
      const distance = 1 - hit.similarity;
      const previous = entityDistances.get(entityId);
      if (previous === undefined || distance < previous) entityDistances.set(entityId, distance);
    }
    const edgeHits = await deps.vectors.query(queryVector, wideK, {
      orgId: input.orgId,
      kind: "edge",
    });
    for (const hit of edgeHits) {
      const edgeId = hit.metadata.edgeId ?? hit.id;
      if (!edgeId) continue;
      const distance = 1 - hit.similarity;
      const previous = edgeDistances.get(edgeId);
      if (previous === undefined || distance < previous) edgeDistances.set(edgeId, distance);
    }
  }

  const queryTokens = tokenize(query).filter((token) => token.length >= MIN_TOKEN_LENGTH);
  const edges = await deps.store.listEdges(input.orgId);
  const candidates = edges.filter((edge) => {
    if (edge.supersededBy !== null) return false;
    if (!canReadPath(edge.path, audience)) return false;
    if (entityDistances.has(edge.sourceId) || entityDistances.has(edge.targetId)) return true;
    if (edgeDistances.has(edge.id)) return true;
    if (queryTokens.length === 0) return false;
    const tokens = new Set(
      tokenize(`${edge.sourceName} ${edge.relation} ${edge.targetName} ${edge.text}`),
    );
    return queryTokens.some((token) => tokens.has(token));
  });

  const scored: RecallHit[] = candidates.map((edge) => {
    const importance = edge.importance;
    const feedbackWeight = edge.feedbackWeight;
    return {
      edge,
      score: scoreTriplet(
        {
          source: {
            distance: entityDistances.get(edge.sourceId) ?? TRIPLET_DISTANCE_PENALTY,
            importance,
            feedbackWeight,
          },
          relation: {
            distance: edgeDistances.get(edge.id) ?? TRIPLET_DISTANCE_PENALTY,
            importance,
            feedbackWeight,
          },
          target: {
            distance: entityDistances.get(edge.targetId) ?? TRIPLET_DISTANCE_PENALTY,
            importance,
            feedbackWeight,
          },
        },
        { feedbackInfluence },
      ),
    };
  });

  return { hits: topK(scored, topKCount, (hit) => hit.score) };
}

/** The source entity whose edge text covers the most query words. */
export function bestCoveredEntity(hits: RecallHit[], query: string): string | null {
  if (hits.length === 0) return null;
  const queryTokens = tokenize(query).filter((token) => token.length >= MIN_TOKEN_LENGTH);
  const totals = new Map<string, number>();
  for (const hit of hits) {
    const tokens = new Set(tokenize(hit.edge.text));
    let covered = 0;
    for (const token of queryTokens) if (tokens.has(token)) covered += 1;
    totals.set(hit.edge.sourceId, (totals.get(hit.edge.sourceId) ?? 0) + covered);
  }
  let winner: string | null = null;
  let best = -1;
  for (const [entityId, total] of totals) {
    if (total > best || (total === best && winner !== null && entityId < winner)) {
      winner = entityId;
      best = total;
    }
  }
  return winner;
}

/** Drain the feedback queue into the running edge weights. */
export async function applyPendingFeedback(store: GraphStore, now = Date.now()): Promise<number> {
  const pending = await store.pendingFeedback();
  for (const row of pending) {
    const edges = await store.listEdges(row.orgId);
    const edge = edges.find((candidate) => candidate.id === row.edgeId);
    if (!edge) continue;
    const weight = applyFeedbackWeight(edge.feedbackWeight, row.score, { implicit: row.implicit });
    await store.setFeedbackWeight(row.orgId, edge.id, weight);
  }
  await store.markFeedbackApplied(
    pending.map((row) => row.id),
    now,
  );
  return pending.length;
}

/** Queue feedback for edges, then apply it immediately. */
export async function improve(
  store: GraphStore,
  orgId: string,
  edgeIds: string[],
  score: number,
  opts?: { implicit?: boolean; now?: number },
): Promise<number> {
  const implicit = opts?.implicit ?? false;
  const now = opts?.now ?? Date.now();
  await store.enqueueFeedback(orgId, edgeIds, score, implicit, now);
  return applyPendingFeedback(store, now);
}
