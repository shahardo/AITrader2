// Header.tsx — top page header: app logo on the start side, and the
// notification bell, theme toggle, language toggle, and logout button on the
// end side. Hidden on the login page.

import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { clearTokens } from '../api/client'
import { useTheme } from '../contexts/ThemeContext'
import NotificationBell from './NotificationBell'

/** Top header bar with branding and session controls. */
export default function Header() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t, i18n } = useTranslation('common')
  const { scheme, toggleScheme } = useTheme()

  if (location.pathname === '/login') return null

  /** Toggle the UI language between English and Hebrew. */
  function toggleLanguage() {
    void i18n.changeLanguage(i18n.language === 'he' ? 'en' : 'he')
  }

  const themeLabel = scheme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')
  const languageLabel = i18n.language === 'he' ? t('language.en') : t('language.he')

  return (
    <header className="flex items-center justify-between border-b border-edge bg-panel px-6 py-3">
      <span className="text-lg font-bold text-accent">{t('appName')}</span>
      <div className="flex items-center gap-2">
        <NotificationBell />
        <button
          type="button"
          onClick={toggleScheme}
          aria-label={themeLabel}
          title={themeLabel}
          className="rounded bg-panel-2 px-2.5 py-1.5 text-base leading-none hover:bg-panel-3"
        >
          {scheme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button
          type="button"
          onClick={toggleLanguage}
          aria-label={languageLabel}
          title={languageLabel}
          className="rounded bg-panel-2 px-2.5 py-1.5 text-sm hover:bg-panel-3"
        >
          🌐 {i18n.language.slice(0, 2).toUpperCase()}
        </button>
        <button
          type="button"
          onClick={() => {
            clearTokens()
            navigate('/login')
          }}
          className="rounded bg-panel-2 px-3 py-1.5 text-sm hover:bg-panel-3"
        >
          {t('actions.logout')}
        </button>
      </div>
    </header>
  )
}
