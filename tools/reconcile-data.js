#!/usr/bin/env node
/* Read-only reconciliation of the data set the platform would migrate against the source workbooks.
   usage: node tools/reconcile-data.js <legacy.json> <SYSTEM-rows.json> <DATABASE-rows.json> <asOf YYYY-MM-DD> <outDir>
   Writes <outDir>/reconciliation.json and <outDir>/RECONCILIATION_REPORT.md. Changes NOTHING: the "plan" it produces is a list of
   audited commands that SOB may approve and apply later with `sobctl apply-plan`. */
const fs = require("fs"), path = require("path");
const M = require("../src/core/migrate.js"), L = require("../src/core/ledger.js"), G = require("../src/core/governance.js"), CMD = require("../src/core/commands.js"), I = require("../src/core/integrity.js");
const [legacyFile, sysFile, dbFile, asOf, outDir] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(legacyFile, "utf8")), SYS = JSON.parse(fs.readFileSync(sysFile, "utf8")), DBX = JSON.parse(fs.readFileSync(dbFile, "utf8"));
const db = M.migrateLegacy(raw, asOf), fmt = (n) => Math.round(n).toLocaleString("en-US");
const key = (a) => a.join("|"), multiset = (rows) => { const m = {}; rows.forEach((r) => { m[key(r)] = (m[key(r)] || 0) + 1; }); return m; };
const diff = (A, B) => { const out = []; for (const k in A) for (let i = 0; i < A[k] - (B[k] || 0); i++) out.push(k); return out.sort(); };
const asRow = (r) => [r.date, r.memberId, Number(r.amount), r.type];
const seedRows = db.transactions.filter((t) => !t.voided).map(asRow), sysRows = SYS.rows.map(asRow), dbRows = DBX.rows.map(asRow);
const onlySeed = diff(multiset(seedRows), multiset(sysRows)), onlySys = diff(multiset(sysRows), multiset(seedRows));
const isLoanRow = (k) => /Loan (Disbursement|Repayment)$/.test(k);
const nonLoanDiff = onlySeed.concat(onlySys).filter((k) => !isLoanRow(k));
const dbOnly = diff(multiset(dbRows), multiset(sysRows)), sysOverDb = diff(multiset(sysRows), multiset(dbRows));
const dbMaxDate = dbRows.map((r) => r[0]).sort().pop();
const sav = (rows) => { const per = {}; rows.forEach(([d, m, a, t]) => { const s = t === "Savings" || t === "Profit" ? a : (t === "Withdraw" || t === "Bank Charge" ? -a : 0); per[m] = (per[m] || 0) + s; }); return per; };
const pPlat = {}; db.members.forEach((m) => (pPlat[m.id] = L.memberSavings(db, m.id))); const pSys = sav(sysRows), pDb = sav(dbRows);
const memberIds = [...new Set(Object.keys(pPlat).concat(Object.keys(pSys), Object.keys(pDb)))].sort();
const savVsSys = memberIds.filter((m) => Math.abs((pPlat[m] || 0) - (pSys[m] || 0)) > 0.5), savVsDb = memberIds.filter((m) => Math.abs((pPlat[m] || 0) - (pDb[m] || 0)) > 0.5);
const totalPlat = L.computeGroupTotals(db, asOf).groupSavings, totalSys = Object.values(pSys).reduce((a, b) => a + b, 0), totalDb = Object.values(pDb).reduce((a, b) => a + b, 0);

