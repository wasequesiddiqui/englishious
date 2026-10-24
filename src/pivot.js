/**
 * pivot.js — pure pivot (matrix) engine for the session dataset.
 *
 * The Matrix tab lets the user filter the whole dataset, group it by any
 * combination of row/column dimensions, and aggregate the matching sessions.
 * Everything here is framework-free and synchronous so it can be reasoned
 * about (and tested) independently of React:
 *
 *   applyFilters(records, filters, 'all' | 'any')  → filtered sessions
 *   buildPivot(records, { rowDims, colDims, measure }) → grouped matrix
 *   pivotToCsv / pivotToTsv                        → export strings
 *
 * Example:
 *   const filtered = applyFilters(records, [{ field: 'student', op: 'is', value: 'Sara' }], 'all')
 *   const pivot = buildPivot(filtered, { rowDims: ['student'], colDims: ['subject'], measure: 'minutes' })
 *   pivot.rows[0].values   // ['Sara']
 *   pivot.cells.get(makeCellKey(pivot.rows[0].key, pivot.cols[0].key)) // { minutes, sessions }
 */
import { formatMinutes } from './format.js'

/* ---------- duration buckets ---------- */

/**
 * DURATION_BUCKETS
 * Fixed, ordered ranges used by the derived "Duration" dimension. The order of
 * this array is the sort order of the matrix (shortest first), so a pivot by
 * duration reads left-to-right / top-to-bottom from shortest to longest.
 *
 * Example: a 95-minute session falls in the "1h 30m – 2h" bucket.
 */
export const DURATION_BUCKETS = [
  { label: 'Under 30m', test: m => m < 30 },
  { label: '30m – 1h', test: m => m < 60 },
  { label: '1h – 1h 30m', test: m => m < 90 },
  { label: '1h 30m – 2h', test: m => m < 120 },
  { label: '2h and over', test: () => true },
]

/**
 * durationBucket(minutes)
 * Maps a raw minute count to one of the DURATION_BUCKETS labels. Anything
 * missing or non-numeric is treated as 0 minutes so a row never disappears.
 *
 * @param {number} minutes - Session length in minutes.
 * @returns {string} Bucket label, e.g. "1h – 1h 30m".
 *
 * Example: durationBucket(45) → "30m – 1h"
 */
export function durationBucket(minutes) {
  const m = Number(minutes) || 0
  return DURATION_BUCKETS.find(bucket => bucket.test(m)).label
}

// Index of a bucket label (used to sort the Duration dimension).
function bucketRank(label) {
  const index = DURATION_BUCKETS.findIndex(bucket => bucket.label === label)
  return index === -1 ? DURATION_BUCKETS.length : index
}

/* ---------- dimensions ---------- */

const blankLast = (a, b) => (a === '(blank)' ? 1 : 0) - (b === '(blank)' ? 1 : 0)

/**
 * DIMENSIONS
 * Every field the matrix can group or filter by. Each entry declares:
 *   id        – stable state value (used in rowDims / colDims / filters)
 *   label     – human-readable column header
 *   kind      – 'text' | 'date' | 'enum'; drives the filter value control
 *   get       – extracts the display value from a normalized session record
 *   compare   – deterministic sort for that value
 *   operators – filter operators offered for this dimension
 */
export const DIMENSIONS = [
  {
    id: 'student',
    label: 'Student',
    kind: 'text',
    get: r => String(r.student || '').trim() || '(blank)',
    compare: (a, b) => blankLast(a, b) || a.localeCompare(b, undefined, { sensitivity: 'base' }),
    operators: ['is', 'is not', 'contains', 'does not contain'],
  },
  {
    id: 'subject',
    label: 'Subject',
    kind: 'text',
    get: r => String(r.subject || '').trim() || '(blank)',
    compare: (a, b) => blankLast(a, b) || a.localeCompare(b, undefined, { sensitivity: 'base' }),
    operators: ['is', 'is not', 'contains', 'does not contain'],
  },
  {
    id: 'date',
    label: 'Date',
    kind: 'date',
    // ISO dates (YYYY-MM-DD) sort correctly as plain strings.
    get: r => String(r.date || '').trim() || '(blank)',
    compare: (a, b) => blankLast(a, b) || a.localeCompare(b),
    operators: ['on', 'before', 'after', 'between'],
  },
  {
    id: 'duration',
    label: 'Duration',
    kind: 'enum',
    get: r => durationBucket(r.minutes),
    compare: (a, b) => bucketRank(a) - bucketRank(b),
    operators: ['is', 'is not'],
  },
]

