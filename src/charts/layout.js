/** Font stack used by every Plotly chart (matches the app's CSS). */
export const CHART_FONT = "system-ui, 'Segoe UI', Roboto, sans-serif"

/**
 * baseLayout(theme)
 * Shared Plotly layout values: transparent backgrounds, themed font and hover
 * tooltip, and no legend (every figure here is a single trace).
 *
 * @param {object} theme - Palette returned by useChartTheme().
 * @returns {object} Partial Plotly layout to spread into a chart's layout.
 */
export function baseLayout(theme) {
  return {
    paper_bgcolor: 'rgba(0, 0, 0, 0)',
    plot_bgcolor: 'rgba(0, 0, 0, 0)',
    font: { family: CHART_FONT, size: 12, color: theme.text },
    hoverlabel: {
      bgcolor: theme.hoverBg,
      bordercolor: theme.grid,
      font: { family: CHART_FONT, size: 12, color: theme.hoverText },
    },
    showlegend: false,
    modebar: {
      bgcolor: 'rgba(0, 0, 0, 0)',
      color: theme.muted,
      activecolor: theme.text,
    },
  }
}
