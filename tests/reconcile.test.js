const assert = require("assert"), fs = require("fs");
const G = require("../src/core/governance.js"), L = require("../src/core/ledger.js"), RC = require("../src/core/reconcile.js"), CMD = require("../src/core/commands.js"), M = require("../src/core/migrate.js");
const raw = require("./helpers/synth.js").legacyRaw();
const admin = (d) => G.makeCtx({ id: "A", name: "Admin", role: "Admin" }, { today: d || "2026-04-01", now: (d || "2026-04-01") + "T09:00:00Z" });
const committee = G.makeCtx({ id: "C", name: "C", role: "Committee" });
let f = 0; const t = (n, fn) => { try { fn(); console.log("  ok  " + n); } catch (e) { f++; process.exitCode = 1; console.log("FAIL  " + n + "\n      " + e.message); } };
const mk = () => M.migrateLegacy(raw, "2026-10-07");
t("opening a discrepancy changes NO figure and is audited; duplicates and non-admins refused", () => {
  const db = mk(), before = L.computeGroupTotals(db, "2026-10-07"), n = db.transactions.length;
  const d = RC.openDiscrepancy(db, admin(), { kind: "SAVINGS_BALANCE", subject: "SOB-002", summary: "workbook shows 100,000 less", platformValue: 1201680, sourceValue: 1101680, source: "SOB_DATABASE_.xlsx" });
  assert.deepEqual(L.computeGroupTotals(db, "2026-10-07"), before); assert.equal(db.transactions.length, n);
  assert.ok(db.auditLog.some((a) => a.entityId === d.id && a.action === "Opened"));
  assert.throws(() => RC.openDiscrepancy(db, admin(), { kind: "SAVINGS_BALANCE", subject: "SOB-002", summary: "x" }), /ALREADY_OPEN/);
  assert.throws(() => RC.openDiscrepancy(db, committee, { kind: "OTHER", subject: "s", summary: "x" }), /FORBIDDEN/);
  assert.throws(() => RC.openDiscrepancy(db, admin(), { kind: "BOGUS", subject: "s", summary: "x" }), /INVALID/);
});
t("resolving needs a decision, reason and evidence; ACCEPT_PLATFORM leaves the ledger untouched", () => {
  const db = mk(); const d = RC.openDiscrepancy(db, admin(), { kind: "SAVINGS_BALANCE", subject: "SOB-003", summary: "x" }); const n = db.transactions.length;
  assert.throws(() => RC.resolveDiscrepancy(db, admin(), d.id, { decision: "ACCEPT_PLATFORM", reason: "r" }), /REQUIRED: evidence/);
  assert.throws(() => RC.resolveDiscrepancy(db, admin(), d.id, { decision: "MAGIC", reason: "r", evidence: "e" }), /INVALID/);
  RC.resolveDiscrepancy(db, admin(), d.id, { decision: "ACCEPT_PLATFORM", reason: "workbook was an older snapshot", evidence: "row diff 15-26 Jul 2026" });
  assert.equal(db.transactions.length, n); assert.equal(RC.summary(db).open, 0);
  assert.throws(() => RC.resolveDiscrepancy(db, admin(), d.id, { decision: "ACCEPT_PLATFORM", reason: "r", evidence: "e" }), /BAD_STATE/);
});
t("ACCEPT_SOURCE_WITH_ENTRY posts a normal dated entry linked to the discrepancy; history is never edited", () => {
  const db = mk(), m = "SOB-002", before = L.memberSavings(db, m), orig = JSON.stringify(db.transactions);
  const d = RC.openDiscrepancy(db, admin(), { kind: "SAVINGS_BALANCE", subject: m, summary: "x" });
  assert.throws(() => RC.resolveDiscrepancy(db, admin(), d.id, { decision: "ACCEPT_SOURCE_WITH_ENTRY", reason: "r", evidence: "e" }), /REQUIRED: entry/);
  RC.resolveDiscrepancy(db, admin("2026-04-02"), d.id, { decision: "ACCEPT_SOURCE_WITH_ENTRY", reason: "receipt 123 shows a withdrawal", evidence: "receipt 123", entry: { date: "2026-04-02", memberId: m, amount: 100000, type: "Withdraw" } });
  assert.equal(L.memberSavings(db, m), before - 100000);
  assert.equal(JSON.stringify(db.transactions.slice(0, JSON.parse(orig).length)), orig, "original rows byte-identical");
  const e = db.transactions[db.transactions.length - 1]; assert.equal(e.reconciliationId, d.id); assert.match(e.purpose, /Reconciliation correction/);
});
t("correctLoanDate is audited, keeps the old date, needs reason+evidence, and recalculates interest from the new date", () => {
  const db = mk(), loan = db.loans.find((l) => l.memberId === "SOB-002"), asOf = "2026-10-07", before = L.loanOutstanding(loan, db, asOf);
  assert.throws(() => RC.correctLoanDate(db, admin(), loan.id, "2026-01-01", "r", ""), /REQUIRED: evidence/);
  assert.throws(() => RC.correctLoanDate(db, admin(), loan.id, "01/01/2026", "r", "e"), /INVALID/);
  RC.correctLoanDate(db, admin(), loan.id, "2026-01-01", "workbook disbursement row", "SOB_SYSTEM_ MEMBERS 2026-01-01");
  assert.equal(loan.dateHistory[0].previousDate, "2025-12-21"); assert.equal(L.loanOutstanding(loan, db, asOf), before - loan.assignedMonthlyInterest);
  const tx = db.transactions.find((x) => x.loanId === loan.id && x.type === "Loan Disbursement"); assert.equal(tx.originalDate, "2025-12-21");
  assert.ok(db.auditLog.some((a) => a.entityId === loan.id && a.action === "Start date corrected" && a.previousValue.date === "2025-12-21"));
});
t("loanDateImpact is a pure what-if (changes nothing)", () => {
  const db = mk(), snap = JSON.stringify(db), loan = db.loans.find((l) => l.memberId === "SOB-002");
  const r = RC.loanDateImpact(db, { [loan.id]: "2026-01-01" }, "2026-10-07"); assert.equal(r.length, 1); assert.equal(r[0].difference, -loan.assignedMonthlyInterest); assert.equal(JSON.stringify(db), snap);
});
t("commands whitelist exposes the reconcile commands; Member/Committee cannot use them", () => {
  const db = mk(); assert.ok(CMD.names.includes("openDiscrepancy") && CMD.names.includes("correctLoanDate"));
  const m = G.makeCtx({ id: "SOB-002", name: "m", role: "Member", memberId: "SOB-002" });
  assert.throws(() => CMD.run(db, m, "correctLoanDate", { loanId: db.loans[0].id, date: "2026-01-01", reason: "r", evidence: "e" }), /FORBIDDEN/);
  assert.throws(() => CMD.run(db, committee, "openDiscrepancy", { kind: "OTHER", subject: "s", summary: "x" }), /FORBIDDEN/);
});
console.log(f ? f + " FAILED" : "6 passed");
