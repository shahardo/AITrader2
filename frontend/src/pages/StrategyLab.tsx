// StrategyLab.tsx — strategy interrogation page (PRD FR-10): the strategy
// library with latest train/test metrics, per-run equity curves, and the
// trade-by-trade decision log showing which signals triggered each trade.

import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  evaluateStrategies,
  listRunTrades,
  listStrategies,
  listStrategyRuns,
  type StrategyRunOut,
} from '../api/client'
import LineCompareChart from '../components/LineCompareChart'

/** Format a metrics dict into compact text. */
function Metrics({ label, metrics }: { label: string; metrics: Record<string, number> }) {
  const { t } = useTranslation('strategyLab')
  return (
    <div className="rounded bg-panel-2 p-2 text-xs">
      <p className="mb-1 font-semibold text-ink-2">{label}</p>
      <p>
        <Trans
          t={t}
          i18nKey="metrics.summary"
          values={{
            sharpe: metrics.sharpe?.toFixed(2) ?? '—',
            cagr: metrics.cagr != null ? `${(metrics.cagr * 100).toFixed(1)}%` : '—',
            maxDrawdown:
              metrics.max_drawdown != null ? `${(metrics.max_drawdown * 100).toFixed(1)}%` : '—',
            winRate: metrics.win_rate != null ? `${(metrics.win_rate * 100).toFixed(0)}%` : '—',
            count: metrics.trade_count ?? 0,
          }}
          components={{ strong: <strong /> }}
        />
      </p>
    </div>
  )
}

/** Drill-down into one run: equity curve + trade log. */
function RunDetail({ run }: { run: StrategyRunOut }) {
  const { t } = useTranslation('strategyLab')
  const trades = useQuery({
    queryKey: ['run-trades', run.id],
    queryFn: () => listRunTrades(run.id),
  })
  return (
    <div className="mt-3 space-y-3 border-t border-edge pt-3">
      <p className="text-xs text-ink-3">
        {t('detail.summary', {
          trainStart: run.train_start,
          trainEnd: run.train_end,
          testStart: run.test_start,
          testEnd: run.test_end,
          params: JSON.stringify(run.chosen_params),
        })}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Metrics label={t('metrics.train')} metrics={run.train_metrics} />
        <Metrics label={t('metrics.test')} metrics={run.test_metrics} />
      </div>
      {run.equity_curve.length > 1 && (
        <LineCompareChart
          curves={[
            {
              name: 'Test equity',
              points: run.equity_curve.map(([date, value]) => ({ date, value })),
            },
          ]}
          normalize={false}
          height={200}
        />
      )}
      <h4 className="text-sm font-semibold">
        {t('detail.tradesHeading', { count: trades.data?.length ?? '…' })}
      </h4>
      {trades.data && trades.data.length === 0 && (
        <p className="text-sm text-ink-3">{t('detail.noTrades')}</p>
      )}
      {trades.data && trades.data.length > 0 && (
        <table className="w-full text-start text-xs">
          <thead>
            <tr className="border-b border-edge-2 text-ink-3">
              <th className="py-1">{t('detail.table.date')}</th>
              <th>{t('detail.table.side')}</th>
              <th>{t('detail.table.symbol')}</th>
              <th className="text-end">{t('detail.table.qty')}</th>
              <th className="text-end">{t('detail.table.price')}</th>
              <th className="text-end">{t('detail.table.pnl')}</th>
              <th>{t('detail.table.triggeringSignals')}</th>
            </tr>
          </thead>
          <tbody>
            {trades.data.map((t2, i) => (
              <tr key={i} className="border-b border-edge">
                <td className="py-1">{t2.date}</td>
                <td className={t2.side === 'BUY' ? 'text-positive' : 'text-negative'}>
                  {t2.side}
                </td>
                <td className="font-mono">{t2.symbol}</td>
                <td className="text-end">{t2.qty}</td>
                <td className="text-end">{t2.price.toFixed(2)}</td>
                <td
                  className={`text-end ${(t2.pnl ?? 0) >= 0 ? 'text-positive' : 'text-negative'}`}
                >
                  {t2.pnl != null ? t2.pnl.toFixed(0) : '—'}
                </td>
                <td className="text-ink-3">{JSON.stringify(t2.triggering_signals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** One strategy card with its runs. */
function StrategyCard({
  strategyId,
  name,
  description,
  riskFit,
}: {
  strategyId: number
  name: string
  description: string
  riskFit: string
}) {
  const { t } = useTranslation('strategyLab')
  const [openRun, setOpenRun] = useState<number | null>(null)
  const runs = useQuery({
    queryKey: ['strategy-runs', strategyId],
    queryFn: () => listStrategyRuns(strategyId),
  })
  const latest = runs.data?.[0]
  return (
    <div className="rounded border border-edge bg-panel p-4">
      <div className="flex items-baseline gap-3">
        <h2 className="font-semibold">{name}</h2>
        <span className="text-xs text-ink-4">{t('card.suits', { riskFit })}</span>
        {latest && (
          <span className="ms-auto text-xs text-ink-3">
            {t('card.latestTestSharpe')}{' '}
            <strong className="text-accent-link">
              {latest.test_metrics.sharpe?.toFixed(2) ?? '—'}
            </strong>
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-3">{description}</p>
      {runs.data && runs.data.length === 0 && (
        <p className="mt-2 text-sm text-ink-4">{t('card.notEvaluated')}</p>
      )}
      {runs.data?.map((run) => (
        <div key={run.id} className="mt-2">
          <button
            onClick={() => setOpenRun(openRun === run.id ? null : run.id)}
            className="text-sm text-accent-link hover:underline"
          >
            {t('card.run', {
              date: run.run_date,
              value: run.test_metrics.sharpe?.toFixed(2) ?? '—',
            })}{' '}
            {openRun === run.id ? '▾' : '▸'}
          </button>
          {openRun === run.id && <RunDetail run={run} />}
        </div>
      ))}
    </div>
  )
}

/** Strategy Lab page at /strategies. */
export default function StrategyLabPage() {
  const { t } = useTranslation('strategyLab')
  const queryClient = useQueryClient()
  const strategies = useQuery({ queryKey: ['strategies'], queryFn: listStrategies })
  const evaluate = useMutation({
    mutationFn: () => evaluateStrategies(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['strategy-runs'] }),
  })

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center gap-4">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <button
          onClick={() => evaluate.mutate()}
          disabled={evaluate.isPending}
          className="ms-auto rounded bg-accent-button px-4 py-1.5 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
        >
          {evaluate.isPending ? t('actions.evaluating') : t('actions.reevaluate')}
        </button>
      </div>
      {evaluate.error && (
        <p role="alert" className="mb-3 text-sm text-negative">
          {t('errors.evaluationFailed')}
        </p>
      )}
      <p className="mb-4 text-sm text-ink-3">{t('description')}</p>
      {strategies.isLoading && <p className="text-ink-3">{t('loading')}</p>}
      <div className="space-y-4">
        {strategies.data?.map((s) => (
          <StrategyCard
            key={s.id}
            strategyId={s.id}
            name={s.name}
            description={s.description}
            riskFit={s.risk_fit}
          />
        ))}
      </div>
    </div>
  )
}
