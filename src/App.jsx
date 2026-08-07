import { useEffect, useMemo, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'tuition-hours-logger'
const SHEETS_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbyFUH3Q-pzqjZ0IKFeTnqaW4sBv3WNWumD6HjJFqPl5Jv0pBvJe48k_kJItI8w7NSdp/exec'
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
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/* ---------- helpers ---------- */

function toISODate(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function emptyForm() {
  return { student: '', subject: '', date: toISODate(), start: '', end: '', notes: '' }
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

// Minutes between two "HH:MM" times; handles sessions crossing midnight.
function calcMinutes(start, end) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = eh * 60 + em - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60
  return mins
}

function formatMinutes(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function toDecimalHours(mins) {
  return Math.round((mins / 60) * 100) / 100
}

// Push a record to the Google Sheets backend (Apps Script web app).
// The script's doPost(e) is expected to read JSON.parse(e.postData.contents).
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
  try {
    data = JSON.parse(text)
  } catch {
    data = null
  }
  if (data && data.success === false) throw new Error('Google Sheets rejected the request')
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function startOfCurrentWeekISO() {
  const today = new Date()
  const diff = today.getDay() === 0 ? 6 : today.getDay() - 1
  const monday = new Date(today)
  monday.setDate(today.getDate() - diff)
  return toISODate(monday)
}

function aggregateBy(list, keyFn) {
  const map = new Map()
  for (const s of list) {
    const key = keyFn(s)
    map.set(key, (map.get(key) || 0) + s.minutes)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

/* ---------- small components ---------- */

function StatCard({ label, value, sub }) {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-sub">{sub}</span>
    </div>
  )
}

function BarList({ items, max, format, label }) {
  return (
    <ul className="bar-list">
      {items.map(([key, mins]) => (
        <li key={key} className="bar-row">
          <span className="bar-label" title={label ? label(key) : key}>
            {label ? label(key) : key}
          </span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max(8, (mins / max) * 100)}%` }} />
          </div>
          <span className="bar-value">{format(mins)}</span>
        </li>
      ))}
    </ul>
  )
}

/* ---------- main app ---------- */

export default function App() {
  const [sessions, setSessions] = useState(loadSessions)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [syncStatus, setSyncStatus] = useState(null) // { type: 'saving'|'ok'|'error', msg }

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  }, [sessions])

  const sorted = useMemo(
    () =>
      [...sessions].sort((a, b) =>
        a.date === b.date ? b.start.localeCompare(a.start) : b.date.localeCompare(a.date),
      ),
    [sessions],
  )

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

  const totals = useMemo(() => {
    const today = toISODate()
    const weekStart = startOfCurrentWeekISO()
    const total = sessions.reduce((sum, s) => sum + s.minutes, 0)
    const week = sessions
      .filter(s => s.date >= weekStart && s.date <= today)
      .reduce((sum, s) => sum + s.minutes, 0)
    const month = sessions
      .filter(s => s.date.startsWith(today.slice(0, 7)))
      .reduce((sum, s) => sum + s.minutes, 0)
    const byStudent = aggregateBy(sessions, s => s.student).slice(0, 5)
    const bySubject = aggregateBy(sessions, s => s.subject).slice(0, 5)
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

  const formMinutes = calcMinutes(form.start, form.end)

  function setField(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    if (error) setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.student.trim() || !form.subject.trim() || !form.date || !form.start || !form.end) {
      setError('Please fill in student, subject, date, and times.')
      return
    }
    const minutes = calcMinutes(form.start, form.end)
    if (minutes <= 0) {
      setError('End time must be after start time.')
      return
    }
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
    setSessions(prev =>
      editingId ? prev.map(s => (s.id === editingId ? session : s)) : [...prev, session],
    )
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

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm())
    setError('')
  }

  function handleExport() {
    const header = 'Date,Student,Subject,Start,End,Hours,Notes'
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
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tuition-hours-${toISODate()}.csv`
    a.click()
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