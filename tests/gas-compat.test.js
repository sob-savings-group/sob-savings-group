/* Static + runtime guard that dist/Code_Ledger.gs only uses what Apps Script provides, and stays within sensible size/call budgets. */
const assert = require("assert"), fs = require("fs"), vm = require("vm"), path = require("path"), crypto = require("crypto"), { execSync } = require("child_process");
const root = path.join(__dirname, ".."); execSync("node " + path.join(root, "build/build-gs.js"));
const src = fs.readFileSync(path.join(root, "dist/Code_Ledger.gs"), "utf8"); let f = 0; const t = (n, fn) => { try { fn(); console.log("  ok  " + n); } catch (e) { f++; process.exitCode = 1; console.log("FAIL  " + n + "\n      " + e.message); } };
t("bundle parses as a plain script (no import/export, no top-level await)", () => { new vm.Script(src); assert.ok(!/^\s*(import|export)\s/m.test(src)); });
t("no Node/browser-only globals are used outside the module shim", () => {
  const body = src.replace(/function __req[\s\S]*?\n/, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/UrlFetchApp\.fetch/g, "UrlFetchApp_fetch").replace(/(^|[^:])\/\/.*$/gm, "$1"); // shim + comments ignored
  for (const bad of [/\bprocess\./, /\bBuffer\b/, /\bsetTimeout\b/, /\bfetch\(/, /\bwindow\./, /\bdocument\./, /\blocalStorage\b/, /require\("fs"\)|require\("crypto"\)|require\('fs'\)/, /\bconsole\.log\(/]) assert.ok(!bad.test(body), "found " + bad);
});
t("bundle size is well under Apps Script file limits", () => { assert.ok(src.length < 600000, "size " + src.length); });
t("deployment manifest: V8, Kampala time zone, least-privilege scope, public web app (auth is per-user inside the app)", () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, "deploy/appsscript.json"), "utf8"));
  assert.equal(m.runtimeVersion, "V8"); assert.equal(m.timeZone, "Africa/Kampala"); assert.deepEqual(m.oauthScopes, ["https://www.googleapis.com/auth/spreadsheets.currentonly"]); assert.equal(m.webapp.executeAs, "USER_DEPLOYING");
});
t("SCALE: with 20,000 transactions a command reads each sheet once, writes only changed sheets, and stays within call budgets", () => {
  const M = require("../src/core/migrate.js"), raw = require("./helpers/synth.js").legacyRaw();
  const big = M.migrateLegacy(raw, "2026-10-07"); const base = big.transactions.slice(); for (let i = 0; i < 20000; i++) big.transactions.push(Object.assign({}, base[i % base.length], { id: "TXN-BIG" + i }));
  const calls = { get: 0, set: 0, cells: 0 }, sheets = {};
  const mk = () => { const d = []; return { getLastRow: () => d.length, getLastColumn: () => d.reduce((a, r) => Math.max(a, r.length), 0), getRange(r, c, nr, nc) { return { getValues: () => { calls.get++; return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (d[r - 1 + i] && d[r - 1 + i][c - 1 + j] !== undefined ? d[r - 1 + i][c - 1 + j] : ""))); }, setValues: (v) => { calls.set++; calls.cells += v.length * (v[0] || []).length; v.forEach((row, i) => row.forEach((x, j) => { d[r - 1 + i] = d[r - 1 + i] || []; d[r - 1 + i][c - 1 + j] = x; })); }, clearContent: () => {} }; } }; };
  const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mk()) }, cache = {};
  const env = { ss, lock: { waitLock() {}, releaseLock() {} }, now: () => "T", hash: (s) => crypto.createHash("sha256").update(s).digest("hex"), randomToken: () => crypto.randomBytes(8).toString("hex"), cache: { get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } } };
  const S = require("../src/backend/store.js"), A = require("../src/backend/auth.js"), API = require("../src/backend/api.js");
  S.writeCollection(ss, "users", [A.makeUser(env, { id: "ADMIN", role: "Admin", pin: "adminpin1" })]);
  const tk = API.handle(env, { action: "login", id: "ADMIN", pin: "adminpin1" }).token; assert.ok(API.handle(env, { action: "importSnapshot", token: tk, db: big }).ok);
  calls.get = calls.set = calls.cells = 0; const t0 = Date.now();
  const r = API.handle(env, { action: "command", token: tk, name: "addMember", args: { name: "Scale Test" } }); assert.ok(r.ok, r.error);
  const nSheets = Object.keys(S.COLLECTIONS).length;
  assert.ok(calls.get <= nSheets + 3, "reads " + calls.get); assert.deepEqual(r.sheets.sort(), ["auditLog", "members"], "only changed sheets written"); assert.ok(calls.cells < 5000, "cells written " + calls.cells);
  calls.get = 0; assert.ok(API.handle(env, { action: "getLedger", token: tk }).ok); assert.ok(calls.get <= nSheets + 3, "getLedger reads " + calls.get);
  console.log("      (20k rows: command " + (Date.now() - t0) + " ms in-memory, " + nSheets + " sheet reads, " + r.sheets.length + " sheets written)");
});
console.log(f ? f + " FAILED" : "gas-compat passed");
