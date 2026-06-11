// Universe.test.tsx — tests for the universe browser: renders instrument rows,
// shows the empty state, and sends the exchange filter to the API.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
    last_date: '2026-06-10',
    bar_count: 500,
  },
  {
    id: 2,
    symbol: 'TEVA.TA',
    name: 'Teva',
    exchange: 'tase',
    sector: null,
    currency: 'ILA',
    universe_source: 'ta125',
    last_close: null,
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
  it('renders instrument rows with price summaries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(ROWS), { status: 200 })),
    )
    renderUniverse()
    expect(await screen.findByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('123.45')).toBeInTheDocument()
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

  it('passes the exchange filter to the API', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    renderUniverse()
    await screen.findByText(/no instruments yet/i)

    await userEvent.selectOptions(screen.getByLabelText(/exchange filter/i), 'tase')
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => c[0] as string)
      expect(urls.some((u) => u.includes('exchange=tase'))).toBe(true)
    })
  })
})
