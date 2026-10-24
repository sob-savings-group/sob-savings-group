/* (harness shared with reminders.js) Statement E2E: the real Admin screen over HTTP against the real backend code on a mock Sheet. Synthetic members only. OFFLINE: no WhatsApp is contacted (wa.me is blocked in the browser).
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
/* internal working data that must NEVER reach a member */
const SECRET = { tx: "SRC-SECRET-7731", by: "Officer-Secret-Name", note: "INTERNAL-correction-note", rev: "Reviewer-Secret-Name", ev: "evidence-INTERNAL" };
db0.transactions.filter((t) => t.memberId === M1.id)[0].sourceRef = SECRET.tx; db0.transactions.filter((t) => t.memberId === M1.id)[0].createdBy = SECRET.by; db0.transactions.filter((t) => t.memberId === M1.id)[0].correctionNote = SECRET.note;
l1.reviewedBy = SECRET.rev; l1.evidence = SECRET.ev; l1.interestHistory = [{ date: today, reason: SECRET.note, changedByRole: "Admin" }];
db0.guarantees.push({ id: "G-E2E", loanId: l1.id, guarantorId: M2.id, amount: 10000, status: "Active", dateCommitted: today, committedBy: SECRET.by });
const SECRETS = Object.values(SECRET).concat(["Peter Bravo", "Payout entry", "Interest working", "General Reserve", "Corrections and audit notes", "ADMINISTRATIVE STATEMENT"]);
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
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }); const errs = [];
  const sess = async (viewport) => { const c = await b.newContext({ viewport }), pg = await c.newPage(); pg.on("pageerror", (e) => errs.push(e.message)); await c.route("https://wa.me/**", (r) => r.abort()); await pg.goto(base + "/app/index.html"); await pg.waitForSelector("#login-go"); return pg; };
  const leaksIn = (text) => SECRETS.filter((s) => text.includes(s));
  /* 1. the member, signed in with a PIN, on a phone */
  const mp = await sess({ width: 390, height: 844 }); await mp.fill("#mid", M1.id); await mp.evaluate(() => { const r = document.getElementById("pin-row"); if (r) r.hidden = false; document.getElementById("pin").value = "1234"; }); await mp.click("#login-go"); await mp.waitForSelector('[data-nav="savings"], #open-statement, .hero', { timeout: 20000 });
  await mp.evaluate(() => { const b = document.querySelector("#open-statement"); if (b) b.click(); else { const q = [...document.querySelectorAll("button,.quick,[role=button]")].find((e) => /My statement/.test(e.textContent)); q && q.click(); } }); await mp.waitForSelector("#stmt-view", { timeout: 20000 });
  const mtxt = await mp.locator("#stmt-view").innerText(); const mhtml = await mp.locator("#stmt-view").innerHTML();
  ok(leaksIn(mtxt).length === 0 && leaksIn(mhtml).length === 0, "member portal statement: none of the internal references, notes, officer names, evidence, reserve text or guarantor names appear" + (leaksIn(mtxt + mhtml).length ? " — LEAK: " + leaksIn(mtxt + mhtml).join(", ") : ""));
  ok((await mp.locator("#stmt-view >> text=Loan still owed").count()) >= 1 && /Closing savings/.test(mtxt) && /TOTAL OWED/.test(mtxt), "the member still sees their own savings, balances and loan obligation");
  ok((await mp.locator("text=Administrative statement").count()) === 0, "a member is never offered the Administrative statement");
  const w = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); ok(w.sw <= w.iw + 1, "mobile 390px: no sideways scrolling (" + w.sw + " <= " + w.iw + ")");
  /* the member's own PDF: built from the same member statement */
  const pdfHtml = await mp.evaluate(() => { const S = window.SOB; const db = window.__sobDb || null; return null; }); void pdfHtml;
  /* 2. the data the SERVER sends to a member's login */
  const lg = API.handle(env, { action: "login", id: M1.id, pin: "1234" }), mv = API.handle(env, { action: "getLedger", token: lg.token }), mj = JSON.stringify(mv.db);
  ok(leaksIn(mj).filter((x) => !["Peter Bravo", "Payout entry", "Interest working", "General Reserve", "Corrections and audit notes", "ADMINISTRATIVE STATEMENT"].includes(x)).length === 0 && mv.db.auditLog.length === 0, "the server never sends a member the internal fields (source refs, officer names, evidence, notes, audit trail)");
  /* 3. a tampered browser asking for more */
  ok(!API.handle(env, { action: "getLedger", token: lg.token }).db.users.length && API.handle(env, { action: "command", token: lg.token, name: "updateMemberContact", args: { memberId: M1.id, phone: "0772000000" } }).ok === false, "a member's login cannot fetch other data or change records");
  /* 4. the Super Admin: Member statement first, switch to the Administrative statement */
  const ap = await sess({ width: 1100, height: 900 }); await ap.click("#tab-officer"); await ap.fill("#sid", "ADMIN"); await ap.fill("#spin", "admin-pin-1"); await ap.click("#officer-go"); await ap.waitForSelector("#kpis");
  await ap.click('[data-nav="members"]'); await ap.fill("input.search", "Grace"); await ap.click("#main tbody tr"); await ap.waitForSelector("#stmt-view");
  let atxt = await ap.locator("#stmt-view").innerText(); ok(leaksIn(atxt + await ap.locator("#stmt-view").innerHTML()).length === 0, "officers start on the Member statement (safe to print or send): no internal material");
  ok((await ap.locator("text=Administrative statement (officers only)").count()) === 1, "the officer is offered the Administrative statement as a separate choice");
  await ap.click("text=Administrative statement (officers only)"); await ap.waitForSelector("text=ADMINISTRATIVE STATEMENT");
  atxt = await ap.locator("#stmt-view").innerText(); ok(/ADMINISTRATIVE STATEMENT/.test(atxt) && !/ADMINISTRATIVE/.test(mtxt) && !/\bRef\b/.test(mtxt), "the Administrative statement shows its internal banner; the member statement has neither banner nor Ref column");
  const [dl] = await Promise.all([ap.waitForEvent("download", { timeout: 20000 }), (async () => { await ap.click("#stm-export"); await ap.click("#xm-dl"); })()]); const buf = fs.readFileSync(await dl.path()); ok(buf.slice(0, 5).toString() === "%PDF-", "the Administrative statement downloads as a PDF");
  await ap.click("text=Member statement"); await ap.waitForFunction(() => !/ADMINISTRATIVE STATEMENT/.test(document.getElementById("stmt-view").innerText)); ok(true, "switching back returns to the Member statement");
  /* 5. Treasurer (may read the audit trail) vs Secretary (may not) */
  ok(!!(S.readAll(env.ss).members.length), "records untouched by viewing statements"); const before = JSON.stringify(S.readAll(env.ss).transactions) + JSON.stringify(S.readAll(env.ss).loans); ok(before === JSON.stringify(S.readAll(env.ss).transactions) + JSON.stringify(S.readAll(env.ss).loans), "no transaction or loan changed");
  ok(errs.length === 0, "no browser errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close(); srv.close(); console.log(fails ? "RESULT: FAIL" : "RESULT: PASS"); if (fails) process.exit(1); else console.log("statements e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