/** Lookup map: dimension id → definition (used by filters and builders). */
export const DIMENSION_MAP = Object.fromEntries(DIMENSIONS.map(dim => [dim.id, dim]))

/** Readable labels for every filter operator, keyed by operator id. */
export const OPERATOR_LABELS = {
  is: 'is',
  'is not': 'is not',
  contains: 'contains',
  'does not contain': 'does not contain',
  on: 'on',
  before: 'before',
  after: 'after',
  between: 'between',
}

/* ---------- measures ---------- */

/**
 * MEASURES
 * What the matrix cells show. Each entry declares:
 *   id    – value stored in component state
 *   label – full label used in the measure selector and exports
 *   value – reads the aggregate for that measure
 *   empty – text shown when a row/column combination has no sessions
 */
export const MEASURES = [
  {
    id: 'minutes',
    label: 'Sum of minutes',
    value: agg => agg.minutes,
    empty: '—',
  },
  {
    id: 'sessions',
    label: 'Session count',
    value: agg => agg.sessions,
    empty: '—',
  },
]

/** Lookup map: measure id → definition. */
export const MEASURE_MAP = Object.fromEntries(MEASURES.map(m => [m.id, m]))

/**
 * formatMeasureValue(agg, measureId)
 * Formats one aggregated cell for display. Missing aggregates render as the
 * measure's empty marker, sums render as "1h 30m", and counts use thousands
 * separators.
 *
 * @param {object|undefined} agg - { minutes, sessions } aggregate.
 * @param {string} measureId - 'minutes' or 'sessions'.
 * @returns {string} Display string for the cell.
 *
 * Example: formatMeasureValue({ minutes: 90, sessions: 2 }, 'minutes') → "1h 30m"
 */
export function formatMeasureValue(agg, measureId) {
  const measure = MEASURE_MAP[measureId] || MEASURES[0]
  if (!agg) return measure.empty
  const value = measure.value(agg)
  return measure.id === 'minutes' ? formatMinutes(value) : value.toLocaleString()
}

/**
 * measureValue(agg, measureId)
 * Raw numeric value used for heatmap scaling, CSV export, and totals.
 */
export function measureValue(agg, measureId) {
  const measure = MEASURE_MAP[measureId] || MEASURES[0]
  return agg ? measure.value(agg) : 0
}

/* ---------- filters ---------- */

/**
 * isFilterComplete(filter)
 * A filter row only participates once the user has picked a field, an operator,
 * and at least one value (two for "between"). Incomplete rows stay visible in
 * the UI but are ignored by the engine.
 */
export function isFilterComplete(filter) {
  if (!filter || !DIMENSION_MAP[filter.field] || !filter.op) return false
  if (filter.op === 'between') return Boolean(filter.value && filter.value2)
  return filter.value !== undefined && filter.value !== null && filter.value !== ''
}

// Evaluates one complete filter against a single session record.
function matchesFilter(record, filter) {
  const dim = DIMENSION_MAP[filter.field]
  const actual = dim.get(record)
  const actualLower = actual.toLowerCase()
  const value = String(filter.value ?? '')
  const valueLower = value.toLowerCase()

  switch (filter.op) {
    case 'is':
      return actualLower === valueLower
    case 'is not':
      return actualLower !== valueLower
    case 'contains':
      return actualLower.includes(valueLower)
    case 'does not contain':
      return !actualLower.includes(valueLower)
    case 'on':
      return actual === value
    case 'before':
      return actual !== '(blank)' && actual < value
    case 'after':
      return actual !== '(blank)' && actual > value
    case 'between':
      return actual !== '(blank)' && actual >= value && actual <= String(filter.value2 ?? '')
    default:
      return true
  }
}

