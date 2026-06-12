// App.tsx — application shell: top navigation, route table, and the auth guard
// that redirects logged-out visitors to the login page.

import type { ReactElement } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { clearTokens, getTokens } from './api/client'
import LoginPage from './pages/Login'
import PortfoliosPage from './pages/Portfolios'
import RecommendationsPage from './pages/Recommendations'
import ScoresPage from './pages/Scores'
import StockDetailPage from './pages/StockDetail'
import StrategyLabPage from './pages/StrategyLab'
import UniversePage from './pages/Universe'

/** Redirect to /login when no tokens are stored; otherwise render children. */
function RequireAuth({ children }: { children: ReactElement }) {
  return getTokens() ? children : <Navigate to="/login" replace />
}

/** Top navigation bar with logout, hidden on the login page. */
function NavBar() {
  const navigate = useNavigate()
  const location = useLocation()
  if (location.pathname === '/login') return null
  return (
    <nav className="flex items-center gap-6 border-b border-slate-800 bg-slate-900 px-6 py-3">
      <span className="font-bold text-emerald-400">AITrader2</span>
      <Link to="/" className="text-sm text-slate-300 hover:text-white">
        Portfolios
      </Link>
      <Link to="/recommendations" className="text-sm text-slate-300 hover:text-white">
        Recommendations
      </Link>
      <Link to="/strategies" className="text-sm text-slate-300 hover:text-white">
        Strategy Lab
      </Link>
      <Link to="/universe" className="text-sm text-slate-300 hover:text-white">
        Universe
      </Link>
      <Link to="/scores" className="text-sm text-slate-300 hover:text-white">
        Scores
      </Link>
      <span className="ml-auto text-xs text-slate-500">
        Not financial advice — paper trading only
      </span>
      <button
        className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700"
        onClick={() => {
          clearTokens()
          navigate('/login')
        }}
      >
        Log out
      </button>
    </nav>
  )
}

/** Route table for the app. */
export default function App() {
  return (
    <div className="min-h-screen">
      <NavBar />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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
  )
}
