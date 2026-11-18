/* Phones show five tabs and keep every other screen under More. This lets a test click any [data-nav="x"] the way a person would:
   if the button is not on the bottom bar it opens More first and taps the tile. Require it once at the top of an e2e file. */
let pw; try { pw = require("playwright"); } catch (e) { pw = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright"); }
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async function (...a) {
  const b = await launch(...a);
  const probe = await b.newPage(), P = Object.getPrototypeOf(probe); await probe.close();
  if (!P.__sobNav) {
    P.__sobNav = true; const orig = P.click;
    P.click = async function (sel, opts) {
      const m = typeof sel === "string" && /^\[data-nav="([a-z]+)"\]$/.exec(sel);
      if (m && m[1] !== "menu") { const loc = this.locator(sel); if ((await loc.count()) && !(await loc.first().isVisible()) && (await this.locator('[data-nav="menu"]').count())) { await this.locator('[data-nav="menu"]').click(); await this.waitForSelector('[data-menu="' + m[1] + '"]'); return orig.call(this, '[data-menu="' + m[1] + '"]', opts); } }
      return orig.call(this, sel, opts);
    };
  }
  return b;
};
