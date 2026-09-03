// React Hooks used throughout the app:
// - useState: holds component state (records, form fields, UI flags, etc.).
//   Each call returns [value, setValue]; calling setValue re-renders the
//   component with the new value. Example: const [records, setRecords] = useState([])
// - useEffect: runs side effects (fetching data from Google Sheets, etc.)
//   AFTER a render. The dependency array at the end controls when it re-runs.
//   Example: useEffect(() => { ... }, [recordsRefresh]) re-runs only when the
//   refresh counter changes.
// - useMemo: caches expensive computed values so they are only recalculated
//   when the listed dependencies change. Example:
//   const totals = useMemo(() => ..., [records])
import { useEffect, useMemo, useState } from 'react'

// Global stylesheet (layout, cards, bars, buttons, form fields, etc.).
import './App.css'
// App logo shown in the header (bundled by Vite from src/assets).
import logo from './assets/Logo.png'

// ---------- Module-level constants ----------

/**
 * SHEETS_WEB_APP_URL
 * The public endpoint of the Google Apps Script Web App that appends rows to
 * a Google Sheet. A POST to this URL sends a JSON payload; the script's
 * doPost(e) handler reads it and writes one row per request.
 *
 * This same URL is used for every sheet interaction:
 *   - POST with a JSON body  → add / delete a row (postToSheets, deleteFromSheets)
 *   - GET  ?action=list      → fetch all records (fetchFromSheets)
 *   - GET  ?action=students  → fetch the student names (fetchStudentsFromSheets)
 */
const SHEETS_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbyp3v3s2fBYEulh658bO0PIMj8tE25ZSbkynA-ndMh8kRffGdKBBsJQLF-gZLT6RLz0/exec'

/**
 * SUBJECTS
 * The complete, fixed list of allowed subjects. Rendered into a <select>
 * dropdown so only these options can be chosen (no free-text entry).
 */
const SUBJECTS = ['English Literature', 'English Language', 'English General']

/* ---------- helpers ---------- */

/**
 * toISODate(d)
 * Formats a Date object as an ISO-style calendar date string (YYYY-MM-DD).
 * This is the storage format used for session dates so they sort correctly
 * lexicographically and work with <input type="date">.
 *
 * @param {Date} d - The date to format. Defaults to the current date/time.
 * @returns {string} Date string like "2026-08-10".
 *
 * Examples:
 *   toISODate(new Date(2026, 7, 29)) → "2026-08-29"  (month is 0-indexed)
 *   toISODate()                      → "2026-08-29"  (today)
 */
function toISODate(d = new Date()) {
  const y = d.getFullYear()
  // getMonth() is 0-indexed, so add 1 to get the real month number.
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * emptyForm()
 * Returns a fresh, blank form state object. Calling this (rather than
 * inlining an object literal) guarantees every field always has the same
 * initial shape and the date defaults to today.
 *
 * @returns {object} Empty form with student, subject, date, start, end, notes.
 *
 * Example return value (date = today):
 *   { student: '', subject: '', date: '2026-08-29', start: '', end: '', notes: '' }
 * Used to initialise the form and to reset it after every save.
 */
function emptyForm() {
  return { student: '', subject: '', date: toISODate(), start: '', end: '', notes: '' }
}

/**
 * calcMinutes(start, end)
 * Computes the number of minutes between two "HH:MM" time strings. Correctly
 * handles sessions that cross midnight (e.g. 22:30 → 01:00) by adding 24
 * hours when the end time is numerically earlier than the start time.
 *
 * @param {string} start - Start time in 24h "HH:MM" format.
 * @param {string} end - End time in 24h "HH:MM" format.
 * @returns {number} Duration in whole minutes (0 if either time is missing).
 *
 * Examples:
 *   calcMinutes('10:00', '11:30') → 90   (a normal 1h 30m session)
 *   calcMinutes('22:30', '01:00') → 150  (crosses midnight → wraps +24h)
 *   calcMinutes('', '10:00')      → 0    (missing start time)
 */
function calcMinutes(start, end) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = eh * 60 + em - (sh * 60 + sm)
  // Negative result means the session wrapped past midnight, so add a full day.
  if (mins < 0) mins += 24 * 60
  return mins
}

/**
 * addMinutesToTime(time, mins)
 * Adds a number of minutes to an "HH:MM" time string and returns the result as
 * another "HH:MM" string. Wraps past midnight (e.g. 23:30 + 60 → 00:30) so the
 * value always stays within one day. Returns '' when the input is missing or
 * not a valid "HH:MM" time.
 *
 * @param {string} time - Start time in 24h "HH:MM" format.
 * @param {number} mins - Minutes to add (e.g. 60 for one hour).
 * @returns {string} Resulting "HH:MM" time string (or '' if time is invalid).
 *
 * Examples:
 *   addMinutesToTime('10:00', 60) → '11:00'   (one hour later)
 *   addMinutesToTime('23:30', 60) → '00:30'   (wraps past midnight)
 *   addMinutesToTime('', 60)      → ''        (missing start time)
 * Used by handleStartChange() to pre-fill the End time with a sensible default.
 */
function addMinutesToTime(time, mins) {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ''
  // Add the minutes, then keep the total within 0…1439 (one full day).
  const total = (h * 60 + m + mins) % (24 * 60)
  const nh = String(Math.floor(total / 60)).padStart(2, '0')
  const nm = String(total % 60).padStart(2, '0')
  return `${nh}:${nm}`
}

/**
 * formatMinutes(mins)
 * Converts a number of minutes into a compact, human-readable duration string
 * such as "45m", "2h", or "2h 30m" (units are omitted when zero).
 *
 * @param {number} mins - Duration in minutes.
 * @returns {string} Formatted duration label.
 *
 * Examples:
 *   formatMinutes(45)  → "45m"
 *   formatMinutes(120) → "2h"
 *   formatMinutes(150) → "2h 30m"
 * Used everywhere a human-readable duration is shown (stat cards, the All
 * Records table, the live form preview, and the breakdown bars).
 */
