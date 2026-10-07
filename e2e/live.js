/* Live-mode E2E: the real UI talks (over HTTP) to the real backend code running against a mock Sheet. Proves sign-in, server-side
   role enforcement even when the browser is tampered with, and that members only receive their own data. */
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const S = require("../src/backend/store.js"), A = require("../src/backend/auth.js"), API = require("../src/backend/api.js"), M = require("../src/core/migrate.js"), L = require("../src/core/ledger.js");
const root = path.join(__dirname, ".."), raw = JSON.parse(fs.readFileSync(process.env.SEED || path.join(root, "app/demo-seed.json"), "utf8"));
const db0 = M.migrateLegacy(raw, "2026-03-31"), mem = db0.members.find((m) => L.memberSavings(db0, m.id) > 0);
const sheets = {}; const mk = (n) => { const d = []; return { d, getLastRow: () => d.length, getLastColumn: () => d.reduce((a, r) => Math.max(a, r.length), 0), getRange(r, c, nr, nc) { return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (d[r - 1 + i] && d[r - 1 + i][c - 1 + j] !== undefined ? d[r - 1 + i][c - 1 + j] : ""))), setValues: (v) => v.forEach((row, i) => row.forEach((x, j) => { d[r - 1 + i] = d[r - 1 + i] || []; d[r - 1 + i][c - 1 + j] = x; })), clearContent: () => { for (let i = 0; i < nr; i++) if (d[r - 1 + i]) for (let j = 0; j < nc; j++) d[r - 1 + i][c - 1 + j] = ""; } }; } }; };
const cache = {}, env = { ss: { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mk(n)) }, lock: { waitLock() {}, releaseLock() {} }, now: () => "T",
  hash: (s) => crypto.createHash("sha256").update(s).digest("hex"), randomToken: () => crypto.randomBytes(8).toString("hex"), cache: { get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } } };
S.writeCollection(env.ss, "users", [A.makeUser(env, { id: "ADMIN", role: "Admin", pin: "admin-pin-1" }), A.makeUser(env, { id: mem.id, role: "Member", memberId: mem.id, pin: "1234" })]);
const adminTok = API.handle(env, { action: "login", id: "ADMIN", pin: "admin-pin-1" }).token; API.handle(env, { action: "importSnapshot", token: adminTok, db: db0 });
API.handle(env, { action: "command", token: adminTok, name: "openDiscrepancy", args: { kind: "SAVINGS_BALANCE", subject: mem.id, summary: "e2e discrepancy", platformValue: 1, sourceValue: 2, source: "e2e" } });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  if (u === "/api") { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { r.writeHead(200, { "Content-Type": "application/json" }); r.end(JSON.stringify(API.handle(env, JSON.parse(b)))); }); return; }
  if (u === "/app/config.js") { r.writeHead(200, { "Content-Type": "text/javascript" }); return r.end('window.SOB_CONFIG={ledgerUrl:"/api"};'); }
  const site = process.env.SITE ? path.join(root, process.env.SITE) : null; const f = site && u.startsWith("/app/") ? path.join(site, u.slice(5)) : path.join(root, u); if (!(f.startsWith(root)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f));
});
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "FAIL  ") + m); if (!c) { fails++; process.exitCode = 1; } };
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }); const pg = await b.newPage(); const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(base + "/app/index.html"); await pg.waitForSelector("#login-go");
  ok((await pg.locator("#demo-go").count()) === 0, "live mode shows a real sign-in, not the demo role picker");
  await pg.fill("#mid", "ADMIN"); await pg.fill("#pin", "wrong"); await pg.click("#login-go"); await pg.waitForSelector(".toast.bad"); ok(true, "wrong PIN is refused");
  await pg.fill("#pin", "admin-pin-1"); await pg.click("#login-go"); await pg.waitForSelector("#kpis"); ok((await pg.locator("#kpis .card").count()) === 8, "admin signs in and sees the 8 KPI cards (server-computed ledger view)");
  await pg.click('[data-nav="ledger"]'); await pg.click("#add-entry"); await pg.selectOption('.modal select[name="m"]', mem.id); await pg.fill('.modal input[name="amount"]', "3000"); await pg.click("[data-submit]");
  await pg.waitForSelector(".toast:not(.bad)"); ok(L.memberSavings(S.readAll(env.ss), mem.id) === L.memberSavings(db0, mem.id) + 3000, "an entry made in the UI is persisted by the server");
  
  await pg.click('[data-nav="recon"]'); await pg.waitForSelector("#main table"); ok((await pg.locator("#main tbody tr").count()) === 1, "reconciliation register is visible to Admin");
  await pg.click("#main tbody tr"); await pg.click('[data-act="resolve"]'); await pg.fill('.modal input[name="reason"]', "older snapshot"); await pg.click("[data-submit]"); await pg.waitForFunction(() => document.querySelector(".modal .err") && document.querySelector(".modal .err").textContent.length > 0); ok(true, "resolving without evidence is refused with a clear message");
  await pg.fill('.modal input[name="evidence"]', "row diff"); await pg.click("[data-submit]"); await pg.waitForSelector(".toast:not(.bad)");
  ok(S.readAll(env.ss).discrepancies[0].status === "Resolved" && S.readAll(env.ss).discrepancies[0].evidence === "row diff", "resolution is saved with decision and evidence");
  await pg.click('[data-nav="members"]'); await pg.click("#main tbody tr:first-child"); await pg.waitForSelector('.modal [data-act="reset-pin"], .modal [data-act="create-signin"]'); ok(true, "Admin sees PIN management on a member profile");
  await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((e) => e.remove()));
  await pg.click("#logout"); await pg.waitForSelector("#login-go");
  await pg.fill("#mid", mem.id); await pg.fill("#pin", "1234"); await pg.click("#login-go"); await pg.waitForSelector('[data-card="My Savings"]');
  ok((await pg.locator('[data-nav="ledger"]').count()) === 0, "member sees member navigation only");
  const hack = await pg.evaluate(async () => { const tk = sessionStorage.getItem("sob.session");
    const call = async (body) => (await (await fetch("/api", { method: "POST", body: JSON.stringify(Object.assign({ token: tk }, body)) })).json());
    const members = (await call({ action: "getLedger" })).db;
    return { write: await call({ action: "command", name: "createEntry", args: { date: "2026-02-01", memberId: members.members[0].id, amount: 99999, type: "Savings" } }),
      roleSpoof: await call({ action: "command", role: "Admin", name: "voidLoan", args: { loanId: "x", reason: "y" } }), snapshot: await call({ action: "syncAll", db: {} }),
      others: new Set(members.transactions.map((t) => t.memberId)).size, audit: members.auditLog.length, users: members.users.length }; });
  ok(/FORBIDDEN/.test(hack.write.error), "tampered browser: member cannot create ledger entries (server refuses)");
  ok(/FORBIDDEN/.test(hack.roleSpoof.error), "tampered browser: spoofed role is ignored");
  ok(hack.snapshot.error === "UNKNOWN_ACTION", "tampered browser: no snapshot-write endpoint exists");
  ok(hack.others === 1 && hack.audit === 0 && hack.users === 0, "member's data download contains only their own records");
  ok(S.readAll(env.ss).transactions.length === db0.transactions.length + 1, "ledger unchanged by the attack attempts");
  await pg.click("#my-pin"); await pg.fill('.modal input[name="o"]', "1234"); await pg.fill('.modal input[name="n"]', "55"); await pg.click("[data-submit]"); await pg.waitForFunction(() => /PIN must be at least/.test((document.querySelector(".modal .err") || {}).textContent || "")); ok(true, "weak new PIN is refused");
  await pg.fill('.modal input[name="n"]', "7777"); await pg.click("[data-submit]"); await pg.waitForSelector(".toast:not(.bad)");
  await pg.reload(); await pg.waitForSelector('[data-card="My Savings"]'); ok(true, "refresh keeps the session; sign-out ends it");
  await pg.click("#logout"); await pg.waitForSelector("#login-go");
  await pg.fill("#mid", mem.id); await pg.fill("#pin", "1234"); await pg.click("#login-go"); await pg.waitForSelector(".toast.bad"); ok(true, "old PIN no longer works after the change");
  await pg.fill("#pin", "7777"); await pg.click("#login-go"); await pg.waitForSelector('[data-card="My Savings"]'); ok(true, "new PIN works");
  ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join("|") : ""));
  await b.close(); srv.close(); console.log(fails ? fails + " FAILED" : "live e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
