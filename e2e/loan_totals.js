/* Loans screen: totals with tap-to-view details, and the interest lock buttons (DEMO data, offline). Run: node e2e/loan_totals.js */
const http = require("http"), fs = require("fs"), path = require("path");
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const root = path.join(__dirname, "..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": mime[path.extname(f)] || "application/octet-stream" }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "FAIL  ") + m); if (!c) { fails++; process.exitCode = 1; } };
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port + "/app/index.html";
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const pg = await b.newPage({ viewport: { width: 390, height: 800 } }); const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message)); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await pg.goto(base); await pg.waitForSelector("#demo-go"); await pg.selectOption("#demo-role", "Admin"); await pg.click("#demo-go"); await pg.waitForSelector("#kpis");
  await pg.click('[data-nav="loans"]'); await pg.waitForSelector("#loan-totals");
  ok((await pg.locator('#loan-totals [data-card="Total loan amount"]').count()) === 1 && (await pg.locator('#loan-totals [data-card="Total interest"]').count()) === 1, "Loans screen shows Total loan amount and Total interest");
  await pg.screenshot({ path: path.join(root, "shots", "loans-totals.png") });
  await pg.click('#loan-totals [data-card="Total interest"]'); await pg.waitForSelector(".modal tbody tr");
  ok((await pg.locator(".modal tbody tr").count()) >= 1, "tapping Total interest lists the loans behind it");
  await pg.click(".modal tbody tr"); await pg.waitForSelector('.modal [data-act="Lock interest"]');
  ok(true, "tapping a loan opens it, and the Admin sees Lock interest");
  await pg.click('.modal [data-act="Lock interest"]'); await pg.waitForSelector(".modal textarea, .modal input[name=reason], .modal input");
  ok((await pg.locator("body").innerText()).includes("Lock interest on this loan"), "the lock form asks for a date and a reason");
  const ctxTxt = await pg.locator("#lock-context").innerText();
  ok(/months charged/i.test(ctxTxt) && /monthly interest/i.test(ctxTxt) && /repaid so far/i.test(ctxTxt) && /owed today/i.test(ctxTxt) && /paid out/.test(ctxTxt), "the lock form shows the loan's history: months charged, interest, repaid, owed");
  await pg.fill('.modal input[name="date"]', "2026-11-01"); await pg.dispatchEvent('.modal input[name="date"]', "input");
  ok(/If locked from/.test(await pg.locator("#lock-preview").innerText()), "choosing a date previews the effect on months and amount owed");
  ok(errs.length === 0, "no browser errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close(); srv.close(); console.log(fails ? "loan totals e2e FAILED" : "loan totals e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
