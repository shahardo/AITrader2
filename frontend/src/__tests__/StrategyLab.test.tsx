// StrategyLab.test.tsx — tests for the Strategy Lab: strategy cards with latest
// test metrics, run drill-down with train/test separation and the trade log,
// plus the genetic-algorithm "evolved" strategy's build form, live progress,
// candidate runs and signal-weights breakdown.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import StrategyLabPage from '../pages/StrategyLab'
import type { StrategyEvolutionRunOut } from '../api/client'

vi.mock('../components/LineCompareChart', () => ({
  default: () => <div data-testid="line-compare-chart" />,
}))

const STRATEGIES = [
  { id: 1, name: 'Momentum', kind: 'momentum', params: {}, risk_fit: 'aggressive',
    description: 'Buy strong performers.' },
  { id: 5, name: 'Evolved (GA)', kind: 'evolved', params: {}, risk_fit: 'balanced',
    description: 'GA-evolved composite strategy.' },
]
const RUNS = [
  {
    id: 11, strategy_id: 1, run_date: '2026-06-07',
    train_start: '2025-06-07', train_end: '2026-04-07',
    test_start: '2026-04-08', test_end: '2026-06-07',
    chosen_params: { entry: 0.1 },
    train_metrics: { sharpe: 1.5, cagr: 0.2, max_drawdown: -0.1, win_rate: 0.6, trade_count: 30 },
    test_metrics: { sharpe: 0.9, cagr: 0.12, max_drawdown: -0.08, win_rate: 0.55, trade_count: 7 },
    equity_curve: [['2026-04-08', 100000], ['2026-06-07', 104000]],
    status: 'done',
    rank: 0,
  },
]
const EVOLVED_RUNS = [1, 2, 3, 4, 5].map((rank) => ({
  id: 100 + rank,
  strategy_id: 5,
  run_date: '2026-06-07',
  train_start: '2025-06-07', train_end: '2026-04-07',
  test_start: '2026-04-08', test_end: '2026-06-07',
  chosen_params: {
    weight_mom_63: 0.3,
    weight_trend_strength: 0.45,
    entry_threshold: 0.15,
    exit_threshold: -0.1,
  },
  train_metrics: { sharpe: 1.6 - rank * 0.1, cagr: 0.22, max_drawdown: -0.12, win_rate: 0.58,
    trade_count: 28 },
  test_metrics: { sharpe: 1.0 - rank * 0.1, cagr: 0.13, max_drawdown: -0.09, win_rate: 0.55,
    trade_count: 7 },
  equity_curve: [['2026-04-08', 100000], ['2026-06-07', 105000]],
  status: 'done',
  rank,
}))
const TRADES = [
  { symbol: 'AAPL', side: 'BUY', date: '2026-04-10', price: 170.5, qty: 50,
    triggering_signals: { momentum: 0.18 }, pnl: null },
  { symbol: 'AAPL', side: 'SELL', date: '2026-05-12', price: 181.0, qty: 50,
    triggering_signals: { momentum: -0.02 }, pnl: 525.0 },
]

interface MockApiOptions {
  evolvedRuns?: unknown[]
  evolutionRuns?: StrategyEvolutionRunOut[]
  evolutionRunById?: Record<number, StrategyEvolutionRunOut>
  evolveResponse?: StrategyEvolutionRunOut
}

