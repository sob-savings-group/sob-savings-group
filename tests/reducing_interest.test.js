/* Reducing interest from financial year 2027: same % on the principal still owed at the start of each month; earlier months unchanged. */
const assert = require("assert"), L = require("../src/core/ledger.js");
const mk = (yearOpened, reps) => ({ transactions: (reps || []).map((r, i) => ({ id: "R" + i, date: r[0], memberId: "M", amount: r[1], type: "Loan Repayment", loanId: "L1", approvalStatus: "Approved" })),
  loans: [{ id: "L1", date: "2026-10-01", memberId: "M", loanAmount: 100000, assignedMonthlyInterest: 10000, status: "Active" }], yearCycles: yearOpened ? [{ year: 2027, status: "Open", openedDate: yearOpened }] : [] });
const loan = (db) => db.loans[0]; let ok = 0; const t = (n, f) => { f(); ok++; console.log("  ok " + n); };
t("before the new year opens nothing changes (fixed 10,000 a month)", () => { const db = mk(null); assert.strictEqual(L.loanAccumulatedInterest(loan(db), "2027-03-01", db), 50000); });
t("months before the new year stay fixed, months after use principal owed", () => { const db = mk("2027-01-01"); /* Oct,Nov,Dec fixed = 30,000; Jan..Mar on 100,000 = 10,000 each */ assert.strictEqual(L.loanAccumulatedInterest(loan(db), "2027-04-01", db), 60000); });
t("principal repaid after the new year lowers later months only", () => {
  const db = mk("2027-01-01", [["2027-02-01", 70000]]); /* by 2027-02-01: interest owed 40,000 (30,000 fixed + Jan 10,000); 70,000 -> 40,000 interest + 30,000 principal; principal left 70,000 */
  const p = L.loanInterestPosition(loan(db), db, "2027-04-01");
  assert.strictEqual(p.principalOutstanding, 70000);
  assert.strictEqual(p.accruedInterest, 40000 + 7000 + 7000);          // Feb, Mar charged on 70,000 at 10%
  assert.strictEqual(p.unpaidInterest, 14000);
  assert.strictEqual(L.loanOutstanding(loan(db), db, "2027-04-01"), 70000 + 14000);
});
t("a payment made on the day a month starts lowers that month", () => { const db = mk("2027-01-01", [["2027-02-01", 40000]]); const p = L.loanInterestPosition(loan(db), db, "2027-03-01"); assert.strictEqual(p.accruedInterest, 40000 + 10000); /* nothing of it was principal */ });
console.log(ok + " reducing interest tests passed");
