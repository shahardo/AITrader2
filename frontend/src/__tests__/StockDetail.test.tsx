// StockDetail.test.tsx — tests for the stock-detail page: indicator panel,
// sentiment drill-down, and graceful handling when analysis is missing.
// The chart component is mocked (lightweight-charts needs a real canvas).

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import StockDetailPage from '../pages/StockDetail'

vi.mock('../components/CandleChart', () => ({
  default: () => <div data-testid="candle-chart" />,
}))

const DETAIL = {
  id: 1, symbol: 'AAPL', name: 'Apple Inc.', exchange: 'us', sector: 'Tech',
  currency: 'USD', universe_source: 'sp500', last_close: 150.5,
  last_date: '2026-06-10', bar_count: 2,
  bars: [
    { date: '2026-06-09', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { date: '2026-06-10', open: 1.5, high: 2.5, low: 1, close: 2, volume: 12 },
  ],
}

const SNAPSHOT = {
  date: '2026-06-10',
  technical_score: 72.5,
  signals: {
    rsi: { signal: 1, strength: 0.8, value: 27.1 },
    macd: { signal: -1, strength: 0.4, value: -0.5 },
  },
  extras: { trend_channel: null, sr_levels: [] },
}

const SENTIMENT = {
  date: '2026-06-10', score: 0.42, confidence: 0.7, item_count: 5,
  items: [{
    source: 'yahoo_rss', title: 'Apple beats expectations', url: 'http://x',
    published_at: '2026-06-10T08:00:00Z', sentiment: 0.8, relevance: 1,
    summary: 'Strong quarter.',
  }],
}

function mockApi(routes: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      for (const [suffix, resp] of Object.entries(routes)) {
        if (url.endsWith(suffix))
          return Promise.resolve(new Response(JSON.stringify(resp.body), { status: resp.status }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    }),
  )
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/stocks/AAPL']}>
        <Routes>
          <Route path="/stocks/:symbol" element={<StockDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('StockDetailPage', () => {
  it('renders score, indicator signals, and sentiment items', async () => {
    mockApi({
      '/instruments/AAPL?days=365': { status: 200, body: DETAIL },
      '/instruments/AAPL/analysis': { status: 200, body: SNAPSHOT },
      '/instruments/AAPL/sentiment': { status: 200, body: SENTIMENT },
    })
    renderPage()
    expect(await screen.findByText('72.5')).toBeInTheDocument()
    expect(screen.getByText('RSI (14)')).toBeInTheDocument()
    expect(screen.getByText('BUY')).toBeInTheDocument()
    expect(screen.getByText('SELL')).toBeInTheDocument()
    expect(screen.getByText('Apple beats expectations')).toBeInTheDocument()
    expect(screen.getByTestId('candle-chart')).toBeInTheDocument()
  })

  it('shows hints when analysis and sentiment are missing', async () => {
    mockApi({
      '/instruments/AAPL?days=365': { status: 200, body: DETAIL },
      '/instruments/AAPL/analysis': { status: 404, body: { detail: 'No analysis' } },
      '/instruments/AAPL/sentiment': { status: 404, body: { detail: 'No sentiment' } },
    })
    renderPage()
    expect(await screen.findByText(/no analysis yet/i)).toBeInTheDocument()
    expect(screen.getByText(/no sentiment data yet/i)).toBeInTheDocument()
  })
})
