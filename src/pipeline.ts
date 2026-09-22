/** The write path: hash a page, extract it, merge entities, and store the graph. */

import { chunkMarkdown } from "./chunk.ts";
import { contentHash, edgeIdFor } from "./hash.ts";
import { entityIdForName, normalizeName, shouldMergeEntities } from "./identity.ts";
import { applySupersession, retireMissingPathEdges } from "./supersede.ts";
import type {
  CloudneeDeps,
  ExtractedEdge,
  ExtractedEntity,
  Extraction,
  GraphStore,
  RememberInput,
  RememberResult,
  StoredEdge,
  VectorPoint,
} from "./types.ts";

const DEFAULT_TYPE = "Entity";
/** Extraction is not chunk-aware here, so every edge is stamped to the first chunk. */
const DEFAULT_CHUNK_ID = "c0";
const DEFAULT_IMPORTANCE = 0.5;
const DEFAULT_FEEDBACK_WEIGHT = 0.5;

export async function hashNote(markdown: string): Promise<string> {
  return contentHash(markdown);
}

export async function noteIsUnchanged(
  store: GraphStore,
  orgId: string,
  path: string,
  hash: string,
): Promise<boolean> {
  const note = await store.getNote(orgId, path);
  return note?.hash === hash;
}

/** Chunk the page, extract every chunk, and concatenate the entities and edges. */
export async function extractMarkdown(
  extractor: CloudneeDeps["extractor"],
  markdown: string,
): Promise<Extraction> {
  const entities: ExtractedEntity[] = [];
  const edges: ExtractedEdge[] = [];
  for (const chunk of chunkMarkdown(markdown)) {
    const extraction = await extractor.extract(chunk.text);
    entities.push(...(extraction.entities ?? []));
    edges.push(...(extraction.edges ?? []));
  }
  return { entities, edges };
}

interface Member {
  entityId: string;
  name: string;
  type: string;
  vector: number[];
}

function endpointId(raw: string | undefined): string {
  return entityIdForName((raw ?? "").trim());
}

