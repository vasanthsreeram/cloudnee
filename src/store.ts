import type {
  AliasKind,
  EntityRecord,
  GraphStore,
  SqlDb,
  StoredEdge,
} from "./types.ts";

const EDGE_COLUMNS =
  "id, org_id, source_id, source_name, relation, target_id, target_name, path, chunk_id, importance, feedback_weight, superseded_by, created_at, text";

const INSERT_EDGE = `INSERT INTO edges (${EDGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function toEntity(row: Record<string, unknown>): EntityRecord {
  return {
    orgId: toString(row.org_id),
    entityId: toString(row.entity_id),
    displayName: toString(row.display_name),
    entityType: toString(row.entity_type),
  };
}

function toEdge(row: Record<string, unknown>): StoredEdge {
  const supersededBy = row.superseded_by;
  return {
    id: toString(row.id),
    orgId: toString(row.org_id),
    sourceId: toString(row.source_id),
    sourceName: toString(row.source_name),
    relation: toString(row.relation),
    targetId: toString(row.target_id),
    targetName: toString(row.target_name),
    path: toString(row.path),
    chunkId: toString(row.chunk_id),
    importance: toNumber(row.importance),
    feedbackWeight: toNumber(row.feedback_weight),
    supersededBy: supersededBy === null || supersededBy === undefined ? null : String(supersededBy),
    createdAt: toNumber(row.created_at),
    text: toString(row.text),
  };
}

/** GraphStore over any SqlDb (node:sqlite locally, D1 in production). */
export class SqlGraphStore implements GraphStore {
  private readonly db: SqlDb;

  constructor(db: SqlDb) {
    this.db = db;
  }

  async upsertEntity(entity: EntityRecord): Promise<void> {
    await Promise.resolve(
      this.db.run(
        `INSERT INTO entities (org_id, entity_id, display_name, entity_type) VALUES (?, ?, ?, ?)
         ON CONFLICT(org_id, entity_id) DO UPDATE SET
           display_name = excluded.display_name,
           entity_type = excluded.entity_type`,
        [entity.orgId, entity.entityId, entity.displayName, entity.entityType],
      ),
    );
  }

  async upsertAlias(alias: {
    orgId: string;
    alias: string;
    entityId: string;
    kind: AliasKind;
  }): Promise<void> {
    await Promise.resolve(
      this.db.run(
        `INSERT INTO aliases (org_id, alias, entity_id, kind) VALUES (?, ?, ?, ?)
         ON CONFLICT(org_id, alias) DO UPDATE SET
           entity_id = excluded.entity_id,
           kind = excluded.kind`,
        [alias.orgId, alias.alias, alias.entityId, alias.kind],
      ),
    );
  }

  async resolveAlias(orgId: string, alias: string): Promise<string | null> {
    const rows = await Promise.resolve(
      this.db.all<{ entity_id: unknown }>(
        `SELECT entity_id FROM aliases
         WHERE org_id = ? AND alias = ? AND kind IN ('phone', 'name')`,
        [orgId, alias],
      ),
    );
    const row = rows[0];
    return row ? toString(row.entity_id) : null;
  }

  async getEntity(orgId: string, entityId: string): Promise<EntityRecord | null> {
    const rows = await Promise.resolve(
      this.db.all(
        "SELECT org_id, entity_id, display_name, entity_type FROM entities WHERE org_id = ? AND entity_id = ?",
        [orgId, entityId],
      ),
    );
    const row = rows[0];
    return row ? toEntity(row) : null;
  }

  async listEntities(orgId: string): Promise<EntityRecord[]> {
    const rows = await Promise.resolve(
      this.db.all(
        "SELECT org_id, entity_id, display_name, entity_type FROM entities WHERE org_id = ? ORDER BY entity_id",
        [orgId],
      ),
    );
    return rows.map(toEntity);
  }

  async ontologyAliases(orgId: string): Promise<{ alias: string; canonical: string }[]> {
    const rows = await Promise.resolve(
      this.db.all<{ alias: unknown; entity_id: unknown }>(
        "SELECT alias, entity_id FROM aliases WHERE org_id = ? AND kind = 'ontology' ORDER BY alias",
        [orgId],
      ),
    );
    return rows.map((row) => ({ alias: toString(row.alias), canonical: toString(row.entity_id) }));
  }

  async getNote(
    orgId: string,
    path: string,
  ): Promise<{ hash: string; body: string; updatedAt: number } | null> {
    const rows = await Promise.resolve(
      this.db.all<{ content_hash: unknown; body: unknown; updated_at: unknown }>(
        "SELECT content_hash, body, updated_at FROM notes WHERE org_id = ? AND path = ?",
        [orgId, path],
      ),
    );
    const row = rows[0];
    if (!row) return null;
    return {
      hash: toString(row.content_hash),
      body: toString(row.body),
      updatedAt: toNumber(row.updated_at),
    };
  }

  async putNote(
    orgId: string,
    path: string,
    hash: string,
    body: string,
    updatedAt: number,
  ): Promise<void> {
    await Promise.resolve(
      this.db.run(
        `INSERT INTO notes (org_id, path, content_hash, body, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(org_id, path) DO UPDATE SET
           content_hash = excluded.content_hash,
           body = excluded.body,
           updated_at = excluded.updated_at`,
        [orgId, path, hash, body, updatedAt],
      ),
    );
  }

  async listEdges(orgId: string): Promise<StoredEdge[]> {
    const rows = await Promise.resolve(
      this.db.all(
        `SELECT ${EDGE_COLUMNS} FROM edges WHERE org_id = ? ORDER BY created_at, id`,
        [orgId],
      ),
    );
    return rows.map(toEdge);
  }

  async replaceEdges(orgId: string, edges: StoredEdge[]): Promise<void> {
    const inserts = edges.map((edge) => ({
      sql: INSERT_EDGE,
      params: [
        edge.id,
        edge.orgId,
        edge.sourceId,
        edge.sourceName,
        edge.relation,
        edge.targetId,
        edge.targetName,
        edge.path,
        edge.chunkId,
        edge.importance,
        edge.feedbackWeight,
        edge.supersededBy === null ? null : edge.supersededBy,
        edge.createdAt,
        edge.text,
      ],
    }));

    if (this.db.batch) {
      await Promise.resolve(
        this.db.batch([{ sql: "DELETE FROM edges WHERE org_id = ?", params: [orgId] }, ...inserts]),
      );
      return;
    }

    await Promise.resolve(this.db.exec("BEGIN"));
    try {
      await Promise.resolve(this.db.run("DELETE FROM edges WHERE org_id = ?", [orgId]));
      for (const insert of inserts) {
        await Promise.resolve(this.db.run(insert.sql, insert.params));
      }
      await Promise.resolve(this.db.exec("COMMIT"));
    } catch (error) {
      try {
        await Promise.resolve(this.db.exec("ROLLBACK"));
      } catch {
        // The transaction may already be closed by the driver.
      }
      throw error;
    }
  }

  async setFeedbackWeight(orgId: string, edgeId: string, weight: number): Promise<void> {
    await Promise.resolve(
      this.db.run("UPDATE edges SET feedback_weight = ? WHERE org_id = ? AND id = ?", [
        weight,
        orgId,
        edgeId,
      ]),
    );
  }

  async enqueueFeedback(
    orgId: string,
    edgeIds: string[],
    score: number,
    implicit: boolean,
    now: number,
  ): Promise<void> {
    for (const edgeId of edgeIds) {
      await Promise.resolve(
        this.db.run(
          `INSERT INTO feedback_queue (org_id, edge_id, score, implicit, created_at, applied_at)
           VALUES (?, ?, ?, ?, ?, NULL)`,
          [orgId, edgeId, score, implicit ? 1 : 0, now],
        ),
      );
    }
  }

  async pendingFeedback(): Promise<
    { id: number; orgId: string; edgeId: string; score: number; implicit: boolean }[]
  > {
    const rows = await Promise.resolve(
      this.db.all<{
        id: unknown;
        org_id: unknown;
        edge_id: unknown;
        score: unknown;
        implicit: unknown;
      }>(
        `SELECT id, org_id, edge_id, score, implicit FROM feedback_queue
         WHERE applied_at IS NULL ORDER BY id`,
      ),
    );
    return rows.map((row) => ({
      id: toNumber(row.id),
      orgId: toString(row.org_id),
      edgeId: toString(row.edge_id),
      score: toNumber(row.score),
      implicit: toNumber(row.implicit) !== 0,
    }));
  }

  async markFeedbackApplied(ids: number[], now: number): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    await Promise.resolve(
      this.db.run(`UPDATE feedback_queue SET applied_at = ? WHERE id IN (${placeholders})`, [
        now,
        ...ids,
      ]),
    );
  }
}
