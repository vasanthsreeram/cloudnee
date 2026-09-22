/** Public homepage. The API stays behind the bearer token. */
export function siteHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>cloudnee — Cognee memory that scales to zero</title>
<style>
  :root { color-scheme: light; --paper:#f7f4ee; --ink:#1a1916; --body:#5c574e; --line:#e4dfd4; --card:#fff; --green:#2f6b3a; --orange:#e87820; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { width: min(720px, calc(100% - 40px)); margin: 0 auto; padding: 56px 0 72px; }
  .eyebrow { margin: 0 0 10px; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--orange); font-weight: 700; }
  h1 { font-size: clamp(36px, 6vw, 52px); line-height: 1.02; letter-spacing: -.03em; font-weight: 640; margin: 0 0 18px; }
  p { margin: 0 0 14px; color: var(--body); }
  strong { color: var(--ink); font-weight: 650; }
  .links { display: flex; flex-wrap: wrap; gap: 8px; margin: 22px 0 28px; }
  a.pill { text-decoration: none; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 8px 14px; font-size: 14px; }
  a.pill.primary { background: var(--ink); color: #fff; border-color: var(--ink); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px; }
  .card b { display: block; margin-bottom: 4px; }
  .card span { color: var(--body); font-size: 14px; }
  .cite { margin-top: 28px; font-size: 13px; color: #8a8378; }
  .cite a { color: inherit; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <p class="eyebrow">Battle of the Personal Brains · San Francisco</p>
  <h1>Cognee is already good. I wanted it to scale to zero.</h1>
  <p>Cognee’s own head-to-head, 24 HotPotQA questions, put their graph at <strong>0.93</strong> human-like correctness and <strong>0.84</strong> F1. On BEAM, at 100k tokens, they report <strong>79%</strong> where a Llama-4 RAG baseline sat at <strong>32.3%</strong>. Those are Cognee’s published numbers. I did not re-run them.</p>
  <p>That memory lives in a Python process, with Kuzu or Neo4j and LanceDB on a disk. It scales up. Leave it idle and the process is still there, or the container sleeps and the disk goes with it. I wanted the same ideas to <strong>scale down to zero</strong>: no process between questions. The page stays Markdown in R2. The graph is D1 rows. Search is Vectorize plus the triplet score. A Workflow extracts, writes, and exits.</p>
  <p>The agent is the Strands TypeScript SDK in the same isolate. A container starts only when a tool needs a shell. Ask it something and the graph is what it remembers.</p>
  <div class="links">
    <a class="pill primary" href="https://strands.vasanth.cloud">Try the agent</a>
    <a class="pill" href="https://strands.vasanth.cloud/brain">Memory graph</a>
    <a class="pill" href="https://github.com/vasanthsreeram/cloudnee">GitHub · cloudnee</a>
    <a class="pill" href="https://github.com/vasanthsreeram/strands-cloudflare">GitHub · strands</a>
  </div>
  <div class="grid">
    <div class="card"><b>Idle</b><span>Nothing provisioned between turns. The Worker returns. The Workflow is finished.</span></div>
    <div class="card"><b>A fresh fact</b><span>D1 is the record on the next read, even while Vectorize is still catching up.</span></div>
    <div class="card"><b>What I kept</b><span>Stable entity id, one extraction per chunk, triplet score, supersede in SQL, path permissions.</span></div>
    <div class="card"><b>What this is not</b><span>A claim that cloudnee beat Cognee’s benchmark. The nine jobs are a behavior demo.</span></div>
  </div>
  <p class="cite">Cognee sources: <a href="https://www.cognee.ai/knowledge-graph-memory-benchmarks">knowledge-graph memory benchmarks</a> · <a href="https://www.cognee.ai/blog/deep-dives/behind-the-viral-benchmark-numbers">behind the benchmark numbers</a>. Cognee itself: <a href="https://github.com/topoteretes/cognee">topoteretes/cognee</a>.</p>
</main>
</body>
</html>`;
}
