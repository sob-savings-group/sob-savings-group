/* The dashboard period selector, in a real browser against the real server code: picking a period changes every KPI, a card opens its drill-down,
   the drill-down ties to the card, the PDF carries the same period and total, and entries/loans open at the chosen date. */
const assert = require("assert"), fs = require("fs"), path = require("path"), http = require("http");
const { chromium } = require("playwright"), root = path.join(__dirname, ".."), mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const D = require("../src/core/dates.js"), L = require("../src/core/ledger.js"), K = require("../src/core/kpis.js");
let fails = 0; const ok = (c, m) => { if (c) console.log("  ok  " + m); else { fails++; console.log("FAIL  " + m); } };
(async () => {
  const seed = JSON.parse(fs.readFileSync(path.join(root, "app/demo-seed.json"), "utf8")), db = require("../src/core/migrate.js").migrateLegacy(seed, D.todayISO());
  const srv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split("?")[0]); if (u === "/") u = "/app/index.html"; const f = path.join(root, u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f)); });
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port;
  const br = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }); const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }), pg = await ctx.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(base + "/app/index.html"); await pg.selectOption("#demo-role", "Admin"); await pg.click("#demo-go"); await pg.waitForSelector("#kpis");
  const val = async (label) => (await pg.locator('[data-card="' + label + '"] .val').first().innerText()).replace(/\D/g, "");
  const live = await pg.evaluate(() => window.__SOB.db); const today = D.todayISO();
  ok((await pg.locator("#kpis .card").count()) === 6 && (await pg.locator("#activity .card").count()) === 9, "6 balance KPIs and 9 activity KPIs, each with its own basis");
  ok(/as at/i.test(await pg.innerText("#period-note")) && /Activity covers/.test(await pg.innerText("#period-note")), "the selector says what each kind of figure means");
  for (const [chip, p] of [["year", D.presetPeriod("year", today)], ["all", D.presetPeriod("all", today)], ["lastYear", D.presetPeriod("lastYear", today)], ["month", D.presetPeriod("month", today)]]) {
    await pg.click('[data-chip="' + chip + '"]'); await pg.waitForFunction((t) => document.querySelector("#period-note").innerText.includes(t), p.text.split(" – ").pop().replace(/^Start of records – /, ""));
    const o = K.overview(live, p);
    ok((await val("Total Savings")) === String(Math.round(o.totalSavings.value)) && (await val("Outstanding Loans")) === String(Math.round(o.outstandingLoans.value)) && (await val("Interest Receivable")) === String(Math.round(o.interestReceivable.value)) && (await val("Savings Received")) === String(Math.round(o.savingsReceived.value)), "'" + p.label + "': cards on screen equal the engine for " + p.text);
  }
  await pg.click('[data-chip="custom"]'); await pg.fill("#p-from", "2026-02-01"); await pg.fill("#p-to", "2026-04-30"); await pg.click("#p-apply"); await pg.waitForSelector("#period-note");
  const cp = D.customPeriod("2026-02-01", "2026-04-30", today), co = K.overview(live, cp);
  ok((await val("Total Savings")) === String(Math.round(co.totalSavings.value)) && (await val("Savings Received")) === String(Math.round(co.savingsReceived.value)), "custom 1 Feb – 30 Apr: balances as at 30 Apr, activity inside the range");
  await pg.click('[data-chip="custom"]'); await pg.fill("#p-to", "2099-01-01").catch(() => {}); await pg.fill("#p-from", "2026-05-01"); await pg.fill("#p-to", "2026-04-01"); await pg.click("#p-apply"); await pg.waitForSelector(".toast");
  ok(/after/i.test(await pg.locator(".toast").last().innerText()), "an end date before the start date is refused in plain words");
  /* drill chain on a past date */
  await pg.click('[data-chip="lastYear"]'); await pg.click('[data-card="Total Savings"]'); await pg.waitForSelector('.modal [data-tie]');
  ok((await pg.locator('.modal [data-tie="ok"]').count()) === 1, "Total Savings drill-down ties to the card (green tick)");
  const lyp = D.presetPeriod("lastYear", today), lyv = K.detail(live, "totalSavings", lyp);
  const rowsTxt = await pg.locator(".modal tbody tr").count(); ok(rowsTxt === lyv.rows.length, "drill-down lists exactly the members behind the figure (" + rowsTxt + ")");
  if (lyv.rows.length) { await pg.locator(".modal tbody tr").first().click(); await pg.waitForFunction(() => document.querySelectorAll(".modal-bg").length === 2); ok(/as at 31 Dec/.test(await pg.locator(".modal-bg").last().innerText()), "opening a member from a past-date figure shows them as at that date"); }
  await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((m) => m.remove()));
  /* PDF carries the period and the same total */
  await pg.click('[data-chip="year"]'); await pg.click('[data-card="Savings Received"]'); await pg.waitForSelector('.modal [data-print]');
  const [pop] = await Promise.all([ctx.waitForEvent("page"), pg.click('.modal [data-print]')]); await pop.waitForLoadState(); const html = await pop.content();
  const yp = D.presetPeriod("year", today), yv = K.detail(live, "savingsReceived", yp);
  ok(html.includes("Reporting period: " + yp.text) && /BWOMI/.test(html), "the PDF header carries the same period (" + yp.text + ") and the SOB letterhead");
  ok(yv.value === 0 || html.includes(Math.round(yv.value).toLocaleString("en-US")), "the PDF total equals the dashboard figure (" + Math.round(yv.value).toLocaleString("en-US") + ")"); await pop.close();
  /* the selection survives navigation */
  await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((m) => m.remove())); await pg.click('[data-chip="lastYear"]'); await pg.click('[data-nav="reports"]'); await pg.waitForSelector("#kpi-reports");
  ok(/Last year|31 Dec/.test(await pg.innerText("#period-note")), "the Reports page uses the same period"); ok((await pg.locator("#kpi-reports .card").count()) === K.KEYS.length, "every dashboard figure is also a report");
  /* member statement period: list, brought-forward/closing line and PDF follow the chosen range */
  await pg.click("#logout"); await pg.waitForSelector("#demo-go"); await pg.selectOption("#demo-role", "Member"); await pg.click("#demo-go"); await pg.waitForSelector('[data-card="My Savings"]'); await pg.click('[data-nav="savings"]'); await pg.waitForSelector("#stmt-period");
  const mid = await pg.evaluate(() => window.__SOB.user.memberId), lp = D.presetPeriod("lastYear", today);
  await pg.click('#stmt-period [data-chip="lastYear"]'); await pg.waitForFunction(() => /brought forward/.test(document.getElementById("stmt-note").innerText));
  const note = await pg.innerText("#stmt-note"), closeLY = L.memberSavingsAsOf(live, mid, lp.to);
  ok(note.includes(Math.round(closeLY).toLocaleString("en-US")) && /31 Dec 2025/.test(note), "member statement: last-year closing balance on screen equals the ledger as at 31 Dec 2025 (" + closeLY.toLocaleString("en-US") + ")");
  ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs[0] : "")); await br.close(); srv.close(); if (fails) process.exit(1); console.log("kpi period e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
