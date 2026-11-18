/* Report Centre (DEMO data, offline): filters change the report, the totals tie, PDF and Excel files download. Run: node e2e/report_centre.js */
const http = require("http"), fs = require("fs"), path = require("path");
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const root = path.join(__dirname, ".."), mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": mime[path.extname(f)] || "application/octet-stream" }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "FAIL  ") + m); if (!c) { fails++; process.exitCode = 1; } };
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port + "/app/index.html";
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }), pg = await ctx.newPage(), errs = [];
  pg.on("pageerror", (e) => errs.push(e.message)); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await pg.goto(base); await pg.waitForSelector("#demo-go"); await pg.selectOption("#demo-role", "Admin"); await pg.click("#demo-go"); await pg.waitForSelector("#kpis");
  await pg.click('[data-nav="reports"]'); await pg.waitForSelector("#rc-report");
  const ids = await pg.$$eval("#rc-report optgroup:not(:last-child) option", (o) => o.map((x) => x.value));
  for (const id of ["savings", "loans", "interest", "withdrawals", "deposits", "profit", "shareout", "fysummary", "balances", "outstanding", "repayments", "ledger", "cash", "trial", "audit"]) ok(ids.includes(id), "the Report Centre lists " + id);
  for (const id of ids) { await pg.selectOption("#rc-report", id); await pg.waitForSelector("#rc-result .rc-title"); }
  ok(errs.length === 0, "all " + ids.length + " reports open without a browser error" + (errs.length ? ": " + errs[0] : ""));
  await pg.selectOption("#rc-report", "balances"); await pg.waitForSelector("#rc-member"); const all = await pg.locator("#rc-result tbody tr").count();
  const mem = await pg.$$eval("#rc-member option", (o) => o[1].value); await pg.selectOption("#rc-member", mem); await pg.waitForTimeout(150); ok((await pg.locator("#rc-result tbody tr").count()) === 1 && all > 1, "choosing one member narrows Member Balances to that member");
  await pg.selectOption("#rc-member", ""); await pg.selectOption("#rc-report", "loans"); await pg.waitForSelector("#rc-status"); await pg.selectOption("#rc-status", "Active"); await pg.waitForTimeout(150); ok((await pg.locator("#rc-result tbody tr").count()) > 0, "the status filter works on the Loan Report");
  await pg.selectOption("#rc-report", "deposits"); await pg.waitForSelector("#rc-category"); const cats = await pg.$$eval("#rc-category option", (o) => o.map((x) => x.value).filter(Boolean)); ok(cats.length >= 5, "the Category filter lists the managed purposes (" + cats.length + ")");
  await pg.selectOption("#rc-report", "trial"); await pg.waitForSelector("#rc-result .rc-title"); ok(!/Difference/.test(await pg.innerText("#rc-result")), "the Trial Balance shows no unexplained difference");
  await pg.click("#rc-export"); await pg.waitForSelector("#xm-xlsx");
  const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click("#xm-xlsx")]); const p = await dl.path(); const buf = fs.readFileSync(p);
  ok(dl.suggestedFilename().endsWith(".xlsx") && buf[0] === 0x50 && buf[1] === 0x4b, "Download Excel gives a real .xlsx file (" + dl.suggestedFilename() + ", " + buf.length + " bytes)");
  await pg.click("#rc-export"); await pg.waitForSelector("#xm-dl"); const [pd] = await Promise.all([pg.waitForEvent("download"), pg.click("#xm-dl")]); const pb = fs.readFileSync(await pd.path());
  ok(pd.suggestedFilename().endsWith(".pdf") && pb.slice(0, 5).toString() === "%PDF-", "Download PDF gives a real PDF (" + pd.suggestedFilename() + ")");
  await pg.selectOption("#rc-report", "ledger"); await pg.waitForSelector("#rc-result tfoot"); await pg.screenshot({ path: path.join(root, "shots", "report-centre.png") });
  await b.close(); srv.close(); console.log(fails ? "report centre e2e FAILED" : "report centre e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
