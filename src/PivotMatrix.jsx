import { useEffect, useMemo, useState } from 'react'
import {
  DIMENSIONS,
  DIMENSION_MAP,
  MEASURES,
  MEASURE_MAP,
  OPERATOR_LABELS,
  applyFilters,
  buildColumnHeaderLevels,
  buildPivot,
  buildRowHeaderSpans,
  distinctValues,
  formatMeasureValue,
  isFilterComplete,
  makeCellKey,
  measureValue,
  pivotToCsv,
  pivotToTsv,
} from './pivot'
import HeatmapChart from './charts/HeatmapChart'

// Maximum dimensions per axis keeps nested headers readable (four exist total).
const MAX_DIMS = 3

// A brand-new, incomplete filter row. Incomplete rows are shown but ignored
// until a value is chosen, which keeps the filter builder keyboard-friendly.
function newFilter() {
  return {
    id: crypto.randomUUID(),
    field: 'student',
    op: DIMENSION_MAP.student.operators[0],
    value: '',
    value2: '',
  }
}

/**
 * FilterValueControl — renders the value input(s) for one filter row.
 * Text and duration dimensions get a dropdown of values that actually exist in
 * the dataset; date dimensions get native date pickers (two for "between").
 */
function FilterValueControl({ filter, values, onChange }) {
  const dim = DIMENSION_MAP[filter.field]

  if (dim.kind === 'date') {
    return (
      <>
        <input
          type="date"
          aria-label="Filter date"
          value={filter.value}
          onChange={e => onChange({ value: e.target.value })}
        />
        {filter.op === 'between' && (
          <>
            <span className="pivot-filter-sep" aria-hidden="true">
              and
            </span>
            <input
              type="date"
              aria-label="Filter end date"
              value={filter.value2}
              onChange={e => onChange({ value2: e.target.value })}
            />
          </>
        )}
      </>
    )
  }

  return (
    <select
      aria-label={`Filter value for ${dim.label}`}
      value={filter.value}
      onChange={e => onChange({ value: e.target.value })}
    >
      <option value="">Select value…</option>
      {values.map(value => (
        <option key={value} value={value}>
          {value}
        </option>
      ))}
    </select>
  )
}

/**
 * FilterRow — one field / operator / value triplet in the filter builder.
 * Changing the field resets the operator and value so the row is always valid.
 */
