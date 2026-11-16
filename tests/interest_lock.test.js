"use strict";
const assert = require("node:assert/strict");
const L = require("../src/core/ledger.js");
const base = { id: "L1", date: "2026-01-10", loanAmount: 100000, assignedMonthlyInterest: 5000, status: "Active" };
let n = 0; const ok = (name, f) => { f(); n++; console.log("  ok " + name); };
ok("no lock: 4 full months by 2026-05-10 = 20,000", () => assert.equal(L.loanAccumulatedInterest(base, "2026-05-10"), 20000));
ok("locked from 2026-03-10: only the 2 months before it are charged, however long it stays locked", () => {
  const l = Object.assign({}, base, { interestLocks: [{ from: "2026-03-10", to: "" }] });
  assert.equal(L.loanAccumulatedInterest(l, "2026-05-10"), 10000); assert.equal(L.loanAccumulatedInterest(l, "2027-01-10"), 10000); assert.equal(L.loanInterestLocked(l), true);
});
ok("a month in progress when the lock starts is not charged", () => {
  const l = Object.assign({}, base, { interestLocks: [{ from: "2026-03-20", to: "" }] });
  assert.equal(L.loanAccumulatedInterest(l, "2026-06-10"), 10000);
});
ok("unlocked: months during the lock are waived, charging resumes afterwards", () => {
  const l = Object.assign({}, base, { interestLocks: [{ from: "2026-03-10", to: "2026-05-10" }] });
  assert.equal(L.loanAccumulatedInterest(l, "2026-05-10"), 10000); assert.equal(L.loanAccumulatedInterest(l, "2026-07-10"), 20000); assert.equal(L.loanInterestLocked(l), false);
});
ok("a past as-at date before the lock is unchanged", () => {
  const l = Object.assign({}, base, { interestLocks: [{ from: "2026-03-10", to: "" }] });
  assert.equal(L.loanAccumulatedInterest(l, "2026-02-10"), 5000);
});
console.log(n + " interest lock engine tests passed");

/* command level: Admin initiates, Chairperson approves; audited; nothing recorded is changed */
process.env.NODE_ENV = process.env.NODE_ENV || "test";
const G = require("../src/core/governance.js"), LN = require("../src/core/loans.js"), CMD = require("../src/core/commands.js");
L.POLICY_DEFAULTS.loan.guarantorPolicyStart = "2020-01-01";
const U = { admin: { name: "Super Admin", id: "U1", role: "Admin" }, chair: { name: "Chair", id: "U2", role: "Chairperson" }, treas: { name: "Treas", id: "U3", role: "Treasurer" } };
const at = (day, who) => G.makeCtx(U[who || "admin"], { today: day, now: day + "T09:00:00.000Z" });
const mem = (id, day) => G.makeCtx({ name: "m" + id, id, role: "Member", memberId: id }, { today: day, now: day + "T09:00:00.000Z" });
const db = { members: ["A", "B"].map((x, i) => ({ id: "SOB-00" + (i + 1), name: "Member " + x, status: "Active", regDate: "2025-01-01" })), transactions: [], loans: [], guarantees: [], auditLog: [] };
[["SOB-001", 100000], ["SOB-002", 1000000]].forEach(([m, a]) => G.createEntry(db, at("2026-01-05"), { date: "2026-01-05", memberId: m, amount: a, type: "Savings" }));
const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 1000000); const g = LN.addGuarantee(db, at("2026-02-02"), l.id, "SOB-002", 700000); LN.acceptGuarantee(db, mem("SOB-002", "2026-02-02"), g.id);
LN.approveLoan(db, at("2026-02-03"), l.id); LN.approveLoan(db, at("2026-02-03", "chair"), l.id); LN.disburseLoan(db, at("2026-02-03"), l.id, { date: "2026-02-03", assignedMonthlyInterest: 30000, graceMonths: 0 });
ok("Admin's lock is a request; the Chairperson approves; the Treasurer cannot lock", () => {
  assert.throws(() => CMD.run(db, at("2026-05-04", "treas"), "lockInterest", { loanId: l.id, reason: "x" }), (e) => /FORBIDDEN/.test(e.message));
  const before = L.loanAccumulatedInterest(db.loans[0], "2026-08-03", db);
  const r = CMD.run(db, at("2026-05-04"), "lockInterest", { loanId: l.id, reason: "Church resolution", date: "2026-05-04" }); assert.equal(r.pendingApproval, true);
  assert.equal(L.loanAccumulatedInterest(db.loans[0], "2026-08-03", db), before, "nothing changes before approval");
  CMD.run(db, at("2026-05-04", "chair"), "approveRequest", { id: r.requestId });
  assert.equal(L.loanInterestLocked(db.loans[0]), true); assert.equal(L.loanAccumulatedInterest(db.loans[0], "2026-08-03", db), 90000, "3 months (Feb-May) charged, none after the lock");
  assert.ok(db.auditLog.some((a) => a.action === "Interest locked"), "audited");
  assert.throws(() => LN.lockInterest(db, at("2026-05-05"), l.id, "again"), (e) => /already locked/.test(e.message));
});
ok("unlocking is also approved by the Chairperson and recorded", () => {
  const r = CMD.run(db, at("2026-08-03"), "unlockInterest", { loanId: l.id, reason: "Resolution rescinded", date: "2026-08-03" }); CMD.run(db, at("2026-08-03", "chair"), "approveRequest", { id: r.requestId });
  assert.equal(L.loanInterestLocked(db.loans[0]), false); assert.ok(db.auditLog.some((a) => a.action === "Interest unlocked")); assert.equal(db.loans[0].interestLocks.length, 1);
});
console.log("interest lock command tests passed");
