import assert from "node:assert/strict";
import test from "node:test";
import { SqlGraphStore } from "../src/store.ts";
import { openSqlite } from "../src/sqlite.ts";
import type { StoredEdge } from "../src/types.ts";

function edge(id: string): StoredEdge {
  return {
    id,
    orgId: "coolair",
    sourceId: "mrstan",
    sourceName: "Mrs Tan",
    relation: "has_rule",
    targetId: "baby",
    targetName: "baby",
    path: "customers/6591234567.md",
    chunkId: "c0",
    importance: 0.5,
    feedbackWeight: 0.5,
    supersededBy: null,
    createdAt: 10,
    text: "Mrs Tan has_rule baby",
  };
}

test("SqlGraphStore round-trips entities, aliases, notes, and edges", async () => {
  const opened = openSqlite();
  const store = new SqlGraphStore(opened.db);
  await store.upsertEntity({
    orgId: "coolair",
    entityId: "mrstan",
    displayName: "Mrs Tan",
    entityType: "Person",
  });
  await store.upsertAlias({
    orgId: "coolair",
    alias: "6591234567",
    entityId: "mrstan",
    kind: "phone",
  });
  await store.upsertAlias({
    orgId: "coolair",
    alias: "hvac",
    entityId: "aircon",
    kind: "ontology",
  });
  assert.equal(await store.resolveAlias("coolair", "6591234567"), "mrstan");
  assert.equal(await store.resolveAlias("coolair", "hvac"), null);
  assert.deepEqual(await store.ontologyAliases("coolair"), [{ alias: "hvac", canonical: "aircon" }]);
  await store.putNote("coolair", "customers/6591234567.md", "abc", "hello", 10);
  assert.equal((await store.getNote("coolair", "customers/6591234567.md"))?.hash, "abc");
  await store.replaceEdges("coolair", [edge("e1")]);
  const listed = await store.listEdges("coolair");
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.supersededBy, null);
  assert.equal(listed[0]?.feedbackWeight, 0.5);
  await store.setFeedbackWeight("coolair", "e1", 0.55);
  assert.equal((await store.listEdges("coolair"))[0]?.feedbackWeight, 0.55);
  await store.enqueueFeedback("coolair", ["e1"], 5, false, 20);
  const pending = await store.pendingFeedback();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.score, 5);
  assert.equal(pending[0]?.implicit, false);
  await store.markFeedbackApplied([pending[0]!.id], 30);
  assert.equal((await store.pendingFeedback()).length, 0);
  await store.replaceEdges("coolair", []);
  assert.equal((await store.listEdges("coolair")).length, 0);
  assert.equal((await store.listEntities("coolair")).length, 1);
  opened.close();
});
