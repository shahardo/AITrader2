// Onboarding.tsx — first-login setup wizard: guides a new user through loading
// the universe, running a first analysis, creating a portfolio, and generating
// (and optionally executing) the initial recommendations round.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  approveInitialProposal,
  createPortfolio,
  dismissOnboarding,
  getInitialProposal,
  getMe,
  getOnboardingStatus,
  listPortfolios,
  runAnalysis,
  triggerScan,
  updateMe,
  type OnboardingStatus,
  type RecommendationOut,
} from '../api/client'
import { translateApiError } from '../lib/apiErrors'
import Spinner from '../components/Spinner'

/** Render an error from a mutation as a red alert line. */
function ErrorLine({ error }: { error: unknown }) {
  const { t } = useTranslation(['onboarding', 'common'])
  if (!error) return null
  return (
    <p role="alert" className="text-sm text-negative">
      {translateApiError(error, t, t('errors.somethingWrong'))}
    </p>
  )
}

/** First incomplete step for a loaded status (skips already-done work). */
function firstIncompleteStep(status: OnboardingStatus | undefined): number {
  if (!status || !status.universe_loaded) return 0
  if (!status.scores_ready) return 2
  if (!status.has_portfolio) return 3
  if (!status.has_recommendations) return 4
  return 5
}

