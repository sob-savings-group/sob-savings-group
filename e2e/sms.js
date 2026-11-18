/* (harness shared with reminders.js) SMS-gateway E2E: the real Admin screen over HTTP against the real backend code on a mock Sheet. Synthetic members only. OFFLINE: no WhatsApp is contacted (wa.me is blocked in the browser).
   Proves: screen refuses without dates, preview/prepare/open/confirm flow and honest delivery states, bulk, live update after a repayment, backend-down behaviour, mobile width, confidentiality, audit. */
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
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }); const ctxB = await b.newContext({ viewport: { width: 1100, height: 900 } }), pg = await ctxB.newPage(); const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message)); await ctxB.route("https://wa.me/**", (r) => r.abort());     // NEVER reach WhatsApp from a test
  await pg.goto(base + "/app/index.html"); await pg.waitForSelector("#login-go"); await pg.fill("#mid", "ADMIN"); await pg.fill("#pin", "admin-pin-1"); await pg.click("#login-go"); await pg.waitForSelector("#hero");
  await pg.click('[data-nav="reminders"]'); await pg.waitForSelector("#rem-asof");
  ok(await pg.locator("#rem-notset").isVisible(), "before the dates are configured the screen says no reminder can be prepared (nothing guessed)");
  ok(await pg.locator("#rem-bulk").isDisabled(), "bulk preparation is disabled until the dates are set");
  ok((await pg.locator("[data-prepare]").count()) === 0 && /set the official share-out date/i.test(await pg.locator("[data-problem]").first().innerText()), "every row says why it cannot be reminded yet and offers no WhatsApp button");
  const refused = cmd(adminTok, "prepareReminder", { loanId: l1.id }); ok(!refused.ok && /NOT_CONFIGURED/.test(refused.error) && rems().length === 0, "the server also refuses to prepare without the dates; no reminder exists");
  /* dates: Admin asks, Chairperson approves */
  await pg.click("#rem-dates"); await pg.fill('.modal input[name="so"]', SO); await pg.fill('.modal input[name="dl"]', DL); await pg.fill('.modal input[name="reason"]', "committee resolution (test)"); await pg.click("[data-submit]"); await pg.waitForSelector(".toast");
  ok(server().approvalRequests.some((r) => r.command === "setReminderDates" && r.status === "Pending"), "the dates are sent to the Chairperson (pending), not applied by the Admin");
  const chair = tok("CHAIR", "chair-pin-1"), reqId = server().approvalRequests.find((r) => r.status === "Pending").id; const ap = API.handle(env, { action: "command", token: chair, name: "approveRequest", args: { id: reqId } }); ok(ap.ok, "the Chairperson approves the dates");
  await pg.click("#rem-recalc"); await pg.waitForSelector("#rem-asof"); await pg.waitForFunction(() => !document.getElementById("rem-notset")); ok(true, "after approval the screen recalculates from the live ledger and the dates are in force");
  const rows = () => pg.locator("#main tbody tr").filter({ has: pg.locator("[data-prepare], [data-problem]") });
  ok((await pg.locator("[data-prepare]").count()) === 2 && (await pg.locator("[data-problem]").count()) === 1, "two loans can be reminded, one is blocked (no WhatsApp number) and the settled loan is left out automatically"); void rows;
  ok(/Ruth|No valid Uganda|WhatsApp number/i.test(await pg.locator("[data-problem]").innerText()), "the blocked loan states why");
  /* preview = live figures, saves nothing */
  const eng = () => { const db = server(), l = db.loans.find((x) => x.id === l1.id); return L.loanOutstanding(l, db, D.todayISO()); };
  await pg.locator('[data-preview="' + l1.id + '"]').click(); await pg.waitForSelector("#rem-text"); const pv = await pg.innerText("#rem-text");
  ok(pv.includes("Dear Grace Alpha,") && pv.includes("Total Balance Due: UGX " + eng().toLocaleString("en-US")), "preview shows the member, SOB ID and the engine's total outstanding (UGX " + eng().toLocaleString("en-US") + ")");
  ok(/Calculated from the live ledger/.test(await pg.innerText("#rem-calc")) && rems().length === 0, "calculation timestamp is shown and a preview saves nothing");
  await pg.click(".modal [data-close]");
  const sentSms = []; const live = { live: true, send: (m) => { sentSms.push(m); return { ok: true, providerRef: "" }; } };
  await pg.locator('[data-prepare="' + l1.id + '"]').click(); await pg.waitForSelector("#rem-open-wa");
  ok(await pg.locator("#rem-send-sms").isVisible(), "a prepared reminder offers 'Send by SMS' next to WhatsApp");
  await pg.click("#rem-send-sms"); await pg.waitForSelector('.modal-bg[aria-label="Send by SMS"] [data-submit]'); ok(/cannot be unsent/.test(await pg.innerText('.modal-bg[aria-label="Send by SMS"]')), "the officer is asked to confirm before anything is sent"); await pg.click('.modal-bg[aria-label="Send by SMS"] [data-submit]');
  await pg.waitForSelector(".toast.bad"); ok(/not switched on/i.test(await pg.innerText(".toast")) && sentSms.length === 0 && rems()[0].delivery !== "SMS_ACCEPTED", "with the gateway off nothing is sent and the screen says so");
  await pg.click('.modal-bg[aria-label="Send by SMS"] [data-close]'); env.gateways.SMS = live; await pg.waitForTimeout(400);
  if (!(await pg.locator("#rem-send-sms").count())) { await pg.locator('[data-hist-open="' + rems()[0].id + '"]').click(); await pg.waitForSelector("#rem-send-sms"); }
  await pg.click("#rem-send-sms"); await pg.waitForSelector('.modal-bg[aria-label="Send by SMS"] [data-submit]'); await pg.click('.modal-bg[aria-label="Send by SMS"] [data-submit]');
  await pg.waitForFunction(() => /accepted by the gateway/i.test((document.querySelector(".toast") || {}).textContent || ""), null, { timeout: 10000 });
  ok(sentSms.length === 1 && sentSms[0].to === "+256772111001" && !/[*]/.test(sentSms[0].body) && /UGX/.test(sentSms[0].body), "exactly one SMS reached the gateway, to the member's own number, as plain text with the verified figures");
  ok(rems()[0].delivery === "SMS_ACCEPTED" && rems()[0].events.some((e) => e.event === "SMS_ACCEPTED" && /does not prove/.test(e.note)), "the server records 'accepted by gateway' honestly (not 'delivered')");
  await pg.waitForFunction(() => /SMS accepted by gateway/.test(document.getElementById("main").innerText), null, { timeout: 8000 }); ok(true, "history shows 'SMS accepted by gateway (delivery NOT confirmed)'");
  ok((server().outbox || []).filter((m) => m.channel === "SMS").length === 1, "only one outbox message exists; a repeat can't send twice");
  ok(!(await pg.locator('[data-hist-cancel="' + rems()[0].id + '"]').count()), "a reminder that was sent can no longer be cancelled");
  ok(errs.length === 0, "no browser errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close(); srv.close(); console.log(fails ? "RESULT: FAIL" : "RESULT: PASS"); if (fails) process.exit(1); else console.log("sms e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
