// cssVar.ts — reads resolved CSS custom properties from <html> at runtime so
// canvas-based charts (lightweight-charts) can match the active light/dark +
// per-section accent theme defined in index.css.

/** Read a CSS custom property from the document root, with a fallback. */
export function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}
