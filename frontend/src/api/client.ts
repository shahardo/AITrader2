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
