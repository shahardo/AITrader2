// Scores.tsx — universe leaderboard page: latest combined/technical/sentiment
// scores ranked best-first, plus a manual analysis trigger for selected symbols.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getLatestScores, runAnalysis } from '../api/client'
import Spinner from '../components/Spinner'

/** Leaderboard page at /scores. */
export default function ScoresPage() {
  const { t } = useTranslation(['scores', 'common'])
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
      <h1 className="mb-4 text-2xl font-bold text-accent">{t('title')}</h1>

      <div className="mb-4 flex gap-2">
        <input
          placeholder={t('analyzePlaceholder')}
          value={symbols}
          onChange={(e) => setSymbols(e.target.value)}
          className="w-96 rounded border border-edge-2 bg-panel-2 px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending || !symbols.trim()}
          className="flex items-center gap-2 rounded bg-accent-button px-4 py-1.5 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
        >
          {run.isPending ? t('analyzing') : t('runAnalysis')}
          {run.isPending && <Spinner className="h-4 w-4" />}
        </button>
      </div>
      {run.error && (
        <p role="alert" className="mb-3 text-sm text-negative">
          {t('analysisError')}
        </p>
      )}

      {scores.isLoading && <p className="text-ink-3">{t('loading')}</p>}
      {scores.data && scores.data.length === 0 && (
        <p className="text-ink-3">{t('empty')}</p>
      )}
      {scores.data && scores.data.length > 0 && (
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-edge-2 text-ink-3">
              <th className="py-2">{t('table.rank')}</th>
              <th>{t('table.symbol')}</th>
              <th>{t('table.name')}</th>
              <th className="text-end">{t('table.combined')}</th>
              <th className="text-end">{t('table.technical')}</th>
              <th className="text-end">{t('table.sentiment')}</th>
              <th className="text-end">{t('table.asOf')}</th>
            </tr>
          </thead>
          <tbody>
            {scores.data.map((row) => (
              <tr key={row.symbol} className="border-b border-edge hover:bg-panel">
                <td className="py-2 text-ink-4">{row.rank ?? '—'}</td>
                <td>
                  <Link
                    to={`/stocks/${encodeURIComponent(row.symbol)}`}
                    className="font-mono text-accent-link hover:underline"
                  >
                    {row.symbol}
                  </Link>
                </td>
                <td>{row.name}</td>
                <td className="text-end font-semibold">{row.combined_score.toFixed(1)}</td>
                <td className="text-end text-ink-3">{row.technical_score.toFixed(1)}</td>
                <td className="text-end text-ink-3">
                  {row.sentiment_score != null ? row.sentiment_score.toFixed(2) : t('table.sentimentNotAvailable')}
                </td>
                <td className="text-end text-ink-4">{row.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-4 text-xs text-ink-5">{t('common:disclaimerShort')}</p>
    </div>
  )
}
