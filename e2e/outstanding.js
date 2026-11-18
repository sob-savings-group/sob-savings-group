/* E2E: the Admin "Enter outstanding transactions" screen (derived from records.js). Original: "Load SOB records" screen drives the real backend (bundled Code_Ledger.gs on a mock Sheet) through a real browser:
   pick the records file, check, load, see the reconciliation report, re-load (no duplicates), create sign-ins. Synthetic pack unless PACK=<private pack> is given. */
require("./_nav");
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
  await pg.fill("#mid", "ADMIN"); await pg.evaluate((v) => { const r = document.getElementById("pin-row"); if (r) r.hidden = false; document.getElementById("pin").value = v; }, "Adm1n-Setup-77"); await pg.click("#login-go");
  await pg.waitForSelector('[data-nav="system"], #hero, #pin-new', { timeout: 20000 });
  if (await pg.locator("#pin-new").count()) { await pg.fill("#pin-old", "Adm1n-Setup-77").catch(() => {}); }
  await pg.click('[data-nav="system"]');
  const packj = JSON.parse(fs.readFileSync(packFile, "utf8")), m0 = packj.legacy.members[0].id;
  await pg.waitForSelector("#records-panel"); await pg.setInputFiles("#records-file", packFile); await pg.fill("#records-approver", "Test Approver, Admin, 8 Oct 2026"); await pg.click("#records-load"); await pg.waitForSelector("#records-report", { timeout: 180000 });
  const ent = path.join(path.dirname(packFile), "entries.json"); fs.writeFileSync(ent, JSON.stringify({ kind: "SOB_ENTRIES_PACK", batchId: "OUT-E2E", entries: [{ ref: "1", date: "2026-03-23", memberId: m0, type: "Savings", amount: 2000 }, { ref: "2", date: "2026-10-20", memberId: m0, type: "Withdraw", amount: 1000 }], controls: { count: 2 } }));
  await pg.waitForSelector("#outstanding-panel"); ok(await pg.locator("#out-post").isDisabled(), "Enter is disabled until a file is chosen");
  await pg.setInputFiles("#out-file", ent); await pg.click("#out-post"); await pg.waitForTimeout(800); ok(!(await pg.locator("#out-result").count()), "nothing happens without a confirmer");
  await pg.fill("#out-approver", "Test Approver, Chairperson, 18 Nov 2026"); await pg.click("#out-check"); await pg.waitForSelector("#out-result", { timeout: 30000 });
  ok(/Nothing was posted/.test(await pg.textContent("#out-result")), "check-only reports and posts nothing");
  await pg.click("#out-post"); await pg.waitForFunction(() => /1 waiting for the Chairperson/.test((document.querySelector("#out-result") || {}).textContent || ""), null, { timeout: 30000 }); ok(true, "withdrawal is held for the Chairperson; savings posted");
  const t1 = await pg.textContent("#out-result"); ok(/awaiting Chairperson approval/.test(t1) && /Savings/.test(t1), "result table lists both lines");
  await pg.click("#out-post"); await pg.waitForFunction(() => /2 already done/.test((document.querySelector("#out-result") || {}).textContent || ""), null, { timeout: 30000 }); ok(true, "running again adds nothing twice");
  await pg.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), "outstanding.png"), fullPage: true });
  const bad = errs.filter((x) => !/Type who confirmed/.test(x)); ok(bad.length === 0, "no page errors" + (bad.length ? ": " + bad[0] : ""));
  await b.close(); srv.close(); console.log(fails ? fails + " failed" : "outstanding e2e passed");
})();
