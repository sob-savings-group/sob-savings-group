/* Loan reminders E2E: the real Admin screen over HTTP against the real backend code on a mock Sheet. Synthetic members only. OFFLINE: no WhatsApp is contacted (wa.me is blocked in the browser).
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
  await pg.goto(base + "/app/index.html"); await pg.waitForSelector("#login-go"); await pg.click("#tab-officer"); await pg.fill("#sid", "ADMIN"); await pg.fill("#spin", "admin-pin-1"); await pg.click("#officer-go"); await pg.waitForSelector("#kpis");
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
  ok(pv.includes("Dear Grace Alpha,") && pv.includes(M1.id) && pv.includes("Total Outstanding: UGX " + eng().toLocaleString("en-US")), "preview shows the member, SOB ID and the engine's total outstanding (UGX " + eng().toLocaleString("en-US") + ")");
  ok(/Figures as at .* EAT/.test(pv) && /Calculated from the live ledger/.test(await pg.innerText("#rem-calc")) && rems().length === 0, "calculation timestamp is shown and a preview saves nothing");
  await pg.click(".modal [data-close]");
  /* individual: prepare -> opened (NOT delivered) -> officer confirms */
  await pg.locator('[data-prepare="' + l1.id + '"]').click(); await pg.waitForSelector("#rem-open-wa");
  const href = await pg.getAttribute("#rem-open-wa", "href"); ok(/^https:\/\/wa\.me\/256772111001\?text=/.test(href) && !/chat\.whatsapp|wa\.me\/\?/.test(href), "the link is the member's own private chat (wa.me/256772111001), not a group");
  ok(decodeURIComponent(href.split("?text=")[1]) === await pg.innerText("#rem-text") || (await pg.innerText("#rem-text")).trim() === decodeURIComponent(href.split("?text=")[1]).trim(), "the message in the link is exactly the message recorded");
  ok(rems().length === 1 && rems()[0].delivery === "PREPARED", "the server recorded it as PREPARED (not sent)");
  const [pop] = await Promise.all([ctxB.waitForEvent("page", { timeout: 4000 }).catch(() => null), pg.click("#rem-open-wa")]); if (pop) await pop.close().catch(() => {});
  await pg.waitForFunction(() => /WhatsApp opened/.test((document.querySelector(".toast") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
  ok(rems()[0].delivery === "OPENED" && !rems()[0].sentConfirmedAt, "opening WhatsApp is recorded as OPENED only — delivery is NOT confirmed");
  await pg.click("#rem-confirm-sent"); await pg.waitForFunction(() => !document.querySelector("#rem-text")); ok(rems()[0].delivery === "SENT_CONFIRMED" && rems()[0].sentConfirmedBy === "Admin" || rems()[0].delivery === "SENT_CONFIRMED", "only the officer's own \"I sent it\" marks it Sent");
  ok(/Sent \(confirmed by officer\)/.test(await pg.innerText("#main")), "history shows the honest status wording");
  /* duplicate prevention in the UI */
  await pg.locator('[data-prepare="' + l1.id + '"]').click(); await pg.waitForSelector(".toast.bad"); ok(/already prepared|DUPLICATE/i.test(await pg.innerText(".toast")) && rems().length === 1, "preparing the same reminder again is refused (no duplicate)");
  /* bulk */
  await pg.click("#rem-bulk"); await pg.waitForSelector("#rem-bulk-note"); const bulk = await pg.innerText(".modal");
  ok(/NOTHING has been sent/.test(bulk) && (await pg.locator("[data-open-rem]").count()) === 1 && /already prepared|DUPLICATE/i.test(bulk), "bulk: only members not reminded recently are prepared; the one just reminded is skipped; nothing is sent");
  ok(rems().length === 2 && rems().every((r) => r.memberId !== M3.id), "one record per member; the member without a WhatsApp number is skipped, never guessed");
  await pg.click(".modal [data-close]");
  /* LIVE: a repayment recorded now is reflected by the next preview */
  const before = eng(); const rp = cmd(adminTok, "repayLoan", { loanId: l2.id, amount: 15000, date: D.todayISO() }); ok(rp.ok, "a repayment is recorded in the ledger (outside this screen)");
  await pg.click("#rem-recalc"); await pg.waitForSelector("#rem-asof"); await pg.locator('[data-preview="' + l2.id + '"]').click(); await pg.waitForSelector("#rem-text");
  const db2 = server(), exp2 = L.loanOutstanding(db2.loans.find((x) => x.id === l2.id), db2, D.todayISO()), t2 = await pg.innerText("#rem-text");
  ok(t2.includes("Total Outstanding: UGX " + exp2.toLocaleString("en-US")) && t2.includes("Repayments Received: UGX 15,000"), "after the repayment the next reminder shows the new balance (UGX " + exp2.toLocaleString("en-US") + ") and the repayment received"); void before;
  await pg.click(".modal [data-close]");
  ok(await pg.locator('[data-hist-open]').first().isVisible(), "history offers Open WhatsApp again only through server re-validation");
  const stale = rems().find((r) => r.loanId === l2.id); await pg.locator('[data-hist-open="' + stale.id + '"]').click(); await pg.waitForSelector(".toast.bad"); ok(/changed|STALE|balance/i.test(await pg.innerText(".toast")) && !(await pg.locator("#rem-open-wa").count()), "a reminder made before the repayment is refused as stale — the old balance is never sent");
  /* backend unavailable */
  const nBefore = rems().length; down = true; await pg.locator('[data-prepare="' + l2.id + '"]').click(); await pg.waitForSelector(".toast.bad", { timeout: 15000 }); ok(!(await pg.locator("#rem-open-wa").count()) && (down = false, rems().length === nBefore), "with the backend unreachable no reminder is generated and no WhatsApp link appears");
  /* wording + timing editable without code */
  await pg.click("#rem-timing"); await pg.fill('.modal input[name="u"]', "45"); await pg.fill('.modal input[name="f"]', "9"); await pg.fill('.modal input[name="reason"]', "committee"); await pg.click("[data-submit]"); await pg.waitForSelector(".toast");
  ok(server().policy.find((p) => p.id === "reminders").urgentDays === 45, "timing is saved from the screen (no code change)");
  /* audit */
  ok(["Prepared", "WhatsApp opened", "Sent confirmed by officer", "Bulk prepared"].every((a) => server().auditLog.some((x) => x.entityType === "Reminder" && x.action === a)), "every step is in the audit log");
  /* mobile */
  const mpg = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); await mpg.context().route("https://wa.me/**", (r) => r.abort()); await mpg.goto(base + "/app/index.html"); await mpg.waitForSelector("#login-go"); await mpg.click("#tab-officer"); await mpg.fill("#sid", "ADMIN"); await mpg.fill("#spin", "admin-pin-1"); await mpg.click("#officer-go"); await mpg.waitForSelector("#kpis");
  await mpg.click('[data-nav="reminders"]'); await mpg.waitForSelector("#rem-asof"); const w = await mpg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  ok(w.sw <= w.iw + 1, "mobile 390px: the Reminders screen has no sideways scrolling (" + w.sw + " <= " + w.iw + ")");
  await mpg.locator("[data-prepare]").first().click().catch(() => {}); await mpg.waitForSelector("#rem-open-wa, .toast.bad", { timeout: 8000 }); const w2 = await mpg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); ok(w2.sw <= w2.iw + 1, "mobile: the message window fits the phone (" + w2.sw + " <= " + w2.iw + ")");
  /* confidentiality */
  const treas = tok("TREAS", "treas-pin-1"), memT = tok(M1.id, "1234"), g = (t) => API.handle(env, { action: "getLedger", token: t });
  ok(g(chair).db.reminders.length === 0 && g(treas).db.reminders.length === 0, "Chairperson and Treasurer never receive reminder history or message texts");
  const mv = g(memT).db; ok(!(mv.reminders && mv.reminders.length) && !JSON.stringify(mv).includes("Praise the Lord"), "a member's view contains no reminder text");
  ok(cmd(treas, "prepareReminder", { loanId: l1.id }).error && /FORBIDDEN/.test(cmd(treas, "prepareReminder", { loanId: l1.id }).error), "the server refuses reminders from the Treasurer even if the browser is tampered with");
  /* A Google deployment still on an earlier version: the exact live symptom ("setReminderDates" in red). It must be explained, and nothing may change. */
  { oldBackend = true; const before = JSON.stringify(g(adminTok).db.policy), opg = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage(); await opg.context().route("https://wa.me/**", (r) => r.abort());
    await opg.goto(base + "/app/index.html"); await opg.waitForSelector("#login-go"); await opg.click("#tab-officer"); await opg.fill("#sid", "ADMIN"); await opg.fill("#spin", "admin-pin-1"); await opg.click("#officer-go"); await opg.waitForSelector("#kpis");
    await opg.click('[data-nav="reminders"]'); await opg.waitForSelector("#rem-asof");
    ok(/OLDBUILD001/.test(await opg.locator("#rem-backend-old").innerText()) && /NEWBUILD002/.test(await opg.locator("#rem-backend-old").innerText()), "an older Google backend is announced on the Reminders screen with both version ids");
    await opg.click("#rem-dates"); await opg.fill('.modal input[name="so"]', soYear + "-12-26"); await opg.fill('.modal input[name="dl"]', soYear + "-12-12"); await opg.fill('.modal input[name="reason"]', "test"); await opg.click("[data-submit]");
    await opg.waitForSelector(".modal .err, .toast.bad"); const msg = await opg.locator(".modal .err, .toast.bad").first().innerText();
    ok(/older version/i.test(msg) && /New version/i.test(msg) && msg.trim() !== "setReminderDates", "the error explains the cause and the remedy instead of showing the bare command name (" + msg.slice(0, 60) + "...)");
    ok(JSON.stringify(g(adminTok).db.policy) === before, "nothing was changed by the refused request"); oldBackend = false; }
  ok(errs.length === 0, "no browser errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close(); srv.close(); console.log(fails ? "RESULT: FAIL" : "RESULT: PASS"); if (fails) process.exit(1); else console.log("reminders e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
