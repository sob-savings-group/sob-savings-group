/* (harness shared with reminders.js) Financial-years E2E: the real Admin screen over HTTP against the real backend code on a mock Sheet. Synthetic members only. OFFLINE: no WhatsApp is contacted (wa.me is blocked in the browser).
   Proves: screen refuses without dates, preview/prepare/open/confirm flow and honest delivery states, bulk, live update after a repayment, backend-down behaviour, mobile width, confidentiality, audit. */
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
const FYM = require("../src/core/fy.js");
G.createEntry(db0, ctxA("Admin"), { date: "2025-06-01", memberId: M1.id, amount: 300000, type: "Savings" });
G.createEntry(db0, ctxA("Admin"), { date: "2025-12-21", memberId: M1.id, amount: 200000, type: "Withdraw" });   // the share-out day: leaves 100,000 behind
db0.transactions.forEach((t) => { if (t.date === back(10) && t.memberId === M1.id) { t.date = "2026-01-10"; } });
FYM.defineFinancialYears(db0, ctxA("Admin"), { years: [{ year: 2025, openedDate: "2025-01-01", closedDate: "2025-12-21", evidence: "Minute 1", basis: "e2e" }, { year: 2026, openedDate: "2025-12-21", closedDate: null, evidence: "Minute 1", basis: "e2e" }] });
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


