// Onboarding.test.tsx — tests for the first-login setup wizard: step progression,
// skipping already-completed steps, the initial proposal flow, and skip-out.

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import OnboardingPage from '../pages/Onboarding'
import { isOnboardingDismissed } from '../api/client'

const FRESH_STATUS = {
  universe_loaded: false, instrument_count: 0, prices_loaded: false,
  scores_ready: false, has_portfolio: false, has_recommendations: false, complete: false,
}

const ME = {
  id: 1, email: 'a@b.com', risk_level: 'balanced', markets: 'both',
  strategy_switch_mode: 'approve', telegram_linked: false,
}

const PROPOSAL = [
  {
    id: 1, portfolio_id: 9, symbol: 'AAPL', instrument_name: 'Apple', action: 'BUY',
    qty: 10, confidence: 0.8, signals: {}, explanation: 'Strong momentum',
    kind: 'initial', status: 'pending', price_at_recommendation: 100,
    created_at: '2026-06-12T00:00:00Z',
  },
]

function mockApi(overrides: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    // Order matters: more specific suffixes first ("includes" matching).
    'onboarding/status': FRESH_STATUS,
    'initial-proposal/approve': PROPOSAL,
    'initial-proposal': PROPOSAL,
    'analysis/run': { analyzed: 50, scores: {} },
    '/scans': { id: 1, status: 'done', stats: {}, started_at: '', finished_at: '' },
    '/portfolios': [],
    '/me': ME,
    ...overrides,
  }
  const mock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/portfolios') && init?.method === 'POST')
      return Promise.resolve(
        new Response(JSON.stringify({ id: 9, name: 'My first portfolio', value: 100000 }), {
          status: 201,
        }),
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
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/universe" element={<div>UNIVERSE PAGE</div>} />
          <Route path="/" element={<div>DASHBOARD</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('OnboardingPage', () => {
  it('walks a fresh install from profile through universe load and analysis', async () => {
    const fetchMock = mockApi()
    renderPage()
    expect(await screen.findByRole('heading', { name: /your profile/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /save & continue/i }))
    expect(
      await screen.findByRole('button', { name: /load universe now/i }),
    ).toBeInTheDocument()
    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PATCH')
    expect(patch?.[0]).toBe('/api/v1/me')

    await userEvent.click(screen.getByRole('button', { name: /load universe now/i }))
    expect(
      await screen.findByRole('button', { name: /run first analysis/i }),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /run first analysis/i }))
    expect(
      await screen.findByRole('heading', { name: /create a portfolio/i }),
    ).toBeInTheDocument()
  })

  it('jumps past completed steps and creates the first portfolio', async () => {
    const fetchMock = mockApi({
      'onboarding/status': {
        ...FRESH_STATUS, universe_loaded: true, instrument_count: 600,
        prices_loaded: true, scores_ready: true,
      },
    })
    renderPage()
    expect(
      await screen.findByRole('heading', { name: /create a portfolio/i }),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /create portfolio/i }))
    expect(
      await screen.findByRole('heading', { name: /first recommendations/i }),
    ).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(
      (c) => (c[0] as string).endsWith('/portfolios') && (c[1] as RequestInit)?.method === 'POST',
    )
    expect(JSON.parse((post![1] as RequestInit).body as string).initial_capital).toBe(100000)
  })

  it('generates and approves the initial proposal', async () => {
    mockApi({
      'onboarding/status': {
        ...FRESH_STATUS, universe_loaded: true, instrument_count: 600,
        prices_loaded: true, scores_ready: true,
      },
    })
    renderPage()
    await screen.findByRole('heading', { name: /create a portfolio/i })
    await userEvent.click(screen.getByRole('button', { name: /create portfolio/i }))

    await userEvent.click(
      await screen.findByRole('button', { name: /generate recommendations/i }),
    )
    expect(await screen.findByText(/BUY 10 AAPL/)).toBeInTheDocument()
    expect(screen.getByText(/Strong momentum/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /approve all & execute/i }))
    expect(await screen.findByRole('heading', { name: /all set/i })).toBeInTheDocument()
  })

  it('skip dismisses the wizard for the account and leaves to the universe', async () => {
    mockApi()
    renderPage()
    await screen.findByRole('heading', { name: /your profile/i })
    // Wait for the profile to load so the dismissal can be keyed by email.
    await screen.findByText(/signed in as a@b.com/i)
    await userEvent.click(screen.getByRole('button', { name: /skip setup/i }))
    expect(await screen.findByText('UNIVERSE PAGE')).toBeInTheDocument()
    expect(isOnboardingDismissed('a@b.com')).toBe(true)
  })
})
