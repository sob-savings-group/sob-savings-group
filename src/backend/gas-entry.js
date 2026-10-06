/* Apps Script entry points. Secret lives in Script Properties (key: SOB_LEDGER_SECRET), never in source. */
function __env(){
  return { ss: SpreadsheetApp.getActiveSpreadsheet(), lock: LockService.getScriptLock(),
    secret: PropertiesService.getScriptProperties().getProperty("SOB_LEDGER_SECRET"), now: function(){ return new Date().toISOString(); } };
}
function doPost(e){
  var body; try { body = JSON.parse(e.postData.contents); } catch (x) { body = null; }
  return ContentService.createTextOutput(JSON.stringify(__M['backend/api'].handle(__env(), body))).setMimeType(ContentService.MimeType.JSON);
}
function doGet(){ return ContentService.createTextOutput(JSON.stringify({ ok: true, service: "SOB Ledger" })).setMimeType(ContentService.MimeType.JSON); }
