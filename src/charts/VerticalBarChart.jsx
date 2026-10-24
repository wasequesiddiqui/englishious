import { useMemo } from 'react'
import { formatMinutes } from '../format'
import PlotlyChart from './PlotlyChart'
import { baseLayout } from './layout'
import { useChartTheme } from './useChartTheme'

/**
 * VerticalBarChart — category bar chart used by the Monthly Breakdown.
 *
 * @param {object} props
 * @param {Array<[string, number]>} props.items - [key, minutes] pairs.
 * @param {Function} [props.label] - Short label formatter for the x axis.
 * @param {Function} [props.hoverLabel] - Full label formatter for the tooltip.
 * @param {string} props.ariaLabel - Accessible chart description.
 * @param {number} [props.height] - Chart height in pixels.
 *
 * Example:
 *   <VerticalBarChart items={[['2026-08', 480]]} label={monthShortLabel} ariaLabel="Monthly breakdown" />
 */
export default function VerticalBarChart({
  items,
  label,
  hoverLabel,
  ariaLabel,
  height = 240,
}) {
  const theme = useChartTheme()

  const data = useMemo(
    () => [
      {
        type: 'bar',
        x: items.map(([key]) => (label ? label(key) : key)),
        y: items.map(([, minutes]) => minutes),
        customdata: items.map(([key]) => {
          const formatHover = hoverLabel || label
          return formatHover ? formatHover(key) : key
        }),
        text: items.map(([, minutes]) => formatMinutes(minutes)),
        textposition: 'outside',
        cliponaxis: false,
        marker: { color: theme.bar },
        hovertemplate: '%{customdata}<br>%{text}<extra></extra>',
      },
    ],
    [items, label, hoverLabel, theme.bar],
  )

  const layout = useMemo(
    () => ({
      ...baseLayout(theme),
      height,
      margin: { l: 8, r: 8, t: 34, b: 36 },
      xaxis: {
        type: 'category',
        showgrid: false,
        automargin: true,
        tickfont: { size: 10 },
      },
      yaxis: {
        showgrid: true,
        gridcolor: theme.grid,
        zeroline: false,
        showticklabels: false,
      },
      bargap: 0.45,
    }),
    [height, theme],
  )

  return <PlotlyChart data={data} layout={layout} height={height} ariaLabel={ariaLabel} />
}
