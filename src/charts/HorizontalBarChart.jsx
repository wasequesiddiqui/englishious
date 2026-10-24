import { useMemo } from 'react'
import { formatMinutes } from '../format'
import PlotlyChart from './PlotlyChart'
import { baseLayout } from './layout'
import { useChartTheme } from './useChartTheme'

/**
 * HorizontalBarChart — ranked top-N chart used by Top Students and Top Subjects.
 * The first item in `items` (largest total) is drawn at the top.
 *
 * @param {object} props
 * @param {Array<[string, number]>} props.items - Sorted [label, minutes] pairs.
 * @param {Function} [props.label] - Formats a key (e.g. a month key).
 * @param {string} props.ariaLabel - Accessible chart description.
 * @param {number} [props.height] - Chart height in pixels.
 *
 * Example:
 *   <HorizontalBarChart items={[['SARA', 210], ['JOHN', 60]]} ariaLabel="Top students" />
 */
export default function HorizontalBarChart({ items, label, ariaLabel, height = 240 }) {
  const theme = useChartTheme()

  const data = useMemo(
    () => [
      {
        type: 'bar',
        orientation: 'h',
        y: items.map(([key]) => (label ? label(key) : key)),
        x: items.map(([, minutes]) => minutes),
        text: items.map(([, minutes]) => formatMinutes(minutes)),
        textposition: 'outside',
        cliponaxis: false,
        marker: { color: theme.bar },
        hovertemplate: '%{y}<br>%{text}<extra></extra>',
      },
    ],
    [items, label, theme.bar],
  )

  const layout = useMemo(
    () => ({
      ...baseLayout(theme),
      height,
      margin: { l: 8, r: 56, t: 34, b: 8 },
      xaxis: {
        showgrid: true,
        gridcolor: theme.grid,
        zeroline: false,
        showticklabels: false,
      },
      yaxis: {
        automargin: true,
        autorange: 'reversed',
        tickfont: { size: 12 },
      },
      bargap: 0.35,
    }),
    [height, theme],
  )

  return <PlotlyChart data={data} layout={layout} height={height} ariaLabel={ariaLabel} />
}
