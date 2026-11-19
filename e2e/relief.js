require("./_nav");
/* Loan workflows end to end (DEMO data, offline): every loan form opens, shows its LIVE result before saving, submits, and NEVER shows a raw code error. Run: node e2e/loan_workflows.js */
const http = require("http"), fs = require("fs"), path = require("path");
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const root = path.join(__dirname, "..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "application/octet-stream" }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "FAIL  ") + m); if (!c) { fails++; process.exitCode = 1; } };
const RAW = /is not defined|is not a function|ReferenceError|TypeError|Cannot read|undefined/;
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port + "/app/index.html";
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const pg = await b.newPage({ viewport: { width: 390, height: 800 } }); const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message)); pg.on("console", (m) => { if (m.type() === "error" && !/\[SOB\]/.test(m.text())) errs.push(m.text()); });
  await pg.goto(base); await pg.waitForSelector("#demo-go"); await pg.selectOption("#demo-role", "Admin"); await pg.click("#demo-go"); await pg.waitForSelector("#hero");
  await pg.click('[data-nav="loans"]'); await pg.waitForSelector("#loan-totals");
  ok(await pg.locator("#tell-borrowers").count() === 0, "with no interest reduction there is no Tell borrowers button");
  /* demo data only: mark one running loan as already approved-locked from 3 months after it started */
  const set = await pg.evaluate(() => { const st = window.__SOB, T = new Date().toISOString().slice(0, 10), D = window.SOB.dates, l = st.db.loans.find((x) => x.status === "Active" && !x.voided && x.date && D.monthsBetween(x.date, T) >= 4); if (!l) return false; l.interestLocks = [{ from: D.addMonths(l.date, 2), to: "", reason: "Committee reduced the interest period", lockedBy: "DEMO", lockedByRole: "Admin", lockedAt: T }]; return true; });
  ok(set, "a demo loan with an interest reduction exists"); await pg.click('[data-nav="dashboard"]').catch(() => {}); await pg.click('[data-nav="loans"]'); await pg.waitForSelector("#loan-totals");
  ok(await pg.locator("#tell-borrowers").count() === 1, "Tell borrowers appears when interest was reduced");
  await pg.click("#tell-borrowers"); await pg.waitForSelector("#relief-go"); const tx = await pg.locator(".modal").last().innerText();
  ok(/instead of/.test(tx) && /Interest reduced by UGX/.test(tx) && /Loan bal UGX/.test(tx) && /Nothing is sent until you press Send/.test(tx), "each text is shown first with months, the amount taken off and the loan balance");
  ok(!RAW.test(tx), "no raw code on screen");
  await pg.click("#relief-go"); await pg.waitForTimeout(600); const toast = await pg.locator(".toast").last().innerText().catch(() => "");
  ok(/text/.test(toast) && !RAW.test(toast), "result is explained: " + toast.slice(0, 90));
  ok(await pg.locator("#tell-borrowers").count() === 0, "once told, the button goes away (no double sending)");
  ok(!errs.length, "no browser errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close(); srv.close(); console.log(fails ? fails + " failed" : "interest relief e2e passed");
})();
