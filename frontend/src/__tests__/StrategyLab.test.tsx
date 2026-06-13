// StrategyLab.test.tsx — tests for the Strategy Lab: strategy cards with latest
// test metrics, run drill-down with train/test separation and the trade log.

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import StrategyLabPage from '../pages/StrategyLab'

vi.mock('../components/LineCompareChart', () => ({
  default: () => <div data-testid="line-compare-chart" />,
}))

const STRATEGIES = [
  { id: 1, name: 'Momentum', kind: 'momentum', params: {}, risk_fit: 'aggressive',
    description: 'Buy strong performers.' },
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
  },
]
const TRADES = [
  { symbol: 'AAPL', side: 'BUY', date: '2026-04-10', price: 170.5, qty: 50,
    triggering_signals: { momentum: 0.18 }, pnl: null },
  { symbol: 'AAPL', side: 'SELL', date: '2026-05-12', price: 181.0, qty: 50,
    triggering_signals: { momentum: -0.02 }, pnl: 525.0 },
]

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const body = url.includes('/trades') ? TRADES
        : url.includes('/runs') ? RUNS
        : url.includes('/strategies') ? STRATEGIES
        : []
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    }),
  )
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

    await userEvent.click(screen.getByRole('button', { name: /about this strategy/i }))
    expect(await screen.findByText(/momentum strategies buy assets/i)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /read more/i })
    expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Momentum_(finance)')
    expect(link).toHaveAttribute('target', '_blank')

    await userEvent.click(screen.getByRole('button', { name: /about this strategy/i }))
    expect(screen.queryByText(/momentum strategies buy assets/i)).not.toBeInTheDocument()
  })
})
