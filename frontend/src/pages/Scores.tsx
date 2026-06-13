// Scores.tsx — universe leaderboard page: latest combined/technical/sentiment
// scores ranked best-first, plus a manual analysis trigger for selected symbols.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getLatestScores, runAnalysis } from '../api/client'
import SortArrow, { type SortDirection } from '../components/SortArrow'
import Spinner from '../components/Spinner'

type SortColumn = 'rank' | 'symbol' | 'name' | 'combined' | 'technical' | 'sentiment' | 'asOf'

/** Leaderboard page at /scores. */
export default function ScoresPage() {
  const { t } = useTranslation(['scores', 'common'])
  const queryClient = useQueryClient()
  const [symbols, setSymbols] = useState('')
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const scores = useQuery({ queryKey: ['scores'], queryFn: getLatestScores })

  const sorted = useMemo(() => {
    if (!scores.data || !sortColumn) return scores.data
    const dir = sortDirection === 'asc' ? 1 : -1
    return [...scores.data].sort((a, b) => {
      switch (sortColumn) {
        case 'rank':
          return dir * ((a.rank ?? -Infinity) - (b.rank ?? -Infinity))
        case 'symbol':
          return dir * a.symbol.localeCompare(b.symbol)
        case 'name':
          return dir * a.name.localeCompare(b.name)
        case 'combined':
          return dir * (a.combined_score - b.combined_score)
        case 'technical':
          return dir * (a.technical_score - b.technical_score)
        case 'sentiment':
          return dir * ((a.sentiment_score ?? -Infinity) - (b.sentiment_score ?? -Infinity))
        case 'asOf':
          return dir * a.date.localeCompare(b.date)
        default:
          return 0
      }
    })
  }, [scores.data, sortColumn, sortDirection])

  /** Toggle sort on a column: ascending on first click, descending on the next. */
  function toggleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  /** aria-sort value for a sortable column header. */
  function ariaSort(column: SortColumn): 'ascending' | 'descending' | 'none' {
    if (sortColumn !== column) return 'none'
    return sortDirection === 'asc' ? 'ascending' : 'descending'
  }

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
      {sorted && sorted.length > 0 && (
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-edge-2 text-ink-3">
              <th
                className="cursor-pointer select-none py-2 hover:text-ink"
                onClick={() => toggleSort('rank')}
                aria-sort={ariaSort('rank')}
              >
                {t('table.rank')}
                <SortArrow active={sortColumn === 'rank'} direction={sortDirection} />
              </th>
              <th
                className="cursor-pointer select-none hover:text-ink"
                onClick={() => toggleSort('symbol')}
                aria-sort={ariaSort('symbol')}
              >
                {t('table.symbol')}
                <SortArrow active={sortColumn === 'symbol'} direction={sortDirection} />
              </th>
              <th
                className="cursor-pointer select-none hover:text-ink"
                onClick={() => toggleSort('name')}
                aria-sort={ariaSort('name')}
              >
                {t('table.name')}
                <SortArrow active={sortColumn === 'name'} direction={sortDirection} />
              </th>
              <th
                className="cursor-pointer select-none text-end hover:text-ink"
                onClick={() => toggleSort('combined')}
                aria-sort={ariaSort('combined')}
              >
                {t('table.combined')}
                <SortArrow active={sortColumn === 'combined'} direction={sortDirection} />
              </th>
              <th
                className="cursor-pointer select-none text-end hover:text-ink"
                onClick={() => toggleSort('technical')}
                aria-sort={ariaSort('technical')}
              >
                {t('table.technical')}
                <SortArrow active={sortColumn === 'technical'} direction={sortDirection} />
              </th>
              <th
                className="cursor-pointer select-none text-end hover:text-ink"
                onClick={() => toggleSort('sentiment')}
                aria-sort={ariaSort('sentiment')}
              >
                {t('table.sentiment')}
                <SortArrow active={sortColumn === 'sentiment'} direction={sortDirection} />
              </th>
              <th
                className="cursor-pointer select-none text-end hover:text-ink"
                onClick={() => toggleSort('asOf')}
                aria-sort={ariaSort('asOf')}
              >
                {t('table.asOf')}
                <SortArrow active={sortColumn === 'asOf'} direction={sortDirection} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
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
