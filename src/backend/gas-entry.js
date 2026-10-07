/* Apps Script entry points. No secret is embedded in the web app: access is by per-user login (Users sheet, hashed PINs).
   First-time setup: run initAdmin("ADMIN", "<pin of 6+ characters>") ONCE from the Apps Script editor, then delete the call from history. */
function __hash(s){
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return d.map(function(b){ return ((b < 0 ? b + 256 : b) + 256).toString(16).slice(1); }).join("");
}
var __cacheImpl = {
  get: function(k){ return CacheService.getScriptCache().get(k); },
  put: function(k, v, ttl){ CacheService.getScriptCache().put(k, String(v), Math.min(ttl, 21600)); },
  remove: function(k){ CacheService.getScriptCache().remove(k); }
};
/* Gateways are OFF unless real credentials are in Script Properties AND the *_LIVE switch is set to "yes-tested" (set it only after
   testSms()/testWhatsApp() from the editor succeeded on your own phone). Nothing here has been run against a real gateway by the developer. */
function __gateways(){
  var p = PropertiesService.getScriptProperties(), g = { adminPhone: p.getProperty("SOB_ADMIN_PHONE") || "" };
  var smsKey = p.getProperty("SOB_SMS_GATEWAY_KEY"), smsUrl = p.getProperty("SOB_SMS_GATEWAY_URL") || "https://www.traccar.org/sms/";
  g.SMS = { live: !!smsKey && p.getProperty("SOB_SMS_LIVE") === "yes-tested", send: function(m){
    var r = UrlFetchApp.fetch(smsUrl, { method: "post", contentType: "application/json", headers: { Authorization: smsKey }, payload: JSON.stringify({ to: m.to, message: m.body }), muteHttpExceptions: true });
    var c = r.getResponseCode(); return c >= 200 && c < 300 ? { ok: true, providerRef: "" } : { ok: false, error: "HTTP " + c + " " + String(r.getContentText()).slice(0, 120) };
  } };
  var waTok = p.getProperty("SOB_WA_TOKEN"), waId = p.getProperty("SOB_WA_PHONE_ID");
  g.WHATSAPP = { live: !!waTok && !!waId && p.getProperty("SOB_WA_LIVE") === "yes-tested", send: function(m){
    var r = UrlFetchApp.fetch("https://graph.facebook.com/v19.0/" + waId + "/messages", { method: "post", contentType: "application/json", headers: { Authorization: "Bearer " + waTok },
      payload: JSON.stringify({ messaging_product: "whatsapp", to: String(m.to).replace("+", ""), type: "text", text: { body: m.body } }), muteHttpExceptions: true });
    var c = r.getResponseCode(); return c >= 200 && c < 300 ? { ok: true, providerRef: "" } : { ok: false, error: "HTTP " + c + " " + String(r.getContentText()).slice(0, 120) };
  } };
  return g;
}
function __gwTest(ch){
  var g = __gateways(), to = g.adminPhone; if (!to) throw new Error("Add Script Property SOB_ADMIN_PHONE (your own number) first");
  var n = __M['core/notify'].normalizePhone(to); if (!n) throw new Error("SOB_ADMIN_PHONE is not a valid Uganda number");
  var a = g[ch]; var saved = a.live; a.live = true;   // test path only: sends one message to the admin's own phone
  var r = a.send({ to: n, body: "SOB test message - gateway check" }); a.live = saved; return JSON.stringify(r);
}
function testSms(){ return __gwTest("SMS"); }
function testWhatsApp(){ return __gwTest("WHATSAPP"); }
function __env(){
  return { gateways: __gateways(), ss: SpreadsheetApp.getActiveSpreadsheet(), lock: LockService.getScriptLock(), hash: __hash, cache: __cacheImpl,
    randomToken: function(){ return Utilities.getUuid().replace(/-/g, ""); }, now: function(){ return new Date().toISOString(); } };
}
var SOB_BUILD = "__BUILD__";
function __json(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
/* Whatever happens inside, the web app answers with JSON - never Google's HTML error page - so the app can always say what went wrong. */
function doPost(e){
  try {
    var body = null; try { body = JSON.parse(e.postData.contents); } catch (x) { body = null; }
    var r = __M['backend/api'].handle(__env(), body);
    if (r && typeof r === "object") r.build = SOB_BUILD;
    return __json(r);
  } catch (err) { return __json({ ok: false, error: "SERVER_ERROR: " + String((err && err.message) || err), build: SOB_BUILD }); }
}
function doGet(){ return __json({ ok: true, service: "SOB Ledger", build: SOB_BUILD }); }
/* Run ONCE from the Apps Script editor after pasting a new Code.gs (Run > authorizeSOB), then Deploy > Manage deployments > Edit > New version.
   It touches every Google service the platform uses so Google asks for the permissions up front; otherwise the web app can answer with an HTML
   "authorization required" page instead of data. */
function authorizeSOB(){
  SpreadsheetApp.getActiveSpreadsheet().getName(); CacheService.getScriptCache().get("x"); PropertiesService.getScriptProperties().getKeys();
  LockService.getScriptLock(); ScriptApp.getProjectTriggers(); UrlFetchApp.getRequest("https://www.google.com/");
  return "SOB is authorised. Build " + SOB_BUILD + ". Now deploy it as a New version.";
}
/* Run ONCE from the Apps Script editor (Run > setupAdmin) after adding Script Properties SOB_INITIAL_ADMIN_ID (optional, default ADMIN)
   and SOB_INITIAL_ADMIN_PIN (6+ characters). The PIN property is deleted as soon as the Admin exists. */
function setupAdmin(){
  var props = PropertiesService.getScriptProperties(), pin = props.getProperty("SOB_INITIAL_ADMIN_PIN"), id = props.getProperty("SOB_INITIAL_ADMIN_ID") || "ADMIN";
  if (!pin) throw new Error("Add Script Property SOB_INITIAL_ADMIN_PIN first");
  var r = initAdmin(id, pin); props.deleteProperty("SOB_INITIAL_ADMIN_PIN"); return r + " (" + id + "); the PIN property has been removed";
}
function initAdmin(id, pin){
  var env = __env(), S = __M['backend/store'], A = __M['backend/auth'];
  var users = S.readCollection(env.ss, "users");
  if (users.some(function(u){ return u.role === "Admin"; })) throw new Error("An Admin already exists");
  users.push(A.makeUser(env, { id: id, name: id, role: "Admin", pin: pin }));
  S.writeCollection(env.ss, "users", users);
  return "Admin created";
}

/* ---- Backups. dailyBackup() is what the trigger runs; it never throws away data (see backend/backup.js retention). ---- */
function dailyBackup(){
  var env = __env(), lock = env.lock; lock.waitLock(30000);
  try { return JSON.stringify(__M['backend/backup'].snapshot(env.ss, env, "daily")); } finally { lock.releaseLock(); }
}
/* Run once from the editor: schedules dailyBackup() every day around 02:00 (Africa/Kampala). Safe to run again (replaces the old trigger). */
function installBackupTrigger(){
  ScriptApp.getProjectTriggers().forEach(function(t){ if (t.getHandlerFunction() === "dailyBackup") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("dailyBackup").timeBased().everyDays(1).atHour(2).create();
  return "dailyBackup scheduled";
}
/* Disaster recovery (editor only): set Script Property SOB_RESTORE_BACKUP_ID to a Backups-sheet id, then Run > restoreFromProperty. The property is cleared afterwards. */
function restoreFromProperty(){
  var p = PropertiesService.getScriptProperties(), id = p.getProperty("SOB_RESTORE_BACKUP_ID"); if (!id) throw new Error("Set Script Property SOB_RESTORE_BACKUP_ID first");
  var env = __env(); env.lock.waitLock(30000);
  try { var r = __M['backend/backup'].restore(env.ss, env, id, "Owner (editor)"); if (r.ok) p.deleteProperty("SOB_RESTORE_BACKUP_ID"); return JSON.stringify(r); } finally { env.lock.releaseLock(); }
}