function formatMinutes(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/**
 * toDecimalHours(mins)
 * Converts a minute count to decimal hours rounded to two places, e.g. 90
 * minutes → 1.5. Used for CSV export and the Google Sheets payload, which
 * expect hours as a decimal number rather than "1h 30m".
 *
 * @param {number} mins - Duration in minutes.
 * @returns {number} Hours as a rounded decimal (e.g. 1.5).
 *
 * Examples:
 *   toDecimalHours(90)  → 1.5
 *   toDecimalHours(45)  → 0.75
 *   toDecimalHours(125) → 2.08
 */
function toDecimalHours(mins) {
  return Math.round((mins / 60) * 100) / 100
}

/**
 * postToSheets(payload)
 * Sends a session record to the Google Sheets backend (the Apps Script web
 * app). The script's doPost(e) is expected to read JSON.parse(e.postData.contents)
 * and append a row to the sheet.
 *
 * Note: 'text/plain' content type is used intentionally — it lets the browser
 * make a simple POST without a CORS preflight request.
 *
 * @param {object} payload - Object of fields to log (action, id, timestamps, etc.).
 * @returns {Promise<void>} Resolves on success; throws on HTTP error or a
 *   response with success:false.
 *
 * Example payload sent by handleSubmit():
 *   { action: 'add', id: '…', timestamp: '2026-08-29T10:05:00.000Z',
 *     date: '2026-08-29', studentName: 'Sara Ahmed', fromTime: '10:00',
 *     toTime: '11:30', subject: 'English Literature', notes: '',
 *     minutes: 90, hours: 1.5 }
 */
async function postToSheets(payload) {
  const res = await fetch(SHEETS_WEB_APP_URL, {
    method: 'POST',
    // text/plain avoids a CORS preflight request in the browser
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Google Sheets responded with ${res.status}`)
  await parseSheetsResponse(res)
}

/**
 * fetchFromSheets()
 * GETs the full record list from the Google Sheets backend. The Apps Script's
 * doGet(e) handler is expected to read e.parameter.action === 'list' and return
 * { success: true, records: [...] } where each record is an object keyed by the
 * sheet's header names (id, date, studentName, fromTime, toTime, subject,
 * notes, minutes, …).
 *
 * @returns {Promise<Array>} Array of raw sheet row objects.
 *
 * Example return value (raw rows keyed by header name):
 *   [
 *     { id: '…', date: '2026-08-29', studentName: 'Sara Ahmed',
 *       fromTime: '10:00', toTime: '11:30', subject: 'English Literature',
 *       notes: '', minutes: 90 }
 *   ]
 */
async function fetchFromSheets() {
  const res = await fetch(`${SHEETS_WEB_APP_URL}?action=list`)
  if (!res.ok) throw new Error(`Google Sheets responded with ${res.status}`)
  const data = await parseSheetsResponse(res)
  if (!data || !Array.isArray(data.records))
    throw new Error('No valid records returned — check the Apps Script doGet(list) is deployed')
  return data.records
}

/**
 * fetchStudentsFromSheets()
 * GETs the student name list from the Google Sheets backend. The Apps Script's
 * doGet(e) handler is expected to read e.parameter.action === 'students', look
 * up the "Students" tab's "Student Names" column, and return
 * { success: true, students: [...] } (unique, non-empty names).
 *
 * @returns {Promise<Array>} Array of student name strings.
 *
 * Example return value: ['Sara Ahmed', 'John Doe', 'Ayesha Khan']
 */
async function fetchStudentsFromSheets() {
  const res = await fetch(`${SHEETS_WEB_APP_URL}?action=students`)
  if (!res.ok) throw new Error(`Google Sheets responded with ${res.status}`)
  const data = await parseSheetsResponse(res)
  if (!data || !Array.isArray(data.students))
    throw new Error('No valid students returned — check the Apps Script doGet(students) is deployed')
  return data.students
}

/**
 * deleteFromSheets(id)
 * POSTs { action: 'delete', id } to the Google Sheets backend. The Apps
 * Script's doPost(e) is expected to find the row whose `id` column matches and
 * delete it from the sheet.
 *
 * @param {string|number} id - The unique id of the record to remove.
 * @returns {Promise<void>} Resolves on success; throws on HTTP/script error.
 *
 * Example: deleteFromSheets('3f2b-9a1c') POSTs
 *   { action: 'delete', id: '3f2b-9a1c' }
 * so the Apps Script can locate and delete the matching row in the sheet.
 */
async function deleteFromSheets(id) {
  const res = await fetch(SHEETS_WEB_APP_URL, {
    method: 'POST',
    // text/plain avoids a CORS preflight request in the browser
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'delete', id }),
  })
  if (!res.ok) throw new Error(`Google Sheets responded with ${res.status}`)
  await parseSheetsResponse(res)
}

/**
 * parseSheetsResponse(res)
 * Shared helper that reads the Apps Script response body, parses it as JSON
 * (defensively — the script may return plain text or an HTML error page), and
 * throws if the script explicitly rejected the request (success:false).
 *
 * @param {Response} res - A fetch() Response from the Apps Script endpoint.
 * @returns {Promise<object|null>} Parsed JSON payload (or null if not JSON).
 *
 * Examples:
 *   body '{"success":true,"records":[]}'       → { success: true, records: [] }
 *   body '{"success":false}'                   → throws "Google Sheets rejected…"
 *   body '<html>error page</html>' (non-JSON)   → null (caller decides what to do)
 */
async function parseSheetsResponse(res) {
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = null
  }
  // Treat an explicit rejection from the script as an error.
  if (data && data.success === false) throw new Error('Google Sheets rejected the request')
  return data
}

/**
 * toIsoDateStr(value)
 * Coerces a sheet cell value into an ISO date string (YYYY-MM-DD). Google Apps
 * Script's getValues() returns Date objects for date-formatted cells, so we
 * normalize those (and plain strings) into the same format the app uses.
 *
 * @param {*} value - Cell value (Date, string, or null/undefined).
 * @returns {string} ISO date string, or '' when the value is missing/invalid.
 *
 * Examples:
 *   toIsoDateStr(new Date(2026, 7, 29)) → "2026-08-29"  (a real Date cell)
 *   toIsoDateStr('2026-08-29')          → "2026-08-29"  (already a string)
 *   toIsoDateStr(null)                  → ""
 */
function toIsoDateStr(value) {
  if (!value) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(value)
}

/**
 * normalizeSheetRecord(row)
 * Maps a raw row object returned by Google Sheets (keyed by header names like
 * studentName / fromTime / toTime) into the app's session shape (student /
 * start / end), so the All Records table can render it with the same helpers
 * used everywhere else. Falls back to computing minutes from the times if the
 * sheet row doesn't include a minutes value.
 *
 * @param {object} row - Raw sheet row object.
 * @returns {object} Normalized session-shaped object.
 *
 * Example: given the raw sheet row
 *   { id: '…', date: '2026-08-29', studentName: 'Sara Ahmed',
 *     fromTime: '10:00', toTime: '11:30', subject: 'English Literature',
 *     notes: 'Macbeth', minutes: 90 }
 * this returns the app's session shape:
 *   { id: '…', student: 'Sara Ahmed', subject: 'English Literature',
 *     date: '2026-08-29', start: '10:00', end: '11:30',
 *     notes: 'Macbeth', minutes: 90, createdAt: … }
 */
function normalizeSheetRecord(row) {
  const start = toTimeStr(row.fromTime || row.start)
  const end = toTimeStr(row.toTime || row.end)
  return {
    id: String(row.id ?? ''),
    student: row.studentName || row.student || '',
    subject: row.subject || '',
    date: toIsoDateStr(row.date),
    start,
    end,
    notes: row.notes || '',
    minutes: Number(row.minutes) || calcMinutes(start, end),
    createdAt: row.timestamp || Date.now(),
  }
}

/**
 * toTimeStr(value)
 * Coerces a sheet cell value into a plain "HH:MM" time string. Google Sheets
 * stores times as Date objects that serialize to ISO datetimes (e.g.
 * "1899-12-30T04:38:50.000Z"); this extracts just the time portion so the table
 * shows "10:00" instead of a raw timestamp. Existing "HH:MM" strings pass
 * through untouched.
 *
 * @param {*} value - Cell value (Date, ISO string, "HH:MM" string, or empty).
 * @returns {string} "HH:MM" time string (or '' when missing/invalid).
 *
 * Examples:
 *   toTimeStr('1899-12-30T10:30:00.000Z') → "10:30"  (Sheets serialises time cells like this)
 *   toTimeStr('10:00')                    → "10:00"  (already plain text)
 *   toTimeStr('')                         → ""
 */
function toTimeStr(value) {
  if (!value) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const h = String(value.getHours()).padStart(2, '0')
    const m = String(value.getMinutes()).padStart(2, '0')
    return `${h}:${m}`
  }
  const s = String(value)
  // "1899-12-30T04:38:50.000Z" → "04:38" (extract HH:MM from an ISO datetime)
  const isoMatch = s.match(/T(\d{2}:\d{2})/)
  return isoMatch ? isoMatch[1] : s
}

/**
 * formatDate(dateStr)
 * Formats an ISO date string (YYYY-MM-DD) into a friendly, localized label
 * like "Mon, Aug 10, 2026" for display in the All Records table.
 *
 * @param {string} dateStr - Date in "YYYY-MM-DD" format.
 * @returns {string} Human-readable date string.
 *
 * Example: formatDate('2026-08-10') → "Mon, Aug 10, 2026"
 * Used in the All Records table.
 */
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  // Month is 0-indexed in JS Dates, so subtract 1 from the parsed month.
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * monthLabel(monthKey)
 * Converts a "YYYY-MM" month key (e.g. "2026-08") into a readable label such
 * as "August 2026". Used for the monthly breakdown bars and stat card subtitle.
 *
 * @param {string} monthKey - Month in "YYYY-MM" format.
 * @returns {string} Human-readable month/year label.
 *
 * Example: monthLabel('2026-08') → "August 2026"
 * Used as the "This Month" stat subtitle and the Monthly Breakdown bar labels.
 */
function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/**
 * startOfCurrentWeekISO()
 * Returns the date of Monday of the current week as an ISO string. The week
 * is considered Monday-first: if today is Sunday, we go back 6 days to the
 * previous Monday.
 *
 * @returns {string} Monday's date in "YYYY-MM-DD" format.
 *
 * Example: if today is Wednesday 2026-08-19 this returns "2026-08-17" (that
 * week's Monday). If today is Sunday 2026-08-23 it returns "2026-08-17" too
 * (the Monday 6 days earlier), so "This Week" always starts on a Monday.
 */
function startOfCurrentWeekISO() {
  const today = new Date()
  // getDay() is 0 (Sun)…6 (Sat); convert to days since Monday.
  const diff = today.getDay() === 0 ? 6 : today.getDay() - 1
  const monday = new Date(today)
  monday.setDate(today.getDate() - diff)
  return toISODate(monday)
}

/**
 * aggregateBy(list, keyFn)
 * Groups a list of sessions by a computed key (e.g. student name or subject)
 * and sums the minutes for each group. Returns entries sorted by total minutes
 * in descending order so the biggest categories appear first.
 *
 * @param {Array} list - Array of session objects, each with a `minutes` field.
 * @param {Function} keyFn - Function that extracts the grouping key from a session.
 * @returns {Array<[key, totalMinutes]>} Sorted [key, minutes] pairs.
 *
 * Example: sessions with minutes [90, 60, 120] for students
 * ['Sara', 'John', 'Sara'], aggregateBy(sessions, s => s.student) returns
 *   [['Sara', 210], ['John', 60]]   (sorted biggest first)
 */
function aggregateBy(list, keyFn) {
  const map = new Map()
  for (const s of list) {
    const key = keyFn(s)
    map.set(key, (map.get(key) || 0) + s.minutes)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

/* ---------- small components ---------- */

/**
 * StatCard — presentational component
 * Renders a single summary statistic inside a card: a small label, a large
 * value, and an optional subtitle underneath.
 *
 * @param {object} props
 * @param {string} props.label - Short heading for the stat (e.g. "Total Hours").
 * @param {string} props.value - The main figure to display prominently.
 * @param {string} props.sub - Smaller supporting text under the value.
 *
 * Example usage in the Dashboard stats section:
 *   <StatCard label="Total Hours" value="9h 30m" sub="6 sessions" />
 * renders a card with the label on top, the big value in the middle, and the
 * supporting subtitle underneath.
 */
function StatCard({ label, value, sub }) {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-sub">{sub}</span>
    </div>
  )
}

/**
 * BarList — presentational component
 * Renders a horizontal bar chart from sorted [key, minutes] pairs (the output
 * of aggregateBy). Bar widths are proportional to the largest value so the
 * longest bar always fills the track.
 *
 * @param {object} props
 * @param {Array<[key, mins]>} props.items - Sorted [key, minutes] pairs to render.
 * @param {number} props.max - The largest minute total; used to scale bar widths.
 * @param {Function} props.format - Formats a minute count into a display label.
 * @param {Function} [props.label] - Optional formatter for the bar key (e.g. monthLabel).
 *
 * Example: <BarList items={[['Sara',210],['John',60]]} max={210} format={formatMinutes} />
 * draws two rows; Sara's bar fills 100% of the track, John's fills ~28.5%,
 * with "3h 30m" and "1h" shown on the right of each.
 */
function BarList({ items, max, format, label }) {
  return (
    <ul className="bar-list">
      {items.map(([key, mins]) => (
        <li key={key} className="bar-row">
          {/* Show a formatted label if provided, otherwise the raw key; the
              title attribute exposes the full key on hover. */}
          <span className="bar-label" title={label ? label(key) : key}>
            {label ? label(key) : key}
          </span>
          <div className="bar-track">
            {/* Width scales with mins/max but never dips below 8% so even a
                small value stays visible. */}
            <div className="bar-fill" style={{ width: `${Math.max(8, (mins / max) * 100)}%` }} />
          </div>
          <span className="bar-value">{format(mins)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * SortableTh — presentational component
 * Renders a clickable table header cell for the All Records table. Clicking
 * it sorts the table by that column; the active column is highlighted and
 * shows an arrow (▲ ascending / ▼ descending), while inactive columns show a
 * faint up/down glyph to hint that they're sortable. Also sets the native
 * aria-sort attribute for screen readers.
 *
 * @param {object} props
 * @param {string} props.label - Column header text.
 * @param {string} props.sortKey - The session field this column sorts by (e.g. 'date', 'start', 'minutes').
 * @param {string} props.activeKey - The currently active sort key.
 * @param {string} props.dir - Current sort direction: 'asc' or 'desc'.
 * @param {Function} props.onSort - Handler called with the sortKey when the header is clicked.
 *
 * Example: <SortableTh label="Date" sortKey="date" activeKey="date" dir="desc" onSort={handleRecordsSort} />
 * renders a highlighted "Date ▼" header (newest-first). Clicking it calls
 * handleRecordsSort('date'), which flips the direction to ascending.
 */
function SortableTh({ label, sortKey, activeKey, dir, onSort }) {
  const active = activeKey === sortKey
  return (
    <th
      className={`th-sortable${active ? ' th-sorted' : ''}`}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={`Sort by ${label}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <span className={`sort-arrow${active ? ' active' : ''}`} aria-hidden="true">
        {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  )
}

/* ---------- main app ---------- */

/**
 * App — main application component
 * Owns all application state (records, form, UI flags) and renders the entire
 * UI: header, stats cards, add form, and the breakdown charts. Google Sheets
 * is the single source of truth — the Dashboard stats/breakdowns and the All
 * Records table are all computed from the records fetched from the sheet.
 */
export default function App() {
  // ---------- State ----------
  // Everything the UI needs is held here. Each useState gives [value, setValue];
  // calling the setter schedules a re-render with the new value.

  // The full list of sessions fetched from Google Sheets. This is the single
  // source of truth for the whole app — the Dashboard stats/breakdowns and the
  // All Records table are all derived from it. Each record looks like:
  //   { id, student, subject, date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM',
  //     notes, minutes, createdAt }
  const [records, setRecords] = useState([])
  // True while a record fetch from Google Sheets is in flight (used to show the
  // loading state and to disable the Refresh button). Starts true because the
  // app fetches records as soon as it mounts.
  const [recordsLoading, setRecordsLoading] = useState(true)
  // Error message if the sheet fetch/delete fails (empty string = none).
  const [recordsError, setRecordsError] = useState('')
  // Id of the record currently being deleted from the sheet (spinner state).
  // Non-null while a delete request is in flight; disables other delete buttons.
  const [deletingId, setDeletingId] = useState(null)
  // Counter bumped by the Refresh button to re-trigger the fetch effect
  // (it is listed in the fetch effect's dependency array).
  const [recordsRefresh, setRecordsRefresh] = useState(0)
  // The current values of the add form fields (student, subject, date, …).
  // Kept in sync with the inputs via setField(); initialised by emptyForm().
  const [form, setForm] = useState(emptyForm)
  // Validation/error message shown near the form (empty string = no error).
  // Example: "End time must be after start time."
  const [error, setError] = useState('')
  // Banner state for Google Sheets sync, e.g. { type: 'saving'|'ok'|'error', msg }.
  // Rendered as a status strip under the header.
  const [syncStatus, setSyncStatus] = useState(null)
  // Which top-level tab is visible: 'dashboard' (default) or 'records'.
  // Toggled by the two tab buttons and read in the JSX to decide which view
  // to render.
  const [activeTab, setActiveTab] = useState('dashboard')
  // Text typed into the All Records search box (filters the fetched records).
  const [recordsSearch, setRecordsSearch] = useState('')
  // Active sort for the All Records table: { key, dir } where dir is 'asc'|'desc'.
  // Defaults to newest-first by date; changed by clicking the sortable headers.
  const [recordsSort, setRecordsSort] = useState({ key: 'date', dir: 'desc' })
  // Student names fetched from the "Students" tab of the Google Sheet, used to
  // render the Student field as a strict dropdown instead of a text box.
  const [students, setStudents] = useState([])
  // True while the student list is being fetched from the sheet.
  const [studentsLoading, setStudentsLoading] = useState(true)

  // ---------- Side effects ----------

  // Fetch the student name list from the Google Sheet once, on mount, so the
  // Student field can render as a strict dropdown instead of a text box. If the
  // fetch fails (or the tab has no names), `students` stays empty and the form
  // falls back to a plain text input so logging is never blocked. A `cancelled`
  // flag prevents a stale response from overwriting state after unmount.
  //
  // Example: on success `students` becomes ['Sara Ahmed','John Doe','Ayesha Khan']
  // and studentsLoading → false, which switches the Student field from a text
  // input to a <select>.
  useEffect(() => {
    let cancelled = false
    fetchStudentsFromSheets()
      .then(names => {
        if (!cancelled) setStudents(names)
      })
      .catch(() => {
        // Leave students empty → the form falls back to a text input.
      })
      .finally(() => {
        if (!cancelled) setStudentsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch the full record list from Google Sheets on mount (so the Dashboard
  // stats are populated straight away) and again whenever `recordsRefresh`
  // changes. recordsLoading is already true on mount; the 🔄 Refresh button
  // (refreshRecords below) sets it true again before bumping the counter. A
  // `cancelled` flag prevents a stale response from overwriting newer state if
  // the component unmounts mid-request.
  //
  // Example: the fetch runs fetchFromSheets(); each raw row is mapped through
  // normalizeSheetRecord() into the app's session shape and stored in
  // `records`, which feeds the Dashboard stats/breakdowns and the table below.
  useEffect(() => {
    let cancelled = false
    fetchFromSheets()
      .then(rows => {
        if (cancelled) return
        setRecords(rows.map(normalizeSheetRecord))
        // A successful fetch clears any previous error message.
        setRecordsError('')
      })
      .catch(err => {
        if (cancelled) return
        // Browsers report CORS/missing-endpoint failures as a generic
        // "Failed to fetch", which isn't very helpful — translate it.
        const msg =
          err && err.message && err.message !== 'Failed to fetch'
            ? err.message
            : 'Could not reach Google Sheets'
        setRecordsError(`${msg} — confirm the Apps Script has a deployed doGet(list) that returns JSON.`)
      })
      .finally(() => {
        if (!cancelled) setRecordsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [recordsRefresh])

  /**
   * refreshRecords()
   * Starts a fresh fetch from Google Sheets. Because recordsLoading must be
   * turned on and any stale error cleared before the fetch begins, that work
   * happens here — in an event handler (the 🔄 Refresh button) rather than
   * inside the effect body — and then `recordsRefresh` is bumped to re-run the
   * fetch effect above.
   *
   * Example: clicking 🔄 Refresh calls refreshRecords(), which shows the
   * loading state and re-triggers the effect; when it resolves, recordsLoading
   * flips back to false and `records` holds the up-to-date rows.
   */
  function refreshRecords() {
    setRecordsError('')
    setRecordsLoading(true)
    setRecordsRefresh(n => n + 1)
  }

  // ---------- Derived values (memoized) ----------

  /**
   * `totals`
   * All aggregated statistics shown in the stats cards and breakdown charts:
   * - total / week / month: total minutes overall, since Monday, and this month.
   * - byStudent / bySubject: top 5 students / subjects by total minutes.
   * - byMonth: the 6 most recent months with minutes, newest first.
   * Recomputed only when `records` (the Google Sheets data) changes.
   *
   * Example shape:
   *   { total: 570, week: 210, month: 480,
   *     byStudent: [['Sara', 330], ['John', 240]],
   *     bySubject: [['English Literature', 390], ['English Language', 180]],
   *     byMonth: [['2026-08', 480], ['2026-07', 90]] }
   */
  const totals = useMemo(() => {
    const today = toISODate()
    const weekStart = startOfCurrentWeekISO()
    // Lifetime total across all records.
    const total = records.reduce((sum, s) => sum + s.minutes, 0)
    // Minutes between this week's Monday and today (string comparison works
    // because dates are ISO YYYY-MM-DD).
    const week = records
      .filter(s => s.date >= weekStart && s.date <= today)
      .reduce((sum, s) => sum + s.minutes, 0)
    // Minutes where the date starts with the current "YYYY-MM" prefix.
    const month = records
      .filter(s => s.date.startsWith(today.slice(0, 7)))
      .reduce((sum, s) => sum + s.minutes, 0)
    // Top 5 students and subjects by aggregate minutes.
    const byStudent = aggregateBy(records, s => s.student).slice(0, 5)
    const bySubject = aggregateBy(records, s => s.subject).slice(0, 5)
    // Group minutes by month key (YYYY-MM), sort newest first, keep 6 months.
    const byMonth = [...records
      .reduce((map, s) => {
        const k = s.date.slice(0, 7)
        map.set(k, (map.get(k) || 0) + s.minutes)
        return map
      }, new Map())
      .entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 6)
    return { total, week, month, byStudent, bySubject, byMonth }
  }, [records])

  /**
   * `visibleRecords`
   * The records fetched from Google Sheets, filtered by the All Records search
   * box and sorted by the active column/direction. Search matches student,
   * subject, notes, date, and the time range (all case-insensitive). Numeric
   * columns (e.g. duration/minutes) compare as numbers; everything else
   * compares as strings (ISO dates sort correctly lexicographically). Rebuilt
   * only when the source records, search text, or sort config change.
   *
   * Example: searching "10:00" matches records whose start or end is 10:00;
   * searching "aug" matches dates like "2026-08-10".
   */
  const visibleRecords = useMemo(() => {
    const q = recordsSearch.trim().toLowerCase()
    const rows = q
      ? records.filter(s =>
          [s.student, s.subject, s.notes, s.date, `${s.start}–${s.end}`].some(field =>
            (field || '').toLowerCase().includes(q),
          ),
        )
      : records
    const { key, dir } = recordsSort
    return [...rows].sort((a, b) => {
      const av = a[key]
      const bv = b[key]
      let cmp
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''))
      }
      return dir === 'asc' ? cmp : -cmp
    })
  }, [records, recordsSearch, recordsSort])

  // Live duration preview for the times currently typed into the form (0 when
  // either field is empty or the range is invalid). Recomputed every render, so
  // it updates as the user changes the start/end inputs.
  // Example: form.start = '10:00', form.end = '11:30' → formMinutes = 90.
  // This powers the "⏱ Duration: 1h 30m" preview line under the time inputs.
  const formMinutes = calcMinutes(form.start, form.end)

  // ---------- Event handlers ----------

  /**
   * setField(field, value)
   * Generic updater for a single form field. Updates the `form` state via the
   * functional form of setState (so concurrent updates merge correctly) and
   * clears any stale validation error while the user is typing.
   *
   * @param {string} field - The form key to update (e.g. 'student', 'date').
   * @param {*} value - The new value for that field.
   *
   * Example: typing "Sara Ahmed" into the student box calls
   *   setField('student', 'Sara Ahmed')
   * which sets form.student and clears any previous error message.
   * Wired to every form input's onChange.
   */
  function setField(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    if (error) setError('')
  }

  /**
   * handleStartChange(value)
   * Handles the Start time input. Stores the typed value in form.start and,
   * if the End time is still empty, pre-fills it with a sensible default of
   * start + 1 hour via addMinutesToTime(). An End time the user has already
   * chosen is left untouched (the auto-default only fills a blank End field).
   *
   * @param {string} value - The new start time in "HH:MM" format.
   *
   * Example: the user types 10:00 with no end time → form.start = '10:00' and
   * form.end = '11:00', and the live duration preview shows "1h" straight away.
   * Wired to the Start time input's onChange.
   */
  function handleStartChange(value) {
    setField('start', value)
    // Only auto-fill the End time when it hasn't been set yet.
    if (!form.end && value) {
      const defaultEnd = addMinutesToTime(value, 60)
      if (defaultEnd) setField('end', defaultEnd)
    }
  }

  /**
   * handleSubmit(e)
   * Runs when the Add Session form is submitted. Validates that the required
   * fields are filled and the time range is positive, builds a session object,
   * then POSTs it to Google Sheets. Google Sheets is the ONLY store for the
   * data — there is no separate local copy — so the row must be written there
   * before it is reflected anywhere in the UI.
   *
   * @param {Event} e - The form submit event (prevented to avoid a page reload).
   *
   * Example: a new session with student "Sara Ahmed", subject "English
   * Literature", date 2026-08-29, 10:00–11:30 gets minutes 90 and is POSTed to
   * the sheet as { action: 'add', ... }. On success the session is appended to
   * `records` (so the Dashboard reflects it immediately) and the status banner
   * shows "Saving to Google Sheets…" → "✓ Saved to Google Sheets". On failure
   * the form is left intact so the user can retry.
   */
  async function handleSubmit(e) {
    e.preventDefault()
    // Basic required-field validation before anything is saved.
    if (!form.student.trim() || !form.subject.trim() || !form.date || !form.start || !form.end) {
      setError('Please fill in student, subject, date, and times.')
      return
    }
    const minutes = calcMinutes(form.start, form.end)
    if (minutes <= 0) {
      setError('End time must be after start time.')
      return
    }
    // Build the session object with a fresh random UUID.
    const session = {
      id: crypto.randomUUID(),
      student: form.student.trim(),
      subject: form.subject.trim(),
      date: form.date,
      start: form.start,
      end: form.end,
      notes: form.notes.trim(),
      minutes,
      createdAt: Date.now(),
    }
    setSyncStatus({ type: 'saving', msg: 'Saving to Google Sheets…' })
    try {
      // POST the new row to the sheet — this is the authoritative save.
      await postToSheets({
        action: 'add',
        id: session.id,
        // Fields expected by the Apps Script doPost(e):
        timestamp: new Date().toISOString(),
        date: session.date,
        studentName: session.student,
        fromTime: session.start,
        toTime: session.end,
        // Extra info kept for reference (not stored by the script):
        subject: session.subject,
        notes: session.notes,
        minutes: session.minutes,
        hours: toDecimalHours(session.minutes),
      })
      // The sheet now holds the row, so mirror it into `records` to keep the
      // Dashboard and All Records in sync without an extra round-trip.
      setRecords(prev => [...prev, session])
      setForm(emptyForm())
      setError('')
      setSyncStatus({ type: 'ok', msg: '✓ Saved to Google Sheets' })
    } catch {
      // Nothing was written anywhere, so keep the form populated for a retry.
      setSyncStatus({ type: 'error', msg: '⚠ Could not reach Google Sheets — nothing was saved' })
    }
  }

  /**
   * handleSheetDelete(id)
   * Deletes a record from the Google Sheet itself. Asks for confirmation, then
   * POSTs { action: 'delete', id } to the Apps Script. On success the row is
   * removed from `records` (the in-memory mirror of the sheet) so the Dashboard
   * stats and the All Records table stay in sync. The row is disabled while the
   * request is in flight.
   *
   * @param {string} id - The id of the record to delete from the sheet.
   *
   * Example: the All Records 🗑️ button calls handleSheetDelete(s.id). While the
   * request runs, deletingId = s.id (spinner state); on success the row is
   * removed from `records`.
   * Wired to the 🗑️ buttons in the All Records table.
   */
  async function handleSheetDelete(id) {
    if (!window.confirm('Delete this session from Google Sheets?')) return
    setDeletingId(id)
    setRecordsError('')
    try {
      await deleteFromSheets(id)
      // Remove the row from `records` so the Dashboard/All Records stay in sync.
      setRecords(prev => prev.filter(s => s.id !== id))
      setSyncStatus({ type: 'ok', msg: '🗑 Deleted from Google Sheets' })
    } catch {
      setSyncStatus({ type: 'error', msg: '⚠ Could not delete from Google Sheets' })
      setRecordsError(
        'Could not delete — make sure the Apps Script handles action "delete" with an id column.',
      )
    } finally {
      setDeletingId(null)
    }
  }

  /**
   * handleRecordsSort(key)
   * Updates the All Records sort config. Clicking a new column sorts ascending
   * by it (dates default to newest-first instead); clicking the active column
   * again toggles the direction.
   *
   * @param {string} key - The field to sort by (date, student, subject, start, minutes, notes).
   *
   * Example: recordsSort is { key: 'date', dir: 'desc' }; clicking "Student"
   * sets { key: 'student', dir: 'asc' } (A→Z); clicking "Student" again flips
   * to { key: 'student', dir: 'desc' } (Z→A).
   * Passed to every SortableTh as onSort.
   */
  function handleRecordsSort(key) {
    setRecordsSort(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      // Dates sort newest-first by default; other columns start ascending.
      return { key, dir: key === 'date' ? 'desc' : 'asc' }
    })
  }

  /**
   * handleExport()
   * Downloads all records (sorted newest-first by date) as a CSV file. Fields
   * containing commas or quotes are wrapped in double quotes with embedded
   * quotes escaped (doubled) to produce valid CSV. Uses a temporary <a> element
   * with an object URL to trigger the download without leaving the page.
   *
   * Example: produces tuition-hours-2026-08-29.csv with a line like
   *   2026-08-29,"Sara Ahmed","English Literature",10:00,11:30,1.5,"Macbeth themes"
   * Wired to the "⬇ Export CSV" button in the header.
   */
  function handleExport() {
    // Column header row for the exported CSV.
    const header = 'Date,Student,Subject,Start,End,Hours,Notes'
    // Sort a copy of the records newest-first (latest date/time on top), then
    // map each record to a CSV line; quote/escape text fields for safety.
    const sorted = [...records].sort((a, b) =>
      a.date === b.date ? b.start.localeCompare(a.start) : b.date.localeCompare(a.date),
    )
    const rows = sorted.map(s =>
      [
        s.date,
        `"${s.student.replace(/"/g, '""')}"`,
        `"${s.subject.replace(/"/g, '""')}"`,
        s.start,
        s.end,
        toDecimalHours(s.minutes),
        `"${(s.notes || '').replace(/"/g, '""')}"`,
      ].join(','),
    )
    // Join header + rows into one CSV string.
    const csv = [header, ...rows].join('\n')
    // Wrap the text in a Blob so it can be downloaded as a .csv file.
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tuition-hours-${toISODate()}.csv`
    a.click()
    // Release the object URL to avoid a memory leak.
    URL.revokeObjectURL(url)
  }

  return (
    // The whole app lives inside one root <div> ("app") so every section
    // shares the same layout container and CSS.
    <div className="app">
      {/* ---- Header ---- */}
      <header className="app-header">
        <div className="app-title">
          {/* Decorative logo (aria-hidden) — the <img> is the bundled Logo.png. */}
          <span className="app-logo" aria-hidden="true">
            <img src={logo} alt="" className="app-logo-img" />
          </span>
          <div>
            {/* Static branding: app name and tagline. No state involved. */}
            <h1>Englishious Hours Logger</h1>
            <p>Log tutoring sessions and see where your teaching time goes.</p>
          </div>
        </div>
        {/* Export CSV button → handleExport() downloads the records loaded from
            Google Sheets. Disabled when records.length is 0 (nothing yet). */}
        <button
          className="btn btn-outline"
          type="button"
          onClick={handleExport}
          disabled={records.length === 0}
        >
          ⬇ Export CSV
        </button>
      </header>

      {/* ---- Google Sheets sync status banner ---- */}
      {/* Only rendered when syncStatus is truthy (set by handleSubmit /
          handleSheetDelete). The `type` drives the CSS class
          (sync-saving / sync-ok / sync-error) and the icon:
            type 'saving' → ⏳  "Saving to Google Sheets…"
            type 'ok'     → ✅  "✓ Saved to Google Sheets"
            type 'error'  → ⚠️  "⚠ Could not reach Google Sheets…" */}
      {syncStatus && (
        <div className={`sync-status sync-${syncStatus.type}`} role="status">
          <span className="sync-indicator" aria-hidden="true">
            {syncStatus.type === 'saving' ? '⏳' : syncStatus.type === 'ok' ? '✅' : '⚠️'}
          </span>
          {syncStatus.msg}
        </div>
      )}

      {/* ---- Tab navigation ---- */}
      {/* Two tabs switch the activeTab state ('dashboard' | 'records'). The
          className uses it for the active highlight and aria-selected is set
          for screen readers. The view rendered below is chosen by:
            activeTab === 'dashboard' → stats / add form / breakdown charts
            activeTab === 'records'   → the Google Sheets records table */}
      <nav className="tabs" role="tablist" aria-label="App views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'dashboard'}
          className={`tab${activeTab === 'dashboard' ? ' active' : ''}`}
          // Clicking sets activeTab to 'dashboard', re-rendering the dashboard.
          onClick={() => setActiveTab('dashboard')}
        >
          📊 Dashboard
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'records'}
          className={`tab${activeTab === 'records' ? ' active' : ''}`}
          // Clicking switches to the records view (the data is already fetched
          // on mount, so no re-fetch is needed here).
          onClick={() => setActiveTab('records')}
        >
          📋 All Records
          {/* Badge showing the number of records loaded from Google Sheets.
              Only rendered when there is at least one record. */}
          {records.length > 0 && <span className="tab-count">{records.length}</span>}
        </button>
      </nav>

      {/* ---- Dashboard view (rendered only when activeTab === 'dashboard') ---- */}
      {activeTab === 'dashboard' && (
        <>
      {/* ---- Initial load / failure notice ---- */}
      {/* While the records are being fetched (or if that first fetch failed)
          and we have nothing to show yet, surface a slim status strip above
          the stats instead of silently showing zeros. Once records exist the
          notice disappears. */}
      {(recordsLoading || recordsError) && records.length === 0 && (
        <div
          className={`sync-status ${recordsLoading ? 'sync-saving' : 'sync-error'}`}
          role="status"
        >
          <span className="sync-indicator" aria-hidden="true">
            {recordsLoading ? '⏳' : '⚠️'}
          </span>
          {recordsLoading
            ? 'Loading your records from Google Sheets…'
            : 'Could not load records from Google Sheets. Use 🔄 Refresh in All Records to try again.'}
        </div>
      )}

      {/* ---- Stats cards row ---- */}
      {/* Each StatCard renders { label, value, sub }. The values come from the
          memoized `totals` object and are formatted by formatMinutes():
            formatMinutes(totals.total) → e.g. "9h 30m" (lifetime total)
            totals.week                 → minutes since Monday (startOfCurrentWeekISO)
            totals.month                → minutes in the current calendar month
          `sub` is the supporting text under each number. */}
      <section className="stats">
        <StatCard label="Total Hours" value={formatMinutes(totals.total)} sub={`${records.length} sessions`} />
        <StatCard label="This Week" value={formatMinutes(totals.week)} sub="Since Monday" />
        {/* monthLabel(toISODate().slice(0,7)) turns today's "2026-08-29" into
            "August 2026" for the "This Month" card subtitle. */}
        <StatCard label="This Month" value={formatMinutes(totals.month)} sub={monthLabel(toISODate().slice(0, 7))} />
        {/* Average = total minutes ÷ record count. Guards against dividing by
            zero when records.length is 0 (shows "0m" instead). */}
        <StatCard
          label="Avg / Session"
          value={formatMinutes(records.length ? Math.round(totals.total / records.length) : 0)}
          sub="per session"
        />
      </section>

      {/* ---- Add Session form ---- */}
      <main className="layout">
        {/* onSubmit fires handleSubmit(e) when the user submits. The form is a
            CONTROLLED component: every input's value comes from `form` state
            and every onChange calls setField() to update it. Saving writes the
            new row straight to Google Sheets (the single source of truth). */}
        <form className="card form-card" onSubmit={handleSubmit}>
          <h2>➕ Add Session</h2>

          {/* ---- Student field ---- */}
          <div className="field">
            <label htmlFor="student">Student</label>
            {/* Strict dropdown: options come from the "Students" tab's "Student
                Names" column in the Google Sheet. Falls back to a free-text
                input only if the list can't be loaded (offline / not deployed). */}
            {studentsLoading || students.length > 0 ? (
              <select
                id="student"
                // value={form.student} makes this a CONTROLLED select: its
                // displayed choice is always whatever form.student holds.
                value={form.student}
                // Choosing an option updates form.student via setField.
                onChange={e => setField('student', e.target.value)}
              >
                {/* Disabled placeholder option shown until a student is picked
                    (or while the student list is still loading). */}
                <option value="" disabled>
                  {studentsLoading ? 'Loading students…' : 'Select a student…'}
                </option>
                {/* One <option> per name in the `students` state array (fetched
                    from the sheet's "Student Names" column). key={name} keeps
                    the list stable across re-renders. */}
                {students.map(name => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              /* Fallback free-text input used only when the student list could
                 not be fetched (students is empty and not loading). */
              <input
                id="student"
                type="text"
                placeholder="e.g. Sara Ahmed"
                value={form.student}
                onChange={e => setField('student', e.target.value)}
              />
            )}
          </div>

          {/* ---- Subject field ---- */}
          <div className="field">
            <label htmlFor="subject">Subject</label>
            {/* Strict dropdown built from the fixed SUBJECTS constant
                (["English Literature", "English Language", "English General"]).
                Controlled by form.subject, updated via setField('subject', …). */}
            <select
              id="subject"
              value={form.subject}
              onChange={e => setField('subject', e.target.value)}
            >
              <option value="" disabled>
                Select a subject…
              </option>
              {SUBJECTS.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* ---- Date field ---- */}
          {/* Native date picker. value={form.date} is stored as "YYYY-MM-DD"
              (the same format toISODate() produces) so it round-trips cleanly. */}
          <div className="field">
            <label htmlFor="date">Date</label>
            <input id="date" type="date" value={form.date} onChange={e => setField('date', e.target.value)} />
          </div>

          {/* ---- Start / End time fields (side by side) ---- */}
          {/* Both are 24h "HH:MM" inputs held in form.start / form.end. These
              two values feed calcMinutes() to compute the live duration preview
              (formMinutes) and are stored on the session object. */}
          <div className="field-row">
            <div className="field">
              <label htmlFor="start">Start time</label>
              {/* Changing the start time stores it via handleStartChange(), which
                  also pre-fills a blank End time with start + 1 hour. */}
              <input id="start" type="time" value={form.start} onChange={e => handleStartChange(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="end">End time</label>
              <input id="end" type="time" value={form.end} onChange={e => setField('end', e.target.value)} />
            </div>
          </div>

          {/* ---- Notes field (optional) ---- */}
          <div className="field">
            <label htmlFor="notes">
              Notes <span className="optional">(optional)</span>
            </label>
            <textarea
              id="notes"
              rows={2}
              placeholder="Topics covered, homework assigned…"
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
            />
          </div>

          {/* ---- Live duration preview ---- */}
          {/* formMinutes is recomputed each render from form.start/end via
              calcMinutes(). When > 0 the CSS class "duration-on" highlights it
              and the label shows the computed length; otherwise it prompts the
              user to enter times. Example: "⏱ Duration: 1h 30m". */}
          <div className={`duration${formMinutes > 0 ? ' duration-on' : ''}`}>
            {formMinutes > 0
              ? `⏱ Duration: ${formatMinutes(formMinutes)}`
              : '⏱ Set start & end times to see duration'}
          </div>

          {/* ---- Inline validation error ---- */}
          {/* `error` is set by handleSubmit() when validation fails (e.g. a
              required field is empty, or end ≤ start). Rendered only when
              non-empty, and cleared automatically as the user types. */}
          {error && <p className="error">{error}</p>}

          {/* ---- Form actions ---- */}
          <div className="form-actions">
            {/* Submit button → triggers the form's onSubmit → handleSubmit(),
                which POSTs the new row to Google Sheets. Disabled while a save
                is in flight so the session isn't submitted twice. */}
            <button className="btn btn-primary" type="submit" disabled={syncStatus?.type === 'saving'}>
              {syncStatus?.type === 'saving' ? 'Saving…' : 'Add Session'}
            </button>
          </div>
        </form>

      </main>

      {/* ---- Breakdown charts ---- */}
      {/* Three horizontal bar charts, all powered by the memoized `totals` and
          the reusable BarList component. Each passes:
            items  → the [key, minutes] pairs (from totals)
            max    → the biggest value, so the longest bar fills the track
            format → formatMinutes (formats the right-hand value)
            label  → optional key formatter (monthLabel for months) */}
      <section className="breakdown">
        <div className="card">
          <h2>👨‍🎓 Top Students</h2>
          {/* totals.byStudent = top 5 students by total minutes. */}
          {totals.byStudent.length === 0 ? (
            <p className="muted">No data yet.</p>
          ) : (
            <BarList items={totals.byStudent} max={totals.byStudent[0][1]} format={formatMinutes} />
          )}
        </div>
        <div className="card">
          <h2>📖 Top Subjects</h2>
          {/* totals.bySubject = top 5 subjects by total minutes. */}
          {totals.bySubject.length === 0 ? (
            <p className="muted">No data yet.</p>
          ) : (
            <BarList items={totals.bySubject} max={totals.bySubject[0][1]} format={formatMinutes} />
          )}
        </div>
        <div className="card">
          <h2>🗓 Monthly Breakdown</h2>
          {/* totals.byMonth = the 6 most recent months with minutes, newest
              first. monthLabel is passed as `label` so "2026-08" displays as
              "August 2026" on each bar. */}
          {totals.byMonth.length === 0 ? (
            <p className="muted">No data yet.</p>
          ) : (
            <BarList items={totals.byMonth} max={totals.byMonth[0][1]} format={formatMinutes} label={monthLabel} />
          )}
        </div>
      </section>
        </>
      )}

      {/* ---- All Records view (shown when activeTab === 'records') ---- */}
      {/* This whole section renders the Google Sheets data. The records are
          fetched on mount and refreshed via the button below (recordsRefresh
          bumps the fetch effect above). Only a Delete action is offered — rows
          are edited directly in Google Sheets. */}
      {activeTab === 'records' && (
        <section className="records">
          <div className="card records-card">
            <div className="list-head">
              <h2>All Records</h2>
              <div className="records-tools">
                {/* Search box for the records table; typing updates recordsSearch,
                    which recomputes `visibleRecords`. */}
                <div className="search-wrap">
                  <span className="search-icon" aria-hidden="true">🔍</span>
                  <input
                    type="search"
                    placeholder="Search records…"
                    value={recordsSearch}
                    onChange={e => setRecordsSearch(e.target.value)}
                  />
                </div>
                {/* Count line: how many records match the current search out of
                    the total fetched from the sheet. Uses "session"/"sessions"
                    for proper pluralisation. */}
                <span className="records-count">
                  {visibleRecords.length} of {records.length} session
                  {records.length === 1 ? '' : 's'} from Google Sheets
                </span>
                {/* Refresh button → refreshRecords() turns the loading state on
                    and bumps recordsRefresh, which re-runs the fetch effect.
                    Disabled while a fetch is already in flight. */}
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={refreshRecords}
                  disabled={recordsLoading}
                >
                  🔄 Refresh
                </button>
              </div>
            </div>

            {/* Fetch/delete error banner, if any (recordsError state). */}
            {recordsError && (
              <p className="records-error" role="alert">
                ⚠ {recordsError}
              </p>
            )}

            {/* Five-state render for the table area:
                1. recordsLoading && no rows yet      → "Loading…"
                2. fetch failed & nothing loaded      → error message
                3. records empty (fetched ok)         → "No records found"
                4. visibleRecords empty after search  → "No match"
                5. otherwise                          → the full <table> */}
            {recordsLoading && records.length === 0 ? (
              <div className="empty">
                <span className="empty-icon" aria-hidden="true">⏳</span>
                <p>Loading records from Google Sheets…</p>
              </div>
            ) : recordsError && records.length === 0 ? (
              <div className="empty">
                <span className="empty-icon" aria-hidden="true">⚠️</span>
                <p>Couldn’t load records from Google Sheets. Check your connection, then press 🔄 Refresh.</p>
              </div>
            ) : records.length === 0 ? (
              <div className="empty">
                <span className="empty-icon" aria-hidden="true">📭</span>
                <p>No records found in Google Sheets yet.</p>
              </div>
            ) : visibleRecords.length === 0 ? (
              <div className="empty">
                <span className="empty-icon" aria-hidden="true">🔍</span>
                <p>No records match your search.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="records-table">
                  {/* Header row: six sortable columns + a fixed Actions column.
                      Each SortableTh receives the CURRENT sort state
                      (recordsSort.key / recordsSort.dir) so the active column is
                      highlighted, and onSort={handleRecordsSort} so clicking a
                      header updates the sort config. */}
                  <thead>
                    <tr>
                      <SortableTh
                        label="Date"
                        sortKey="date"
                        activeKey={recordsSort.key}
                        dir={recordsSort.dir}
                        onSort={handleRecordsSort}
                      />
                      <SortableTh
                        label="Student"
                        sortKey="student"
                        activeKey={recordsSort.key}
                        dir={recordsSort.dir}
                        onSort={handleRecordsSort}
                      />
                      <SortableTh
                        label="Subject"
                        sortKey="subject"
                        activeKey={recordsSort.key}
                        dir={recordsSort.dir}
                        onSort={handleRecordsSort}
                      />
                      <SortableTh
                        label="Time"
                        sortKey="start"
                        activeKey={recordsSort.key}
                        dir={recordsSort.dir}
                        onSort={handleRecordsSort}
                      />
                      <SortableTh
                        label="Duration"
                        sortKey="minutes"
                        activeKey={recordsSort.key}
                        dir={recordsSort.dir}
                        onSort={handleRecordsSort}
                      />
                      <SortableTh
                        label="Notes"
                        sortKey="notes"
                        activeKey={recordsSort.key}
                        dir={recordsSort.dir}
                        onSort={handleRecordsSort}
                      />
                      <th className="th-actions">Actions</th>
                    </tr>
                  </thead>
                  {/* Body: one <tr> per record in `visibleRecords` (the
                      search-filtered + sorted view of the sheet data). `s` is a
                      normalised session object in the app's record shape. */}
                  <tbody>
                    {visibleRecords.map(s => (
                      /* The "row-deleting" class fades/animates the row whose
                         delete request is in flight (deletingId matches). */
                      <tr key={s.id} className={deletingId === s.id ? 'row-deleting' : ''}>
                        {/* Date cell → formatDate() renders "Mon, Aug 29, 2026"
                            (or an em-dash if the date is missing). */}
                        <td className="td-date">{s.date ? formatDate(s.date) : '—'}</td>
                        <td className="td-student">{s.student || '—'}</td>
                        {/* Subject cell renders the chip style if present. */}
                        <td>{s.subject ? <span className="chip">{s.subject}</span> : '—'}</td>
                        {/* Time cell shows the raw "HH:MM–HH:MM" range. */}
                        <td className="td-time">
                          {s.start && s.end ? `${s.start}–${s.end}` : '—'}
                        </td>
                        {/* Duration cell → formatMinutes(), e.g. 90 → "1h 30m". */}
                        <td className="td-hours">{formatMinutes(s.minutes || 0)}</td>
                        {/* Notes cell (truncated; full text shown on hover via the
                            title attribute). */}
                        <td className="td-notes" title={s.notes || ''}>
                          {s.notes || '—'}
                        </td>
                        <td className="td-actions">
                          {/* Delete is the ONLY row action — it removes the row
                              from Google Sheets itself via handleSheetDelete(s.id).
                              Editing is done directly in the spreadsheet. Disabled
                              while any delete is in flight (deletingId). */}
                          <button
                            className="icon-btn danger"
                            type="button"
                            title="Delete from Google Sheets"
                            disabled={deletingId !== null}
                            onClick={() => handleSheetDelete(s.id)}
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---- Footer ---- */}
      <footer className="app-footer">
        <p>Data is stored in Google Sheets. 🛡️</p>
      </footer>
    </div>
  )
}