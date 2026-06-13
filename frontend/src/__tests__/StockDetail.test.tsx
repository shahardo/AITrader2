// StockDetail.test.tsx — tests for the stock-detail page: recommendation
// summary, indicator panel (with info explanations), sentiment drill-down, and
// graceful handling when analysis is missing. The chart component is mocked
// (lightweight-charts needs a real canvas).

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
  combined_score: 68.3,
  sentiment_score: 0.42,
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
    // BUY appears twice: the recommendation badge and the RSI signal badge.
    expect(screen.getAllByText('BUY')).toHaveLength(2)
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
    expect(await screen.findByText(/run analysis to get a recommendation/i)).toBeInTheDocument()
    expect(screen.getByText(/no analysis yet/i)).toBeInTheDocument()
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

  it('runs analysis for this symbol from the header button and shows a spinner while pending', async () => {
    let resolveRun: (value: Response) => void = () => {}
    const runPromise = new Promise<Response>((resolve) => {
      resolveRun = resolve
    })
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/analysis/run')) return runPromise
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

    expect(await screen.findByText(/analyzing/i)).toBeInTheDocument()
    expect(document.querySelector('svg.animate-spin')).toBeInTheDocument()

    resolveRun(new Response(JSON.stringify({ analyzed: 1, scores: { AAPL: 75 } }), { status: 200 }))

    await waitFor(() => {
      const runCall = fetchMock.mock.calls.find((c) => (c[0] as string).endsWith('/analysis/run'))
      expect(runCall).toBeTruthy()
      const body = JSON.parse((runCall![1] as RequestInit).body as string)
      expect(body.symbols).toEqual(['AAPL'])
      expect(body.with_sentiment).toBe(true)
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /run analysis/i })).toBeInTheDocument()
    })
  })

  it('shows a BUY recommendation driven by indicators and positive sentiment', async () => {
    mockApi({
      '/instruments/AAPL?days=365': { status: 200, body: DETAIL },
      '/instruments/AAPL/analysis': { status: 200, body: SNAPSHOT },
      '/instruments/AAPL/sentiment': { status: 200, body: SENTIMENT },
    })
    renderPage()
    await screen.findByText('72.5')

    expect(screen.getByText('68.3')).toBeInTheDocument()
    expect(screen.getByText(/driven mainly by RSI \(14\)/)).toBeInTheDocument()
    expect(screen.getByText(/recent news sentiment is also positive/i)).toBeInTheDocument()
  })

  it('shows a SELL recommendation driven by indicators and negative sentiment', async () => {
    const sellSnapshot = {
      date: '2026-06-10',
      technical_score: 30,
      combined_score: 28,
      sentiment_score: -0.3,
      signals: {
        macd: { signal: -1, strength: 0.6, value: -1.2 },
        rsi: { signal: 0, strength: 0, value: 50 },
      },
      extras: { trend_channel: null, sr_levels: [] },
    }
    mockApi({
      '/instruments/AAPL?days=365': { status: 200, body: DETAIL },
      '/instruments/AAPL/analysis': { status: 200, body: sellSnapshot },
      '/instruments/AAPL/sentiment': { status: 404, body: { detail: 'No sentiment' } },
    })
    renderPage()
    await screen.findByText('30')

    expect(screen.getByText(/driven mainly by MACD/)).toBeInTheDocument()
    expect(screen.getByText(/recent news sentiment is also negative/i)).toBeInTheDocument()
  })

  it('shows a HOLD recommendation with no strong signals and unavailable sentiment', async () => {
    const holdSnapshot = {
      date: '2026-06-10',
      technical_score: 50,
      combined_score: 50,
      sentiment_score: null,
      signals: {
        rsi: { signal: 0, strength: 0, value: 50 },
      },
      extras: { trend_channel: null, sr_levels: [] },
    }
    mockApi({
      '/instruments/AAPL?days=365': { status: 200, body: DETAIL },
      '/instruments/AAPL/analysis': { status: 200, body: holdSnapshot },
      '/instruments/AAPL/sentiment': { status: 404, body: { detail: 'No sentiment' } },
    })
    renderPage()
    await screen.findByText('50')

    expect(screen.getByText(/no strong signals in either direction/i)).toBeInTheDocument()
    expect(screen.getByText(/based on technicals only/i)).toBeInTheDocument()
  })

  it('toggles the indicator explanation when the info icon is clicked', async () => {
    mockApi({
      '/instruments/AAPL?days=365': { status: 200, body: DETAIL },
      '/instruments/AAPL/analysis': { status: 200, body: SNAPSHOT },
      '/instruments/AAPL/sentiment': { status: 200, body: SENTIMENT },
    })
    renderPage()
    await screen.findByText('RSI (14)')

    expect(screen.queryByText(/Relative Strength Index/)).not.toBeInTheDocument()

    const infoButtons = screen.getAllByRole('button', { name: /about this indicator/i })
    await userEvent.click(infoButtons[0])
    expect(screen.getByText(/Relative Strength Index/)).toBeInTheDocument()

    await userEvent.click(infoButtons[0])
    expect(screen.queryByText(/Relative Strength Index/)).not.toBeInTheDocument()
  })
})
