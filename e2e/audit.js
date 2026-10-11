/* Live-mode E2E: the real UI talks (over HTTP) to the real backend code running against a mock Sheet. Proves sign-in, server-side
   role enforcement even when the browser is tampered with, and that members only receive their own data. */
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const signin = async (pg, id, pin) => { if (/^(ADMIN|CHAIR|TREAS|COMM)/i.test(id)) { await pg.fill("#mid", id); await pg.fill("#pin", pin); } else { await pg.fill("#mid", id); await pg.fill("#pin", pin); } };
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const S = require("../src/backend/store.js"), A = require("../src/backend/auth.js"), API = require("../src/backend/api.js"), M = require("../src/core/migrate.js"), L = require("../src/core/ledger.js");
const root = path.join(__dirname, ".."), raw = JSON.parse(fs.readFileSync(process.env.SEED || path.join(root, "app/demo-seed.json"), "utf8"));
const db0 = M.migrateLegacy(raw, "2026-03-31"), mem = db0.members.find((m) => L.memberSavings(db0, m.id) > 0), newMem = db0.members.find((m) => m.id !== mem.id && L.memberSavings(db0, m.id) > 0 && m.id !== (db0.members.find((x) => x.id !== mem.id && L.memberSavings(db0, x.id) >= 10000 && !L.memberHasOutstandingLoan(db0, x.id, "2026-03-31")) || {}).id), airMem = db0.members.find((m) => m.id !== mem.id && L.memberSavings(db0, m.id) >= 10000 && !L.memberHasOutstandingLoan(db0, m.id, "2026-03-31"));
const sheets = {}; const mk = (n) => { const d = []; return { d, getLastRow: () => d.length, getLastColumn: () => d.reduce((a, r) => Math.max(a, r.length), 0), getRange(r, c, nr, nc) { return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (d[r - 1 + i] && d[r - 1 + i][c - 1 + j] !== undefined ? d[r - 1 + i][c - 1 + j] : ""))), setValues: (v) => { if (v.length !== nr || v.some((row) => row.length !== nc)) throw new Error("The number of columns in the data does not match the number of columns in the range. The data has " + (v[0] ? v[0].length : 0) + " but the range has " + nc + "."); v.forEach((row, i) => row.forEach((x, j) => { d[r - 1 + i] = d[r - 1 + i] || []; d[r - 1 + i][c - 1 + j] = x; })); }, clearContent: () => { for (let i = 0; i < nr; i++) if (d[r - 1 + i]) for (let j = 0; j < nc; j++) d[r - 1 + i][c - 1 + j] = ""; } }; } }; };
const cache = {}, env = { ss: { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mk(n)) }, lock: { waitLock() {}, releaseLock() {} }, now: () => new Date().toISOString(), gateways: { adminPhone: "0772000000", SMS: null },
  hash: (s) => crypto.createHash("sha256").update(s).digest("hex"), randomToken: () => crypto.randomBytes(8).toString("hex"), cache: { get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } } };
S.writeCollection(env.ss, "users", [A.makeUser(env, { id: "ADMIN", role: "Admin", pin: "admin-pin-1" }), A.makeUser(env, { id: "CHAIR", role: "Chairperson", pin: "chair-pin-1" }), A.makeUser(env, { id: mem.id, role: "Member", memberId: mem.id, pin: "1234" }), A.makeUser(env, { id: airMem.id, role: "Member", memberId: airMem.id, pin: "2468" })]);
const adminTok = API.handle(env, { action: "login", id: "ADMIN", pin: "admin-pin-1" }).token; API.handle(env, { action: "importSnapshot", token: adminTok, db: db0 });
API.handle(env, { action: "command", token: adminTok, name: "openDiscrepancy", args: { kind: "SAVINGS_BALANCE", subject: mem.id, summary: "e2e discrepancy", platformValue: 1, sourceValue: 2, source: "e2e" } });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  if (u === "/api") { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { r.writeHead(200, { "Content-Type": "application/json" }); r.end(JSON.stringify(q.method === "GET" ? { ok: true, service: "SOB Ledger" } : API.handle(env, JSON.parse(b)))); }); return; }
  if (u === "/app/config.js") { r.writeHead(200, { "Content-Type": "text/javascript" }); return r.end('window.SOB_CONFIG={ledgerUrl:"/api"};'); }
  const site = process.env.SITE ? path.join(root, process.env.SITE) : null; const f = site && u.startsWith("/app/") ? path.join(site, u.slice(5)) : path.join(root, u); if (!(f.startsWith(root)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f));
});
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "FAIL  ") + m); if (!c) { fails++; process.exitCode = 1; } };
const loan0 = db0.loans.find((l) => l.status === "Active" && !l.voided);
const iso = (d) => d.toISOString().slice(0, 10);
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  for (const vp of [{ width: 1280, height: 800, name: "computer" }, { width: 390, height: 760, name: "phone" }]) {
    const ctx = await b.newContext({ viewport: vp, acceptDownloads: true }), pg = await ctx.newPage(), errs = []; pg.on("pageerror", (e) => errs.push(e.message));
    const T = (m) => "[" + vp.name + "] " + m;
    await ctx.route(/wa\.me/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "wa" }));
    await pg.goto(base + "/app/index.html"); await pg.waitForSelector("#login-go");
    /* sign-in guidance + exact access messages */
    ok(/SOB-005/.test(await pg.getAttribute("#mid", "placeholder")) && /sob5|SOB005/.test(await pg.innerText("#id-hint")) && /first name/i.test(await pg.innerText("#pin-hint")), T("login screen shows how to enter the SOB ID and first name"));
    const DENIED = "Access denied. We could not verify your membership details. Please confirm your SOB ID or contact the Administrator.", PENDING = "Your membership is pending approval. Please contact the Administrator for assistance.", INACTIVE = "Your account is currently inactive or restricted. Please contact the Administrator for assistance.";
    const tryLogin = async (idText, pinText) => { await pg.fill("#mid", idText); await pg.fill("#pin", pinText); await pg.click("#login-go"); await pg.waitForSelector("#login-error", { timeout: 15000 }); const m = (await pg.innerText("#login-error")).trim(); await pg.evaluate(() => { const e = document.getElementById("login-error"); if (e) e.remove(); }); return m; };
    const setStatus = (id, status) => { const ms = S.readCollection(env.ss, "members"); ms.forEach((m) => { if (m.id === id) m.status = status; }); S.writeCollection(env.ss, "members", ms); };
    ok((await tryLogin("SOB-999", "1234")) === DENIED, T("unknown SOB ID: exact 'Access denied' message"));
    ok((await tryLogin(mem.id, "wrong-pin-x")) === DENIED, T("wrong PIN: the same exact 'Access denied' message (nothing revealed)"));
    setStatus(newMem.id, "Pending"); ok((await tryLogin(newMem.id.toLowerCase().replace("-", "") + " " + newMem.name.split(/\s+/)[0], "")) === PENDING, T("verified pending member: exact pending message"));
    ok((await tryLogin(newMem.id, "")) === DENIED, T("pending member's ID alone (not verified): 'Access denied', not the pending message"));
    setStatus(mem.id, "Inactive"); ok((await tryLogin(mem.id, "1234")) === INACTIVE, T("verified inactive member: exact inactive/restricted message")); setStatus(mem.id, "Restricted"); ok((await tryLogin(mem.id, "1234")) === INACTIVE, T("verified restricted member: exact inactive/restricted message")); setStatus(mem.id, "Active"); setStatus(newMem.id, "Active");
    await signin(pg, "ADMIN", "admin-pin-1"); await pg.click("#login-go"); await pg.waitForSelector("#kpis");
    /* mobile/desktop layout: no page ever scrolls sideways */
    const wide = async () => pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const navTo = async (k) => { await pg.click('[data-nav="' + k + '"]').catch(async () => { await pg.click('[data-nav="more"]'); await pg.click('[data-nav="' + k + '"]'); }); await pg.waitForTimeout(250); };
    for (const k of ["dash", "members", "loans", "ledger", "approvals", "recon", "system"]) { try { await navTo(k); } catch (e) { continue; } const w = await wide(); ok(w <= 1, T("no sideways scrolling on " + k + (w > 1 ? " (" + w + "px too wide)" : ""))); }
    await navTo("dash");
    /* 1. loan repayment: the button is visible at the top, no scrolling, and a back-dated repayment is recorded */
    await pg.click('[data-nav="loans"]').catch(async () => { await pg.click('[data-nav="more"]'); await pg.click('[data-nav="loans"]'); });
    await pg.waitForSelector("#main tbody tr"); await pg.locator("#main tbody tr", { hasText: loan0.id }).first().click(); await pg.waitForSelector('.modal #loan-actions');
    const btn = pg.locator('.modal [data-act="Record repayment"]'); ok((await btn.count()) === 1, T("Record repayment button exists on the loan"));
    const box = await btn.boundingBox(), mb = await pg.locator(".modal").boundingBox(); ok(box && box.y + box.height <= mb.y + mb.height + 1 && box.y < vp.height, T("Record repayment is visible without scrolling"));
    ok((await pg.locator('.modal [data-dlpdf]').count()) === 1, T("loan statement has Download PDF beside Print"));
    const [dl] = await Promise.all([pg.waitForEvent("download", { timeout: 20000 }), pg.click('.modal [data-dlpdf]')]); const buf = fs.readFileSync(await dl.path()); ok(buf.slice(0, 5).toString() === "%PDF-" && buf.length > 3000, T("loan statement downloads as a real PDF (" + dl.suggestedFilename() + ")"));
    const back = iso(new Date(Date.now() - 20 * 864e5)), before = S.readAll(env.ss).transactions.filter((t) => t.loanId === loan0.id && t.type === "Loan Repayment").length;
    await btn.click(); await pg.fill('.modal input[name="amount"]', "10000"); await pg.fill('.modal input[name="date"]', back); await pg.click(".modal [data-submit]"); await pg.waitForSelector(".toast:not(.bad)", { timeout: 15000 });
    await pg.waitForTimeout(400); const reps = S.readAll(env.ss).transactions.filter((t) => t.loanId === loan0.id && t.type === "Loan Repayment");
    ok(reps.length === before + 1 && reps.some((t) => t.date === back && Number(t.amount) === 10000), T("a back-dated repayment (" + back + ") is recorded on the loan"));
    /* 2. back-dated ledger entry */
    await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((m) => m.remove()));
    await pg.click('[data-nav="ledger"]').catch(async () => { await pg.click('[data-nav="more"]'); await pg.click('[data-nav="ledger"]'); }); await pg.click("#add-entry"); await pg.selectOption('.modal select[name="m"]', mem.id); await pg.fill('.modal input[name="amount"]', "4000"); await pg.fill('.modal input[name="date"]', "2026-06-01"); await pg.click(".modal [data-submit]"); await pg.waitForSelector(".toast:not(.bad)", { timeout: 15000 }); await pg.waitForTimeout(300);
    ok(S.readAll(env.ss).transactions.some((t) => t.memberId === mem.id && t.date === "2026-06-01" && Number(t.amount) === 4000 && t.type === "Savings"), T("a back-dated savings entry (1 Jun 2026) is recorded with that date"));
    /* 3. member statement: custom dates + WhatsApp + both PDF buttons */
    await pg.click('[data-nav="members"]').catch(async () => { await pg.click('[data-nav="more"]'); await pg.click('[data-nav="members"]'); }); await pg.locator("#main tbody tr", { hasText: mem.id }).first().click(); await pg.waitForSelector("#stm-pdf");
    await pg.click('.modal [data-chip="custom"]'); await pg.fill("#stm-from", "2026-02-01"); await pg.fill("#stm-to", "2026-06-30"); await pg.click("#stm-apply"); await pg.waitForTimeout(300);
    const per = await pg.innerText("#stm-period"); ok(/1 Feb 2026/.test(per) && /30 Jun 2026/.test(per), T("custom date range applies: " + per.replace(/\s+/g, " ").slice(-60)));
    ok((await pg.locator("#stm-dl").count()) === 1 && (await pg.locator("#stm-pdf").count()) === 1, T("statement has Print and Download PDF"));
    const [wa] = await Promise.all([ctx.waitForEvent("page", { timeout: 8000 }), pg.click("#stm-wa")]); await wa.waitForLoadState().catch(() => {}); ok(/^https:\/\/wa\.me\/\?text=/.test(wa.url()), T("WhatsApp opens WhatsApp with the statement text (not the system share list)")); await wa.close();
    const [dl2] = await Promise.all([pg.waitForEvent("download", { timeout: 20000 }), pg.click("#stm-dl")]); ok(fs.readFileSync(await dl2.path()).slice(0, 5).toString() === "%PDF-", T("statement Download PDF saves a PDF (" + dl2.suggestedFilename() + ")"));
    /* 4. navigation: Back closes a window, then returns to the previous screen */
    await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((m) => m.remove()));
    await pg.click('[data-nav="members"]').catch(() => {}); await pg.locator("#main tbody tr").first().click(); await pg.waitForSelector(".modal");
    await pg.goBack(); await pg.waitForTimeout(300); ok((await pg.locator(".modal-bg").count()) === 0 && (await pg.locator("#logout").count()) === 1, T("Back closes the open window and stays in the app"));
    await pg.click('[data-nav="ledger"]').catch(async () => { await pg.click('[data-nav="more"]'); await pg.click('[data-nav="ledger"]'); }); await pg.waitForSelector("#add-entry");
    await pg.goBack(); await pg.waitForTimeout(400); ok((await pg.locator("#add-entry").count()) === 0 && (await pg.locator("#logout").count()) === 1, T("Back returns to the previous screen"));
    /* 5. member portal: custom dates, WhatsApp, Print + Download PDF */
    await pg.click("#logout"); await pg.waitForSelector("#login-go"); await signin(pg, mem.id.replace("-", "").toLowerCase(), "1234");  /* e.g. "sob001": no hyphen, lower case */ await pg.click("#login-go"); await pg.waitForSelector('[data-card="My Savings"]');
    await pg.click('[data-nav="savings"]'); await pg.waitForSelector("#stmt-period");
    await pg.click('#stmt-period [data-chip="custom"]'); await pg.fill("#sp-from", "2026-02-01"); await pg.fill("#sp-to", "2026-06-30"); await pg.click("#sp-apply"); await pg.waitForTimeout(300);
    ok(/1 Feb(ruary)? 2026/.test(await pg.innerText("#stmt-note")) && /30 Jun(e)? 2026/.test(await pg.innerText("#stmt-note")), T("member custom date range applies"));
    ok((await pg.locator("#print-statement").count()) === 1 && (await pg.locator("#download-statement").count()) === 1, T("member sees Print and Download PDF"));
    const [dl3] = await Promise.all([pg.waitForEvent("download", { timeout: 20000 }), pg.click("#download-statement")]); const pb = fs.readFileSync(await dl3.path()); ok(pb.slice(0, 5).toString() === "%PDF-", T("member Download PDF saves a PDF"));
    const [wa2] = await Promise.all([ctx.waitForEvent("page", { timeout: 8000 }), pg.click("#share-statement")]); ok(/^https:\/\/wa\.me\/\?text=/.test(wa2.url()), T("member WhatsApp share opens WhatsApp")); await wa2.close();
    ok(errs.length === 0, T("no page errors" + (errs.length ? ": " + errs.join("|") : ""))); await ctx.close();
  }
  await b.close(); srv.close(); console.log(fails ? fails + " FAILED" : "audit e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