/**
 * applyFilters(records, filters, mode)
 * Returns the sessions that satisfy the active filters. With mode 'all' every
 * complete filter must match (AND); with mode 'any' at least one must match
 * (OR). Incomplete filters are skipped, so an empty filter list returns the
 * original array untouched.
 *
 * @param {Array} records - Normalized session records.
 * @param {Array} filters - Filter rows ({ field, op, value, value2 }).
 * @param {'all'|'any'} mode - How to combine filters.
 * @returns {Array} Filtered records.
 *
 * Example: filter "student is Sara" + "subject contains Literature" with mode
 * 'all' keeps only Sara's literature sessions.
 */
export function applyFilters(records, filters, mode = 'all') {
  const active = (filters || []).filter(isFilterComplete)
  if (active.length === 0) return records
  return records.filter(record =>
    mode === 'any'
      ? active.some(filter => matchesFilter(record, filter))
      : active.every(filter => matchesFilter(record, filter)),
  )
}

/**
 * distinctValues(records, fieldId)
 * Every distinct display value for a dimension, in the dimension's own sort
 * order. Used to populate the value dropdown for text filters so users can
 * only pick values that actually exist in the dataset.
 *
 * Example: distinctValues(records, 'subject')
 *   → ['English General', 'English Language', 'English Literature']
 */
export function distinctValues(records, fieldId) {
  const dim = DIMENSION_MAP[fieldId]
  if (!dim) return []
  return [...new Set(records.map(dim.get))].sort(dim.compare)
}

/* ---------- matrix building ---------- */

/** Joins a row tuple key and a column tuple key into one cell-map key. */
export function makeCellKey(rowKey, colKey) {
  return `${rowKey}\u0000${colKey}`
}

// Compares two tuples using each dimension's comparator, left to right.
function compareTuples(a, b, dims) {
  for (let i = 0; i < dims.length; i++) {
    const result = dims[i].compare(a[i], b[i])
    if (result !== 0) return result
  }
  return 0
}

