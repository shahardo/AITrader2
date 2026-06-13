// FitnessChart.tsx — small sparkline showing the genetic algorithm's best/avg
// fitness per generation (Strategy Lab evolution progress panel).

import { useTranslation } from 'react-i18next'

interface FitnessChartProps {
  history: { generation: number; best: number; avg: number }[]
  width?: number
  height?: number
}

/** SVG sparkline of best (accent) and average (muted) fitness per generation. */
export default function FitnessChart({ history, width = 300, height = 80 }: FitnessChartProps) {
  const { t } = useTranslation('strategyLab')
  if (history.length === 0) return null

  const values = history.flatMap((h) => [h.best, h.avg])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const xStep = history.length > 1 ? width / (history.length - 1) : 0

  const toPoints = (key: 'best' | 'avg') =>
    history
      .map((h, i) => {
        const x = i * xStep
        const y = height - ((h[key] - min) / range) * height
        return `${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ')

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={t('evolved.fitnessChart')}
    >
      <polyline points={toPoints('avg')} className="text-ink-3" fill="none" stroke="currentColor"
                strokeWidth="1.5" />
      <polyline points={toPoints('best')} className="text-accent-link" fill="none"
                stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}
