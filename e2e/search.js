/* Smart search overlay. Synthetic members. OFFLINE. */
require("./_nav");
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const S = require("../src/backend/store.js"), A = require("../src/backend/auth.js"), API = require("../src/backend/api.js"), L = require("../src/core/ledger.js"), G = require("../src/core/governance.js"), LN = require("../src/core/loans.js"), D = require("../src/core/dates.js");
const root = path.join(__dirname, "..");
const sheets = {}; const mk = (n) => { const d = []; return { d, getLastRow: () => d.length, getLastColumn: () => d.reduce((a, r) => Math.max(a, r.length), 0), getRange(r, c, nr, nc) { return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (d[r - 1 + i] && d[r - 1 + i][c - 1 + j] !== undefined ? d[r - 1 + i][c - 1 + j] : ""))), setValues: (v) => { if (v.length !== nr || v.some((row) => row.length !== nc)) throw new Error("The number of columns in the data does not match the number of columns in the range. The data has " + (v[0] ? v[0].length : 0) + " but the range has " + nc + "."); v.forEach((row, i) => row.forEach((x, j) => { d[r - 1 + i] = d[r - 1 + i] || []; d[r - 1 + i][c - 1 + j] = x; })); }, clearContent: () => { for (let i = 0; i < nr; i++) if (d[r - 1 + i]) for (let j = 0; j < nc; j++) d[r - 1 + i][c - 1 + j] = ""; } }; } }; };
const cache = {}, env = { ss: { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mk(n)) }, lock: { waitLock() {}, releaseLock() {} }, now: () => new Date().toISOString(), gateways: { adminPhone: "0772000000", SMS: null },
  hash: (s) => crypto.createHash("sha256").update(s).digest("hex"), randomToken: () => crypto.randomBytes(8).toString("hex"), cache: { get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } } };
/* ---- synthetic world, relative to the real date so it never goes stale ---- */
const today = D.todayISO(), ctxA = (role, extra) => G.makeCtx(Object.assign({ id: role, name: role, role }, extra || {}), { today, now: new Date().toISOString() });
const yr = Number(today.slice(0, 4)), soYear = today > yr + "-12-05" ? yr + 1 : yr, SO = soYear + "-12-19", DL = soYear + "-12-05", back = (months) => D.addMonths(today, -months);
const db0 = { members: [], transactions: [], loans: [], auditLog: [], guarantees: [], policy: [], yearCycles: [], approvalRequests: [], reminders: [], schemaVersion: 2, seq: 0 };
const M1 = G.addMember(db0, ctxA("Admin"), { name: "Grace Alpha", regDate: "2025-01-02", phone: "0772111001" }), M2 = G.addMember(db0, ctxA("Admin"), { name: "Peter Bravo", regDate: "2025-01-02", phone: "0772111002" }),
  M3 = G.addMember(db0, ctxA("Admin"), { name: "Ruth Charlie", regDate: "2025-01-02", phone: "" }), M4 = G.addMember(db0, ctxA("Admin"), { name: "Settled Delta", regDate: "2025-01-02", phone: "0772111004" });
[M1, M2, M3, M4].forEach((m) => G.createEntry(db0, ctxA("Admin"), { date: back(10), memberId: m.id, amount: 600000, type: "Savings" }));
const mkLoan = (m, amt, rate, months) => { const day = back(months), mc = G.makeCtx({ id: m.id, name: m.name, role: "Member", memberId: m.id }, { today: day, now: day + "T08:00:00Z" }), l = LN.applyForLoan(db0, mc, m.id, amt);
  LN.approveLoan(db0, G.makeCtx({ id: "A", name: "A", role: "Admin" }, { today: day, now: day + "T08:00:00Z" }), l.id); LN.approveLoan(db0, G.makeCtx({ id: "C", name: "C", role: "Chairperson" }, { today: day, now: day + "T08:00:00Z" }), l.id);
  LN.disburseLoan(db0, G.makeCtx({ id: "A", name: "A", role: "Admin" }, { today: day, now: day + "T08:00:00Z" }), l.id, { date: day, assignedMonthlyInterest: rate }); return l; };
