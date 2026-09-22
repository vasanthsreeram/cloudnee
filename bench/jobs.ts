import { bestCoveredEntity, history, improve, readCurrent, recall, remember, teachAlias } from "../src/index.ts";
import { tokenize } from "../src/embed.ts";
import { SqlGraphStore } from "../src/store.ts";
import { openSqlite } from "../src/sqlite.ts";
import { MemoryVectorIndex } from "../src/vectors.ts";
import type { CloudneeDeps, Embedder, Extraction, Extractor, RecallHit } from "../src/types.ts";

export interface JobReport {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
  ms: number;
}

const VOCAB = [
  "east", "mornings", "open", "visit", "bedok", "afternoons", "done", "baby",
  "aircon", "hvac", "tan", "rahman", "koh", "service", "price", "chemical",
  "tampines", "bedoksouth", "smell",
];

export function overlapEmbed(text: string): number[] {
  const vector = VOCAB.map(() => 0);
  for (const token of tokenize(text)) {
    const index = VOCAB.indexOf(token);
    if (index >= 0) vector[index] = 1;
  }
  if (vector.every((value) => value === 0)) vector[0] = 0.01;
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
}

function page(extraction: Extraction): string {
  return JSON.stringify(extraction);
}

function countingExtractor(): Extractor & { calls: number } {
  const extractor = {
    calls: 0,
    async extract(text: string): Promise<Extraction> {
      extractor.calls += 1;
      return JSON.parse(text) as Extraction;
    },
  };
  return extractor;
}

function harness(opts?: { embedder?: Embedder; lagMs?: number; clock?: () => number }): {
  deps: CloudneeDeps;
  close: () => void;
} {
  const opened = openSqlite();
  const deps: CloudneeDeps = {
    store: new SqlGraphStore(opened.db),
    vectors: new MemoryVectorIndex({ lagMs: opts?.lagMs ?? 0, clock: opts?.clock }),
    embedder: opts?.embedder ?? { async embed(texts) { return texts.map((text) => overlapEmbed(text)); } },
    extractor: countingExtractor(),
    clock: opts?.clock ?? (() => 1),
  };
  return { deps, close: () => opened.close() };
}

async function time<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await fn();
  return { value, ms: Math.round((performance.now() - start) * 100) / 100 };
}

function targets(hits: RecallHit[], relation: string): string[] {
  return hits.filter((hit) => hit.edge.relation === relation).map((hit) => hit.edge.targetId);
}

