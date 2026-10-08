/* Runs the bundled dist/Code_Ledger.gs against an in-memory Sheet (same emulation as the ctl test). */
const fs = require("fs"), vm = require("vm"), path = require("path"), crypto = require("crypto"), root = path.join(__dirname, "../..");
function start(extraProps) {
const sheets = {}, cache = {}, props = Object.assign({ SOB_INITIAL_ADMIN_PIN: "Adm1n-Setup-77" }, extraProps || {});
const mk = () => { const d = []; return { getLastRow: () => d.length, getLastColumn: () => d.reduce((a, r) => Math.max(a, r.length), 0), getRange(r, c, nr, nc) { return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (d[r - 1 + i] && d[r - 1 + i][c - 1 + j] !== undefined ? d[r - 1 + i][c - 1 + j] : ""))), setValues: (v) => { if (v.length !== nr || v.some((row) => row.length !== nc)) throw new Error("The number of columns in the data does not match the number of columns in the range. The data has " + (v[0] ? v[0].length : 0) + " but the range has " + nc + "."); v.forEach((row, i) => row.forEach((x, j) => { d[r - 1 + i] = d[r - 1 + i] || []; d[r - 1 + i][c - 1 + j] = x; })); }, clearContent: () => { for (let i = 0; i < nr; i++) if (d[r - 1 + i]) for (let j = 0; j < nc; j++) d[r - 1 + i][c - 1 + j] = ""; } }; } }; };
const sb = { SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mk()) }) }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  UrlFetchApp: { fetch() { throw new Error("no network in tests"); } },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) },
  Utilities: { DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 }, computeDigest: (a, s) => Array.from(crypto.createHash("sha256").update(s).digest()).map((b) => (b > 127 ? b - 256 : b)), getUuid: () => crypto.randomUUID() },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, deleteProperty: (k) => { delete props[k]; } }) }, ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) }, console };
vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(root, "dist/Code_Ledger.gs"), "utf8") + "\nthis.doPost=doPost;this.initAdmin=initAdmin;this.setupAdmin=setupAdmin;this.dailyBackup=dailyBackup;this.restoreFromProperty=restoreFromProperty;", sb);
  const call = async (b) => JSON.parse(sb.doPost({ postData: { contents: JSON.stringify(b) } }).s);
  const session = (token) => (b) => call(Object.assign({ token }, b));
  return { sb, props, sheets, call, session, setupAdmin: () => sb.setupAdmin() };
}
module.exports = { start };
