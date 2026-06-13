// recommendation.ts — shared BUY/SELL/HOLD recommendation derivation from a
// combined (or technical-only) score, used by the stock detail page's headline
// recommendation and the Universe table's recommendation column.

export type RecommendationAction = 'BUY' | 'SELL' | 'HOLD'

// Combined-score thresholds for the BUY/SELL/HOLD recommendation — mirrors the
// 50-is-neutral convention from ta.scoring.composite_score.
const RECOMMENDATION_BUY_THRESHOLD = 60
const RECOMMENDATION_SELL_THRESHOLD = 40

/** Derive the recommendation action from a combined (or technical-only) score. */
export function recommendationAction(score: number): RecommendationAction {
  if (score >= RECOMMENDATION_BUY_THRESHOLD) return 'BUY'
  if (score <= RECOMMENDATION_SELL_THRESHOLD) return 'SELL'
  return 'HOLD'
}

/** Badge background/text color classes per recommendation action. */
export const RECOMMENDATION_BADGE_CLASSES: Record<RecommendationAction, string> = {
  BUY: 'bg-positive-soft text-positive-soft-text',
  SELL: 'bg-negative-soft text-negative-soft-text',
  HOLD: 'bg-panel-2 text-ink-3',
}