function FilterRow({ filter, records, onChange, onRemove }) {
  const dim = DIMENSION_MAP[filter.field]
  const values = useMemo(
    () => (dim.kind === 'date' ? [] : distinctValues(records, filter.field)),
    [records, filter.field, dim.kind],
  )
  const complete = isFilterComplete(filter)

  function handleFieldChange(field) {
    onChange({
      field,
      op: DIMENSION_MAP[field].operators[0],
      value: '',
      value2: '',
    })
  }

  return (
    <div className={`pivot-filter-row${complete ? '' : ' pivot-filter-incomplete'}`}>
      <select aria-label="Filter field" value={filter.field} onChange={e => handleFieldChange(e.target.value)}>
        {DIMENSIONS.map(dimension => (
          <option key={dimension.id} value={dimension.id}>
            {dimension.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter operator"
        value={filter.op}
        onChange={e => onChange({ op: e.target.value, value: '', value2: '' })}
      >
        {dim.operators.map(op => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>
      <div className="pivot-filter-value">
        <FilterValueControl filter={filter} values={values} onChange={onChange} />
      </div>
      <button
        type="button"
        className="icon-btn danger"
        title="Remove filter"
        aria-label="Remove filter"
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  )
}

/**
 * AxisBuilder — a row or column field list.
 * Fields are added one at a time, can be reordered with ▲/▼ (order defines the
 * nesting of headers), and removed with ✕. A dimension can only appear once per
 * axis, and each axis holds at most MAX_DIMS fields.
 */
function AxisBuilder({ title, hint, dims, onChange }) {
  const available = DIMENSIONS.filter(dimension => !dims.includes(dimension.id))
  const canAdd = available.length > 0 && dims.length < MAX_DIMS

  function move(id, delta) {
    const index = dims.indexOf(id)
    const next = [...dims]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    onChange(next)
  }

  return (
    <div className="pivot-axis">
      <div className="pivot-axis-head">
        <h3>{title}</h3>
        <span className="pivot-axis-count">
          {dims.length}/{MAX_DIMS}
        </span>
      </div>
      <p className="pivot-axis-hint">{hint}</p>
      <ul className="pivot-chips">
        {dims.length === 0 && <li className="pivot-chip-empty">No fields — shows a single total.</li>}
        {dims.map((id, index) => (
          <li key={id} className="pivot-chip">
            <span className="pivot-chip-label">{DIMENSION_MAP[id].label}</span>
            <button
              type="button"
              aria-label={`Move ${DIMENSION_MAP[id].label} up`}
              title="Move up"
              disabled={index === 0}
              onClick={() => move(id, -1)}
            >
              ▲
            </button>
            <button
              type="button"
              aria-label={`Move ${DIMENSION_MAP[id].label} down`}
              title="Move down"
              disabled={index === dims.length - 1}
              onClick={() => move(id, 1)}
            >
              ▼
            </button>
            <button
              type="button"
              aria-label={`Remove ${DIMENSION_MAP[id].label}`}
              title="Remove field"
              onClick={() => onChange(dims.filter(dimensionId => dimensionId !== id))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <select
        aria-label={`Add ${title.toLowerCase()} field`}
        value=""
        disabled={!canAdd}
        onChange={e => {
          if (e.target.value) onChange([...dims, e.target.value])
        }}
      >
        <option value="">
          {dims.length >= MAX_DIMS ? 'Maximum fields added' : canAdd ? '+ Add field…' : 'All fields added'}
        </option>
        {available.map(dimension => (
          <option key={dimension.id} value={dimension.id}>
            {dimension.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * PivotMatrix — the Matrix (pivot) analysis page.
 *
 * Filters and grouping are applied live to the sessions already loaded from
 * Google Sheets. The result is a nested pivot table with optional row/column
 * totals, heatmap shading, CSV export, and clipboard copy.
 *
 * @param {object} props
 * @param {Array} props.records - Normalized session records from Google Sheets.
 * @param {boolean} props.loading - True while the records fetch is in flight.
 * @param {string} props.error - Fetch error message ('' when none).
 * @param {Function} props.onRefresh - Re-runs the Google Sheets fetch.
 */
export default function PivotMatrix({ records, loading, error, onRefresh }) {
  const [filters, setFilters] = useState([])
  const [matchMode, setMatchMode] = useState('all')
  const [rowDims, setRowDims] = useState(['student'])
  const [colDims, setColDims] = useState(['subject'])
  const [measure, setMeasure] = useState('minutes')
  const [showTotals, setShowTotals] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(true)
  // Result presentation: the detailed table or a Plotly heatmap of cell values.
  const [view, setView] = useState('table')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')

  const filtered = useMemo(() => applyFilters(records, filters, matchMode), [records, filters, matchMode])
  const pivot = useMemo(
    () => buildPivot(filtered, { rowDims, colDims, measure }),
    [filtered, rowDims, colDims, measure],
  )
  const columnLevels = useMemo(() => buildColumnHeaderLevels(pivot.cols, colDims.length), [pivot, colDims.length])
  const rowHeaders = useMemo(() => buildRowHeaderSpans(pivot.rows, rowDims.length), [pivot, rowDims.length])

  // Heatmap data: raw values scale the colors, formatted strings feed tooltips.
  // Totals are intentionally excluded — they live in the Table view.
  const heatmap = useMemo(() => {
    const rowLabels = pivot.rows.map(row => row.values.join(' / '))
    const colLabels = pivot.cols.map(col => col.values.join(' / '))
    const z = []
    const customdata = []
    for (const row of pivot.rows) {
      const zRow = []
      const formattedRow = []
      for (const col of pivot.cols) {
        const agg = pivot.cells.get(makeCellKey(row.key, col.key))
        zRow.push(agg ? measureValue(agg, measure) : null)
        formattedRow.push(formatMeasureValue(agg, measure))
      }
      z.push(zRow)
      customdata.push(formattedRow)
    }
    return { rowLabels, colLabels, z, customdata }
  }, [pivot, measure])

  const heatmapHeight = Math.max(280, Math.min(560, pivot.rows.length * 28 + 96))

  const activeFilters = filters.filter(isFilterComplete)
  const ignoredFilters = filters.length - activeFilters.length
  // Totals add a column/row only when they say something new.
  const showTotalColumn = showTotals && pivot.cols.length > 1
  const showTotalRow = showTotals && pivot.rows.length > 1
  const withTotalsInExport = showTotalColumn || showTotalRow
  const hasResult = filtered.length > 0

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  function updateFilter(id, patch) {
    setFilters(current => current.map(filter => (filter.id === id ? { ...filter, ...patch } : filter)))
  }

  // Heatmap intensity is relative to the largest cell for the active measure.
  function heatmapStyle(agg) {
    if (!showHeatmap || !agg || pivot.max <= 0) return undefined
    const ratio = measureValue(agg, measure) / pivot.max
    const percent = Math.round(6 + ratio * 44)
    return { backgroundColor: `color-mix(in srgb, var(--primary) ${percent}%, transparent)` }
  }

  async function handleCopy() {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(pivotToTsv(pivot, { totals: withTotalsInExport }))
      setCopied(true)
    } catch {
      setCopyError('Could not copy to the clipboard — your browser blocked clipboard access.')
    }
  }

  function handleExportCsv() {
    const csv = pivotToCsv(pivot, { totals: withTotalsInExport })
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `matrix-${new Date().toISOString().slice(0, 10)}.csv`
    // The anchor must be in the document for some browsers to start the download.
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="pivot">
      {/* ---- Configuration ---- */}
      <div className="card pivot-config">
        <div className="pivot-config-head">
          <div>
            <h2>🧮 Matrix Analysis</h2>
            <p className="muted">
              Filter the dataset, group it by any fields, and aggregate the matching sessions.
            </p>
          </div>
          <button className="btn btn-outline btn-sm" type="button" onClick={onRefresh} disabled={loading}>
            🔄 Refresh
          </button>
        </div>

        {/* ---- Filter builder ---- */}
        <div className="pivot-filters">
          <div className="pivot-section-head">
            <h3>Filters</h3>
            <div className="pivot-mode" role="group" aria-label="Filter match mode">
              <button
                type="button"
                className={matchMode === 'all' ? 'active' : ''}
                aria-pressed={matchMode === 'all'}
                onClick={() => setMatchMode('all')}
              >
                Match all
              </button>
              <button
                type="button"
                className={matchMode === 'any' ? 'active' : ''}
                aria-pressed={matchMode === 'any'}
                onClick={() => setMatchMode('any')}
              >
                Match any
              </button>
            </div>
            <span className="pivot-count">
              {filtered.length} of {records.length} sessions
            </span>
            <span className="pivot-section-spacer" />
            {filters.length > 0 && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setFilters([])}
                disabled={filters.length === 0}
              >
                Clear filters
              </button>
            )}
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setFilters([...filters, newFilter()])}>
              + Add filter
            </button>
          </div>

          {filters.length === 0 ? (
            <p className="pivot-hint">No filters — the full dataset is used.</p>
          ) : (
            <div className="pivot-filter-list">
              {filters.map(filter => (
                <FilterRow
                  key={filter.id}
                  filter={filter}
                  records={records}
                  onChange={patch => updateFilter(filter.id, patch)}
                  onRemove={() => setFilters(current => current.filter(item => item.id !== filter.id))}
                />
              ))}
            </div>
          )}

          {ignoredFilters > 0 && (
            <p className="pivot-hint">
              {ignoredFilters} filter{ignoredFilters === 1 ? '' : 's'} waiting for a value — ignored until then.
            </p>
          )}
        </div>

        {/* ---- Rows / columns / measure ---- */}
        <div className="pivot-axes">
          <AxisBuilder
            title="Rows"
            hint="Outermost first. Use ▲▼ to change the nesting."
            dims={rowDims}
            onChange={setRowDims}
          />
          <AxisBuilder
            title="Columns"
            hint="Outermost first. Use ▲▼ to change the nesting."
            dims={colDims}
            onChange={setColDims}
          />
          <div className="pivot-options">
            <div className="field">
              <label htmlFor="pivot-measure">Measure</label>
              <select id="pivot-measure" value={measure} onChange={e => setMeasure(e.target.value)}>
                {MEASURES.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="pivot-check">
              <input type="checkbox" checked={showTotals} onChange={e => setShowTotals(e.target.checked)} />
              Show totals
            </label>
            <label className="pivot-check">
              <input type="checkbox" checked={showHeatmap} onChange={e => setShowHeatmap(e.target.checked)} />
              Shade table cells
            </label>
          </div>
        </div>
      </div>

      {/* ---- Result ---- */}
      <div className="card pivot-result">
        <div className="pivot-result-head">
          <div>
            <h2>Result</h2>
            <p className="muted">
              {hasResult
                ? `${pivot.recordCount} session${pivot.recordCount === 1 ? '' : 's'} · ${rowDims.length} row field${
                    rowDims.length === 1 ? '' : 's'
                  } · ${colDims.length} column field${colDims.length === 1 ? '' : 's'} · ${
                    MEASURE_MAP[measure].label
                  }`
                : 'Adjust the filters or grouping to build a matrix.'}
            </p>
          </div>
          <div className="pivot-actions">
            {hasResult && (
              <div className="pivot-mode" role="group" aria-label="Matrix view">
                <button
                  type="button"
                  className={view === 'table' ? 'active' : ''}
                  aria-pressed={view === 'table'}
                  onClick={() => setView('table')}
                >
                  Table
                </button>
                <button
                  type="button"
                  className={view === 'heatmap' ? 'active' : ''}
                  aria-pressed={view === 'heatmap'}
                  onClick={() => setView('heatmap')}
                >
                  Heatmap
                </button>
              </div>
            )}
            <button type="button" className="btn btn-outline btn-sm" onClick={handleExportCsv} disabled={!hasResult}>
              ⬇ Export CSV
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={handleCopy} disabled={!hasResult}>
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>
        </div>

        {copyError && (
          <p className="records-error" role="alert">
            ⚠ {copyError}
          </p>
        )}

        {loading && records.length === 0 ? (
          <div className="empty">
            <span className="empty-icon" aria-hidden="true">
              ⏳
            </span>
            <p>Loading records from Google Sheets…</p>
          </div>
        ) : error && records.length === 0 ? (
          <div className="empty">
            <span className="empty-icon" aria-hidden="true">
              ⚠️
            </span>
            <p>Couldn’t load records from Google Sheets. Use 🔄 Refresh to try again.</p>
          </div>
        ) : records.length === 0 ? (
          <div className="empty">
            <span className="empty-icon" aria-hidden="true">
              📭
            </span>
            <p>No records found in Google Sheets yet.</p>
          </div>
        ) : !hasResult ? (
          <div className="empty">
            <span className="empty-icon" aria-hidden="true">
              🔍
            </span>
            <p>No sessions match the current filters.</p>
          </div>
        ) : view === 'heatmap' ? (
          rowDims.length === 0 || colDims.length === 0 ? (
            <div className="empty">
              <span className="empty-icon" aria-hidden="true">
                🗺️
              </span>
              <p>Add at least one row field and one column field to view the heatmap.</p>
            </div>
          ) : (
            <div className="pivot-heatmap">
              <HeatmapChart
                x={heatmap.colLabels}
                y={heatmap.rowLabels}
                z={heatmap.z}
                customdata={heatmap.customdata}
                ariaLabel={`Heatmap of ${MEASURE_MAP[measure].label} by row and column fields`}
                height={heatmapHeight}
              />
              <p className="pivot-hint">Totals are available in the Table view.</p>
            </div>
          )
        ) : (
          <div className="table-wrap matrix-wrap">
            <table className="matrix-table">
              <thead>
                {columnLevels.length === 0 ? (
                  <tr>
                    <th className="matrix-corner" scope="col" colSpan={Math.max(rowDims.length, 1)}>
                      {rowDims.length === 0 ? '' : rowDims.map(id => DIMENSION_MAP[id].label).join(' / ')}
                    </th>
                    <th scope="col" className="matrix-value-head">
                      {MEASURE_MAP[measure].label}
                    </th>
                    {showTotalColumn && (
                      <th scope="col" className="matrix-total-head">
                        Total
                      </th>
                    )}
                  </tr>
                ) : (
                  columnLevels.map((groups, level) => (
                    <tr key={level}>
                      {level === 0 && (
                        <th
                          className="matrix-corner"
                          scope="col"
                          rowSpan={columnLevels.length}
                          colSpan={Math.max(rowDims.length, 1)}
                        >
                          <span className="matrix-corner-label">
                            {rowDims.length ? rowDims.map(id => DIMENSION_MAP[id].label).join(' / ') : 'All sessions'}
                          </span>
                        </th>
                      )}
                      {groups.map((group, index) => (
                        <th
                          key={`${level}-${index}-${group.label}`}
                          scope="colgroup"
                          colSpan={group.span}
                          className={level === columnLevels.length - 1 ? 'matrix-leaf-head' : ''}
                        >
                          {group.label}
                        </th>
                      ))}
                      {level === 0 && showTotalColumn && (
                        <th scope="col" className="matrix-total-head" rowSpan={columnLevels.length}>
                          Total
                        </th>
                      )}
                    </tr>
                  ))
                )}
              </thead>

              <tbody>
                {pivot.rows.map((row, rowIndex) => (
                  <tr key={row.key}>
                    {rowDims.length === 0 && (
                      <th scope="row" className="matrix-row-head matrix-row-head-sticky">
                        All sessions
                      </th>
                    )}
                    {rowHeaders[rowIndex].map(
                      (header, level) =>
                        header && (
                          <th
                            key={`${row.key}-${level}`}
                            scope="rowgroup"
                            rowSpan={header.span}
                            title={header.label}
                            className={`matrix-row-head${level === 0 ? ' matrix-row-head-sticky' : ''}`}
                          >
                            {header.label}
                          </th>
                        ),
                    )}
                    {pivot.cols.map(col => {
                      const agg = pivot.cells.get(makeCellKey(row.key, col.key))
                      return (
                        <td
                          key={col.key}
                          className={`matrix-cell${agg ? '' : ' matrix-cell-empty'}`}
                          style={heatmapStyle(agg)}
                        >
                          {formatMeasureValue(agg, measure)}
                        </td>
                      )
                    })}
                    {showTotalColumn && (
                      <td className="matrix-cell matrix-total">{formatMeasureValue(row.total, measure)}</td>
                    )}
                  </tr>
                ))}
              </tbody>

              {showTotalRow && (
                <tfoot>
                  <tr>
                    <th className="matrix-row-head matrix-total-head" scope="row" colSpan={Math.max(rowDims.length, 1)}>
                      Total
                    </th>
                    {pivot.cols.map(col => (
                      <td key={col.key} className="matrix-cell matrix-total">
                        {formatMeasureValue(col.total, measure)}
                      </td>
                    ))}
                    {showTotalColumn && (
                      <td className="matrix-cell matrix-total matrix-grand">{formatMeasureValue(pivot.grand, measure)}</td>
                    )}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
