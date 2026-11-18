/* One Loan Correction Request: restore + monthly interest + lock in a single approval. Synthetic data. Run: node tests/loan_correction.test.js */
const assert = require("assert"), G = require("../src/core/governance.js"), CMD = require("../src/core/commands.js"), L = require("../src/core/ledger.js");
let n = 0; const t = (name, fn) => { fn(); n++; };
const mk = (id, role, day, hour) => G.makeCtx({ id, name: id, role }, { today: day, now: day + "T" + (hour || "08") + ":00:00Z" });
const admin = (d, h) => mk("ADMIN", "Admin", d, h), chair = (d, h) => mk("CHAIR", "Chairperson", d, h), treas = (d) => mk("TREAS", "Treasurer", d);
const fresh = () => {
  const db = { members: ["A", "B"].map((x, i) => ({ id: "M-" + x, name: "Member " + x, status: "Active", phone: "0772000" + (100 + i) })), transactions: [], loans: [], guarantees: [], auditLog: [], approvalRequests: [] };
  ["M-A", "M-B"].forEach((m) => G.createEntry(db, admin("2026-11-01"), { date: "2026-01-05", memberId: m, amount: 900000, type: "Savings" }));
  CMD.run(db, admin("2026-11-01"), "recordExistingLoan", { memberId: "M-A", amount: 520000, date: "2026-06-10", assignedMonthlyInterest: 0, remarks: "test" });
  const loan = db.loans[0], v = CMD.run(db, admin("2026-11-14"), "voidLoan", { loanId: loan.id, reason: "interest not added" });
  CMD.run(db, chair("2026-11-14"), "approveRequest", { id: v.requestId }); return { db, id: loan.id };
};
const args = (id, o) => Object.assign({ loanId: id, restore: true, amount: 40000, lockFrom: "2026-07-10", reason: "Void was only because interest was missing" }, o || {});
t("one request holds all three parts and changes nothing until approved", () => {
  const { db, id } = fresh(), r = CMD.run(db, admin("2026-11-15"), "correctLoan", args(id));
  assert.ok(r.pendingApproval); assert.strictEqual(db.loans[0].voided, true); assert.strictEqual(db.loans[0].assignedMonthlyInterest, 0); assert.ok(!(db.loans[0].interestLocks || []).length);
  assert.strictEqual(db.approvalRequests.filter((x) => x.status === "Pending").length, 1); assert.ok(/restore the loan; then monthly interest 0 to 40000; then lock interest from 2026-07-10/.test(db.approvalRequests[db.approvalRequests.length - 1].summary));
});
t("one Chairperson approval restores, sets the interest and locks, in that order, with exactly one month charged", () => {
  const { db, id } = fresh(), r = CMD.run(db, admin("2026-11-15"), "correctLoan", args(id)); CMD.run(db, chair("2026-11-15", "09"), "approveRequest", { id: r.requestId });
  const l = db.loans[0]; assert.strictEqual(l.voided, false); assert.strictEqual(l.assignedMonthlyInterest, 40000); assert.strictEqual(L.loanInterestLocked(l), true);
  assert.strictEqual(L.loanAccumulatedInterest(l, "2026-11-20"), 40000);
  const acts = db.auditLog.filter((a) => a.entityId === id).map((a) => a.action), i = (x) => acts.lastIndexOf(x);
  assert.ok(i("Restored") < i("Assigned interest corrected") && i("Assigned interest corrected") < i("Interest locked") && i("Interest locked") < i("Loan correction completed"));
});
t("every executed step names who requested it, who approved it, the reason and the time", () => {
  const { db, id } = fresh(), r = CMD.run(db, admin("2026-11-15"), "correctLoan", args(id)); CMD.run(db, chair("2026-11-15", "09"), "approveRequest", { id: r.requestId });
  ["Restored", "Assigned interest corrected", "Interest locked", "Loan correction completed"].forEach((a) => { const row = db.auditLog.filter((x) => x.entityId === id && x.action === a).pop(); assert.ok(row, a);
    assert.strictEqual(row.by, "ADMIN"); assert.ok(/requested by ADMIN \(Admin\), approved by CHAIR/.test(row.reason), a + ": " + row.reason); assert.ok(row.reason.includes("interest was missing")); assert.ok(row.timestamp.startsWith("2026-11-15T09")); });
  const rq = db.approvalRequests.pop(); assert.strictEqual(rq.status, "Approved"); assert.strictEqual(rq.decidedBy, "CHAIR"); assert.strictEqual(rq.requestedBy, "ADMIN");
});
t("the requester cannot approve their own correction", () => { const { db, id } = fresh(), r = CMD.run(db, admin("2026-11-15"), "correctLoan", args(id)); assert.throws(() => CMD.run(db, admin("2026-11-15"), "approveRequest", { id: r.requestId })); assert.strictEqual(db.loans[0].voided, true); });
t("a Treasurer cannot submit it; the Chairperson cannot submit it either", () => { const { db, id } = fresh(); assert.throws(() => CMD.run(db, treas("2026-11-15"), "correctLoan", args(id))); assert.throws(() => CMD.run(db, chair("2026-11-15"), "correctLoan", args(id))); });
t("a bad part is caught when the request is made, so nothing half-done can reach the Chairperson", () => {
  const { db, id } = fresh(), k = db.approvalRequests.length;
  assert.throws(() => CMD.run(db, admin("2026-11-15"), "correctLoan", args(id, { lockFrom: "2026-05-01" })), /before the loan was paid out/);
  assert.throws(() => CMD.run(db, admin("2026-11-15"), "correctLoan", args(id, { reason: "" })));
  assert.throws(() => CMD.run(db, admin("2026-11-15"), "correctLoan", { loanId: id, reason: "x" }), /at least one/);
  assert.strictEqual(db.approvalRequests.length, k); assert.strictEqual(db.loans[0].voided, true);
});
t("the 48-hour restore window still applies: late restore is refused, and the correction without restore still works on a loan that is not voided", () => {
  const { db, id } = fresh(); assert.throws(() => CMD.run(db, admin("2026-11-20"), "correctLoan", args(id)), /RESTORE_WINDOW_CLOSED/);
  const r = CMD.run(db, admin("2026-11-15"), "correctLoan", args(id)); CMD.run(db, chair("2026-11-15", "09"), "approveRequest", { id: r.requestId });
  const r2 = CMD.run(db, admin("2026-11-16"), "correctLoan", { loanId: id, amount: 30000, reason: "agreed lower rate" }); CMD.run(db, chair("2026-11-16"), "approveRequest", { id: r2.requestId }); assert.strictEqual(db.loans[0].assignedMonthlyInterest, 30000);
});
t("approving after the restore window closes saves nothing and says why", () => {
  const { db, id } = fresh(), r = CMD.run(db, admin("2026-11-15"), "correctLoan", args(id)), snap = JSON.stringify(db.loans);
  const trial = JSON.parse(JSON.stringify(db)); assert.throws(() => CMD.run(trial, chair("2026-11-30"), "approveRequest", { id: r.requestId }), /RESTORE_WINDOW_CLOSED/); assert.strictEqual(JSON.stringify(db.loans), snap);
});
t("no money record is touched: ledger entries and the loan's amount, date and repayments are identical", () => {
  const { db, id } = fresh(), tx = JSON.stringify(db.transactions.filter((x) => !x.loanId)), r = CMD.run(db, admin("2026-11-15"), "correctLoan", args(id)); CMD.run(db, chair("2026-11-15"), "approveRequest", { id: r.requestId });
  assert.strictEqual(JSON.stringify(db.transactions.filter((x) => !x.loanId)), tx); assert.strictEqual(db.loans[0].loanAmount, 520000); assert.strictEqual(db.loans[0].date, "2026-06-10");
});
console.log(n + " loan correction tests passed");
