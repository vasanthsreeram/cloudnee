import { WorkflowEntrypoint } from "cloudflare:workers";
import { d1Db, type D1Like } from "./d1.ts";
import { vectorizeIndex, type VectorizeLike } from "./vectorize.ts";
import { cognifySteps } from "./workflow-steps.ts";
import { SqlGraphStore } from "./store.ts";
import { recall, readCurrent, improve, teachAlias, applyPendingFeedback } from "./recall.ts";
import { parseExtraction, extractionPrompt } from "./extract.ts";
import type {
  Audience,
  CloudneeDeps,
  Embedder,
  Extraction,
  Extractor,
  RecallInput,
  RememberInput,
  VectorHit,
  VectorIndex,
  VectorPoint,
} from "./types.ts";

interface Env {
  DB: D1Like;
  ENTITY_INDEX: VectorizeLike;
  EDGE_INDEX: VectorizeLike;
  AI: { run(model: string, input: unknown): Promise<unknown> };
  BUCKET: { put(key: string, value: string): Promise<unknown> };
  COGNIFY: { create(opts: { params: RememberInput }): Promise<unknown> };
  CLOUDNEE_TOKEN?: string;
}

const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5";
const EXTRACT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

class WorkersEmbedder implements Embedder {
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.env.AI.run(EMBED_MODEL, { text: texts });
    const vectors = embeddingVectors(response);
    if (!vectors) throw new Error("unexpected embedding response");
    return vectors;
  }
}

class WorkersExtractor implements Extractor {
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async extract(chunk: string): Promise<Extraction> {
    try {
      const response = await this.env.AI.run(EXTRACT_MODEL, {
        messages: [
          { role: "system", content: "Return JSON only." },
          { role: "user", content: extractionPrompt(chunk) },
        ],
        max_tokens: 800,
      });
      const text = completionText(response);
      if (text === null) return { entities: [], edges: [] };
      return parseExtraction(text);
    } catch {
      return { entities: [], edges: [] };
    }
  }
}

export class CognifyWorkflow extends WorkflowEntrypoint<Env, RememberInput> {
  async run(
    event: { payload: RememberInput },
    step: { do<T>(name: string, fn: () => Promise<T>): Promise<T> },
  ) {
    const deps = makeDeps(this.env);
    const result = await cognifySteps(deps, event.payload, step);
    await this.env.BUCKET.put(
      `knowledge/${event.payload.orgId}/${event.payload.path}`,
      event.payload.markdown,
    );
    return result;
  }
}

function makeDeps(env: Env): CloudneeDeps {
  return {
    store: new SqlGraphStore(d1Db(env.DB)),
    vectors: splitIndex(vectorizeIndex(env.ENTITY_INDEX), vectorizeIndex(env.EDGE_INDEX)),
    embedder: new WorkersEmbedder(env),
    extractor: new WorkersExtractor(env),
  };
}

/**
 * The pure ranking code treats entities and edges as one index queried by
 * `filter.kind`. Vectorize has no per-kind filter here, so route whole vectors
 * to the bound index and merge unfiltered reads by similarity.
 */
function splitIndex(entityIndex: VectorIndex, edgeIndex: VectorIndex): VectorIndex {
  return {
    async upsert(points: VectorPoint[]): Promise<void> {
      const entities = points.filter((point) => point.metadata.kind === "entity");
      const edges = points.filter((point) => point.metadata.kind === "edge");
      if (entities.length > 0) await entityIndex.upsert(entities);
      if (edges.length > 0) await edgeIndex.upsert(edges);
    },
    async query(
      values: number[],
      topK: number,
      filter: { orgId: string; kind?: string },
    ): Promise<VectorHit[]> {
      if (filter.kind === "entity") return entityIndex.query(values, topK, filter);
      if (filter.kind === "edge") return edgeIndex.query(values, topK, filter);
      const [entities, edges] = await Promise.all([
        entityIndex.query(values, topK, filter),
        edgeIndex.query(values, topK, filter),
      ]);
      return mergeBySimilarity([...entities, ...edges], topK);
    },
  };
}

function mergeBySimilarity(hits: VectorHit[], topK: number): VectorHit[] {
  return hits.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
}

function embeddingVectors(response: unknown): number[][] | null {
  if (Array.isArray(response)) return response as number[][];
  if (isRecord(response) && Array.isArray(response.data)) return response.data as number[][];
  return null;
}

function completionText(response: unknown): string | null {
  if (typeof response === "string") return response;
  if (!isRecord(response)) return null;
  if (typeof response.response === "string") return response.response;
  if (typeof response.result === "string") return response.result;
  if (Array.isArray(response.choices)) {
    const first = response.choices[0];
    if (isRecord(first) && isRecord(first.message) && typeof first.message.content === "string") {
      return first.message.content;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /health") return json({ ok: true, name: "cloudnee" });
  if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);

  if (route === "POST /v1/remember") {
    const body = await readJson(request);
    if (body === null) return badRequest();
    await env.COGNIFY.create({ params: body as unknown as RememberInput });
    return json({ ok: true }, 202);
  }

  if (route === "POST /v1/recall") {
    const body = await readJson(request);
    if (body === null) return badRequest();
    const result = await recall(makeDeps(env), body as unknown as RecallInput);
    return json(result);
  }

  if (route === "POST /v1/improve") {
    const body = await readJson(request);
    if (body === null) return badRequest();
    await improve(
      new SqlGraphStore(d1Db(env.DB)),
      String(body.orgId ?? ""),
      asStringArray(body.edgeIds),
      Number(body.score),
      body.implicit === true,
    );
    return json({ ok: true });
  }

  if (route === "POST /v1/alias") {
    const body = await readJson(request);
    if (body === null) return badRequest();
    await teachAlias(
      new SqlGraphStore(d1Db(env.DB)),
      String(body.orgId ?? ""),
      String(body.alias ?? ""),
      String(body.canonical ?? ""),
    );
    return json({ ok: true });
  }

  if (route === "GET /v1/current") {
    const edges = await readCurrent(
      new SqlGraphStore(d1Db(env.DB)),
      url.searchParams.get("orgId") ?? "",
      url.searchParams.get("who") ?? "",
      (url.searchParams.get("audience") ?? undefined) as Audience | undefined,
    );
    return json({ edges });
  }

  return json({ error: "not_found" }, 404);
}

async function scheduled(
  _event: unknown,
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
): Promise<void> {
  ctx.waitUntil(applyPendingFeedback(new SqlGraphStore(d1Db(env.DB))));
}

function isAuthorized(request: Request, env: Env): boolean {
  const token = env.CLOUDNEE_TOKEN;
  if (!token) return true;
  return request.headers.get("Authorization") === `Bearer ${token}`;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function badRequest(): Response {
  return json({ error: "bad_request" }, 400);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default { fetch, scheduled };
