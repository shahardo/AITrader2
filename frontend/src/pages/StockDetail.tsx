// StockDetail.tsx — stock detail page: candlestick chart with trend-channel and
// S/R overlays, technical score + per-indicator signal panel, and the sentiment
// drill-down (composite + scored media items).

import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ApiError, getAnalysis, getInstrument, getSentiment } from '../api/client'
import CandleChart from '../components/CandleChart'

const INDICATOR_LABELS: Record<string, string> = {
  sma_cross: 'SMA 50/200 cross',
  ema20: 'EMA 20',
  macd: 'MACD',
  rsi: 'RSI (14)',
  stochastic: 'Stochastic %K',
  bollinger: 'Bollinger %B',
  atr: 'ATR (volatility)',
  obv: 'OBV flow',
  vwap_distance: 'VWAP distance',
  adx: 'ADX',
  williams_r: 'Williams %R',
  cci: 'CCI',
  trend_channel: 'Trend channel',
  support_resistance: 'Support/Resistance',
}

/** Badge colors per signal direction. */
function signalBadge(signal: -1 | 0 | 1) {
  if (signal === 1) return <span className="rounded bg-emerald-900 px-2 py-0.5 text-emerald-300">BUY</span>
  if (signal === -1) return <span className="rounded bg-red-900 px-2 py-0.5 text-red-300">SELL</span>
  return <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-400">—</span>
}

/** Stock detail page for /stocks/:symbol. */
export default function StockDetailPage() {
  const { symbol = '' } = useParams()
  const detail = useQuery({
    queryKey: ['instrument', symbol],
    queryFn: () => getInstrument(symbol),
  })
  const analysis = useQuery({
    queryKey: ['analysis', symbol],
    queryFn: () => getAnalysis(symbol),
    retry: false,
  })
  const sentiment = useQuery({
    queryKey: ['sentiment', symbol],
    queryFn: () => getSentiment(symbol),
    retry: false,
  })

  if (detail.isLoading) return <p className="p-6 text-slate-400">Loading…</p>
  if (detail.error || !detail.data)
    return (
      <p role="alert" className="p-6 text-red-400">
        {detail.error instanceof ApiError && detail.error.status === 404
          ? 'Instrument not found'
          : 'Failed to load instrument'}
      </p>
    )

  const inst = detail.data
  const snap = analysis.data
  const noAnalysisYet =
    analysis.error instanceof ApiError && analysis.error.status === 404

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-baseline gap-4">
        <h1 className="text-2xl font-bold">
          <span className="font-mono text-emerald-300">{inst.symbol}</span> {inst.name}
        </h1>
        <span className="text-slate-400">
          {inst.last_close != null ? inst.last_close.toFixed(2) : '—'} {inst.currency}
        </span>
        {snap && (
          <span className="ml-auto rounded bg-slate-800 px-3 py-1 text-sm">
            Technical score <strong className="text-emerald-300">{snap.technical_score}</strong>
            /100
          </span>
        )}
      </header>

      <CandleChart
        bars={inst.bars}
        channel={snap?.extras.trend_channel ?? null}
        srLevels={snap?.extras.sr_levels ?? []}
      />

      <section>
        <h2 className="mb-2 text-lg font-semibold">Indicators</h2>
        {noAnalysisYet && (
          <p className="text-slate-400">
            No analysis yet — trigger a run from the Scores page or wait for the nightly
            pipeline.
          </p>
        )}
        {snap && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400">
                <th className="py-1">Indicator</th>
                <th>Signal</th>
                <th className="text-right">Strength</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(snap.signals).map(([key, sig]) => (
                <tr key={key} className="border-b border-slate-800">
                  <td className="py-1.5">{INDICATOR_LABELS[key] ?? key}</td>
                  <td>{signalBadge(sig.signal)}</td>
                  <td className="text-right">{(sig.strength * 100).toFixed(0)}%</td>
                  <td className="text-right text-slate-400">
                    {sig.value != null ? sig.value.toFixed(2) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Sentiment</h2>
        {sentiment.data ? (
          <>
            <p className="mb-2 text-sm text-slate-300">
              Composite <strong>{sentiment.data.score.toFixed(2)}</strong> (−1…+1) from{' '}
              {sentiment.data.item_count} items · confidence{' '}
              {(sentiment.data.confidence * 100).toFixed(0)}%
            </p>
            <ul className="space-y-2">
              {sentiment.data.items.map((item, i) => (
                <li key={i} className="rounded border border-slate-800 bg-slate-900 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        item.sentiment > 0.15
                          ? 'text-emerald-400'
                          : item.sentiment < -0.15
                            ? 'text-red-400'
                            : 'text-slate-400'
                      }
                    >
                      {item.sentiment > 0 ? '+' : ''}
                      {item.sentiment.toFixed(2)}
                    </span>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {item.title}
                    </a>
                    <span className="ml-auto text-xs text-slate-500">{item.source}</span>
                  </div>
                  {item.summary && <p className="mt-1 text-xs text-slate-400">{item.summary}</p>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-slate-400">No sentiment data yet for this instrument.</p>
        )}
      </section>
      <p className="text-xs text-slate-600">Not financial advice.</p>
    </div>
  )
}
