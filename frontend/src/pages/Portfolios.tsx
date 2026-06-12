// Portfolios.tsx — the main dashboard: paper-portfolio cards (value, P&L,
// strategy), create-portfolio form, initial-proposal onboarding flow, holdings
// view, and the normalized equity-curve comparison chart across portfolios.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  approveInitialProposal,
  comparePortfolios,
  createPortfolio,
  deletePortfolio,
  getHitRate,
  getInitialProposal,
  getPortfolio,
  listPortfolios,
  listStrategies,
  type RecommendationOut,
} from '../api/client'
import LineCompareChart from '../components/LineCompareChart'

/** Create-portfolio inline form. */
function CreateForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [capital, setCapital] = useState('100000')
  const [strategyId, setStrategyId] = useState<string>('')
  const [autoExecute, setAutoExecute] = useState(false)
  const strategies = useQuery({ queryKey: ['strategies'], queryFn: listStrategies })

  const create = useMutation({
    mutationFn: () =>
      createPortfolio({
        name,
        initial_capital: Number(capital),
        strategy_id: strategyId ? Number(strategyId) : null,
        auto_execute: autoExecute,
      }),
    onSuccess: () => {
      setName('')
      onDone()
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
      className="mb-6 flex flex-wrap items-end gap-3 rounded border border-slate-800 bg-slate-900 p-4"
    >
      <label className="text-sm">
        Name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-44 rounded border border-slate-700 bg-slate-800 px-2 py-1"
        />
      </label>
      <label className="text-sm">
        Virtual capital
        <input
          type="number"
          min="1000"
          required
          value={capital}
          onChange={(e) => setCapital(e.target.value)}
          className="mt-1 block w-32 rounded border border-slate-700 bg-slate-800 px-2 py-1"
        />
      </label>
      <label className="text-sm">
        Strategy
        <select
          value={strategyId}
          onChange={(e) => setStrategyId(e.target.value)}
          className="mt-1 block w-44 rounded border border-slate-700 bg-slate-800 px-2 py-1.5"
        >
          <option value="">— pick later —</option>
          {strategies.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={autoExecute}
          onChange={(e) => setAutoExecute(e.target.checked)}
        />
        Auto-execute trades
      </label>
      <button
        type="submit"
        disabled={create.isPending}
        className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
      >
        Create portfolio
      </button>
      {create.error && (
        <span role="alert" className="text-sm text-red-400">
          Failed to create portfolio
        </span>
      )}
    </form>
  )
}

/** Onboarding proposal section for one portfolio. */
function ProposalPanel({ portfolioId, onDone }: { portfolioId: number; onDone: () => void }) {
  const [proposal, setProposal] = useState<RecommendationOut[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchProposal = useMutation({
    mutationFn: () => getInitialProposal(portfolioId),
    onSuccess: setProposal,
    onError: () => setError('No universe scores yet — run an analysis on the Scores page first'),
  })
  const approve = useMutation({
    mutationFn: () => approveInitialProposal(portfolioId),
    onSuccess: () => {
      setProposal(null)
      onDone()
    },
  })

  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      {!proposal && (
        <button
          onClick={() => {
            setError(null)
            fetchProposal.mutate()
          }}
          disabled={fetchProposal.isPending}
          className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          {fetchProposal.isPending ? 'Building proposal…' : 'Propose initial portfolio'}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-amber-400">
          {error}
        </p>
      )}
      {proposal && (
        <div className="text-sm">
          <p className="mb-2 text-slate-300">Proposed starting positions:</p>
          <ul className="mb-3 space-y-1">
            {proposal.map((rec) => (
              <li key={rec.id}>
                <span className="font-mono text-emerald-300">{rec.symbol}</span> × {rec.qty}{' '}
                <span className="text-slate-500">
                  @ {rec.price_at_recommendation?.toFixed(2) ?? '—'} · confidence{' '}
                  {(rec.confidence * 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
          <button
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
            className="rounded bg-emerald-600 px-3 py-1 font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            Approve & open positions
          </button>
        </div>
      )}
    </div>
  )
}

/** Portfolio dashboard page at /. */
export default function PortfoliosPage() {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState<number | null>(null)
  const portfolios = useQuery({ queryKey: ['portfolios'], queryFn: listPortfolios })
  const ids = portfolios.data?.map((p) => p.id) ?? []
  const compare = useQuery({
    queryKey: ['compare', ids.join(',')],
    queryFn: () => comparePortfolios(ids),
    enabled: ids.length > 0,
  })
  const detail = useQuery({
    queryKey: ['portfolio', expanded],
    queryFn: () => getPortfolio(expanded!),
    enabled: expanded != null,
  })
  const remove = useMutation({
    mutationFn: deletePortfolio,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portfolios'] }),
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['portfolios'] })
    queryClient.invalidateQueries({ queryKey: ['compare'] })
    queryClient.invalidateQueries({ queryKey: ['portfolio'] })
  }

  const hitRate = useQuery({ queryKey: ['hit-rate'], queryFn: getHitRate })

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-baseline gap-4">
        <h1 className="text-2xl font-bold">Portfolios</h1>
        {hitRate.data && hitRate.data.evaluated > 0 && (
          <span className="ml-auto rounded bg-slate-800 px-3 py-1 text-sm text-slate-300">
            Call accuracy (30d): {(hitRate.data.hit_rate * 100).toFixed(0)}% of{' '}
            {hitRate.data.evaluated} · avg {hitRate.data.avg_return >= 0 ? '+' : ''}
            {hitRate.data.avg_return}%
          </span>
        )}
      </div>
      <CreateForm onDone={refresh} />

      {portfolios.isLoading && <p className="text-slate-400">Loading…</p>}
      {portfolios.data && portfolios.data.length === 0 && (
        <p className="text-slate-400">No portfolios yet — create your first one above.</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {portfolios.data?.map((p) => (
          <div key={p.id} className="rounded border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">{p.name}</h2>
              <button
                aria-label={`Delete ${p.name}`}
                onClick={() => remove.mutate(p.id)}
                className="text-xs text-slate-500 hover:text-red-400"
              >
                delete
              </button>
            </div>
            <p className="mt-1 text-2xl">
              {p.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              <span
                className={`ml-2 text-sm ${p.pnl_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {p.pnl_pct >= 0 ? '+' : ''}
                {p.pnl_pct}%
              </span>
            </p>
            <p className="text-xs text-slate-400">
              Strategy: {p.strategy_name ?? 'none'} · cash{' '}
              {p.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })} ·{' '}
              {p.auto_execute ? 'auto-trade' : 'manual approval'}
            </p>
            <div className="mt-2 flex gap-3 text-sm">
              <button
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                className="text-emerald-300 hover:underline"
              >
                {expanded === p.id ? 'Hide holdings' : 'Holdings'}
              </button>
              <Link to={`/recommendations?portfolio=${p.id}`} className="text-emerald-300 hover:underline">
                Recommendations
              </Link>
            </div>
            {expanded === p.id && detail.data && (
              <div className="mt-3 border-t border-slate-800 pt-3 text-sm">
                {detail.data.holdings.length === 0 && (
                  <p className="text-slate-400">No positions yet.</p>
                )}
                {detail.data.holdings.map((h) => (
                  <p key={h.symbol} className="flex justify-between">
                    <span className="font-mono text-emerald-300">{h.symbol}</span>
                    <span>
                      {h.qty} × {h.last_close?.toFixed(2) ?? '—'}
                      <span
                        className={`ml-2 ${(h.pnl_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                      >
                        {h.pnl_pct != null ? `${h.pnl_pct >= 0 ? '+' : ''}${h.pnl_pct}%` : ''}
                      </span>
                    </span>
                  </p>
                ))}
              </div>
            )}
            {expanded === p.id && <ProposalPanel portfolioId={p.id} onDone={refresh} />}
          </div>
        ))}
      </div>

      {compare.data && compare.data.length > 1 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">Performance comparison (normalized to 100)</h2>
          <LineCompareChart
            curves={compare.data.map((c) => ({ name: c.name, points: c.curve }))}
          />
        </section>
      )}
      <p className="mt-6 text-xs text-slate-600">Not financial advice — paper trading only.</p>
    </div>
  )
}
