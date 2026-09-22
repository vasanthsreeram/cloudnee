import assert from "node:assert/strict";
import test from "node:test";
import { chunkMarkdown } from "../src/chunk.ts";
import { extractionPrompt, normalizeRelation, parseExtraction } from "../src/extract.ts";

test("chunkMarkdown packs paragraphs and keeps a long paragraph whole", () => {
  assert.deepEqual(chunkMarkdown("   "), []);
  const one = chunkMarkdown("  hello  ");
  assert.equal(one.length, 1);
  assert.equal(one[0]?.id, "c0");
  assert.equal(one[0]?.text, "hello");

  const split = chunkMarkdown("alpha\n\nbeta", { maxChars: 1 });
  assert.deepEqual(
    split.map((chunk) => chunk.text),
    ["alpha", "beta"],
  );
  assert.deepEqual(
    split.map((chunk) => chunk.id),
    ["c0", "c1"],
  );

  const packed = chunkMarkdown("aa\n\nbb\n\ncc", { maxChars: 6 });
  assert.equal(packed[0]?.text, "aa\n\nbb");
  assert.equal(packed[1]?.text, "cc");
});

test("parseExtraction accepts JSON text and snake-cases relations", () => {
  const parsed = parseExtraction(
    JSON.stringify({
      entities: [{ name: "Mrs Tan", type: "Person" }, { name: "" }],
      edges: [
        { source: "Mrs Tan", relation: "Lives In", target: "Tampines" },
        { source: "Mrs Tan", relation: "Quoted Price", target: "$180" },
        { source: "", relation: "lives_in", target: "X" },
      ],
    }),
  );
  assert.equal(parsed.entities.length, 1);
  assert.equal(parsed.entities[0]?.name, "Mrs Tan");
  assert.deepEqual(
    parsed.edges.map((edge) => edge.relation),
    ["lives_in", "quoted_price"],
  );
  assert.equal(normalizeRelation("Visit Status"), "visit_status");
  assert.throws(() => parseExtraction("[]"));
});

test("extractionPrompt names the functional relations and includes the chunk", () => {
  const prompt = extractionPrompt("Service is $180 in the east.");
  assert.match(prompt, /lives_in/);
  assert.match(prompt, /quoted_price/);
  assert.match(prompt, /Service is \$180 in the east/);
});
