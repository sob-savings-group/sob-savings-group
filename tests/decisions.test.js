/* SOB decisions of 8 Oct 2026, tested on the core engine: guarantor policy starts 1 Jan 2027; undated genuine rows keep their source position without an invented date;
   a consolidated loan stays ONE account and keeps its component disbursements (Chairperson-approved); actual savings fall with withdrawals and share-outs. */
const assert = require("assert"), L = require("../src/core/ledger.js"), G = require("../src/core/governance.js"), LN = require("../src/core/loans.js"), CMD = require("../src/core/commands.js"), R = require("../src/core/reports.js");
let pass = 0; const t = (n, fn) => { try { fn(); pass++; console.log("  ok  " + n); } catch (e) { process.exitCode = 1; console.log("FAIL  " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 4).join("\n      ")); } };
const U = { admin: { name: "Super Admin", id: "U1", role: "Admin" }, chair: { name: "Chair", id: "U2", role: "Chairperson" } };
const at = (day, who) => G.makeCtx(U[who || "admin"], { today: day, now: day + "T09:00:00.000Z" });
const fresh = () => ({ members: ["A", "B"].map((x, i) => ({ id: "SOB-00" + (i + 1), name: "Member " + x, status: "Active", regDate: "2025-01-01" })), transactions: [], loans: [], guarantees: [], auditLog: [] });
t("the default policy starts the guarantor requirement on 1 January 2027", () => assert.equal(L.getPolicy(fresh(), "loan").guarantorPolicyStart, "2027-01-01"));
t("before the start date a loan above the 3x guideline needs no guarantor; from it, only the shortfall is backed", () => {
  const db = fresh(); G.createEntry(db, at("2026-01-05"), { date: "2026-01-05", memberId: "SOB-001", amount: 10000, type: "Savings" });
  db.policy = [{ id: "loan", guarantorPolicyStart: "2099-01-01" }]; let a = LN.assessLoan(db, "SOB-001", 100000);
  assert.equal(a.guarantorsApply, false); assert.equal(a.required, 0); assert.equal(a.canApprove, true); assert.equal(a.shortfall, 70000, "the shortfall is still shown for information");
  db.policy = [{ id: "loan", guarantorPolicyStart: "2020-01-01" }]; a = LN.assessLoan(db, "SOB-001", 100000);
  assert.equal(a.guarantorsApply, true); assert.equal(a.required, 70000); assert.equal(a.canApprove, false);
});
t("a historical row with no date keeps its source position (after/before), no date is invented, and the balance counts it", () => {
  const db = fresh(); const m = { batchId: "B", source: "t", entries: [
    { memberId: "SOB-001", date: "2025-10-06", amount: 200000, sourceRef: "r19", type: "Savings" },
    { memberId: "SOB-001", dateUnknown: true, dateAfter: "2025-10-06", dateBefore: "2025-12-20", amount: 150000, sourceRef: "r40", type: "Withdraw", purpose: "Withdrawal (date not recorded)" }] };
  assert.throws(() => CMD.run(db, at("2026-10-08"), "importHistoricalEntries", { batchId: "B", source: "t", entries: [{ memberId: "SOB-001", dateUnknown: true, amount: 1, sourceRef: "x", type: "Savings" }] }), /dateAfter/);
  CMD.run(db, at("2026-10-08"), "importHistoricalEntries", m); const x = db.transactions.find((r) => r.sourceRef === "r40");
  assert.equal(x.dateUnknown, true); assert.equal(x.dateAfter, "2025-10-06"); assert.equal(x.dateBefore, "2025-12-20"); assert.equal(L.memberSavings(db, "SOB-001"), 50000);
  assert.equal(CMD.run(db, at("2026-10-08"), "importHistoricalEntries", m).added, 0, "re-import adds nothing");
});
t("actual savings = deposits + profit - withdrawals - share-outs", () => {
  const db = fresh(); CMD.run(db, at("2026-10-08"), "importHistoricalEntries", { batchId: "B", source: "t", entries: [
    { memberId: "SOB-001", date: "2025-01-01", amount: 1000000, sourceRef: "a", type: "Savings" }, { memberId: "SOB-001", date: "2025-06-01", amount: 20000, sourceRef: "b", type: "Profit" },
    { memberId: "SOB-001", date: "2025-08-01", amount: 300000, sourceRef: "c", type: "Withdraw" }, { memberId: "SOB-001", date: "2025-12-21", amount: 200000, sourceRef: "d", type: "Share-Out" }] });
  assert.equal(L.memberSavings(db, "SOB-001"), 1000000 + 20000 - 300000 - 200000);
});
t("a consolidated loan is ONE account with its dated components; the sum must match; the Chairperson approves; the statement shows them", () => {
  const db = fresh(); db.loans.push({ id: "LOAN-X", date: "2025-12-21", memberId: "SOB-002", memberName: "Member B", loanAmount: 861000, monthlyStandardInterest: 30000, graceMonths: 3, status: "Active" });
  const comps = [{ date: "2026-03-09", amount: 811000, ref: "row 209" }, { date: "2026-04-30", amount: 50000, ref: "row 263" }];
  assert.throws(() => CMD.run(db, at("2026-10-08"), "recordLoanComponents", { loanId: "LOAN-X", components: [{ date: "2026-03-09", amount: 800000 }, { date: "2026-04-30", amount: 50000 }], reason: "r", evidence: "e" }), /add up/);
  const r = CMD.run(db, at("2026-10-08"), "recordLoanComponents", { loanId: "LOAN-X", components: comps, reason: "one loan", evidence: "rows 209, 263" }); assert.equal(r.pendingApproval, true); assert.equal(db.loans[0].components, undefined, "nothing changes before approval");
  assert.throws(() => CMD.run(db, at("2026-10-08"), "approveRequest", { id: r.requestId }), /FORBIDDEN|SEPARATION/);
  CMD.run(db, at("2026-10-08", "chair"), "approveRequest", { id: r.requestId });
  assert.equal(db.loans.length, 1); assert.equal(db.loans[0].loanAmount, 861000); assert.deepEqual(db.loans[0].components.map((c) => c.amount), [811000, 50000]);
  assert.ok(/811,000/.test(R.loanStatement(db, "LOAN-X", "2026-10-08").totals.componentDisbursements));
});
console.log(pass + " decision tests passed");
