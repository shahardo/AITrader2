// Universe.tsx — universe browser page: searchable, exchange-filterable table of
// all instruments in the scan universe with their latest cached prices.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { listInstruments } from '../api/client'

type ExchangeFilter = 'all' | 'us' | 'tase'

/** Universe browser: table of tracked instruments with latest-price summary. */
export default function UniversePage() {
  const { t } = useTranslation('universe')
  const [exchange, setExchange] = useState<ExchangeFilter>('all')
  const [search, setSearch] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['instruments', exchange, search],
    queryFn: () =>
      listInstruments({
        exchange: exchange === 'all' ? undefined : exchange,
        search: search || undefined,
      }),
  })

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-2xl font-bold">{t('title')}</h1>
      <div className="mb-4 flex gap-3">
        <input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-edge-2 bg-panel-2 px-3 py-1.5 text-sm"
        />
        <select
          aria-label={t('exchangeFilterAriaLabel')}
          value={exchange}
          onChange={(e) => setExchange(e.target.value as ExchangeFilter)}
          className="rounded border border-edge-2 bg-panel-2 px-2 py-1.5 text-sm"
        >
          <option value="all">{t('exchangeOptions.all')}</option>
          <option value="us">{t('exchangeOptions.us')}</option>
          <option value="tase">{t('exchangeOptions.tase')}</option>
        </select>
      </div>

      {isLoading && <p className="text-ink-3">{t('loading')}</p>}
      {error && (
        <p role="alert" className="text-negative">
          {t('error')}
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-ink-3">{t('empty')}</p>
      )}
      {data && data.length > 0 && (
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-edge-2 text-ink-3">
              <th className="py-2">{t('table.symbol')}</th>
              <th>{t('table.name')}</th>
              <th>{t('table.exchange')}</th>
              <th>{t('table.sector')}</th>
              <th className="text-end">{t('table.lastClose')}</th>
              <th className="text-end">{t('table.asOf')}</th>
              <th className="text-end">{t('table.historyBars')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((inst) => (
              <tr key={inst.id} className="border-b border-edge hover:bg-panel">
                <td className="py-2 font-mono">
                  <Link
                    to={`/stocks/${encodeURIComponent(inst.symbol)}`}
                    className="text-accent-link hover:underline"
                  >
                    {inst.symbol}
                  </Link>
                </td>
                <td>{inst.name}</td>
                <td className="uppercase">{inst.exchange}</td>
                <td className="text-ink-3">{inst.sector ?? '—'}</td>
                <td className="text-end">
                  {inst.last_close != null ? inst.last_close.toFixed(2) : '—'}
                </td>
                <td className="text-end text-ink-3">{inst.last_date ?? '—'}</td>
                <td className="text-end text-ink-3">{inst.bar_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
