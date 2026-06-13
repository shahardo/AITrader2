// App.tsx — application shell: a full-width top page header, a left sidebar
// navigation below it, route table, and the auth guard that redirects
// logged-out visitors to the login page.

import type { ReactElement } from 'react'
import { useEffect } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AUTH_EXPIRED_EVENT, getTokens } from './api/client'
import Header from './components/Header'
import LoginPage from './pages/Login'
import OnboardingPage from './pages/Onboarding'
import PortfoliosPage from './pages/Portfolios'
import RecommendationsPage from './pages/Recommendations'
import ScoresPage from './pages/Scores'
import SettingsPage from './pages/Settings'
import StockDetailPage from './pages/StockDetail'
import TopicsPage from './pages/Topics'
import StrategyLabPage from './pages/StrategyLab'
import UniversePage from './pages/Universe'

/** Redirect to /login when no tokens are stored; otherwise render children. */
function RequireAuth({ children }: { children: ReactElement }) {
  return getTokens() ? children : <Navigate to="/login" replace />
}

/** Left sidebar navigation, hidden on the login page. */
function SideBar() {
  const location = useLocation()
  const { t } = useTranslation(['nav', 'common'])

  if (location.pathname === '/login') return null

  return (
    <aside className="flex w-56 flex-shrink-0 flex-col gap-1 border-e border-edge bg-panel p-4">
      <NavLink to="/" end className={navLinkClass}>
        {t('nav:portfolios')}
      </NavLink>
      <NavLink to="/recommendations" className={navLinkClass}>
        {t('nav:recommendations')}
      </NavLink>
      <NavLink to="/strategies" className={navLinkClass}>
        {t('nav:strategyLab')}
      </NavLink>
      <NavLink to="/universe" className={navLinkClass}>
        {t('nav:universe')}
      </NavLink>
      <NavLink to="/scores" className={navLinkClass}>
        {t('nav:scores')}
      </NavLink>
      <NavLink to="/topics" className={navLinkClass}>
        {t('nav:topics')}
      </NavLink>
      <NavLink to="/settings" className={navLinkClass}>
        {t('nav:settings')}
      </NavLink>
      <p className="mt-auto text-xs text-ink-4">{t('common:disclaimer')}</p>
    </aside>
  )
}

/** Style the nav link for the currently active route. */
function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `rounded px-3 py-2 text-sm ${
    isActive ? 'bg-panel-2 font-semibold text-accent' : 'text-ink-2 hover:bg-panel-2 hover:text-ink'
  }`
}

/** Route table for the app, with a full-width top header and a left sidebar below it. */
export default function App() {
  const navigate = useNavigate()

  // When a request's refresh token has also expired, send the user back to login.
  useEffect(() => {
    function onAuthExpired() {
      navigate('/login', { replace: true })
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
  }, [navigate])

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex min-w-0 flex-1">
        <SideBar />
        <div className="min-w-0 flex-1">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <OnboardingPage />
                </RequireAuth>
              }
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <PortfoliosPage />
                </RequireAuth>
              }
            />
            <Route
              path="/recommendations"
              element={
                <RequireAuth>
                  <RecommendationsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/strategies"
              element={
                <RequireAuth>
                  <StrategyLabPage />
                </RequireAuth>
              }
            />
            <Route
              path="/topics"
              element={
                <RequireAuth>
                  <TopicsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <SettingsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/universe"
              element={
                <RequireAuth>
                  <UniversePage />
                </RequireAuth>
              }
            />
            <Route
              path="/scores"
              element={
                <RequireAuth>
                  <ScoresPage />
                </RequireAuth>
              }
            />
            <Route
              path="/stocks/:symbol"
              element={
                <RequireAuth>
                  <StockDetailPage />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}
