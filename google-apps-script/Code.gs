/**
 * ============================================================================
 *  Englishious Hours Logger — Google Apps Script backend (complete)
 * ============================================================================
 *  Replace ALL of your existing script code with this file, then re-deploy:
 *  Deploy → Manage deployments → ✎ Edit → Version: "Create new version" →
 *  Execute as: Me → Who has access: Anyone → Deploy.
 *
 *  WORKS WITH THE EXISTING SHEET — keep your current spreadsheet, just swap the
 *  code. The script reads whatever headers are in row 1 and:
 *    • GET  ?action=list                  → returns every row as JSON for the
 *                                           app's "All Records" tab.
 *    • POST { action: 'add'|'update', … } → appends a row (append-only design).
 *    • POST { action: 'delete', id }      → removes the row whose `id` matches.
 *
 *  IMPORTANT — header NAMES must match what the app sends. The app reads these
 *  fields: id, date, studentName, fromTime, toTime, subject, notes, minutes.
 *  If your existing sheet has differently-named columns (e.g. "Student Name"),
 *  rename those columns to match, or old rows will show blanks in the app.
 *
 *  TEXT NORMALIZATION — studentName, subject and notes are returned and stored
 *  in canonical form (trimmed, single-spaced, UPPERCASE) so casing variants like
 *  "Amayra" / "AMAYRA" never split into separate students or subjects. To clean
 *  historical rows once, run normalizeExistingText() from the Apps Script
 *  editor (Run menu), then redeploy.
 * ============================================================================
 */

/** Name of the sheet used for logging (created automatically if missing). */
var SHEET_NAME = 'Sessions';

/** Canonical columns the app understands, in display order. Missing columns are
 *  appended to your existing sheet automatically. */
var HEADERS = [
  'id',
  'date',
  'studentName',
  'fromTime',
  'toTime',
  'subject',
  'notes',
  'minutes',
  'timestamp',
  'hours',
];

/** Free-text columns that are canonicalized on read and write. */
var TEXT_HEADERS = ['studentName', 'subject', 'notes'];

/* ---------------------------------------------------------------------------
 * doGet(e)
 * Returns the full log as JSON. The app calls: GET <scriptUrl>?action=list
 * ------------------------------------------------------------------------- */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'list';
  // ?action=students → return the list of names from the "Students" tab so the
  // app can render the Student field as a strict dropdown.
  if (action === 'students') return listStudents_();
  if (action !== 'list') return json_({ success: false, error: 'Unknown action' });

  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();

  // Header row only (or empty) → nothing to return yet.
  if (values.length < 2) return json_({ success: true, records: [] });

  var headers = values.shift().map(String);
  var records = values
    .filter(function (row) {
      // Skip fully-empty trailing rows.
      return row[0] && String(row[0]).trim() !== '';
    })
    .map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) {
        obj[h] = row[i];
      });
      // Google Sheets returns Date objects for date/time cells. Normalize them
      // to the plain strings the app expects.
      if (obj.date instanceof Date) obj.date = toISODate_(obj.date);
      if (obj.fromTime instanceof Date) obj.fromTime = toTime_(obj.fromTime);
      if (obj.toTime instanceof Date) obj.toTime = toTime_(obj.toTime);
      // Canonical text so every consumer sees one casing per student/subject.
      TEXT_HEADERS.forEach(function (h) {
        if (obj[h] !== undefined) obj[h] = normalizeText_(obj[h]);
      });
      return obj;
    });

  return json_({ success: true, records: records });
}

/* ---------------------------------------------------------------------------
 * doPost(e)
 * Reads JSON from the request body and routes it:
 *   add / update → append a row (the sheet is append-only by design).
 *   delete       → find the row by `id` and delete it.
 * ------------------------------------------------------------------------- */
function doPost(e) {
  // Defensive: `e` is undefined when doPost is invoked without a real HTTP POST
  // event (e.g. clicking Run in the Apps Script editor, or a body-less request).
  // Return a clean JSON error instead of crashing the script.
  if (!e || !e.postData || !e.postData.contents) {
    return json_({ success: false, error: 'Missing POST body' });
  }

  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ success: false, error: 'Invalid JSON body' });
  }

  var sheet = getSheet_();

  if (data.action === 'delete') {
    deleteRowById_(sheet, data.id);
    return json_({ success: true });
  }

  if (data.action === 'add' || data.action === 'update') {
    appendRow_(sheet, data);
    return json_({ success: true });
  }

  return json_({ success: false, error: 'Unknown action: ' + data.action });
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

/** Returns the logging sheet, creating it (with a header row) if needed. */
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    return sheet;
  }
  ensureHeaders_(sheet);
  return sheet;
}

/**
 * listStudents_()
 * Reads the "Students" tab of the spreadsheet, locates the "Student Names"
 * column by its header, and returns every non-empty value as a normalized,
 * de-duplicated list (order preserved). Backs doGet ?action=students so the app
 * can render the Student field as a strict dropdown instead of a free-text box.
 * Because names are uppercased first, "Amayra" and "AMAYRA" collapse into one.
 *
 * @returns {GoogleAppsScript.Content.TextOutput} JSON { success, students }.
 */
