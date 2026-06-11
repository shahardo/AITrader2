// Scores.test.tsx — tests for the leaderboard page: ranked rows, empty state,
// and the manual analysis trigger calling the API.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScoresPage from '../pages/Scores'

const ROWS = [
  {
    symbol: 'AAPL', name: 'Apple', exchange: 'us', date: '2026-06-10',
    technical_score: 71.2, sentiment_score: 0.4, combined_score: 75.3, rank: 1,
  },
  {
    symbol: 'TEVA.TA', name: 'Teva', exchange: 'tase', date: '2026-06-10',
    technical_score: 48.0, sentiment_score: null, combined_score: 48.0, rank: 2,
  },
]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ScoresPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ScoresPage', () => {
  it('renders the ranked leaderboard', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(ROWS), { status: 200 })),
    )
    renderPage()
    expect(await screen.findByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('75.3')).toBeInTheDocument()
    expect(screen.getByText('n/a')).toBeInTheDocument() // technical-only row
  })

  it('shows the empty state before any analysis', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('[]', { status: 200 })),
    )
    renderPage()
    expect(await screen.findByText(/no scores yet/i)).toBeInTheDocument()
  })

  it('triggers an analysis run for the entered symbols', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/analysis/run'))
        return Promise.resolve(
          new Response(JSON.stringify({ analyzed: 1, scores: { AAPL: 70 } }), { status: 200 }),
        )
      return Promise.resolve(new Response('[]', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText(/no scores yet/i)

    await userEvent.type(screen.getByPlaceholderText(/symbols/i), 'AAPL')
    await userEvent.click(screen.getByRole('button', { name: /run analysis/i }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => (c[0] as string).endsWith('/analysis/run'))
      expect(call).toBeTruthy()
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
        symbols: ['AAPL'],
        with_sentiment: true,
      })
    })
  })
})