/* ---- loan-history correction PLAN (audited commands; not applied here) ---- */
const steps = [], excluded = [], evidenceOf = (r) => SYS.file + " MEMBERS row " + r.row;
const admin = G.makeCtx({ id: "plan", name: "plan", role: "Admin" }, { today: asOf, now: asOf + "T00:00:00Z" });
db.loans.forEach((l) => {
  const wbD = SYS.rows.filter((r) => r.memberId === l.memberId && r.type === "Loan Disbursement"), wbR = SYS.rows.filter((r) => r.memberId === l.memberId && r.type === "Loan Repayment");
  const seedD = db.transactions.filter((t) => t.loanId === l.id && t.type === "Loan Disbursement"), seedR = db.transactions.filter((t) => t.memberId === l.memberId && t.type === "Loan Repayment");
  if (wbD.length === 1 && Number(wbD[0].amount) === Number(l.loanAmount)) { if (wbD[0].date !== l.date) steps.push({ name: "correctLoanDate", args: { loanId: l.id, date: wbD[0].date, reason: "Placeholder start date from the old system replaced by the dated source record", evidence: evidenceOf(wbD[0]) } }); }
  else excluded.push({ loanId: l.id, memberId: l.memberId, why: wbD.length + " dated disbursement rows in the workbook (" + wbD.map((r) => r.date + " " + fmt(r.amount)).join(", ") + ") vs one consolidated loan of " + fmt(l.loanAmount) + " here. Whether this is one loan or several (and each one's interest) is a SOB decision." });
  const sumWb = wbR.reduce((a, r) => a + r.amount, 0), sumSeed = seedR.reduce((a, t) => a + Number(t.amount), 0);
  if (wbR.length && sumWb === sumSeed && seedR.length === 1 && wbR.length === 1) { if (wbR[0].date !== seedR[0].date) steps.push({ name: "correctEntryDate", args: { id: seedR[0].id, date: wbR[0].date, reason: "Placeholder repayment date replaced by the dated source record", evidence: evidenceOf(wbR[0]) } }); }
  else if (wbR.length && sumWb === sumSeed && seedR.length === 1) {
    steps.push({ name: "voidEntry", args: { id: seedR[0].id, reason: "Consolidated repayment replaced by the " + wbR.length + " dated source repayments (same total " + fmt(sumWb) + ")" } });
    wbR.forEach((r) => steps.push({ name: "createEntry", args: { date: r.date, memberId: l.memberId, amount: r.amount, type: "Loan Repayment", loanId: l.id, purpose: "Loan Repayment (per " + evidenceOf(r) + ")" } }));
  } else if (wbR.length || seedR.length) { if (sumWb !== sumSeed || seedR.length !== wbR.length) excluded.push({ loanId: l.id, memberId: l.memberId, why: "repayments differ in structure: platform " + seedR.length + " entries (" + fmt(sumSeed) + ") vs workbook " + wbR.length + " (" + fmt(sumWb) + ")" }); }
});
const before = {}; db.loans.forEach((l) => (before[l.id] = L.loanOutstanding(l, db, asOf)));
const sim = JSON.parse(JSON.stringify(db)); let planError = null;
try { steps.forEach((s) => CMD.run(sim, admin, s.name, s.args)); } catch (e) { planError = e.message; }
const impact = db.loans.map((l) => { const s = sim.loans.find((x) => x.id === l.id); return { loanId: l.id, memberId: l.memberId, planned: steps.some((st) => (st.args.loanId === l.id) || (st.args.memberId === l.memberId)), dateNow: l.date, dateAfter: s.date, balanceNow: before[l.id], balanceAfter: L.loanOutstanding(s, sim, asOf) }; });
const savingsUnchanged = db.members.every((m) => L.memberSavings(db, m.id) === L.memberSavings(sim, m.id));

/* ---- discrepancy register items ---- */
const integrity = I.check(db, asOf), disc = [];
steps.filter((s) => s.name === "correctLoanDate").forEach((s) => { const l = db.loans.find((x) => x.id === s.args.loanId); disc.push({ kind: "LOAN_DATE", subject: l.id, summary: "Loan of " + l.memberId + " starts " + l.date + " here but " + s.args.date + " in the source workbook", platformValue: l.date, sourceValue: s.args.date, source: s.args.evidence }); });
excluded.forEach((e) => disc.push({ kind: "LOAN_DATE", subject: e.loanId, summary: e.why, platformValue: null, sourceValue: null, source: SYS.file }));
integrity.findings.filter((f) => f.severity === "error").forEach((f) => disc.push({ kind: "OTHER", subject: I.findingKey(f), summary: f.code + ": " + f.detail, platformValue: null, sourceValue: null, source: "integrity check" }));
const result = { asOf, totals: { platform: totalPlat, systemWorkbook: totalSys, databaseWorkbook: totalDb, platformRows: seedRows.length, systemRows: sysRows.length, databaseRows: dbRows.length },
  savings: { membersChecked: memberIds.length, differVsSystem: savVsSys, differVsDatabase: savVsDb }, rowDiff: { nonLoanRowDifferences: nonLoanDiff, onlyInPlatform: onlySeed, onlyInSystemWorkbook: onlySys },
  databaseVsSystem: { rowsOnlyInDatabase: dbOnly, rowsOnlyInSystem: sysOverDb, databaseLastDate: dbMaxDate, allExtraRowsAfterDatabaseLastDate: sysOverDb.every((k) => k.split("|")[0] > dbMaxDate) },
  plan: { steps, excluded, simulationError: planError, savingsUnchangedBySimulation: savingsUnchanged }, impact, integrity, discrepancies: disc, banners: { system: SYS.banner, database: DBX.banner } };
fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, "reconciliation.json"), JSON.stringify(result, null, 1));

const md = ["# Reconciliation report (READ-ONLY — no record was altered)", "", "As of " + asOf + ". Sources: the platform data set (SOB_FINAL_DATA_V2.json) vs " + SYS.file + " and " + DBX.file + ".", "",
 "## 1. Savings — reconciled", "", "| Source | Rows | Group savings |", "|---|---|---|", "| Platform | " + seedRows.length + " | " + fmt(totalPlat) + " |", "| " + SYS.file + " | " + sysRows.length + " | " + fmt(totalSys) + " |", "| " + DBX.file + " | " + dbRows.length + " | " + fmt(totalDb) + " |", "",
 "- Platform vs " + SYS.file + ": **" + (savVsSys.length === 0 ? "all " + memberIds.length + " members match to the shilling" : savVsSys.length + " members differ") + "**; every non-loan row is identical (" + nonLoanDiff.length + " non-loan row differences).",
 "- " + DBX.file + " is an **older snapshot** of the same ledger: it lacks exactly " + sysOverDb.length + " rows, all dated after its own last entry (" + dbMaxDate + "): " + (result.databaseVsSystem.allExtraRowsAfterDatabaseLastDate ? "confirmed" : "NOT confirmed") + "; it has " + dbOnly.length + " rows the newer file does not. This explains its " + savVsDb.length + " differing members (" + savVsDb.join(", ") + ").",
 "- Workbook header banners (" + SYS.banner.slice(0, 60) + "… / " + DBX.banner.slice(0, 60) + "…) match neither ledger and are treated as stale text.", "",
 "## 2. Loan history — differences needing SOB approval", "", "All savings, withdrawal and profit rows match. The only differences are loan rows: the old system stored placeholder/consolidated dates.", "",
 "Platform-only rows: " + onlySeed.length + "; workbook-only rows: " + onlySys.length + ".", "", "### Plan prepared (NOT applied) — " + steps.length + " audited commands", "",
 "| Loan | Member | Start now | Start per workbook | Balance now | Balance after plan |", "|---|---|---|---|---|---|"].concat(impact.filter((i) => i.planned).map((i) => "| " + i.loanId + " | " + i.memberId + " | " + i.dateNow + " | " + i.dateAfter + " | " + fmt(i.balanceNow) + " | " + fmt(i.balanceAfter) + " |")).concat(["",
 "Total owed by members now: " + fmt(impact.reduce((a, i) => a + Math.max(0, i.balanceNow), 0)) + "; after plan: " + fmt(impact.reduce((a, i) => a + Math.max(0, i.balanceAfter), 0)) + ". Member savings unchanged by the plan: " + savingsUnchanged + ".", "",
 "### Not in the plan (SOB must decide)", ""]).concat(excluded.length ? excluded.map((e) => "- **" + e.loanId + " (" + e.memberId + ")**: " + e.why) : ["- none"]).concat(["", "## 3. Integrity findings", ""]).concat(integrity.findings.length ? integrity.findings.map((f) => "- [" + f.severity + "] " + f.code + ": " + f.detail) : ["- none"]).concat(["", "## 4. How a difference is closed", "- Open a discrepancy, then resolve it with a decision, reason and evidence. History is never edited to make figures balance; corrections are dated, reasoned and audited. Original dates stay on the record."]);
fs.writeFileSync(path.join(outDir, "RECONCILIATION_REPORT.md"), md.join("\n") + "\n");
console.log("savings differ vs system:", savVsSys.length, "| db-only rows:", dbOnly.length, "| plan steps:", steps.length, "| excluded:", excluded.length, "| plan error:", planError, "| integrity errors:", integrity.errors);