function relationOf(raw: string | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Merge this page's entity mentions, rewrite its edges onto the survivor ids,
 * and replace the org's edge rows with the new set.
 */
export async function writeGraph(
  deps: CloudneeDeps,
  input: RememberInput,
  extraction: Extraction,
  hash: string,
): Promise<string[]> {
  const now = input.now ?? deps.clock?.() ?? Date.now();
  const { store, embedder } = deps;

  // 1. Collect every name mentioned by an entity or an edge endpoint.
  const members = new Map<string, Member>();
  const collect = (rawName: string | undefined, rawType: string | undefined): void => {
    const name = (rawName ?? "").trim();
    const entityId = entityIdForName(name);
    if (!entityId) return;
    const type = rawType?.trim() || DEFAULT_TYPE;
    const existing = members.get(entityId);
    if (!existing) {
      members.set(entityId, { entityId, name, type, vector: [] });
    } else if (existing.type === DEFAULT_TYPE && type !== DEFAULT_TYPE) {
      existing.type = type;
    }
  };
  const declared = new Set<string>();
  for (const entity of extraction.entities ?? []) {
    collect(entity.name, entity.type);
    const entityId = entityIdForName((entity.name ?? "").trim());
    if (entityId) declared.add(entityId);
  }
  for (const edge of extraction.edges ?? []) {
    collect(edge.source, edge.sourceType);
    collect(edge.target, edge.targetType);
  }

  // 2. Cosine merge over the display-name vectors.
  const ids = [...members.keys()];
  if (ids.length > 0) {
    const vectors = await embedder.embed(ids.map((id) => members.get(id)!.name));
    ids.forEach((id, index) => {
      members.get(id)!.vector = vectors[index] ?? [];
    });
  }

  const parent = new Map<string, string>(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const left = members.get(ids[i]!)!;
      const right = members.get(ids[j]!)!;
      // Edge-only endpoints are values, not subjects: never merge two of them
      // together, or a weak embedder collapses distinct facts such as baby/smell.
      if (!declared.has(left.entityId) && !declared.has(right.entityId)) continue;
      if (
        shouldMergeEntities(
          { name: left.name, type: left.type, vector: left.vector },
          { name: right.name, type: right.type, vector: right.vector },
        )
      ) {
        const leftRoot = find(left.entityId);
        const rightRoot = find(right.entityId);
        if (leftRoot !== rightRoot) parent.set(leftRoot, rightRoot);
      }
    }
  }

  const incidentCount = (entityId: string): number => {
    let count = 0;
    for (const edge of extraction.edges ?? []) {
      if (endpointId(edge.source) === entityId || endpointId(edge.target) === entityId) count += 1;
    }
    return count;
  };

  const groups = new Map<string, Member[]>();
  for (const id of ids) {
    const root = find(id);
    const group = groups.get(root) ?? [];
    group.push(members.get(id)!);
    groups.set(root, group);
  }

  const survivorByEntity = new Map<string, string>();
  const survivors = new Map<string, { displayName: string; entityType: string }>();
  for (const group of groups.values()) {
    let survivor = group[0]!;
    let best = incidentCount(survivor.entityId);
    for (const candidate of group.slice(1)) {
      const count = incidentCount(candidate.entityId);
      if (count > best || (count === best && candidate.entityId < survivor.entityId)) {
        survivor = candidate;
        best = count;
      }
    }
    const specific = group.find((member) => member.type !== DEFAULT_TYPE);
    for (const member of group) survivorByEntity.set(member.entityId, survivor.entityId);
    survivors.set(survivor.entityId, {
      displayName: survivor.name,
      entityType: specific?.type ?? survivor.type,
    });
  }

  const ensured = new Set<string>();
  for (const [entityId, record] of survivors) {
    await store.upsertEntity({
      orgId: input.orgId,
      entityId,
      displayName: record.displayName,
      entityType: record.entityType,
    });
    ensured.add(entityId);
  }
  for (const member of members.values()) {
    const survivorId = survivorByEntity.get(member.entityId);
    if (survivorId === undefined || survivorId === member.entityId) continue;
    await store.upsertAlias({
      orgId: input.orgId,
      alias: member.entityId,
      entityId: survivorId,
      kind: "name",
    });
  }

  const displayNameOf = (entityId: string): string =>
    survivors.get(entityId)?.displayName ?? members.get(entityId)?.name ?? entityId;

  // 3. Phone/name links resolve through the merge map and may introduce new entities.
  for (const link of input.links ?? []) {
    const alias = normalizeName(link.alias);
    if (!alias) continue;
    const targetName = (link.name ?? "").trim();
    const targetKey = entityIdForName(targetName);
    if (!targetKey) continue;
    const targetId = survivorByEntity.get(targetKey) ?? targetKey;
    if (!ensured.has(targetId)) {
      await store.upsertEntity({
        orgId: input.orgId,
        entityId: targetId,
        displayName: targetName,
        entityType: DEFAULT_TYPE,
      });
      ensured.add(targetId);
    }
    await store.upsertAlias({ orgId: input.orgId, alias, entityId: targetId, kind: link.kind });
  }

  // 4. Build this page's edges onto the survivor ids.
  const incoming = new Map<string, StoredEdge>();
  for (const edge of extraction.edges ?? []) {
    const sourceId = survivorByEntity.get(endpointId(edge.source)) ?? endpointId(edge.source);
    const targetId = survivorByEntity.get(endpointId(edge.target)) ?? endpointId(edge.target);
    const relation = relationOf(edge.relation);
    if (!sourceId || !targetId || !relation) continue;
    const sourceName = displayNameOf(sourceId);
    const targetName = displayNameOf(targetId);
    const id = await edgeIdFor(input.orgId, input.path, DEFAULT_CHUNK_ID, sourceId, relation, targetId);
    incoming.set(id, {
      id,
      orgId: input.orgId,
      sourceId,
      sourceName,
      relation,
      targetId,
      targetName,
      path: input.path,
      chunkId: DEFAULT_CHUNK_ID,
      importance: DEFAULT_IMPORTANCE,
      feedbackWeight: DEFAULT_FEEDBACK_WEIGHT,
      supersededBy: null,
      createdAt: now,
      text: `${sourceName} ${relation} ${targetName}`,
    });
    if (!ensured.has(targetId)) {
      await store.upsertEntity({
        orgId: input.orgId,
        entityId: targetId,
        displayName: targetName,
        entityType: DEFAULT_TYPE,
      });
      ensured.add(targetId);
    }
  }

  // 5. Reconcile with the stored rows: keep learned feedback and first-seen time.
  const existing = await store.listEdges(input.orgId);
  const existingById = new Map(existing.map((edge) => [edge.id, edge]));
  const merged = existing.map((edge) => ({ ...edge }));
  const indexById = new Map(merged.map((edge, index) => [edge.id, index]));
  for (const edge of incoming.values()) {
    const previous = existingById.get(edge.id);
    const row: StoredEdge = previous
      ? { ...edge, feedbackWeight: previous.feedbackWeight, createdAt: previous.createdAt }
      : { ...edge };
    const index = indexById.get(edge.id);
    if (index === undefined) {
      indexById.set(edge.id, merged.length);
      merged.push(row);
    } else {
      merged[index] = row;
    }
  }

  const incomingKeys = new Set(
    [...incoming.values()].map((edge) => `${edge.sourceId}|${edge.relation}|${edge.targetId}`),
  );
  const retired = retireMissingPathEdges(merged, input.path, incomingKeys, `replaced:${hash}`);
  const superseded = applySupersession(retired);
  const mergedById = new Map(merged.map((edge) => [edge.id, edge]));
  const result: StoredEdge[] = superseded.map((row) => {
    const base = mergedById.get(row.id);
    return base ? { ...base, supersededBy: row.supersededBy } : (row as StoredEdge);
  });

  await store.replaceEdges(input.orgId, result);
  await store.putNote(input.orgId, input.path, hash, input.markdown, now);

  return result
    .filter((edge) => edge.path === input.path && edge.supersededBy === null)
    .map((edge) => edge.id);
}

