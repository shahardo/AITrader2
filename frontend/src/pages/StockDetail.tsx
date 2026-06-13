// StockDetail.tsx — stock detail page: candlestick chart with trend-channel and
// S/R overlays, technical score + per-indicator signal panel, and the sentiment
// drill-down (composite + scored media items).

import { Fragment, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  getAnalysis,
  getInstrument,
  getSentiment,
  runAnalysis,
  type IndicatorSignal,
  type SnapshotOut,
} from '../api/client'
import BackIcon from '../components/BackIcon'
import CandleChart from '../components/CandleChart'
import CompanyLogo from '../components/CompanyLogo'
import InfoIcon from '../components/InfoIcon'
import Spinner from '../components/Spinner'
import { recommendationAction, RECOMMENDATION_BADGE_CLASSES, type RecommendationAction } from '../lib/recommendation'

type TFn = (key: string, options?: Record<string, unknown>) => string

/** Badge colors per signal direction. */
function signalBadge(signal: -1 | 0 | 1, t: TFn) {
  if (signal === 1)
    return <span className="rounded bg-positive-soft px-2 py-0.5 text-positive-soft-text">{t('signals.buy')}</span>
  if (signal === -1)
    return <span className="rounded bg-negative-soft px-2 py-0.5 text-negative-soft-text">{t('signals.sell')}</span>
  return <span className="rounded bg-panel-2 px-2 py-0.5 text-ink-3">{t('signals.neutral')}</span>
}

const DESCRIPTION_TRUNCATE_LENGTH = 280

// Sentiment-composite thresholds, matching the per-item badge coloring below.
const SENTIMENT_POSITIVE_THRESHOLD = 0.15
const SENTIMENT_NEGATIVE_THRESHOLD = -0.15

/** Badge colors per recommendation action. */
function recommendationBadge(action: RecommendationAction, t: TFn) {
  return (
    <span
      className={`rounded px-3 py-1 text-sm font-semibold ${RECOMMENDATION_BADGE_CLASSES[action]}`}
    >
      {t(`recommendation.actions.${action.toLowerCase()}`)}
    </span>
  )
}

/** Translated names of indicators signaling `direction`, strongest first. */
function topIndicatorNames(
  signals: Record<string, IndicatorSignal>,
  direction: -1 | 1,
  t: TFn,
  limit = 3,
): string[] {
  return Object.entries(signals)
    .filter(([, sig]) => sig.signal === direction && sig.strength > 0)
    .sort((a, b) => b[1].strength - a[1].strength)
    .slice(0, limit)
    .map(([key]) => t(`indicators.${key}`, { defaultValue: key }))
}

/** Plain-language recommendation explanation from the indicators + sentiment. */
function recommendationExplanation(snap: SnapshotOut, t: TFn): string {
  const score = snap.combined_score ?? snap.technical_score
  const scoreStr = score.toFixed(1)
  const action = recommendationAction(score)

  let main: string
  if (action === 'BUY') {
    const names = topIndicatorNames(snap.signals, 1, t)
    main = names.length
      ? t('recommendation.explanation.buyWithIndicators', { score: scoreStr, list: names.join(', ') })
      : t('recommendation.explanation.buyNoIndicators', { score: scoreStr })
  } else if (action === 'SELL') {
    const names = topIndicatorNames(snap.signals, -1, t)
    main = names.length
      ? t('recommendation.explanation.sellWithIndicators', { score: scoreStr, list: names.join(', ') })
      : t('recommendation.explanation.sellNoIndicators', { score: scoreStr })
  } else {
    const bullish = topIndicatorNames(snap.signals, 1, t, 1)[0]
    const bearish = topIndicatorNames(snap.signals, -1, t, 1)[0]
    main = bullish && bearish
      ? t('recommendation.explanation.holdMixed', { score: scoreStr, bullish, bearish })
      : t('recommendation.explanation.holdNeutral', { score: scoreStr })
  }

  let sentimentText: string
  if (snap.sentiment_score == null) sentimentText = t('recommendation.sentiment.unavailable')
  else if (snap.sentiment_score > SENTIMENT_POSITIVE_THRESHOLD)
    sentimentText = t('recommendation.sentiment.positive')
  else if (snap.sentiment_score < SENTIMENT_NEGATIVE_THRESHOLD)
    sentimentText = t('recommendation.sentiment.negative')
  else sentimentText = t('recommendation.sentiment.neutral')

  return `${main} ${sentimentText}`
}

