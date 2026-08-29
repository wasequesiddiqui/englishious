// React Hooks used throughout the app:
// - useEffect: runs side effects (persisting data) after a render.
// - useMemo: caches expensive computed values so they are only recalculated when deps change.
// - useState: holds component state (sessions, form fields, UI flags, etc.).
import { useEffect, useMemo, useState } from 'react'

// Global stylesheet (layout, cards, bars, buttons, form fields, etc.).
import './App.css'
// App logo shown in the header (bundled by Vite from src/assets).
import logo from './assets/Logo.png'

// ---------- Module-level constants ----------

/**
 * STORAGE_KEY
 * The localStorage key under which all logged sessions are persisted.
 * Browsers persist data per-origin, so this key must stay consistent between
 * page reloads to avoid losing the user's session history.
 */
const STORAGE_KEY = 'tuition-hours-logger'

/**
 * SHEETS_WEB_APP_URL
 * The public endpoint of the Google Apps Script Web App that appends rows to
 * a Google Sheet. A POST to this URL sends a JSON payload; the script's
 * doPost(e) handler reads it and writes one row per request.
 */
const SHEETS_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbyp3v3s2fBYEulh658bO0PIMj8tE25ZSbkynA-ndMh8kRffGdKBBsJQLF-gZLT6RLz0/exec'

/**
 * SUBJECTS
 * The complete, fixed list of allowed subjects. Rendered into a <select>
 * dropdown so only these options can be chosen (no free-text entry).
 */
const SUBJECTS = ['English Literature', 'English Language', 'English General']

/**
 * MONTHS
 * Short English month names (Jan–Dec), indexed by (monthNumber - 1). Used to
 * render the day/month badge next to each session in the log list without
 * needing a locale-aware date formatter.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/* ---------- helpers ---------- */

/**
 * toISODate(d)
 * Formats a Date object as an ISO-style calendar date string (YYYY-MM-DD).
 * This is the storage format used for session dates so they sort correctly
 * lexicographically and work with <input type="date">.
 *
 * @param {Date} d - The date to format. Defaults to the current date/time.
 * @returns {string} Date string like "2026-08-10".
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
 */
function emptyForm() {
  return { student: '', subject: '', date: toISODate(), start: '', end: '', notes: '' }
}

/**
 * loadSessions()
 * Reads previously saved sessions out of localStorage. Used as the lazy
 * initializer for the `sessions` state so data is restored on first render.
 * Wrapped in try/catch because localStorage can throw (e.g. disabled storage,
 * corrupted JSON) — in that case we fall back to an empty list.
 *
 * @returns {Array} Array of saved session objects (empty if none / on error).
 */
function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
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
 * formatMinutes(mins)
 * Converts a number of minutes into a compact, human-readable duration string
 * such as "45m", "2h", or "2h 30m" (units are omitted when zero).
 *
 * @param {number} mins - Duration in minutes.
 * @returns {string} Formatted duration label.
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
 * like "Mon, Aug 10, 2026" for display in the session log.
 *
 * @param {string} dateStr - Date in "YYYY-MM-DD" format.
 * @returns {string} Human-readable date string.
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
 * Owns all application state (sessions, form, search, UI flags) and renders
 * the entire UI: header, stats cards, add/edit form, session log with search,
 * and the breakdown charts (top students, top subjects, monthly).
 */
