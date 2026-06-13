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
import { chartTheme } from '../lib/chartTheme'
import { useTheme } from '../contexts/ThemeContext'

// Series palette tuned for contrast against both the dark and light panel
// background; index-matched between the two modes.
const DARK_COLORS = ['#10b981', '#38bdf8', '#f59e0b', '#e879f9', '#f87171', '#a3e635']
const LIGHT_COLORS = ['#059669', '#0284c7', '#b45309', '#a21caf', '#dc2626', '#4d7c0f']

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
  const { scheme } = useTheme()

  useEffect(() => {
    if (!containerRef.current || curves.length === 0) return
    const colors = scheme === 'light' ? LIGHT_COLORS : DARK_COLORS
    const theme = chartTheme(scheme)
    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: theme.panel },
        textColor: theme.ink3,
      },
      grid: {
        vertLines: { color: theme.edge },
        horzLines: { color: theme.edge },
      },
      timeScale: { borderColor: theme.edge2 },
      rightPriceScale: { borderColor: theme.edge2 },
    })
    curves.forEach((curve, i) => {
      if (curve.points.length === 0) return
      const base = normalize ? curve.points[0].value || 1 : 1
      const series = chart.addSeries(LineSeries, {
        color: colors[i % colors.length],
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
  }, [curves, normalize, height, scheme])

  return <div ref={containerRef} data-testid="line-compare-chart" />
}
