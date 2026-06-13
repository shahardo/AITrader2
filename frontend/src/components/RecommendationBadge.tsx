// RecommendationBadge.tsx — small colored BUY/SELL/HOLD badge showing the
// weighted (combined) score that drove it, for table cells such as the
// Universe page's recommendation column.

import { useTranslation } from 'react-i18next'
import { recommendationAction, RECOMMENDATION_BADGE_CLASSES } from '../lib/recommendation'

/** Colored recommendation badge with its driving score, sized for table cells. */
export default function RecommendationBadge({ score }: { score: number }) {
  const { t } = useTranslation('stockDetail')
  const action = recommendationAction(score)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold ${RECOMMENDATION_BADGE_CLASSES[action]}`}
    >
      {t(`recommendation.actions.${action.toLowerCase()}`)}
      <span className="font-normal opacity-75">{score.toFixed(1)}</span>
    </span>
  )
}
