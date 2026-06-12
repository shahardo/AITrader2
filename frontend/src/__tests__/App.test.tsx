// App.test.tsx — tests for the app shell's sidebar: links are stacked vertically
// on the left and the link for the current route is highlighted.

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../App'
import { storeTokens } from '../api/client'

vi.mock('../components/LineCompareChart', () => ({
  default: () => <div data-testid="line-compare-chart" />,
}))

function renderApp(path: string) {
  storeTokens({ access_token: 'a', refresh_token: 'r', token_type: 'bearer' })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })))
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('App sidebar', () => {
  it('renders the nav links stacked vertically in a left sidebar', () => {
    renderApp('/recommendations')
    const sidebar = screen.getByText('AITrader2').closest('aside')
    expect(sidebar?.className).toContain('flex-col')
    const links = sidebar!.querySelectorAll('a')
    expect(links.length).toBeGreaterThanOrEqual(7)
  })

  it('highlights only the link for the active route', () => {
    renderApp('/recommendations')
    const active = screen.getByRole('link', { name: 'Recommendations' })
    const inactive = screen.getByRole('link', { name: 'Portfolios' })
    expect(active.className).toContain('text-emerald-400')
    expect(inactive.className).not.toContain('text-emerald-400')
  })

  it('marks Portfolios active only at the root path, not on other routes', () => {
    renderApp('/universe')
    const portfolios = screen.getByRole('link', { name: 'Portfolios' })
    const universe = screen.getByRole('link', { name: 'Universe' })
    expect(portfolios.className).not.toContain('text-emerald-400')
    expect(universe.className).toContain('text-emerald-400')
  })
})
