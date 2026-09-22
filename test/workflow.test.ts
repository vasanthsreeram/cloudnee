import assert from "node:assert/strict";
import test from "node:test";
import { TokenEmbedder } from "../src/embed.ts";
import { SqlGraphStore } from "../src/store.ts";
import { openSqlite } from "../src/sqlite.ts";
import { MemoryVectorIndex } from "../src/vectors.ts";
import { cognifySteps } from "../src/workflow-steps.ts";
import type { CloudneeDeps, Extraction, Extractor } from "../src/types.ts";

const PAGE = JSON.stringify({
  entities: [{ name: "Mrs Tan", type: "Person" }],
  edges: [{ source: "Mrs Tan", relation: "has_rule", target: "baby" }],
});

function setup() {
  const opened = openSqlite();
  const extractor: Extractor & { calls: number } = {
    calls: 0,
    async extract(text: string): Promise<Extraction> {
      extractor.calls += 1;
      return JSON.parse(text) as Extraction;
    },
  };
  const deps: CloudneeDeps = {
    store: new SqlGraphStore(opened.db),
    vectors: new MemoryVectorIndex(),
    embedder: new TokenEmbedder(),
    extractor,
    clock: () => 50,
  };
  return { deps, extractor, close: () => opened.close() };
}

test("a changed page runs hash, extract, write, then embed", async () => {
  const { deps, extractor, close } = setup();
  const names: string[] = [];
  const result = await cognifySteps(
    deps,
    { orgId: "coolair", path: "customers/6591234567.md", markdown: PAGE, now: 50 },
    {
      async do(name, fn) {
        names.push(name);
        return fn();
      },
    },
  );
  assert.deepEqual(names, ["hash", "extract", "write", "embed"]);
  assert.equal(result.status, "written");
  assert.equal(extractor.calls, 1);
  assert.ok(result.edgeIds.length >= 1);
  close();
});

test("an unchanged page stops after hash", async () => {
  const { deps, extractor, close } = setup();
  await cognifySteps(
    deps,
    { orgId: "coolair", path: "customers/6591234567.md", markdown: PAGE, now: 50 },
    { async do(_name, fn) { return fn(); } },
  );
  const names: string[] = [];
  const again = await cognifySteps(
    deps,
    { orgId: "coolair", path: "customers/6591234567.md", markdown: PAGE, now: 80 },
    {
      async do(name, fn) {
        names.push(name);
        return fn();
      },
    },
  );
  assert.deepEqual(names, ["hash"]);
  assert.equal(again.status, "unchanged");
  assert.equal(extractor.calls, 1);
  close();
});
