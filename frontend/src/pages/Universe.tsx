// Universe.tsx — universe browser page: searchable table of all instruments
// in the scan universe with their latest cached prices, filterable by
// exchange, sector and recommendation (all multi-select), sortable by every
// key column, with a sticky header so only the row list scrolls.

import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { getLatestScores, listInstruments, type InstrumentOut } from '../api/client'
import MultiSelectFilter from '../components/MultiSelectFilter'
import RecommendationBadge from '../components/RecommendationBadge'
import { recommendationAction } from '../lib/recommendation'

const NO_SECTOR = '__none__'
const NO_RECOMMENDATION = '__none__'

type SortColumn = 'symbol' | 'name' | 'exchange' | 'sector' | 'last_close' | 'recommendation'
type SortDirection = 'asc' | 'desc'

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

/** Up/down arrow shown on the active sort column's header. */
function SortArrow({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return null
  return <span className="ms-1 inline-block">{direction === 'asc' ? '▲' : '▼'}</span>
}

/** Universe browser: table of tracked instruments with latest-price summary. */
export default function UniversePage() {
  const { t } = useTranslation(['universe', 'stockDetail'])
  const [search, setSearch] = useState('')
  const [exchanges, setExchanges] = useState<Set<string>>(new Set())
  const [sectors, setSectors] = useState<Set<string>>(new Set())
  const [recommendations, setRecommendations] = useState<Set<string>>(new Set())
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const { data, isLoading, error } = useQuery({
    queryKey: ['instruments', search],
    queryFn: () => listInstruments({ search: search || undefined }),
  })
  const scores = useQuery({ queryKey: ['scores'], queryFn: getLatestScores })

  const scoreBySymbol = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of scores.data ?? []) map.set(row.symbol, row.combined_score)
    return map
  }, [scores.data])

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

  const recommendationOptions = [
    { value: 'BUY', label: t('stockDetail:recommendation.actions.buy') },
    { value: 'HOLD', label: t('stockDetail:recommendation.actions.hold') },
    { value: 'SELL', label: t('stockDetail:recommendation.actions.sell') },
    { value: NO_RECOMMENDATION, label: t('filters.noRecommendation') },
  ]

  /** This instrument's recommendation bucket, or NO_RECOMMENDATION when unscored. */
  const recommendationBucket = useCallback((symbol: string): string => {
    const score = scoreBySymbol.get(symbol)
    return score == null ? NO_RECOMMENDATION : recommendationAction(score)
  }, [scoreBySymbol])

  const filtered = useMemo(() => {
    if (!data) return data
    return data.filter((inst) => {
      if (exchanges.size > 0 && !exchanges.has(inst.exchange)) return false
      if (sectors.size > 0 && !sectors.has(inst.sector ?? NO_SECTOR)) return false
      if (recommendations.size > 0 && !recommendations.has(recommendationBucket(inst.symbol))) {
        return false
      }
      return true
    })
  }, [data, exchanges, sectors, recommendations, recommendationBucket])

  const sorted = useMemo(() => {
    if (!filtered || !sortColumn) return filtered
    const dir = sortDirection === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sortColumn) {
        case 'symbol':
          return dir * a.symbol.localeCompare(b.symbol)
        case 'name':
          return dir * a.name.localeCompare(b.name)
        case 'exchange':
          return dir * a.exchange.localeCompare(b.exchange)
        case 'sector':
          return dir * (a.sector ?? '').localeCompare(b.sector ?? '')
        case 'last_close':
          return dir * ((a.last_close ?? -Infinity) - (b.last_close ?? -Infinity))
        case 'recommendation':
          return (
            dir *
            ((scoreBySymbol.get(a.symbol) ?? -Infinity) - (scoreBySymbol.get(b.symbol) ?? -Infinity))
          )
        default:
          return 0
      }
    })
  }, [filtered, sortColumn, sortDirection, scoreBySymbol])

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

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-5xl flex-col p-6">
      <h1 className="mb-4 flex-shrink-0 text-2xl font-bold text-accent">{t('title')}</h1>
      <div className="mb-4 flex flex-shrink-0 gap-3">
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
      {data && data.length > 0 && sorted && (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-start text-sm">
            <thead className="sticky top-0 z-10 bg-app">
              <tr className="border-b border-edge-2 text-ink-3">
                <th
                  className="cursor-pointer select-none py-2 hover:text-ink"
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
                  className="cursor-pointer select-none hover:text-ink"
                  onClick={() => toggleSort('exchange')}
                  aria-sort={ariaSort('exchange')}
                >
                  <span onClick={(e) => e.stopPropagation()}>
                    <MultiSelectFilter
                      label={t('table.exchange')}
                      options={exchangeOptions}
                      selected={exchanges}
                      onChange={setExchanges}
                      clearLabel={t('filters.clear')}
                    />
                  </span>
                  <SortArrow active={sortColumn === 'exchange'} direction={sortDirection} />
                </th>
                <th
                  className="cursor-pointer select-none hover:text-ink"
                  onClick={() => toggleSort('sector')}
                  aria-sort={ariaSort('sector')}
                >
                  <span onClick={(e) => e.stopPropagation()}>
                    <MultiSelectFilter
                      label={t('table.sector')}
                      options={sectorOptions}
                      selected={sectors}
                      onChange={setSectors}
                      clearLabel={t('filters.clear')}
                    />
                  </span>
                  <SortArrow active={sortColumn === 'sector'} direction={sortDirection} />
                </th>
                <th
                  className="cursor-pointer select-none text-end hover:text-ink"
                  onClick={() => toggleSort('last_close')}
                  aria-sort={ariaSort('last_close')}
                >
                  {t('table.lastClose')}
                  <SortArrow active={sortColumn === 'last_close'} direction={sortDirection} />
                </th>
                <th className="text-end">{t('table.asOf')}</th>
                <th className="text-end">{t('table.historyBars')}</th>
                <th
                  className="cursor-pointer select-none text-end hover:text-ink"
                  onClick={() => toggleSort('recommendation')}
                  aria-sort={ariaSort('recommendation')}
                >
                  <span onClick={(e) => e.stopPropagation()}>
                    <MultiSelectFilter
                      label={t('table.recommendation')}
                      options={recommendationOptions}
                      selected={recommendations}
                      onChange={setRecommendations}
                      clearLabel={t('filters.clear')}
                    />
                  </span>
                  <SortArrow active={sortColumn === 'recommendation'} direction={sortDirection} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-ink-3">
                    {t('noMatches')}
                  </td>
                </tr>
              ) : (
                sorted.map((inst: InstrumentOut) => (
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
                    <td className="text-end">
                      {scoreBySymbol.has(inst.symbol) ? (
                        <RecommendationBadge score={scoreBySymbol.get(inst.symbol)!} />
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
