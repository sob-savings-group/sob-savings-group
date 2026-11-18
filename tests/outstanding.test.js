/* Outstanding entries: original dates, existing validations, withdrawals via the Chairperson, no duplicates, all-or-nothing, audited. Synthetic data only. Run: node tests/outstanding.test.js */
const assert = require("assert"), G = require("../src/core/governance.js"), CMD = require("../src/core/commands.js"), LN = require("../src/core/loans.js");
let n = 0; const t = (name, fn) => { fn(); n++; };
const admin = G.makeCtx({ id: "ADMIN", name: "Admin", role: "Admin" }, { today: "2026-11-18", now: "2026-11-18T08:00:00Z" }), chair = G.makeCtx({ id: "CHAIR", name: "Chair", role: "Chairperson" }, { today: "2026-11-18", now: "2026-11-18T09:00:00Z" });
const fresh = () => {
  const db = { members: ["A", "B", "C"].map((x) => ({ id: "M-" + x, name: "Member " + x, status: "Active" })), transactions: [], loans: [], guarantees: [], auditLog: [], approvalRequests: [], users: [] };
  [["M-A", 500000], ["M-B", 300000], ["M-C", 400000]].forEach(([m, a]) => G.createEntry(db, admin, { date: "2026-01-05", memberId: m, amount: a, type: "Savings" }));
  CMD.run(db, admin, "recordExistingLoan", { memberId: "M-A", amount: 100000, date: "2026-02-02", assignedMonthlyInterest: 0, remarks: "test" });
  return db;
};
const batch = (db) => ({ batchId: "OUT-TEST", approvedBy: "Chairperson, 18 Nov 2026", entries: [
  { date: "2026-03-23", memberId: "M-B", type: "Savings", amount: 2000 },
  { date: "2026-05-03", memberId: "M-A", type: "Loan Repayment", amount: 7000, loanId: db.loans[0].id },
  { date: "2026-10-20", memberId: "M-C", type: "Withdraw", amount: 50000 },
  { date: "2026-11-08", memberId: "M-A", type: "Loan Repayment", amount: 10000, loanId: db.loans[0].id } ] });
t("dry run shows the plan and changes nothing", () => { const db = fresh(), before = JSON.stringify(db); const r = CMD.run(db, admin, "processOutstandingEntries", Object.assign(batch(db), { dryRun: true })); assert.strictEqual(r.posted, 3); assert.strictEqual(r.awaitingApproval, 1); assert.strictEqual(JSON.stringify(db), before); });
t("posts with original dates; the withdrawal waits for the Chairperson; audited", () => {
  const db = fresh(), r = CMD.run(db, admin, "processOutstandingEntries", batch(db));
  assert.strictEqual(r.posted, 3); assert.strictEqual(r.awaitingApproval, 1);
  const tx = (d, ty) => db.transactions.find((x) => x.date === d && x.type === ty);
  assert.ok(tx("2026-03-23", "Savings") && tx("2026-05-03", "Loan Repayment") && tx("2026-11-08", "Loan Repayment"));
  assert.ok(!db.transactions.some((x) => x.type === "Withdraw"), "withdrawal must not post before approval");
  const req = db.approvalRequests.find((x) => x.command === "postOutstandingWithdrawal"); assert.strictEqual(req.status, "Pending");
  assert.ok(db.auditLog.some((a) => a.entityType === "OutstandingBatch" && a.entityId === "OUT-TEST"));
  assert.ok(db.transactions.filter((x) => x.importBatch === "OUT-TEST").every((x) => /^OUTSTANDING\|OUT-TEST\|/.test(x.sourceRef)));
  assert.throws(() => CMD.run(db, admin, "approveRequest", { id: req.id }), /SEPARATION|FORBIDDEN|permission/i);
  CMD.run(db, chair, "approveRequest", { id: req.id });
  const w = db.transactions.find((x) => x.type === "Withdraw"); assert.strictEqual(w.date, "2026-10-20"); assert.strictEqual(w.amount, 50000);
});
t("running it twice adds nothing", () => { const db = fresh(); CMD.run(db, admin, "processOutstandingEntries", batch(db)); const tx = db.transactions.length, rq = db.approvalRequests.length, r = CMD.run(db, admin, "processOutstandingEntries", batch(db)); assert.strictEqual(r.alreadyProcessed, 4); assert.strictEqual(db.transactions.length, tx); assert.strictEqual(db.approvalRequests.length, rq); });
t("a loan that belongs to another member stops everything (nothing posted)", () => { const db = fresh(), b = batch(db); b.entries[1].memberId = "M-B"; const before = JSON.stringify(db); assert.throws(() => CMD.run(db, admin, "processOutstandingEntries", b), /LOAN_MISMATCH/); assert.strictEqual(JSON.stringify(db), before); });
t("a repayment larger than what is owed is refused and nothing is posted", () => { const db = fresh(), b = batch(db); b.entries[3].amount = 5000000; const before = JSON.stringify(db); assert.throws(() => CMD.run(db, admin, "processOutstandingEntries", b), /OVERPAYMENT/); assert.strictEqual(JSON.stringify(db), before); });
t("a repayment dated before the loan began is refused", () => { const db = fresh(), b = batch(db); b.entries[1].date = "2026-01-10"; assert.throws(() => CMD.run(db, admin, "processOutstandingEntries", b), /before the loan/); });
t("a future date, unknown member or unknown loan is refused", () => { const db = fresh(); let b = batch(db); b.entries[0].date = "2026-12-01"; assert.throws(() => CMD.run(db, admin, "processOutstandingEntries", b), /future/); b = batch(db); b.entries[0].memberId = "NOPE"; assert.throws(() => CMD.run(db, admin, "processOutstandingEntries", b), /UNKNOWN_MEMBER/); b = batch(db); b.entries[1].loanId = "LOAN-NOPE"; assert.throws(() => CMD.run(db, admin, "processOutstandingEntries", b), /LOAN_NOT_FOUND/); });
t("a withdrawal larger than the available savings is refused before anything posts", () => { const db = fresh(), b = batch(db); b.entries[2].amount = 900000; assert.throws(() => CMD.run(db, admin, "processOutstandingEntries", b), /COMMITTED_GUARANTEE|available/); assert.strictEqual(db.transactions.filter((x) => x.importBatch).length, 0); });
t("people without the entry permission cannot run it; existing records are untouched", () => { const db = fresh(), mem = G.makeCtx({ id: "M-A", name: "A", role: "Member", memberId: "M-A" }), before = JSON.stringify(db.transactions); assert.throws(() => CMD.run(db, mem, "processOutstandingEntries", batch(db)), /FORBIDDEN|permission/i); CMD.run(db, admin, "processOutstandingEntries", batch(db)); assert.strictEqual(JSON.stringify(db.transactions.slice(0, JSON.parse(before).length)), before); });
console.log(n + " outstanding-entry tests passed");
