/* The nine SOB loan / guarantor / approval / interest / profit rules, tested end to end on the core engine. */
const assert = require("assert");
require("../src/core/ledger.js").POLICY_DEFAULTS.loan.guarantorPolicyStart = "2020-01-01";   // these tests exercise the guarantor rules, which SOB starts on 1 Jan 2027 in production
const dates = require("../src/core/dates.js"), L = require("../src/core/ledger.js"), G = require("../src/core/governance.js"), LN = require("../src/core/loans.js"), SEC = require("../src/core/security.js"),
  C = require("../src/core/cycle.js"), K = require("../src/core/kpis.js"), R = require("../src/core/reports.js"), I = require("../src/core/integrity.js"), CMD = require("../src/core/commands.js"), S = require("../src/backend/store.js");
let pass = 0, f = 0; const t = (n, fn) => { try { fn(); pass++; console.log("  ok  " + n); } catch (e) { f++; process.exitCode = 1; console.log("FAIL  " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 4).join("\n      ")); } };
const throwsMsg = (fn, re) => assert.throws(fn, (e) => re.test(e.message), "expected /" + re + "/");
const U = { admin: { name: "Super Admin", id: "U1", role: "Admin" }, chair: { name: "Chair", id: "U2", role: "Chairperson" }, treas: { name: "Treas", id: "U3", role: "Treasurer" }, comm: { name: "Comm", id: "U4", role: "Committee" } };
const at = (day, who) => G.makeCtx(U[who || "admin"], { today: day, now: day + "T09:00:00.000Z" });
const mem = (id, day) => G.makeCtx({ name: "m" + id, id, role: "Member", memberId: id }, { today: day || "2026-02-02", now: (day || "2026-02-02") + "T09:00:00.000Z" });
const fresh = () => ({ members: ["A", "B", "C", "D"].map((x, i) => ({ id: "SOB-00" + (i + 1), name: "Member " + x, status: "Active", regDate: "2025-01-01" })), transactions: [], loans: [], guarantees: [], auditLog: [] });
const seed = (db, id, amt, day) => G.createEntry(db, at(day || "2026-01-05"), { date: day || "2026-01-05", memberId: id, amount: amt, type: "Savings" });
const guarantee = (db, loanId, gid, amt, day) => { const g = LN.addGuarantee(db, at(day || "2026-02-02"), loanId, gid, amt); return LN.acceptGuarantee(db, mem(gid, day || "2026-02-02"), g.id); };
const approve = (db, id, day) => { LN.approveLoan(db, at(day || "2026-02-03"), id); return LN.approveLoan(db, at(day || "2026-02-03", "chair"), id); };   // Super Admin reviews, the Chairperson approves
const active = (db, id, day) => { const l = approve(db, id, day); LN.disburseLoan(db, at(day || "2026-02-03"), id, { date: day || "2026-02-03", assignedMonthlyInterest: 10000, graceMonths: 3 }); return l; };
const gated = (db, day, name, args) => { const r = CMD.run(db, at(day), name, args); assert.equal(r.pendingApproval, true, name + " must wait for the Chairperson"); return CMD.run(db, at(day, "chair"), "approveRequest", { id: r.requestId }); };   // Super Admin requests, a different person approves
const noErrors = (db, asOf) => assert.deepEqual(I.check(db, asOf || "2026-12-31").findings.filter((x) => x.severity === "error"), []);

console.log("rule 2 - 3x savings is a guideline, not an automatic rejection");
t("within the guideline: qualifies on own savings; beyond it: needs backing, and enough backing lets it proceed", () => {
  const db = fresh(); seed(db, "SOB-001", 10000);
  const a = LN.assessLoan(db, "SOB-001", 30000); assert.equal(a.guideline, 30000); assert.equal(a.withinGuideline, true); assert.equal(a.canApprove, true); assert.equal(a.required, 0);
  const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 100000);
  const b = LN.assessLoan(db, "SOB-001", 100000, l.id); assert.equal(b.shortfall, 70000); assert.equal(b.canApprove, false);
  throwsMsg(() => LN.approveLoan(db, at("2026-02-03"), l.id), /NO_BACKING/);
  seed(db, "SOB-002", 500000); guarantee(db, l.id, "SOB-002", 40000);
  throwsMsg(() => LN.approveLoan(db, at("2026-02-03"), l.id), /NO_BACKING/);                              // 40,000 of 70,000 is not enough
  seed(db, "SOB-003", 500000); guarantee(db, l.id, "SOB-003", 30000);                                      // combined 70,000 = shortfall
  assert.equal(LN.assessLoan(db, "SOB-001", 100000, l.id).canApprove, true);
  assert.equal(approve(db, l.id).status, "Approved");
});
t("a loan inside the guideline needs no guarantor at all", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 30000);
  assert.equal(approve(db, l.id).status, "Approved");
});
t("backing is ONLY the shortfall beyond the borrower's own qualification; SOB's loan/profit rules are fixed and cannot be edited, the approval list can only grow", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 30000);
  assert.equal(LN.assessLoan(db, "SOB-001", 30000, l.id).required, 0); assert.equal(LN.assessLoan(db, "SOB-001", 45000).required, 15000);
  throwsMsg(() => G.setPolicy(db, at("2026-02-01"), "loan", { guaranteeCover: "FULL_LOAN" }, "r"), /fixed by SOB/); throwsMsg(() => G.setPolicy(db, at("2026-02-01"), "loan", { repaymentAllocation: "PRINCIPAL_FIRST" }, "r"), /fixed by SOB/);
  throwsMsg(() => G.setPolicy(db, at("2026-02-01"), "profit", { addFactor: { id: "TENURE", kind: "multiplier", name: "x", approvedBy: "a", approvalRef: "b" } }, "r"), /fixed by SOB/);
  throwsMsg(() => G.setPolicy(db, at("2026-02-01"), "approval", { requiredTypes: ["Savings"] }, "r"), /routine savings/); throwsMsg(() => G.setPolicy(db, at("2026-02-01"), "approval", {}, ""), /REQUIRED/);
  throwsMsg(() => G.setPolicy(db, at("2026-02-01", "chair"), "approval", { requiredTypes: ["Expense"] }, "r"), /FORBIDDEN/);
  G.setPolicy(db, at("2026-02-01"), "approval", { requiredTypes: ["Expense"] }, "stricter (test)"); throwsMsg(() => G.setPolicy(db, at("2026-02-01"), "approval", { requiredTypes: [] }, "relax"), /cannot be removed/);
});

