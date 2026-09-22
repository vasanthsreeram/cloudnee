/** Running-average feedback weights kept in [0, 1]. */

export const DEFAULT_FEEDBACK_ALPHA = 0.1;
export const IMPLICIT_ALPHA_FACTOR = 0.5;

const WEIGHT_SCALE = 10_000;

export function normalizeFeedbackScore(score: number): number {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new RangeError(`feedback score must be an integer 1..5, got ${score}`);
  }
  return (score - 1) / 4;
}

export function streamUpdateWeight(
  previous: number,
  normalizedRating: number,
  alpha: number,
): number {
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
    throw new RangeError(`alpha must be in (0, 1], got ${alpha}`);
  }
  const updated = previous + alpha * (normalizedRating - previous);
  const clamped = Math.min(1, Math.max(0, updated));
  return Math.round(clamped * WEIGHT_SCALE) / WEIGHT_SCALE;
}

export function applyFeedbackWeight(
  previous: number,
  score: number,
  opts: { alpha?: number; implicit?: boolean } = {},
): number {
  const normalized = normalizeFeedbackScore(score);
  const alpha = opts.alpha ?? DEFAULT_FEEDBACK_ALPHA;
  const effectiveAlpha = opts.implicit ? alpha * IMPLICIT_ALPHA_FACTOR : alpha;
  return streamUpdateWeight(previous, normalized, effectiveAlpha);
}
