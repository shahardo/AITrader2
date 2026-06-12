// LineCompareChart.tsx — multi-series line chart (lightweight-charts) used for
// portfolio equity-curve comparison and Strategy Lab equity curves. Each series
// is normalized to 100 at its first point so different capitals compare fairly.

import { useEffect, useRef } from 'react'
import {
  ColorType,
  createChart,
  LineSeries,
  type UTCTimestamp,
} from 'lightweight-charts'

const COLORS = ['#10b981', '#38bdf8', '#f59e0b', '#e879f9', '#f87171', '#a3e635']

export interface NamedCurve {
  name: string
  points: { date: string; value: number }[]
}

interface Props {
  curves: NamedCurve[]
  normalize?: boolean
  height?: number
}

/** Multi-line chart; optionally normalizes each curve to start at 100. */
export default function LineCompareChart({ curves, normalize = true, height = 300 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || curves.length === 0) return
    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8',
      },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      timeScale: { borderColor: '#334155' },
      rightPriceScale: { borderColor: '#334155' },
    })
    curves.forEach((curve, i) => {
      if (curve.points.length === 0) return
      const base = normalize ? curve.points[0].value || 1 : 1
      const series = chart.addSeries(LineSeries, {
        color: COLORS[i % COLORS.length],
        lineWidth: 2,
        title: curve.name,
      })
      series.setData(
        curve.points.map((p) => ({
          time: (new Date(p.date).getTime() / 1000) as UTCTimestamp,
          value: normalize ? (100 * p.value) / base : p.value,
        })),
      )
    })
    chart.timeScale().fitContent()
    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
    }
  }, [curves, normalize, height])

  return <div ref={containerRef} data-testid="line-compare-chart" />
}
