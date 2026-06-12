// ThemeContext.tsx — light/dark mode + per-section accent color. Persists the
// chosen color scheme to localStorage, applies the .dark/.light class and a
// data-section attribute to <html> (consumed by index.css), and keeps
// <html dir/lang> in sync with the active i18next language for RTL support.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export type ColorScheme = 'dark' | 'light'

const STORAGE_KEY = 'aitrader-color-scheme'

interface ThemeContextValue {
  scheme: ColorScheme
  toggleScheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** Map a route path to the nav section that drives the accent color. */
function sectionForPath(pathname: string): string {
  if (pathname.startsWith('/recommendations')) return 'recommendations'
  if (pathname.startsWith('/strategies')) return 'strategies'
  if (pathname.startsWith('/universe')) return 'universe'
  if (pathname.startsWith('/scores')) return 'scores'
  if (pathname.startsWith('/topics')) return 'topics'
  if (pathname.startsWith('/settings')) return 'settings'
  if (pathname.startsWith('/stocks/')) return 'stock-detail'
  return 'portfolios'
}

/** Provides color-scheme state and keeps <html> attributes in sync with it. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setScheme] = useState<ColorScheme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' ? 'light' : 'dark'
  })
  const location = useLocation()
  const { i18n } = useTranslation()

  useEffect(() => {
    document.documentElement.classList.remove('dark', 'light')
    document.documentElement.classList.add(scheme)
    localStorage.setItem(STORAGE_KEY, scheme)
  }, [scheme])

  useEffect(() => {
    document.documentElement.dataset.section = sectionForPath(location.pathname)
  }, [location.pathname])

  useEffect(() => {
    document.documentElement.lang = i18n.language
    document.documentElement.dir = i18n.language === 'he' ? 'rtl' : 'ltr'
  }, [i18n.language])

  function toggleScheme() {
    setScheme((s) => (s === 'dark' ? 'light' : 'dark'))
  }

  return <ThemeContext.Provider value={{ scheme, toggleScheme }}>{children}</ThemeContext.Provider>
}

/** Access the current color scheme and toggle function. */
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
