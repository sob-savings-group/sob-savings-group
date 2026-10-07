/* Integrity and second-approval controls (final SOB rules): the Super Admin cannot bypass the Chairperson, originals survive voids, releases follow principal only. */
const assert = require("assert");
const G = require("../src/core/governance.js"), L = require("../src/core/ledger.js"), LN = require("../src/core/loans.js"), I = require("../src/core/integrity.js"), CMD = require("../src/core/commands.js"), C = require("../src/core/cycle.js");
let pass = 0, f = 0; const t = (n, fn) => { try { fn(); pass++; console.log("  ok  " + n); } catch (e) { f++; process.exitCode = 1; console.log("FAIL  " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 4).join("\n      ")); } };
const U = { admin: { name: "Super Admin", id: "U1", role: "Admin" }, chair: { name: "Chair", id: "U2", role: "Chairperson" }, treas: { name: "Treas", id: "U3", role: "Treasurer" } };
const at = (day, who) => G.makeCtx(U[who || "admin"], { today: day, now: day + "T09:00:00.000Z" });
const mem = (id, day) => G.makeCtx({ name: "m" + id, id, role: "Member", memberId: id }, { today: day, now: day + "T09:00:00.000Z" });
const fresh = () => ({ members: ["A", "B", "C"].map((x, i) => ({ id: "SOB-00" + (i + 1), name: "Member " + x, status: "Active", regDate: "2025-01-01" })), transactions: [], loans: [], guarantees: [], auditLog: [] });
const seed = (db, id, amt, day) => G.createEntry(db, at(day || "2026-01-05"), { date: day || "2026-01-05", memberId: id, amount: amt, type: "Savings" });
const throwsMsg = (fn, re) => assert.throws(fn, (e) => re.test(e.message));
const setup = () => {
  const db = fresh(); seed(db, "SOB-001", 100000); seed(db, "SOB-002", 1000000);
  const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 1000000); const g = LN.addGuarantee(db, at("2026-02-02"), l.id, "SOB-002", 700000); LN.acceptGuarantee(db, mem("SOB-002", "2026-02-02"), g.id);
  LN.approveLoan(db, at("2026-02-03"), l.id); LN.approveLoan(db, at("2026-02-03", "chair"), l.id); LN.disburseLoan(db, at("2026-02-03"), l.id, { date: "2026-02-03", assignedMonthlyInterest: 30000, graceMonths: 0 });
  return { db, l };
};
console.log("second approval - the Super Admin cannot bypass the Chairperson");
t("every gated command only creates a request for the Super Admin; nothing changes until a DIFFERENT person approves", () => {
  const { db, l } = setup(); LN.repayLoan(db, at("2026-05-03"), l.id, 300000, "2026-05-03"); const rep = db.transactions.filter((x) => x.type === "Loan Repayment").pop(), before = JSON.stringify(db.transactions);
  const calls = [["voidEntry", { id: rep.id, reason: "r" }], ["voidLoan", { loanId: l.id, reason: "r" }], ["editAssignedInterest", { loanId: l.id, amount: 1, reason: "r" }], ["correctLoanDate", { loanId: l.id, date: "2026-02-04", reason: "r", evidence: "e" }], ["correctEntryDate", { id: rep.id, date: "2026-05-04", reason: "r", evidence: "e" }]];
  for (const [n, a] of calls) { const r = CMD.run(db, at("2026-05-04"), n, a); assert.equal(r.pendingApproval, true, n); }
  assert.equal(JSON.stringify(db.transactions), before, "nothing was changed"); assert.equal(db.approvalRequests.length, calls.length);
  const q = db.approvalRequests[0];
  throwsMsg(() => CMD.run(db, at("2026-05-04"), "approveRequest", { id: q.id }), /FORBIDDEN/); throwsMsg(() => CMD.run(db, at("2026-05-04", "treas"), "approveRequest", { id: q.id }), /FORBIDDEN/);
  const chairAsRequester = G.makeCtx({ name: "Super Admin", id: "U1", role: "Chairperson" }, { today: "2026-05-04", now: "2026-05-04T09:00:00.000Z" }); throwsMsg(() => CMD.run(db, chairAsRequester, "approveRequest", { id: q.id }), /SEPARATION/);
  CMD.run(db, at("2026-05-04", "chair"), "approveRequest", { id: q.id });
  const orig = db.transactions.find((x) => x.id === rep.id); assert.equal(orig.voided, true); assert.equal(orig.amount, 300000, "the original transaction is preserved, never deleted"); assert.ok(db.transactions.length === JSON.parse(before).length);
  assert(db.auditLog.some((a) => a.entityType === "ApprovalRequest" && a.action === "Approved and executed") && db.auditLog.some((a) => a.entityType === "Transaction" && /void/i.test(a.action)), "request, approval and the void are all audited");
});
t("a request that cannot run is refused up front; a Chairperson can reject with a reason; the requester can withdraw", () => {
  const { db } = setup(); throwsMsg(() => CMD.run(db, at("2026-05-04"), "voidEntry", { id: "NOPE", reason: "r" }), /NOT_FOUND|INVALID|REQUIRED/);
  const t0 = db.transactions[0]; const r = CMD.run(db, at("2026-05-04"), "voidEntry", { id: t0.id, reason: "mistake" });
  throwsMsg(() => CMD.run(db, at("2026-05-04", "chair"), "rejectRequest", { id: r.requestId }), /REQUIRED/); CMD.run(db, at("2026-05-04", "chair"), "rejectRequest", { id: r.requestId, reason: "not justified" });
  assert.equal(db.approvalRequests[0].status, "Rejected"); assert.ok(!db.transactions[0].voided);
  const r2 = CMD.run(db, at("2026-05-05"), "voidEntry", { id: t0.id, reason: "again" }); throwsMsg(() => CMD.run(db, at("2026-05-05", "chair"), "cancelRequest", { id: r2.requestId }), /FORBIDDEN/); CMD.run(db, at("2026-05-05"), "cancelRequest", { id: r2.requestId });
  assert.equal(db.approvalRequests[1].status, "Withdrawn");
});
t("every new loan, the Super Admin cannot disable it; routine savings and repayments are not gated", () => {
  const { db, l } = setup(); throwsMsg(() => G.setPolicy(db, at("2026-02-01"), "approval", { loanSecondApproval: false }, "r"), /./);
  for (const n of ["createEntry", "repayLoan"]) assert.equal(Object.prototype.hasOwnProperty.call(CMD.GATED, n), false);
  CMD.run(db, at("2026-03-01"), "createEntry", { date: "2026-03-01", memberId: "SOB-001", amount: 1000, type: "Savings" }); assert.equal(L.memberSavings(db, "SOB-001"), 101000);
  throwsMsg(() => CMD.run(db, at("2026-03-01", "chair"), "createEntry", { date: "2026-03-01", memberId: "SOB-001", amount: 1, type: "Savings" }), /FORBIDDEN/); throwsMsg(() => CMD.run(db, at("2026-03-01", "treas"), "createEntry", { date: "2026-03-01", memberId: "SOB-001", amount: 1, type: "Savings" }), /FORBIDDEN/);
});
t("December share-out cannot consume committed savings; posting needs the Chairperson", () => {
  const { db } = setup(); const r = CMD.run(db, at("2026-12-20"), "executeShareOut", { year: 2026, date: "2026-12-20" }); assert.equal(r.pendingApproval, true); assert.equal(L.memberSavings(db, "SOB-002"), 1000000, "nothing paid until the Chairperson approves");
  CMD.run(db, at("2026-12-20", "chair"), "approveRequest", { id: r.requestId });
  assert.equal(L.memberSavings(db, "SOB-002"), 700000, "only the 300,000 available is paid; the 700,000 committed stays"); assert.equal(L.memberCommitted(db, "SOB-002"), 700000);
});
t("integrity check catches a release beyond the principal reduced and a release with no live repayment", () => {
  const { db, l } = setup(); LN.repayLoan(db, at("2026-05-03"), l.id, 300000, "2026-05-03");
  assert.equal(L.loanInterestPosition(l, db, "2026-05-03").principalPaid, 210000); const g = db.guarantees[0]; assert.equal(g.releasedAmount, 210000);
  assert.deepEqual(I.check(db, "2026-05-03").findings.filter((x) => x.severity === "error"), []);
  g.releases[0].amount = 250000; g.releasedAmount = 250000; assert(I.check(db, "2026-05-03").findings.some((x) => x.code === "RELEASE_EXCEEDS_PRINCIPAL_REDUCED"));
  g.releases[0].amount = 210000; g.releasedAmount = 210000; g.releases[0].entryId = "GONE"; assert(I.check(db, "2026-05-03").findings.some((x) => x.code === "RELEASE_WITHOUT_REPAYMENT"));
});
console.log("\n" + (f ? f + " FAILED, " : "") + pass + " passed");
