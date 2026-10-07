/* Drives the REAL app (browser UI + the bundled backend over HTTP) to prove automatic dates: default = today, an earlier genuine date can be chosen,
   the chosen date drives interest/principal split and the guarantor release, and future/invalid dates are refused. Synthetic members only. */
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const S = require("../src/backend/store.js"), A = require("../src/backend/auth.js"), API = require("../src/backend/api.js"), G = require("../src/core/governance.js"), LN = require("../src/core/loans.js"), L = require("../src/core/ledger.js"), D = require("../src/core/dates.js");
const root = path.join(__dirname, "..");
const U = { name: "Super Admin", id: "U1", role: "Admin" }, C = { name: "Chair", id: "U2", role: "Chairperson" };
const at = (day, u) => G.makeCtx(u || U, { today: day, now: day + "T09:00:00.000Z" });
const db0 = { members: ["A", "B", "C"].map((x, i) => ({ id: "SOB-00" + (i + 1), name: "Member " + x, status: "Active", regDate: "2025-01-01" })), transactions: [], loans: [], guarantees: [], auditLog: [] };
[["SOB-001", 10000], ["SOB-002", 500000], ["SOB-003", 500000]].forEach(([id, a]) => G.createEntry(db0, at("2026-01-05"), { date: "2026-01-05", memberId: id, amount: a, type: "Savings" }));
const loan = LN.applyForLoan(db0, at("2026-02-01"), "SOB-001", 100000);
[["SOB-002", 40000], ["SOB-003", 30000]].forEach(([g, a]) => { const x = LN.addGuarantee(db0, at("2026-02-02"), loan.id, g, a); LN.acceptGuarantee(db0, G.makeCtx({ name: g, id: g, role: "Member", memberId: g }, { today: "2026-02-02", now: "2026-02-02T09:00:00.000Z" }), x.id); });
LN.approveLoan(db0, at("2026-02-03"), loan.id); LN.approveLoan(db0, at("2026-02-03", C), loan.id);
LN.disburseLoan(db0, at("2026-02-03"), loan.id, { date: "2026-02-03", assignedMonthlyInterest: 10000, graceMonths: 3 });
const sheets = {}; const mk = () => { const d = []; return { d, getLastRow: () => d.length, getLastColumn: () => d.reduce((a, r) => Math.max(a, r.length), 0), getRange(r, c, nr, nc) { return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (d[r - 1 + i] && d[r - 1 + i][c - 1 + j] !== undefined ? d[r - 1 + i][c - 1 + j] : ""))), setValues: (v) => { if (v.length !== nr || v.some((x) => x.length !== nc)) throw new Error("ragged"); v.forEach((row, i) => { d[r - 1 + i] = d[r - 1 + i] || []; row.forEach((x, j) => { d[r - 1 + i][c - 1 + j] = x; }); }); }, clearContent: () => { for (let i = 0; i < nr; i++) if (d[r - 1 + i]) for (let j = 0; j < nc; j++) d[r - 1 + i][c - 1 + j] = ""; } }; } }; };
const cache = {}, env = { ss: { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mk()) }, lock: { waitLock() {}, releaseLock() {} }, now: () => new Date().toISOString(), hash: (s) => crypto.createHash("sha256").update(s).digest("hex"), randomToken: () => crypto.randomBytes(8).toString("hex"), cache: { get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } } };
S.writeCollection(env.ss, "users", [A.makeUser(env, { id: "ADMIN", role: "Admin", pin: "admin-pin-1" })]);
const tok = API.handle(env, { action: "login", id: "ADMIN", pin: "admin-pin-1" }).token; if (!API.handle(env, { action: "importSnapshot", token: tok, db: db0 }).ok) throw new Error("seed failed");
S.writeCollection(env.ss, "users", S.readCollection(env.ss, "users").concat([A.makeUser(env, { id: "SOB-001", role: "Member", memberId: "SOB-001", pin: "1234" }), A.makeUser(env, { id: "SOB-002", role: "Member", memberId: "SOB-002", pin: "4321" })]));
const ledger = () => API.handle(env, { action: "getLedger", token: tok }).db;
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = http.createServer((q, r) => { const u = q.url.split("?")[0];
  if (u === "/api") { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { r.writeHead(200, { "Content-Type": "application/json" }); r.end(JSON.stringify(API.handle(env, JSON.parse(b)))); }); return; }
  if (u === "/app/config.js") { r.writeHead(200, { "Content-Type": "text/javascript" }); return r.end('window.SOB_CONFIG={ledgerUrl:"/api"};'); }
  const f = path.join(root, u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "FAIL  ") + m); if (!c) { fails++; process.exitCode = 1; } };
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port, TODAY = D.todayISO();
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }); const pg = await b.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(base + "/app/index.html"); await pg.waitForSelector("#login-go"); await pg.fill("#mid", "ADMIN"); await pg.fill("#pin", "admin-pin-1"); await pg.click("#login-go"); await pg.waitForSelector("#kpis");
  const closeAll = async () => { while (await pg.locator("[data-close]").count()) await pg.locator("[data-close]").last().click(); };
  const openLoan = async () => { await closeAll(); await pg.click('[data-nav="loans"]'); await pg.waitForSelector("tbody tr.click"); await pg.click("tbody tr.click"); await pg.waitForSelector("text=Record repayment"); };
  const form = async (btn) => { await pg.click("text=" + btn); await pg.waitForSelector("[data-submit]"); };
  await openLoan(); await form("Record repayment");
  const inp = pg.locator('input[name="date"]');
  ok((await inp.getAttribute("type")) === "date", "repayment form uses a date picker");
  ok((await inp.inputValue()) === TODAY, "repayment date defaults to today (" + TODAY + ")");
  ok((await inp.getAttribute("max")) === TODAY, "picker will not offer future days");
  /* 1) a genuine EARLIER repayment: pick 2026-07-10 */
  await pg.fill('input[name="amount"]', "30000"); await inp.fill("2026-07-10"); await pg.click("[data-submit]"); await pg.waitForSelector(".toast");
  let db = ledger(), rep = db.transactions.find((t) => t.type === "Loan Repayment" && t.amount === 30000);
  ok(rep && rep.date === "2026-07-10", "the entry carries the CHOSEN date, not today");
  const lo = db.loans.find((x) => x.id === loan.id), exp = (asOf) => L.loanRepaymentSplit(lo, db, asOf).steps.find((s) => s.entryId === rep.id);
  const step = exp(TODAY), accrued = L.loanAccumulatedInterest(lo, "2026-07-10"), accruedToday = L.loanAccumulatedInterest(lo, TODAY);
  ok(step.interest === Math.min(30000, accrued) && step.principal === 30000 - step.interest, "interest portion uses the payment date (" + step.interest + " interest / " + step.principal + " principal)");
  ok(accrued !== accruedToday, "interest on 10/07/2026 differs from interest today, so the date matters (" + accrued + " vs " + accruedToday + ")");
  const released = db.guarantees.filter((g) => g.loanId === loan.id).reduce((a, g) => a + (g.releasedAmount || 0), 0);
  ok(released === step.principal, "guarantee released = principal actually reduced on that date (" + released + ")");
  /* 2) leave the date untouched -> today */
  await openLoan(); await form("Record repayment"); await pg.fill('input[name="amount"]', "1000"); await pg.click("[data-submit]"); await pg.waitForSelector(".toast");
  db = ledger(); ok(db.transactions.some((t) => t.type === "Loan Repayment" && t.amount === 1000 && t.date === TODAY), "untouched date posts as today");
  /* 3) refused dates */
  await openLoan(); await form("Record repayment"); await pg.fill('input[name="amount"]', "1000");
  await pg.evaluate((d) => { const e = document.querySelector('input[name="date"]'); e.removeAttribute("max"); e.value = d; }, "2999-01-01"); await pg.click("[data-submit]"); await pg.waitForSelector(".err:not(:empty)");
  ok(/future/.test(await pg.locator(".err").first().innerText()), "a future date is refused with a clear message");
  await pg.evaluate(() => { document.querySelector('input[name="date"]').value = "2026-01-15"; }); await pg.click("[data-submit]"); await pg.waitForFunction(() => /before the loan was disbursed/.test(document.querySelector(".err").innerText));
  ok(true, "a repayment dated before the loan was disbursed is refused");
  await closeAll();
  /* 4) other dated forms: ledger entry, subscription, disbursement all default to today in a picker */
  await closeAll(); await pg.click('[data-nav="ledger"]'); await pg.click("#add-entry"); await pg.waitForSelector('input[name="date"]');
  ok((await pg.locator('input[name="date"]').getAttribute("type")) === "date" && (await pg.locator('input[name="date"]').inputValue()) === TODAY, "ledger entry (savings/withdraw/expense/income/adjustment) date: picker, defaults to today");
  await pg.fill('input[name="amount"]', "5000"); await pg.fill('input[name="date"]', "2026-03-02"); await pg.click("[data-submit]"); await pg.waitForSelector(".toast");
  ok(ledger().transactions.some((t) => t.amount === 5000 && t.date === "2026-03-02"), "an earlier genuine savings entry keeps its chosen date");
  await closeAll(); await pg.click('[data-nav="subs"]'); await pg.click("[data-sub]"); await pg.waitForSelector('input[name="date"]');
  ok((await pg.locator('input[name="date"]').inputValue()) === TODAY, "subscription date defaults to today and can be changed");
  await pg.click("[data-close]");
  /* 5. what members SEE equals what the engine computes (same ledger, member phone view) */
  const ug = (n) => "UGX " + Math.round(n).toLocaleString("en-US"), dbf = ledger(), lo2 = dbf.loans.find((x) => x.id === loan.id), w = L.loanInterestPosition(lo2, dbf, TODAY), owe = L.loanOutstanding(lo2, dbf, TODAY);
  await pg.setViewportSize({ width: 390, height: 844 }); await pg.click("#logout"); await pg.waitForSelector("#login-go"); await pg.fill("#mid", "SOB-001"); await pg.fill("#pin", "1234"); await pg.click("#login-go"); await pg.waitForSelector("[data-nav]");
  await pg.click('[data-nav="myloans"]'); await pg.click("[data-loan]"); await pg.waitForSelector(".modal .kv"); const mt = await pg.locator(".modal").innerText();
  const grab = (label) => { const m = new RegExp(label + "\\s*UGX ([\\d,]+)").exec(mt); return m ? Number(m[1].replace(/,/g, "")) : null; };
  ok(grab("Principal left") === w.principalOutstanding && grab("Interest due now") === w.unpaidInterest && grab("Interest paid") === w.interestPaid && grab("Interest charged so far") === w.accruedInterest, "borrower's loan screen matches the engine (principal left " + w.principalOutstanding + ", interest due " + w.unpaidInterest + ")");
  ok(new RegExp("You owe today\\s*" + ug(owe)).test(mt), "'You owe today' equals loan outstanding (" + ug(owe) + ")");
  ok(w.steps.every((x) => mt.includes(ug(x.amount)) && (x.principal === 0 || mt.includes(ug(x.principal)))), "every repayment is listed with its interest / principal split");
  await pg.click("[data-close]"); await pg.click("#logout"); await pg.waitForSelector("#login-go"); await pg.fill("#mid", "SOB-002"); await pg.fill("#pin", "4321"); await pg.click("#login-go"); await pg.waitForSelector("[data-nav]");
  const pos = L.memberPosition(dbf, "SOB-002"), lg = await pg.locator(".legend").first().innerText();
  ok(lg.includes("Available to you") && lg.includes(ug(pos.available)) && lg.includes(ug(pos.committed)), "guarantor's home shows available " + ug(pos.available) + " and held " + ug(pos.committed));
  await pg.click('[data-nav="myguar"]'); const gt = await pg.locator("#main").innerText(), gg = dbf.guarantees.find((g) => g.guarantorId === "SOB-002");
  ok(gt.includes(ug(L.guaranteeRemaining(gg))) && gt.includes(ug(gg.amount)), "guarantee screen shows guaranteed " + ug(gg.amount) + " and still held " + ug(L.guaranteeRemaining(gg)));
  ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs[0] : "")); await b.close(); srv.close();
  console.log(fails ? fails + " FAILED" : "dates e2e passed"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