function mockApi(opts: MockApiOptions = {}) {
  const { evolvedRuns = [], evolutionRuns = [], evolutionRunById = {}, evolveResponse } = opts
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (url.endsWith('/strategies/evolve') && method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify(evolveResponse), { status: 202 }))
    }
    const evoMatch = url.match(/\/strategy-evolution-runs\/(\d+)$/)
    if (evoMatch) {
      const run = evolutionRunById[Number(evoMatch[1])]
      return Promise.resolve(new Response(JSON.stringify(run), { status: 200 }))
    }
    if (url.endsWith('/strategy-evolution-runs')) {
      return Promise.resolve(new Response(JSON.stringify(evolutionRuns), { status: 200 }))
    }
    if (url.includes('/trades')) {
      return Promise.resolve(new Response(JSON.stringify(TRADES), { status: 200 }))
    }
    if (url.includes('/strategies/5/runs')) {
      return Promise.resolve(new Response(JSON.stringify(evolvedRuns), { status: 200 }))
    }
    if (url.includes('/runs')) {
      return Promise.resolve(new Response(JSON.stringify(RUNS), { status: 200 }))
    }
    if (url.includes('/strategies')) {
      return Promise.resolve(new Response(JSON.stringify(STRATEGIES), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <StrategyLabPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Find the strategy card containing the given heading text. */
function getCard(name: string) {
  const heading = screen.getByRole('heading', { name })
  const card = heading.closest('.rounded.border.border-edge.bg-panel')
  if (!card) throw new Error(`card for ${name} not found`)
  return within(card as HTMLElement)
}

describe('StrategyLabPage', () => {
  it('lists strategies with their latest test sharpe', async () => {
    mockApi()
    renderPage()
    expect(await screen.findByText('Momentum')).toBeInTheDocument()
    expect(await screen.findByText(/latest test sharpe/i)).toBeInTheDocument()
    expect(screen.getByText('0.90')).toBeInTheDocument()
  })

  it('drills into a run showing train/test metrics and the trade log', async () => {
    mockApi()
    renderPage()
    await userEvent.click(await screen.findByText(/run 2026-06-07/i))

    expect(await screen.findByText(/train \(in-sample\)/i)).toBeInTheDocument()
    expect(screen.getByText(/out-of-sample — drives selection/i)).toBeInTheDocument()
    // Trade-by-trade drill-down with triggering signals.
    expect(await screen.findByText('SELL')).toBeInTheDocument()
    expect(screen.getByText(/"momentum":0.18/)).toBeInTheDocument()
    expect(screen.getByText('525')).toBeInTheDocument()
  })

  it('shows the risk fit label', async () => {
    mockApi()
    renderPage()
    expect(await screen.findByText(/suits aggressive/i)).toBeInTheDocument()
  })

  it('toggles the strategy info panel with a read-more link', async () => {
    mockApi()
    renderPage()
    await screen.findByText('Momentum')

    expect(screen.queryByText(/momentum strategies buy assets/i)).not.toBeInTheDocument()

    const momentum = getCard('Momentum')
    await userEvent.click(momentum.getByRole('button', { name: /about this strategy/i }))
    expect(await screen.findByText(/momentum strategies buy assets/i)).toBeInTheDocument()
    const link = momentum.getByRole('link', { name: /read more/i })
    expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Momentum_(finance)')
    expect(link).toHaveAttribute('target', '_blank')

    await userEvent.click(momentum.getByRole('button', { name: /about this strategy/i }))
    expect(screen.queryByText(/momentum strategies buy assets/i)).not.toBeInTheDocument()
  })

  it('shows the GA info panel with an explanation and a genetic-algorithm link', async () => {
    mockApi()
    renderPage()
    await screen.findByText('Evolved (GA)')

    const evolved = getCard('Evolved (GA)')
    await userEvent.click(evolved.getByRole('button', { name: /about this strategy/i }))
    expect(await screen.findByText(/genetic algorithm evolves a composite rule/i))
      .toBeInTheDocument()
    const link = evolved.getByRole('link', { name: /read more/i })
    expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Genetic_algorithm')
  })

  it('shows a "never run" message when the evolved strategy has no candidates yet', async () => {
    mockApi()
    renderPage()
    await screen.findByText('Evolved (GA)')

    const evolved = getCard('Evolved (GA)')
    expect(await evolved.findByText(/not evolved yet/i)).toBeInTheDocument()
  })

  it('submits the build-options form and shows live generation progress', async () => {
    const evolveResponse: StrategyEvolutionRunOut = {
      id: 99, status: 'pending', triggered_by: 'manual',
      population_size: 50, generations: 30, current_generation: 0,
      risk_weight: 2.5, max_symbols: 25, fitness_history: [],
      strategy_run_id: null, error_message: null,
      started_at: '2026-06-13T00:00:00Z', completed_at: null,
    }
    const runningResponse: StrategyEvolutionRunOut = {
      ...evolveResponse,
      status: 'running',
      current_generation: 2,
      fitness_history: [
        { generation: 0, best: 0.4, avg: 0.1 },
        { generation: 1, best: 0.6, avg: 0.3 },
      ],
    }
    const fetchMock = mockApi({
      evolveResponse,
      evolutionRunById: { 99: runningResponse },
    })
    renderPage()
    await screen.findByText('Evolved (GA)')
    const evolved = getCard('Evolved (GA)')

    const riskInput = evolved.getByLabelText(/risk weight/i)
    fireEvent.change(riskInput, { target: { value: '2.5' } })

    await userEvent.click(evolved.getByRole('button', { name: /build strategy/i }))

    expect(await evolved.findByText(/evolving \(gen 2\/30\)/i)).toBeInTheDocument()
    expect(evolved.getByRole('img', { name: /best and average fitness per generation/i }))
      .toBeInTheDocument()

    const evolveCall = fetchMock.mock.calls.find((call) =>
      (call[0] as string).endsWith('/strategies/evolve'))
    expect(evolveCall).toBeDefined()
    const body = JSON.parse((evolveCall![1] as RequestInit).body as string)
    expect(body).toEqual({ population_size: 50, generations: 30, max_symbols: 25, risk_weight: 2.5 })
  })

  it('shows GA candidate runs with rank labels, weights breakdown, and trade drill-down', async () => {
    mockApi({ evolvedRuns: EVOLVED_RUNS })
    renderPage()
    await screen.findByText('Evolved (GA)')
    const evolved = getCard('Evolved (GA)')

    expect(await evolved.findByText(/candidate #1.*0\.90/)).toBeInTheDocument()
    expect(evolved.getByText(/candidate #5.*0\.50/)).toBeInTheDocument()

    // Signal weights breakdown for the rank-1 candidate.
    expect(evolved.getByText('Signal weights (rank #1 candidate)')).toBeInTheDocument()
    expect(evolved.getByText(/mom_63: 0\.30/)).toBeInTheDocument()
    expect(evolved.getByText(/trend_strength: 0\.45/)).toBeInTheDocument()
    expect(evolved.getByText(/0\.15/)).toBeInTheDocument()
    expect(evolved.getByText(/-0\.10/)).toBeInTheDocument()

    // Drill into candidate #1 to confirm trade-by-trade table is reused.
    await userEvent.click(evolved.getByText(/candidate #1/i))
    expect(await evolved.findByText('SELL')).toBeInTheDocument()
    expect(evolved.getByText(/"momentum":0.18/)).toBeInTheDocument()
  })
})