const pend = () => (server().approvalRequests || []).filter((q) => q.command === "recordBroughtForward");
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }); const errs = [];
  const sess = async (viewport) => { const c = await b.newContext({ viewport }), pg = await c.newPage(); pg.on("pageerror", (e) => errs.push(e.message)); await pg.goto(base + "/app/index.html"); await pg.waitForSelector("#login-go"); return pg; };
  const officer = async (pg, id, pin) => { await pg.click("#tab-officer"); await pg.fill("#sid", id); await pg.fill("#spin", pin); await pg.click("#officer-go"); await pg.waitForSelector("#kpis"); };
  const ap = await sess({ width: 1200, height: 900 }); await officer(ap, "ADMIN", "admin-pin-1");
  const ledgerBefore = JSON.stringify(server().transactions) + JSON.stringify(server().loans);
  /* 1. the Financial Years screen: years stand alone */
  await ap.click('[data-nav="fyears"]'); await ap.waitForSelector("#fy-span");
  let txt = await ap.locator("#main").innerText(); ok(/Financial Year 2026/.test(txt) && /Held in the club consolidated position/.test(txt) && /None recorded/.test(txt), "Financial Years screen: names the year explicitly, shows the club consolidated position and says nothing is brought forward yet");
  ok(/100,000/.test(txt), "the previous year's closing position (100,000) is shown for information, not carried in");
  /* 2. record a Balance Brought Forward: goes to the Chairperson, changes nothing yet */
  await ap.click("#bbf-add"); await ap.selectOption('select[name="m"]', M1.id); await ap.fill('input[name="amount"]', "60000"); await ap.fill('input[name="evidence"]', "AGM minute 4"); await ap.fill('input[name="reason"]', "Members chose to keep funds in"); await ap.click("[data-submit]");
  await ap.waitForFunction(() => /Chairperson|Sent/i.test(document.body.innerText)); ok(pend().length === 1 && pend()[0].status === "Pending", "the request waits for the Chairperson");
  ok(FYM.openingOf(server(), 2026, M1.id) === 0, "nothing opens the year until it is approved");
  const ct = tok("CHAIR", "chair-pin-1"); const rr = cmd(ct, "approveRequest", { id: pend()[0].id }); ok(rr.ok !== false, "the Chairperson approves" + (rr.ok === false ? ": " + JSON.stringify(rr) : ""));
  ok(FYM.openingOf(server(), 2026, M1.id) === 60000, "after approval the member's Financial Year 2026 opens with exactly 60,000");
  await ap.reload(); await ap.waitForSelector("#kpis"); await ap.click('[data-nav="fyears"]'); await ap.waitForSelector("#fy-span"); txt = await ap.locator("#main").innerText();
  ok(/Authorised Balance Brought Forward/.test(txt) && /60,000/.test(txt) && /40,000/.test(txt) && /AGM minute 4/.test(txt), "screen now shows the authorised 60,000, 40,000 left in the club position, and the evidence");
  ok(ledgerBefore === JSON.stringify(server().transactions) + JSON.stringify(server().loans), "no ledger entry or loan changed");
  /* 3. explicit period names everywhere */
  await ap.click('[data-nav="dash"]'); await ap.waitForSelector("#periodbar"); const bar = await ap.locator("#periodbar").innerText();
  ok(/Financial Year 2026/.test(bar) && !/This year|Last year|This month|Last month|This financial|Last financial/i.test(bar), "the period bar names real periods (" + bar.replace(/\s+/g, " ").slice(0, 120) + ")");
  /* 4. Other (Specify) and configurable lists */
  await ap.click('[data-nav="system"]'); await ap.waitForSelector("#lists-panel"); await ap.click('[data-add-list="purpose.Expense"]'); await ap.fill('input[name="label"]', "Funeral support"); await ap.fill('input[name="reason"]', "new category agreed"); await ap.click("[data-submit]");
  await ap.waitForFunction(() => /Funeral support/.test(document.getElementById("lists-panel").innerText)); ok((server().listItems || []).some((i) => i.label === "Funeral support" && i.active), "an administrator added a new option without any code change (stored and audited)");
  await ap.click('[data-nav="ledger"]'); await ap.click("#add-entry"); await ap.waitForSelector('select[name="purpose__sel"]');
  const opts = await ap.locator('select[name="purpose__sel"] option').allInnerTexts(); ok(opts.includes("Funeral support") && opts.includes("Other (Specify)") && opts.includes("Transport"), "the entry form offers the standard options, the new one, and Other (Specify)");
  await ap.selectOption('select[name="m"]', M2.id); await ap.selectOption('select[name="type"]', "Savings"); await ap.fill('input[name="amount"]', "1000"); await ap.selectOption('select[name="purpose__sel"]', "__other__");
  ok(await ap.locator('input[name="purpose__other"]').isVisible(), "choosing Other (Specify) reveals a box to type into"); await ap.fill('input[name="purpose__other"]', "Church choir fee"); await ap.click("[data-submit]");
  await ap.waitForFunction(() => /recorded/i.test(document.body.innerText)); ok((server().transactions || []).some((t) => t.purpose === "Church choir fee" && t.memberId === M2.id), "the typed purpose is recorded exactly as written");
  /* 5. the member's own view */
  const mp = await sess({ width: 390, height: 844 }); await mp.fill("#mid", M1.id); await mp.evaluate(() => { const r = document.getElementById("pin-row"); if (r) r.hidden = false; document.getElementById("pin").value = "1234"; }); await mp.click("#login-go");
  await mp.waitForSelector('[data-nav="savings"], #open-statement, .hero', { timeout: 20000 });
  await mp.click('[data-nav="savings"]'); await mp.waitForSelector("#stmt-period", { timeout: 20000 });
  const chips = await mp.locator("#stmt-period [data-chip]").allInnerTexts(); ok(chips.some((c) => /^Financial Year 2026$/.test(c)) && !chips.some((c) => /^(This|Last)\b/i.test(c)), "member statement chips name the period: " + chips.join(" | "));
  await mp.click('#stmt-period [data-chip="year"]'); await mp.waitForFunction(() => /Balance Brought Forward/.test(document.getElementById("stmt-note").innerText)); const note = await mp.innerText("#stmt-note"); ok(/60,000/.test(note), "member's Financial Year 2026 note opens with their authorised Balance Brought Forward: " + note.replace(/\s+/g, " ").slice(0, 140));
  const lg = API.handle(env, { action: "login", id: M1.id, pin: "1234" }), mv = API.handle(env, { action: "getLedger", token: lg.token }).db, other = JSON.stringify(mv);
  ok(!other.includes("Peter Bravo") && !other.includes("Ruth Charlie") && mv.listItems === undefined && mv.yearOpenings.every((o) => o.memberId === M1.id), "the member's data has no other member's name, no configuration lists, and only their own Balance Brought Forward");
  ok(errs.length === 0, "no browser errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close(); srv.close(); console.log(fails ? "RESULT: FAIL" : "RESULT: PASS"); if (fails) process.exit(1); else console.log("financial-years e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
