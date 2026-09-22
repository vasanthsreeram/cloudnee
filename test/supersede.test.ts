import assert from "node:assert/strict";
import test from "node:test";
import { applySupersession, isFunctionalRelation, retireMissingPathEdges } from "../src/supersede.ts";
import type { SuperEdge } from "../src/supersede.ts";

function edge(partial: Partial<SuperEdge> & Pick<SuperEdge, "id" | "sourceId" | "relation" | "targetId" | "path" | "createdAt">): SuperEdge {
  return { supersededBy: null, ...partial };
}

test("functional relations keep the newest target and point the old row at it", () => {
  assert.equal(isFunctionalRelation("quoted_price"), true);
  assert.equal(isFunctionalRelation("has_baby"), false);
  const next = applySupersession([
    edge({
      id: "old",
      sourceId: "mrstan",
      relation: "quoted_price",
      targetId: "180",
      path: "customers/a.md",
      createdAt: 1,
    }),
    edge({
      id: "new",
      sourceId: "mrstan",
      relation: "quoted_price",
      targetId: "160",
      path: "customers/a.md",
      createdAt: 2,
    }),
    edge({
      id: "baby",
      sourceId: "mrstan",
      relation: "has_rule",
      targetId: "baby",
      path: "customers/a.md",
      createdAt: 1,
    }),
  ]);
  const byId = Object.fromEntries(next.map((row) => [row.id, row.supersededBy]));
  assert.equal(byId.old, "new");
  assert.equal(byId.new, null);
  assert.equal(byId.baby, null);
});

test("a path edit retires facts that paragraph no longer states", () => {
  const retired = retireMissingPathEdges(
    [
      edge({
        id: "bedok",
        sourceId: "mrstan",
        relation: "lives_in",
        targetId: "bedok",
        path: "customers/a.md",
        createdAt: 1,
      }),
      edge({
        id: "other",
        sourceId: "mrstan",
        relation: "has_rule",
        targetId: "baby",
        path: "customers/b.md",
        createdAt: 1,
      }),
    ],
    "customers/a.md",
    new Set(["mrstan|lives_in|bedoksouth"]),
    "replaced:abc",
  );
  assert.equal(retired.find((row) => row.id === "bedok")?.supersededBy, "replaced:abc");
  assert.equal(retired.find((row) => row.id === "other")?.supersededBy, null);
});
