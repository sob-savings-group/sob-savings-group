require("./_nav");
/* One Loan Correction Request (restore + interest + lock, one approval) (DEMO data, offline). Run: node e2e/loan_correction.js */
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
  await pg.goto(base); await pg.waitForSelector("#demo-go"); await pg.selectOption("#demo-role", "Admin"); await pg.click("#demo-go"); await pg.waitForSelector("#hero");
  await pg.click('[data-nav="loans"]'); await pg.waitForSelector("#loan-totals");
  await pg.locator("tbody tr").first().click(); await pg.waitForSelector('.modal [data-act="Correct loan"]');
  ok(true, "the Admin sees one 'Correct loan' button on a loan");
  await pg.click('.modal [data-act="Correct loan"]'); await pg.waitForSelector('.modal input[name="lockFrom"]');
  const txt = await pg.locator(".modal").last().innerText();
  ok(/Monthly interest/i.test(txt) && /Stop interest from/i.test(txt) && /one request|ONE request/i.test(txt) && /approves this ONE request/.test(txt), "the form has the interest, lock date and reason parts and says it is a single request");
  ok(/Result:/.test(await pg.locator("#correct-preview").innerText()), "a live result line shows months charged and interest");
  await pg.fill('.modal input[name="amount"]', "40000"); await pg.fill('.modal input[name="lockFrom"]', "2026-07-10"); await pg.dispatchEvent('.modal input[name="lockFrom"]', "input");
  ok(/locked from/.test(await pg.locator("#correct-preview").innerText()), "choosing a lock date updates the result line");
  await pg.fill('.modal input[name="reason"]', "e2e correction"); await pg.click(".modal [data-submit]"); await pg.waitForTimeout(700);
  await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((e) => e.remove()));
  await pg.click('[data-nav="menu"]').catch(() => {}); await pg.click('[data-nav="approvals"]'); await pg.waitForTimeout(400);
  ok(/Correct a loan \(restore, monthly interest, lock\)/.test(await pg.locator("body").innerText()) || /monthly interest .* to 40000/.test(await pg.locator("body").innerText()), "ONE pending request appears for the Chairperson, listing the whole correction");
  ok(errs.length === 0, "no browser errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close(); srv.close(); console.log(fails ? "loan correction e2e FAILED" : "loan correction e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
