// Google Apps Script bound to the ratings Google Sheet. Deploy as a web app (see README.md).
// Each POST from the website appends one row to the "ratings" tab.

const SHEET_NAME = "ratings";
const COLUMNS = [
  "received_at", "session_id", "event", "clip", "position", "naturalness", "intelligibility",
  "plays", "seconds", "native", "headphones", "region", "age_range", "client_time", "version",
];
const EVENTS = ["start", "rating", "finish"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    const error = invalid(data);
    if (error) return reply({ ok: false, error: error });
    const values = COLUMNS.map((c) => (c === "received_at" ? new Date().toISOString() : clean(data[c])));
    sheet().appendRow(values);
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Reject rows that cannot come from the website, so random posts do not pollute the sheet.
function invalid(d) {
  if (!/^[\w-]{8,64}$/.test(String(d.session_id))) return "bad session_id";
  if (EVENTS.indexOf(d.event) < 0) return "bad event";
  if (d.event !== "rating") return null;
  if (!/^clip_\d{3}$/.test(String(d.clip))) return "bad clip";
  for (const k of ["naturalness", "intelligibility"]) {
    if ([1, 2, 3, 4, 5].indexOf(d[k]) < 0) return "bad " + k;
  }
  return null;
}

// Short plain text only; a leading = + - @ would make Sheets run it as a formula.
function clean(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return v;
  const s = String(v).slice(0, 100);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function sheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let tab = book.getSheetByName(SHEET_NAME);
  if (!tab) {
    tab = book.insertSheet(SHEET_NAME);
    tab.appendRow(COLUMNS);
    tab.setFrozenRows(1);
  }
  return tab;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// A GET shows that the deployment is live (open the /exec URL in a browser).
function doGet() {
  return reply({ ok: true, service: "sawti-mos" });
}