console.log("rules 3, 8, 9 - several guarantors, committed vs available, release by repayment");
t("a request commits nothing; acceptance commits at once and reduces AVAILABLE savings; actual savings stay", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); seed(db, "SOB-002", 100000);
  const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 60000);
  const g = LN.addGuarantee(db, at("2026-02-02"), l.id, "SOB-002", 30000);
  assert.deepEqual(L.memberPosition(db, "SOB-002"), { savings: 100000, committed: 0, available: 100000, withdrawable: 100000 });
  throwsMsg(() => LN.acceptGuarantee(db, mem("SOB-003"), g.id), /FORBIDDEN/);                     // only the guarantor may accept for themself
  throwsMsg(() => LN.acceptGuarantee(db, at("2026-02-02"), g.id), /REQUIRED/);                    // Admin on their behalf needs evidence
  LN.acceptGuarantee(db, mem("SOB-002"), g.id);
  assert.deepEqual(L.memberPosition(db, "SOB-002"), { savings: 100000, committed: 30000, available: 70000, withdrawable: 70000 });
  throwsMsg(() => LN.acceptGuarantee(db, mem("SOB-002"), g.id), /BAD_STATE/);
  assert(db.auditLog.some((a) => a.entityType === "Guarantee" && a.action === "Accepted and committed"));
});
t("a guarantor cannot commit more than is available; duplicates and self-guarantee refused; decline works", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); seed(db, "SOB-002", 50000);
  const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 100000);
  throwsMsg(() => LN.addGuarantee(db, at("2026-02-02"), l.id, "SOB-002", 60000), /INSUFFICIENT_GUARANTOR/);
  throwsMsg(() => LN.addGuarantee(db, at("2026-02-02"), l.id, "SOB-001", 10), /own loan/);
  const g = LN.addGuarantee(db, at("2026-02-02"), l.id, "SOB-002", 30000);
  throwsMsg(() => LN.addGuarantee(db, at("2026-02-02"), l.id, "SOB-002", 10000), /ALREADY_GUARANTOR/);
  throwsMsg(() => LN.declineGuarantee(db, mem("SOB-002"), g.id, ""), /REQUIRED/);
  LN.declineGuarantee(db, mem("SOB-002"), g.id, "cannot commit"); assert.equal(g.status, "Declined"); assert.equal(L.memberCommitted(db, "SOB-002"), 0);
});
t("a guarantor cannot withdraw committed money; only the available part, for withdrawals, airtime-style entries and charges", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); seed(db, "SOB-002", 100000);
  const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 60000); guarantee(db, l.id, "SOB-002", 30000);
  throwsMsg(() => G.createEntry(db, at("2026-02-05"), { date: "2026-02-05", memberId: "SOB-002", amount: 80000, type: "Withdraw" }), /COMMITTED_GUARANTEE.*70000/);
  throwsMsg(() => G.createEntry(db, at("2026-02-05"), { date: "2026-02-05", memberId: "SOB-002", amount: 70001, type: "Bank Charge" }), /COMMITTED_GUARANTEE/);
  G.createEntry(db, at("2026-02-05"), { date: "2026-02-05", memberId: "SOB-002", amount: 70000, type: "Withdraw" });
  assert.deepEqual(L.memberPosition(db, "SOB-002"), { savings: 30000, committed: 30000, available: 0, withdrawable: 0 });
  throwsMsg(() => G.createEntry(db, at("2026-02-06"), { date: "2026-02-06", memberId: "SOB-002", amount: 1, type: "Withdraw" }), /COMMITTED_GUARANTEE/);
  noErrors(db);
});
t("December share-out recognises the guarantee first: only the available part leaves, the committed part stays", () => {
  const db = fresh(); seed(db, "SOB-001", 10000, "2026-03-01"); seed(db, "SOB-002", 100000, "2026-03-01"); seed(db, "SOB-003", 5000, "2026-03-01");
  const l = LN.applyForLoan(db, at("2026-04-01"), "SOB-001", 60000); guarantee(db, l.id, "SOB-002", 30000, "2026-04-02"); active(db, l.id, "2026-04-03");
  const pv = C.previewShareOut(db, 2026, "2026-12-10"), r = pv.rows.find((x) => x.memberId === "SOB-002");
  assert.deepEqual([r.savings, r.committed, r.available, r.withdraw, r.retained, r.savingsAction], [100000, 30000, 70000, 70000, 30000, "WITHDRAW_AVAILABLE"]);
  const ev = C.executeShareOut(db, at("2026-12-10"), 2026, { date: "2026-12-10" });
  assert.equal(L.memberSavings(db, "SOB-002"), 30000, "committed amount stays in the account"); assert.equal(L.memberPosition(db, "SOB-002").available, 0);
  assert.equal(ev.retainedCommitted[0].retained, 30000); assert.equal(L.memberSavings(db, "SOB-003"), 0);
  noErrors(db);
});
t("each repayment reduces the borrower AND releases the same amount to guarantors pro rata; clearing releases the rest; both sides reconcile", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); seed(db, "SOB-002", 100000); seed(db, "SOB-003", 100000);
  const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 100000); guarantee(db, l.id, "SOB-002", 40000); guarantee(db, l.id, "SOB-003", 30000); active(db, l.id);
  assert.equal(L.memberCommitted(db, "SOB-002"), 40000); assert.equal(L.memberCommitted(db, "SOB-003"), 30000);
  LN.repayLoan(db, at("2026-03-01"), l.id, 14000, "2026-03-01");                  // 14,000 of 70,000 committed: 8,000 / 6,000
  assert.equal(L.memberCommitted(db, "SOB-002"), 32000); assert.equal(L.memberCommitted(db, "SOB-003"), 24000);
  assert.equal(L.memberPosition(db, "SOB-002").available, 68000); assert.equal(L.loanOutstanding(l, db, "2026-03-01"), 86000);
  const ll = LN.linkedLedger(db, l.id, "2026-03-01"); assert.equal(ll.summary.reconciled, true); assert.equal(ll.summary.guaranteeCommitted, 56000); assert.equal(ll.summary.guaranteeReleased, 14000);
  const rep = ll.rows.filter((r) => r.event.startsWith("Repayment")); assert.equal(rep.reduce((a, r) => a + r.guarantorCommittedChange, 0), -14000);
  LN.repayLoan(db, at("2026-03-05"), l.id, 20000, "2026-03-05"); assert.equal(L.memberCommitted(db, "SOB-002") + L.memberCommitted(db, "SOB-003"), 36000);
  LN.repayLoan(db, at("2026-03-10"), l.id, 66000, "2026-03-10");                  // clears: everything back
  assert.equal(l.status, "Cleared"); assert.equal(L.memberCommitted(db, "SOB-002"), 0); assert.equal(L.memberCommitted(db, "SOB-003"), 0);
  assert.equal(db.guarantees.every((g) => g.status === "Released" && g.releasedAmount === g.amount), true);
  assert.equal(LN.linkedLedger(db, l.id, "2026-03-10").summary.reconciled, true); noErrors(db);
});
t("a voided repayment re-commits exactly what it released and re-opens a cleared loan; restore releases again", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); seed(db, "SOB-002", 100000);
  const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 60000); guarantee(db, l.id, "SOB-002", 30000); active(db, l.id);
  LN.repayLoan(db, at("2026-03-01"), l.id, 10000, "2026-03-01"); const last = db.transactions.filter((x) => x.type === "Loan Repayment").pop();
  assert.equal(L.memberCommitted(db, "SOB-002"), 20000);
  gated(db, "2026-03-02", "voidEntry", { id: last.id, reason: "wrong amount" }); assert.equal(L.memberCommitted(db, "SOB-002"), 30000); noErrors(db, "2026-03-02");
  gated(db, "2026-03-03", "restoreEntry", { id: last.id, reason: "was right" }); assert.equal(L.memberCommitted(db, "SOB-002"), 20000);
  LN.repayLoan(db, at("2026-03-04"), l.id, 50000, "2026-03-04"); assert.equal(l.status, "Cleared"); assert.equal(L.memberCommitted(db, "SOB-002"), 0);
  const clearing = db.transactions.filter((x) => x.type === "Loan Repayment").pop();
  gated(db, "2026-03-05", "voidEntry", { id: clearing.id, reason: "bounced" }); assert.equal(l.status, "Active"); assert.equal(L.memberCommitted(db, "SOB-002"), 20000, "commitment back until the loan is really repaid"); noErrors(db, "2026-03-05");
});
t("releasing a guarantor is only possible before disbursement; afterwards only repayments release", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); seed(db, "SOB-002", 100000);
  const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 60000); guarantee(db, l.id, "SOB-002", 30000);
  LN.releaseGuarantor(db, at("2026-02-02"), l.id, "guarantor asked out"); assert.equal(L.memberCommitted(db, "SOB-002"), 0);
  throwsMsg(() => LN.approveLoan(db, at("2026-02-03"), l.id), /NO_BACKING/);
  guarantee(db, l.id, "SOB-002", 30000, "2026-02-04"); active(db, l.id, "2026-02-05");
  throwsMsg(() => LN.releaseGuarantor(db, at("2026-02-06"), l.id, "x"), /BAD_STATE/);
});

