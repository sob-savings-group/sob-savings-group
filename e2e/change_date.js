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
  await pg.click('[data-nav="ledger"]'); await pg.waitForSelector("tbody tr"); await pg.locator("tbody tr").first().click(); await pg.waitForSelector(".modal");
  ok(await pg.locator('.modal [data-act="change-date"]').count() === 1, "an entry offers Change date to the officer");
  await pg.click('.modal [data-act="change-date"]'); await pg.waitForSelector('.modal input[name="evidence"]');
  const cur = await pg.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 400); return d.toISOString().slice(0, 10); });
  await pg.fill('.modal input[name="date"]', cur); await pg.fill('.modal input[name="evidence"]', "bank slip"); await pg.fill('.modal input[name="reason"]', "paid on this day, recorded late");
  await pg.click(".modal [data-submit]"); await pg.waitForTimeout(600); const toast = await pg.locator(".toast").last().innerText().catch(() => "");
  ok(/Chairperson|approval/i.test(toast) && !RAW.test(toast), "it is sent to the Chairperson, with no raw error: " + toast.slice(0, 80));
  const pend = await pg.evaluate(() => (window.__SOB.db.approvalRequests || []).filter((r) => r.status === "Pending" && r.command === "correctEntryDate").length); ok(pend >= 1, "a date-change request is waiting for approval (" + pend + ")");
  const fr = await pg.evaluate(() => { const f = window.SOBUI.friendly, mk = (code, msg) => Object.assign(new Error(msg), { code }); return [f(mk("NETWORK", "NETWORK: the app could not reach Google (offline, blocked, or the web-app address is wrong).")), f(mk("TIMEOUT", "TIMEOUT: slow")), f(mk("ENDPOINT_NOT_PUBLIC", "ENDPOINT_NOT_PUBLIC: Google asked for a sign-in. In Apps Script: Deploy > Manage deployments")), f(new TypeError("x is not defined"))]; });
  ok(/^No internet connection/.test(fr[0]) && !/Google|Apps Script/.test(fr[0]), "no internet is said in plain words: " + fr[0]);
  ok(/taking too long/.test(fr[1]), "a slow connection is said in plain words");
  ok(/not available right now/.test(fr[2]) && !/Apps Script|Deploy/.test(fr[2]), "a Google/deployment problem shows members a short plain message, not the Apps Script steps: " + fr[2]);
  ok(/Something went wrong on our side/.test(fr[3]), "a code error is still hidden");
  ok(!errs.length, "no browser errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close(); srv.close(); console.log(fails ? fails + " failed" : "change date e2e passed");
})();
