/* Settle from savings is ONE business action: it clears the loan and stops interest by itself (no separate lock). Synthetic data. */
const assert = require("assert"), G = require("../src/core/governance.js"), CMD = require("../src/core/commands.js"), L = require("../src/core/ledger.js");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };
const mk = (id, role, day, hour) => G.makeCtx({ id, name: id, role }, { today: day, now: day + "T" + (hour || "08") + ":00:00Z" });
const admin = (d) => mk("ADMIN", "Admin", d), chair = (d) => mk("CHAIR", "Chairperson", d, "09");
const fresh = (savings) => { const db = { members: [{ id: "M-A", name: "Member A", status: "Active", phone: "0772000100" }], transactions: [], loans: [], guarantees: [], auditLog: [], approvalRequests: [] };
  G.createEntry(db, admin("2026-11-01"), { date: "2026-01-05", memberId: "M-A", amount: savings, type: "Savings" });
  CMD.run(db, admin("2026-11-01"), "recordExistingLoan", { memberId: "M-A", amount: 500000, date: "2026-06-10", assignedMonthlyInterest: 30000, remarks: "test" }); return db; };
const settle = (db, date) => { const r = CMD.run(db, admin("2026-11-19"), "settleLoanFromSavings", { loanId: db.loans[0].id, date }); if (r && r.requestId) CMD.run(db, chair("2026-11-19"), "approveRequest", { id: r.requestId }); return r; };
t("settling clears the loan, takes savings down and leaves nothing owed", () => { const db = fresh(900000), owed = L.loanOutstanding(db.loans[0], db, "2026-11-19"); settle(db, "2026-11-19");
  assert.strictEqual(db.loans[0].status, "Cleared"); assert.strictEqual(L.loanOutstanding(db.loans[0], db, "2026-11-19"), 0); assert.strictEqual(L.memberVerifiedSavingsAsOf(db, "M-A", "2026-11-19"), 900000 - owed); });
t("interest does NOT keep growing after settling, so no separate lock is needed", () => { const db = fresh(900000); settle(db, "2026-11-19");
  ["2026-12-19", "2027-06-19"].forEach((d) => assert.strictEqual(L.loanOutstanding(db.loans[0], db, d), 0, d)); assert.ok(!(db.loans[0].interestLocks || []).length); });
t("not enough savings: refused with a plain code, nothing changes", () => { const db = fresh(100000); assert.throws(() => settle(db, "2026-11-19"), /INSUFFICIENT_SAVINGS/); assert.strictEqual(db.loans[0].status, "Active"); });
t("the audit names who requested and who approved, and the settlement itself is recorded", () => { const db = fresh(900000); settle(db, "2026-11-19"); assert.ok(db.auditLog.some((x) => x.action === "Settled from savings" && x.by === "ADMIN"));
  const ap = db.auditLog.filter((x) => x.action === "Approved and executed").pop(); assert.ok(ap && /Initiated by ADMIN, approved by CHAIR/.test(ap.reason)); });
console.log(n + " settle-flow tests passed");
