/* E2E: the Admin "Load SOB records" screen drives the real backend (bundled Code_Ledger.gs on a mock Sheet) through a real browser:
   pick the records file, check, load, see the reconciliation report, re-load (no duplicates), create sign-ins. Synthetic pack unless PACK=<private pack> is given. */
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os"), { execSync } = require("child_process");
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const root = path.join(__dirname, ".."); execSync("node " + path.join(root, "build/build-gs.js"));
const g = require("../tests/helpers/gas.js"), { makePack } = require("../tests/helpers/pack.js"), s = g.start(); s.setupAdmin();
const packFile = process.env.PACK || path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sob-rec-")), "pack.json"); if (!process.env.PACK) fs.writeFileSync(packFile, JSON.stringify(makePack()));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  if (u === "/api") { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { r.writeHead(200, { "Content-Type": "application/json" }); r.end(q.method === "GET" ? JSON.stringify({ ok: true, service: "SOB Ledger" }) : s.sb.doPost({ postData: { contents: b } }).s); }); return; }
  if (u === "/app/config.js") { r.writeHead(200, { "Content-Type": "text/javascript" }); return r.end('window.SOB_CONFIG={ledgerUrl:"/api"};'); }
  const f = path.join(root, u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f));
});
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "FAIL  ") + m); if (!c) { fails++; process.exitCode = 1; } };
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port;
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }), ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } }), pg = await ctx.newPage(), errs = []; pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(base + "/app/index.html"); await pg.waitForSelector("#login-go");
  await pg.fill("#mid", "ADMIN"); await pg.fill("#pin", "Adm1n-Setup-77"); await pg.click("#login-go");
  await pg.waitForSelector('[data-nav="system"], #kpis, #pin-new', { timeout: 20000 });
  if (await pg.locator("#pin-new").count()) { ok(true, "first sign-in asks for a new PIN"); await pg.fill("#pin-old", "Adm1n-Setup-77").catch(() => {}); }
  await pg.click('[data-nav="system"]'); await pg.waitForSelector("#records-panel");
  ok(await pg.locator("#records-load").isDisabled(), "Load is disabled until a records file is chosen");
  await pg.setInputFiles("#records-file", packFile); await pg.waitForSelector("#records-state");
  ok(/empty/i.test(await pg.textContent("#records-state")) || /ready to load/.test(await pg.textContent("#records-state")), "empty Sheet is detected");
  await pg.click("#records-load"); await pg.waitForSelector("#records-result", { timeout: 30000 });
  ok(/approver name/.test(await pg.textContent("#records-result")) && (await pg.locator("#records-report").count()) === 0, "loading without an approver is refused and writes nothing");
  await pg.fill("#records-approver", "Test Approver, Admin, 8 Oct 2026"); await pg.click("#records-check"); await pg.waitForFunction(() => /DRY RUN/.test((document.querySelector("#records-result") || {}).textContent || ""), null, { timeout: 60000 });
  ok(/DRY RUN/.test(await pg.textContent("#records-result")) && (await pg.locator("#records-report").count()) === 0, "check-only writes nothing");
  await pg.click("#records-load"); await pg.waitForSelector("#records-report", { timeout: 180000 });
  ok(!/FAIL /.test(await pg.textContent("#records-result")), "every check passes after loading");
  ok((await pg.locator("#records-report table").count()) >= 8, "reconciliation report: members, controls, financial years, profit, historical loans, reserve and remaining differences");
  ok(/Actual savings/.test(await pg.textContent("#records-report")) && /Available savings/.test(await pg.textContent("#records-report")), "savings and available savings are shown separately");
  const [dl] = await Promise.all([pg.waitForEvent("download"), pg.locator("#records-report >> text=Download CSV").first().click()]); const csv = fs.readFileSync(await dl.path(), "utf8"); ok(/Actual savings/.test(csv) && csv.split("\n").length > 5, "report downloads as CSV");
  await pg.click("#records-load"); await pg.waitForFunction(() => /already in the Sheet/.test((document.querySelector("#records-result") || {}).textContent || ""), null, { timeout: 120000 }); ok(true, "loading again adds nothing twice");
  const [sl] = await Promise.all([pg.waitForEvent("download"), pg.click("#make-signins")]); const slips = fs.readFileSync(await sl.path(), "utf8"); ok(/^id,name,pin/.test(slips) && slips.split("\n").length > 10, "member sign-ins created with a PIN-slip download");
  await pg.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), "records.png"), fullPage: true });
  ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close(); srv.close(); console.log(fails ? fails + " failed" : "records e2e passed");
})();
