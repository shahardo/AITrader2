// Settings.test.tsx — tests for the settings page: profile updates, the Telegram
// link flow (code display + check), the re-scan trigger, and the danger-zone
// data-clearing buttons.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SettingsPage from '../pages/Settings'
import { getTokens, storeTokens } from '../api/client'

const ME = {
  id: 1, email: 'a@b.com', risk_level: 'balanced', markets: 'both',
  strategy_switch_mode: 'approve', telegram_linked: false,
}

function mockApi({
  scanPromise,
  scanLatestSequence,
}: { scanPromise?: Promise<void>; scanLatestSequence?: unknown[] } = {}) {
  let scanLatestCall = 0
  const mock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/me') && init?.method === 'PATCH')
      return Promise.resolve(
        new Response(JSON.stringify({ ...ME, risk_level: 'aggressive' }), { status: 200 }),
      )
    if (url.endsWith('/me'))
      return Promise.resolve(new Response(JSON.stringify(ME), { status: 200 }))
    if (url.endsWith('/me/telegram-link'))
      return Promise.resolve(
        new Response(JSON.stringify({ code: 'ab12cd34', instructions: 'send /start ab12cd34' }),
          { status: 200 }),
      )
    if (url.endsWith('/scans/latest')) {
      if (scanLatestSequence) {
        const body = scanLatestSequence[Math.min(scanLatestCall, scanLatestSequence.length - 1)]
        scanLatestCall++
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
      }
      return Promise.resolve(new Response('null', { status: 200 }))
    }
    if (url.endsWith('/scans') && init?.method === 'POST') {
      const respond = () => new Response(JSON.stringify({ id: 1, status: 'done', stats: { inserted: 5 },
                                                          started_at: '2026-06-10T00:00:00Z', finished_at: null }),
                                          { status: 200 })
      return scanPromise ? scanPromise.then(respond) : Promise.resolve(respond())
    }
    if (url.endsWith('/admin/clear-data') || url.endsWith('/admin/clear-data-and-users'))
      return Promise.resolve(new Response(null, { status: 204 }))
    return Promise.resolve(new Response('{}', { status: 200 }))
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SettingsPage', () => {
  it('updates the risk level via PATCH /me', async () => {
    const fetchMock = mockApi()
    renderPage()
    await userEvent.selectOptions(await screen.findByLabelText(/risk level/i), 'aggressive')
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PATCH')
      expect(patch).toBeTruthy()
      expect(JSON.parse((patch![1] as RequestInit).body as string)).toEqual({
        risk_level: 'aggressive',
      })
    })
  })

  it('shows the one-time code after starting a Telegram link', async () => {
    mockApi()
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /link telegram/i }))
    expect(await screen.findByText('/start ab12cd34')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /check link/i })).toBeInTheDocument()
  })

  it('triggers a universe re-scan', async () => {
    const fetchMock = mockApi()
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /re-run universe scan/i }))
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (c) => (c[0] as string).endsWith('/scans') && (c[1] as RequestInit)?.method === 'POST',
        ),
      ).toBe(true)
    })
  })

  it('shows live scan progress while running, then clears it once done', async () => {
    let resolveScan: () => void = () => {}
    const scanPromise = new Promise<void>((resolve) => { resolveScan = resolve })
    mockApi({
      scanPromise,
      scanLatestSequence: [
        null,
        { id: 1, status: 'running', stats: {}, started_at: '2026-06-13T00:00:00Z',
          finished_at: null,
          progress: { stage: 'discovery', symbol: 'TSLA', current: 3, total: 10 } },
        { id: 1, status: 'done', stats: { inserted: 5 }, started_at: '2026-06-13T00:00:00Z',
          finished_at: '2026-06-13T00:05:00Z', progress: null },
      ],
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /re-run universe scan/i }))

    expect(await screen.findByText(/scanning for new listings: tsla \(3\/10\)/i))
      .toBeInTheDocument()

    resolveScan()
    await waitFor(() =>
      expect(screen.queryByText(/scanning for new listings/i)).not.toBeInTheDocument())
  })

  describe('danger zone', () => {
    it('clears all data after confirmation, keeping the session', async () => {
      const fetchMock = mockApi()
      storeTokens({ access_token: 'a', refresh_token: 'r', token_type: 'bearer' })
      renderPage()

      await userEvent.click(await screen.findByRole('button', { name: 'Clear all data' }))
      await userEvent.click(await screen.findByRole('button', { name: /yes, clear all data/i }))

      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(
            (c) =>
              (c[0] as string).endsWith('/admin/clear-data') &&
              (c[1] as RequestInit)?.method === 'POST',
          ),
        ).toBe(true)
      })
      expect(await screen.findByText('All data cleared.')).toBeInTheDocument()
      expect(getTokens()).not.toBeNull()
    })

    it('cancels the clear-all-data confirmation without calling the API', async () => {
      const fetchMock = mockApi()
      renderPage()

      await userEvent.click(await screen.findByRole('button', { name: 'Clear all data' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

      expect(screen.getByRole('button', { name: 'Clear all data' })).toBeInTheDocument()
      expect(
        fetchMock.mock.calls.some((c) => (c[0] as string).endsWith('/admin/clear-data')),
      ).toBe(false)
    })

    it('clears all data and users, signs out, and redirects to /login', async () => {
      const fetchMock = mockApi()
      storeTokens({ access_token: 'a', refresh_token: 'r', token_type: 'bearer' })
      renderPage()

      await userEvent.click(
        await screen.findByRole('button', { name: 'Clear all data and users' }),
      )
      await userEvent.click(await screen.findByRole('button', { name: /yes, delete everything/i }))

      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(
            (c) =>
              (c[0] as string).endsWith('/admin/clear-data-and-users') &&
              (c[1] as RequestInit)?.method === 'POST',
          ),
        ).toBe(true)
      })
      expect(await screen.findByText('Login page')).toBeInTheDocument()
      expect(getTokens()).toBeNull()
    })
  })
})
