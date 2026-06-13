// StockDetail.tsx — stock detail page: candlestick chart with trend-channel and
// S/R overlays, technical score + per-indicator signal panel, and the sentiment
// drill-down (composite + scored media items).

import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ApiError, getAnalysis, getInstrument, getSentiment } from '../api/client'
import CandleChart from '../components/CandleChart'

/** Badge colors per signal direction. */
function signalBadge(signal: -1 | 0 | 1, t: (key: string) => string) {
  if (signal === 1)
    return <span className="rounded bg-positive-soft px-2 py-0.5 text-positive-soft-text">{t('signals.buy')}</span>
  if (signal === -1)
    return <span className="rounded bg-negative-soft px-2 py-0.5 text-negative-soft-text">{t('signals.sell')}</span>
  return <span className="rounded bg-panel-2 px-2 py-0.5 text-ink-3">{t('signals.neutral')}</span>
}

/** Derive a Clearbit logo URL from a company website, or null if unavailable. */
function logoUrl(website: string | null): string | null {
  if (!website) return null
  try {
    const host = new URL(website).hostname.replace(/^www\./, '')
    return `https://logo.clearbit.com/${host}`
  } catch {
    return null
  }
}

const DESCRIPTION_TRUNCATE_LENGTH = 280

/** Stock detail page for /stocks/:symbol. */
export default function StockDetailPage() {
  const { t } = useTranslation(['stockDetail', 'common'])
  const { symbol = '' } = useParams()
  const [descExpanded, setDescExpanded] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
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

  if (detail.isLoading) return <p className="p-6 text-ink-3">{t('common:actions.loading')}</p>
  if (detail.error || !detail.data)
    return (
      <p role="alert" className="p-6 text-negative">
        {detail.error instanceof ApiError && detail.error.status === 404
          ? t('errors.notFound')
          : t('errors.loadFailed')}
      </p>
    )

  const inst = detail.data
  const snap = analysis.data
  const noAnalysisYet =
    analysis.error instanceof ApiError && analysis.error.status === 404

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-baseline gap-4">
        <h1 className="text-2xl font-bold text-accent">
          <span className="font-mono text-accent-link">{inst.symbol}</span> {inst.name}
        </h1>
        <span className="text-ink-3">
          {inst.last_close != null ? inst.last_close.toFixed(2) : '—'} {inst.currency}
        </span>
        {snap && (
          <span className="ms-auto rounded bg-panel-2 px-3 py-1 text-sm">
            <Trans
              t={t}
              i18nKey="header.technicalScore"
              values={{ score: snap.technical_score }}
              components={{ strong: <strong className="text-accent-link" /> }}
            />
          </span>
        )}
      </header>

      {(inst.website || inst.description) && (
        <section className="rounded border border-edge bg-panel p-3">
          <div className="flex items-start gap-3">
            {inst.website && logoUrl(inst.website) && !logoFailed && (
              <img
                src={logoUrl(inst.website)!}
                alt={t('company.logoAlt', { name: inst.name })}
                className="h-10 w-10 rounded bg-white object-contain p-1"
                onError={() => setLogoFailed(true)}
              />
            )}
            <div className="min-w-0 flex-1">
              {inst.website && (
                <a
                  href={inst.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-accent-link hover:underline"
                >
                  {inst.website.replace(/^https?:\/\//, '')}
                </a>
              )}
              {inst.description && (
                <p className="mt-1 text-sm text-ink-3">
                  {descExpanded || inst.description.length <= DESCRIPTION_TRUNCATE_LENGTH
                    ? inst.description
                    : `${inst.description.slice(0, DESCRIPTION_TRUNCATE_LENGTH)}…`}
                  {inst.description.length > DESCRIPTION_TRUNCATE_LENGTH && (
                    <button
                      type="button"
                      onClick={() => setDescExpanded((v) => !v)}
                      className="ms-1 text-accent-link hover:underline"
                    >
                      {descExpanded ? t('company.showLess') : t('company.showMore')}
                    </button>
                  )}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      <CandleChart
        bars={inst.bars}
        channel={snap?.extras.trend_channel ?? null}
        srLevels={snap?.extras.sr_levels ?? []}
      />

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('indicators.title')}</h2>
        {noAnalysisYet && <p className="text-ink-3">{t('indicators.noAnalysis')}</p>}
        {snap && (
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-edge-2 text-ink-3">
                <th className="py-1">{t('indicators.table.indicator')}</th>
                <th>{t('indicators.table.signal')}</th>
                <th className="text-end">{t('indicators.table.strength')}</th>
                <th className="text-end">{t('indicators.table.value')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(snap.signals).map(([key, sig]) => (
                <tr key={key} className="border-b border-edge">
                  <td className="py-1.5">{t(`indicators.${key}`, { defaultValue: key })}</td>
                  <td>{signalBadge(sig.signal, t)}</td>
                  <td className="text-end">{(sig.strength * 100).toFixed(0)}%</td>
                  <td className="text-end text-ink-3">
                    {sig.value != null ? sig.value.toFixed(2) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('sentiment.title')}</h2>
        {sentiment.data ? (
          <>
            <p className="mb-2 text-sm text-ink-2">
              <Trans
                t={t}
                i18nKey="sentiment.composite"
                values={{
                  score: sentiment.data.score.toFixed(2),
                  count: sentiment.data.item_count,
                  pct: (sentiment.data.confidence * 100).toFixed(0),
                }}
                components={{ strong: <strong /> }}
              />
            </p>
            <ul className="space-y-2">
              {sentiment.data.items.map((item, i) => (
                <li key={i} className="rounded border border-edge bg-panel p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        item.sentiment > 0.15
                          ? 'text-positive'
                          : item.sentiment < -0.15
                            ? 'text-negative'
                            : 'text-ink-3'
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
                    <span className="ms-auto text-xs text-ink-4">{item.source}</span>
                  </div>
                  {item.summary && <p className="mt-1 text-xs text-ink-3">{item.summary}</p>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-ink-3">{t('sentiment.empty')}</p>
        )}
      </section>
      <p className="text-xs text-ink-5">{t('common:disclaimerShort')}</p>
    </div>
  )
}
