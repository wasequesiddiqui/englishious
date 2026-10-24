import { useEffect, useMemo, useState } from 'react'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Palettes mirror the CSS custom properties in src/index.css. Plotly renders to
 * canvas/SVG, so it cannot read CSS variables directly — these values must stay
 * in sync with the light and dark themes.
 */
const PALETTES = {
  light: {
    text: '#1f2430',
    muted: '#6b7280',
    grid: '#e2e6f0',
    bar: '#6366f1',
    hoverBg: '#ffffff',
    hoverText: '#1f2430',
    heatLow: 'rgba(99, 102, 241, 0.06)',
    heatHigh: '#4f46e5',
  },
  dark: {
    text: '#e7e9f1',
    muted: '#9aa0b3',
    grid: '#2a2f3f',
    bar: '#818cf8',
    hoverBg: '#181b26',
    hoverText: '#e7e9f1',
    heatLow: 'rgba(129, 140, 248, 0.08)',
    heatHigh: '#6366f1',
  },
}

/**
 * useChartTheme()
 * Returns the current chart palette and re-renders when the OS color scheme
 * changes, so Plotly charts follow the app's light/dark theme.
 *
 * Example return value (light): { dark: false, text: '#1f2430', bar: '#6366f1', … }
 */
export function useChartTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(DARK_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const query = window.matchMedia(DARK_QUERY)
    const handleChange = event => setDark(event.matches)
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  return useMemo(() => ({ dark, ...PALETTES[dark ? 'dark' : 'light'] }), [dark])
}
