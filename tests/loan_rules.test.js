/* The Chairperson's three accounting rules, proved on the engine:
   1 interest keeps accruing until final settlement and every repayment is split interest-first;
   2 a loan paid out in instalments is ONE loan that starts on the first payout and keeps every instalment in the history;
   3 the savings balance is savings + profit - withdrawals - share-outs, never reduced by loans. */
const assert = require("assert"), L = require("../src/core/ledger.js"), G = require("../src/core/governance.js"), LN = require("../src/core/loans.js"), CMD = require("../src/core/commands.js"), ST = require("../src/core/statements.js");
let pass = 0; const t = (n, fn) => { try { fn(); pass++; console.log("  ok  " + n); } catch (e) { process.exitCode = 1; console.log("FAIL  " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 4).join("\n      ")); } };
const U = { admin: { name: "Super Admin", id: "U1", role: "Admin" }, chair: { name: "Chair", id: "U2", role: "Chairperson" } };
const at = (day, who) => G.makeCtx(U[who || "admin"], { today: day, now: day + "T09:00:00.000Z" });
const fresh = () => ({ members: ["A", "B"].map((x, i) => ({ id: "SOB-00" + (i + 1), name: "Member " + x, status: "Active", regDate: "2025-01-01" })), transactions: [], loans: [], guarantees: [], auditLog: [] });
const dep = (db, m, d, a, ty) => G.createEntry(db, at(d), { date: d, memberId: m, amount: a, type: ty || "Savings" });
function withLoan() {
  const db = fresh(); dep(db, "SOB-001", "2026-01-05", 1000000);
  const l = LN.recordExistingLoan(db, at("2026-02-02"), { memberId: "SOB-001", amount: 500000, date: "2026-02-02", assignedMonthlyInterest: 30000, graceMonths: 3 }); return { db, id: l.id };
}
t("1. interest accrues month by month after the grace period and keeps running until the loan is settled", () => {
  const { db, id } = withLoan(), loan = db.loans[0];
  assert.equal(L.loanInterestPosition(loan, db, "2026-05-02").accruedInterest, 0, "grace months are interest-free");
  assert.equal(L.loanInterestPosition(loan, db, "2026-08-10").accruedInterest, 90000, "Feb->Aug = 6 months, less 3 grace = 3 x 30,000");
  assert.equal(L.loanInterestPosition(loan, db, "2026-10-10").accruedInterest, 150000, "and it keeps growing");
});
t("1. a repayment clears interest first, then the loan; the split is recorded per repayment", () => {
  const { db, id } = withLoan(); LN.repayLoan(db, at("2026-08-10"), id, 100000, "2026-08-10");
  const w = L.loanInterestPosition(db.loans[0], db, "2026-08-10"); assert.equal(w.steps[0].interest, 90000); assert.equal(w.steps[0].principal, 10000);
  assert.equal(w.principalOutstanding, 490000); assert.equal(w.unpaidInterest, 0);
  assert.equal(L.loanInterestPosition(db.loans[0], db, "2026-10-10").unpaidInterest, 60000, "interest continues on the remaining loan");
});
t("1. interest stops only when the loan is fully settled", () => {
  const { db, id } = withLoan(); const owed = L.loanOutstanding(db.loans[0], db, "2026-08-10"); LN.repayLoan(db, at("2026-08-10"), id, owed, "2026-08-10");
  assert.equal(db.loans[0].status, "Cleared"); assert.equal(L.loanOutstanding(db.loans[0], db, "2026-12-31"), 0);
});
t("2. a further payout keeps ONE loan, the first payout date, and every instalment as its own dated entry", () => {
  const { db, id } = withLoan(); const r = CMD.run(db, at("2026-03-10"), "addDisbursement", { loanId: id, amount: 50000, date: "2026-03-10", reason: "second instalment" }); assert.equal(r.pendingApproval, true);
  assert.equal(db.loans[0].loanAmount, 500000, "nothing changes before the Chairperson approves");
  CMD.run(db, at("2026-03-10", "chair"), "approveRequest", { id: r.requestId });
  assert.equal(db.loans.length, 1); assert.equal(db.loans[0].loanAmount, 550000); assert.equal(db.loans[0].date, "2026-02-02", "commencement stays the first payout");
  const ds = db.transactions.filter((x) => x.type === "Loan Disbursement"); assert.deepEqual(ds.map((x) => x.amount), [500000, 50000]); assert.deepEqual(ds.map((x) => x.date), ["2026-02-02", "2026-03-10"]);
  assert.deepEqual(db.loans[0].components.map((c) => c.amount), [500000, 50000]);
  assert.equal(L.loanInterestPosition(db.loans[0], db, "2026-10-10").accruedInterest, 150000, "interest still counts from the FIRST payout");
  const a = ST.memberAccount(db, "SOB-001", {}, { today: "2026-10-10" }); assert.equal(a.loans.length, 1); assert.equal(a.loans[0].payouts.length, 2);
  assert.ok(a.checks.all, "statement still ties out");
});
t("2. correcting the loan's start date moves the first payout only, never the later instalments", () => {
  const { db, id } = withLoan(); const r = CMD.run(db, at("2026-03-10"), "addDisbursement", { loanId: id, amount: 50000, date: "2026-03-10", reason: "x" }); CMD.run(db, at("2026-03-10", "chair"), "approveRequest", { id: r.requestId });
  const c = CMD.run(db, at("2026-04-01"), "correctLoanDate", { loanId: id, date: "2026-02-01", reason: "r", evidence: "e" }); CMD.run(db, at("2026-04-01", "chair"), "approveRequest", { id: c.requestId });
  const ds = db.transactions.filter((x) => x.type === "Loan Disbursement"); assert.deepEqual(ds.map((x) => x.date), ["2026-02-01", "2026-03-10"]);
});
t("2. a further payout cannot be dated before the first payout, and needs a running loan", () => {
  const { db, id } = withLoan(); assert.throws(() => LN.addDisbursement(db, at("2026-03-10"), id, { amount: 1000, date: "2026-01-01" }), /before the first payout/);
  assert.throws(() => LN.addDisbursement(db, at("2026-03-10"), "LOAN-NOPE", { amount: 1000, date: "2026-03-10" }), /NOT_FOUND|BAD_STATE/);
});
t("3. savings = deposits + profit - withdrawals - share-outs; loans never reduce it", () => {
  const { db } = withLoan(); dep(db, "SOB-001", "2026-02-18", 2000, "Profit"); dep(db, "SOB-001", "2026-03-01", 100000, "Withdraw");
  assert.equal(L.memberSavings(db, "SOB-001"), 1000000 + 2000 - 100000, "the 500,000 loan is not subtracted");
  const pos = L.memberPosition(db, "SOB-001"); assert.equal(pos.savings, 902000);
  const h = L.memberLifetimeHistory(db, "SOB-001", null); assert.equal(h[h.length - 1].runningSavings, 902000, "the running balance on the last line is the savings balance");
  assert.equal(h.find((x) => x.type === "Loan Disbursement").runningSavings, 1000000, "a loan payout line leaves the savings balance unchanged");
});
t("3. a member without a loan: the savings balance stands alone, and a member with a loan shows the debt separately", () => {
  const { db } = withLoan(); dep(db, "SOB-002", "2026-01-05", 50000);
  assert.equal(L.memberSavings(db, "SOB-002"), 50000);
  const a = ST.memberAccount(db, "SOB-001", {}, { today: "2026-10-10" }); assert.equal(a.savings.closing, 1000000); assert.equal(a.loanTotals.owed, 500000 + 150000);
});
t("a consolidated repayment is replaced by its dated parts in ONE approved step: same total, original voided, nothing double counted, interest-first by the real dates", () => {
  const { db, id } = withLoan(); LN.repayLoan(db, at("2026-06-01"), id, 300000, "2026-06-01"); const orig = db.transactions.find((x) => x.type === "Loan Repayment");
  const parts = [{ date: "2026-05-01", amount: 100000, ref: "r1" }, { date: "2026-06-01", amount: 200000, ref: "r2" }];
  assert.throws(() => CMD.run(db, at("2026-10-01"), "splitRepayment", { id: orig.id, parts: [{ date: "2026-05-01", amount: 100000 }, { date: "2026-06-01", amount: 100000 }], reason: "r", evidence: "e" }), /add up/);
  const r = CMD.run(db, at("2026-10-01"), "splitRepayment", { id: orig.id, parts, reason: "dated in the register", evidence: "rows 1, 2" }); assert.equal(r.pendingApproval, true); assert.equal(orig.voided, undefined, "nothing changes before approval");
  CMD.run(db, at("2026-10-01", "chair"), "approveRequest", { id: r.requestId });
  const reps = db.transactions.filter((x) => x.type === "Loan Repayment" && !x.voided); assert.deepEqual(reps.map((x) => x.amount).sort(), [100000, 200000]); assert.equal(db.transactions.find((x) => x.id === orig.id).voided, true);
  assert.equal(L.loanInterestPosition(db.loans[0], db, "2026-10-10").totalRepaid, 300000, "same total as before");
  assert.throws(() => CMD.run(db, at("2026-10-02"), "splitRepayment", { id: orig.id, parts, reason: "again", evidence: "e" }), /voided/, "cannot be split twice");
});
console.log(pass + " passed");