const l1 = mkLoan(M1, 100000, 10000, 3), l2 = mkLoan(M2, 200000, 20000, 2), l3 = mkLoan(M3, 50000, 5000, 2), l4 = mkLoan(M4, 30000, 3000, 2);
LN.repayLoan(db0, ctxA("Admin"), l4.id, L.loanOutstanding(l4, db0, today), today);
S.writeCollection(env.ss, "users", [A.makeUser(env, { id: "ADMIN", role: "Admin", pin: "admin-pin-1" }), A.makeUser(env, { id: "CHAIR", role: "Chairperson", pin: "chair-pin-1" }), A.makeUser(env, { id: "TREAS", role: "Treasurer", pin: "treas-pin-1" }), A.makeUser(env, { id: M1.id, role: "Member", memberId: M1.id, pin: "1234" })]);
const tok = (id, pin) => API.handle(env, { action: "login", id, pin }).token, adminTok = tok("ADMIN", "admin-pin-1"); API.handle(env, { action: "importSnapshot", token: adminTok, db: db0 });
const cmd = (t, name, args) => API.handle(env, { action: "command", token: t, name, args });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }; let down = false, oldBackend = false;   // oldBackend: reproduces a Google deployment still running an earlier version (does not know the reminder commands)
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  if (u === "/api") { if (down) { q.destroy(); return; } let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { r.writeHead(200, { "Content-Type": "application/json" }); let out; if (q.method === "GET") out = { ok: true, service: "SOB Ledger" }; else { const req = JSON.parse(b); out = oldBackend && req.action === "command" && /Reminder/.test(req.name) ? { ok: false, error: "UNKNOWN_COMMAND: " + req.name } : API.handle(env, req); if (oldBackend) out.build = "OLDBUILD001"; } r.end(JSON.stringify(out)); }); return; }
  if (u === "/app/config.js") { r.writeHead(200, { "Content-Type": "text/javascript" }); return r.end('window.SOB_CONFIG={ledgerUrl:"/api"' + (oldBackend ? ',build:"NEWBUILD002"' : '') + '};'); }
  const f = path.join(root, u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end("no"); }
  r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f));
});
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "FAIL  ") + m); if (!c) { fails++; process.exitCode = 1; } };
const server = () => S.readAll(env.ss), rems = () => server().reminders || [];
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }); const ctxB = await b.newContext({ viewport: { width: 400, height: 900 } }), pg = await ctxB.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(base + "/app/index.html"); await pg.waitForSelector("#login-go"); await pg.fill("#mid", "ADMIN"); await pg.fill("#pin", "admin-pin-1"); await pg.click("#login-go"); await pg.waitForSelector("#hero");
  ok(await pg.locator("#open-search").isVisible(), "the magnifier is visible");
  await pg.click("#open-search"); await pg.waitForSelector("#pal-input"); await pg.screenshot({ path: "/tmp/search_open.png" });
  await pg.type("#pal-input", "gra"); await pg.waitForSelector('[data-group="Members"]');
  ok(await pg.locator("mark").count() > 0, "matching text is highlighted without pressing Enter");
  await pg.fill("#pal-input", ""); await pg.type("#pal-input", "0772111001"); await pg.waitForTimeout(200); ok(await pg.locator('[data-pal="' + M1.id + '"]').count() === 1, "a phone number finds the member");
  await pg.fill("#pal-input", "Gracce"); await pg.waitForTimeout(200); ok(await pg.locator('[data-pal="' + M1.id + '"]').count() === 1, "a typo still finds the member");
  await pg.fill("#pal-input", "100,000"); await pg.waitForTimeout(200); ok(await pg.locator('[data-group="Loans"]').count() === 1, "an amount with a comma finds the loan"); await pg.screenshot({ path: "/tmp/search_amount.png" });
  await pg.fill("#pal-input", "zzqq"); await pg.waitForTimeout(200); ok(/Nothing found/.test(await pg.locator("#pal-list").innerText()), "no match gives help, not a blank");
  await pg.fill("#pal-input", "grace"); await pg.waitForTimeout(200); await pg.click("#pal-ftoggle"); await pg.click('[data-fcat="Members"]'); await pg.waitForTimeout(200);
  ok((await pg.locator("[data-group]").count()) === 1, "a category filter narrows the results"); await pg.screenshot({ path: "/tmp/search_filter.png" });
  await pg.keyboard.press("Enter"); await pg.waitForTimeout(500); ok(await pg.locator(".pal-bg").count() === 0, "Enter opens the top result and closes the search");
  await pg.evaluate(() => { document.querySelectorAll(".modal-bg,.modal,[role=dialog]").forEach((e) => e.remove()); document.getElementById("open-search").click(); }); await pg.waitForSelector("#pal-input"); ok(await pg.locator("[data-recent]").count() >= 1, "recent searches are offered");
  await pg.keyboard.press("Escape"); ok(await pg.locator(".pal-bg").count() === 0, "Esc closes");
  ok(errs.length === 0, "no page errors " + errs.join("|")); await b.close(); srv.close(); console.log(fails ? fails + " FAILED" : "search e2e passed");
})();
