/** Extraction prompt and tolerant parsing of a model's JSON reply. */

import type { Extraction, ExtractedEdge, ExtractedEntity } from "./types.ts";

/** Snake-cases a relation: trim, lowercase, non-alphanumeric runs become `_`. */
export function normalizeRelation(relation: string): string {
  return relation
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonBlankString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Parses an extraction result, accepting a JSON string or an already-decoded
 * value. Blank names and incomplete edges are dropped; extra keys are ignored,
 * but a non-object payload throws.
 */
export function parseExtraction(raw: unknown): Extraction {
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!isPlainObject(value)) {
    throw new Error("extraction must be a JSON object");
  }

  const entities: ExtractedEntity[] = [];
  if (Array.isArray(value.entities)) {
    for (const item of value.entities) {
      if (!isPlainObject(item)) continue;
      const name = nonBlankString(item.name);
      if (name === null) continue;
      const entity: ExtractedEntity = { name };
      const type = nonBlankString(item.type);
      if (type !== null) entity.type = type;
      entities.push(entity);
    }
  }

  const edges: ExtractedEdge[] = [];
  if (Array.isArray(value.edges)) {
    for (const item of value.edges) {
      if (!isPlainObject(item)) continue;
      const source = nonBlankString(item.source);
      const relation = nonBlankString(item.relation);
      const target = nonBlankString(item.target);
      if (source === null || relation === null || target === null) continue;
      const edge: ExtractedEdge = {
        source,
        relation: normalizeRelation(relation),
        target,
      };
      const sourceType = nonBlankString(item.sourceType);
      if (sourceType !== null) edge.sourceType = sourceType;
      const targetType = nonBlankString(item.targetType);
      if (targetType !== null) edge.targetType = targetType;
      edges.push(edge);
    }
  }

  return { entities, edges };
}

/** Instructions for a model to extract entities and edges from one chunk. */
export function extractionPrompt(chunkText: string): string {
  return [
    "Extract entities and relationships from the note chunk below.",
    "Reply with JSON only, no prose and no code fences, shaped like:",
    '{"entities":[{"name":"...","type":"..."}],"edges":[{"source":"...","relation":"...","target":"...","sourceType":"...","targetType":"..."}]}',
    "Write each relation in snake_case. Use lives_in for where someone lives (their home) and quoted_price for a price someone was quoted.",
    "Drop entities without a name and edges missing a source, relation, or target.",
    "Note chunk:",
    chunkText,
  ].join("\n");
}
