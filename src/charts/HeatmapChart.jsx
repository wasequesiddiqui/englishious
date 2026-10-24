import { useMemo } from 'react'
import PlotlyChart from './PlotlyChart'
import { baseLayout } from './layout'
import { useChartTheme } from './useChartTheme'

/**
 * HeatmapChart — Plotly heatmap for the Matrix page.
 *
 * `z` drives the colours; `customdata` carries the formatted display values so
 * the tooltip can show "2h 30m" while Plotly scales on the raw number. Null
 * cells (no sessions for that combination) are left blank.
 *
 * @param {object} props
 * @param {string[]} props.x - Column labels (outermost → innermost joined).
 * @param {string[]} props.y - Row labels (outermost → innermost joined).
 * @param {Array<Array<number|null>>} props.z - Raw measure values per cell.
 * @param {Array<Array<string>>} props.customdata - Formatted values per cell.
 * @param {string} props.ariaLabel - Accessible chart description.
 * @param {number} [props.height] - Chart height in pixels.
 *
 * Example:
 *   <HeatmapChart x={['ENGLISH LITERATURE']} y={['SARA']} z={[[150]]}
 *     customdata={[['2h 30m']]} ariaLabel="Pivot heatmap" />
 */
export default function HeatmapChart({ x, y, z, customdata, ariaLabel, height = 320 }) {
  const theme = useChartTheme()

  const data = useMemo(
    () => [
      {
        type: 'heatmap',
        x,
        y,
        z,
        customdata,
        colorscale: [
          [0, theme.heatLow],
          [1, theme.heatHigh],
        ],
        showscale: false,
        xgap: 1,
        ygap: 1,
        hoverongaps: false,
        hovertemplate: '%{y}<br>%{x}<br>%{customdata}<extra></extra>',
      },
    ],
    [x, y, z, customdata, theme],
  )

  const layout = useMemo(
    () => ({
      ...baseLayout(theme),
      height,
      margin: { l: 8, r: 8, t: 34, b: 8 },
      xaxis: {
        automargin: true,
        tickangle: -35,
        tickfont: { size: 10 },
        showgrid: false,
      },
      yaxis: {
        automargin: true,
        autorange: 'reversed',
        tickfont: { size: 11 },
        showgrid: false,
      },
    }),
    [height, theme],
  )

  return <PlotlyChart data={data} layout={layout} height={height} ariaLabel={ariaLabel} />
}
