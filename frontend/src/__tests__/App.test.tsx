// App.test.tsx — tests for the app shell: the sidebar's nav links are stacked
// vertically on the left, the link for the current route is highlighted, and
// the top header holds the logo plus the bell/theme/language/logout controls.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../App'
import { ThemeProvider } from '../contexts/ThemeContext'
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
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('App sidebar', () => {
  it('renders the nav links stacked vertically in a left sidebar', () => {
    renderApp('/recommendations')
    const sidebar = screen.getByRole('link', { name: 'Portfolios' }).closest('aside')
    expect(sidebar?.className).toContain('flex-col')
    const links = sidebar!.querySelectorAll('a')
    expect(links.length).toBeGreaterThanOrEqual(7)
  })

  it('highlights only the link for the active route', () => {
    renderApp('/recommendations')
    const active = screen.getByRole('link', { name: 'Recommendations' })
    const inactive = screen.getByRole('link', { name: 'Portfolios' })
    expect(active.className).toContain('text-accent')
    expect(inactive.className).not.toContain('text-accent')
  })

  it('marks Portfolios active only at the root path, not on other routes', () => {
    renderApp('/universe')
    const portfolios = screen.getByRole('link', { name: 'Portfolios' })
    const universe = screen.getByRole('link', { name: 'Universe' })
    expect(portfolios.className).not.toContain('text-accent')
    expect(universe.className).toContain('text-accent')
  })
})

describe('App header', () => {
  it('renders the logo on the start side and session controls on the end side', () => {
    renderApp('/recommendations')
    const header = screen.getByText('AITrader').closest('header')
    expect(header).toBeTruthy()
    expect(header?.className).toContain('justify-between')
    expect(within(header!).getByRole('button', { name: 'Log out' })).toBeInTheDocument()
  })

  it('renders the notification bell in the header', () => {
    renderApp('/recommendations')
    const header = screen.getByText('AITrader').closest('header')
    expect(within(header!).getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('renders the theme toggle as an icon-only button', () => {
    renderApp('/recommendations')
    const header = screen.getByText('AITrader').closest('header')
    const themeButton = within(header!).getByRole('button', { name: /Light mode|מצב בהיר/ })
    expect(themeButton.textContent?.trim()).toBe('☀️')
  })

  it('renders the language toggle with a globe icon and an abbreviated language code', () => {
    renderApp('/recommendations')
    const header = screen.getByText('AITrader').closest('header')
    const langButton = within(header!).getByRole('button', { name: /English|עברית/ })
    expect(langButton.textContent).toContain('🌐')
    expect(langButton.textContent?.replace('🌐', '').trim()).toMatch(/^(EN|HE)$/)
  })

  it('is hidden on the login page', () => {
    renderApp('/login')
    expect(document.querySelector('header')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()
  })
})
