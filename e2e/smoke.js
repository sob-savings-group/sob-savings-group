/* Browser smoke/E2E in DEMO mode. Run: node e2e/smoke.js  (needs playwright + a static server; starts its own). */
const http = require("http"), fs = require("fs"), path = require("path");
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const root = path.join(__dirname, "..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "FAIL  ") + m); if (!c) { fails++; process.exitCode = 1; } };
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port + "/app/index.html";
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  for (const vp of [{ name: "desktop", width: 1280, height: 900 }, { name: "mobile", width: 390, height: 800 }]) {
    const pg = await b.newPage({ viewport: { width: vp.width, height: vp.height } }); const errs = [];
    pg.on("pageerror", (e) => errs.push(e.message)); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await pg.goto(base); await pg.waitForSelector("#demo-go");
    await pg.selectOption("#demo-role", "Admin"); await pg.click("#demo-go"); await pg.waitForSelector("#kpis");
    ok((await pg.locator("#kpis .card").count()) === 9, vp.name + ": 9 KPI cards");
    ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), vp.name + ": no horizontal page scroll");
    await pg.click('[data-card="Outstanding Loans"]'); await pg.waitForSelector(".modal");
    ok((await pg.locator(".modal tbody tr").count()) >= 10, vp.name + ": Outstanding Loans drill-down lists the 10 loans");
    await pg.screenshot({ path: path.join(root, "shots", vp.name + "-drilldown.png") });
    await pg.click(".modal tbody tr"); await pg.waitForSelector('.modal [data-act="Record repayment"]');
    ok(true, vp.name + ": loan detail opens with actions");
    await pg.click('.modal [data-act="Change interest"]'); await pg.fill('.modal input[name="reason"]', "e2e"); await pg.click('[data-submit]');
    await pg.waitForSelector(".toast");
    await pg.keyboard.press("Escape"); await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((e) => e.remove()));
    await pg.screenshot({ path: path.join(root, "shots", vp.name + "-admin.png"), fullPage: true });
    for (const v of ["members", "loans", "ledger", "subs", "airtime", "shareout", "reports", "recon", "audit", "messages", "system"]) { await pg.click('[data-nav="' + v + '"]'); await pg.waitForSelector("#main"); ok((await pg.locator("#main .err").count()) === 0, vp.name + ": admin " + v + " renders"); ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), vp.name + ": " + v + " has no horizontal page scroll"); }
    await pg.click('[data-nav="messages"]'); ok((await pg.locator("#dryrun-banner").count()) === 1, vp.name + ": messages screen shows the dry-run banner");
    await pg.click('[data-nav="reports"]'); await pg.click('[data-card="Quarterly distribution"]'); ok((await pg.locator(".modal .blocked").count()) === 1, vp.name + ": quarterly distribution shows blocked state");
    await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((e) => e.remove()));
    await pg.click('[data-nav="shareout"]'); ok((await pg.locator(".blocked").count()) >= 1, vp.name + ": share-out shows blocked profit notice");
    await pg.click('[data-nav="dash"]'); await pg.click('[data-card="Interest Receivable"]'); await pg.waitForSelector(".modal tbody tr"); ok((await pg.locator(".modal tbody tr").count()) >= 1, vp.name + ": Interest Receivable drills down to loans"); await pg.keyboard.press("Escape"); if (await pg.locator(".modal-bg").count()) await pg.locator(".modal-bg").first().click({ position: { x: 2, y: 2 } });
    await pg.click('[data-nav="profit"]'); await pg.waitForTimeout(100);
    ok((await pg.locator("#profit-cycle").count()) === 1 && /Cycle inputs/.test(await pg.locator("#main").innerText()) && !/Approved factors/.test(await pg.locator("#main").innerText()), vp.name + ": Profit shows audited cycle inputs (pool and measurement date are Admin inputs)");
    await pg.click('[data-nav="approvals"]'); await pg.waitForTimeout(100);
    { const tx = await pg.locator("#main").innerText(); ok(/unpaid interest first/i.test(tx) && !/PENDING SOB DECISION|whole loan/i.test(tx), vp.name + ": the fixed repayment rule (interest first) is shown, nothing is pending"); }
    for (const role of ["Chairperson", "Treasurer"]) {
      await pg.click("#logout"); await pg.waitForSelector("#demo-go"); await pg.selectOption("#demo-role", role); await pg.click("#demo-go"); await pg.waitForSelector("#kpis");
      await pg.click('[data-nav="loans"]'); ok((await pg.locator("#apply, #new-loan, #record-loan").count()) === 0, vp.name + ": " + role + " has no loan-entry buttons");
      await pg.click('[data-nav="ledger"]'); ok((await pg.locator("#add-entry, #new-entry, #record-entry").count()) === 0, vp.name + ": " + role + " has no ledger-entry buttons");
    }
    await pg.click("#logout"); await pg.waitForSelector("#demo-go"); await pg.selectOption("#demo-role", "Admin"); await pg.click("#demo-go"); await pg.waitForSelector("#kpis");
    await pg.click("#logout"); await pg.waitForSelector("#demo-go"); await pg.selectOption("#demo-role", "Member"); await pg.click("#demo-go"); await pg.waitForSelector('[data-card="My Savings"]');
    ok((await pg.locator("[data-nav]").count()) === 4, vp.name + ": member sees only member navigation");
    ok((await pg.locator('[data-nav="ledger"]').count()) === 0, vp.name + ": member has no ledger/admin access in UI");
    await pg.click('[data-nav="savings"]'); await pg.waitForSelector("table"); await pg.click('[data-nav="myloans"]');
    await pg.click('[data-nav="airtime"]'); await pg.waitForSelector("#request-airtime"); ok((await pg.locator("#main .err").count()) === 0 && await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), vp.name + ": member airtime screen renders without horizontal scroll");
    await pg.screenshot({ path: path.join(root, "shots", vp.name + "-member-airtime.png"), fullPage: true });
    await pg.screenshot({ path: path.join(root, "shots", vp.name + "-member.png"), fullPage: true });
    ok(errs.length === 0, vp.name + ": no console/page errors" + (errs.length ? " -> " + errs.join(" | ") : ""));
    await pg.close();
  }
  await b.close(); srv.close(); console.log(fails ? fails + " FAILED" : "e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
