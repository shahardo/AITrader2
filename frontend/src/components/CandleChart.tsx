// CandleChart.tsx — candlestick chart (TradingView lightweight-charts) with
// trend-channel band and support/resistance price-line overlays.

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineStyle,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { PriceBarOut, SRLevelOut, TrendChannelOut } from '../api/client'
import { cssVar } from '../lib/cssVar'
import { useTheme } from '../contexts/ThemeContext'

interface Props {
  bars: PriceBarOut[]
  channel?: TrendChannelOut | null
  srLevels?: SRLevelOut[]
  height?: number
}

/** Candlestick chart with channel and S/R overlays drawn as price lines. */
export default function CandleChart({ bars, channel, srLevels = [], height = 360 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { scheme } = useTheme()
  const { t } = useTranslation('stockDetail')

  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return
    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: cssVar('--c-panel', '#0f172a') },
        textColor: cssVar('--c-ink-3', '#94a3b8'),
      },
      grid: {
        vertLines: { color: cssVar('--c-edge', '#1e293b') },
        horzLines: { color: cssVar('--c-edge', '#1e293b') },
      },
      timeScale: { borderColor: cssVar('--c-edge-2', '#334155') },
      rightPriceScale: { borderColor: cssVar('--c-edge-2', '#334155') },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: cssVar('--c-positive', '#34d399'),
      downColor: cssVar('--c-negative', '#f87171'),
      borderVisible: false,
      wickUpColor: cssVar('--c-positive', '#34d399'),
      wickDownColor: cssVar('--c-negative', '#f87171'),
    })
    series.setData(
      bars.map((b) => ({
        time: (new Date(b.date).getTime() / 1000) as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    )

    if (channel) {
      const bands: Array<[number, string]> = [
        [channel.upper, t('chart.channelTop')],
        [channel.mid, t('chart.channelMid')],
        [channel.lower, t('chart.channelBottom')],
      ]
      for (const [price, title] of bands) {
        series.createPriceLine({
          price,
          color: cssVar('--c-chart-line', '#38bdf8'),
          lineStyle: title === t('chart.channelMid') ? LineStyle.Dotted : LineStyle.Dashed,
          lineWidth: 1,
          title,
        })
      }
    }
    for (const level of srLevels) {
      series.createPriceLine({
        price: level.price,
        color: level.kind === 'support' ? cssVar('--c-positive', '#34d399') : cssVar('--c-warning', '#fbbf24'),
        lineStyle: LineStyle.SparseDotted,
        lineWidth: 1,
        title: `${level.kind === 'support' ? t('chart.support') : t('chart.resistance')} (${level.touches})`,
      })
    }
    chart.timeScale().fitContent()

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
    }
  }, [bars, channel, srLevels, height, scheme, t])

  return <div ref={containerRef} data-testid="candle-chart" />
}
