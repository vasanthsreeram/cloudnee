/** Cognee 1.6 triplet scoring: distance is cosine distance, lower is nearer. */

export const TRIPLET_DISTANCE_PENALTY = 6.5;
export const DEFAULT_TOP_K = 5;
export const DEFAULT_WIDE_K = 100;
export const DEFAULT_FEEDBACK_INFLUENCE = 0;
export const DEFAULT_IMPORTANCE = 0.5;

export interface ScoredPart {
  distance: number;
  importance?: number;
  feedbackWeight?: number;
}

export interface TripletScoreInput {
  source: ScoredPart;
  relation: ScoredPart;
  target: ScoredPart;
}

export interface TripletScoreOptions {
  feedbackInfluence?: number;
  penalty?: number;
}

const SCORE_SCALE = 1_000_000;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function effectiveDistance(part: ScoredPart, influence: number, penalty: number): number {
  const importance = finiteOr(part.importance, DEFAULT_IMPORTANCE);
  const distance = (2 - importance) * part.distance;

  // Feedback never moves a part whose distance already sits outside the [0, 2]
  // cosine window, or at/after the penalty cutoff; blending there would
  // manufacture a score the distance does not support.
  if (influence <= 0 || distance >= penalty || distance < 0 || distance > 2) {
    return distance;
  }

  const rawWeight = finiteOr(part.feedbackWeight, DEFAULT_IMPORTANCE);
  const weight = Math.min(1, Math.max(0, rawWeight));
  const normalized = distance / 2;
  const blended = (1 - influence) * normalized + influence * (1 - weight);
  return blended * 2;
}

export function scoreTriplet(input: TripletScoreInput, opts: TripletScoreOptions = {}): number {
  const influence = opts.feedbackInfluence ?? DEFAULT_FEEDBACK_INFLUENCE;
  if (!Number.isFinite(influence) || influence < 0 || influence > 1) {
    throw new RangeError(`feedbackInfluence must be in [0, 1], got ${influence}`);
  }
  const penalty = opts.penalty ?? TRIPLET_DISTANCE_PENALTY;

  const total =
    effectiveDistance(input.source, influence, penalty) +
    effectiveDistance(input.relation, influence, penalty) +
    effectiveDistance(input.target, influence, penalty);

  // Drop binary-float noise so equal inputs compare and print equal.
  return Math.round(total * SCORE_SCALE) / SCORE_SCALE;
}

export function topK<T>(items: readonly T[], k: number, score: (item: T) => number): T[] {
  if (!Number.isInteger(k) || k <= 0) {
    throw new RangeError(`k must be a positive integer, got ${k}`);
  }
  return items
    .map((item, index) => ({ item, index, value: score(item) }))
    .sort((a, b) => (a.value === b.value ? a.index - b.index : a.value - b.value))
    .slice(0, k)
    .map((entry) => entry.item);
}
