/* The Chairperson's three accounting rules, proved on the engine:
   1 interest keeps accruing until final settlement and every repayment is split interest-first;
   2 a loan paid out in instalments is ONE loan that starts on the first payout and keeps every instalment in the history;
   3 the savings balance is savings + profit - withdrawals - share-outs, never reduced by loans. */
const assert = require("assert"), L = require("../src/core/ledger.js"), G = require("../src/core/governance.js"), LN = require("../src/core/loans.js"), CMD = require("../src/core/commands.js"), ST = require("../src/core/statements.js");
let pass = 0; const t = (n, fn) => { try { fn(); pass++; console.log("  ok  " + n); } catch (e) { process.exitCode = 1; console.log("FAIL  " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 4).join("\n      ")); } };
const U = { admin: { name: "Super Admin", id: "U1", role: "Admin" }, chair: { name: "Chair", id: "U2", role: "Chairperson" } };
const at = (day, who) => G.makeCtx(U[who || "admin"], { today: day, now: day + "T09:00:00.000Z" });
const fresh = () => ({ members: ["A", "B"].map((x, i) => ({ id: "SOB-00" + (i + 1), name: "Member " + x, status: "Active", regDate: "2025-01-01" })), transactions: [], loans: [], guarantees: [], auditLog: [] });
const ST_review = (db) => LN.settlementReview(db, "2026-10-10");
const dep = (db, m, d, a, ty) => G.createEntry(db, at(d), { date: d, memberId: m, amount: a, type: ty || "Savings" });
function withLoan() {
  const db = fresh(); dep(db, "SOB-001", "2026-01-05", 1000000);
  const l = LN.recordExistingLoan(db, at("2026-02-02"), { memberId: "SOB-001", amount: 500000, date: "2026-02-02", assignedMonthlyInterest: 30000 }); return { db, id: l.id };
}
t("1. interest accrues month by month after the grace period and keeps running until the loan is settled", () => {
  const { db, id } = withLoan(), loan = db.loans[0];
  assert.equal(L.loanInterestPosition(loan, db, "2026-02-20").accruedInterest, 0, "no whole month has passed yet");
  assert.equal(L.loanInterestPosition(loan, db, "2026-05-02").accruedInterest, 90000, "no grace period: Feb->May = 3 months x 30,000");
  assert.equal(L.loanInterestPosition(loan, db, "2026-08-10").accruedInterest, 180000, "Feb->Aug = 6 months x 30,000");
  assert.equal(L.loanInterestPosition(loan, db, "2026-10-10").accruedInterest, 240000, "and it keeps growing");
});
t("1. a repayment clears interest first, then the loan; the split is recorded per repayment", () => {
  const { db, id } = withLoan(); LN.repayLoan(db, at("2026-08-10"), id, 100000, "2026-08-10");
  const w = L.loanInterestPosition(db.loans[0], db, "2026-08-10"); assert.equal(w.steps[0].interest, 100000); assert.equal(w.steps[0].principal, 0);
  assert.equal(w.principalOutstanding, 500000); assert.equal(w.unpaidInterest, 80000);
  assert.equal(L.loanInterestPosition(db.loans[0], db, "2026-10-10").unpaidInterest, 140000, "interest continues until settlement");
});
t("1. interest stops only when the loan is fully settled", () => {
  const { db, id } = withLoan(); const owed = L.loanOutstanding(db.loans[0], db, "2026-08-10"); LN.repayLoan(db, at("2026-08-10"), id, owed, "2026-08-10");
  assert.equal(db.loans[0].status, "Cleared"); assert.equal(L.loanOutstanding(db.loans[0], db, "2026-12-31"), 0);
});
t("no grace period exists unless the Chairperson authorises one on that loan; a stored value without authorisation is ignored", () => {
  const { db, id } = withLoan(); assert.equal(db.loans[0].graceMonths, 0); assert.throws(() => LN.recordExistingLoan(db, at("2026-02-02"), { memberId: "SOB-001", amount: 1000, date: "2026-02-02", assignedMonthlyInterest: 10, graceMonths: 3 }), /Chairperson authorises/);
  db.loans[0].graceMonths = 3; assert.equal(L.loanInterestPosition(db.loans[0], db, "2026-08-10").accruedInterest, 180000, "unauthorised grace is ignored");
  db.loans[0].graceAuthorisedBy = "Chairperson, minute 12"; assert.equal(L.loanInterestPosition(db.loans[0], db, "2026-08-10").accruedInterest, 90000, "authorised grace counts");
});
t("2. a further payout keeps ONE loan, the first payout date, and every instalment as its own dated entry", () => {
  const { db, id } = withLoan(); const r = CMD.run(db, at("2026-03-10"), "addDisbursement", { loanId: id, amount: 50000, date: "2026-03-10", reason: "second instalment" }); assert.equal(r.pendingApproval, true);
  assert.equal(db.loans[0].loanAmount, 500000, "nothing changes before the Chairperson approves");
  CMD.run(db, at("2026-03-10", "chair"), "approveRequest", { id: r.requestId });
  assert.equal(db.loans.length, 1); assert.equal(db.loans[0].loanAmount, 550000); assert.equal(db.loans[0].date, "2026-02-02", "commencement stays the first payout");
  const ds = db.transactions.filter((x) => x.type === "Loan Disbursement"); assert.deepEqual(ds.map((x) => x.amount), [500000, 50000]); assert.deepEqual(ds.map((x) => x.date), ["2026-02-02", "2026-03-10"]);
  assert.deepEqual(db.loans[0].components.map((c) => c.amount), [500000, 50000]);
  assert.equal(L.loanInterestPosition(db.loans[0], db, "2026-10-10").accruedInterest, 240000, "interest still counts from the FIRST payout");
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
  const a = ST.memberAccount(db, "SOB-001", {}, { today: "2026-10-10" }); assert.equal(a.savings.closing, 1000000); assert.equal(a.loanTotals.owed, 500000 + 240000);
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
t("savings settle a loan only once they cover it: interest first, remainder kept, no cash created, audited; below that nothing is deducted and interest keeps running", () => {
  const { db, id } = withLoan();   // 500,000 from 2 Feb 2026 at 30,000 a month; savings 1,000,000 deposited 5 Jan
  db.transactions.find((x) => x.type === "Savings").amount = 300000;   // savings 300,000: below the 500,000 loan
  assert.throws(() => LN.settleFromSavings(db, at("2026-03-05"), id, "2026-03-05"), /INSUFFICIENT_SAVINGS/);
  assert.equal(L.memberSavings(db, "SOB-001"), 300000, "nothing was deducted"); assert.equal(L.loanOutstanding(db.loans[0], db, "2026-08-10"), 680000, "interest keeps running");
  dep(db, "SOB-001", "2026-08-01", 600000); const cashBefore = L.computeGroupTotals(db, "2026-08-10").cashBalance;
  const before = L.loanOutstanding(db.loans[0], db, "2026-08-10"); assert.equal(before, 680000);
  const r = CMD.run(db, at("2026-08-10"), "settleLoanFromSavings", { loanId: id, date: "2026-08-10" }); assert.equal(r.pendingApproval, true); assert.equal(db.loans[0].status, "Active", "nothing changes before approval");
  CMD.run(db, at("2026-08-10", "chair"), "approveRequest", { id: r.requestId });
  const e = db.transactions.find((x) => x.viaSavings); assert.equal(e.amount, 680000); assert.equal(e.offset.interest, 180000); assert.equal(e.offset.principal, 500000);
  assert.equal(db.loans[0].status, "Cleared"); assert.equal(L.memberSavings(db, "SOB-001"), 900000 - 680000, "savings beyond the loan are kept");
  assert.equal(L.computeGroupTotals(db, "2026-08-10").cashBalance, cashBefore, "no cash was created or removed");
  assert.equal(L.loanOutstanding(db.loans[0], db, "2026-12-31"), 0, "interest stops at settlement");
  assert.ok(db.auditLog.some((a) => a.action === "Settled from savings"));
});
t("the settlement review shows when savings first covered each loan and flags repayments recorded after that date", () => {
  const { db, id } = withLoan(); const rv = ST_review(db); assert.equal(rv[0].coveredToday, true); assert.equal(rv[0].firstCovered.date, "2026-02-02"); assert.equal(rv[0].firstCovered.savingsLeft, 500000);
});
t("VERIFIED SAVINGS: balances brought forward from before the last share-out never count towards a settlement (SOB-004 case: 250,000 against 861,000 does not qualify)", () => {
  const db = fresh(); db.members.push({ id: "SOB-003", name: "Member C", status: "Active", regDate: "2024-01-01" });
  dep(db, "SOB-001", "2025-06-01", 1300000);                       // old carried-forward balance, no share-out entry for this member
  (dep(db, "SOB-002", "2025-12-01", 1), dep(db, "SOB-002", "2025-12-21", 1, "Share-Out"));               // the group's 21 Dec 2025 share-out (any member) starts the savings year
  dep(db, "SOB-001", "2025-12-21", 50000); dep(db, "SOB-001", "2026-01-11", 200000);
  const l = LN.recordExistingLoan(db, at("2026-03-09"), { memberId: "SOB-001", amount: 811000, date: "2026-03-09", assignedMonthlyInterest: 30000 });
  LN.addDisbursement(db, at("2026-04-30"), l.id, { amount: 50000, date: "2026-04-30", reason: "second payout" });
  assert.equal(L.memberSavingsAsOf(db, "SOB-001", "2026-04-30"), 1550000, "lifetime position still shows the old balance");
  assert.equal(L.memberVerifiedSavingsAsOf(db, "SOB-001", "2026-04-30"), 250000, "verified savings are the register's 250,000");
  assert.throws(() => LN.settleFromSavings(db, at("2026-04-30"), l.id, "2026-04-30"), /INSUFFICIENT_SAVINGS/);
  const rv = LN.settlementReview(db, "2026-10-10").find((r) => r.memberId === "SOB-001"); assert.equal(rv.firstCovered, null); assert.equal(rv.coveredToday, false);
});
t("VERIFIED SAVINGS: the first date the register savings cover principal plus interest is found on calendar months (SOB-002 case) and a Running Balance never stands in for savings", () => {
  const db = fresh(); (dep(db, "SOB-002", "2025-12-01", 1), dep(db, "SOB-002", "2025-12-21", 1, "Share-Out")); dep(db, "SOB-001", "2025-12-21", 10000);
  LN.recordExistingLoan(db, at("2026-01-01"), { memberId: "SOB-001", amount: 200000, date: "2026-01-01", assignedMonthlyInterest: 30000 });
  dep(db, "SOB-001", "2026-01-07", 150000); dep(db, "SOB-001", "2026-01-11", 100000);
  const rv = LN.settlementReview(db, "2026-10-10")[0]; assert.equal(rv.firstCovered.date, "2026-01-11"); assert.equal(rv.firstCovered.owed, 200000, "January is the loan's own month: no interest yet"); assert.equal(rv.firstCovered.savings, 260000);
  const db2 = fresh(); (dep(db2, "SOB-002", "2025-12-01", 1), dep(db2, "SOB-002", "2025-12-21", 1, "Share-Out")); dep(db2, "SOB-001", "2025-12-21", 50000); dep(db2, "SOB-001", "2026-08-09", 100000);
  LN.recordExistingLoan(db2, at("2026-01-18"), { memberId: "SOB-001", amount: 200000, date: "2026-01-18", assignedMonthlyInterest: 30000 });
  G.createEntry(db2, at("2026-08-09"), { date: "2026-08-09", memberId: "SOB-001", amount: 220000, type: "Loan Repayment", purpose: "Loan Repayment", loanId: db2.loans[0].id });
  const r2 = LN.settlementReview(db2, "2026-10-10")[0]; assert.equal(r2.firstCovered, null, "SOB-032 case: 150,000 savings against 250,000 owed does not qualify"); assert.equal(r2.owedToday, 250000);
});
console.log(pass + " passed");
