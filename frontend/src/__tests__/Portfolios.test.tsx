// Portfolios.test.tsx — tests for the portfolio dashboard: cards with valuations,
// creating a portfolio, and the empty state. Charts are mocked.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PortfoliosPage from '../pages/Portfolios'

vi.mock('../components/LineCompareChart', () => ({
  default: () => <div data-testid="line-compare-chart" />,
}))

const PORTFOLIOS = [
  {
    id: 1, name: 'Growth', strategy_id: 1, strategy_name: 'Momentum',
    initial_capital: 100000, cash: 20000, auto_execute: true,
    value: 112000, pnl_pct: 12, created_at: '2026-06-01T00:00:00Z',
  },
  {
    id: 2, name: 'Safe', strategy_id: 2, strategy_name: 'Balanced blend',
    initial_capital: 50000, cash: 50000, auto_execute: false,
    value: 49000, pnl_pct: -2, created_at: '2026-06-01T00:00:00Z',
  },
]

function mockApi(overrides: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    // Order matters: more specific suffixes first ("includes" matching).
    'portfolios-compare': [
      { portfolio_id: 1, name: 'Growth', curve: [{ date: '2026-06-01', value: 100000 }] },
      { portfolio_id: 2, name: 'Safe', curve: [{ date: '2026-06-01', value: 50000 }] },
    ],
    '/strategies': [],
    '/portfolios': PORTFOLIOS,
    ...overrides,
  }
  const mock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/portfolios') && init?.method === 'POST')
      return Promise.resolve(
        new Response(JSON.stringify({ ...PORTFOLIOS[0], id: 9 }), { status: 201 }),
      )
    for (const [suffix, body] of Object.entries(routes)) {
      if (url.includes(suffix)) {
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
      }
    }
    return Promise.resolve(new Response('[]', { status: 200 }))
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PortfoliosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PortfoliosPage', () => {
  it('renders portfolio cards with valuations and P&L', async () => {
    mockApi()
    renderPage()
    expect(await screen.findByText('Growth')).toBeInTheDocument()
    expect(screen.getByText('+12%')).toBeInTheDocument()
    expect(screen.getByText('-2%')).toBeInTheDocument()
    expect(screen.getByText(/Strategy: Momentum/)).toBeInTheDocument()
    expect(await screen.findByTestId('line-compare-chart')).toBeInTheDocument() // comparison
  })

  it('shows the empty state without portfolios', async () => {
    mockApi({ '/portfolios': [] })
    renderPage()
    expect(await screen.findByText(/no portfolios yet/i)).toBeInTheDocument()
  })

  it('creates a portfolio via the form', async () => {
    const fetchMock = mockApi({ '/portfolios': [] })
    renderPage()
    await screen.findByText(/no portfolios yet/i)
    await userEvent.type(screen.getByLabelText(/name/i), 'My fund')
    await userEvent.click(screen.getByRole('button', { name: /create portfolio/i }))
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => (c[0] as string).endsWith('/portfolios') && (c[1] as RequestInit)?.method === 'POST',
      )
      expect(post).toBeTruthy()
      const body = JSON.parse((post![1] as RequestInit).body as string)
      expect(body.name).toBe('My fund')
      expect(body.initial_capital).toBe(100000)
    })
  })
})
