// React Hooks used throughout the app:
// - useEffect: runs side effects (persisting data) after a render.
// - useMemo: caches expensive computed values so they are only recalculated when deps change.
// - useState: holds component state (sessions, form fields, UI flags, etc.).
import { useEffect, useMemo, useState } from 'react'

// Global stylesheet (layout, cards, bars, buttons, form fields, etc.).
import './App.css'

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
  'https://script.google.com/macros/s/AKfycbyFUH3Q-pzqjZ0IKFeTnqaW4sBv3WNWumD6HjJFqPl5Jv0pBvJe48k_kJItI8w7NSdp/exec'

/**
 * SUBJECT_PRESETS
 * A list of suggested subjects rendered into a <datalist> element. When the
 * user types in the subject input, the browser offers these as autocomplete
 * suggestions for faster entry and consistent naming across sessions.
 */
const SUBJECT_PRESETS = [
  'Math',
  'Physics',
  'Chemistry',
  'Biology',
  'English',
  'Computer Science',
  'Economics',
  'Accounting',
]

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
  const text = await res.text()
  let data
  // The script may respond with JSON; parse it defensively in case it returns
  // plain text or an HTML error page instead.
  try {
    data = JSON.parse(text)
  } catch {
    data = null
  }
  // Treat an explicit rejection from the script as an error.
  if (data && data.success === false) throw new Error('Google Sheets rejected the request')
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

  // ---------- Side effect: persist sessions ----------

  // Every time `sessions` changes (add/edit/delete), write the whole array to
  // localStorage so the data survives page reloads.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  }, [sessions])

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
          <span className="app-logo" aria-hidden="true">🧑‍🏫</span>
          <div>
            <h1>Online Tuition Hours Logger</h1>
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
            <input
              id="student"
              type="text"
              placeholder="e.g. Sara Ahmed"
              value={form.student}
              onChange={e => setField('student', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="subject">Subject</label>
            <input
              id="subject"
              type="text"
              list="subject-presets"
              placeholder="e.g. Math"
              value={form.subject}
              onChange={e => setField('subject', e.target.value)}
            />
            <datalist id="subject-presets">
              {SUBJECT_PRESETS.map(s => (
                <option key={s} value={s} />
              ))}
            </datalist>
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

      <footer className="app-footer">
        <p>Data is saved locally in your browser. 🛡️</p>
      </footer>
    </div>
  )
}