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
import { chartTheme } from '../lib/chartTheme'
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
    const series = chart.addSeries(CandlestickSeries, {
      upColor: theme.positive,
      downColor: theme.negative,
      borderVisible: false,
      wickUpColor: theme.positive,
      wickDownColor: theme.negative,
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
          color: theme.chartLine,
          lineStyle: title === t('chart.channelMid') ? LineStyle.Dotted : LineStyle.Dashed,
          lineWidth: 1,
          title,
        })
      }
    }
    for (const level of srLevels) {
      series.createPriceLine({
        price: level.price,
        color: level.kind === 'support' ? theme.positive : theme.warning,
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
