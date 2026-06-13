// StrategyLab.tsx — strategy interrogation page (PRD FR-10): the strategy
// library with latest train/test metrics, per-run equity curves, and the
// trade-by-trade decision log showing which signals triggered each trade.

import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  evaluateStrategies,
  evolveStrategy,
  getEvolutionRun,
  listEvolutionRuns,
  listRunTrades,
  listStrategies,
  listStrategyRuns,
  type EvolveOptions,
  type StrategyRunOut,
} from '../api/client'
import FitnessChart from '../components/FitnessChart'
import InfoIcon from '../components/InfoIcon'
import LineCompareChart from '../components/LineCompareChart'
import Spinner from '../components/Spinner'

const DEFAULT_EVOLVE_OPTIONS: Required<EvolveOptions> = {
  population_size: 50,
  generations: 30,
  max_symbols: 25,
  risk_weight: 1.0,
}

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

const GENE_WEIGHT_PREFIX = 'weight_'

/** Build-options form + live progress/result for the evolved (GA) strategy. */
function EvolutionPanel({
  strategyId,
  runs,
}: {
  strategyId: number
  runs: StrategyRunOut[] | undefined
}) {
  const { t } = useTranslation('strategyLab')
  const queryClient = useQueryClient()
  const [options, setOptions] = useState<Required<EvolveOptions>>(DEFAULT_EVOLVE_OPTIONS)
  const [manualRunId, setManualRunId] = useState<number | null>(null)

  const recentRuns = useQuery({ queryKey: ['evolution-runs'], queryFn: listEvolutionRuns })
  const activeRun = recentRuns.data?.find((r) => r.status === 'pending' || r.status === 'running')
  const runId = manualRunId ?? activeRun?.id ?? null

  const evolutionRun = useQuery({
    queryKey: ['evolution-run', runId],
    queryFn: () => getEvolutionRun(runId as number),
    enabled: runId != null,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'pending' || status === 'running' ? 2000 : false
    },
  })

  const evolve = useMutation({
    mutationFn: () => evolveStrategy(options),
    onSuccess: (run) => setManualRunId(run.id),
  })

  const run = evolutionRun.data
  const isActive = run?.status === 'pending' || run?.status === 'running'

  useEffect(() => {
    if (run?.status === 'done') {
      queryClient.invalidateQueries({ queryKey: ['strategy-runs', strategyId] })
    }
  }, [run?.status, queryClient, strategyId])

  const rank1 = runs?.find((r) => r.rank === 1)
  const weightEntries = rank1
    ? Object.entries(rank1.chosen_params).filter(([key]) => key.startsWith(GENE_WEIGHT_PREFIX))
    : []

  return (
    <div className="mt-3 space-y-3 border-t border-edge pt-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-xs text-ink-3">
          {t('evolved.populationSize')}
          <input
            type="number"
            min={10}
            max={200}
            value={options.population_size}
            onChange={(e) =>
              setOptions((o) => ({ ...o, population_size: Number(e.target.value) }))
            }
            className="mt-1 block w-full rounded border border-edge bg-panel-2 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-ink-3">
          {t('evolved.generations')}
          <input
            type="number"
            min={5}
            max={100}
            value={options.generations}
            onChange={(e) => setOptions((o) => ({ ...o, generations: Number(e.target.value) }))}
            className="mt-1 block w-full rounded border border-edge bg-panel-2 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-ink-3">
          {t('evolved.maxSymbols')}
          <input
            type="number"
            min={5}
            max={60}
            value={options.max_symbols}
            onChange={(e) => setOptions((o) => ({ ...o, max_symbols: Number(e.target.value) }))}
            className="mt-1 block w-full rounded border border-edge bg-panel-2 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-ink-3">
          {t('evolved.riskWeight')}
          <input
            type="number"
            min={0}
            max={5}
            step={0.1}
            value={options.risk_weight}
            onChange={(e) => setOptions((o) => ({ ...o, risk_weight: Number(e.target.value) }))}
            className="mt-1 block w-full rounded border border-edge bg-panel-2 px-2 py-1 text-sm"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={() => evolve.mutate()}
        disabled={evolve.isPending || isActive}
        className="flex items-center gap-2 rounded bg-accent-button px-4 py-1.5 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
      >
        {isActive
          ? t('evolved.building', { current: run.current_generation, total: run.generations })
          : t('evolved.build')}
        {isActive && <Spinner className="h-4 w-4" />}
      </button>
      {isActive && run.fitness_history.length > 0 && (
        <FitnessChart history={run.fitness_history} />
      )}
      {run?.status === 'failed' && (
        <p role="alert" className="text-sm text-negative">
          {t('evolved.failed', { error: run.error_message })}
        </p>
      )}
      {rank1 && (
        <div className="rounded bg-panel-2 p-2 text-xs">
          <p className="mb-1 font-semibold text-ink-2">{t('evolved.weights')}</p>
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {weightEntries.map(([key, value]) => (
              <li key={key}>
                {key.slice(GENE_WEIGHT_PREFIX.length)}: {Number(value).toFixed(2)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-ink-3">
            {t('evolved.entryThreshold')}: {Number(rank1.chosen_params.entry_threshold).toFixed(2)}
            {' · '}
            {t('evolved.exitThreshold')}: {Number(rank1.chosen_params.exit_threshold).toFixed(2)}
          </p>
        </div>
      )}
      {!rank1 && !run && !recentRuns.isLoading && (
        <p className="text-sm text-ink-4">{t('evolved.neverRun')}</p>
      )}
    </div>
  )
}

/** One strategy card with its runs. */
function StrategyCard({
  strategyId,
  name,
  kind,
  description,
  riskFit,
}: {
  strategyId: number
  name: string
  kind: string
  description: string
  riskFit: string
}) {
  const { t } = useTranslation('strategyLab')
  const [openRun, setOpenRun] = useState<number | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const runs = useQuery({
    queryKey: ['strategy-runs', strategyId],
    queryFn: () => listStrategyRuns(strategyId),
  })
  const latest = runs.data?.[0]
  return (
    <div className="rounded border border-edge bg-panel p-4">
      <div className="flex items-baseline gap-3">
        <h2 className="font-semibold">{name}</h2>
        <button
          type="button"
          onClick={() => setInfoOpen((open) => !open)}
          aria-expanded={infoOpen}
          aria-label={t('info.toggleLabel')}
          title={t('info.toggleLabel')}
          className="text-ink-4 hover:text-accent-link"
        >
          <InfoIcon className="h-4 w-4" />
        </button>
        <span className="text-xs text-ink-4">
          {t('card.suits', { riskFit: t(`riskLevels.${riskFit}`, riskFit) })}
        </span>
        {latest && (
          <span className="ms-auto text-xs text-ink-3">
            {t('card.latestTestSharpe')}{' '}
            <strong className="text-accent-link">
              {latest.test_metrics.sharpe?.toFixed(2) ?? '—'}
            </strong>
          </span>
        )}
      </div>
      {infoOpen && (
        <div className="mt-2 rounded bg-panel-2 p-2 text-xs text-ink-3">
          <p>{t(`info.strategies.${kind}.explanation`)}</p>
          <a
            href={t(`info.strategies.${kind}.link`)}
            target="_blank"
            rel="noreferrer"
            className="text-accent-link hover:underline"
          >
            {t('info.readMore')}
          </a>
        </div>
      )}
      <p className="mt-1 text-sm text-ink-3">{description}</p>
      {kind === 'evolved' && <EvolutionPanel strategyId={strategyId} runs={runs.data} />}
      {runs.data && runs.data.length === 0 && (
        <p className="mt-2 text-sm text-ink-4">{t('card.notEvaluated')}</p>
      )}
      {runs.data?.map((run) => (
        <div key={run.id} className="mt-2">
          <button
            onClick={() => setOpenRun(openRun === run.id ? null : run.id)}
            className="text-sm text-accent-link hover:underline"
          >
            {run.rank > 0
              ? t('card.runCandidate', {
                  date: run.run_date,
                  rank: run.rank,
                  value: run.test_metrics.sharpe?.toFixed(2) ?? '—',
                })
              : t('card.run', {
                  date: run.run_date,
                  value: run.test_metrics.sharpe?.toFixed(2) ?? '—',
                })}{' '}
            <span className="inline-block rtl:-scale-x-100">
              {openRun === run.id ? '▾' : '▸'}
            </span>
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
        <h1 className="text-2xl font-bold text-accent">{t('title')}</h1>
        <button
          onClick={() => evaluate.mutate()}
          disabled={evaluate.isPending}
          className="ms-auto flex items-center gap-2 rounded bg-accent-button px-4 py-1.5 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
        >
          {evaluate.isPending ? t('actions.evaluating') : t('actions.reevaluate')}
          {evaluate.isPending && <Spinner className="h-4 w-4" />}
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
            kind={s.kind}
            description={s.description}
            riskFit={s.risk_fit}
          />
        ))}
      </div>
    </div>
  )
}
