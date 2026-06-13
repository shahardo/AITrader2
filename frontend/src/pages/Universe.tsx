// Universe.tsx — universe browser page: searchable table of all instruments
// in the scan universe with their latest cached prices, filterable by
// exchange and sector (both multi-select).

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { listInstruments, type InstrumentOut } from '../api/client'
import MultiSelectFilter from '../components/MultiSelectFilter'

const NO_SECTOR = '__none__'

/** Colored "(±pct% arrow)" suffix for a price change, green for up, red for down. */
function PriceChange({ pct }: { pct: number }) {
  const up = pct > 0
  const down = pct < 0
  const colorClass = up ? 'text-positive' : down ? 'text-negative' : 'text-ink-3'
  const arrow = up ? '▲' : down ? '▼' : '–'
  const sign = up ? '+' : ''
  return (
    <span className={`ms-1 text-xs ${colorClass}`}>
      ({sign}
      {pct.toFixed(2)}% {arrow})
    </span>
  )
}

/** Universe browser: table of tracked instruments with latest-price summary. */
export default function UniversePage() {
  const { t } = useTranslation('universe')
  const [search, setSearch] = useState('')
  const [exchanges, setExchanges] = useState<Set<string>>(new Set())
  const [sectors, setSectors] = useState<Set<string>>(new Set())

  const { data, isLoading, error } = useQuery({
    queryKey: ['instruments', search],
    queryFn: () => listInstruments({ search: search || undefined }),
  })

  const exchangeOptions = [
    { value: 'us', label: t('exchangeOptions.us') },
    { value: 'tase', label: t('exchangeOptions.tase') },
  ]

  const sectorOptions = useMemo(() => {
    const found = new Set<string>()
    let hasUnsectored = false
    for (const inst of data ?? []) {
      if (inst.sector) found.add(inst.sector)
      else hasUnsectored = true
    }
    const options = Array.from(found)
      .sort()
      .map((sector) => ({ value: sector, label: sector }))
    if (hasUnsectored) options.push({ value: NO_SECTOR, label: t('filters.noSector') })
    return options
  }, [data, t])

  const filtered = useMemo(() => {
    if (!data) return data
    return data.filter((inst) => {
      if (exchanges.size > 0 && !exchanges.has(inst.exchange)) return false
      if (sectors.size > 0 && !sectors.has(inst.sector ?? NO_SECTOR)) return false
      return true
    })
  }, [data, exchanges, sectors])

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-2xl font-bold text-accent">{t('title')}</h1>
      <div className="mb-4 flex gap-3">
        <input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-edge-2 bg-panel-2 px-3 py-1.5 text-sm"
        />
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
      {data && data.length > 0 && filtered && (
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-edge-2 text-ink-3">
              <th className="py-2">{t('table.symbol')}</th>
              <th>{t('table.name')}</th>
              <th>
                <MultiSelectFilter
                  label={t('table.exchange')}
                  options={exchangeOptions}
                  selected={exchanges}
                  onChange={setExchanges}
                  clearLabel={t('filters.clear')}
                />
              </th>
              <th>
                <MultiSelectFilter
                  label={t('table.sector')}
                  options={sectorOptions}
                  selected={sectors}
                  onChange={setSectors}
                  clearLabel={t('filters.clear')}
                />
              </th>
              <th className="text-end">{t('table.lastClose')}</th>
              <th className="text-end">{t('table.asOf')}</th>
              <th className="text-end">{t('table.historyBars')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-4 text-center text-ink-3">
                  {t('noMatches')}
                </td>
              </tr>
            ) : (
              filtered.map((inst: InstrumentOut) => (
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
                    {inst.last_close != null ? (
                      <>
                        {inst.last_close.toFixed(2)}
                        {inst.prev_close != null && inst.prev_close !== 0 && (
                          <PriceChange
                            pct={((inst.last_close - inst.prev_close) / inst.prev_close) * 100}
                          />
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="text-end text-ink-3">{inst.last_date ?? '—'}</td>
                  <td className="text-end text-ink-3">{inst.bar_count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
