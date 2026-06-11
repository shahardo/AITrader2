// test-setup.ts — Vitest global setup: registers jest-dom matchers and resets
// fetch mocks and storage between tests.

import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})
