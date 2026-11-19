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
  const openFirstActive = async () => { await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((e) => e.remove())); await pg.click('[data-nav="loans"]'); await pg.waitForSelector("#loan-totals");
    const rows = pg.locator("tbody tr"), n = await rows.count(); for (let i = 0; i < n; i++) { await rows.nth(i).click(); await pg.waitForSelector(".modal"); if (await pg.locator('.modal [data-act="Settle from savings"]').count()) return true; await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((e) => e.remove())); } return false; };
  const clean = async (what) => { await pg.waitForTimeout(600); const body = await pg.locator("body").innerText(); ok(!RAW.test(body.replace(/Demo|undefined behaviour/g, "")) && !errs.length, what + ": no raw code error on screen" + (errs.length ? " (" + errs[0] + ")" : "")); };
  ok(await openFirstActive(), "an active loan opens with its action buttons");
  /* Settle from savings: live impact BEFORE saving, one step. Try loans until one whose member's savings cover it. */
  let settled = false, shortSeen = false;
  await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((e) => e.remove())); await pg.click('[data-nav="loans"]'); await pg.waitForSelector("#loan-totals"); const total = await pg.locator("tbody tr").count();
  for (let i = 0; i < total && !settled; i++) { await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((e) => e.remove())); await pg.locator("tbody tr").nth(i).click(); await pg.waitForSelector(".modal");
    if (!(await pg.locator('.modal [data-act="Settle from savings"]').count())) continue; await pg.click('.modal [data-act="Settle from savings"]'); await pg.waitForSelector("#settle-preview"); const pv = await pg.locator("#settle-preview").innerText();
    if (/Savings are short/.test(pv)) { if (!shortSeen) { shortSeen = true; ok(await pg.locator(".modal [data-submit]").last().isDisabled(), "when savings are short the preview says so and Save is off"); } continue; }
    if (/Interest paid first/.test(pv)) { ok(/Loan after[\s\S]*Cleared[\s\S]*interest stops/.test(pv), "Settle shows the live result and says the loan is cleared and interest stops (no separate lock)"); await pg.click(".modal [data-submit]"); await clean("Settle from savings"); settled = true; } }
  ok(settled || shortSeen, "the Settle form was exercised (" + (settled ? "settled" : "short only") + ")");
  /* Lock interest (the form that used to throw "M is not defined") */
  await openFirstActive(); const lockBtn = pg.locator('.modal [data-act="Lock interest"], .modal [data-act="Unlock interest"]');
  if (await lockBtn.count()) { await lockBtn.first().click(); await pg.waitForSelector("#lock-preview"); await pg.fill('.modal input[name="reason"]', "e2e"); await pg.click(".modal [data-submit]"); await clean("Lock interest"); }
  /* Correct loan */
  await openFirstActive(); await pg.click('.modal [data-act="Correct loan"]'); await pg.waitForSelector("#correct-preview"); await pg.fill('.modal input[name="reason"]', "e2e"); await pg.fill('.modal input[name="amount"]', "30000"); await pg.click(".modal [data-submit]"); await clean("Correct loan");
  /* Record repayment: live result */
  await openFirstActive(); await pg.click('.modal [data-act="Record repayment"]'); await pg.waitForSelector(".modal .preview"); await pg.fill('.modal input[name="amount"]', "1000");
  ok(/Owed after/.test(await pg.locator(".modal .preview").last().innerText()), "Record repayment shows what will be owed after, before saving");
  await pg.fill('.modal input[name="amount"]', "999999999"); ok(/more than is owed/.test(await pg.locator(".modal .preview").last().innerText()) && await pg.locator(".modal [data-submit]").last().isDisabled(), "an over-payment is explained live and Save is off");
  /* Change interest: live result */
  await openFirstActive(); await pg.click('.modal [data-act="Change interest"]'); await pg.waitForSelector(".modal .preview"); await pg.fill('.modal input[name="amt"]', "25000");
  ok(/Owed today after/.test(await pg.locator(".modal .preview").last().innerText()), "Change interest shows the new amount owed, before saving");
  /* Safety net: an uncaught code error is shown as a plain message, never the code */
  await pg.evaluate(() => { setTimeout(() => { throw new ReferenceError("Q is not defined"); }, 0); }); await pg.waitForTimeout(400);
  const toastTxt = await pg.locator(".toast").last().innerText().catch(() => "");
  ok(/Something went wrong on our side/.test(toastTxt) && !/not defined/.test(toastTxt), "an uncaught code error appears as a plain message, not as code");
  await b.close(); srv.close(); console.log(fails ? "loan workflows e2e FAILED" : "loan workflows e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