export default function App() {
  // ---------- State ----------

  // The full list of logged sessions, restored from localStorage on first render
  // (loadSessions is the lazy initializer).
  const [sessions, setSessions] = useState(loadSessions)
  // The current values of the add/edit form fields (student, subject, date, …).
  const [form, setForm] = useState(emptyForm)
  // The id of the session currently being edited, or null when adding new.
  const [editingId, setEditingId] = useState(null)
  // The text typed into the search box; used to filter the session log.
  const [search, setSearch] = useState('')
  // Validation/error message shown near the form (empty string = no error).
  const [error, setError] = useState('')
  // Banner state for Google Sheets sync, e.g. { type: 'saving'|'ok'|'error', msg }.
  const [syncStatus, setSyncStatus] = useState(null)
  // Which top-level tab is visible: 'dashboard' (default) or 'records'.
  const [activeTab, setActiveTab] = useState('dashboard')
  // Records fetched from Google Sheets for the "All Records" tab.
  const [sheetRecords, setSheetRecords] = useState([])
  // True while the sheet fetch is in flight.
  const [recordsLoading, setRecordsLoading] = useState(false)
  // Error message if the sheet fetch/delete fails (empty string = none).
  const [recordsError, setRecordsError] = useState('')
  // Id of the record currently being deleted from the sheet (spinner state).
  const [deletingId, setDeletingId] = useState(null)
  // Counter bumped by the Refresh button to re-trigger the fetch effect.
  const [recordsRefresh, setRecordsRefresh] = useState(0)
  // Text typed into the All Records search box (filters the fetched records).
  const [recordsSearch, setRecordsSearch] = useState('')
  // Active sort for the All Records table: { key, dir } where dir is 'asc'|'desc'.
  const [recordsSort, setRecordsSort] = useState({ key: 'date', dir: 'desc' })
  // Student names fetched from the "Students" tab of the Google Sheet, used to
  // render the Student field as a strict dropdown instead of a text box.
  const [students, setStudents] = useState([])
  // True while the student list is being fetched from the sheet.
  const [studentsLoading, setStudentsLoading] = useState(true)

  // ---------- Side effect: persist sessions ----------

  // Every time `sessions` changes (add/edit/delete), write the whole array to
  // localStorage so the data survives page reloads.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  }, [sessions])

  // Fetch the student name list from the Google Sheet once, on mount, so the
  // Student field can render as a strict dropdown instead of a text box. If the
  // fetch fails (or the tab has no names), `students` stays empty and the form
  // falls back to a plain text input so logging is never blocked. A `cancelled`
  // flag prevents a stale response from overwriting state after unmount.
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

  // Fetch the record list from Google Sheets whenever the All Records tab is
  // shown, and again whenever the user clicks Refresh (recordsRefresh bumps).
  // A `cancelled` flag prevents a stale response from overwriting newer state
  // if the user switches tabs before the request resolves.
  useEffect(() => {
    if (activeTab !== 'records') return
    let cancelled = false
    setRecordsLoading(true)
    setRecordsError('')
    fetchFromSheets()
      .then(rows => {
        if (!cancelled) setSheetRecords(rows.map(normalizeSheetRecord))
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
  }, [activeTab, recordsRefresh])

  // ---------- Derived values (memoized) ----------

  /**
   * `sorted`
   * Sessions sorted newest-first: primarily by date descending, and for
   * sessions on the same day by start time descending (latest session first).
   * Rebuilt only when `sessions` changes.
   */
  const sorted = useMemo(
    () =>
      [...sessions].sort((a, b) =>
        a.date === b.date ? b.start.localeCompare(a.start) : b.date.localeCompare(a.date),
      ),
    [sessions],
  )

  /**
   * `localIds`
   * Set of session ids that exist in local storage. Used by the All Records
   * table to only offer the Edit action for records we also have locally (so
   * pre-filling the form always works); every fetched record gets Delete.
   */
  const localIds = useMemo(() => new Set(sessions.map(s => s.id)), [sessions])

  /**
   * `filtered`
   * The list shown in the UI: `sorted` filtered by the search query against
   * student, subject, and notes (case-insensitive). If the query is empty the
   * full sorted list is returned. Recomputed when `sorted` or `search` change.
   */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      s =>
        s.student.toLowerCase().includes(q) ||
        s.subject.toLowerCase().includes(q) ||
        (s.notes || '').toLowerCase().includes(q),
    )
  }, [sorted, search])

  /**
   * `totals`
   * All aggregated statistics shown in the stats cards and breakdown charts:
   * - total / week / month: total minutes overall, since Monday, and this month.
   * - byStudent / bySubject: top 5 students / subjects by total minutes.
   * - byMonth: the 6 most recent months with minutes, newest first.
   * Recomputed only when `sessions` changes.
   */
  const totals = useMemo(() => {
    const today = toISODate()
    const weekStart = startOfCurrentWeekISO()
    // Lifetime total across all sessions.
    const total = sessions.reduce((sum, s) => sum + s.minutes, 0)
    // Minutes between this week's Monday and today (string comparison works
    // because dates are ISO YYYY-MM-DD).
    const week = sessions
      .filter(s => s.date >= weekStart && s.date <= today)
      .reduce((sum, s) => sum + s.minutes, 0)
    // Minutes where the date starts with the current "YYYY-MM" prefix.
    const month = sessions
      .filter(s => s.date.startsWith(today.slice(0, 7)))
      .reduce((sum, s) => sum + s.minutes, 0)
    // Top 5 students and subjects by aggregate minutes.
    const byStudent = aggregateBy(sessions, s => s.student).slice(0, 5)
    const bySubject = aggregateBy(sessions, s => s.subject).slice(0, 5)
    // Group minutes by month key (YYYY-MM), sort newest first, keep 6 months.
    const byMonth = [...sessions
      .reduce((map, s) => {
        const k = s.date.slice(0, 7)
        map.set(k, (map.get(k) || 0) + s.minutes)
        return map
      }, new Map())
      .entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 6)
    return { total, week, month, byStudent, bySubject, byMonth }
  }, [sessions])

  /**
   * `visibleRecords`
   * The fetched sheet records filtered by the All Records search box and sorted
   * by the active column/direction. Search matches student, subject, notes,
   * date, and the time range (all case-insensitive). Numeric columns (e.g.
   * duration/minutes) compare as numbers; everything else compares as strings
   * (ISO dates sort correctly lexicographically). Rebuilt only when the source
   * records, search text, or sort config change.
   */
  const visibleRecords = useMemo(() => {
    const q = recordsSearch.trim().toLowerCase()
    const rows = q
      ? sheetRecords.filter(s =>
          [s.student, s.subject, s.notes, s.date, `${s.start}–${s.end}`].some(field =>
            (field || '').toLowerCase().includes(q),
          ),
        )
      : sheetRecords
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
  }, [sheetRecords, recordsSearch, recordsSort])

  // Live duration preview for the times currently typed into the form (0 when
  // either field is empty or the range is invalid).
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
   */
  function setField(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    if (error) setError('')
  }

  /**
   * handleSubmit(e)
   * Runs when the form is submitted (Add or Update Session). Validates that
   * required fields are filled and the time range is positive, builds a session
   * object, saves it locally (inserting or replacing depending on `editingId`),
   * resets the form, then fires a best-effort sync to Google Sheets.
   *
   * @param {Event} e - The form submit event (prevented to avoid a page reload).
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
    // Build the session object. A brand-new session gets a random UUID; an
    // existing one keeps its original id so it can be matched for replacement.
    const session = {
      id: editingId || crypto.randomUUID(),
      student: form.student.trim(),
      subject: form.subject.trim(),
      date: form.date,
      start: form.start,
      end: form.end,
      notes: form.notes.trim(),
      minutes,
      createdAt: Date.now(),
    }
    // Insert the new session, or replace the one being edited by id.
    setSessions(prev =>
      editingId ? prev.map(s => (s.id === editingId ? session : s)) : [...prev, session],
    )
    // Reset the form back to blank and exit edit mode.
    setForm(emptyForm())
    setEditingId(null)
    setError('')

    // Fire-and-forget sync to Google Sheets (the local save above is already done).
    // The Apps Script endpoint appends a row on every POST, so add and update both
    // just log the session.
    const action = editingId ? 'update' : 'add'
    setSyncStatus({ type: 'saving', msg: 'Saving to Google Sheets…' })
    try {
      await postToSheets({
        action,
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
      setSyncStatus({ type: 'ok', msg: '✓ Saved to Google Sheets' })
    } catch {
      setSyncStatus({ type: 'error', msg: '⚠ Could not reach Google Sheets (saved locally)' })
    }
  }

  /**
   * handleEdit(session)
   * Puts the app into edit mode for the given session: remembers its id in
   * `editingId` and pre-fills the form with the session's current values so the
   * user can modify and resubmit it.
   *
   * @param {object} session - The session object the user clicked Edit on.
   */
  function handleEdit(session) {
    setEditingId(session.id)
    setForm({
      student: session.student,
      subject: session.subject,
      date: session.date,
      start: session.start,
      end: session.end,
      notes: session.notes || '',
    })
    setError('')
  }

  /**
   * handleDelete(id)
   * Deletes a session from local state after a confirmation dialog. If the
   * deleted session was the one being edited, edit mode is cancelled and the
   * form is reset. Google Sheets is append-only, so deletion is local-only.
   *
   * @param {string} id - The id of the session to delete.
   */
  function handleDelete(id) {
    if (!window.confirm('Delete this session?')) return
    setSessions(prev => prev.filter(s => s.id !== id))
    if (editingId === id) {
      setEditingId(null)
      setForm(emptyForm())
    }
    // The Google Sheets endpoint is append-only, so nothing to sync on delete.
    setSyncStatus({
      type: 'ok',
      msg: '🗑 Deleted locally — Google Sheets is append-only',
    })
  }

  /**
   * handleSheetDelete(id)
   * Deletes a record from the Google Sheet itself. Asks for confirmation, then
   * POSTs { action: 'delete', id } to the Apps Script. On success the row is
   * removed from the fetched list and (if it also existed locally) from local
   * state so the dashboard stats stay in sync. The row is disabled while the
   * request is in flight.
   *
   * @param {string} id - The id of the record to delete from the sheet.
   */
  async function handleSheetDelete(id) {
    if (!window.confirm('Delete this session from Google Sheets?')) return
    setDeletingId(id)
    setRecordsError('')
    try {
      await deleteFromSheets(id)
      setSheetRecords(prev => prev.filter(s => s.id !== id))
      setSessions(prev => prev.filter(s => s.id !== id))
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
   * cancelEdit()
   * Exits edit mode without saving: clears `editingId`, resets the form to a
   * blank one, and removes any visible error message.
   */
  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm())
    setError('')
  }

  /**
   * handleExport()
   * Downloads the full sorted session log as a CSV file. Fields containing
   * commas or quotes are wrapped in double quotes with embedded quotes escaped
   * (doubled) to produce valid CSV. Uses a temporary <a> element with an object
   * URL to trigger the download without leaving the page.
   */
  function handleExport() {
    // Column header row for the exported CSV.
    const header = 'Date,Student,Subject,Start,End,Hours,Notes'
    // Map each session to a CSV line; quote/escape text fields for safety.
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
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <span className="app-logo" aria-hidden="true">
            <img src={logo} alt="" className="app-logo-img" />
          </span>
          <div>
            <h1>Englishious Hours Logger</h1>
            <p>Log tutoring sessions and see where your teaching time goes.</p>
          </div>
        </div>
        <button
          className="btn btn-outline"
          type="button"
          onClick={handleExport}
          disabled={sessions.length === 0}
        >
          ⬇ Export CSV
        </button>
      </header>

      {syncStatus && (
        <div className={`sync-status sync-${syncStatus.type}`} role="status">
          <span className="sync-indicator" aria-hidden="true">
            {syncStatus.type === 'saving' ? '⏳' : syncStatus.type === 'ok' ? '✅' : '⚠️'}
          </span>
          {syncStatus.msg}
        </div>
      )}

      <nav className="tabs" role="tablist" aria-label="App views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'dashboard'}
          className={`tab${activeTab === 'dashboard' ? ' active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          📊 Dashboard
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'records'}
          className={`tab${activeTab === 'records' ? ' active' : ''}`}
          onClick={() => setActiveTab('records')}
        >
          📋 All Records
          {sessions.length > 0 && <span className="tab-count">{sessions.length}</span>}
        </button>
      </nav>

      {activeTab === 'dashboard' && (
        <>
      <section className="stats">
        <StatCard label="Total Hours" value={formatMinutes(totals.total)} sub={`${sessions.length} sessions`} />
        <StatCard label="This Week" value={formatMinutes(totals.week)} sub="Since Monday" />
        <StatCard label="This Month" value={formatMinutes(totals.month)} sub={monthLabel(toISODate().slice(0, 7))} />
        <StatCard
          label="Avg / Session"
          value={formatMinutes(sessions.length ? Math.round(totals.total / sessions.length) : 0)}
          sub="per session"
        />
      </section>

      <main className="layout">
        <form className="card form-card" onSubmit={handleSubmit}>
          <h2>{editingId ? '✏️ Edit Session' : '➕ Add Session'}</h2>

          <div className="field">
            <label htmlFor="student">Student</label>
            {/* Strict dropdown: options come from the "Students" tab's "Student
                Names" column in the Google Sheet. Falls back to a free-text
                input only if the list can't be loaded (offline / not deployed). */}
            {studentsLoading || students.length > 0 ? (
              <select
                id="student"
                value={form.student}
                onChange={e => setField('student', e.target.value)}
              >
                <option value="" disabled>
                  {studentsLoading ? 'Loading students…' : 'Select a student…'}
                </option>
                {students.map(name => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                {/* Keep the current value as an option so editing an older
                    session whose student isn't (yet) in the list still works. */}
                {form.student && !students.includes(form.student) && (
                  <option value={form.student}>{form.student}</option>
                )}
              </select>
            ) : (
              <input
                id="student"
                type="text"
                placeholder="e.g. Sara Ahmed"
                value={form.student}
                onChange={e => setField('student', e.target.value)}
              />
            )}
          </div>

          <div className="field">
            <label htmlFor="subject">Subject</label>
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

          <div className="field">
            <label htmlFor="date">Date</label>
            <input id="date" type="date" value={form.date} onChange={e => setField('date', e.target.value)} />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="start">Start time</label>
              <input id="start" type="time" value={form.start} onChange={e => setField('start', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="end">End time</label>
              <input id="end" type="time" value={form.end} onChange={e => setField('end', e.target.value)} />
            </div>
          </div>

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

          <div className={`duration${formMinutes > 0 ? ' duration-on' : ''}`}>
            {formMinutes > 0
              ? `⏱ Duration: ${formatMinutes(formMinutes)}`
              : '⏱ Set start & end times to see duration'}
          </div>

          {error && <p className="error">{error}</p>}

          <div className="form-actions">
            <button className="btn btn-primary" type="submit">
              {editingId ? 'Update Session' : 'Add Session'}
            </button>
            {editingId && (
              <button className="btn btn-outline" type="button" onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>

        <section className="card list-card">
          <div className="list-head">
            <h2>Session Log</h2>
            <div className="search-wrap">
              <span className="search-icon" aria-hidden="true">🔍</span>
              <input
                type="search"
                placeholder="Search student, subject…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="empty">
              <span className="empty-icon" aria-hidden="true">📭</span>
              <p>
                {sessions.length === 0
                  ? 'No sessions logged yet. Add your first one on the left!'
                  : 'No sessions match your search.'}
              </p>
            </div>
          ) : (
            <ul className="session-list">
              {filtered.map(s => (
                <li key={s.id} className={`session-item${editingId === s.id ? ' editing' : ''}`}>
                  <div className="session-date">
                    <span className="day">{s.date.slice(8)}</span>
                    <span className="mon">{MONTHS[Number(s.date.slice(5, 7)) - 1]}</span>
                  </div>
                  <div className="session-main">
                    <div className="session-title">
                      <strong>{s.student}</strong>
                      <span className="chip">{s.subject}</span>
                    </div>
                    <div className="session-meta">
                      {formatDate(s.date)} · {s.start}–{s.end}
                      {s.notes && <span className="notes"> · {s.notes}</span>}
                    </div>
                  </div>
                  <div className="session-hours">{formatMinutes(s.minutes)}</div>
                  <div className="session-actions">
                    <button className="icon-btn" type="button" title="Edit" onClick={() => handleEdit(s)}>
                      ✏️
                    </button>
                    <button
                      className="icon-btn danger"
                      type="button"
                      title="Delete"
                      onClick={() => handleDelete(s.id)}
                    >
                      🗑️
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <section className="breakdown">
        <div className="card">
          <h2>👨‍🎓 Top Students</h2>
          {totals.byStudent.length === 0 ? (
            <p className="muted">No data yet.</p>
          ) : (
            <BarList items={totals.byStudent} max={totals.byStudent[0][1]} format={formatMinutes} />
          )}
        </div>
        <div className="card">
          <h2>📖 Top Subjects</h2>
          {totals.bySubject.length === 0 ? (
            <p className="muted">No data yet.</p>
          ) : (
            <BarList items={totals.bySubject} max={totals.bySubject[0][1]} format={formatMinutes} />
          )}
        </div>
        <div className="card">
          <h2>🗓 Monthly Breakdown</h2>
          {totals.byMonth.length === 0 ? (
            <p className="muted">No data yet.</p>
          ) : (
            <BarList items={totals.byMonth} max={totals.byMonth[0][1]} format={formatMinutes} label={monthLabel} />
          )}
        </div>
      </section>
        </>
      )}

      {activeTab === 'records' && (
        <section className="records">
          <div className="card records-card">
            <div className="list-head">
              <h2>All Records</h2>
              <div className="records-tools">
                <div className="search-wrap">
                  <span className="search-icon" aria-hidden="true">🔍</span>
                  <input
                    type="search"
                    placeholder="Search records…"
                    value={recordsSearch}
                    onChange={e => setRecordsSearch(e.target.value)}
                  />
                </div>
                <span className="records-count">
                  {visibleRecords.length} of {sheetRecords.length} session
                  {sheetRecords.length === 1 ? '' : 's'} from Google Sheets
                </span>
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={() => setRecordsRefresh(n => n + 1)}
                  disabled={recordsLoading}
                >
                  🔄 Refresh
                </button>
              </div>
            </div>

            {recordsError && (
              <p className="records-error" role="alert">
                ⚠ {recordsError}
              </p>
            )}

            {recordsLoading && sheetRecords.length === 0 ? (
              <div className="empty">
                <span className="empty-icon" aria-hidden="true">⏳</span>
                <p>Loading records from Google Sheets…</p>
              </div>
            ) : sheetRecords.length === 0 ? (
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
                  <tbody>
                    {visibleRecords.map(s => (
                      <tr key={s.id} className={deletingId === s.id ? 'row-deleting' : ''}>
                        <td className="td-date">{s.date ? formatDate(s.date) : '—'}</td>
                        <td className="td-student">{s.student || '—'}</td>
                        <td>{s.subject ? <span className="chip">{s.subject}</span> : '—'}</td>
                        <td className="td-time">
                          {s.start && s.end ? `${s.start}–${s.end}` : '—'}
                        </td>
                        <td className="td-hours">{formatMinutes(s.minutes || 0)}</td>
                        <td className="td-notes" title={s.notes || ''}>
                          {s.notes || '—'}
                        </td>
                        <td className="td-actions">
                          {localIds.has(s.id) && (
                            <button
                              className="icon-btn"
                              type="button"
                              title="Edit (local copy)"
                              onClick={() => {
                                handleEdit(s)
                                setActiveTab('dashboard')
                              }}
                            >
                              ✏️
                            </button>
                          )}
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

      <footer className="app-footer">
        <p>Data is saved locally in your browser. 🛡️</p>
      </footer>
    </div>
  )
}