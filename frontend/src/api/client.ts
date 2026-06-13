// client.ts — typed API client for the AITrader2 backend: token storage,
// authenticated fetch wrapper, and endpoint functions with response types
// mirroring the backend Pydantic schemas.

const TOKEN_KEY = 'aitrader2.tokens'

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface UserOut {
  id: number
  email: string
  risk_level: 'conservative' | 'balanced' | 'aggressive'
  markets: 'us' | 'tase' | 'both'
  strategy_switch_mode: 'auto' | 'approve'
  telegram_linked: boolean
}

export interface InstrumentOut {
  id: number
  symbol: string
  name: string
  exchange: 'us' | 'tase'
  sector: string | null
  currency: string
  universe_source: string
  last_close: number | null
  prev_close: number | null
  last_date: string | null
  bar_count: number
}

export interface PriceBarOut {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface InstrumentDetail extends InstrumentOut {
  bars: PriceBarOut[]
  website: string | null
  description: string | null
}

export interface IndicatorSignal {
  signal: -1 | 0 | 1
  strength: number
  value: number | null
}

export interface TrendChannelOut {
  slope_annual_pct: number
  width_pct: number
  position: number
  upper: number
  mid: number
  lower: number
}

export interface SRLevelOut {
  price: number
  kind: 'support' | 'resistance'
  touches: number
  last_touch_age: number
  strength: number
}

export interface SnapshotOut {
  date: string
  technical_score: number
  signals: Record<string, IndicatorSignal>
  extras: { trend_channel: TrendChannelOut | null; sr_levels: SRLevelOut[] }
  combined_score: number | null
  sentiment_score: number | null
}

export interface SentimentItemOut {
  source: string
  title: string
  url: string
  published_at: string | null
  sentiment: number
  relevance: number
  summary: string
}

export interface SentimentOut {
  date: string
  score: number
  confidence: number
  item_count: number
  items: SentimentItemOut[]
}

export interface ScoreRow {
  symbol: string
  name: string
  exchange: string
  date: string
  technical_score: number
  sentiment_score: number | null
  combined_score: number
  rank: number | null
}

/** Persist a token pair to localStorage. */
export function storeTokens(tokens: TokenPair): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
}

/** Read the stored token pair, or null when logged out. */
export function getTokens(): TokenPair | null {
  const raw = localStorage.getItem(TOKEN_KEY)
  return raw ? (JSON.parse(raw) as TokenPair) : null
}

/** Drop stored tokens (logout). */
export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY)
}

const ONBOARDING_DISMISS_KEY = 'aitrader2.onboarding.dismissed'

/** Whether this account chose to skip the first-login setup wizard. */
export function isOnboardingDismissed(email: string): boolean {
  return localStorage.getItem(`${ONBOARDING_DISMISS_KEY}.${email}`) === '1'
}

