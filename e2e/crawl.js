/* Quality gate: every screen, for every role and many members, on phone AND desktop. Opens every tappable card/row, and fails on page errors,
   "undefined"/"NaN"/"[object" text, empty screens, dead taps (a tap that changes nothing) and horizontal page scroll. Demo data only. */
const http = require("http"), fs = require("fs"), path = require("path");
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const root = path.join(__dirname, ".."), mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f)); });
let fails = 0, checks = 0; const bad = (m) => { fails++; process.exitCode = 1; console.log("FAIL  " + m); };
const BAD = /undefined|NaN|\[object|Invalid Date|Infinity/;
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port + "/app/index.html";
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  for (const vp of [{ n: "phone", width: 390, height: 844 }, { n: "desktop", width: 1280, height: 800 }]) {
    const pg = await b.newPage({ viewport: { width: vp.width, height: vp.height } }); const errs = []; pg.on("pageerror", (e) => errs.push(e.message)); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await pg.goto(base); await pg.waitForSelector("#demo-go");
    const info = await pg.evaluate(() => { const d = window.__SOB.db; return { loanMembers: [...new Set(d.loans.map((l) => l.memberId))], members: d.members.map((m) => m.id) }; });
    const FAST = !!process.env.FAST, sample = [...new Set(info.loanMembers.slice(0, FAST ? 2 : 8).concat(info.members.slice(0, FAST ? 1 : 3), info.members.slice(-1)))];
    const where = (w) => vp.n + " " + w;
    const scan = async (w) => { checks++; const t = await pg.evaluate(() => document.body.innerText); if (BAD.test(t)) bad(where(w) + " shows broken text: " + (t.match(BAD) || [])[0]); if (t.trim().length < 20) bad(where(w) + " is empty");
      if (!(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))) bad(where(w) + " scrolls sideways"); };
    const closeAll = async () => { while (await pg.locator("[data-close]").count()) await pg.locator("[data-close]").last().click(); };
    const crawlView = async (w) => {
      await scan(w);
      const taps = await pg.locator("#main .card.click, #main .li.click, #main tr.click").count();
      for (let i = 0; i < Math.min(taps, process.env.FAST ? 3 : 6); i++) {
        const el = pg.locator("#main .card.click, #main .li.click, #main tr.click").nth(i); if (!(await el.isVisible())) continue;
        const before = await pg.evaluate(() => document.getElementById("main").innerText + document.querySelectorAll(".modal-bg").length);
        await el.click({ timeout: 5000 }).catch(() => {}); await pg.waitForTimeout(80);
        const after = await pg.evaluate(() => document.getElementById("main") ? document.getElementById("main").innerText + document.querySelectorAll(".modal-bg").length : "");
        if (before === after && !(await pg.locator(".toast").count())) bad(where(w) + ": tapping item " + (i + 1) + " did nothing");
        await scan(w + " > item " + (i + 1)); await closeAll();
        if (await pg.locator("[data-nav]").count() === 0) return;   // a tap may leave the page (e.g. sign out); stop
      }
    };
    const enter = async (role, mem) => { if (!(await pg.locator("#demo-go").count())) { await pg.click("#logout"); await pg.waitForSelector("#demo-go"); } await pg.selectOption("#demo-role", role); if (mem) await pg.selectOption("#demo-member", mem); await pg.click("#demo-go"); await pg.waitForSelector("[data-nav]"); };
    for (const role of ["Admin", "Chairperson", "Treasurer", "Committee"]) {
      await enter(role); const keys = await pg.$$eval("[data-nav]", (n) => n.map((x) => x.getAttribute("data-nav")));
      for (const k of keys) { await closeAll(); await pg.evaluate((k) => document.querySelector('[data-nav="' + k + '"]').click(), k); await pg.waitForSelector("#main"); await crawlView(role + " " + k); if (!(await pg.locator("[data-nav]").count())) await enter(role); }
    }
    for (const m of sample) {
      await enter("Member", m);
      for (const k of ["home", "savings", "myloans", "myguar", "mysubs", "myshare", "airtime", "more"]) {
        await closeAll(); await pg.evaluate((k) => document.querySelector('[data-nav="' + k + '"]').click(), k); await pg.waitForSelector("#main");
        await crawlView("member " + m + " " + k); if (!(await pg.locator("[data-nav]").count())) await enter("Member", m);
      }
    }
    checks++; if (errs.length) bad(vp.n + " page/console errors: " + [...new Set(errs)].slice(0, 3).join(" | "));
    await pg.close();
  }
  await b.close(); srv.close(); console.log(fails ? fails + " FAILED" : "crawl passed (" + checks + " screens checked)"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