/** Upsert the entity and current-edge vector points the next recall will read. */
export async function embedGraph(deps: CloudneeDeps, orgId: string): Promise<void> {
  const entities = await deps.store.listEntities(orgId);
  const edges = (await deps.store.listEdges(orgId)).filter((edge) => edge.supersededBy === null);
  const points: VectorPoint[] = [];

  if (entities.length > 0) {
    const vectors = await deps.embedder.embed(entities.map((entity) => entity.displayName));
    entities.forEach((entity, index) => {
      points.push({
        id: `ent:${orgId}:${entity.entityId}`,
        values: vectors[index] ?? [],
        metadata: { orgId, kind: "entity", entityId: entity.entityId },
      });
    });
  }

  if (edges.length > 0) {
    const vectors = await deps.embedder.embed(edges.map((edge) => edge.text));
    edges.forEach((edge, index) => {
      points.push({
        id: `edge:${edge.id}`,
        values: vectors[index] ?? [],
        metadata: { orgId, kind: "edge", edgeId: edge.id, path: edge.path },
      });
    });
  }

  if (points.length === 0) return;
  await deps.vectors.upsert(points);
}

/**
 * The one write path: hash, skip when unchanged, otherwise extract, write, embed.
 * workflow-steps.ts repeats this sequence with named steps so both share it.
 */
export async function remember(deps: CloudneeDeps, input: RememberInput): Promise<RememberResult> {
  const hash = await hashNote(input.markdown);
  if (await noteIsUnchanged(deps.store, input.orgId, input.path, hash)) {
    return { status: "unchanged", hash, edgeIds: [] };
  }
  const extraction = await extractMarkdown(deps.extractor, input.markdown);
  const edgeIds = await writeGraph(deps, input, extraction, hash);
  await embedGraph(deps, input.orgId);
  return { status: "written", hash, edgeIds };
}