/** Remember that this account skipped the setup wizard. */
export function dismissOnboarding(email: string): void {
  localStorage.setItem(`${ONBOARDING_DISMISS_KEY}.${email}`, '1')
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Dispatched on `window` when the refresh token is also invalid/expired; the app shell
 * listens for this to send the user back to the login page. */
export const AUTH_EXPIRED_EVENT = 'aitrader2:auth-expired'

let refreshPromise: Promise<TokenPair | null> | null = null

/**
 * Exchange the stored refresh token for a new token pair, persisting the result.
 * Concurrent callers share one in-flight request.
 */
function refreshTokens(): Promise<TokenPair | null> {
  const tokens = getTokens()
  if (!tokens) return Promise.resolve(null)
  if (!refreshPromise) {
    refreshPromise = fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    })
      .then((resp) => (resp.ok ? (resp.json() as Promise<TokenPair>) : null))
      .then((newTokens) => {
        if (newTokens) storeTokens(newTokens)
        return newTokens
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

/**
 * Fetch wrapper: attaches the Bearer token, parses JSON, and throws ApiError
 * with the backend's detail message on non-2xx responses. On a 401, transparently
 * refreshes the access token and retries once before giving up.
 */
async function request<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const tokens = getTokens()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (tokens) headers['Authorization'] = `Bearer ${tokens.access_token}`
  const resp = await fetch(`/api/v1${path}`, { ...options, headers })
  if (!resp.ok) {
    if (resp.status === 401 && !isRetry && tokens && !path.startsWith('/auth/')) {
      const refreshed = await refreshTokens()
      if (refreshed) return request<T>(path, options, true)
      clearTokens()
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
    }
    let detail = resp.statusText
    try {
      const body = await resp.json()
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      /* non-JSON error body; keep statusText */
    }
    throw new ApiError(resp.status, detail)
  }
  if (resp.status === 204) return undefined as T
  return (await resp.json()) as T
}

/** Create an account and store its tokens. */
export async function signup(email: string, password: string): Promise<TokenPair> {
  const tokens = await request<TokenPair>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  storeTokens(tokens)
  return tokens
}

/** Log in and store tokens. */
export async function login(email: string, password: string): Promise<TokenPair> {
  const tokens = await request<TokenPair>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  storeTokens(tokens)
  return tokens
}

/** Fetch the authenticated user's profile. */
export function getMe(): Promise<UserOut> {
  return request<UserOut>('/me')
}

/** List universe instruments, optionally filtered by a search term. */
export function listInstruments(params?: { search?: string }): Promise<InstrumentOut[]> {
  const query = new URLSearchParams()
  if (params?.search) query.set('search', params.search)
  const qs = query.toString()
  return request<InstrumentOut[]>(`/instruments${qs ? `?${qs}` : ''}`)
}

/** Fetch one instrument with recent bars. */
export function getInstrument(symbol: string, days = 365): Promise<InstrumentDetail> {
  return request<InstrumentDetail>(`/instruments/${encodeURIComponent(symbol)}?days=${days}`)
}

/** Fetch the latest universe score leaderboard. */
export function getLatestScores(): Promise<ScoreRow[]> {
  return request<ScoreRow[]>('/scores/latest')
}

/** Fetch the latest indicator snapshot for one instrument. */
export function getAnalysis(symbol: string): Promise<SnapshotOut> {
  return request<SnapshotOut>(`/instruments/${encodeURIComponent(symbol)}/analysis`)
}

/** Fetch the latest sentiment composite + items for one instrument. */
export function getSentiment(symbol: string): Promise<SentimentOut> {
  return request<SentimentOut>(`/instruments/${encodeURIComponent(symbol)}/sentiment`)
}

export interface PortfolioOut {
  id: number
  name: string
  strategy_id: number | null
  strategy_name: string | null
  initial_capital: number
  cash: number
  auto_execute: boolean
  value: number
  pnl_pct: number
  created_at: string
}

export interface HoldingOut {
  symbol: string
  name: string
  qty: number
  avg_cost: number
  last_close: number | null
  market_value: number | null
  pnl_pct: number | null
}

export interface PortfolioDetail extends PortfolioOut {
  holdings: HoldingOut[]
}

export interface PerformanceOut {
  portfolio_id: number
  name: string
  curve: { date: string; value: number }[]
}

export interface RecommendationOut {
  id: number
  portfolio_id: number
  symbol: string
  instrument_name: string
  action: 'BUY' | 'SELL' | 'HOLD'
  qty: number
  confidence: number
  signals: Record<string, unknown>
  explanation: string
  kind: 'daily' | 'initial'
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'expired'
  price_at_recommendation: number | null
  created_at: string
}

export interface StrategyOut {
  id: number
  name: string
  kind: string
  params: Record<string, unknown>
  risk_fit: string
  description: string
}

export interface StrategyRunOut {
  id: number
  strategy_id: number
  run_date: string
  train_start: string
  train_end: string
  test_start: string
  test_end: string
  chosen_params: Record<string, unknown>
  train_metrics: Record<string, number>
  test_metrics: Record<string, number>
  equity_curve: [string, number][]
  status: string
  rank: number
}

export interface StrategyEvolutionRunOut {
  id: number
  status: 'pending' | 'running' | 'done' | 'failed'
  triggered_by: string
  population_size: number
  generations: number
  current_generation: number
  risk_weight: number
  max_symbols: number
  fitness_history: { generation: number; best: number; avg: number }[]
  strategy_run_id: number | null
  error_message: string | null
  started_at: string
  completed_at: string | null
}

export interface EvolveOptions {
  population_size?: number
  generations?: number
  risk_weight?: number
  max_symbols?: number
}

export interface BacktestTradeOut {
  symbol: string
  side: 'BUY' | 'SELL'
  date: string
  price: number
  qty: number
  triggering_signals: Record<string, unknown>
  pnl: number | null
}

/** List the user's paper portfolios with live valuations. */
export function listPortfolios(): Promise<PortfolioOut[]> {
  return request<PortfolioOut[]>('/portfolios')
}

/** Create a paper portfolio. */
export function createPortfolio(payload: {
  name: string
  initial_capital: number
  strategy_id?: number | null
  auto_execute?: boolean
}): Promise<PortfolioOut> {
  return request<PortfolioOut>('/portfolios', { method: 'POST', body: JSON.stringify(payload) })
}

/** Fetch one portfolio with holdings. */
export function getPortfolio(id: number): Promise<PortfolioDetail> {
  return request<PortfolioDetail>(`/portfolios/${id}`)
}

/** Delete a portfolio. */
export function deletePortfolio(id: number): Promise<void> {
  return request<void>(`/portfolios/${id}`, { method: 'DELETE' })
}

/** Fetch equity curves for several portfolios (comparison chart). */
export function comparePortfolios(ids: number[]): Promise<PerformanceOut[]> {
  return request<PerformanceOut[]>(`/portfolios-compare?ids=${ids.join(',')}`)
}

/** Generate the onboarding initial proposal for a portfolio. */
export function getInitialProposal(portfolioId: number): Promise<RecommendationOut[]> {
  return request<RecommendationOut[]>(`/portfolios/${portfolioId}/initial-proposal`, {
    method: 'POST',
  })
}

/** Approve the pending initial proposal (executes its BUYs). */
export function approveInitialProposal(portfolioId: number): Promise<RecommendationOut[]> {
  return request<RecommendationOut[]>(`/portfolios/${portfolioId}/initial-proposal/approve`, {
    method: 'POST',
  })
}

/** List a portfolio's recommendations. */
export function listRecommendations(
  portfolioId: number,
  status?: string,
): Promise<RecommendationOut[]> {
  const qs = status ? `&rec_status=${status}` : ''
  return request<RecommendationOut[]>(`/recommendations?portfolio_id=${portfolioId}${qs}`)
}

/** Approve one pending recommendation (executes the paper trade). */
export function approveRecommendation(id: number): Promise<RecommendationOut> {
  return request<RecommendationOut>(`/recommendations/${id}/approve`, { method: 'POST' })
}

/** Reject one pending recommendation. */
export function rejectRecommendation(id: number): Promise<RecommendationOut> {
  return request<RecommendationOut>(`/recommendations/${id}/reject`, { method: 'POST' })
}

/** Run the daily recommendation pass for one portfolio now. */
export function generateRecommendations(portfolioId: number): Promise<RecommendationOut[]> {
  return request<RecommendationOut[]>(`/portfolios/${portfolioId}/recommendations/generate`, {
    method: 'POST',
  })
}

/** List the strategy library. */
export function listStrategies(): Promise<StrategyOut[]> {
  return request<StrategyOut[]>('/strategies')
}

/** List one strategy's evaluation runs. */
export function listStrategyRuns(strategyId: number): Promise<StrategyRunOut[]> {
  return request<StrategyRunOut[]>(`/strategies/${strategyId}/runs`)
}

/** Fetch a run's simulated trades. */
export function listRunTrades(runId: number): Promise<BacktestTradeOut[]> {
  return request<BacktestTradeOut[]>(`/strategy-runs/${runId}/trades`)
}

/** Trigger the 10/2 train-test evaluation for all strategies. */
export function evaluateStrategies(maxSymbols = 60): Promise<StrategyRunOut[]> {
  return request<StrategyRunOut[]>('/strategies/evaluate', {
    method: 'POST',
    body: JSON.stringify({ max_symbols: maxSymbols }),
  })
}

/** Start a genetic-algorithm run that evolves the "evolved" strategy's gene. */
export function evolveStrategy(options: EvolveOptions = {}): Promise<StrategyEvolutionRunOut> {
  return request<StrategyEvolutionRunOut>('/strategies/evolve', {
    method: 'POST',
    body: JSON.stringify(options),
  })
}

/** Poll one evolution run's status and progress. */
export function getEvolutionRun(id: number): Promise<StrategyEvolutionRunOut> {
  return request<StrategyEvolutionRunOut>(`/strategy-evolution-runs/${id}`)
}

/** List evolution runs, newest first (for resuming polling after a reload). */
export function listEvolutionRuns(): Promise<StrategyEvolutionRunOut[]> {
  return request<StrategyEvolutionRunOut[]>('/strategy-evolution-runs')
}

export interface TopicOut {
  id: number
  name: string
  buzz_score: number
  status: string
  summary: string
  updated_at: string
}

export interface TopicCandidate {
  symbol: string
  name: string
  rationale: string
  combined_score: number | null
  validated: boolean
}

export interface TopicReportOut {
  id: number
  topic_id: number
  topic_name: string
  summary: string
  candidates: TopicCandidate[]
  status: string
  created_at: string
}

export interface NotificationOut {
  id: number
  kind: string
  title: string
  body: string
  read: boolean
  created_at: string
}

export interface ProgressInfo {
  stage: string
  symbol?: string
  topic?: string
  current?: number
  total?: number
}

export interface ScanOut {
  id: number
  status: string
  stats: Record<string, number>
  started_at: string
  finished_at: string | null
  progress?: ProgressInfo | null
}

/** List hot topics; refresh=true re-runs the LLM radar first. */
export function listHotTopics(refresh = false): Promise<TopicOut[]> {
  return request<TopicOut[]>(`/topics/hot${refresh ? '?refresh=true' : ''}`)
}

/** Run a topic deep dive (synchronous; can take a minute with analysis). */
export function runDeepDive(topic: string, analyze = true): Promise<TopicReportOut> {
  return request<TopicReportOut>('/topics/deep-dive', {
    method: 'POST',
    body: JSON.stringify({ topic, analyze }),
  })
}

/** List recent deep-dive reports. */
export function listTopicReports(): Promise<TopicReportOut[]> {
  return request<TopicReportOut[]>('/topic-reports')
}

/** Poll the current user's in-flight deep-dive status, if any. */
export function getDeepDiveProgress(): Promise<{ progress: ProgressInfo | null }> {
  return request<{ progress: ProgressInfo | null }>('/topics/deep-dive/progress')
}

/** List the user's notifications. */
export function listNotifications(): Promise<NotificationOut[]> {
  return request<NotificationOut[]>('/notifications')
}

/** Mark a notification read. */
export function markNotificationRead(id: number): Promise<void> {
  return request<void>(`/notifications/${id}/read`, { method: 'POST' })
}

/** Start Telegram linking; returns the one-time code + instructions. */
export function startTelegramLink(): Promise<{ code: string; instructions: string }> {
  return request('/me/telegram-link', { method: 'POST' })
}

/** Poll for Telegram link completion. */
export function checkTelegramLink(): Promise<{ linked: boolean }> {
  return request('/me/telegram-link/check', { method: 'POST' })
}

/** Update profile fields. */
export function updateMe(payload: {
  risk_level?: string
  markets?: string
  strategy_switch_mode?: string
}): Promise<UserOut> {
  return request<UserOut>('/me', { method: 'PATCH', body: JSON.stringify(payload) })
}

/** Trigger a universe re-scan (slow: refetches constituents + prices). */
export function triggerScan(): Promise<ScanOut> {
  return request<ScanOut>('/scans', { method: 'POST' })
}

export interface HitRateStats {
  evaluated: number
  hits: number
  hit_rate: number
  avg_return: number
}

/** Fetch recommendation accuracy stats (30-day outcomes). */
export function getHitRate(): Promise<HitRateStats> {
  return request<HitRateStats>('/stats/hit-rate')
}

/** Fetch the latest scan record. */
export function getLatestScan(): Promise<ScanOut | null> {
  return request<ScanOut | null>('/scans/latest')
}

/** Trigger a synchronous analysis run for selected symbols (or the whole universe). */
export function runAnalysis(params: {
  symbols?: string[]
  with_sentiment: boolean
  limit?: number
}): Promise<{ analyzed: number; scores: Record<string, number> }> {
  return request('/analysis/run', { method: 'POST', body: JSON.stringify(params) })
}

export interface OnboardingStatus {
  universe_loaded: boolean
  instrument_count: number
  prices_loaded: boolean
  scores_ready: boolean
  has_portfolio: boolean
  has_recommendations: boolean
  complete: boolean
}

/** Fetch first-login setup progress for the onboarding wizard. */
export function getOnboardingStatus(): Promise<OnboardingStatus> {
  return request<OnboardingStatus>('/onboarding/status')
}

/** Danger zone: permanently delete all application data, keeping user accounts. */
export function clearAllData(): Promise<void> {
  return request<void>('/admin/clear-data', { method: 'POST' })
}

/** Danger zone: permanently delete all application data and every user account. */
export function clearAllDataAndUsers(): Promise<void> {
  return request<void>('/admin/clear-data-and-users', { method: 'POST' })
}
