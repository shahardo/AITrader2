// Recommendations.test.tsx — tests for the recommendation feed: pending cards
// with approve/reject calling the API, and history separation.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RecommendationsPage from '../pages/Recommendations'

const PORTFOLIOS = [
  { id: 1, name: 'Growth', strategy_id: 1, strategy_name: 'Momentum',
    initial_capital: 100000, cash: 50000, auto_execute: false,
    value: 100000, pnl_pct: 0, created_at: '2026-06-01T00:00:00Z' },
]
const RECS = [
  { id: 5, portfolio_id: 1, symbol: 'AAPL', instrument_name: 'Apple', action: 'BUY',
    qty: 10, confidence: 0.8, signals: {}, explanation: 'Strong momentum and score.',
    kind: 'daily', status: 'pending', price_at_recommendation: 150,
    created_at: '2026-06-10T00:00:00Z' },
  { id: 4, portfolio_id: 1, symbol: 'TSLA', instrument_name: 'Tesla', action: 'SELL',
    qty: 5, confidence: 0.7, signals: {}, explanation: 'Trend broke.',
    kind: 'daily', status: 'executed', price_at_recommendation: 200,
    created_at: '2026-06-09T00:00:00Z' },
]

function mockApi({ generateStatus = 200, generateBody = '[]' } = {}) {
  const mock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/approve'))
      return Promise.resolve(
        new Response(JSON.stringify({ ...RECS[0], status: 'executed' }), { status: 200 }),
      )
    if (url.includes('/recommendations/generate'))
      return Promise.resolve(new Response(generateBody, { status: generateStatus }))
    if (url.includes('/recommendations?portfolio_id='))
      return Promise.resolve(new Response(JSON.stringify(RECS), { status: 200 }))
    if (url.endsWith('/portfolios') && !init?.method)
      return Promise.resolve(new Response(JSON.stringify(PORTFOLIOS), { status: 200 }))
    return Promise.resolve(new Response('[]', { status: 200 }))
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/recommendations?portfolio=1']}>
        <RecommendationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RecommendationsPage', () => {
  it('splits pending and history and shows explanations', async () => {
    mockApi()
    renderPage()
    expect(await screen.findByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText(/pending \(1\)/i)).toBeInTheDocument()
    expect(screen.getByText('Strong momentum and score.')).toBeInTheDocument()
    expect(screen.getByText('TSLA')).toBeInTheDocument() // history row
    expect(screen.getByText('executed')).toBeInTheDocument()
  })

  it('approves a pending recommendation via the API', async () => {
    const fetchMock = mockApi()
    renderPage()
    await screen.findByText('AAPL')
    await userEvent.click(screen.getByRole('button', { name: /approve & execute/i }))
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => (c[0] as string).endsWith('/recommendations/5/approve')),
      ).toBe(true)
    })
  })

  it('shows a message when generate now finds nothing new', async () => {
    mockApi({ generateBody: '[]' })
    renderPage()
    await screen.findByText('AAPL')
    await userEvent.click(screen.getByRole('button', { name: /generate now/i }))
    expect(await screen.findByText(/no new recommendations/i)).toBeInTheDocument()
  })

  it('shows the backend error when generate now fails', async () => {
    mockApi({
      generateStatus: 409,
      generateBody: JSON.stringify({
        detail: 'Portfolio has no strategy assigned — assign one in the Strategy Lab',
      }),
    })
    renderPage()
    await screen.findByText('AAPL')
    await userEvent.click(screen.getByRole('button', { name: /generate now/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no strategy assigned/i)
  })
})
