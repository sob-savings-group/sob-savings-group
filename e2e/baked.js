/* A member opens sob-app.html with NO address editing: the production backend is built in, no prompt appears,
   the sign-in screen shows, and the app talks to the built-in URL. Unconfigured builds say so in plain words. */
const { chromium } = require("playwright"), { execSync } = require("child_process"), path = require("path"), assert = require("assert"), root = path.join(__dirname, "..");
const FAKE = "https://script.google.com/macros/s/AKfycbxTESTTESTTESTTEST/exec";
const build = (env) => execSync("node " + path.join(root, "build/make-app-file.js"), { stdio: "pipe", env: Object.assign({}, process.env, env) });
(async () => {
  const br = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const hits = []; let dialogs = 0;
  const open = async (qs) => { const pg = await br.newPage(); pg.on("dialog", (d) => { dialogs++; d.dismiss(); });
    await pg.route("https://script.google.com/**", (r) => { hits.push(r.request().url()); r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: true, service: "SOB Ledger" }) }); });
    await pg.goto("file://" + path.join(root, "dist/sob-app.html") + (qs || "")); return pg; };
  build({ SOB_URL: FAKE }); let pg = await open(); await pg.waitForSelector("#login-go");
  assert.equal(dialogs, 0, "no prompt for members"); assert.equal(await pg.evaluate(() => window.SOB_CONFIG.ledgerUrl), FAKE);
  assert.ok(!(await pg.content()).includes("Paste the SOB web app URL"), "no paste-a-URL text");
  await pg.fill("#mid", "SOB-001"); await pg.fill("#pin", "0000"); await pg.click("#login-go"); await pg.waitForTimeout(800);
  assert.ok(hits.every((u) => u.startsWith(FAKE)), "all calls go to the built-in backend"); assert.ok(hits.length > 0, "sign-in reached the built-in backend");
  const evil = await open("?dev=" + encodeURIComponent("https://evil.example/exec")); assert.equal(await evil.evaluate(() => window.SOB_CONFIG.ledgerUrl), FAKE, "bad override ignored");
  const dev = await open("?dev=" + encodeURIComponent("http://localhost:8123/exec")); assert.equal(await dev.evaluate(() => window.SOB_CONFIG.ledgerUrl), "http://localhost:8123/exec", "developer override works");
  const again = await open(); assert.equal(await again.evaluate(() => window.SOB_CONFIG.ledgerUrl), FAKE, "override is never remembered");
  assert.throws(() => build({ SOB_URL: "https://evil.example/exec" }), /valid Apps Script/);
  build({ SOB_URL: "" }); if (!require("fs").existsSync(path.join(root, "config/production-url.txt"))) { const un = await open(); await un.waitForSelector(".state"); const t = await un.innerText("#app"); assert.ok(/not switched on/.test(t) && /0755 924 822/.test(t) || /Treasurer/.test(t) || /\d{4} \d{3} \d{3}/.test(t), "plain not-configured message"); assert.equal(dialogs, 0); }
  await br.close(); console.log("baked-in backend e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
