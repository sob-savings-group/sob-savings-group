const assert = require("assert"), G = require("../src/core/governance.js"), CMD = require("../src/core/commands.js"), LN = require("../src/core/loans.js");
let n = 0; const t = (name, f) => { f(); n++; console.log("  ok  " + name); };
const ctx = (day, role) => G.makeCtx({ name: role || "Admin", id: "U", role: role || "Admin" }, { today: day, now: day + "T09:00:00.000Z" });
const fresh = () => ({ members: [{ id: "SOB-001", name: "A", status: "Active" }, { id: "SOB-002", name: "B", status: "Active" }], transactions: [], loans: [], guarantees: [], auditLog: [] });
const T = "2026-10-07";
t("a blank date defaults to today for savings, withdrawals, subscriptions and other entries", () => {
  const db = fresh();
  CMD.run(db, ctx(T), "createEntry", { memberId: "SOB-001", type: "Savings", amount: 50000 });
  CMD.run(db, ctx(T), "createEntry", { memberId: "SOB-001", type: "Withdraw", amount: 1000, date: "" });
  CMD.run(db, ctx(T), "recordSubscription", { memberId: "SOB-001", year: 2026 });
  assert.deepEqual(db.transactions.map((x) => x.date), [T, T, T]);
});
t("an earlier genuine date is kept; future, impossible and malformed dates are refused", () => {
  const db = fresh();
  CMD.run(db, ctx(T), "createEntry", { memberId: "SOB-001", type: "Savings", amount: 1000, date: "2026-03-02" });
  assert.equal(db.transactions[0].date, "2026-03-02");
  ["2026-10-08", "2999-01-01"].forEach((d) => assert.throws(() => CMD.run(db, ctx(T), "createEntry", { memberId: "SOB-001", type: "Savings", amount: 1, date: d }), /future/));
  ["2026-02-30", "2026-13-01", "07/10/2026", "yesterday"].forEach((d) => assert.throws(() => CMD.run(db, ctx(T), "createEntry", { memberId: "SOB-001", type: "Savings", amount: 1, date: d }), /real day/));
  assert.throws(() => CMD.run(db, ctx(T), "recordSubscription", { memberId: "SOB-002", year: 2026, date: "2027-01-01" }), /future/);
  assert.throws(() => CMD.run(db, ctx(T), "repayLoan", { loanId: "x", amount: 1, date: "2027-01-01" }), /future/);
  assert.throws(() => CMD.run(db, ctx(T), "disburseLoan", { loanId: "x", date: "2027-01-01" }), /future/);
});
t("the chosen repayment date drives the interest/principal split and the guarantor release", () => {
  const db = fresh(); db.members.push({ id: "SOB-003", name: "C", status: "Active" });
  [["SOB-001", 10000], ["SOB-002", 500000], ["SOB-003", 500000]].forEach(([m, a]) => G.createEntry(db, ctx("2026-01-05"), { date: "2026-01-05", memberId: m, amount: a, type: "Savings" }));
  const l = LN.applyForLoan(db, ctx("2026-02-01"), "SOB-001", 100000);
  [["SOB-002", 40000], ["SOB-003", 30000]].forEach(([g, a]) => { const x = LN.addGuarantee(db, ctx("2026-02-02"), l.id, g, a); LN.acceptGuarantee(db, G.makeCtx({ name: g, id: g, role: "Member", memberId: g }, { today: "2026-02-02", now: "2026-02-02T09:00:00.000Z" }), x.id); });
  LN.approveLoan(db, ctx("2026-02-03"), l.id); LN.approveLoan(db, ctx("2026-02-03", "Chairperson"), l.id);
  CMD.run(db, ctx("2026-02-03"), "disburseLoan", { loanId: l.id, assignedMonthlyInterest: 10000, graceMonths: 3, date: "2026-02-03" });
  const early = JSON.parse(JSON.stringify(db)), late = JSON.parse(JSON.stringify(db));
  CMD.run(early, ctx(T), "repayLoan", { loanId: l.id, amount: 30000, date: "2026-07-10" });
  CMD.run(late, ctx(T), "repayLoan", { loanId: l.id, amount: 30000 });                          // no date -> today
  const rel = (d) => d.guarantees.reduce((a, g) => a + (g.releasedAmount || 0), 0);
  assert.equal(early.transactions.find((x) => x.type === "Loan Repayment").date, "2026-07-10");
  assert.equal(rel(early), 10000);   // 20,000 of the payment cleared interest accrued to 10 July; only 10,000 reduced principal
  assert.equal(rel(late), 0);        // by today all 30,000 is still interest, so nothing is released
  assert.throws(() => CMD.run(db, ctx(T), "repayLoan", { loanId: l.id, amount: 1000, date: "2026-01-15" }), /before the loan was disbursed/);
});
console.log(n + " date tests passed");
