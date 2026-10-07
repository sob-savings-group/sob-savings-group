/* The repository is PUBLIC: fail if any tracked file (other than the legacy snapshots that already exist on main) carries real personal data. */
const assert = require("assert"), fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const root = path.join(__dirname, ".."), legacy = process.env.SEED || process.env.REAL_DATA || "/mnt/user-data/outputs/SOB_FINAL_DATA_V2.json";
let f = 0; const t = (n, fn) => { try { fn(); console.log("  ok  " + n); } catch (e) { f++; process.exitCode = 1; console.log("FAIL  " + n + "\n      " + e.message); } };
t("no real member name/phone/e-mail appears in any file this release adds (src, app, tests, tools, docs, dist, deploy)", () => {
  if (!fs.existsSync(legacy)) { console.log("      (real data file not present here - check skipped)"); return; }
  const raw = JSON.parse(fs.readFileSync(legacy, "utf8")), needles = [];
  raw.members.forEach((m) => { if (m.name && m.name.length > 5) needles.push(m.name); if (m.phone && String(m.phone).length > 6) needles.push(String(m.phone)); if (m.email) needles.push(m.email); });
  const files = execSync("git ls-files src app tests tools docs deploy build e2e dist package.json", { cwd: root }).toString().split("\n").filter(Boolean);
  /* The five SOB officers named in the mandatory report footer (supplied by the group for the letterhead) are the ONLY allowed exception, and only in the files that carry the letterhead. */
  const OFFICER_TEXT = require("../src/core/reports.js").OFFICERS.map((o) => o.join(" ")).join("|"), LETTERHEAD = new Set(["src/core/reports.js", "dist/Code_Ledger.gs", "dist/sob-app.html", "dist/verify.html", "tests/branding.test.js", "e2e/pdf.js"]);
  const hits = []; files.forEach((fl) => { if (!fs.existsSync(path.join(root, fl))) return; const txt = fs.readFileSync(path.join(root, fl), "utf8"); needles.forEach((n) => { if (txt.includes(n) && !(LETTERHEAD.has(fl) && OFFICER_TEXT.includes(n))) hits.push(fl + " has '" + n.slice(0, 4) + "…'"); }); });
  assert.deepEqual(hits.slice(0, 5), []);
});
t(".gitignore protects PIN slips and provisioning output", () => { const g = fs.readFileSync(path.join(root, ".gitignore"), "utf8"); assert.ok(/provisioned/.test(g) && /pin-slips/.test(g)); });
console.log(f ? f + " FAILED" : "privacy passed");
