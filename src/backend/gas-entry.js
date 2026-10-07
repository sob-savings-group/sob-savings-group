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
function __env(){
  return { ss: SpreadsheetApp.getActiveSpreadsheet(), lock: LockService.getScriptLock(), hash: __hash, cache: __cacheImpl,
    randomToken: function(){ return Utilities.getUuid().replace(/-/g, ""); }, now: function(){ return new Date().toISOString(); } };
}
function doPost(e){
  var body; try { body = JSON.parse(e.postData.contents); } catch (x) { body = null; }
  return ContentService.createTextOutput(JSON.stringify(__M['backend/api'].handle(__env(), body))).setMimeType(ContentService.MimeType.JSON);
}
function doGet(){ return ContentService.createTextOutput(JSON.stringify({ ok: true, service: "SOB Ledger" })).setMimeType(ContentService.MimeType.JSON); }
function initAdmin(id, pin){
  var env = __env(), S = __M['backend/store'], A = __M['backend/auth'];
  var users = S.readCollection(env.ss, "users");
  if (users.some(function(u){ return u.role === "Admin"; })) throw new Error("An Admin already exists");
  users.push(A.makeUser(env, { id: id, name: id, role: "Admin", pin: pin }));
  S.writeCollection(env.ss, "users", users);
  return "Admin created";
}