console.log("rule 4 - exceptional security / property");
const secArgs = (loanId, o) => Object.assign({ loanId, kind: "Land", description: "Plot 12 Block 3, Kyengera (title in borrower's name)", owner: "Member A", valuation: 60000, valuationDate: "2026-01-20", valuedBy: "Registered valuer", documents: [{ name: "Land title", reference: "Vol 45 Folio 12" }] }, o || {});
t("security is recorded separately with description, valuation, documents; Chairperson approval with a written exception reason and an accepted cover", () => {
  const db = fresh(); seed(db, "SOB-001", 10000);
  const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 80000);                                   // guideline 30,000 -> 50,000 needs backing
  throwsMsg(() => CMD.run(db, mem("SOB-001"), "proposeSecurity", secArgs(l.id)), /FORBIDDEN/); throwsMsg(() => CMD.run(db, at("2026-02-02", "chair"), "proposeSecurity", secArgs(l.id)), /FORBIDDEN/);
  throwsMsg(() => SEC.proposeSecurity(db, at("2026-02-02"), secArgs(l.id, { documents: [] })), /REQUIRED: at least one document/); throwsMsg(() => SEC.proposeSecurity(db, at("2026-02-02"), secArgs(l.id, { valuation: undefined })), /REQUIRED: valuation/);
  throwsMsg(() => SEC.proposeSecurity(db, at("2026-02-02"), secArgs(l.id, { kind: "Gold" })), /INVALID/);
  const x = CMD.run(db, at("2026-02-02"), "proposeSecurity", secArgs(l.id)); assert.equal(x.status, "Proposed");
  throwsMsg(() => LN.approveLoan(db, at("2026-02-03"), l.id), /NO_BACKING/);                          // a proposal backs nothing
  throwsMsg(() => CMD.run(db, at("2026-02-03"), "decideSecurity", { id: x.id, decision: "approve", reason: "r", acceptedCover: 50000 }), /FORBIDDEN/);
  throwsMsg(() => CMD.run(db, at("2026-02-03", "chair"), "decideSecurity", { id: x.id, decision: "approve", acceptedCover: 50000 }), /REQUIRED/);
  throwsMsg(() => CMD.run(db, at("2026-02-03", "chair"), "decideSecurity", { id: x.id, decision: "approve", reason: "exception", acceptedCover: 70000 }), /valuation/);
  CMD.run(db, at("2026-02-03", "chair"), "decideSecurity", { id: x.id, decision: "approve", reason: "SOB exceptionally accepts the title: no suitable guarantors", acceptedCover: 50000 });
  const a = LN.assessLoan(db, "SOB-001", 80000, l.id); assert.equal(a.canApprove, true); assert.equal(a.securityBacked, true);
  const ap = approve(db, l.id, "2026-02-04"); assert.equal(ap.securityException, true, "the loan is flagged as an exceptional, security-backed loan");
  assert.equal(L.memberCommitted(db, "SOB-001"), 0, "security never touches any member's savings");
  assert.equal(R.securities(db).rows[0].status, "Approved"); assert.equal(R.securities(db).rows[0].documents, 1);
  CMD.run(db, at("2026-02-04"), "addSecurityDocument", { id: x.id, name: "Valuation report", reference: "VR-2026-01" }); assert.equal(db.securities[0].documents.length, 2);
  LN.disburseLoan(db, at("2026-02-05"), l.id, { date: "2026-02-05", assignedMonthlyInterest: 5000, graceMonths: 0 });
  throwsMsg(() => CMD.run(db, at("2026-02-06"), "releaseSecurity", { id: x.id, reason: "x" }), /outstanding loan/);
  LN.repayLoan(db, at("2026-03-01"), l.id, L.loanOutstanding(l, db, "2026-03-01"), "2026-03-01");
  assert.equal(db.securities[0].status, "Released", "security is released when the loan is cleared"); assert(db.securities[0].history.length >= 3);
  assert(db.auditLog.some((a) => a.entityType === "Security" && a.action === "Approved (exception)")); noErrors(db, "2026-03-01");
});
t("a rejected proposal stays recorded; security is not the default route (it backs nothing unless the Chairperson accepts it)", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 80000); const x = SEC.proposeSecurity(db, at("2026-02-02"), secArgs(l.id));
  throwsMsg(() => SEC.decideSecurity(db, at("2026-02-03", "chair"), x.id, "reject", {}), /REQUIRED/);
  SEC.decideSecurity(db, at("2026-02-03", "chair"), x.id, "reject", { reason: "SOB does not accept property here" }); assert.equal(db.securities[0].status, "Rejected");
  throwsMsg(() => LN.approveLoan(db, at("2026-02-04"), l.id), /NO_BACKING/);
});

