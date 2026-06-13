// Login.tsx — login/signup page: a single form that either authenticates an
// existing account or creates a new one, then enters the app.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  getOnboardingStatus,
  isOnboardingDismissed,
  login,
  signup,
} from '../api/client'
import { translateApiError } from '../lib/apiErrors'
import { useTheme } from '../contexts/ThemeContext'
import Logo from '../components/Logo'

/** Login & signup form page. */
export default function LoginPage() {
  const navigate = useNavigate()
  const { scheme, toggleScheme } = useTheme()
  const { t, i18n } = useTranslation(['login', 'common'])
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Toggle the UI language between English and Hebrew. */
  function toggleLanguage() {
    void i18n.changeLanguage(i18n.language === 'he' ? 'en' : 'he')
  }

  /** Submit credentials to the API for the selected mode. */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await (mode === 'login' ? login(email, password) : signup(email, password))
      let destination = '/universe'
      if (!isOnboardingDismissed(email)) {
        try {
          const status = await getOnboardingStatus()
          if (!status.complete) destination = '/onboarding'
        } catch {
          /* status check failed — enter the app normally */
        }
      }
      navigate(destination)
    } catch (err) {
      setError(translateApiError(err, t, t('errors.somethingWrong')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="w-80 space-y-4 rounded-lg border border-edge bg-panel p-6"
      >
        <div className="flex gap-2">
          <button
            type="button"
            onClick={toggleScheme}
            className="flex-1 rounded bg-panel-2 px-2 py-1 text-xs hover:bg-panel-3"
          >
            {scheme === 'dark' ? t('common:theme.switchToLight') : t('common:theme.switchToDark')}
          </button>
          <button
            type="button"
            onClick={toggleLanguage}
            className="flex-1 rounded bg-panel-2 px-2 py-1 text-xs hover:bg-panel-3"
          >
            {i18n.language === 'he' ? t('common:language.en') : t('common:language.he')}
          </button>
        </div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-accent">
          <Logo className="h-8 w-8" />
          {t('common:appName')}
        </h1>
        <p className="text-xs text-ink-3">
          {t('tagline')} {t('common:disclaimerShort')}
        </p>
        <label className="block text-sm">
          {t('fields.email')}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-edge-2 bg-panel-2 px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          {t('fields.password')}
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-edge-2 bg-panel-2 px-2 py-1"
          />
        </label>
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-accent-button py-2 font-semibold hover:bg-accent-button-hover disabled:opacity-50"
        >
          {mode === 'login' ? t('actions.logIn') : t('actions.createAccount')}
        </button>
        <button
          type="button"
          className="w-full text-sm text-ink-3 hover:text-ink"
          onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
        >
          {mode === 'login' ? t('toggle.toSignup') : t('toggle.toLogin')}
        </button>
      </form>
    </div>
  )
}
