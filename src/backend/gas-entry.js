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

/* ---- One-step installation of the verified SOB records (run from the Apps Script editor by the spreadsheet owner: Run > installSOBRecords).
   Needs the private file Code_Records.gs (defines __sobPack). Same audited commands as the app; Admin must exist (setupAdmin). Safe to run again:
   nothing is duplicated. Corrections wait for the Chairperson; after they approve them in the app, run this once more. ---- */
function installSOBRecords(){
  var env = __env(), S = __M['backend/store'], A = __M['backend/auth'], LD = __M['core/loader'], R = __M['core/reports'];
  if (typeof __sobPack !== "function") throw new Error("Add the private file Code_Records.gs to this project first");
  var pack = __sobPack(), users = S.readCollection(env.ss, "users"), admin = users.filter(function(u){ return u.role === "Admin" && u.status !== "Disabled"; })[0];
  if (!admin) throw new Error("Run setupAdmin first");
  var token = env.randomToken() + env.randomToken(); env.cache.put("sess:" + env.hash(token), admin.id, 1500);
  var api = function(b){ return __M['backend/api'].handle(env, Object.assign({ token: token }, b)); };
  var log = function(m){ Logger.log(m); };
  /* Demo clean-up: only when EVERY member is a "Demo Member NNN" sample record and none is a real SOB member (the server enforces this again and takes a backup first). */
  var cur = S.readAll(env.ss), pre = [];
  if (cur.members.length && cur.members.every(function(m){ return /^demo member \d+$/i.test(String(m.name).trim()); })) {
    var pr = api({ action: "purgeDemoLedger", confirm: "REMOVE DEMO DATA", demoNames: cur.members.map(function(m){ return m.name; }), realNames: LD.realNames(pack) });
    pre.push((pr.ok ? "PASS Demo records removed (backup " + pr.backup + "); " + JSON.stringify(pr.removed) : "FAIL Demo clean-up: " + pr.error));
  }
  return LD.load(api, pack, { approvedBy: "Spreadsheet owner, installation, " + new Date().toISOString().slice(0, 10), asOf: new Date().toISOString().slice(0, 10), say: log }).then(function(res){
    var out = pre.slice();
    res.checks.forEach(function(c){ out.push((c.pass ? "PASS " : "FAIL ") + c.name + (c.detail ? " - " + c.detail : "")); });
    (res.pending || []).forEach(function(p){ out.push("WAITING FOR CHAIRPERSON: " + p); });
    if (res.ok) { try { out = out.concat(__provisionSignins(env, S, A, R, pack)); } catch (e) { out.push("FAIL sign-ins: " + e.message); } }
    var sh = env.ss.getSheetByName("SOB Load Log") || env.ss.insertSheet("SOB Load Log");
    sh.clear(); sh.getRange(1, 1, out.length + 1, 1).setValues([["Last run " + new Date().toISOString() + " - " + (res.ok ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED")]].concat(out.map(function(l){ return [l]; })));
    out.forEach(log); return res.ok;
  });
}
/* Sign-ins for the Chairperson, Treasurer and every member that has none. Random one-time PINs go into a sheet "PIN slips - DELETE AFTER PRINTING"; everyone must choose their own at first sign-in. */
function __provisionSignins(env, S, A, R, pack){
  var users = S.readCollection(env.ss, "users"), have = {}; users.forEach(function(u){ have[u.id] = 1; });
  var db = S.readAll(env.ss), rows = [], pin6 = function(){ return ("000000" + Math.floor(Math.random() * 1000000)).slice(-6); }, pin8 = function(){ return String(10000000 + Math.floor(Math.random() * 90000000)); };
  var off = {}; R.OFFICERS.forEach(function(o){ off[o[1]] = o[0]; });
  [["CHAIR", "Chairperson"], ["TREAS", "Treasurer"]].forEach(function(s){ if (have[s[0]]) return; var p = pin8(); users.push(A.makeUser(env, { id: s[0], name: off[s[1]] || s[1], role: s[1], pin: p, mustChange: true })); rows.push([s[0], off[s[1]] || s[1], s[1], p]); });
  db.members.filter(function(m){ return m.status !== "Inactive" && !have[m.id]; }).forEach(function(m){ var p = pin6(); users.push(A.makeUser(env, { id: m.id, name: m.name, role: "Member", memberId: m.id, pin: p, mustChange: true })); rows.push([m.id, m.name, "Member", p]); });
  if (!rows.length) return ["Sign-ins: nothing new to create"];
  S.writeCollection(env.ss, "users", users);
  var sh = env.ss.getSheetByName("PIN slips - DELETE AFTER PRINTING") || env.ss.insertSheet("PIN slips - DELETE AFTER PRINTING");
  var start = sh.getLastRow() + 1; if (start === 1) { sh.getRange(1, 1, 1, 4).setValues([["ID", "Name", "Role", "One-time PIN"]]); start = 2; }
  sh.getRange(start, 1, rows.length, 4).setValues(rows);
  return ["PASS Sign-ins created: " + rows.length + " (Chairperson and Treasurer ID: CHAIR / TREAS; one-time PINs are in the sheet 'PIN slips - DELETE AFTER PRINTING')"];
}