/** Stock detail page for /stocks/:symbol. */
export default function StockDetailPage() {
  const { t } = useTranslation(['stockDetail', 'common'])
  const { symbol = '' } = useParams()
  const navigate = useNavigate()
  const [descExpanded, setDescExpanded] = useState(false)
  const [infoIndicator, setInfoIndicator] = useState<string | null>(null)
  const queryClient = useQueryClient()
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
  const runAnalysisMutation = useMutation({
    mutationFn: () => runAnalysis({ symbols: [symbol], with_sentiment: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysis', symbol] })
      queryClient.invalidateQueries({ queryKey: ['sentiment', symbol] })
    },
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
      <header className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t('common:actions.back')}
          title={t('common:actions.back')}
          className="rounded p-1.5 text-ink-3 hover:bg-panel-2 hover:text-ink"
        >
          <BackIcon className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-bold text-accent">
          <span className="font-mono text-accent-link">{inst.symbol}</span> {inst.name}
        </h1>
        <span className="text-ink-3">
          {inst.last_close != null ? inst.last_close.toFixed(2) : '—'} {inst.currency}
        </span>
        <div className="ms-auto flex items-center gap-2">
          {snap && (
            <span className="rounded bg-panel-2 px-3 py-1 text-sm">
              <Trans
                t={t}
                i18nKey="header.technicalScore"
                values={{ score: snap.technical_score }}
                components={{ strong: <strong className="text-accent-link" /> }}
              />
            </span>
          )}
          <button
            type="button"
            onClick={() => runAnalysisMutation.mutate()}
            disabled={runAnalysisMutation.isPending}
            className="flex items-center gap-2 rounded bg-accent-button px-3 py-1.5 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
          >
            {runAnalysisMutation.isPending ? t('actions.analyzing') : t('actions.runAnalysis')}
            {runAnalysisMutation.isPending && <Spinner className="h-4 w-4" />}
          </button>
        </div>
      </header>
      {runAnalysisMutation.error && (
        <p role="alert" className="text-sm text-negative">
          {t('actions.analysisError')}
        </p>
      )}

      {(inst.website || inst.description) && (
        <section className="rounded border border-edge bg-panel p-3">
          <div className="flex items-start gap-3">
            <CompanyLogo
              key={inst.website ?? inst.symbol}
              website={inst.website}
              name={inst.name}
              className="h-10 w-10"
            />
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
                <p dir="ltr" className="mt-1 text-start text-sm text-ink-3">
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
        <h2 className="mb-2 text-lg font-semibold">{t('recommendation.title')}</h2>
        {noAnalysisYet && <p className="text-ink-3">{t('recommendation.noAnalysis')}</p>}
        {snap && (
          <div className="rounded border border-edge bg-panel p-3">
            <div className="flex items-center gap-3">
              {recommendationBadge(recommendationAction(snap.combined_score ?? snap.technical_score), t)}
              <span className="text-sm text-ink-3">
                <Trans
                  t={t}
                  i18nKey="recommendation.scoreLabel"
                  values={{ score: (snap.combined_score ?? snap.technical_score).toFixed(1) }}
                  components={{ strong: <strong className="text-accent-link" /> }}
                />
              </span>
            </div>
            <p className="mt-2 text-sm text-ink-2">{recommendationExplanation(snap, t)}</p>
          </div>
        )}
      </section>

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
                <Fragment key={key}>
                  <tr className="border-b border-edge">
                    <td className="py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        {t(`indicators.${key}`, { defaultValue: key })}
                        <button
                          type="button"
                          onClick={() => setInfoIndicator(infoIndicator === key ? null : key)}
                          aria-expanded={infoIndicator === key}
                          aria-label={t('indicators.infoLabel')}
                          title={t('indicators.infoLabel')}
                          className="text-ink-4 hover:text-accent-link"
                        >
                          <InfoIcon className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </td>
                    <td>{signalBadge(sig.signal, t)}</td>
                    <td className="text-end">{(sig.strength * 100).toFixed(0)}%</td>
                    <td className="text-end text-ink-3">
                      {sig.value != null ? sig.value.toFixed(2) : '—'}
                    </td>
                  </tr>
                  {infoIndicator === key && (
                    <tr className="border-b border-edge">
                      <td colSpan={4} className="bg-panel-2 px-2 py-2 text-xs text-ink-3">
                        {t(`indicators.info.${key}`)}
                      </td>
                    </tr>
                  )}
                </Fragment>
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
