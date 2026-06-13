// Topics.test.tsx — tests for the topics page: hot-topic chips, free-text deep
// dive calling the API, report rendering with ranked candidates, and the
// in-flight deep-dive progress line / report reset.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TopicsPage from '../pages/Topics'

const TOPICS = [
  { id: 1, name: 'Quantum computing', buzz_score: 0.9, status: 'hot',
    summary: 'Qubits.', updated_at: '2026-06-10T00:00:00Z' },
]
const REPORTS = [
  { id: 7, topic_id: 1, topic_name: 'Quantum computing', status: 'done',
    summary: 'Hardware and software plays.', created_at: '2026-06-10T00:00:00Z',
    candidates: [
      { symbol: 'IONQ', name: 'IonQ', rationale: 'Pure play.', combined_score: 71.5,
        validated: true },
    ] },
]
const DIVE_PROGRESS = { progress: { stage: 'reading_article', symbol: 'IONQ', current: 2, total: 5 } }

function mockApi({ divePromise }: { divePromise?: Promise<void> } = {}) {
  const mock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/topics/deep-dive/progress'))
      return Promise.resolve(new Response(JSON.stringify(DIVE_PROGRESS), { status: 200 }))
    if (url.includes('/topics/deep-dive') && init?.method === 'POST') {
      const respond = () => new Response(JSON.stringify(REPORTS[0]), { status: 200 })
      return divePromise ? divePromise.then(respond) : Promise.resolve(respond())
    }
    if (url.includes('/topic-reports'))
      return Promise.resolve(new Response(JSON.stringify(REPORTS), { status: 200 }))
    if (url.includes('/topics/hot'))
      return Promise.resolve(new Response(JSON.stringify(TOPICS), { status: 200 }))
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
        <TopicsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TopicsPage', () => {
  it('renders hot topic chips and reports with candidates', async () => {
    mockApi()
    renderPage()
    expect(await screen.findByText(/quantum computing · 90/i)).toBeInTheDocument()
    expect(await screen.findByText('IONQ')).toBeInTheDocument()
    expect(screen.getByText('71.5')).toBeInTheDocument()
    expect(screen.getByText('Hardware and software plays.')).toBeInTheDocument()
  })

  it('runs a free-text deep dive through the API', async () => {
    const fetchMock = mockApi()
    renderPage()
    await screen.findByText(/quantum computing · 90/i)
    await userEvent.type(screen.getByPlaceholderText(/any theme/i), 'nuclear fusion')
    await userEvent.click(screen.getByRole('button', { name: /^deep dive$/i }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => (c[0] as string).includes('/topics/deep-dive'))
      expect(call).toBeTruthy()
      expect(JSON.parse((call![1] as RequestInit).body as string).topic).toBe('nuclear fusion')
    })
  })

  it('hides previous reports and shows live progress while diving, then restores them', async () => {
    let resolveDive: () => void = () => {}
    const divePromise = new Promise<void>((resolve) => { resolveDive = resolve })
    mockApi({ divePromise })
    renderPage()
    await screen.findByText('IONQ')

    await userEvent.type(screen.getByPlaceholderText(/any theme/i), 'nuclear fusion')
    await userEvent.click(screen.getByRole('button', { name: /^deep dive$/i }))

    await waitFor(() => expect(screen.queryByText('IONQ')).not.toBeInTheDocument())
    expect(await screen.findByText(/reading article for ionq \(2\/5\)/i)).toBeInTheDocument()

    resolveDive()
    await waitFor(() => expect(screen.getByText('IONQ')).toBeInTheDocument())
    expect(screen.queryByText(/reading article for ionq/i)).not.toBeInTheDocument()
  })
})
