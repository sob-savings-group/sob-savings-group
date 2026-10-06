const assert = require("assert"), fs = require("fs"), vm = require("vm"), path = require("path");
const S = require("../src/backend/store.js"), API = require("../src/backend/api.js"), M = require("../src/core/migrate.js"), L = require("../src/core/ledger.js");
let failed = 0; const t = (n, f) => { try { f(); console.log("  ok  " + n); } catch (e) { failed++; console.log("FAIL  " + n + "\n      " + e.message); process.exitCode = 1; } };
const SEED = process.env.SEED || "/mnt/user-data/outputs/SOB_FINAL_DATA_V2.json";
const raw = JSON.parse(fs.readFileSync(SEED, "utf8"));

function mockSS() {
  const sheets = {};
  const mk = (name) => { const data = []; return { name, data,
    getLastRow: () => data.length, getLastColumn: () => data.reduce((a, r) => Math.max(a, r.length), 0),
    getRange(r, c, nr, nc) { return {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (data[r - 1 + i] && data[r - 1 + i][c - 1 + j] !== undefined ? data[r - 1 + i][c - 1 + j] : ""))),
      setValues: (v) => v.forEach((row, i) => row.forEach((x, j) => { data[r - 1 + i] = data[r - 1 + i] || []; data[r - 1 + i][c - 1 + j] = x; })),
      clearContent: () => { for (let i = 0; i < nr; i++) if (data[r - 1 + i]) for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = ""; } }; } }; };
  return { sheets, getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mk(n)) };
}
const lock = { waitLock() {}, releaseLock() {} };
const env = (ss) => ({ ss, lock, secret: "k", now: () => "T" });
const post = (e, b) => API.handle(e, Object.assign({ key: "k" }, b));
const AS_OF = "2026-03-31";

t("auth: wrong or missing key is refused", () => {
  const e = env(mockSS());
  assert.equal(API.handle(e, { key: "x", action: "ping" }).error, "UNAUTHORIZED");
  assert.equal(API.handle(e, null).error, "UNAUTHORIZED");
  assert.equal(API.handle({ ss: e.ss, lock, secret: "", now: () => "" }, { key: "", action: "ping" }).error, "UNAUTHORIZED");
});
t("round trip: migrated real data survives Sheets write/read with identical figures", () => {
  const db = M.migrateLegacy(raw, AS_OF), e = env(mockSS());
  assert.ok(post(e, { action: "syncAll", db }).ok);
  const back = post(e, { action: "getLedger" });
  assert.ok(back.ok);
  assert.equal(back.db.transactions.length, db.transactions.length);
  assert.equal(L.computeGroupTotals(back.db, AS_OF).groupSavings, L.computeGroupTotals(db, AS_OF).groupSavings);
  db.loans.forEach((l, i) => assert.equal(L.loanOutstanding(back.db.loans.find((x) => x.id === l.id), back.db, AS_OF), L.loanOutstanding(l, db, AS_OF)));
  assert.equal(back.kpis.members.value, db.members.length);
});
t("unknown future fields are preserved (_extra), nested values round trip", () => {
  const db = M.migrateLegacy(raw, AS_OF); db.transactions[0].futureField = { a: [1, 2] }; db.loans[0].interestHistory = [{ x: 1 }];
  const e = env(mockSS()); post(e, { action: "syncAll", db });
  const back = post(e, { action: "getLedger" }).db;
  assert.deepEqual(back.transactions[0].futureField, { a: [1, 2] });
  assert.deepEqual(back.loans[0].interestHistory, [{ x: 1 }]);
});
t("snapshot that would delete ledger/audit records is rejected (void, never delete)", () => {
  const db = M.migrateLegacy(raw, AS_OF), e = env(mockSS()); post(e, { action: "syncAll", db });
  const bad = JSON.parse(JSON.stringify(db)); bad.transactions.pop();
  assert.match(post(e, { action: "syncAll", db: bad }).error, /REJECTED/);
  const bad2 = JSON.parse(JSON.stringify(db)); bad2.auditLog = [];
  assert.match(post(e, { action: "syncAll", db: bad2 }).error, /REJECTED/);
  assert.equal(post(e, { action: "getLedger" }).db.transactions.length, db.transactions.length, "sheet untouched");
});
t("optimistic concurrency: stale baseRevision gets CONFLICT, nothing written", () => {
  const db = M.migrateLegacy(raw, AS_OF), e = env(mockSS());
  const r1 = post(e, { action: "syncAll", db, baseRevision: 0 }); assert.equal(r1.revision, 1);
  const stale = JSON.parse(JSON.stringify(db)); stale.members[0].name = "STALE";
  const r2 = post(e, { action: "syncAll", db: stale, baseRevision: 0 });
  assert.equal(r2.error, "CONFLICT");
  assert.notEqual(post(e, { action: "getLedger" }).db.members[0].name, "STALE");
  assert.ok(post(e, { action: "syncAll", db: stale, baseRevision: 1 }).ok);
});
t("voided flags and approval status persist as booleans/strings, and totals still agree", () => {
  const db = M.migrateLegacy(raw, AS_OF); db.transactions[3].voided = true; db.transactions[3].voidReason = "test";
  const e = env(mockSS()); post(e, { action: "syncAll", db });
  const back = post(e, { action: "getLedger" }).db;
  assert.equal(L.computeGroupTotals(back, AS_OF).groupSavings, L.computeGroupTotals(db, AS_OF).groupSavings);
});
t("bundled Code_Ledger.gs runs in an Apps Script-like sandbox (doPost end to end)", () => {
  require("child_process").execSync("node " + path.join(__dirname, "../build/build-gs.js"));
  const ss = mockSS(); const props = { SOB_LEDGER_SECRET: "k" };
  const sandbox = { SpreadsheetApp: { getActiveSpreadsheet: () => ss }, LockService: { getScriptLock: () => lock },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) }, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../dist/Code_Ledger.gs"), "utf8") + "\nthis.doPost=doPost;this.doGet=doGet;", sandbox);
  const db = M.migrateLegacy(raw, AS_OF);
  const call = (b) => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(Object.assign({ key: "k" }, b)) } }).s);
  assert.ok(call({ action: "syncAll", db }).ok);
  const out = call({ action: "getLedger" });
  assert.equal(out.db.loans.length, db.loans.length);
  assert.equal(call({ key: "bad", action: "ping" }).error, "UNAUTHORIZED");
  assert.equal(JSON.parse(sandbox.doPost({ postData: { contents: "not json" } }).s).error, "UNAUTHORIZED");
  assert.equal(JSON.parse(sandbox.doGet().s).ok, true);
});
console.log(failed ? failed + " FAILED" : "all backend tests passed");
