// StockDetail.test.tsx — tests for the stock-detail page: indicator panel,
// sentiment drill-down, and graceful handling when analysis is missing.
// The chart component is mocked (lightweight-charts needs a real canvas).

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  website: 'https://www.apple.com',
  description:
    'Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide.',
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
    expect(screen.getByRole('link', { name: 'www.apple.com' })).toHaveAttribute(
      'href',
      'https://www.apple.com',
    )
    expect(screen.getByText(/Apple Inc\. designs, manufactures/)).toBeInTheDocument()
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

  it('omits the company info section when website and description are missing', async () => {
    mockApi({
      '/instruments/AAPL?days=365': {
        status: 200,
        body: { ...DETAIL, website: null, description: null },
      },
      '/instruments/AAPL/analysis': { status: 200, body: SNAPSHOT },
      '/instruments/AAPL/sentiment': { status: 200, body: SENTIMENT },
    })
    renderPage()
    await screen.findByText('72.5')
    expect(screen.queryByRole('link', { name: /apple\.com/i })).not.toBeInTheDocument()
    expect(screen.queryByAltText(/logo/i)).not.toBeInTheDocument()
  })

  it('renders the company description with forced left-to-right direction', async () => {
    mockApi({
      '/instruments/AAPL?days=365': { status: 200, body: DETAIL },
      '/instruments/AAPL/analysis': { status: 200, body: SNAPSHOT },
      '/instruments/AAPL/sentiment': { status: 200, body: SENTIMENT },
    })
    renderPage()
    const desc = await screen.findByText(/Apple Inc\. designs, manufactures/)
    expect(desc.closest('p')).toHaveAttribute('dir', 'ltr')
  })

  it('falls back from the logo image to a favicon and then initials', async () => {
    mockApi({
      '/instruments/AAPL?days=365': { status: 200, body: DETAIL },
      '/instruments/AAPL/analysis': { status: 200, body: SNAPSHOT },
      '/instruments/AAPL/sentiment': { status: 200, body: SENTIMENT },
    })
    renderPage()
    await screen.findByText('72.5')

    const img = screen.getByAltText('Apple Inc. logo') as HTMLImageElement
    expect(img.src).toContain('logo.clearbit.com/apple.com')

    fireEvent.error(img)
    const fallback = screen.getByAltText('Apple Inc. logo') as HTMLImageElement
    expect(fallback.src).toContain('google.com/s2/favicons')

    fireEvent.error(fallback)
    expect(screen.queryByAltText('Apple Inc. logo')).not.toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('runs analysis for this symbol from the header button', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/analysis/run')) {
        return Promise.resolve(
          new Response(JSON.stringify({ analyzed: 1, scores: { AAPL: 75 } }), { status: 200 }),
        )
      }
      const routes: Record<string, { status: number; body: unknown }> = {
        '/instruments/AAPL?days=365': { status: 200, body: DETAIL },
        '/instruments/AAPL/analysis': { status: 200, body: SNAPSHOT },
        '/instruments/AAPL/sentiment': { status: 200, body: SENTIMENT },
      }
      for (const [suffix, resp] of Object.entries(routes)) {
        if (url.endsWith(suffix))
          return Promise.resolve(new Response(JSON.stringify(resp.body), { status: resp.status }))
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText('72.5')

    await userEvent.click(screen.getByRole('button', { name: /run analysis/i }))

    await waitFor(() => {
      const runCall = fetchMock.mock.calls.find((c) => (c[0] as string).endsWith('/analysis/run'))
      expect(runCall).toBeTruthy()
      const body = JSON.parse((runCall![1] as RequestInit).body as string)
      expect(body.symbols).toEqual(['AAPL'])
      expect(body.with_sentiment).toBe(true)
    })
  })
})
