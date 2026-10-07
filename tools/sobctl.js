#!/usr/bin/env node
/* sobctl — deploy/verify the SOB platform against the REAL deployed Apps Script web app.
   env: SOB_URL (web-app /exec URL), SOB_ADMIN_ID, SOB_ADMIN_PIN, optional SOB_MEMBER_ID/SOB_MEMBER_PIN, SOB_AS_OF
   commands: ping | smoke | smoke-write | import-ledger <legacy.json> [--dry-run] | import-users <users.json> | register-discrepancies <reconciliation.json> |
             apply-plan <reconciliation.json> --approved-by "<name, role, date>" | verify | report <out.md> (after smoke/verify) */
const lib = require("./ctl-lib.js");
const argv = process.argv.slice(2), cmd = argv[0], arg = argv[1], flag = (n) => argv.includes(n), val = (n) => { const i = argv.indexOf(n); return i > 0 ? argv[i + 1] : undefined; };
const E = process.env, o = { adminId: E.SOB_ADMIN_ID, adminPin: E.SOB_ADMIN_PIN, memberId: E.SOB_MEMBER_ID, memberPin: E.SOB_MEMBER_PIN, asOf: E.SOB_AS_OF };
async function api(body) {
  if (!E.SOB_URL) throw new Error("Set SOB_URL to the deployed web-app URL");
  let res = await fetch(E.SOB_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" });
  const text = await res.text(); try { return JSON.parse(text); } catch (e) { throw new Error("Non-JSON response (HTTP " + res.status + "): " + text.slice(0, 200)); }
}
const show = (r) => { (r.checks || []).forEach((c) => console.log((c.pass ? "PASS " : "FAIL ") + c.name + (c.detail && !c.pass ? "  -> " + c.detail : ""))); console.log(r.ok ? "\nRESULT: PASS" : "\nRESULT: FAIL"); process.exitCode = r.ok ? 0 : 1; };
(async () => {
  if (cmd === "ping") return console.log(JSON.stringify(await api({ action: "ping" })));
  if (cmd === "smoke") return show(await lib.smokeReadOnly(api, o));
  if (cmd === "smoke-write") return show(await lib.smokeWrite(api, Object.assign({ allowWrite: E.SOB_ALLOW_WRITE_TESTS === "yes" }, o)));
  if (cmd === "import-ledger") return show(await lib.importLedger(api, Object.assign({ legacyPath: arg, dryRun: flag("--dry-run") }, o)));
  if (cmd === "import-users") return console.log(JSON.stringify(await lib.importUsers(api, Object.assign({ usersPath: arg }, o))));
  if (cmd === "register-discrepancies") return console.log(JSON.stringify(await lib.registerDiscrepancies(api, Object.assign({ reconPath: arg }, o)), null, 1));
  if (cmd === "apply-plan") return show(await lib.applyPlan(api, Object.assign({ reconPath: arg, approvedBy: val("--approved-by") }, o)));
  if (cmd === "verify") { const r = await lib.verify(api, o); console.log(JSON.stringify(r, null, 1)); process.exitCode = r.integrity.ok ? 0 : 1; return; }
  console.log("usage: see header of tools/sobctl.js"); process.exitCode = 2;
})().catch((e) => { console.error("ERROR: " + e.message); process.exit(1); });
