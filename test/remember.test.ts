import assert from "node:assert/strict";
import test from "node:test";
import { cosineSimilarity } from "../src/identity.ts";
import { improve, readCurrent, recall, remember } from "../src/index.ts";
import { SqlGraphStore } from "../src/store.ts";
import { openSqlite } from "../src/sqlite.ts";
import { TokenEmbedder, tokenEmbed } from "../src/embed.ts";
import { MemoryVectorIndex } from "../src/vectors.ts";
import type { CloudneeDeps, Extraction, Extractor } from "../src/types.ts";

function jsonExtractor(): Extractor & { calls: number } {
  const extractor = {
    calls: 0,
    async extract(text: string): Promise<Extraction> {
      extractor.calls += 1;
      const trimmed = text.trim();
      if (!trimmed.startsWith("{")) return { entities: [], edges: [] };
      return JSON.parse(trimmed) as Extraction;
    },
  };
  return extractor;
}

function harness(embedder: CloudneeDeps["embedder"] = new TokenEmbedder()): {
  deps: CloudneeDeps;
  extractor: Extractor & { calls: number };
  close: () => void;
} {
  const opened = openSqlite();
  const extractor = jsonExtractor();
  const deps: CloudneeDeps = {
    store: new SqlGraphStore(opened.db),
    vectors: new MemoryVectorIndex(),
    embedder,
    extractor,
    clock: () => 1_000,
  };
  return { deps, extractor, close: () => opened.close() };
}

test("tokenEmbed is stable and unit length", () => {
  const a = tokenEmbed("aircon east");
  assert.equal(cosineSimilarity(a, tokenEmbed("aircon east")), 1);
  assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-9);
  assert.ok(cosineSimilarity(a, tokenEmbed("plumbing invoice")) < 0.8);
});

test("a second remember of the same page does not extract again", async () => {
  const { deps, extractor, close } = harness();
  const markdown = JSON.stringify({
    entities: [{ name: "Mrs Tan", type: "Person" }],
    edges: [{ source: "Mrs Tan", relation: "has_rule", target: "baby" }],
  });
  const first = await remember(deps, {
    orgId: "coolair",
    path: "customers/6591234567.md",
    markdown,
    links: [{ alias: "6591234567", name: "Mrs Tan", kind: "phone" }],
    now: 10,
  });
  assert.equal(first.status, "written");
  assert.equal(extractor.calls, 1);
  const second = await remember(deps, {
    orgId: "coolair",
    path: "customers/6591234567.md",
    markdown,
    now: 20,
  });
  assert.equal(second.status, "unchanged");
  assert.equal(extractor.calls, 1);
  const current = await readCurrent(deps.store, "coolair", "6591234567");
  assert.equal(current.some((edge) => edge.targetId === "baby"), true);
  close();
});

test("phone and display name stay apart until a link row joins them", async () => {
  const { deps, close } = harness();
  const markdown = JSON.stringify({
    entities: [{ name: "Mrs Tan", type: "Person" }],
    edges: [{ source: "Mrs Tan", relation: "has_rule", target: "baby" }],
  });
  await remember(deps, {
    orgId: "coolair",
    path: "customers/6591234567.md",
    markdown,
    now: 10,
  });
  assert.equal((await readCurrent(deps.store, "coolair", "6591234567")).length, 0);
  await remember(deps, {
    orgId: "coolair",
    path: "customers/6591234567.md",
    markdown: `${markdown} `,
    links: [{ alias: "6591234567", name: "Mrs Tan", kind: "phone" }],
    now: 11,
  });
  assert.equal((await readCurrent(deps.store, "coolair", "6591234567")).length, 1);
  close();
});

test("similar name vectors collapse onto one entity id", async () => {
  const embedder = {
    async embed(texts: string[]) {
      return texts.map((text) => (text.includes("Tan") ? [1, 0] : tokenEmbed(text)));
    },
  };
  const { deps, close } = harness(embedder);
  await remember(deps, {
    orgId: "coolair",
    path: "customers/mrs-tan.md",
    markdown: JSON.stringify({
      entities: [
        { name: "Mrs Tan", type: "Person" },
        { name: "Mdm Tan", type: "Person" },
      ],
      edges: [
        { source: "Mrs Tan", relation: "lives_in", target: "East" },
        { source: "Mdm Tan", relation: "has_rule", target: "baby" },
      ],
    }),
    now: 5,
  });
  const people = (await deps.store.listEntities("coolair")).filter((entity) => entity.entityType === "Person");
  assert.equal(people.length, 1);
  const baby = await readCurrent(deps.store, "coolair", "Mrs Tan");
  assert.equal(baby.some((edge) => edge.targetId === "baby"), true);
  assert.equal(baby.some((edge) => edge.targetId === "east"), true);
  close();
});

test("quoted_price supersedes in SQL and a public recall skips customer files", async () => {
  const { deps, close } = harness();
  await remember(deps, {
    orgId: "coolair",
    path: "customers/6591234567.md",
    markdown: JSON.stringify({
      entities: [{ name: "Mrs Tan", type: "Person" }],
      edges: [{ source: "Mrs Tan", relation: "quoted_price", target: "180" }],
    }),
    links: [{ alias: "6591234567", name: "Mrs Tan", kind: "phone" }],
    now: 1,
  });
  await remember(deps, {
    orgId: "coolair",
    path: "customers/6591234567.md",
    markdown: JSON.stringify({
      entities: [{ name: "Mrs Tan", type: "Person" }],
      edges: [{ source: "Mrs Tan", relation: "quoted_price", target: "160" }],
    }),
    now: 2,
  });
  await remember(deps, {
    orgId: "coolair",
    path: "wiki/services.md",
    markdown: JSON.stringify({
      entities: [{ name: "Service", type: "Offer" }],
      edges: [{ source: "Service", relation: "covers", target: "aircon" }],
    }),
    now: 3,
  });
  const current = await readCurrent(deps.store, "coolair", "Mrs Tan");
  assert.deepEqual(
    current.filter((edge) => edge.relation === "quoted_price").map((edge) => edge.targetId),
    ["160"],
  );
  const owner = await recall(deps, { orgId: "coolair", query: "Mrs Tan price 160", audience: "owner" });
  assert.equal(owner.hits.some((hit) => hit.edge.targetId === "160"), true);
  assert.equal(owner.hits.some((hit) => hit.edge.targetId === "180"), false);
  const stranger = await recall(deps, { orgId: "coolair", query: "Mrs Tan baby 160 aircon", audience: "public" });
  assert.equal(stranger.hits.every((hit) => hit.edge.path.startsWith("wiki/")), true);
  assert.equal(stranger.hits.some((hit) => hit.edge.targetId === "aircon"), true);
  const babyId = owner.hits.find((hit) => hit.edge.targetId === "160")?.edge.id;
  assert.ok(babyId);
  await improve(deps.store, "coolair", [babyId], 5);
  const updated = (await deps.store.listEdges("coolair")).find((edge) => edge.id === babyId);
  assert.equal(updated?.feedbackWeight, 0.55);
  close();
});
