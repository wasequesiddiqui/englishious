import { useEffect, useRef, useState } from 'react'
import { loadPlotly } from './loadPlotly'

/**
 * Shared Plotly config: responsive sizing, visible mode bar (zoom/download),
 * no Plotly logo, and no scroll-zoom hijacking of the page.
 */
const PLOTLY_CONFIG = {
  responsive: true,
  displayModeBar: true,
  displaylogo: false,
  scrollZoom: false,
  // Keep the toolbar local: never offer Plotly Cloud sharing/editing, and drop
  // selection tools that do nothing on these bar/heatmap figures.
  showSendToCloud: false,
  showEditInChartStudio: false,
  modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d', 'select2d'],
  toImageButtonOptions: { filename: 'englishious-chart', format: 'png', scale: 2 },
}

/**
 * PlotlyChart — loads Plotly on demand and renders one figure.
 *
 * @param {object} props
 * @param {Array<object>} props.data - Plotly trace array.
 * @param {object} props.layout - Plotly layout (should include `height`).
 * @param {number} [props.height] - Minimum height for the loading placeholder.
 * @param {string} props.ariaLabel - Accessible description of the chart.
 * @param {string} [props.className] - Extra class names for the chart element.
 *
 * Example:
 *   <PlotlyChart data={traces} layout={layout} height={240} ariaLabel="Top students" />
 */
export default function PlotlyChart({ data, layout, height = 240, ariaLabel, className = '' }) {
  const containerRef = useRef(null)
  const [status, setStatus] = useState('loading')

  // Load the vendor bundle once; StrictMode's double-mount reuses the promise.
  useEffect(() => {
    let cancelled = false
    loadPlotly()
      .then(() => {
        if (!cancelled) setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Draw/update the figure once Plotly is available.
  useEffect(() => {
    if (status !== 'ready') return undefined
    const node = containerRef.current
    const plotly = window.Plotly
    if (!node || !plotly) return undefined

    plotly.react(node, data, layout, PLOTLY_CONFIG)
    return () => {
      plotly.purge(node)
    }
  }, [status, data, layout])

  if (status === 'loading') {
    return (
      <div className="chart-placeholder" style={{ minHeight: height }} role="status">
        Loading chart…
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="chart-placeholder" style={{ minHeight: height }} role="status">
        Chart unavailable — could not load plotly.min.js.
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`plotly-chart ${className}`.trim()}
      style={{ width: '100%', minHeight: height }}
      role="img"
      aria-label={ariaLabel}
    />
  )
}
