// CandleChart.tsx — candlestick chart (TradingView lightweight-charts) with
// trend-channel band and support/resistance price-line overlays.

import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineStyle,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { PriceBarOut, SRLevelOut, TrendChannelOut } from '../api/client'

interface Props {
  bars: PriceBarOut[]
  channel?: TrendChannelOut | null
  srLevels?: SRLevelOut[]
  height?: number
}

/** Candlestick chart with channel and S/R overlays drawn as price lines. */
export default function CandleChart({ bars, channel, srLevels = [], height = 360 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return
    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      timeScale: { borderColor: '#334155' },
      rightPriceScale: { borderColor: '#334155' },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
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
        [channel.upper, 'channel top'],
        [channel.mid, 'channel mid'],
        [channel.lower, 'channel bottom'],
      ]
      for (const [price, title] of bands) {
        series.createPriceLine({
          price,
          color: '#38bdf8',
          lineStyle: title === 'channel mid' ? LineStyle.Dotted : LineStyle.Dashed,
          lineWidth: 1,
          title,
        })
      }
    }
    for (const level of srLevels) {
      series.createPriceLine({
        price: level.price,
        color: level.kind === 'support' ? '#10b981' : '#f59e0b',
        lineStyle: LineStyle.SparseDotted,
        lineWidth: 1,
        title: `${level.kind} (${level.touches})`,
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
  }, [bars, channel, srLevels, height])

  return <div ref={containerRef} data-testid="candle-chart" />
}
