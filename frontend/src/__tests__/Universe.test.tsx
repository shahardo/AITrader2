// Universe.test.tsx — tests for the universe browser: renders instrument rows
// with price-change indicators, shows the empty state, and supports
// multi-select filtering by exchange and sector.

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import UniversePage from '../pages/Universe'
import type { InstrumentOut } from '../api/client'

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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(ROWS), { status: 200 })),
    )
    renderUniverse()
    expect(await screen.findByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('123.45')).toBeInTheDocument()
    expect(screen.getByText('(+2.88% ▲)')).toBeInTheDocument()
    expect(screen.getByText('(-4.76% ▼)')).toBeInTheDocument()
    expect(screen.getByText('TEVA.TA')).toBeInTheDocument()
  })

  it('shows the empty-state hint when the universe is unloaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })),
    )
    renderUniverse()
    expect(await screen.findByText(/no instruments yet/i)).toBeInTheDocument()
  })

  it('filters by exchange using the multi-select column filter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(ROWS), { status: 200 })),
    )
    renderUniverse()
    await screen.findByText('AAPL')

    await userEvent.click(screen.getByRole('button', { name: /exchange/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'TASE' }))

    expect(screen.queryByText('AAPL')).not.toBeInTheDocument()
    expect(screen.queryByText('MSFT')).not.toBeInTheDocument()
    expect(screen.getByText('TEVA.TA')).toBeInTheDocument()
  })

  it('filters by sector using the multi-select column filter, with multiple sectors selectable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(ROWS), { status: 200 })),
    )
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(ROWS), { status: 200 })),
    )
    renderUniverse()
    await screen.findByText('AAPL')

    await userEvent.click(screen.getByRole('button', { name: /exchange/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'US' }))
    await userEvent.click(screen.getByRole('button', { name: /sector/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'No sector' }))

    expect(await screen.findByText(/no instruments match/i)).toBeInTheDocument()
  })
})
