/* Member journey in the REAL app (browser UI + bundled backend over HTTP); (originally dates harness) default = today, an earlier genuine date can be chosen,
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
LN.addGuarantee(db0, at("2026-02-02"), loan.id, "SOB-002", 40000);
const sheets = {}; const mk = () => { const d = []; return { d, getLastRow: () => d.length, getLastColumn: () => d.reduce((a, r) => Math.max(a, r.length), 0), getRange(r, c, nr, nc) { return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (d[r - 1 + i] && d[r - 1 + i][c - 1 + j] !== undefined ? d[r - 1 + i][c - 1 + j] : ""))), setValues: (v) => { if (v.length !== nr || v.some((x) => x.length !== nc)) throw new Error("ragged"); v.forEach((row, i) => { d[r - 1 + i] = d[r - 1 + i] || []; row.forEach((x, j) => { d[r - 1 + i][c - 1 + j] = x; }); }); }, clearContent: () => { for (let i = 0; i < nr; i++) if (d[r - 1 + i]) for (let j = 0; j < nc; j++) d[r - 1 + i][c - 1 + j] = ""; } }; } }; };
const cache = {}, env = { ss: { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mk()) }, lock: { waitLock() {}, releaseLock() {} }, now: () => new Date().toISOString(), hash: (s) => crypto.createHash("sha256").update(s).digest("hex"), randomToken: () => crypto.randomBytes(8).toString("hex"), cache: { get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } } };
S.writeCollection(env.ss, "users", [A.makeUser(env, { id: "ADMIN", role: "Admin", pin: "admin-pin-1" })]);
const tok = API.handle(env, { action: "login", id: "ADMIN", pin: "admin-pin-1" }).token; if (!API.handle(env, { action: "importSnapshot", token: tok, db: db0 }).ok) throw new Error("seed failed");
S.writeCollection(env.ss, "users", S.readCollection(env.ss, "users").concat([A.makeUser(env, { id: "SOB-001", role: "Member", memberId: "SOB-001", pin: "1234" }), A.makeUser(env, { id: "SOB-002", role: "Member", memberId: "SOB-002", pin: "4321" })]));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = http.createServer((q, r) => { const u = q.url.split("?")[0];
  if (u === "/api") { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { r.writeHead(200, { "Content-Type": "application/json" }); r.end(JSON.stringify(q.method === "GET" ? { ok: true, service: "SOB Ledger" } : API.handle(env, JSON.parse(b)))); }); return; }
  if (u === "/app/config.js") { r.writeHead(200, { "Content-Type": "text/javascript" }); return r.end('window.SOB_CONFIG={ledgerUrl:"/api"};'); }
  const f = path.join(root, u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "FAIL  ") + m); if (!c) { fails++; process.exitCode = 1; } };
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
  const signin = async (id, pin) => { await pg.waitForSelector("#login-go"); await pg.fill("#mid", id); await pg.fill("#pin", pin || ""); await pg.click("#login-go"); await pg.waitForSelector("[data-nav]"); };
  const signout = async () => { await pg.click("#logout"); await pg.waitForSelector("#login-go"); };
  const text = () => pg.evaluate(() => document.getElementById("main").innerText);
  await pg.goto(base + "/app/index.html");
  /* 1. name sign-in is view-only */
  await signin("SOB-002 Member"); ok(/signed in with your name/.test(await text()), "ID + name signs in and says it is view-only");
  await pg.click('[data-nav="myguar"]'); ok((await pg.locator("[data-accept-guarantee]").count()) === 0 && /Sign in with your PIN/.test(await text()), "a name sign-in cannot accept a guarantee");
  await signout();
  /* 2. PIN sign-in: guarantee request is the first thing shown, accept with a confirmation */
  await signin("SOB-002", "4321"); ok(/asked you to guarantee/.test(await text()), "home highlights the guarantee request");
  ok((await pg.locator('[data-nav="myguar"] .badge-n').innerText()) === "1", "Guarantees tab shows a badge of 1");
  await pg.click('[data-nav="myguar"]'); await pg.click("[data-accept-guarantee]"); await pg.waitForSelector("[data-confirm]"); await pg.click("[data-confirm]"); await pg.waitForSelector(".toast.ok");
  ok(/40,000/.test(await pg.locator(".toast").innerText()), "accepting shows a clear success message with the amount");
  await pg.click('[data-nav="home"]'); const legend = await pg.locator(".legend").first().innerText();
  ok(/Held for loans you guarantee\s+UGX 40,000/.test(legend) && /Available to you\s+UGX 460,000/.test(legend), "home splits savings into available (460,000) and held (40,000)");
  ok((await pg.locator("#guarantee-requests").count()) === 0, "the request disappears once answered");
  /* 3. refresh, offline, session expiry */
  await pg.click("#refresh"); await pg.waitForSelector(".toast.ok"); ok(true, "refresh button reloads the ledger");
  await ctx.setOffline(true); await pg.waitForSelector("#offline"); ok(true, "offline banner appears"); await ctx.setOffline(false); await pg.waitForSelector("#offline", { state: "detached" }); ok(true, "offline banner clears when back online");
  Object.keys(cache).forEach((k) => delete cache[k]);   // the server forgets every session
  await pg.click("#refresh"); await pg.waitForSelector("#login-go"); ok(/session (has )?ended/.test(await pg.locator(".toast").innerText()), "an expired session returns to sign-in with a friendly message");
  /* 4. borrower: loan status, apply with guidance, statement */
  await signin("SOB-001", "1234"); await pg.click('[data-nav="myloans"]'); ok(/Under review/.test(await text()), "borrower sees the loan as Under review in plain words");
  await pg.click("#apply"); await pg.waitForSelector('input[name="amt"]'); ok(/3 × your savings/.test(await pg.locator(".modal").innerText()), "apply form explains the 3× guideline");
  await pg.fill('input[name="amt"]', "5000"); await pg.click("[data-submit]"); await pg.waitForSelector(".modal .err:not(:empty)"); const em = await pg.locator(".modal .err").innerText();
  ok(/already have a loan application/.test(em) && !/ALREADY_APPLIED/.test(em), "a second application gets a plain-words message, not a system code (" + em + ")"); await pg.click("[data-close]");
  await pg.click('[data-nav="savings"]'); ok((await pg.locator("#stmt-list .li").count()) >= 1, "statement lists transactions with running balances");
  await pg.click("[data-chip=wd]"); ok(/Nothing here yet/.test(await text()), "a filter with no matches shows a friendly empty state");
  await pg.click('[data-nav="home"]'); const [pop] = await Promise.all([ctx.waitForEvent("page"), pg.click("text=Statement (PDF)")]); await pop.waitForLoadState();
  const ptxt = await pop.evaluate(() => document.body.innerText); ok(/Sons of Bethel \(SOB\) Savings Group/.test(ptxt) && /Member account statement/.test(ptxt) && /Savings summary/.test(ptxt) && /Kironde John/.test(ptxt) && (await pop.locator(".bar button").count()) === 2, "the statement opens as a branded page with Print / Save as PDF"); await pop.close();
  ok((await pg.evaluate(() => window.__SOB_IDLE.ms)) === 20 * 60000, "inactivity sign-out is set to 20 minutes");
  await pg.evaluate(() => { window.SOB_IDLE_MS = 700; window.__SOB_IDLE.touch(); }); await pg.waitForSelector("#login-go", { timeout: 4000 }); ok(/signed out after 20 minutes/.test(await pg.locator(".toast").innerText()), "an idle session signs out with an explanation");
  ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs[0] : "")); await b.close(); srv.close();
  console.log(fails ? fails + " FAILED" : "member e2e passed"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
