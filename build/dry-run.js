/* Migration dry run on a legacy data file. Prints a verification report + data-quality warnings; writes nothing to production. */
const fs = require("fs"), M = require("../src/core/migrate.js"), L = require("../src/core/ledger.js"), dates = require("../src/core/dates.js");
const file = process.argv[2] || "/mnt/user-data/outputs/SOB_FINAL_DATA_V2.json", asOf = process.argv[3] || dates.todayISO();
const raw = JSON.parse(fs.readFileSync(file, "utf8")), db = M.migrateLegacy(raw, asOf), v = M.verifyMigration(raw, db, asOf);
v.checks.forEach((c) => console.log((c.pass ? "PASS " : "FAIL ") + c.name + "  legacy=" + JSON.stringify(c.legacy) + " migrated=" + JSON.stringify(c.migrated)));
console.log("\nOVERALL:", v.pass ? "VERIFIED" : "MISMATCH", "| asOf", asOf);
const warn = [], d = {}; raw.loans.forEach((l) => { d[l.date] = (d[l.date] || 0) + 1; });
Object.entries(d).forEach(([k, n]) => { if (n >= 5) warn.push(n + " loans share the disbursement date " + k + " — confirm real dates"); });
const t = L.computeGroupTotals(db, asOf).groupSavings; if (raw.summary && raw.summary.totalSavings && raw.summary.totalSavings !== t) warn.push("Legacy header savings " + raw.summary.totalSavings + " != ledger " + t);
console.log("WARNINGS:\n" + (warn.length ? warn.map((w) => " - " + w).join("\n") : " none"));
process.exitCode = v.pass ? 0 : 1;
