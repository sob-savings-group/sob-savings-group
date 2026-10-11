/* Layout audit on phone, tablet and computer sizes: no sideways page scroll, nothing cut off the screen edge, tap targets big enough, readable text, Back/Close always reachable. Demo mode. */
const http = require("http"), fs = require("fs"), path = require("path");
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const root = path.join(__dirname, "..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": mime[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { if (!c) { fails++; process.exitCode = 1; console.log("FAIL  " + m); } else if (process.env.V) console.log("  ok  " + m); };
const AUDIT = () => {
  const W = window.innerWidth, bad = { overflow: [], small: [], text: [] };
  if (document.documentElement.scrollWidth > W + 1) bad.overflow.push("PAGE scrollWidth " + document.documentElement.scrollWidth + " > " + W);
  const inScroll = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth) return true; if (p.classList && p.classList.contains("scroll")) return true; } return false; };
  document.querySelectorAll("body *").forEach((el) => {
    const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || el.closest("[hidden]")) return;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
    if (r.right > W + 2 && !inScroll(el) && !el.closest("nav")) bad.overflow.push((el.id || el.className || el.tagName) + " right=" + Math.round(r.right));
    if (el.matches("button, select, input:not([type=checkbox]):not([type=radio]), textarea, a.btn") && !el.closest(".scroll") && r.height < 38 && !el.disabled && !el.closest("nav")) bad.small.push((el.id || el.textContent.trim().slice(0, 20) || el.tagName) + " h=" + Math.round(r.height));
    if (el.children.length === 0 && el.textContent.trim() && parseFloat(cs.fontSize) < 12) bad.text.push(el.textContent.trim().slice(0, 20) + " " + cs.fontSize);
  });
  return bad;
};
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://localhost:" + srv.address().port + "/app/index.html";
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  for (const vp of [{ n: "phone-360", w: 360, h: 740 }, { n: "phone-390", w: 390, h: 800 }, { n: "tablet-768", w: 768, h: 1024 }, { n: "computer-1280", w: 1280, h: 800 }]) {
    for (const role of ["Admin", "Treasurer", "Member"]) {
      const pg = await b.newPage({ viewport: { width: vp.w, height: vp.h } }); const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
      await pg.goto(base); await pg.waitForSelector("#demo-go"); await pg.selectOption("#demo-role", role); await pg.click("#demo-go"); await pg.waitForSelector("#main");
      const views = await pg.$$eval("[data-nav]", (n) => n.map((x) => x.getAttribute("data-nav")));
      for (const v of views) {
        await pg.evaluate((k) => { const b = document.querySelector('[data-nav="' + k + '"]'); if (b) b.click(); }, v); await pg.waitForTimeout(120);
        const a = await pg.evaluate(AUDIT); const tag = vp.n + "/" + role + "/" + v;
        ok(!a.overflow.length, tag + " overflow: " + a.overflow.slice(0, 3).join("; ")); ok(!a.small.length, tag + " small buttons: " + a.small.slice(0, 4).join("; ")); ok(!a.text.length, tag + " tiny text: " + a.text.slice(0, 3).join("; "));
        const card = await pg.$("#main .card.click, #main .li.click, #main tbody tr.click");
        if (card && role !== "Member") { await card.click().catch(() => {}); await pg.waitForTimeout(200);
          if (await pg.$(".modal")) { const m = await pg.evaluate(AUDIT); ok(!m.overflow.length, tag + " window overflow: " + m.overflow.slice(0, 3).join("; ")); ok(!m.small.length, tag + " window small buttons: " + m.small.slice(0, 4).join("; "));
            const cb = await pg.$(".modal .closebtn"); ok(!!cb && (await cb.isVisible()), tag + " window has a visible Close"); await pg.evaluate(() => document.querySelectorAll(".modal-bg").forEach((e) => e.remove())); } }
      }
      ok(errs.length === 0, vp.n + "/" + role + " no page errors " + errs.join("|")); await pg.close();
    }
  }
  await b.close(); srv.close(); console.log(fails ? fails + " FAILED" : "responsive e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