function listStudents_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Students');
  // No "Students" tab, or no data rows → nothing to offer yet.
  if (!sheet) return json_({ success: true, students: [] });

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var col = headers.indexOf('Student Names') + 1; // 1-based column; 0 if not found
  if (col < 1 || sheet.getLastRow() < 2) return json_({ success: true, students: [] });

  var names = sheet
    .getRange(2, col, sheet.getLastRow() - 1, 1)
    .getValues()
    .map(function (row) {
      return normalizeText_(row[0]);
    })
    .filter(function (name) {
      return name !== '';
    });

  // De-duplicate while keeping the order names appear in the column.
  var seen = {};
  var unique = names.filter(function (name) {
    if (seen[name]) return false;
    seen[name] = true;
    return true;
  });

  return json_({ success: true, students: unique });
}

/** Makes sure the header row exists and includes every canonical column. */
function ensureHeaders_(sheet) {
  if (sheet.getLastRow() < 1) {
    sheet.appendRow(HEADERS);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var missing = HEADERS.filter(function (h) {
    return existing.indexOf(h) === -1;
  });
  if (missing.length > 0) {
    // Append the missing columns to the right of the current ones.
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
}

/** Appends a row using the sheet's current header order. */
function appendRow_(sheet, data) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var values = headers.map(function (h) {
    // Normalize text before it reaches the sheet, so new rows stay canonical
    // even when written by another client.
    if (TEXT_HEADERS.indexOf(h) !== -1) return normalizeText_(data[h]);
    return data[h] !== undefined ? data[h] : '';
  });
  sheet.appendRow(values);
}

/** Deletes every row whose `id` column equals the given id (bottom-up). */
function deleteRowById_(sheet, id) {
  var values = sheet.getDataRange().getValues();
  var idCol = values[0].indexOf('id') + 1; // 1-based column; 0 if no id column
  if (idCol < 1) return;
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][idCol - 1]) === String(id)) {
      sheet.deleteRow(i + 1);
    }
  }
}

/**
 * normalizeText_(value)
 * Canonical form for free-text values: trim, collapse repeated whitespace, and
 * uppercase. Mirrors normalizeText() in src/normalize.js so reads/writes from
 * the app and the backend agree on one form.
 *
 * Examples: '  Sara   Ahmed ' → 'SARA AHMED' · null → '' · 42 → '42'
 */
function normalizeText_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * normalizeExistingText()
 * ONE-OFF MIGRATION — run manually from the Apps Script editor (Run menu after
 * selecting this function). It is never called by the web app.
 *
 *   1. Upper-cases studentName, subject and notes in the Sessions sheet,
 *      writing only the columns that actually change.
 *   2. Upper-cases and de-duplicates the "Student Names" column of the
 *      Students tab, preserving first-seen order. The Students tab is treated
 *      as a single name list; other columns are left untouched.
 *
 * Safe to re-run: once the data is normalized it reports zero changes.
 */
function normalizeExistingText() {
  var sessionCells = 0;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

  if (sheet && sheet.getLastRow() >= 2) {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    TEXT_HEADERS.forEach(function (header) {
      var col = headers.indexOf(header) + 1; // 1-based; 0 when missing
      if (col < 1) return;
      var range = sheet.getRange(2, col, sheet.getLastRow() - 1, 1);
      var values = range.getValues();
      var changed = 0;
      var normalized = values.map(function (row) {
        var original = row[0] === null || row[0] === undefined ? '' : String(row[0]);
        var next = normalizeText_(row[0]);
        if (next !== original) changed++;
        return [next];
      });
      if (changed > 0) {
        range.setValues(normalized);
        sessionCells += changed;
      }
    });
  }

  var students = normalizeStudentsTab_();

  Logger.log(
    'normalizeExistingText complete: %s session text cell(s) updated, %s student name cell(s) updated, %s duplicate/blank row(s) removed.',
    sessionCells,
    students.cells,
    students.removed,
  );
}

/**
 * normalizeStudentsTab_()
 * Helper for normalizeExistingText(): canonicalizes the "Student Names" column
 * and compacts it to unique names. Returns { cells, removed } counts.
 */
function normalizeStudentsTab_() {
  var result = { cells: 0, removed: 0 };
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Students');
  if (!sheet || sheet.getLastRow() < 2) return result;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var col = headers.indexOf('Student Names') + 1;
  if (col < 1) return result;

  var range = sheet.getRange(2, col, sheet.getLastRow() - 1, 1);
  var values = range.getValues();
  var seen = {};
  var unique = [];

  values.forEach(function (row) {
    var original = row[0] === null || row[0] === undefined ? '' : String(row[0]);
    var name = normalizeText_(row[0]);
    if (name !== original) result.cells++;
    if (!name || seen[name]) return;
    seen[name] = true;
    unique.push([name]);
  });

  result.removed = values.length - unique.length;
  if (result.cells === 0 && result.removed === 0) return result;

  range.clearContent();
  if (unique.length > 0) sheet.getRange(2, col, unique.length, 1).setValues(unique);
  return result;
}

/** Wraps an object as a JSON ContentService response (adds CORS headers). */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/** Formats a Date as "YYYY-MM-DD" in the script's time zone. */
function toISODate_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Formats a Date as "HH:MM" (24h) in the script's time zone. */
function toTime_(d) {
  var h = String(d.getHours()).padStart(2, '0');
  var m = String(d.getMinutes()).padStart(2, '0');
  return h + ':' + m;
}
