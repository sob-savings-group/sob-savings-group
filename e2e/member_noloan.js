/* A member with no loan sees nothing about loans, gets a warm welcome. Based on the member journey harness. (Member journey in the REAL app (browser UI + bundled backend over HTTP); (originally dates harness) default = today, an earlier genuine date can be chosen,
   the chosen date drives interest/principal split and the guarantor release, and future/invalid dates are refused. Synthetic members only. */
require("./_nav");
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
S.writeCollection(env.ss, "users", S.readCollection(env.ss, "users").concat([A.makeUser(env, { id: "SOB-001", role: "Member", memberId: "SOB-001", pin: "1234" }), A.makeUser(env, { id: "SOB-002", role: "Member", memberId: "SOB-002", pin: "4321" }), A.makeUser(env, { id: "SOB-003", role: "Member", memberId: "SOB-003", pin: "5555" })]));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = http.createServer((q, r) => { const u = q.url.split("?")[0];
  if (u === "/api") { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { r.writeHead(200, { "Content-Type": "application/json" }); r.end(JSON.stringify(q.method === "GET" ? { ok: true, service: "SOB Ledger" } : API.handle(env, JSON.parse(b)))); }); return; }
  if (u === "/app/config.js") { r.writeHead(200, { "Content-Type": "text/javascript" }); return r.end('window.SOB_CONFIG={ledgerUrl:"/api"};'); }
  const f = path.join(root, u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "FAIL  ") + m); if (!c) { fails++; process.exitCode = 1; } };
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
  const signin = async (id, pin) => { await pg.waitForSelector("#login-go"); await pg.fill("#mid", id); await pg.evaluate((v) => { const r = document.getElementById("pin-row"); if (r) r.hidden = false; document.getElementById("pin").value = v; }, pin || ""); await pg.click("#login-go"); await pg.waitForSelector("[data-nav]"); };
  const signout = async () => { await pg.click("#logout"); await pg.waitForSelector("#login-go"); };
  const text = () => pg.evaluate(() => document.getElementById("main").innerText);
  await pg.goto(base + "/app/index.html"); await signin("SOB-003", "5555"); await pg.waitForSelector("#main");
  await pg.waitForTimeout(1200);
  const body = await pg.evaluate(() => document.body.innerText), nav = await pg.evaluate(() => [...document.querySelectorAll("nav button")].map((x) => x.innerText.trim()).join("|"));
  ok(!/loan|guarant/i.test(body), "a member with no loan sees no mention of loans or guarantees anywhere on the home screen");
  ok(!/Loans|Guarantees/.test(nav), "the Loans and Guarantees tabs are not there (" + nav.replace(/\n/g, " ") + ")");
  ok(await pg.evaluate(() => !!document.querySelector(".toast")), "a warm welcome message pops up");
  await pg.evaluate(() => { document.querySelector(".toast") && document.querySelector(".toast").remove(); });
  await pg.click("nav button:has-text('Savings')"); await pg.waitForTimeout(300);
  ok(!/loan|guarant/i.test(await pg.evaluate(() => document.getElementById("main").innerText)), "the Savings screen has no loan filter or guarantee wording");
  ok(!errs.length, "no page errors"); await b.close(); srv.close(); console.log(fails ? "FAILED" : "member no-loan e2e passed");
})();
