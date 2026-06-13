// chartTheme.ts — light/dark color palettes for lightweight-charts canvases,
// mirroring the CSS custom properties in index.css. Charts read colors
// directly from this map keyed by `scheme` instead of `getComputedStyle` on
// <html>, since that DOM read would race with the ThemeProvider effect that
// toggles the .dark/.light class (child effects run before parent effects).

import type { ColorScheme } from '../contexts/ThemeContext'

export interface ChartTheme {
  panel: string
  ink3: string
  edge: string
  edge2: string
  positive: string
  negative: string
  warning: string
  chartLine: string
}

const DARK: ChartTheme = {
  panel: '#0f172a',
  ink3: '#94a3b8',
  edge: '#1e293b',
  edge2: '#334155',
  positive: '#34d399',
  negative: '#f87171',
  warning: '#fbbf24',
  chartLine: '#38bdf8',
}

const LIGHT: ChartTheme = {
  panel: '#ffffff',
  ink3: '#64748b',
  edge: '#e2e8f0',
  edge2: '#cbd5e1',
  positive: '#059669',
  negative: '#dc2626',
  warning: '#d97706',
  chartLine: '#0284c7',
}

/** Resolve the chart color palette for a color scheme. */
export function chartTheme(scheme: ColorScheme): ChartTheme {
  return scheme === 'light' ? LIGHT : DARK
}
