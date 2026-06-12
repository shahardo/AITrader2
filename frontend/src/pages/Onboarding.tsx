// Onboarding.tsx — first-login setup wizard: guides a new user through loading
// the universe, running a first analysis, creating a portfolio, and generating
// (and optionally executing) the initial recommendations round.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
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

const STEP_TITLES = [
  'Your profile',
  'Load the universe',
  'Run the first analysis',
  'Create a portfolio',
  'First recommendations',
  'All set',
]

/** Render an error from a mutation as a red alert line. */
function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof ApiError ? error.message : 'Something went wrong'
  return (
    <p role="alert" className="text-sm text-red-400">
      {message}
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

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Welcome to AITrader2</h1>
      <p className="text-sm text-slate-400">
        A few steps to get your paper-trading research workspace ready. Not financial advice.
      </p>
      <p className="mb-6 mt-1 text-xs text-slate-500">
        {me ? `Signed in as ${me.email}` : ' '}
      </p>

      <ol className="mb-6 space-y-1 text-sm">
        {STEP_TITLES.map((title, i) => (
          <li
            key={title}
            className={
              i === step ? 'font-semibold text-emerald-400' : i < step ? 'text-slate-500 line-through' : 'text-slate-400'
            }
          >
            {i + 1}. {title}
          </li>
        ))}
      </ol>

      <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-6">
        {step === 0 && (
          <>
            <h2 className="text-lg font-semibold">Your profile</h2>
            <p className="text-sm text-slate-400">
              Risk level and markets shape which strategies and stocks you are offered.
            </p>
            <label className="block text-sm">
              Risk level
              <select
                value={riskLevel}
                onChange={(e) => setRiskChoice(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1"
              >
                <option value="conservative">Conservative</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </label>
            <label className="block text-sm">
              Markets
              <select
                value={markets}
                onChange={(e) => setMarketsChoice(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1"
              >
                <option value="us">US only</option>
                <option value="tase">Israel (TASE) only</option>
                <option value="both">US + TASE</option>
              </select>
            </label>
            <ErrorLine error={saveProfile.error} />
            <button
              onClick={() => saveProfile.mutate()}
              disabled={saveProfile.isPending}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
            >
              Save & continue
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="text-lg font-semibold">Load the universe</h2>
            {status?.universe_loaded ? (
              <>
                <p className="text-sm text-slate-300">
                  Universe already loaded — {status.instrument_count} instruments tracked.
                </p>
                <button
                  onClick={() => setStep(2)}
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500"
                >
                  Continue
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-400">
                  Downloads S&P 500, Nasdaq-100 and TA-125 constituents plus their price
                  history. This can take several minutes — leave the tab open.
                </p>
                <ErrorLine error={loadUniverse.error} />
                <button
                  onClick={() => loadUniverse.mutate()}
                  disabled={loadUniverse.isPending}
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
                >
                  {loadUniverse.isPending ? 'Loading universe…' : 'Load universe now'}
                </button>
              </>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-lg font-semibold">Run the first analysis</h2>
            {status?.scores_ready ? (
              <>
                <p className="text-sm text-slate-300">
                  Scores already computed — the leaderboard is ready.
                </p>
                <button
                  onClick={() => setStep(3)}
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500"
                >
                  Continue
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-400">
                  Scores a first batch of stocks (technical indicators + news sentiment) so
                  recommendations have something to rank. The nightly pipeline covers the
                  rest of the universe.
                </p>
                <ErrorLine error={firstAnalysis.error} />
                <button
                  onClick={() => firstAnalysis.mutate()}
                  disabled={firstAnalysis.isPending}
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
                >
                  {firstAnalysis.isPending ? 'Analyzing…' : 'Run first analysis'}
                </button>
              </>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-lg font-semibold">Create a portfolio</h2>
            {portfolios && portfolios.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-slate-300">Pick an existing portfolio:</p>
                {portfolios.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPortfolioId(p.id)
                      setStep(4)
                    }}
                    className="block w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-left text-sm hover:border-emerald-500"
                  >
                    {p.name} — ${p.value.toLocaleString()}
                  </button>
                ))}
                <p className="text-sm text-slate-400">…or create a new one:</p>
              </div>
            )}
            <label className="block text-sm">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              Starting capital ($)
              <input
                type="number"
                min={1000}
                value={capital}
                onChange={(e) => setCapital(Number(e.target.value))}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1"
              />
            </label>
            <ErrorLine error={makePortfolio.error} />
            <button
              onClick={() => makePortfolio.mutate()}
              disabled={makePortfolio.isPending || !name.trim()}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
            >
              Create portfolio
            </button>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="text-lg font-semibold">First recommendations</h2>
            {!proposal && (
              <>
                <p className="text-sm text-slate-400">
                  Generate an initial portfolio proposal: BUY recommendations sized to your
                  capital, drawn from today's top-ranked stocks.
                </p>
                <ErrorLine error={generateProposal.error} />
                <button
                  onClick={() => generateProposal.mutate()}
                  disabled={generateProposal.isPending || portfolioId == null}
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
                >
                  {generateProposal.isPending ? 'Generating…' : 'Generate recommendations'}
                </button>
              </>
            )}
            {proposal && (
              <>
                <ul className="space-y-2 text-sm">
                  {proposal.map((rec) => (
                    <li key={rec.id} className="rounded border border-slate-800 bg-slate-950 p-2">
                      <span className="font-mono font-semibold text-emerald-300">
                        {rec.action} {rec.qty} {rec.symbol}
                      </span>{' '}
                      <span className="text-slate-400">
                        ({Math.round(rec.confidence * 100)}% confidence)
                      </span>
                      {rec.explanation && (
                        <p className="mt-1 text-xs text-slate-400">{rec.explanation}</p>
                      )}
                    </li>
                  ))}
                </ul>
                <ErrorLine error={approveProposal.error} />
                <div className="flex gap-3">
                  <button
                    onClick={() => approveProposal.mutate()}
                    disabled={approveProposal.isPending}
                    className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Approve all & execute
                  </button>
                  <button
                    onClick={() => setStep(5)}
                    className="rounded bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
                  >
                    Decide later
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="text-lg font-semibold">All set 🎉</h2>
            <p className="text-sm text-slate-400">
              Your workspace is ready. The nightly pipeline keeps prices, scores and
              recommendations fresh; visit the Strategy Lab to compare strategies, or
              Settings to link Telegram notifications.
            </p>
            <button
              onClick={() => {
                if (me) dismissOnboarding(me.email)
                navigate('/')
              }}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500"
            >
              Go to dashboard
            </button>
          </>
        )}
      </div>

      {step < 5 && (
        <button onClick={skip} className="mt-4 text-sm text-slate-500 hover:text-slate-300">
          Skip setup — I'll explore on my own
        </button>
      )}
    </div>
  )
}
