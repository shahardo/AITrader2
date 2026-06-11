// Login.test.tsx — tests for the login/signup page: successful login stores
// tokens and navigates; backend errors are surfaced to the user.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LoginPage from '../pages/Login'
import { getTokens } from '../api/client'

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/universe" element={<div>UNIVERSE PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const TOKENS = { access_token: 'a', refresh_token: 'r', token_type: 'bearer' }

describe('LoginPage', () => {
  it('logs in, stores tokens, and navigates to the universe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(TOKENS), { status: 200 }),
      ),
    )
    renderLogin()
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'longenough1')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    await waitFor(() => expect(screen.getByText('UNIVERSE PAGE')).toBeInTheDocument())
    expect(getTokens()?.access_token).toBe('a')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/v1/auth/login')
  })

  it('shows the backend error message on failed login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Invalid email or password' }), { status: 401 }),
      ),
    )
    renderLogin()
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'wrongwrong')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(getTokens()).toBeNull()
  })

  it('switches to signup mode and calls the signup endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(TOKENS), { status: 201 })),
    )
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: /create an account/i }))
    await userEvent.type(screen.getByLabelText(/email/i), 'new@b.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'longenough1')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/v1/auth/signup'),
    )
  })
})