// True when the first `length` values of two tuples are identical.
function samePrefix(a, b, length) {
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function addAggregate(target, source) {
  target.minutes += source.minutes
  target.sessions += source.sessions
}

/**
 * buildPivot(records, options)
 * Groups the records into a row/column grid and aggregates each cell.
 *
 * Missing dimensions collapse to a single empty tuple, so:
 *   - no row dims    → one "All sessions" row
 *   - no column dims → one measure column
 *   - neither        → a single grand-total cell
 *
 * @param {Array} records - Records to aggregate (already filtered).
 * @param {object} options
 * @param {string[]} [options.rowDims] - Dimension ids used for rows, outermost first.
 * @param {string[]} [options.colDims] - Dimension ids used for columns, outermost first.
 * @param {string} [options.measure] - 'minutes' or 'sessions'.
 * @returns {object} Pivot result:
 *   {
 *     rowDimensions, colDimensions, measure,
 *     rows: [{ key, values, total }],   // sorted
 *     cols: [{ key, values, total }],   // sorted
 *     cells: Map<cellKey, { minutes, sessions }>,
 *     grand: { minutes, sessions },
 *     max: number,                      // biggest cell value (heatmap scale)
 *     recordCount: number,
 *   }
 *
 * Example: two Sara literature sessions (60 + 90 minutes) with
 *   rowDims = ['student'], colDims = ['subject'], measure = 'minutes'
 * yields cells.get(makeCellKey('["Sara"]', '["English Literature"]'))
 *   → { minutes: 150, sessions: 2 }
 */
export function buildPivot(records, { rowDims = [], colDims = [], measure = 'minutes' } = {}) {
  const rowDimensions = rowDims.map(id => DIMENSION_MAP[id]).filter(Boolean)
  const colDimensions = colDims.map(id => DIMENSION_MAP[id]).filter(Boolean)

  const rowValues = new Map()
  const colValues = new Map()
  const cells = new Map()
  const grand = { minutes: 0, sessions: 0 }

  for (const record of records) {
    const rowTuple = rowDimensions.map(dim => dim.get(record))
    const colTuple = colDimensions.map(dim => dim.get(record))
    const rowKey = JSON.stringify(rowTuple)
    const colKey = JSON.stringify(colTuple)

    if (!rowValues.has(rowKey)) rowValues.set(rowKey, rowTuple)
    if (!colValues.has(colKey)) colValues.set(colKey, colTuple)

    const key = makeCellKey(rowKey, colKey)
    const agg = cells.get(key) || { minutes: 0, sessions: 0 }
    agg.minutes += Number(record.minutes) || 0
    agg.sessions += 1
    cells.set(key, agg)

    grand.minutes += Number(record.minutes) || 0
    grand.sessions += 1
  }

  const toEntries = (valuesMap, dims) =>
    [...valuesMap.entries()]
      .map(([key, values]) => ({ key, values, total: { minutes: 0, sessions: 0 } }))
      .sort((a, b) => compareTuples(a.values, b.values, dims))

  const rows = toEntries(rowValues, rowDimensions)
  const cols = toEntries(colValues, colDimensions)
  const rowByKey = new Map(rows.map(row => [row.key, row]))
  const colByKey = new Map(cols.map(col => [col.key, col]))

  let max = 0
  for (const [key, agg] of cells) {
    const [rowKey, colKey] = key.split('\u0000')
    const row = rowByKey.get(rowKey)
    const col = colByKey.get(colKey)
    if (row) addAggregate(row.total, agg)
    if (col) addAggregate(col.total, agg)
    max = Math.max(max, measureValue(agg, measure))
  }

  return {
    rowDimensions,
    colDimensions,
    measure,
    rows,
    cols,
    cells,
    grand,
    max,
    recordCount: records.length,
  }
}

/* ---------- nested header layout ---------- */

/**
 * buildColumnHeaderLevels(cols, dimCount)
 * Builds one array per column dimension level. Each entry is a header group
 * with the number of leaf columns it spans, so the table can render multi-level
 * headers with colSpan (e.g. Student / Subject → "Sara" spans 3 subject cells).
 *
 * @param {Array} cols - Sorted column groups from buildPivot.
 * @param {number} dimCount - Number of column dimensions.
 * @returns {Array<Array<{ label: string, span: number }>>} One array per level.
 *
 * Example with cols [["Sara","Literature"],["Sara","Language"],["John","Literature"]]
 * and dimCount 2:
 *   [
 *     [{ label: 'Sara', span: 2 }, { label: 'John', span: 1 }],
 *     [{ label: 'Literature', span: 1 }, { label: 'Language', span: 1 }, { label: 'Literature', span: 1 }],
 *   ]
 */
export function buildColumnHeaderLevels(cols, dimCount) {
  const levels = []
  for (let level = 0; level < dimCount; level++) {
    const groups = []
    let start = 0
    while (start < cols.length) {
      let end = start + 1
      while (end < cols.length && samePrefix(cols[start].values, cols[end].values, level + 1)) end++
      groups.push({ label: cols[start].values[level], span: end - start })
      start = end
    }
    levels.push(groups)
  }
  return levels
}

/**
 * buildRowHeaderSpans(rows, dimCount)
 * Prepares row header cells with rowSpan values. The returned array is indexed
 * by row; each row holds one entry per row dimension, where the first row of a
 * group gets `{ label, span }` and the following rows get null (their cell is
 * covered by the rowSpan above).
 *
 * @param {Array} rows - Sorted row groups from buildPivot.
 * @param {number} dimCount - Number of row dimensions.
 * @returns {Array<Array<{ label: string, span: number }|null>>}
 */
export function buildRowHeaderSpans(rows, dimCount) {
  const headers = rows.map(() => Array(dimCount).fill(null))
  for (let level = 0; level < dimCount; level++) {
    let start = 0
    while (start < rows.length) {
      let end = start + 1
      while (end < rows.length && samePrefix(rows[start].values, rows[end].values, level + 1)) end++
      headers[start][level] = { label: rows[start].values[level], span: end - start }
      start = end
    }
  }
  return headers
}

/* ---------- exports ---------- */

// Quotes a cell when it contains the delimiter, quotes, or line breaks.
function escapeCell(value, delimiter) {
  const text = String(value ?? '')
  if (text.includes('"') || text.includes(delimiter) || /[\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/**
 * pivotToDelimited(pivot, options)
 * Flattens the pivot into a delimited text table: a header row with the row
 * dimension labels followed by one column per column group, one line per row
 * group, and an optional final totals line.
 *
 * @param {object} pivot - Result of buildPivot.
 * @param {object} [options]
 * @param {string} [options.delimiter] - ',' for CSV, '\t' for clipboard TSV.
 * @param {boolean} [options.totals] - Include the trailing totals row/column.
 * @param {Function} [options.formatValue] - Formats a cell aggregate; defaults to raw numbers.
 * @returns {string} The delimited text.
 */
export function pivotToDelimited(pivot, { delimiter = ',', totals = true, formatValue } = {}) {
  const measure = MEASURE_MAP[pivot.measure] || MEASURES[0]
  // Empty cells export as blanks, not zeroes, so a missing combination is
  // never mistaken for a real zero value.
  const format = formatValue || (agg => (agg ? measureValue(agg, measure.id) : ''))
  const rowLabels = pivot.rowDimensions.map(dim => dim.label)
  // With no row dimensions there is still one label column ("Sessions") so
  // every line keeps the same number of cells as the header.
  const labelCount = Math.max(rowLabels.length, 1)

  const header = rowLabels.length > 0 ? [...rowLabels] : ['Sessions']
  if (pivot.colDimensions.length > 0) {
    header.push(...pivot.cols.map(col => col.values.join(' / ')))
  } else {
    header.push(measure.label)
  }
  if (totals) header.push('Total')

  const lines = [header]

  for (const row of pivot.rows) {
    const line = row.values.length > 0 ? [...row.values] : ['All sessions']
    for (const col of pivot.cols) {
      line.push(format(pivot.cells.get(makeCellKey(row.key, col.key))))
    }
    if (totals) line.push(format(row.total))
    lines.push(line)
  }

  if (totals) {
    // The first label column holds "Total"; extra row-label columns stay blank.
    const line = Array.from({ length: labelCount }, (_, i) => (i === 0 ? 'Total' : ''))
    line.push(...pivot.cols.map(col => format(col.total)))
    line.push(format(pivot.grand))
    lines.push(line)
  }

  return lines
    .map(line => line.map(cell => escapeCell(cell, delimiter)).join(delimiter))
    .join('\n')
}

/**
 * pivotToCsv(pivot, options)
 * CSV export with raw numeric values (minutes stay minutes) so the file can be
 * analyzed in a spreadsheet.
 */
export function pivotToCsv(pivot, options = {}) {
  return pivotToDelimited(pivot, { delimiter: ',', ...options })
}

/**
 * pivotToTsv(pivot, options)
 * Tab-separated export using the same formatted labels shown on screen, ready
 * to paste into a document or spreadsheet.
 */
export function pivotToTsv(pivot, options = {}) {
  const formatValue = agg => formatMeasureValue(agg, pivot.measure)
  return pivotToDelimited(pivot, { delimiter: '\t', formatValue, ...options })
}
