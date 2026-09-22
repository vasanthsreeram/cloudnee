import assert from "node:assert/strict";
import test from "node:test";
import { applyFeedbackWeight, normalizeFeedbackScore, streamUpdateWeight } from "../src/feedback.ts";
import { canReadPath, isPrivatePath } from "../src/permissions.ts";
import { expandQuery } from "../src/ontology.ts";

test("feedback is a clipped running average", () => {
  assert.equal(normalizeFeedbackScore(5), 1);
  assert.equal(normalizeFeedbackScore(1), 0);
  assert.equal(streamUpdateWeight(0.5, 1, 0.1), 0.55);
  assert.equal(streamUpdateWeight(0.5, 0, 0.1), 0.45);
  assert.equal(applyFeedbackWeight(0.5, 5, { implicit: true }), 0.525);
  assert.throws(() => normalizeFeedbackScore(0));
  assert.throws(() => streamUpdateWeight(0.5, 1, 0));
  assert.throws(() => streamUpdateWeight(0.5, 1, 1.1));
});

test("customer pages are private and ontology expansion appends the canonical word", () => {
  assert.equal(isPrivatePath("customers/6591234567.md"), true);
  assert.equal(isPrivatePath("/customers/6591234567.md"), true);
  assert.equal(isPrivatePath("wiki/services.md"), false);
  assert.equal(canReadPath("customers/6591234567.md", "public"), false);
  assert.equal(canReadPath("customers/6591234567.md", "owner"), true);
  assert.equal(canReadPath("wiki/services.md", "public"), true);
  assert.equal(
    expandQuery("HVAC quote", [{ alias: "hvac", canonical: "aircon" }]),
    "HVAC quote aircon",
  );
  assert.equal(
    expandQuery("aircon HVAC", [{ alias: "hvac", canonical: "aircon" }]),
    "aircon HVAC",
  );
});