export async function runNineJobs(): Promise<JobReport[]> {
  const reports: JobReport[] = [];

  reports.push(await job("four-words", "Four words still open her file", async () => {
    const { deps, close } = harness();
    try {
      await remember(deps, {
        orgId: "coolair",
        path: "customers/6591234567.md",
        markdown: page({
          entities: [{ name: "Mrs Tan", type: "Person" }],
          edges: [
            { source: "Mrs Tan", relation: "has_rule", target: "baby" },
            { source: "Mrs Tan", relation: "prefers", target: "mornings" },
            { source: "Mrs Tan", relation: "refuses", target: "chemical" },
          ],
        }),
        links: [{ alias: "6591234567", name: "Mrs Tan", kind: "phone" }],
        now: 1,
      });
      const rows = await readCurrent(deps.store, "coolair", "6591234567");
      const ok = rows.some((edge) => edge.targetId === "baby");
      return { pass: ok, detail: ok ? "phone 6591234567 opens the baby rule from D1" : "baby rule missing" };
    } finally {
      close();
    }
  }));

  reports.push(await job("two-files", "Two filenames, one person", async () => {
    const { deps, close } = harness();
    try {
      await remember(deps, {
        orgId: "coolair",
        path: "customers/6591234567.md",
        markdown: page({
          entities: [{ name: "Mrs Tan", type: "Person" }],
          edges: [{ source: "Mrs Tan", relation: "has_rule", target: "baby" }],
        }),
        links: [{ alias: "6591234567", name: "Mrs Tan", kind: "phone" }],
        now: 1,
      });
      await remember(deps, {
        orgId: "coolair",
        path: "customers/mrs-tan.md",
        markdown: page({
          entities: [{ name: "Mrs Tan", type: "Person" }],
          edges: [{ source: "Mrs Tan", relation: "lives_in", target: "Bedok" }],
        }),
        now: 2,
      });
      const rows = await readCurrent(deps.store, "coolair", "6591234567");
      const paths = new Set(rows.map((edge) => edge.path));
      const ok = paths.has("customers/6591234567.md") && paths.has("customers/mrs-tan.md");
      return { pass: ok, detail: ok ? "phone alias sees both pages" : `paths: ${[...paths].join(", ")}` };
    } finally {
      close();
    }
  }));

  reports.push(await job("hvac", "HVAC finds the aircon page", async () => {
    const { deps, close } = harness();
    try {
      await teachAlias(deps.store, "coolair", "HVAC", "aircon");
      await remember(deps, {
        orgId: "coolair",
        path: "wiki/services.md",
        markdown: page({
          entities: [{ name: "Service", type: "Offer" }],
          edges: [{ source: "Service", relation: "covers", target: "aircon" }],
        }),
        now: 1,
      });
      const result = await recall(deps, { orgId: "coolair", query: "HVAC", audience: "public" });
      const ok = result.hits.some((hit) => hit.edge.targetId === "aircon");
      return { pass: ok, detail: ok ? "ontology alias hvac → aircon" : "aircon edge not recalled" };
    } finally {
      close();
    }
  }));

  reports.push(await job("join", "East + mornings + open visit", async () => {
    const { deps, close } = harness();
    try {
      await remember(deps, {
        orgId: "coolair",
        path: "wiki/routes.md",
        markdown: page({
          entities: [
            { name: "Mrs Tan", type: "Person" },
            { name: "Rahman", type: "Person" },
            { name: "Koh", type: "Person" },
          ],
          edges: [
            { source: "Mrs Tan", relation: "lives_in", target: "East" },
            { source: "Mrs Tan", relation: "prefers", target: "mornings" },
            { source: "Mrs Tan", relation: "visit_status", target: "open" },
            { source: "Rahman", relation: "lives_in", target: "East" },
            { source: "Rahman", relation: "prefers", target: "mornings" },
            { source: "Rahman", relation: "visit_status", target: "done" },
            { source: "Koh", relation: "lives_in", target: "Bedok" },
            { source: "Koh", relation: "prefers", target: "afternoons" },
            { source: "Koh", relation: "visit_status", target: "open" },
          ],
        }),
        now: 1,
      });
      const query = "who in the east wants mornings and still has an open visit";
      const result = await recall(deps, { orgId: "coolair", query, topK: 5 });
      const winner = bestCoveredEntity(result.hits, query);
      const ok = winner === "mrstan";
      return { pass: ok, detail: ok ? "top covered entity is mrstan" : `winner ${winner}` };
    } finally {
      close();
    }
  }));

  reports.push(await job("old-price", "The old price stays, the answer says 160", async () => {
    const { deps, close } = harness();
    try {
      const base = {
        entities: [{ name: "Mrs Tan", type: "Person" as const }],
      };
      await remember(deps, {
        orgId: "coolair",
        path: "customers/mrs-tan.md",
        markdown: page({ ...base, edges: [{ source: "Mrs Tan", relation: "quoted_price", target: "180" }] }),
        now: 1,
      });
      await remember(deps, {
        orgId: "coolair",
        path: "customers/mrs-tan.md",
        markdown: page({ ...base, edges: [{ source: "Mrs Tan", relation: "quoted_price", target: "160" }] }),
        now: 2,
      });
      const current = await readCurrent(deps.store, "coolair", "Mrs Tan");
      const past = await history(deps.store, "coolair", "Mrs Tan");
      const recalled = await recall(deps, { orgId: "coolair", query: "Mrs Tan quoted price" });
      const ok = targets(current.map((edge) => ({ edge, score: 0 })), "quoted_price").join() === "160"
        && past.some((edge) => edge.targetId === "180" && edge.supersededBy)
        && recalled.hits.every((hit) => hit.edge.targetId !== "180");
      return { pass: ok, detail: ok ? "180 kept as superseded_by, recall says 160" : "price history mismatched" };
    } finally {
      close();
    }
  }));

  reports.push(await job("unused-line", "A used rule outranks an unused one", async () => {
    const flat: Embedder = { async embed(texts) { return texts.map(() => [1, 0]); } };
    const { deps, close } = harness({ embedder: flat });
    try {
      await remember(deps, {
        orgId: "coolair",
        path: "customers/mrs-tan.md",
        markdown: page({
          entities: [{ name: "Mrs Tan", type: "Person" }],
          edges: [
            { source: "Mrs Tan", relation: "has_rule", target: "baby" },
            { source: "Mrs Tan", relation: "has_rule", target: "smell" },
          ],
        }),
        now: 1,
      });
      const before = await recall(deps, {
        orgId: "coolair",
        query: "baby smell",
        feedbackInfluence: 0.5,
        topK: 2,
      });
      const baby = before.hits.find((hit) => hit.edge.targetId === "baby");
      if (!baby) return { pass: false, detail: "baby edge was not a candidate" };
      await improve(deps.store, "coolair", [baby.edge.id], 5);
      const after = await recall(deps, {
        orgId: "coolair",
        query: "baby smell",
        feedbackInfluence: 0.5,
        topK: 2,
      });
      const babyScore = after.hits.find((hit) => hit.edge.targetId === "baby")?.score;
      const smellScore = after.hits.find((hit) => hit.edge.targetId === "smell")?.score;
      const ok = babyScore !== undefined && smellScore !== undefined && babyScore < smellScore;
      return {
        pass: ok,
        detail: ok ? `baby ${babyScore} ranks ahead of smell ${smellScore}` : `baby ${babyScore} smell ${smellScore}`,
      };
    } finally {
      close();
    }
  }));

  reports.push(await job("hand-edit", "An edited page is the next read", async () => {
    const { deps, close } = harness();
    try {
      await remember(deps, {
        orgId: "coolair",
        path: "customers/mrs-tan.md",
        markdown: page({
          entities: [{ name: "Mrs Tan", type: "Person" }],
          edges: [{ source: "Mrs Tan", relation: "lives_in", target: "Bedok" }],
        }),
        now: 1,
      });
      await remember(deps, {
        orgId: "coolair",
        path: "customers/mrs-tan.md",
        markdown: page({
          entities: [{ name: "Mrs Tan", type: "Person" }],
          edges: [{ source: "Mrs Tan", relation: "lives_in", target: "Bedok South" }],
        }),
        now: 2,
      });
      const current = await readCurrent(deps.store, "coolair", "Mrs Tan");
      const ok = current.some((edge) => edge.targetId === "bedoksouth")
        && current.every((edge) => edge.targetId !== "bedok");
      return { pass: ok, detail: ok ? "next D1 read is Bedok South" : current.map((edge) => edge.targetId).join(", ") };
    } finally {
      close();
    }
  }));

  reports.push(await job("thirty-seconds", "The other chat sees 160 before Vectorize does", async () => {
    let now = 0;
    const clock = () => now;
    const { deps, close } = harness({ lagMs: 60_000, clock });
    try {
      await remember(deps, {
        orgId: "coolair",
        path: "customers/mrs-tan.md",
        markdown: page({
          entities: [{ name: "Mrs Tan", type: "Person" }],
          edges: [{ source: "Mrs Tan", relation: "quoted_price", target: "180" }],
        }),
        now,
      });
      now = 1_000;
      await remember(deps, {
        orgId: "coolair",
        path: "customers/mrs-tan.md",
        markdown: page({
          entities: [{ name: "Mrs Tan", type: "Person" }],
          edges: [{ source: "Mrs Tan", relation: "quoted_price", target: "160" }],
        }),
        now,
      });
      const immediate = await readCurrent(deps.store, "coolair", "Mrs Tan");
      const [probe] = await deps.embedder.embed(["quoted price 160"]);
      const hidden = await deps.vectors.query(probe!, 20, { orgId: "coolair", kind: "edge" });
      const recalled = await recall(deps, { orgId: "coolair", query: "Mrs Tan quoted price 160" });
      now = 120_000;
      const visible = await deps.vectors.query(probe!, 20, { orgId: "coolair", kind: "edge" });
      const id160 = immediate.find((edge) => edge.targetId === "160")?.id;
      const ok = immediate.some((edge) => edge.targetId === "160")
        && hidden.every((hit) => (hit.metadata.edgeId ?? hit.id) !== id160)
        && recalled.hits.some((hit) => hit.edge.targetId === "160")
        && recalled.hits.every((hit) => hit.edge.targetId !== "180")
        && visible.some((hit) => (hit.metadata.edgeId ?? hit.id) === id160);
      return { pass: !!ok, detail: ok ? "D1 is current while the vector point is still lagged" : "freshness split failed" };
    } finally {
      close();
    }
  }));

  reports.push(await job("stranger", "The website does not receive her file", async () => {
    const { deps, close } = harness();
    try {
      await remember(deps, {
        orgId: "coolair",
        path: "customers/6591234567.md",
        markdown: page({
          entities: [{ name: "Mrs Tan", type: "Person" }],
          edges: [{ source: "Mrs Tan", relation: "has_rule", target: "baby" }],
        }),
        links: [{ alias: "6591234567", name: "Mrs Tan", kind: "phone" }],
        now: 1,
      });
      await remember(deps, {
        orgId: "coolair",
        path: "wiki/services.md",
        markdown: page({
          entities: [{ name: "Service", type: "Offer" }],
          edges: [{ source: "Service", relation: "priced", target: "280" }],
        }),
        now: 2,
      });
      const result = await recall(deps, {
        orgId: "coolair",
        query: "baby service price",
        audience: "public",
      });
      const ok = result.hits.length > 0
        && result.hits.every((hit) => !hit.edge.path.startsWith("customers/"));
      return { pass: ok, detail: ok ? "public recall has the service page only" : "customer edge leaked" };
    } finally {
      close();
    }
  }));

  return reports;
}

async function job(
  id: string,
  name: string,
  fn: () => Promise<{ pass: boolean; detail: string }>,
): Promise<JobReport> {
  const { value, ms } = await time(fn);
  return { id, name, pass: value.pass, detail: value.detail, ms };
}
