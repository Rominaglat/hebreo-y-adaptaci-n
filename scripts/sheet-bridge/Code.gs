/**
 * Sheet bridge for the portal's subscriptions dashboard (/admin/users).
 *
 * Runs as a Web App under the Google account of someone who can OPEN the
 * customer-tracking sheet — view access is enough; no Google Cloud project and
 * no sharing needed. The portal's sync-subscriptions-sheet edge function POSTs
 * {"token": "..."} here and gets back the "תלמידים" tab exactly as displayed.
 * Nothing else is readable through it.
 *
 * Setup (script.google.com, signed in with that account):
 *   1. New project → paste this file.
 *   2. Project Settings → Script properties → BRIDGE_TOKEN = the same value as
 *      the Supabase secret SHEET_BRIDGE_TOKEN.
 *   3. Run `authorize` once from the editor and accept the permissions.
 *   4. Deploy → New deployment → Web app → Execute as: Me,
 *      Who has access: Anyone → copy the /exec URL into the Supabase secret
 *      SHEET_BRIDGE_URL.
 * After editing this file, redeploy (Manage deployments → edit → New version)
 * so the /exec URL keeps working with the new code.
 *
 * Canonical copy: scripts/sheet-bridge/Code.gs in the portal repo.
 */

var SHEET_ID = '1D3gblg5NqEUVa53bFPQ8A9qDlGXw3VaCQJrK0PwTgQY';
var TAB_NAME = 'תלמידים';

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    body = {};
  }

  var expected = PropertiesService.getScriptProperties().getProperty('BRIDGE_TOKEN');
  if (!expected || body.token !== expected) {
    return json_({ ok: false, error: 'unauthorized' });
  }

  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB_NAME);
  if (!sheet) {
    return json_({ ok: false, error: 'tab_not_found' });
  }
  // Display values: the strings people see ('₪244.00', '13-07-2026'), which is
  // what the portal's parser expects.
  return json_({ ok: true, values: sheet.getDataRange().getDisplayValues() });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor so Google asks for access to the sheet. */
function authorize() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB_NAME);
  Logger.log(sheet ? 'OK — ' + sheet.getLastRow() + ' rows in "' + TAB_NAME + '"' : 'Tab "' + TAB_NAME + '" not found');
}
