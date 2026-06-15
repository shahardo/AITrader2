// apiErrors.ts — translates known backend HTTPException `detail` strings (always
// English) into the user's UI language via common:apiErrors. Unmapped backend
// messages fall back to the raw English text rather than breaking.

import { ApiError } from '../api/client'

const API_ERROR_KEYS: Record<string, string> = {
  'Portfolio not found': 'apiErrors.portfolioNotFound',
  'Portfolio has no strategy assigned — assign one in the Strategy Lab':
    'apiErrors.portfolioNoStrategy',
  'No universe scores yet — run an analysis first': 'apiErrors.noUniverseScores',
  'No pending initial proposal': 'apiErrors.noPendingProposal',
  'Unknown strategy': 'apiErrors.unknownStrategy',
  'Email already registered': 'apiErrors.emailAlreadyRegistered',
  'Invalid email or password': 'apiErrors.invalidCredentials',
  'Could not start evolution — task queue unavailable. Make sure Redis and the Celery worker are running.':
    'apiErrors.taskQueueUnavailable',
}

/** Render an API (or other) error for display, translated when recognized. */
export function translateApiError(
  error: unknown,
  t: (key: string) => string,
  fallback: string,
): string {
  if (!(error instanceof ApiError)) return fallback
  const key = API_ERROR_KEYS[error.message]
  return key ? t(`common:${key}`) : error.message
}
