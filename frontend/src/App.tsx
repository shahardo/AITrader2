// App.tsx — application shell: left sidebar navigation, route table, and the
// auth guard that redirects logged-out visitors to the login page.

import type { ReactElement } from 'react'
import { useEffect } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AUTH_EXPIRED_EVENT, clearTokens, getTokens } from './api/client'
import NotificationBell from './components/NotificationBell'
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

/** Left sidebar navigation with logout, hidden on the login page. */
function SideBar() {
  const navigate = useNavigate()
  const location = useLocation()

  // When a request's refresh token has also expired, send the user back to login.
  useEffect(() => {
    function onAuthExpired() {
      navigate('/login', { replace: true })
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
  }, [navigate])

  if (location.pathname === '/login') return null
  return (
    <aside className="flex w-56 flex-shrink-0 flex-col gap-1 border-r border-slate-800 bg-slate-900 p-4">
      <span className="mb-4 text-lg font-bold text-emerald-400">AITrader2</span>
      <NavLink to="/" end className={navLinkClass}>
        Portfolios
      </NavLink>
      <NavLink to="/recommendations" className={navLinkClass}>
        Recommendations
      </NavLink>
      <NavLink to="/strategies" className={navLinkClass}>
        Strategy Lab
      </NavLink>
      <NavLink to="/universe" className={navLinkClass}>
        Universe
      </NavLink>
      <NavLink to="/scores" className={navLinkClass}>
        Scores
      </NavLink>
      <NavLink to="/topics" className={navLinkClass}>
        Topics
      </NavLink>
      <NavLink to="/settings" className={navLinkClass}>
        Settings
      </NavLink>
      <div className="mt-auto flex flex-col gap-3">
        <NotificationBell />
        <button
          className="rounded bg-slate-800 px-3 py-2 text-left text-sm hover:bg-slate-700"
          onClick={() => {
            clearTokens()
            navigate('/login')
          }}
        >
          Log out
        </button>
        <p className="text-xs text-slate-500">Not financial advice — paper trading only</p>
      </div>
    </aside>
  )
}

/** Style the nav link for the currently active route. */
function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `rounded px-3 py-2 text-sm ${
    isActive ? 'bg-slate-800 font-semibold text-emerald-400' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
  }`
}

/** Route table for the app. */
export default function App() {
  return (
    <div className="flex min-h-screen">
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
  )
}
