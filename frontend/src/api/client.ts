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

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Fetch wrapper: attaches the Bearer token, parses JSON, and throws ApiError
 * with the backend's detail message on non-2xx responses.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const tokens = getTokens()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (tokens) headers['Authorization'] = `Bearer ${tokens.access_token}`
  const resp = await fetch(`/api/v1${path}`, { ...options, headers })
  if (!resp.ok) {
    let detail = resp.statusText
    try {
      const body = await resp.json()
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      /* non-JSON error body; keep statusText */
    }
    throw new ApiError(resp.status, detail)
  }
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

/** List universe instruments, optionally filtered. */
export function listInstruments(params?: {
  exchange?: 'us' | 'tase'
  search?: string
}): Promise<InstrumentOut[]> {
  const query = new URLSearchParams()
  if (params?.exchange) query.set('exchange', params.exchange)
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

/** Trigger a synchronous analysis run for selected symbols. */
export function runAnalysis(params: {
  symbols: string[]
  with_sentiment: boolean
}): Promise<{ analyzed: number; scores: Record<string, number> }> {
  return request('/analysis/run', { method: 'POST', body: JSON.stringify(params) })
}
