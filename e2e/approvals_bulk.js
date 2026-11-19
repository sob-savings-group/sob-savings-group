require("./_nav");
/* Approvals: each request shows WHAT will change, and the Chairperson can approve many at once (each still approved and audited separately). DEMO data, offline. Run: node e2e/approvals_bulk.js */
const http = require("http"), fs = require("fs"), path = require("path");
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const root = path.join(__dirname, "..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "application/octet-stream" }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "FAIL  ") + m); if (!c) { fails++; process.exitCode = 1; } };
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port + "/app/index.html";
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const pg = await b.newPage({ viewport: { width: 1200, height: 900 } }); const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message)); pg.on("console", (m) => { if (m.type() === "error" && !/\[SOB\]/.test(m.text())) errs.push(m.text()); });
  await pg.goto(base); await pg.waitForSelector("#demo-go"); await pg.selectOption("#demo-role", "Admin"); await pg.click("#demo-go"); await pg.waitForSelector("#hero");
  /* the Admin sends THREE lock-interest requests */
  for (let i = 0; i < 3; i++) { await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((e) => e.remove())); await pg.click('[data-nav="loans"]'); await pg.waitForSelector("#loan-totals"); await pg.locator("tbody tr").nth(i).click(); await pg.waitForSelector(".modal");
    const lock = pg.locator('.modal [data-act="Lock interest"]'); if (!(await lock.count())) continue; await lock.click(); await pg.waitForSelector("#lock-preview"); await pg.fill('.modal input[name="reason"]', "reconsideration"); await pg.click(".modal [data-submit]"); await pg.waitForTimeout(500); }
  await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((e) => e.remove()));
  await pg.click("#logout").catch(() => {}); await pg.waitForSelector("#demo-go"); await pg.selectOption("#demo-role", "Chairperson"); await pg.click("#demo-go"); await pg.waitForSelector("#hero");
  await pg.click('[data-nav="approvals"]'); await pg.waitForSelector("#select-all");
  const rowTxt = await pg.locator("tbody").first().innerText();
  ok(/Lock interest|Stop new interest from/.test(rowTxt) && /Owed today/.test(rowTxt) && /Reason: reconsideration/.test(rowTxt), "each request line shows the lock date, the effect on what is owed, and the reason");
  const n = await pg.locator("[data-pick]").count(); ok(n >= 2, n + " requests can be ticked");
  await pg.locator("tbody tr").first().click(); await pg.waitForSelector(".modal .preview"); const det = await pg.locator(".modal").last().innerText();
  ok(/Member/.test(det) && /Months charged/.test(det) && /Owed today/.test(det) && /Reason/.test(det) && /Requested by/.test(det), "opening a request shows member, loan, effect, reason and who asked");
  await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((e) => e.remove()));
  await pg.click("#select-all"); ok(/Approve selected \(\d+\)/.test(await pg.locator("#bulk-approve").innerText()), "Select all shows 'Approve selected (n)'");
  await pg.click("#bulk-approve"); await pg.waitForSelector("#bulk-go"); ok(/Each is approved and recorded separately/.test(await pg.locator(".modal").last().innerText()), "one confirmation lists every request first");
  await pg.click("#bulk-go"); await pg.waitForTimeout(1200); const t = await pg.locator(".toast").last().innerText().catch(() => "");
  ok(/approved/.test(t) && !/not defined|undefined/.test(t), "result: " + t.slice(0, 80));
  await pg.waitForTimeout(500); ok((await pg.locator("[data-pick]").count()) < n, "approved requests leave the waiting list");
  ok(errs.length === 0, "no browser errors" + (errs[0] ? ": " + errs[0] : ""));
  await b.close(); srv.close(); console.log(fails ? "approvals bulk e2e FAILED" : "approvals bulk e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
