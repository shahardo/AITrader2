// client.test.ts — tests for the API client's 401-refresh-retry flow: an expired
// access token transparently refreshes once and retries, falling back to a
// logout signal (AUTH_EXPIRED_EVENT) when the refresh token is also invalid.

import { describe, expect, it, vi } from 'vitest'
import {
  AUTH_EXPIRED_EVENT,
  ApiError,
  getInstrument,
  getTokens,
  storeTokens,
} from '../api/client'

const OLD_TOKENS = { access_token: 'old-access', refresh_token: 'old-refresh', token_type: 'bearer' }
const NEW_TOKENS = { access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'bearer' }

describe('api client 401 handling', () => {
  it('refreshes the token pair and retries once on a 401', async () => {
    storeTokens(OLD_TOKENS)
    const mock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/auth/refresh')
        return Promise.resolve(new Response(JSON.stringify(NEW_TOKENS), { status: 200 }))
      if (url.startsWith('/api/v1/instruments/')) {
        const auth = (init?.headers as Record<string, string>)['Authorization']
        if (auth === 'Bearer old-access')
          return Promise.resolve(new Response(JSON.stringify({ detail: 'Invalid or expired token' }), { status: 401 }))
        return Promise.resolve(
          new Response(JSON.stringify({ id: 1, symbol: 'AAPL', name: 'Apple', exchange: 'us', sector: null, currency: 'USD', universe_source: 'sp500', last_close: 1, last_date: '2026-01-01', bar_count: 1, bars: [] }), { status: 200 }),
        )
      }
      return Promise.reject(new Error(`unexpected url ${url}`))
    })
    vi.stubGlobal('fetch', mock)

    const result = await getInstrument('AAPL')

    expect(result.symbol).toBe('AAPL')
    expect(getTokens()?.access_token).toBe('new-access')
    expect(mock.mock.calls.filter(([url]) => url.startsWith('/api/v1/instruments/'))).toHaveLength(2)
  })

  it('clears tokens and fires AUTH_EXPIRED_EVENT when the refresh token is also invalid', async () => {
    storeTokens(OLD_TOKENS)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === '/api/v1/auth/refresh')
          return Promise.resolve(new Response(JSON.stringify({ detail: 'Invalid refresh token' }), { status: 401 }))
        return Promise.resolve(new Response(JSON.stringify({ detail: 'Invalid or expired token' }), { status: 401 }))
      }),
    )
    const onExpired = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)

    await expect(getInstrument('AAPL')).rejects.toThrow(ApiError)

    expect(getTokens()).toBeNull()
    expect(onExpired).toHaveBeenCalledTimes(1)
    window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  })
})
