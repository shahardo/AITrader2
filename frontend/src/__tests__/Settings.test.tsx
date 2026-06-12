// Settings.test.tsx — tests for the settings page: profile updates, the Telegram
// link flow (code display + check), and the re-scan trigger.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SettingsPage from '../pages/Settings'

const ME = {
  id: 1, email: 'a@b.com', risk_level: 'balanced', markets: 'both',
  strategy_switch_mode: 'approve', telegram_linked: false,
}

function mockApi() {
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
    if (url.endsWith('/scans/latest'))
      return Promise.resolve(new Response('null', { status: 200 }))
    if (url.endsWith('/scans'))
      return Promise.resolve(
        new Response(JSON.stringify({ id: 1, status: 'done', stats: { inserted: 5 },
                                      started_at: '2026-06-10T00:00:00Z', finished_at: null }),
          { status: 200 }),
      )
    return Promise.resolve(new Response('{}', { status: 200 }))
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SettingsPage />
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
})
