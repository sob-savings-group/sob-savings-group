const assert = require("assert");
const fs = require("fs");
const path = require("path");
const dates = require("../src/core/dates.js");
const L = require("../src/core/ledger.js");

const raw = require("./helpers/synth.js").legacyRaw();
// Migration step: rename monthlyStandardInterest -> assignedMonthlyInterest
const db = JSON.parse(JSON.stringify(raw));
db.loans.forEach((l) => { l.assignedMonthlyInterest = l.monthlyStandardInterest; delete l.monthlyStandardInterest; });

const ASOF = "2026-10-06";
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ok  " + name); };

// Independent reference implementation of the OLD (golden) logic, old field name, no shared code.
function oldOutstanding(loan) {
  const months = Math.max(0, dates.monthsBetween(loan.date, ASOF) - (loan.graceMonths || 0));
  const interest = months * loan.monthlyStandardInterest;
  const pen = raw.transactions.filter((x) => !x.voided && x.loanId === loan.id && x.type === "Penalty").reduce((a, x) => a + x.amount, 0);
  const paid = raw.transactions.filter((x) => !x.voided && x.loanId === loan.id && x.type === "Loan Repayment").reduce((a, x) => a + x.amount, 0);
  return loan.loanAmount + interest + pen - paid;
}

console.log("core engine");
t("10 loans, 55 members loaded", () => { assert.equal(db.loans.length, 10); assert.equal(db.members.length, 55); });
t("golden: every loan balance equals the legacy engine", () => {
  raw.loans.forEach((old, i) => assert.equal(L.loanOutstanding(db.loans[i], db, ASOF), oldOutstanding(old), old.memberName));
});
t("golden: group totals match legacy", () => {
  let s = 0; raw.transactions.filter((x) => !x.voided).forEach((x) => (s += L.classifyTransaction(x).savings));
  assert.equal(L.computeGroupTotals(db, ASOF).groupSavings, s);
  assert.equal(L.computeGroupTotals(db, ASOF).loansOutstanding, raw.loans.reduce((a, l) => a + oldOutstanding(l), 0));
});
t("loan facts survive the field rename exactly (amount, rate, grace, date)", () => {
  raw.loans.forEach((o, i) => { const n = db.loans[i]; assert.equal(n.loanAmount, o.loanAmount); assert.equal(n.assignedMonthlyInterest, o.monthlyStandardInterest); assert.equal(n.graceMonths, o.graceMonths); assert.equal(n.date, o.date); });
});
t("no legacy field name survives", () => assert(db.loans.every((l) => l.monthlyStandardInterest === undefined)));
t("stateless: 50 evaluations create no transactions and never change the answer", () => {
  const before = db.transactions.length, first = L.loanOutstanding(db.loans[0], db, ASOF);
  for (let i = 0; i < 50; i++) assert.equal(L.loanOutstanding(db.loans[0], db, ASOF), first);
  assert.equal(db.transactions.length, before);
});
t("interest respects grace period and fixed monthly amount", () => {
  const loan = { id: "X", date: "2026-01-01", loanAmount: 100000, graceMonths: 3, assignedMonthlyInterest: 10000 };
  assert.equal(L.loanAccumulatedInterest(loan, "2026-03-31"), 0);
  assert.equal(L.loanAccumulatedInterest(loan, "2026-04-01"), 0);        // 3 calendar months elapsed - 3 grace
  assert.equal(L.loanAccumulatedInterest(loan, "2026-05-01"), 10000 * 1);
  assert.equal(L.loanAccumulatedInterest(loan, "2026-06-15"), 10000 * 2); // calendar-month boundaries, same as legacy
});
t("admin correction (60,000 -> 6,000) recalculates and leaves principal untouched", () => {
  const loan = { id: "Y", date: "2026-01-01", loanAmount: 200000, graceMonths: 0, assignedMonthlyInterest: 60000 };
  const a = L.loanPayable(loan, "2026-03-01"); loan.assignedMonthlyInterest = 6000;
  assert.equal(L.loanPayable(loan, "2026-03-01"), 200000 + 2 * 6000); assert(a > L.loanPayable(loan, "2026-03-01"));
});
t("voided transactions are excluded everywhere", () => {
  const d = { transactions: [{ id: "a", memberId: "M", type: "Savings", amount: 100, date: "2026-01-01" }, { id: "b", memberId: "M", type: "Savings", amount: 900, date: "2026-01-02", voided: true }], loans: [] };
  assert.equal(L.memberSavings(d, "M"), 100);
});
t("duplicate date/amount/type rows keep distinct running balances (matching-bug regression)", () => {
  const d = { transactions: [1, 2, 3].map((i) => ({ id: "t" + i, memberId: "M", type: "Savings", amount: 500, date: "2026-02-01" })), loans: [] };
  assert.deepEqual(L.memberLifetimeHistory(d, "M").map((x) => x.runningSavings), [500, 1000, 1500]);
});
t("lifetime history survives year filters (nothing is partitioned by year)", () => {
  const d = { transactions: [{ id: "1", memberId: "M", type: "Savings", amount: 10, date: "2025-12-21" }, { id: "2", memberId: "M", type: "Savings", amount: 20, date: "2026-03-02" }, { id: "3", memberId: "M", type: "Savings", amount: 30, date: "2027-01-05" }], loans: [] };
  assert.equal(L.memberLifetimeHistory(d, "M").length, 3);
  assert.equal(L.memberLifetimeHistory(d, "M", { year: 2026 }).length, 1);
  assert.equal(L.memberLifetimeHistory(d, "M", { year: 2026 })[0].runningSavings, 30); // running balance carries across years
  assert.equal(L.memberSavings(d, "M"), 60);
});
t("members with an outstanding loan are excluded from distribution (confirmed rule)", () => {
  assert.equal(L.eligibleForDistribution(db, "SOB-005", ASOF), false);
  assert.equal(L.eligibleForDistribution(db, "SOB-001", ASOF), true);
});
t("restore window is 48h", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  assert.equal(L.withinRestoreWindow({ voidTimestamp: "2026-10-04T13:00:00Z" }, now), true);
  assert.equal(L.withinRestoreWindow({ voidTimestamp: "2026-10-04T11:00:00Z" }, now), false);
});
t("invalid dates throw instead of silently becoming today", () => {
  assert.throws(() => dates.addMonths("garbage", 1), RangeError); assert.throws(() => dates.addDays(undefined, 1), RangeError);
});
t("dates: EAT and DD/MM/YYYY display", () => {
  dates.setClock(Date.parse("2026-10-06T22:30:00Z")); assert.equal(dates.todayISO(), "2026-10-07"); dates.setClock(null);
  assert.equal(dates.toDisplay("2026-07-29"), "29/07/2026");
});
t("the SOB rules are fixed (interest first); the 3x guideline is a guideline, not a rejection", () => {
  assert.equal(L.confirmedAllocation(db), "INTEREST_FIRST"); assert.equal(L.profitShare, undefined); assert.equal(L.allocateRepayment, undefined);
  const e = L.loanEligibility(db, "SOB-001"); assert.equal(e.maxLoan, 3 * L.memberSavings(db, "SOB-001"));
});
console.log("\n" + pass + " passed");