console.log("rules 6, 7 - Super Admin inputs, Chairperson second-approves, Treasurer reviews");
t("only the Super Admin can input or edit; Chairperson / Treasurer / Committee are refused on EVERY write command", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); seed(db, "SOB-002", 50000);
  const writes = { createEntry: { date: "2026-02-01", memberId: "SOB-001", amount: 5, type: "Savings" }, voidEntry: { id: db.transactions[0].id, reason: "x" }, addMember: { name: "X" }, applyForLoan: { memberId: "SOB-001", amount: 1 },
    recordExistingLoan: { memberId: "SOB-001", amount: 5, date: "2026-01-01", assignedMonthlyInterest: 0 }, recordSubscription: { memberId: "SOB-001", year: 2026 }, executeShareOut: { year: 2026, date: "2026-12-10" },
    addGuarantee: { loanId: "x", guarantorId: "SOB-002", amount: 5 }, proposeSecurity: { loanId: "x" }, setPolicy: { key: "loan", values: {}, reason: "r" }, distributeProfit: { period: "p" }, importHistoricalEntries: { batchId: "b", source: "s", entries: [{}] },
    openDiscrepancy: { kind: "OTHER", subject: "s", summary: "s" }, repayLoan: { loanId: "x", amount: 1 }, disburseLoan: { loanId: "x", assignedMonthlyInterest: 1 }, editAssignedInterest: { loanId: "x", amount: 1, reason: "r" }, voidLoan: { loanId: "x", reason: "r" } };
  ["chair", "treas", "comm"].forEach((who) => Object.keys(writes).forEach((n) => throwsMsg(() => CMD.run(db, at("2026-02-01", who), n, writes[n]), /FORBIDDEN/)));
  G.config.committeePermissions = ["report.view", "ledger.create", "ledger.approve"];            // even if misconfigured, Committee can never hold write/approve rights
  try { assert.equal(G.can(G.makeCtx(U.comm), "ledger.create"), false); assert.equal(G.can(G.makeCtx(U.comm), "ledger.approve"), false); assert.equal(G.can(G.makeCtx(U.comm), "report.view"), true); } finally { G.config.committeePermissions = null; }
  assert.equal(G.can(at("2026-02-01"), "ledger.approve"), false, "the Super Admin is not a second approver");
  assert.equal(db.transactions.length, 2);
});
t("Chairperson and Treasurer can review (reports, audit, share-out preview) but see no way to change figures", () => {
  ["chair", "treas"].forEach((who) => ["report.view", "audit.view", "shareout.preview"].forEach((p) => assert.equal(G.can(at("2026-02-01", who), p), true)));
  assert.equal(G.can(at("2026-02-01", "treas"), "ledger.approve"), false); assert.equal(G.can(at("2026-02-01", "chair"), "ledger.approve"), true);
});
t("a pending entry moves Super Admin input -> Chairperson approval; pending/rejected never count; full audit trail", () => {
  const db = fresh(); seed(db, "SOB-001", 10000);
  G.setPolicy(db, at("2026-02-01"), "approval", { requiredTypes: ["Withdraw"] }, "SOB: withdrawals need the Chairperson");
  const w = CMD.run(db, at("2026-02-02"), "createEntry", { date: "2026-02-02", memberId: "SOB-001", amount: 4000, type: "Withdraw" });
  assert.equal(w.approvalStatus, "PendingApproval"); assert.equal(L.memberSavings(db, "SOB-001"), 10000); assert.equal(R.approvals(db).rows.length, 1); assert.equal(K.dashboard(db, "2026-02-02").awaitingApproval.value, 1);
  throwsMsg(() => CMD.run(db, at("2026-02-02", "treas"), "approveEntry", { id: w.id, decision: "approve" }), /FORBIDDEN/);
  throwsMsg(() => CMD.run(db, at("2026-02-02", "chair"), "approveEntry", { id: w.id, decision: "reject" }), /REQUIRED/);
  CMD.run(db, at("2026-02-02", "chair"), "approveEntry", { id: w.id, decision: "approve", reason: "checked against slip" });
  assert.equal(L.memberSavings(db, "SOB-001"), 6000); assert.equal(R.approvals(db).rows.length, 0);
  const trail = db.auditLog.filter((a) => a.entityId === w.id).map((a) => a.action + ":" + a.role); assert.deepEqual(trail, ["Created:Admin", "Approved:Chairperson"]);
  const w2 = CMD.run(db, at("2026-02-03"), "createEntry", { date: "2026-02-03", memberId: "SOB-001", amount: 1000, type: "Withdraw" });
  CMD.run(db, at("2026-02-03", "chair"), "approveEntry", { id: w2.id, decision: "reject", reason: "no slip" }); assert.equal(L.memberSavings(db, "SOB-001"), 6000);
});
t("every new loan needs the Chairperson: Admin's review sends the loan to the Chairperson, who alone makes it Approved (reviewer cannot self-approve)", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); throwsMsg(() => G.setPolicy(db, at("2026-02-01"), "approval", { loanSecondApproval: false }, "r"), /cannot be switched off/);
  const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 20000);
  throwsMsg(() => LN.approveLoan(db, at("2026-02-02", "chair"), l.id), /reviewed by the Super Admin/);
  assert.equal(LN.approveLoan(db, at("2026-02-02"), l.id).status, "AwaitingApproval"); assert.equal(R.approvals(db).rows.length, 1); assert.equal(L.computeGroupTotals(db, "2026-02-02").loansOutstanding, 0);
  throwsMsg(() => LN.approveLoan(db, at("2026-02-02"), l.id), /awaits the Chairperson/); throwsMsg(() => LN.approveLoan(db, at("2026-02-02", "treas"), l.id), /FORBIDDEN/);
  LN.approveLoan(db, at("2026-02-03", "chair"), l.id, "approved at committee"); assert.equal(l.status, "Approved"); assert.equal(l.approvedBy, "Chair"); assert.equal(l.reviewedBy, "Super Admin");
  throwsMsg(() => LN.disburseLoan(db, at("2026-02-04", "chair"), l.id, { assignedMonthlyInterest: 1 }), /FORBIDDEN/);
  const l2 = (() => { seed(db, "SOB-002", 10000); const x = LN.applyForLoan(db, at("2026-02-01"), "SOB-002", 20000); LN.approveLoan(db, at("2026-02-02"), x.id); return x; })();
  LN.declineLoan(db, at("2026-02-03", "chair"), l2.id, "not now"); assert.equal(l2.status, "Declined");
});

