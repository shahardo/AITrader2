// Universe.test.tsx — tests for the universe browser: renders instrument rows
// with price-change indicators, shows the empty state, supports multi-select
// filtering by exchange, sector and recommendation, and sorting by column.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import UniversePage from '../pages/Universe'
import type { InstrumentOut, ScoreRow } from '../api/client'

const ROWS: InstrumentOut[] = [
  {
    id: 1,
    symbol: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'us',
    sector: 'Tech',
    currency: 'USD',
    universe_source: 'sp500',
    last_close: 123.45,
    prev_close: 120,
    last_date: '2026-06-10',
    bar_count: 500,
  },
  {
    id: 2,
    symbol: 'MSFT',
    name: 'Microsoft',
    exchange: 'us',
    sector: 'Tech',
    currency: 'USD',
    universe_source: 'sp500',
    last_close: 100,
    prev_close: 105,
    last_date: '2026-06-10',
    bar_count: 500,
  },
  {
    id: 3,
    symbol: 'TEVA.TA',
    name: 'Teva',
    exchange: 'tase',
    sector: null,
    currency: 'ILA',
    universe_source: 'ta125',
    last_close: null,
    prev_close: null,
    last_date: null,
    bar_count: 0,
  },
]

const SCORES: ScoreRow[] = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'us',
    date: '2026-06-10',
    technical_score: 70,
    sentiment_score: 0.4,
    combined_score: 72.5,
    rank: 1,
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft',
    exchange: 'us',
    date: '2026-06-10',
    technical_score: 30,
    sentiment_score: -0.2,
    combined_score: 28.3,
    rank: 2,
  },
]

/** Stub `fetch` to serve `/instruments` and `/scores/latest` from separate fixtures. */
function stubFetch(instruments: InstrumentOut[], scores: ScoreRow[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = url.includes('/scores/latest') ? scores : instruments
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    }),
  )
}

function renderUniverse() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UniversePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('UniversePage', () => {
  it('renders instrument rows with price summaries and change indicators', async () => {
    stubFetch(ROWS)
    renderUniverse()
    expect(await screen.findByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('123.45')).toBeInTheDocument()
    expect(screen.getByText('(+2.88% ▲)')).toBeInTheDocument()
    expect(screen.getByText('(-4.76% ▼)')).toBeInTheDocument()
    expect(screen.getByText('TEVA.TA')).toBeInTheDocument()
  })

  it('shows the empty-state hint when the universe is unloaded', async () => {
    stubFetch([])
    renderUniverse()
    expect(await screen.findByText(/no instruments yet/i)).toBeInTheDocument()
  })

  it('filters by exchange using the multi-select column filter', async () => {
    stubFetch(ROWS)
    renderUniverse()
    await screen.findByText('AAPL')

    await userEvent.click(screen.getByRole('button', { name: /exchange/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'TASE' }))

    expect(screen.queryByText('AAPL')).not.toBeInTheDocument()
    expect(screen.queryByText('MSFT')).not.toBeInTheDocument()
    expect(screen.getByText('TEVA.TA')).toBeInTheDocument()
  })

  it('filters by sector using the multi-select column filter, with multiple sectors selectable', async () => {
    stubFetch(ROWS)
    renderUniverse()
    await screen.findByText('AAPL')

    await userEvent.click(screen.getByRole('button', { name: /sector/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tech' }))

    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('MSFT')).toBeInTheDocument()
    expect(screen.queryByText('TEVA.TA')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'No sector' }))
    expect(screen.getByText('TEVA.TA')).toBeInTheDocument()
  })

  it('shows a no-matches message when filters exclude every row', async () => {
    stubFetch(ROWS)
    renderUniverse()
    await screen.findByText('AAPL')

    await userEvent.click(screen.getByRole('button', { name: /exchange/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'US' }))
    await userEvent.click(screen.getByRole('button', { name: /sector/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'No sector' }))

    expect(await screen.findByText(/no instruments match/i)).toBeInTheDocument()
  })

  it('shows a recommendation badge with its weighted score for analyzed stocks, and a dash otherwise', async () => {
    stubFetch(ROWS, SCORES)
    renderUniverse()
    await screen.findByText('AAPL')

    expect(await screen.findByText('72.5')).toBeInTheDocument()
    expect(screen.getByText('BUY')).toBeInTheDocument()
    expect(screen.getByText('28.3')).toBeInTheDocument()
    expect(screen.getByText('SELL')).toBeInTheDocument()

    const tevaRow = screen.getByText('TEVA.TA').closest('tr')
    expect(tevaRow).not.toBeNull()
    expect(tevaRow!.lastElementChild?.textContent).toBe('—')
  })

  it('filters by recommendation using the multi-select column filter', async () => {
    stubFetch(ROWS, SCORES)
    renderUniverse()
    await screen.findByText('BUY')

    await userEvent.click(screen.getByRole('button', { name: /recommendation/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'BUY' }))

    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.queryByText('MSFT')).not.toBeInTheDocument()
    expect(screen.queryByText('TEVA.TA')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'No data' }))
    expect(screen.getByText('TEVA.TA')).toBeInTheDocument()
    expect(screen.queryByText('MSFT')).not.toBeInTheDocument()
  })

  it('sorts by symbol ascending then descending when the header is clicked', async () => {
    stubFetch(ROWS)
    renderUniverse()
    await screen.findByText('AAPL')

    await userEvent.click(screen.getByRole('columnheader', { name: /symbol/i }))
    expect(screen.getAllByRole('link').map((el) => el.textContent)).toEqual([
      'AAPL', 'MSFT', 'TEVA.TA',
    ])

    await userEvent.click(screen.getByRole('columnheader', { name: /symbol/i }))
    expect(screen.getAllByRole('link').map((el) => el.textContent)).toEqual([
      'TEVA.TA', 'MSFT', 'AAPL',
    ])
  })

  it('sorts by last close, with unscored instruments first ascending', async () => {
    stubFetch(ROWS)
    renderUniverse()
    await screen.findByText('AAPL')

    await userEvent.click(screen.getByRole('columnheader', { name: /last close/i }))
    expect(screen.getAllByRole('link').map((el) => el.textContent)).toEqual([
      'TEVA.TA', 'MSFT', 'AAPL',
    ])

    await userEvent.click(screen.getByRole('columnheader', { name: /last close/i }))
    expect(screen.getAllByRole('link').map((el) => el.textContent)).toEqual([
      'AAPL', 'MSFT', 'TEVA.TA',
    ])
  })

  it('sorts by recommendation score', async () => {
    stubFetch(ROWS, SCORES)
    renderUniverse()
    await screen.findByText('BUY')

    await userEvent.click(screen.getByRole('columnheader', { name: /recommendation/i }))
    await waitFor(() => {
      expect(screen.getAllByRole('link').map((el) => el.textContent)).toEqual([
        'TEVA.TA', 'MSFT', 'AAPL',
      ])
    })

    await userEvent.click(screen.getByRole('columnheader', { name: /recommendation/i }))
    await waitFor(() => {
      expect(screen.getAllByRole('link').map((el) => el.textContent)).toEqual([
        'AAPL', 'MSFT', 'TEVA.TA',
      ])
    })
  })
})
