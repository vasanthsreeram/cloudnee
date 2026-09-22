-- Cloudnee graph. One database per deployment; every row carries org_id.
-- The Markdown body is the note a person edits. Edges point at the path
-- they were extracted from. superseded_by is null on the current row.

CREATE TABLE entities (
  org_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'Entity',
  PRIMARY KEY (org_id, entity_id)
);

CREATE TABLE aliases (
  org_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('phone', 'name', 'ontology')),
  PRIMARY KEY (org_id, alias)
);

CREATE TABLE notes (
  org_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, path)
);

CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  relation TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_name TEXT NOT NULL,
  path TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  feedback_weight REAL NOT NULL DEFAULT 0.5,
  superseded_by TEXT,
  created_at INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE INDEX idx_edges_org_source ON edges (org_id, source_id);
CREATE INDEX idx_edges_org_path ON edges (org_id, path);
CREATE INDEX idx_edges_org_target ON edges (org_id, target_id);

CREATE TABLE feedback_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  implicit INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  applied_at INTEGER
);

CREATE INDEX idx_feedback_pending ON feedback_queue (applied_at);
