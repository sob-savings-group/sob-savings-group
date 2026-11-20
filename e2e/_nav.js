/* Phones show five tabs and keep every other screen under More. This lets a test click any [data-nav="x"] the way a person would:
   if the button is not on the bottom bar it opens More first and taps the tile. Require it once at the top of an e2e file. */
let pw; try { pw = require("playwright"); } catch (e) { pw = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright"); }
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async function (...a) {
  const b = await launch(...a);
  /* a phone that has signed in before opens straight at the password (as a returning member's does); the first-time choice screen has its own test */
  const mkCtx = b.newContext.bind(b); b.newContext = async (...x) => { const c = await mkCtx(...x); await c.addInitScript(() => { try { localStorage.setItem("sobReturning", "1"); } catch (e) { /* none */ } }); return c; };
  b.newPage = async (o) => { const c = await b.newContext(o); return c.newPage(); };
  const probe = await b.newPage(), P = Object.getPrototypeOf(probe); await probe.close();
  if (!P.__sobNav) {
    P.__sobNav = true; const orig = P.click, origFill = P.fill;
    /* sign-in is two short steps (ID, then password): tests that fill both boxes follow the same two taps a person makes */
    P.fill = async function (sel, val, opts) {
      if (sel === "#mid" && (await this.locator("#pw-back").isVisible().catch(() => false))) await this.locator("#pw-back").click();
      if (sel === "#pin" && (await this.locator("#pin").count()) && !(await this.locator("#pin").isVisible()) && (await this.locator("#login-go").isVisible())) await this.locator("#login-go").click();
      return origFill.call(this, sel, val, opts);
    };
    P.click = async function (sel, opts) {
      const m = typeof sel === "string" && /^\[data-nav="([a-z]+)"\]$/.exec(sel);
      if (m && m[1] !== "menu") { const loc = this.locator(sel); if ((await loc.count()) && !(await loc.first().isVisible()) && (await this.locator('[data-nav="menu"]').count())) { await this.locator('[data-nav="menu"]').click(); await this.waitForSelector('[data-menu="' + m[1] + '"]'); return orig.call(this, '[data-menu="' + m[1] + '"]', opts); } }
      if (sel === "#login-go" && !(await this.locator("#login-go").isVisible().catch(() => false)) && (await this.locator("#login-submit").isVisible().catch(() => false))) return orig.call(this, "#login-submit", opts);
      return orig.call(this, sel, opts);
    };
  }
  return b;
};
