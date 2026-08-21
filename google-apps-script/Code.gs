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
 * column by its header, and returns every non-empty value as a de-duplicated
 * list (order preserved). Backs doGet ?action=students so the app can render
 * the Student field as a strict dropdown instead of a free-text box.
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
      return String(row[0]).trim();
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
