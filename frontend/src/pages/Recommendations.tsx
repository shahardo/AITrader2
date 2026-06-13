// Recommendations.tsx — recommendation feed per portfolio: pending calls with
// approve/reject actions, history of executed/rejected calls, and a manual
// "generate now" trigger that runs the daily pass on demand.

import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  approveRecommendation,
  generateRecommendations,
  listPortfolios,
  listRecommendations,
  rejectRecommendation,
  type RecommendationOut,
} from '../api/client'

/** Action badge colored by BUY/SELL. */
function ActionBadge({ action }: { action: string }) {
  const cls =
    action === 'BUY'
      ? 'bg-positive-soft text-positive-soft-text'
      : action === 'SELL'
        ? 'bg-negative-soft text-negative-soft-text'
        : 'bg-panel-2 text-ink-3'
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>{action}</span>
}

/** One recommendation card with approve/reject controls when pending. */
function RecCard({ rec, onChanged }: { rec: RecommendationOut; onChanged: () => void }) {
  const { t } = useTranslation('recommendations')
  const approve = useMutation({ mutationFn: () => approveRecommendation(rec.id), onSuccess: onChanged })
  const reject = useMutation({ mutationFn: () => rejectRecommendation(rec.id), onSuccess: onChanged })
  return (
    <li className="rounded border border-edge bg-panel p-3 text-sm">
      <div className="flex items-center gap-3">
        <ActionBadge action={rec.action} />
        <span className="font-mono text-accent-link">{rec.symbol}</span>
        <span>× {rec.qty}</span>
        <span className="text-ink-4">
          {t('card.priceConfidence', {
            price: rec.price_at_recommendation?.toFixed(2) ?? '—',
            confidence: (rec.confidence * 100).toFixed(0),
          })}
        </span>
        <span className="ms-auto text-xs uppercase text-ink-4">{rec.status}</span>
      </div>
      {rec.explanation && <p className="mt-2 text-ink-2">{rec.explanation}</p>}
      {rec.status === 'pending' && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
            className="rounded bg-accent-button px-3 py-1 text-xs font-semibold hover:bg-accent-button-hover disabled:opacity-50"
          >
            {t('card.approve')}
          </button>
          <button
            onClick={() => reject.mutate()}
            disabled={reject.isPending}
            className="rounded bg-panel-3 px-3 py-1 text-xs hover:bg-panel-2 disabled:opacity-50"
          >
            {t('card.reject')}
          </button>
        </div>
      )}
    </li>
  )
}

/** Recommendations feed page at /recommendations. */
export default function RecommendationsPage() {
  const { t } = useTranslation(['recommendations', 'common'])
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const portfolios = useQuery({ queryKey: ['portfolios'], queryFn: listPortfolios })
  const selected = Number(params.get('portfolio')) || portfolios.data?.[0]?.id || null

  const recs = useQuery({
    queryKey: ['recommendations', selected],
    queryFn: () => listRecommendations(selected!),
    enabled: selected != null,
  })
  const generate = useMutation({
    mutationFn: () => generateRecommendations(selected!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recommendations'] }),
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['recommendations'] })
    queryClient.invalidateQueries({ queryKey: ['portfolios'] })
  }

  const pending = recs.data?.filter((r) => r.status === 'pending') ?? []
  const history = recs.data?.filter((r) => r.status !== 'pending') ?? []

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-bold text-accent">{t('title')}</h1>
      <div className="mb-4 flex items-center gap-3">
        <select
          aria-label={t('portfolioAriaLabel')}
          value={selected ?? ''}
          onChange={(e) => setParams({ portfolio: e.target.value })}
          className="rounded border border-edge-2 bg-panel-2 px-2 py-1.5 text-sm"
        >
          {portfolios.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => generate.mutate()}
          disabled={generate.isPending || selected == null}
          className="rounded bg-accent-button px-4 py-1.5 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
        >
          {generate.isPending ? t('generating') : t('generate')}
        </button>
      </div>
      {generate.error && (
        <p role="alert" className="mb-3 text-sm text-negative">
          {generate.error instanceof ApiError ? generate.error.message : t('generateError')}
        </p>
      )}
      {generate.isSuccess && generate.data.length === 0 && (
        <p className="mb-3 text-sm text-ink-3">{t('generateEmpty')}</p>
      )}

      {portfolios.data && portfolios.data.length === 0 && (
        <p className="text-ink-3">{t('noPortfolios')}</p>
      )}

      <h2 className="mb-2 text-lg font-semibold">{t('pending', { count: pending.length })}</h2>
      {pending.length === 0 && <p className="mb-4 text-ink-3">{t('pendingEmpty')}</p>}
      <ul className="mb-6 space-y-2">
        {pending.map((rec) => (
          <RecCard key={rec.id} rec={rec} onChanged={refresh} />
        ))}
      </ul>

      <h2 className="mb-2 text-lg font-semibold">{t('history')}</h2>
      {history.length === 0 && <p className="text-ink-3">{t('historyEmpty')}</p>}
      <ul className="space-y-2">
        {history.map((rec) => (
          <RecCard key={rec.id} rec={rec} onChanged={refresh} />
        ))}
      </ul>
      <p className="mt-6 text-xs text-ink-5">{t('common:disclaimer')}</p>
    </div>
  )
}