console.log("rule 5 - Interest Receivable");
t("unpaid interest = accrued interest minus payments applied to interest (interest first), across all outstanding loans; accrues until fully repaid", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); seed(db, "SOB-002", 10000);
  const a = LN.recordExistingLoan(db, at("2026-01-01"), { memberId: "SOB-001", amount: 100000, date: "2026-01-01", assignedMonthlyInterest: 5000, graceMonths: 2 });
  const b = LN.recordExistingLoan(db, at("2026-02-01"), { memberId: "SOB-002", amount: 50000, date: "2026-02-01", assignedMonthlyInterest: 2000, graceMonths: 0 });
  let ir = K.interestReceivable(db, "2026-06-01");                         // a: 5 months - 2 grace = 3 x 5,000; b: 4 x 2,000
  assert.equal(ir.rows.find((r) => r.loanId === a.id).accumulatedInterest, 15000); assert.equal(ir.rows.find((r) => r.loanId === b.id).accumulatedInterest, 8000); assert.equal(ir.total, 23000);
  assert.equal(K.dashboard(db, "2026-06-01").interestReceivable.value, 23000);
  LN.repayLoan(db, at("2026-06-01"), a.id, 10000, "2026-06-01");
  ir = K.interestReceivable(db, "2026-06-01"); const ra = ir.rows.find((r) => r.loanId === a.id);
  assert.deepEqual([ra.paymentsMade, ra.paidToInterest, ra.unpaidInterest, ra.principalOutstanding, ra.outstanding], [10000, 10000, 5000, 100000, 105000]);
  assert.equal(ra.principalOutstanding + ra.unpaidInterest, ra.outstanding, "interest + principal reconcile to the loan position"); assert.equal(ir.total, 5000 + 8000);
  ir = K.interestReceivable(db, "2026-09-01"); assert.equal(ir.rows.find((r) => r.loanId === a.id).unpaidInterest, 5000 + 3 * 5000, "interest keeps accumulating");
  assert.equal(K.dashboard(db, "2026-09-01").interestReceivable.value, ir.total);
  const head = ["member", "loanId", "principal", "monthlyInterest", "disbursed", "interestFrom", "monthsElapsed", "monthsCharged", "accumulatedInterest", "paymentsMade", "unpaidInterest", "outstanding"];
  assert.deepEqual(R.interestReceivable(db, "2026-09-01").columns, head); assert.equal(R.interestReceivable(db, "2026-09-01").totals.unpaidInterest, ir.total);
  assert.ok(ir.rows[0].interestHistory && ir.rows[0].payments, "history is part of the drill-down");
  LN.repayLoan(db, at("2026-09-01"), a.id, L.loanOutstanding(a, db, "2026-09-01"), "2026-09-01");   // fully repaid -> stops
  assert.equal(K.interestReceivable(db, "2027-01-01").rows.some((r) => r.loanId === a.id), false); assert.equal(L.loanOutstanding(a, db, "2027-06-01"), 0);
});
t("FINAL rule: accumulated unpaid interest is cleared first, the rest reduces principal (1,000,000 / 90,000 / 300,000 example)", () => {
  const db = fresh(); seed(db, "SOB-001", 400000); seed(db, "SOB-002", 500000);
  const l = LN.recordExistingLoan(db, at("2026-01-01"), { memberId: "SOB-001", amount: 1000000, date: "2026-01-01", assignedMonthlyInterest: 30000, graceMonths: 0 });
  LN.repayLoan(db, at("2026-04-01"), l.id, 300000, "2026-04-01");                // 3 months x 30,000 = 90,000 interest due
  const p = L.loanInterestPosition(l, db, "2026-04-01"); assert.equal(p.unpaidInterest, 0); assert.equal(p.interestPaid, 90000);
  assert.equal(L.loanOutstanding(l, db, "2026-04-01"), 790000, "principal 1,000,000 - 210,000");
  const sp = L.loanRepaymentSplit(l, db, "2026-04-01"); assert.equal(sp.rule, "INTEREST_FIRST"); assert.equal(sp.steps[0].interest, 90000); assert.equal(sp.steps[0].principal, 210000);
  assert.ok(!K.dashboard(db, "2026-04-01").interestReceivable.pending);
});
console.log("rule 4 (revised) - guarantee release follows PRINCIPAL reduction, not cash; works with the allocation rule");
t("release equals PRINCIPAL reduction only: 300,000 payment with 90,000 unpaid interest releases 210,000; an interest-only payment releases nothing; release never exceeds principal reduced", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); seed(db, "SOB-002", 500000); seed(db, "SOB-003", 500000);
  const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 1000000); guarantee(db, l.id, "SOB-002", 500000); guarantee(db, l.id, "SOB-003", 470000); active(db, l.id, "2026-02-03");
  assert.equal(LN.committed(db, "SOB-002") + LN.committed(db, "SOB-003"), 970000);
  LN.repayLoan(db, at("2026-06-03"), l.id, 5000, "2026-06-03");                          // 1 month of interest at most (grace to 2026-05-03): smaller than interest due -> interest only
  assert.equal(LN.committed(db, "SOB-002") + LN.committed(db, "SOB-003"), 970000, "an interest-only payment releases nothing"); assert.equal(db.guarantees.every((g) => !(g.releases || []).length), true);
  const due = L.loanInterestPosition(l, db, "2026-08-03").unpaidInterest; assert.ok(due > 0);
  const out0 = L.loanOutstanding(l, db, "2026-08-03");
  LN.repayLoan(db, at("2026-08-03"), l.id, due + 200000, "2026-08-03");                  // interest first, 200,000 reduces principal
  const reduced = out0 - L.loanOutstanding(l, db, "2026-08-03") - due; assert.equal(L.loanOutstanding(l, db, "2026-08-03") + 0, out0 - 200000 - due);
  const released = db.guarantees.reduce((a, g) => a + (g.releases || []).filter((r) => !r.reversed).reduce((x, r) => x + r.amount, 0), 0); assert.equal(released, 200000); assert.ok(released <= 200000);
  const rws0 = R.loanStatement(db, l.id, "2026-08-03"); const rws = rws0.rows.filter((x) => x.event.startsWith("Repayment") && x.date === "03/08/2026"); assert.equal(rws[0].cashReceived, due + 200000); assert.equal(rws[0].borrowerChange, -200000); assert.equal(rws.reduce((x, r) => x + r.guarantorCommittedChange, 0), -200000);
  const entry = db.transactions.filter((x) => x.type === "Loan Repayment").pop(); gated(db, "2026-08-04", "voidEntry", { id: entry.id, reason: "wrong amount (test)" });
  assert.equal(LN.committed(db, "SOB-002") + LN.committed(db, "SOB-003"), 970000, "voiding re-commits exactly what it released");
  gated(db, "2026-08-04", "restoreEntry", { id: entry.id, reason: "restored (test)" }); assert.equal(LN.committed(db, "SOB-002") + LN.committed(db, "SOB-003"), 770000);
  LN.repayLoan(db, at("2026-08-12"), l.id, L.loanOutstanding(l, db, "2026-08-12"), "2026-08-12"); assert.equal(l.status, "Cleared"); assert.equal(LN.committed(db, "SOB-002") + LN.committed(db, "SOB-003"), 0); noErrors(db, "2026-08-12");
});
console.log("rule 1 - profit sharing with a transparent drill-down");
t("profit is proportional to eligible savings; loan-holders are excluded; the schedule is complete before posting; only the Chairperson's approval posts it; remainder shown, never assigned", () => {
  const db = fresh(); seed(db, "SOB-001", 100000, "2026-03-01"); seed(db, "SOB-002", 200000, "2026-03-01"); seed(db, "SOB-003", 300000, "2026-03-01"); seed(db, "SOB-004", 50000, "2026-03-01");
  LN.recordExistingLoan(db, at("2026-03-02"), { memberId: "SOB-004", amount: 10000, date: "2026-03-02", assignedMonthlyInterest: 1, graceMonths: 0 });
  throwsMsg(() => CMD.run(db, at("2026-06-30"), "previewProfit", { period: "2026-Q2" }), /CYCLE_NOT_SET/);
  for (const w of ["chair", "treas"]) throwsMsg(() => CMD.run(db, at("2026-06-30", w), "setProfitCycle", { period: "2026-Q2", pool: 100001, measurementDate: "2026-06-30", sourceNote: "n", reason: "r" }), /FORBIDDEN/);
  throwsMsg(() => CMD.run(db, at("2026-06-30"), "setProfitCycle", { period: "2026-Q2", pool: 100001, measurementDate: "2026-06-30", sourceNote: "n" }), /REQUIRED/);
  CMD.run(db, at("2026-06-29"), "setProfitCycle", { period: "2026-Q2", pool: 90000, measurementDate: "2026-06-29", sourceNote: "Interest received Apr-Jun (draft)", reason: "first figure from the Treasurer's report" });
  CMD.run(db, at("2026-06-30"), "setProfitCycle", { period: "2026-Q2", pool: 100001, measurementDate: "2026-06-30", sourceNote: "Interest received Apr-Jun", reason: "corrected per SOB minute 3" });
  const cyc = db.policy.find((x) => x.id === "cycle:2026-Q2"); assert.equal(cyc.history.length, 2); assert.equal(cyc.history[1].previous.pool, 90000); assert.ok(db.auditLog.some((a) => a.entityType === "ProfitCycle" && a.action === "Inputs changed"));
  const pv = CMD.run(db, at("2026-06-30"), "previewProfit", { period: "2026-Q2" }); const by = (id) => pv.rows.find((r) => r.memberId === id);
  assert.equal(pv.totalWeight, 600000); assert.equal(by("SOB-001").entitlement, 16666); assert.equal(by("SOB-002").entitlement, 33333); assert.equal(by("SOB-003").entitlement, 50000);
  assert.equal(by("SOB-004").eligible, false); assert.match(by("SOB-004").excludedBecause, /outstanding loan/); assert.equal(by("SOB-004").entitlement, 0);
  assert.equal(pv.distributed + pv.undistributed, 100001); assert.equal(pv.undistributed, 100001 - 16666 - 33333 - 50000);
  assert(pv.formula && pv.basis, "formula shown"); assert.equal(db.profitDistributions, undefined, "previewing writes nothing");
  const req = CMD.run(db, at("2026-06-30"), "distributeProfit", { period: "2026-Q2" }); assert.equal(req.pendingApproval, true); assert.equal(L.memberSavings(db, "SOB-003"), 300000, "the Super Admin cannot post it");
  const rq = db.approvalRequests.find((x) => x.id === req.requestId); assert.equal(rq.schedule.rows.length, 4); assert.equal(rq.schedule.pool, 100001); assert.equal(rq.schedule.date, "2026-06-30");
  throwsMsg(() => CMD.run(db, at("2026-06-30"), "approveRequest", { id: req.requestId }), /FORBIDDEN/); throwsMsg(() => CMD.run(db, at("2026-06-30", "treas"), "approveRequest", { id: req.requestId }), /FORBIDDEN/);
  const out = CMD.run(db, at("2026-06-30", "chair"), "approveRequest", { id: req.requestId }); const rec = out.result; assert.equal(rec.cycleHistory.length, 2, "the audited input history travels with the posted distribution");
  assert.equal(L.memberSavings(db, "SOB-003"), 350000); assert.equal(rec.rows.find((r) => r.memberId === "SOB-003").entryId.length > 0, true);
  throwsMsg(() => CMD.run(db, at("2026-07-01"), "distributeProfit", { period: "2026-Q2" }), /ALREADY_DISTRIBUTED/);
  throwsMsg(() => CMD.run(db, at("2026-07-01"), "setProfitCycle", { period: "2026-Q2", pool: 5, measurementDate: "2026-06-30", sourceNote: "n", reason: "r" }), /ALREADY_DISTRIBUTED/);
  const rep = R.quarterlyDistribution(db, { period: "2026-Q2" }); assert.equal(rep.rows.length, 4); assert.equal(rep.totals.undistributed, pv.undistributed);
  noErrors(db, "2026-07-01");
});
console.log("ledgers, statements, integrity, storage");
t("statements show actual savings, committed and available; loan statement links both sides; no integrity errors after the whole flow", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); seed(db, "SOB-002", 100000);
  const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 60000); guarantee(db, l.id, "SOB-002", 30000); active(db, l.id);
  LN.repayLoan(db, at("2026-03-01"), l.id, 12000, "2026-03-01");
  const gs = R.guaranteeStatement(db, "SOB-002"); assert.deepEqual([gs.totals.actualSavings, gs.totals.committedToGuarantees, gs.totals.availableBalance], [100000, 18000, 82000]);
  assert.deepEqual([gs.rows[0].guaranteed, gs.rows[0].released, gs.rows[0].stillCommitted], [30000, 12000, 18000]);
  const ms = R.memberStatement(db, "SOB-002"); assert.deepEqual([ms.totals.savings, ms.totals.committed, ms.totals.available], [100000, 18000, 82000]);
  const ls = R.loanStatement(db, l.id, "2026-03-01"); assert.equal(ls.totals.reconciled, true); assert.equal(ls.totals.guaranteeCommitted, 18000);
  assert.equal(R.guarantors(db).totals.committedTotal, 18000); assert.equal(K.dashboard(db, "2026-03-01").loanExposure.guaranteed, 18000);
  noErrors(db, "2026-03-01");
  // damage is detected, never hidden
  db.guarantees[0].releasedAmount = 99; assert(I.check(db, "2026-03-01").findings.some((x) => x.code === "GUARANTEE_RELEASE_MISMATCH"));
  db.guarantees[0].releasedAmount = 12000; G.createEntry(db, at("2026-03-02"), { date: "2026-03-02", memberId: "SOB-002", amount: 82000, type: "Withdraw" }); db.transactions.push({ id: "X", date: "2026-03-03", memberId: "SOB-002", amount: 5000, type: "Withdraw", approvalStatus: "Approved" });
  assert(I.check(db, "2026-03-03").findings.some((x) => x.code === "GUARANTEE_OVERCOMMIT"));
});
t("guarantees, releases, securities and policy survive the Sheet round trip exactly", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); seed(db, "SOB-002", 100000);
  const l = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 100000); guarantee(db, l.id, "SOB-002", 30000); SEC.proposeSecurity(db, at("2026-02-02"), secArgs(l.id)); G.setPolicy(db, at("2026-02-02"), "approval", { requiredTypes: ["Expense"] }, "r");
  const sheets = {}; const mk = () => { const d = []; return { getLastRow: () => d.length, getLastColumn: () => d.reduce((a, r) => Math.max(a, r.length), 0), getRange(r, c, nr, nc) { return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (d[r - 1 + i] || [])[c - 1 + j] ?? "")), setValues: (v) => { if (v.length !== nr || v.some((row) => row.length !== nc)) throw new Error("The number of columns in the data does not match the number of columns in the range. The data has " + (v[0] ? v[0].length : 0) + " but the range has " + nc + "."); v.forEach((row, i) => { d[r - 1 + i] = d[r - 1 + i] || []; row.forEach((x, j) => { d[r - 1 + i][c - 1 + j] = x; }); }); }, clearContent: () => { for (let i = 0; i < nr; i++) d[r - 1 + i] = []; } }; } }; };
  const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mk()) };
  S.writeAll(ss, db); const back = S.readAll(ss);
  assert.deepEqual(back.guarantees[0], JSON.parse(JSON.stringify(db.guarantees[0]))); assert.equal(back.securities[0].documents[0].name, "Land title"); assert.deepEqual(L.getPolicy(back, "approval").requiredTypes, ["Expense"]); assert.equal(L.confirmedAllocation(back), "INTEREST_FIRST");
  assert.equal(L.memberCommitted(back, "SOB-002"), 30000);
});
console.log("\n" + (f ? f + " FAILED, " : "") + pass + " passed");
