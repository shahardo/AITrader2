// Universe.tsx — universe browser page: searchable, exchange-filterable table of
// all instruments in the scan universe with their latest cached prices.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listInstruments } from '../api/client'

type ExchangeFilter = 'all' | 'us' | 'tase'

/** Universe browser: table of tracked instruments with latest-price summary. */
export default function UniversePage() {
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
      <h1 className="mb-4 text-2xl font-bold">Universe</h1>
      <div className="mb-4 flex gap-3">
        <input
          placeholder="Search symbol or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm"
        />
        <select
          aria-label="Exchange filter"
          value={exchange}
          onChange={(e) => setExchange(e.target.value as ExchangeFilter)}
          className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm"
        >
          <option value="all">All exchanges</option>
          <option value="us">US</option>
          <option value="tase">TASE</option>
        </select>
      </div>

      {isLoading && <p className="text-slate-400">Loading universe…</p>}
      {error && (
        <p role="alert" className="text-red-400">
          Failed to load instruments
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-slate-400">
          No instruments yet — run the universe loader (see README) to populate it.
        </p>
      )}
      {data && data.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="py-2">Symbol</th>
              <th>Name</th>
              <th>Exchange</th>
              <th>Sector</th>
              <th className="text-right">Last close</th>
              <th className="text-right">As of</th>
              <th className="text-right">History (bars)</th>
            </tr>
          </thead>
          <tbody>
            {data.map((inst) => (
              <tr key={inst.id} className="border-b border-slate-800 hover:bg-slate-900">
                <td className="py-2 font-mono">
                  <Link
                    to={`/stocks/${encodeURIComponent(inst.symbol)}`}
                    className="text-emerald-300 hover:underline"
                  >
                    {inst.symbol}
                  </Link>
                </td>
                <td>{inst.name}</td>
                <td className="uppercase">{inst.exchange}</td>
                <td className="text-slate-400">{inst.sector ?? '—'}</td>
                <td className="text-right">
                  {inst.last_close != null ? inst.last_close.toFixed(2) : '—'}
                </td>
                <td className="text-right text-slate-400">{inst.last_date ?? '—'}</td>
                <td className="text-right text-slate-400">{inst.bar_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
