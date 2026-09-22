import assert from "node:assert/strict";
import test from "node:test";
import { scoreTriplet, topK, TRIPLET_DISTANCE_PENALTY } from "../src/rank.ts";

test("scoreTriplet sums (2 - importance) times each distance", () => {
  const score = scoreTriplet({
    source: { distance: 0.4 },
    relation: { distance: 0.4 },
    target: { distance: 0.4 },
  });
  assert.equal(score, 1.8);
});

test("feedback blend runs after importance and only inside cosine range", () => {
  const loved = scoreTriplet(
    {
      source: { distance: 0.4, feedbackWeight: 1 },
      relation: { distance: 0.4, feedbackWeight: 1 },
      target: { distance: 0.4, feedbackWeight: 1 },
    },
    { feedbackInfluence: 1 },
  );
  assert.equal(loved, 0);

  const disliked = scoreTriplet(
    {
      source: { distance: 0.4, feedbackWeight: 0 },
      relation: { distance: 0.4, feedbackWeight: 0 },
      target: { distance: 0.4, feedbackWeight: 0 },
    },
    { feedbackInfluence: 1 },
  );
  assert.equal(disliked, 6);

  const penalty = scoreTriplet(
    {
      source: { distance: TRIPLET_DISTANCE_PENALTY, feedbackWeight: 1 },
      relation: { distance: TRIPLET_DISTANCE_PENALTY, feedbackWeight: 1 },
      target: { distance: TRIPLET_DISTANCE_PENALTY, feedbackWeight: 1 },
    },
    { feedbackInfluence: 1 },
  );
  assert.equal(penalty, (2 - 0.5) * TRIPLET_DISTANCE_PENALTY * 3);
});

test("default influence leaves feedback unused, and topK keeps the smallest scores", () => {
  const plain = scoreTriplet({
    source: { distance: 0.4, feedbackWeight: 1 },
    relation: { distance: 0.4, feedbackWeight: 1 },
    target: { distance: 0.4, feedbackWeight: 1 },
  });
  assert.equal(plain, 1.8);
  assert.deepEqual(
    topK([{ id: "far" }, { id: "near" }, { id: "mid" }], 2, (item) =>
      item.id === "near" ? 0.1 : item.id === "mid" ? 0.2 : 0.9,
    ).map((item) => item.id),
    ["near", "mid"],
  );
  assert.throws(() => topK([1], 0, (n) => n));
  assert.throws(() =>
    scoreTriplet(
      { source: { distance: 0 }, relation: { distance: 0 }, target: { distance: 0 } },
      { feedbackInfluence: 2 },
    ),
  );
});
