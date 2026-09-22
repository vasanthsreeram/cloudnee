import assert from "node:assert/strict";
import test from "node:test";
import { cosineSimilarity, entityIdForName, normalizeName, shouldMergeEntities } from "../src/identity.ts";

test("normalizeName strips punctuation and case", () => {
  assert.equal(normalizeName("Mrs. Tan"), "mrstan");
  assert.equal(normalizeName("Mrs Tan"), "mrstan");
  assert.equal(normalizeName("6591234567"), "6591234567");
  assert.equal(normalizeName("HVAC"), "hvac");
  assert.equal(normalizeName(""), "");
  assert.equal(entityIdForName("Mrs. Tan"), "mrstan");
});

test("cosineSimilarity is 1 for the same direction and 0 for a zero vector", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0);
});

test("shouldMergeEntities matches Cognee's name rule, not a phone number", () => {
  assert.equal(
    shouldMergeEntities(
      { name: "Mrs. Tan", type: "Person" },
      { name: "Mrs Tan", type: "Person" },
    ),
    true,
  );
  assert.equal(
    shouldMergeEntities(
      { name: "Mrs Tan", type: "Person", vector: [1, 0] },
      { name: "6591234567", type: "Person", vector: [0, 1] },
    ),
    false,
  );
  assert.equal(
    shouldMergeEntities(
      { name: "Mdm Tan", type: "Person", vector: [1, 0] },
      { name: "Mrs Tan", type: "Person", vector: [0.9, 0.1] },
    ),
    true,
  );
  assert.equal(
    shouldMergeEntities(
      { name: "Mdm Tan", type: "Person", vector: [1, 0] },
      { name: "Mrs Tan", type: "Place", vector: [0.9, 0.1] },
    ),
    false,
  );
  assert.equal(
    shouldMergeEntities(
      { name: "Mdm Tan", type: "Person", vector: [1, 0] },
      { name: "Mrs Tan", type: "Place", vector: [0.9, 0.1] },
      { allowCrossType: true },
    ),
    true,
  );
  assert.equal(
    shouldMergeEntities(
      { name: "A", type: "Entity", vector: [1, 0] },
      { name: "B", type: "Entity", vector: [0.84, Math.sqrt(1 - 0.84 ** 2)] },
    ),
    false,
  );
});
