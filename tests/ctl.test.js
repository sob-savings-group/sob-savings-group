/* End-to-end test of the DEPLOYMENT PROCESS: the exact bundled Code_Ledger.gs runs behind a real HTTP server, and the real `sobctl`
   CLI (child process) provisions, imports, verifies, reconciles and attacks it — the same commands you run against Google. */
const assert = require("assert"), fs = require("fs"), vm = require("vm"), path = require("path"), http = require("http"), crypto = require("crypto"), os = require("os"), { spawn, execSync } = require("child_process");
const root = path.join(__dirname, ".."), synth = require("./helpers/synth.js"), dataDir = synth.writeTmp(), legacy = process.env.SEED || path.join(dataDir, "legacy.json");
execSync("node " + path.join(root, "build/build-gs.js"));
const sheets = {}, cache = {}, props = { SOB_INITIAL_ADMIN_PIN: "Adm1n-Setup-77" };
const mk = () => { const d = []; return { getLastRow: () => d.length, getLastColumn: () => d.reduce((a, r) => Math.max(a, r.length), 0), getRange(r, c, nr, nc) { return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (d[r - 1 + i] && d[r - 1 + i][c - 1 + j] !== undefined ? d[r - 1 + i][c - 1 + j] : ""))), setValues: (v) => v.forEach((row, i) => row.forEach((x, j) => { d[r - 1 + i] = d[r - 1 + i] || []; d[r - 1 + i][c - 1 + j] = x; })), clearContent: () => { for (let i = 0; i < nr; i++) if (d[r - 1 + i]) for (let j = 0; j < nc; j++) d[r - 1 + i][c - 1 + j] = ""; } }; } }; };
const sb = { SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mk()) }) }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, deleteProperty() {} }) }, UrlFetchApp: { fetch() { throw new Error("no network in tests"); } },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) },
  Utilities: { DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 }, computeDigest: (a, s) => Array.from(crypto.createHash("sha256").update(s).digest()).map((b) => (b > 127 ? b - 256 : b)), getUuid: () => crypto.randomUUID() },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, deleteProperty: (k) => { delete props[k]; } }) }, ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) }, console };
vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(root, "dist/Code_Ledger.gs"), "utf8") + "\nthis.doPost=doPost;this.initAdmin=initAdmin;this.setupAdmin=setupAdmin;", sb);
const srv = http.createServer((q, r) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { r.writeHead(200, { "Content-Type": "application/json" }); r.end(sb.doPost({ postData: { contents: b } }).s); }); });
const run = (args, env) => new Promise((res) => { const p = spawn("node", [path.join(root, "tools/sobctl.js")].concat(args), { env: Object.assign({}, process.env, env) }); let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("close", (code) => res({ code, out })); });
const rawLegacy = JSON.parse(fs.readFileSync(legacy, "utf8")), rawTx = rawLegacy.transactions.length, expectedSavings = require("../src/core/ledger.js").computeGroupTotals(require("../src/core/migrate.js").migrateLegacy(rawLegacy, "2026-10-07"), "2026-10-07").groupSavings;
let f = 0; const tests = []; const t = (n, fn) => tests.push([n, fn]);
(async () => {
  await new Promise((r) => srv.listen(0, r)); const url = "http://localhost:" + srv.address().port + "/exec"; const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sob-ctl-"));
  const adminPin = "Adm1n-Setup-77", base = { SOB_URL: url, SOB_ADMIN_ID: "ADMIN", SOB_ADMIN_PIN: adminPin, SOB_AS_OF: "2026-10-07" };
  t("one-time admin setup from Script Properties (as run in the Apps Script editor); the PIN property is deleted afterwards", () => { assert.match(sb.setupAdmin(), /Admin created \(ADMIN\).*removed/); assert.equal(props.SOB_INITIAL_ADMIN_PIN, undefined); assert.throws(() => sb.setupAdmin(), /Add Script Property|already exists/); });
  t("provisioning refuses to write PIN slips inside the repository", () => { assert.throws(() => execSync("node " + path.join(root, "tools/provision-users.js") + " " + legacy + " " + path.join(root, "provisioned-test"), { stdio: "pipe" }), /REFUSED/); });
  t("provisioning writes hashed users + printable slips (staff + every member)", () => {
    execSync("node " + path.join(root, "tools/provision-users.js") + " " + legacy + " " + tmp + ' --staff "TREAS:Committee:Treasurer"');
    const users = JSON.parse(fs.readFileSync(path.join(tmp, "users.json"), "utf8")), raw = JSON.parse(fs.readFileSync(legacy, "utf8"));
    assert.equal(users.length, raw.members.length + 1); assert.ok(users.every((u) => /^[0-9a-f]{64}$/.test(u.pinHash)));
    const slips = fs.readFileSync(path.join(tmp, "pin-slips.csv"), "utf8"); assert.ok(!users.some((u) => slips.includes(u.pinHash)), "slips hold PINs, users.json holds only hashes");
    assert.ok(!fs.readFileSync(path.join(tmp, "users.json"), "utf8").match(/"pin"/));
  });
  t("import-ledger --dry-run verifies the migration without writing", async () => {
    const r = await run(["import-ledger", legacy, "--dry-run"], base); assert.equal(r.code, 0, r.out); assert.match(r.out, /local migration verified/);
    assert.match((await run(["verify"], base)).out, /"transactions": 0/);
  });
  t("import-ledger migrates into the empty Sheet and every readback check passes", async () => { const r = await run(["import-ledger", legacy], base); assert.equal(r.code, 0, r.out); assert.ok(!/FAIL/.test(r.out), r.out); });
  t("a second import is refused (ledger is no longer empty)", async () => { const r = await run(["import-ledger", legacy], base); assert.notEqual(r.code, 0); assert.match(r.out, /NOT_EMPTY/); });
  t("import-users loads the hashed sign-ins; duplicates refused", async () => {
    const r = await run(["import-users", path.join(tmp, "users.json")], base); assert.equal(r.code, 0, r.out); assert.match(r.out, /"added":\d+/);
    assert.notEqual((await run(["import-users", path.join(tmp, "users.json")], base)).code, 0);
  });
  const slipFor = (id) => fs.readFileSync(path.join(tmp, "pin-slips.csv"), "utf8").split("\n").slice(1).filter(Boolean).map((l) => l.split(",")).find((s) => s[0] === id);
  t("before the reconciliation register exists, smoke flags the unaccounted data errors (and nothing else)", async () => {
    const m = slipFor("SOB-002"), r = await run(["smoke"], Object.assign({}, base, { SOB_MEMBER_ID: m[0], SOB_MEMBER_PIN: m[3] }));
    assert.notEqual(r.code, 0); const fails = r.out.split("\n").filter((l) => l.startsWith("FAIL")); assert.equal(fails.length, 1, r.out); assert.match(fails[0], /accounted for/);
    assert.match(r.out, /BAD_AMOUNT/); assert.match(r.out, /NEGATIVE_SAVINGS/); assert.match(r.out, /PASS member cannot write ledger entries/);
  });
  t("a wrong member PIN makes smoke fail at sign-in", async () => { const m = slipFor("SOB-002"); assert.notEqual((await run(["smoke"], Object.assign({}, base, { SOB_MEMBER_ID: m[0], SOB_MEMBER_PIN: "000000x" }))).code, 0); });
  t("register-discrepancies records the reconciliation findings (no figure changes)", async () => {
    const reconCmd = (extra) => "node " + path.join(root, "tools/reconcile-data.js") + " " + legacy + " " + (process.env.SYSTEM_ROWS || path.join(dataDir, "system.json")) + " " + (process.env.DATABASE_ROWS || path.join(dataDir, "database.json")) + " 2026-10-07 " + tmp + "/recon" + (extra || "");
    execSync(reconCmd()); const first = JSON.parse(fs.readFileSync(path.join(tmp, "recon/reconciliation.json"), "utf8")), adminSubject = first.discrepancies.find((d) => d.subject.startsWith("ADMIN_LOAN:")).subject;
    fs.writeFileSync(path.join(tmp, "resolutions.json"), JSON.stringify([{ subject: adminSubject, decision: "ACCEPT_PLATFORM", reason: "Loan was the single recorded amount; the bank-level row is not a second loan", evidence: "Confirmed by SOB Admin" }, { subject: "NOT_PRESENT:X", decision: "ACCEPT_PLATFORM", reason: "r", evidence: "e" }]));
    execSync(reconCmd(" " + path.join(tmp, "resolutions.json")));
    const before = JSON.parse((await run(["verify"], base)).out).totals; const r = await run(["register-discrepancies", path.join(tmp, "recon/reconciliation.json")], base); assert.equal(r.code, 0, r.out);
    assert.ok(!/"ok": false/.test(r.out), r.out); const after = JSON.parse((await run(["verify"], base)).out); assert.deepEqual(after.totals, before); assert.ok(after.counts.openDiscrepancies >= 4); const rec = JSON.parse(fs.readFileSync(path.join(tmp, "recon/reconciliation.json"), "utf8")); assert.equal(rec.adminUnmatched, 1, "bank-level loan row without a member-ledger match is found"); assert.equal(rec.resolutions.length, 1, "only resolutions matching a real finding are kept");
    const led = JSON.parse((await run(["verify"], base)).out); assert.equal(rec.discrepancies.length - 1, led.counts.openDiscrepancies, "the answered item was closed, the rest stay open");
    const m = slipFor("SOB-002"); const sm = await run(["smoke"], Object.assign({}, base, { SOB_MEMBER_ID: m[0], SOB_MEMBER_PIN: m[3] })); assert.equal(sm.code, 0, sm.out); assert.match(sm.out, /PASS member sees only their own/); assert.match(sm.out, /accounted for in the reconciliation register/);
  });
  t("apply-plan REFUSES without a named approver", async () => { const r = await run(["apply-plan", path.join(tmp, "recon/reconciliation.json")], base); assert.notEqual(r.code, 0); assert.match(r.out, /approved-by/); assert.match((await run(["verify"], base)).out, new RegExp("\"transactions\": " + rawTx)); });
  t("apply-plan with an approver applies the audited corrections; savings unchanged; balances as predicted", async () => {
    const r = await run(["apply-plan", path.join(tmp, "recon/reconciliation.json"), "--approved-by", "Test Approver, Chairperson, 2026-10-07"], base); assert.equal(r.code, 0, r.out); assert.ok(!/FAIL/.test(r.out), r.out);
    const v = JSON.parse((await run(["verify"], base)).out); assert.equal(v.totals.groupSavings, expectedSavings);
  });
  t("smoke-write is refused unless explicitly allowed; passes on a scratch deployment", async () => {
    assert.notEqual((await run(["smoke-write"], base)).code, 0);
    const r = await run(["smoke-write"], Object.assign({}, base, { SOB_ALLOW_WRITE_TESTS: "yes" })); assert.equal(r.code, 0, r.out);
  });
  for (const [n, fn] of tests) { try { await fn(); console.log("  ok  " + n); } catch (e) { f++; console.log("FAIL  " + n + "\n      " + String(e.message).split("\n").slice(0, 6).join("\n      ")); } }
  srv.close(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); console.log(f ? f + " FAILED" : tests.length + " ctl tests passed"); process.exit(f ? 1 : 0);
})();