/** First-login setup wizard page. */
export default function OnboardingPage() {
  const navigate = useNavigate()
  const { t } = useTranslation('onboarding')
  const queryClient = useQueryClient()
  const [stepOverride, setStep] = useState<number | null>(null)
  const [portfolioId, setPortfolioId] = useState<number | null>(null)
  const [proposal, setProposal] = useState<RecommendationOut[] | null>(null)

  const { data: status } = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: getOnboardingStatus,
  })
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: getMe })
  const { data: portfolios } = useQuery({ queryKey: ['portfolios'], queryFn: listPortfolios })

  // Until the user navigates, the visible step is derived from backend progress.
  const step = stepOverride ?? firstIncompleteStep(status)

  const [riskChoice, setRiskChoice] = useState<string | null>(null)
  const [marketsChoice, setMarketsChoice] = useState<string | null>(null)
  const [name, setName] = useState('My first portfolio')
  const [capital, setCapital] = useState(100000)
  const riskLevel = riskChoice ?? me?.risk_level ?? 'balanced'
  const markets = marketsChoice ?? me?.markets ?? 'both'

  /** Refresh status flags after a step mutates backend state. */
  function refreshStatus() {
    queryClient.invalidateQueries({ queryKey: ['onboarding-status'] })
  }

  const saveProfile = useMutation({
    mutationFn: () => updateMe({ risk_level: riskLevel, markets }),
    onSuccess: () => setStep(1),
  })
  const loadUniverse = useMutation({
    mutationFn: triggerScan,
    onSuccess: () => {
      refreshStatus()
      setStep(2)
    },
  })
  const firstAnalysis = useMutation({
    mutationFn: () => runAnalysis({ with_sentiment: true, limit: 50 }),
    onSuccess: () => {
      refreshStatus()
      setStep(3)
    },
  })
  const makePortfolio = useMutation({
    mutationFn: () => createPortfolio({ name, initial_capital: capital }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] })
      refreshStatus()
      setPortfolioId(created.id)
      setStep(4)
    },
  })
  const generateProposal = useMutation({
    mutationFn: () => getInitialProposal(portfolioId!),
    onSuccess: (recs) => {
      refreshStatus()
      setProposal(recs)
    },
  })
  const approveProposal = useMutation({
    mutationFn: () => approveInitialProposal(portfolioId!),
    onSuccess: () => {
      refreshStatus()
      setStep(5)
    },
  })

  /** Skip the wizard for this account and enter the app. */
  function skip() {
    if (me) dismissOnboarding(me.email)
    navigate('/universe')
  }

  const stepTitles = t('steps', { returnObjects: true }) as string[]

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-bold text-accent">{t('welcome.heading')}</h1>
      <p className="text-sm text-ink-3">{t('welcome.subtitle')}</p>
      <p className="mb-6 mt-1 text-xs text-ink-4">
        {me ? t('welcome.signedInAs', { email: me.email }) : ' '}
      </p>

      <ol className="mb-6 space-y-1 text-sm">
        {stepTitles.map((title, i) => (
          <li
            key={title}
            className={
              i === step ? 'font-semibold text-accent' : i < step ? 'text-ink-4 line-through' : 'text-ink-3'
            }
          >
            {i + 1}. {title}
          </li>
        ))}
      </ol>

      <div className="space-y-4 rounded-lg border border-edge bg-panel p-6">
        {step === 0 && (
          <>
            <h2 className="text-lg font-semibold">{t('profile.heading')}</h2>
            <p className="text-sm text-ink-3">{t('profile.description')}</p>
            <label className="block text-sm">
              {t('profile.riskLevel')}
              <select
                value={riskLevel}
                onChange={(e) => setRiskChoice(e.target.value)}
                className="mt-1 w-full rounded border border-edge-2 bg-panel-2 px-2 py-1"
              >
                <option value="conservative">{t('profile.riskOptions.conservative')}</option>
                <option value="balanced">{t('profile.riskOptions.balanced')}</option>
                <option value="aggressive">{t('profile.riskOptions.aggressive')}</option>
              </select>
            </label>
            <label className="block text-sm">
              {t('profile.markets')}
              <select
                value={markets}
                onChange={(e) => setMarketsChoice(e.target.value)}
                className="mt-1 w-full rounded border border-edge-2 bg-panel-2 px-2 py-1"
              >
                <option value="us">{t('profile.marketOptions.us')}</option>
                <option value="tase">{t('profile.marketOptions.tase')}</option>
                <option value="both">{t('profile.marketOptions.both')}</option>
              </select>
            </label>
            <ErrorLine error={saveProfile.error} />
            <button
              onClick={() => saveProfile.mutate()}
              disabled={saveProfile.isPending}
              className="rounded bg-accent-button px-4 py-2 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
            >
              {t('profile.saveAndContinue')}
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="text-lg font-semibold">{t('universe.heading')}</h2>
            {status?.universe_loaded ? (
              <>
                <p className="text-sm text-ink-2">
                  {t('universe.alreadyLoaded', { count: status.instrument_count })}
                </p>
                <button
                  onClick={() => setStep(2)}
                  className="rounded bg-accent-button px-4 py-2 text-sm font-semibold hover:bg-accent-button-hover"
                >
                  {t('universe.continue')}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-3">{t('universe.description')}</p>
                <ErrorLine error={loadUniverse.error} />
                <button
                  onClick={() => loadUniverse.mutate()}
                  disabled={loadUniverse.isPending}
                  className="flex items-center gap-2 rounded bg-accent-button px-4 py-2 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
                >
                  {loadUniverse.isPending ? t('universe.loading') : t('universe.loadNow')}
                  {loadUniverse.isPending && <Spinner className="h-4 w-4" />}
                </button>
              </>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-lg font-semibold">{t('analysis.heading')}</h2>
            {status?.scores_ready ? (
              <>
                <p className="text-sm text-ink-2">{t('analysis.alreadyComputed')}</p>
                <button
                  onClick={() => setStep(3)}
                  className="rounded bg-accent-button px-4 py-2 text-sm font-semibold hover:bg-accent-button-hover"
                >
                  {t('analysis.continue')}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-3">{t('analysis.description')}</p>
                <ErrorLine error={firstAnalysis.error} />
                <button
                  onClick={() => firstAnalysis.mutate()}
                  disabled={firstAnalysis.isPending}
                  className="flex items-center gap-2 rounded bg-accent-button px-4 py-2 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
                >
                  {firstAnalysis.isPending ? t('analysis.analyzing') : t('analysis.runFirst')}
                  {firstAnalysis.isPending && <Spinner className="h-4 w-4" />}
                </button>
              </>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-lg font-semibold">{t('portfolio.heading')}</h2>
            {portfolios && portfolios.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-ink-2">{t('portfolio.pickExisting')}</p>
                {portfolios.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPortfolioId(p.id)
                      setStep(4)
                    }}
                    className="block w-full rounded border border-edge-2 bg-panel-2 px-3 py-2 text-start text-sm hover:border-accent"
                  >
                    {p.name} — ${p.value.toLocaleString()}
                  </button>
                ))}
                <p className="text-sm text-ink-3">{t('portfolio.orCreateNew')}</p>
              </div>
            )}
            <label className="block text-sm">
              {t('portfolio.name')}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded border border-edge-2 bg-panel-2 px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              {t('portfolio.startingCapital')}
              <input
                type="number"
                min={1000}
                value={capital}
                onChange={(e) => setCapital(Number(e.target.value))}
                className="mt-1 w-full rounded border border-edge-2 bg-panel-2 px-2 py-1"
              />
            </label>
            <ErrorLine error={makePortfolio.error} />
            <button
              onClick={() => makePortfolio.mutate()}
              disabled={makePortfolio.isPending || !name.trim()}
              className="rounded bg-accent-button px-4 py-2 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
            >
              {t('portfolio.create')}
            </button>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="text-lg font-semibold">{t('recommendations.heading')}</h2>
            {!proposal && (
              <>
                <p className="text-sm text-ink-3">{t('recommendations.description')}</p>
                <ErrorLine error={generateProposal.error} />
                <button
                  onClick={() => generateProposal.mutate()}
                  disabled={generateProposal.isPending || portfolioId == null}
                  className="flex items-center gap-2 rounded bg-accent-button px-4 py-2 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
                >
                  {generateProposal.isPending
                    ? t('recommendations.generating')
                    : t('recommendations.generate')}
                  {generateProposal.isPending && <Spinner className="h-4 w-4" />}
                </button>
              </>
            )}
            {proposal && (
              <>
                <ul className="space-y-2 text-sm">
                  {proposal.map((rec) => (
                    <li key={rec.id} className="rounded border border-edge bg-app p-2">
                      <span className="font-mono font-semibold text-positive">
                        {rec.action} {rec.qty} {rec.symbol}
                      </span>{' '}
                      <span className="text-ink-3">
                        {t('recommendations.confidence', { percent: Math.round(rec.confidence * 100) })}
                      </span>
                      {rec.explanation && (
                        <p className="mt-1 text-xs text-ink-3">{rec.explanation}</p>
                      )}
                    </li>
                  ))}
                </ul>
                <ErrorLine error={approveProposal.error} />
                <div className="flex gap-3">
                  <button
                    onClick={() => approveProposal.mutate()}
                    disabled={approveProposal.isPending}
                    className="rounded bg-accent-button px-4 py-2 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
                  >
                    {t('recommendations.approveAndExecute')}
                  </button>
                  <button
                    onClick={() => setStep(5)}
                    className="rounded bg-panel-2 px-4 py-2 text-sm hover:bg-panel-3"
                  >
                    {t('recommendations.decideLater')}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="text-lg font-semibold">{t('done.heading')}</h2>
            <p className="text-sm text-ink-3">{t('done.description')}</p>
            <button
              onClick={() => {
                if (me) dismissOnboarding(me.email)
                navigate('/')
              }}
              className="rounded bg-accent-button px-4 py-2 text-sm font-semibold hover:bg-accent-button-hover"
            >
              {t('done.goToDashboard')}
            </button>
          </>
        )}
      </div>

      {step < 5 && (
        <button onClick={skip} className="mt-4 text-sm text-ink-4 hover:text-ink-2">
          {t('skip')}
        </button>
      )}
    </div>
  )
}
