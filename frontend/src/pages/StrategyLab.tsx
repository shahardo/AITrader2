// StrategyLab.tsx — strategy interrogation page (PRD FR-10): the strategy
// library with latest train/test metrics, per-run equity curves, and the
// trade-by-trade decision log showing which signals triggered each trade.

import { useState } from 'react'
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
  return (
    <div className="rounded bg-slate-800 p-2 text-xs">
      <p className="mb-1 font-semibold text-slate-300">{label}</p>
      <p>
        Sharpe <strong>{metrics.sharpe?.toFixed(2) ?? '—'}</strong> · CAGR{' '}
        {metrics.cagr != null ? `${(metrics.cagr * 100).toFixed(1)}%` : '—'} · MaxDD{' '}
        {metrics.max_drawdown != null ? `${(metrics.max_drawdown * 100).toFixed(1)}%` : '—'} · win{' '}
        {metrics.win_rate != null ? `${(metrics.win_rate * 100).toFixed(0)}%` : '—'} ·{' '}
        {metrics.trade_count ?? 0} trades
      </p>
    </div>
  )
}

/** Drill-down into one run: equity curve + trade log. */
function RunDetail({ run }: { run: StrategyRunOut }) {
  const trades = useQuery({
    queryKey: ['run-trades', run.id],
    queryFn: () => listRunTrades(run.id),
  })
  return (
    <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
      <p className="text-xs text-slate-400">
        Train {run.train_start} → {run.train_end} · Test (out-of-sample) {run.test_start} →{' '}
        {run.test_end} · params {JSON.stringify(run.chosen_params)}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Metrics label="Train (in-sample)" metrics={run.train_metrics} />
        <Metrics label="Test (out-of-sample — drives selection)" metrics={run.test_metrics} />
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
      <h4 className="text-sm font-semibold">Trades ({trades.data?.length ?? '…'})</h4>
      {trades.data && trades.data.length === 0 && (
        <p className="text-sm text-slate-400">No trades in the test window.</p>
      )}
      {trades.data && trades.data.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="py-1">Date</th>
              <th>Side</th>
              <th>Symbol</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Price</th>
              <th className="text-right">P&L</th>
              <th>Triggering signals</th>
            </tr>
          </thead>
          <tbody>
            {trades.data.map((t, i) => (
              <tr key={i} className="border-b border-slate-800">
                <td className="py-1">{t.date}</td>
                <td className={t.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>
                  {t.side}
                </td>
                <td className="font-mono">{t.symbol}</td>
                <td className="text-right">{t.qty}</td>
                <td className="text-right">{t.price.toFixed(2)}</td>
                <td
                  className={`text-right ${(t.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  {t.pnl != null ? t.pnl.toFixed(0) : '—'}
                </td>
                <td className="text-slate-400">{JSON.stringify(t.triggering_signals)}</td>
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
  const [openRun, setOpenRun] = useState<number | null>(null)
  const runs = useQuery({
    queryKey: ['strategy-runs', strategyId],
    queryFn: () => listStrategyRuns(strategyId),
  })
  const latest = runs.data?.[0]
  return (
    <div className="rounded border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-baseline gap-3">
        <h2 className="font-semibold">{name}</h2>
        <span className="text-xs text-slate-500">suits {riskFit}</span>
        {latest && (
          <span className="ml-auto text-xs text-slate-400">
            latest test Sharpe{' '}
            <strong className="text-emerald-300">
              {latest.test_metrics.sharpe?.toFixed(2) ?? '—'}
            </strong>
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
      {runs.data && runs.data.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">Not evaluated yet.</p>
      )}
      {runs.data?.map((run) => (
        <div key={run.id} className="mt-2">
          <button
            onClick={() => setOpenRun(openRun === run.id ? null : run.id)}
            className="text-sm text-emerald-300 hover:underline"
          >
            Run {run.run_date} — test Sharpe {run.test_metrics.sharpe?.toFixed(2) ?? '—'}{' '}
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
  const queryClient = useQueryClient()
  const strategies = useQuery({ queryKey: ['strategies'], queryFn: listStrategies })
  const evaluate = useMutation({
    mutationFn: () => evaluateStrategies(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['strategy-runs'] }),
  })

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center gap-4">
        <h1 className="text-2xl font-bold">Strategy Lab</h1>
        <button
          onClick={() => evaluate.mutate()}
          disabled={evaluate.isPending}
          className="ml-auto rounded bg-emerald-600 px-4 py-1.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
        >
          {evaluate.isPending ? 'Evaluating (10mo train / 2mo test)…' : 'Re-evaluate strategies'}
        </button>
      </div>
      {evaluate.error && (
        <p role="alert" className="mb-3 text-sm text-red-400">
          Evaluation failed — load price history first (Universe page / data loader)
        </p>
      )}
      <p className="mb-4 text-sm text-slate-400">
        Each strategy is fitted on the first 10 months of the trailing year and validated on the
        last 2 months. Only out-of-sample (test) results drive strategy selection.
      </p>
      {strategies.isLoading && <p className="text-slate-400">Loading…</p>}
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
