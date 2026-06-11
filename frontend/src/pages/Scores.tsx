// Scores.tsx — universe leaderboard page: latest combined/technical/sentiment
// scores ranked best-first, plus a manual analysis trigger for selected symbols.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getLatestScores, runAnalysis } from '../api/client'

/** Leaderboard page at /scores. */
export default function ScoresPage() {
  const queryClient = useQueryClient()
  const [symbols, setSymbols] = useState('')
  const scores = useQuery({ queryKey: ['scores'], queryFn: getLatestScores })

  const run = useMutation({
    mutationFn: () =>
      runAnalysis({
        symbols: symbols
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        with_sentiment: true,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scores'] }),
  })

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Scores</h1>

      <div className="mb-4 flex gap-2">
        <input
          placeholder="Symbols to (re)analyze, e.g. AAPL, TEVA.TA"
          value={symbols}
          onChange={(e) => setSymbols(e.target.value)}
          className="w-96 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending || !symbols.trim()}
          className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
        >
          {run.isPending ? 'Analyzing…' : 'Run analysis'}
        </button>
      </div>
      {run.error && (
        <p role="alert" className="mb-3 text-sm text-red-400">
          Analysis run failed
        </p>
      )}

      {scores.isLoading && <p className="text-slate-400">Loading scores…</p>}
      {scores.data && scores.data.length === 0 && (
        <p className="text-slate-400">
          No scores yet — run an analysis above or wait for the nightly pipeline.
        </p>
      )}
      {scores.data && scores.data.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="py-2">#</th>
              <th>Symbol</th>
              <th>Name</th>
              <th className="text-right">Combined</th>
              <th className="text-right">Technical</th>
              <th className="text-right">Sentiment</th>
              <th className="text-right">As of</th>
            </tr>
          </thead>
          <tbody>
            {scores.data.map((row) => (
              <tr key={row.symbol} className="border-b border-slate-800 hover:bg-slate-900">
                <td className="py-2 text-slate-500">{row.rank ?? '—'}</td>
                <td>
                  <Link
                    to={`/stocks/${encodeURIComponent(row.symbol)}`}
                    className="font-mono text-emerald-300 hover:underline"
                  >
                    {row.symbol}
                  </Link>
                </td>
                <td>{row.name}</td>
                <td className="text-right font-semibold">{row.combined_score.toFixed(1)}</td>
                <td className="text-right text-slate-400">{row.technical_score.toFixed(1)}</td>
                <td className="text-right text-slate-400">
                  {row.sentiment_score != null ? row.sentiment_score.toFixed(2) : 'n/a'}
                </td>
                <td className="text-right text-slate-500">{row.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-4 text-xs text-slate-600">Not financial advice.</p>
    </div>
  )
}
