const assert = require("assert");
require("../src/core/ledger.js").POLICY_DEFAULTS.loan.guarantorPolicyStart = "2020-01-01";   // these tests exercise the guarantor rules, which SOB starts on 1 Jan 2027 in production
const fs = require("fs");
const dates = require("../src/core/dates.js");
const L = require("../src/core/ledger.js");
const G = require("../src/core/governance.js");
const LN = require("../src/core/loans.js");
const C = require("../src/core/cycle.js");
const K = require("../src/core/kpis.js");
const M = require("../src/core/migrate.js");

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { console.log("FAIL  " + name + "\n      " + e.message); process.exitCode = 1; } };
const throwsMsg = (fn, re) => assert.throws(fn, (e) => re.test(e.message), "expected /" + re + "/");
const admin = { name: "Admin", id: "U1", role: "Admin" };
const committee = { name: "Cathy", id: "U2", role: "Committee" };
const ctxAt = (day, user) => G.makeCtx(user || admin, { today: day, now: day + "T09:00:00.000Z" });
const fresh = () => ({ members: ["A", "B", "C"].map((x, i) => ({ id: "SOB-00" + (i + 1), name: "Member " + x, status: "Active", regDate: "2025-01-01" })), transactions: [], loans: [], guarantees: [], auditLog: [] });
const seed = (db, id, amt, day) => G.createEntry(db, ctxAt(day || "2026-01-05"), { date: day || "2026-01-05", memberId: id, amount: amt, type: "Savings" });
const chair = { name: "Chair", id: "U3", role: "Chairperson" };
const withRules = (fn) => fn();   // the loan rules are now defined (3x guideline + backing); kept as a no-op wrapper for older tests
const guarantee = (db, loanId, gid, amt, day) => { const g = LN.addGuarantee(db, ctxAt(day || "2026-02-02"), loanId, gid, amt); return LN.acceptGuarantee(db, ctxAt(day || "2026-02-02"), g.id, { evidence: "signed form (test)" }); };

console.log("governance");
t("role permissions: Member cannot create ledger entries; Committee safe default is read-only", () => {
  const db = fresh();
  throwsMsg(() => G.createEntry(db, G.makeCtx({ name: "m", role: "Member", memberId: "SOB-001" }), { date: "2026-01-01", memberId: "SOB-001", amount: 5, type: "Savings" }), /FORBIDDEN/);
  throwsMsg(() => G.createEntry(db, G.makeCtx(committee), { date: "2026-01-01", memberId: "SOB-001", amount: 5, type: "Savings" }), /FORBIDDEN/);
});
t("createEntry validates and audits", () => {
  const db = fresh();
  throwsMsg(() => G.createEntry(db, ctxAt("2026-01-05"), { date: "2026-01-05", memberId: "SOB-001", amount: -5, type: "Savings" }), /INVALID/);
  throwsMsg(() => G.createEntry(db, ctxAt("2026-01-05"), { date: "bad", memberId: "SOB-001", amount: 5, type: "Savings" }), /INVALID/);
  throwsMsg(() => G.createEntry(db, ctxAt("2026-01-05"), { date: "2026-01-05", memberId: "NOPE", amount: 5, type: "Savings" }), /UNKNOWN_MEMBER/);
  const e = seed(db, "SOB-001", 1000);
  assert.equal(e.createdBy, "Admin"); assert.equal(db.auditLog.length, 1);
});
t("void/restore needs a reason, is audited, and respects the 48h window", () => {
  const db = fresh(); const e = seed(db, "SOB-001", 1000);
  throwsMsg(() => G.voidEntry(db, ctxAt("2026-01-06"), e.id, ""), /REQUIRED/);
  G.voidEntry(db, ctxAt("2026-01-06"), e.id, "typo"); assert.equal(L.memberSavings(db, "SOB-001"), 0);
  G.restoreEntry(db, ctxAt("2026-01-07"), e.id, "was right"); assert.equal(L.memberSavings(db, "SOB-001"), 1000);
  G.voidEntry(db, ctxAt("2026-01-08"), e.id, "again");
  throwsMsg(() => G.restoreEntry(db, ctxAt("2026-01-11"), e.id, "too late"), /RESTORE_WINDOW_CLOSED/);
  assert(db.auditLog.some((a) => a.action === "Voided" && a.reason === "typo"));
});
t("approval policy: creator cannot approve own entry; pending entries never count", () => {
  const db = fresh(); G.config.approval.requiredTypes = ["Withdraw"];
  try {
    seed(db, "SOB-001", 1000);
    const w = G.createEntry(db, ctxAt("2026-01-06"), { date: "2026-01-06", memberId: "SOB-001", amount: 400, type: "Withdraw" });
    assert.equal(w.approvalStatus, "PendingApproval"); assert.equal(L.memberSavings(db, "SOB-001"), 1000);
    throwsMsg(() => G.approveEntry(db, ctxAt("2026-01-06"), w.id), /FORBIDDEN/);                                  // the Super Admin who inputs can never approve
    throwsMsg(() => G.approveEntry(db, ctxAt("2026-01-06", { name: "Treasurer", id: "U8", role: "Treasurer" }), w.id), /FORBIDDEN/);  // Treasurer reviews only
    G.approveEntry(db, ctxAt("2026-01-06", chair), w.id);
    assert.equal(L.memberSavings(db, "SOB-001"), 600);
  } finally { G.config.approval.requiredTypes = []; }
});

console.log("loan workflow");
t("application requires savings and no outstanding loan; members apply only for themselves", () => {
  const db = fresh();
  throwsMsg(() => LN.applyForLoan(db, ctxAt("2026-02-01"), "SOB-001", 100000), /NO_SAVINGS/);
  seed(db, "SOB-001", 50000);
  throwsMsg(() => LN.applyForLoan(db, G.makeCtx({ name: "x", role: "Member", memberId: "SOB-002" }), "SOB-001", 1000), /FORBIDDEN/);
  const l = LN.applyForLoan(db, G.makeCtx({ name: "m", role: "Member", memberId: "SOB-001" }), "SOB-001", 100000);
  assert.equal(l.status, "Pending");
  throwsMsg(() => LN.applyForLoan(db, ctxAt("2026-02-01"), "SOB-001", 5000), /ALREADY_APPLIED/);
});
t("a Pending loan is not booked: no balance, no exposure", () => {
  const db = fresh(); seed(db, "SOB-001", 50000); LN.applyForLoan(db, ctxAt("2026-02-01"), "SOB-001", 100000);
  assert.equal(L.computeGroupTotals(db, "2026-06-01").loansOutstanding, 0);
});

t("full lifecycle: apply > guarantee (request, accept) > approve > disburse > repay > clear, guarantee released step by step", () => {
  const db = fresh(); seed(db, "SOB-001", 40000); seed(db, "SOB-002", 500000);
  const l = LN.applyForLoan(db, ctxAt("2026-02-01"), "SOB-001", 200000);          // 3x40,000 = 120,000 -> 80,000 needs backing
  throwsMsg(() => LN.approveLoan(db, ctxAt("2026-02-02"), l.id), /NO_BACKING/);
  const g = LN.addGuarantee(db, ctxAt("2026-02-02"), l.id, "SOB-002", 80000);
  assert.equal(LN.committed(db, "SOB-002"), 0, "a request commits nothing until accepted");
  LN.acceptGuarantee(db, ctxAt("2026-02-02"), g.id, { evidence: "signed form" });
  assert.equal(LN.committed(db, "SOB-002"), 80000); assert.equal(L.memberPosition(db, "SOB-002").available, 420000);
  LN.approveLoan(db, ctxAt("2026-02-02"), l.id); assert.equal(l.status, "AwaitingApproval", "the Super Admin only reviews; the Chairperson approves"); LN.approveLoan(db, ctxAt("2026-02-02", chair), l.id);
  throwsMsg(() => LN.repayLoan(db, ctxAt("2026-02-03"), l.id, 1000), /BAD_STATE/);
  throwsMsg(() => LN.disburseLoan(db, ctxAt("2026-02-03"), l.id, {}), /assignedMonthlyInterest/);
  LN.disburseLoan(db, ctxAt("2026-02-03"), l.id, { date: "2026-02-03", assignedMonthlyInterest: 10000, graceMonths: 3 });
  assert.equal(L.loanOutstanding(l, db, "2026-04-30"), 200000);   // within grace
  assert.equal(L.loanOutstanding(l, db, "2026-07-10"), 200000 + 2 * 10000); // Feb->Jul = 5 months - 3 grace
  LN.repayLoan(db, ctxAt("2026-07-10"), l.id, 20000, "2026-07-10");
  assert.equal(l.status, "Active"); assert.equal(L.loanOutstanding(l, db, "2026-07-10"), 200000);
  // the 20,000 paid equals the interest accrued: interest is cleared first, principal is untouched, so NOTHING is released
  assert.equal(LN.committed(db, "SOB-002"), 80000, "interest-only payment releases no guarantee");
  throwsMsg(() => LN.repayLoan(db, ctxAt("2026-07-10"), l.id, 999999, "2026-07-10"), /OVERPAYMENT/);
  LN.repayLoan(db, ctxAt("2026-07-10"), l.id, 200000, "2026-07-10");
  assert.equal(l.status, "Cleared"); assert.equal(l.datePaidFull, "2026-07-10");
  assert.equal(L.loanOutstanding(l, db, "2027-12-31"), 0, "a cleared loan must not accrue again");
  assert.equal(LN.committed(db, "SOB-002"), 0, "guarantee fully released on clearance");
});
t("repayment allocation is FIXED: interest first, then principal; the loan balance reduces by the full payment", () => {
  const db = fresh(); seed(db, "SOB-001", 10000);
  const loan = LN.recordExistingLoan(db, ctxAt("2026-01-01"), { memberId: "SOB-001", amount: 50000, date: "2026-01-01", assignedMonthlyInterest: 5000, graceMonths: 0 });
  LN.repayLoan(db, ctxAt("2026-03-01"), loan.id, 14000, "2026-03-01");               // 10,000 interest accrued -> 10,000 interest + 4,000 principal
  assert.equal(LN.loanView(db, loan, "2026-03-01").repaymentAllocation, "INTEREST_FIRST");
  assert.equal(L.loanOutstanding(loan, db, "2026-03-01"), 50000 + 2 * 5000 - 14000);
  const sp = L.loanRepaymentSplit(loan, db, "2026-03-01"); assert.deepEqual([sp.steps[0].interest, sp.steps[0].principal], [10000, 4000]);
});
t("subscription is group income: cash up, member savings untouched, listed under income", () => {
  const db = fresh(); const before = L.computeGroupTotals(db, "2026-02-01");
  C.recordSubscription(db, ctxAt("2026-02-01"), "SOB-001", 2026);
  assert.equal(L.memberSavings(db, "SOB-001"), 0);
  assert.equal(L.computeGroupTotals(db, "2026-02-01").groupSavings, before.groupSavings);
  assert.equal(L.classifyTransaction(db.transactions[0]).cashflow, 5000);
});
t("decline releases guarantees and needs a reason", () => withRules(() => {
  const db = fresh(); seed(db, "SOB-001", 10000); seed(db, "SOB-002", 90000);
  const l = LN.applyForLoan(db, ctxAt("2026-02-01"), "SOB-001", 20000); guarantee(db, l.id, "SOB-002", 20000);
  assert.equal(LN.committed(db, "SOB-002"), 20000);
  throwsMsg(() => LN.declineLoan(db, ctxAt("2026-02-03"), l.id, ""), /REQUIRED/);
  LN.declineLoan(db, ctxAt("2026-02-03"), l.id, "no"); assert.equal(LN.committed(db, "SOB-002"), 0); assert.equal(l.status, "Declined");
}));
t("existing loans can be recorded (audited, flagged legacy) without the guarantor workflow", () => {
  const db = fresh(); seed(db, "SOB-001", 1000);
  const l = LN.recordExistingLoan(db, ctxAt("2026-01-01"), { memberId: "SOB-001", amount: 200000, date: "2026-01-01", assignedMonthlyInterest: 30000, graceMonths: 3 });
  assert.equal(l.status, "Active"); assert.equal(l.legacy, true);
  assert.equal(L.loanOutstanding(l, db, "2026-06-01"), 200000 + 2 * 30000);
  assert(db.auditLog.some((a) => a.action === "Recorded existing loan"));
});
t("admin interest correction is audited with previous/new value and recalculates", () => {
  const db = fresh(); seed(db, "SOB-001", 1000);
  const l = LN.recordExistingLoan(db, ctxAt("2026-01-01"), { memberId: "SOB-001", amount: 200000, date: "2026-01-01", assignedMonthlyInterest: 60000, graceMonths: 0 });
  throwsMsg(() => LN.editAssignedInterest(db, ctxAt("2026-03-01"), l.id, 6000, ""), /REQUIRED/);
  const before = L.loanPayable(l, "2026-03-01", db);
  LN.editAssignedInterest(db, ctxAt("2026-03-01"), l.id, 6000, "typed 60,000 instead of 6,000");
  assert.equal(L.loanPayable(l, "2026-03-01", db), 200000 + 2 * 6000); assert(before > L.loanPayable(l, "2026-03-01", db));
  const h = l.interestHistory.at(-1); assert.equal(h.previousAmount, 60000); assert.equal(h.newAmount, 6000); assert.equal(h.changedByRole, "Admin");
  assert.equal(l.loanAmount, 200000);
  throwsMsg(() => LN.editAssignedInterest(db, ctxAt("2026-03-01", committee), l.id, 1, "x"), /FORBIDDEN/);
});
t("voiding a loan voids its transactions and releases guarantees; restore within window brings back", () => {
  const db = fresh(); seed(db, "SOB-001", 1000);
  const l = LN.recordExistingLoan(db, ctxAt("2026-01-01"), { memberId: "SOB-001", amount: 50000, date: "2026-01-01", assignedMonthlyInterest: 5000, graceMonths: 0 });
  LN.voidLoan(db, ctxAt("2026-01-02"), l.id, "entered twice");
  assert.equal(L.computeGroupTotals(db, "2026-03-01").loansOutstanding, 0);
  LN.restoreLoan(db, ctxAt("2026-01-03"), l.id, "valid after all");
  assert.equal(L.computeGroupTotals(db, "2026-01-03").loansOutstanding, 50000);
});

console.log("subscriptions, year cycle, share-out");
t("annual subscription is UGX 5,000, once per member per year, with compliance view", () => {
  const db = fresh(); C.recordSubscription(db, ctxAt("2026-01-10"), "SOB-001", 2026);
  throwsMsg(() => C.recordSubscription(db, ctxAt("2026-01-11"), "SOB-001", 2026), /ALREADY_PAID/);
  C.recordSubscription(db, ctxAt("2027-01-10"), "SOB-001", 2027);
  const c = C.subscriptionCompliance(db, 2026);
  assert.equal(c.collected, 5000); assert.equal(c.unpaid.length, 2); assert.equal(c.expected, 15000);
  assert.equal(L.memberSavings(db, "SOB-001"), 0, "subscription does not touch savings");
});
t("share-out preview: loan holders may withdraw savings but are not profit-eligible (confirmed)", () => {
  const db = fresh(); seed(db, "SOB-001", 100000); seed(db, "SOB-002", 200000);
  LN.recordExistingLoan(db, ctxAt("2026-01-01"), { memberId: "SOB-002", amount: 50000, date: "2026-01-01", assignedMonthlyInterest: 5000, graceMonths: 3 });
  const p = C.previewShareOut(db, 2026, "2026-12-10");
  assert.equal(p.rows.find((r) => r.memberId === "SOB-001").savingsAction, "WITHDRAW_FULL");
  const b = p.rows.find((r) => r.memberId === "SOB-002"); assert.equal(b.eligibleForProfit, false); assert.equal(b.savingsAction, "WITHDRAW_FULL"); assert.equal(b.outstandingLoan > 0, true);
  assert.equal(p.rows.every((r) => r.committed === 0 && r.withdraw === r.savings), true);
});
t("share-out execution: loan holders withdraw too (loan stays payable), closes the year and opens the next WITHOUT deleting history", () => {
  const db = fresh(); seed(db, "SOB-001", 100000, "2026-03-01"); seed(db, "SOB-002", 200000, "2026-03-01"); seed(db, "SOB-003", 7000, "2026-03-01");
  LN.recordExistingLoan(db, ctxAt("2026-01-01"), { memberId: "SOB-002", amount: 50000, date: "2026-01-01", assignedMonthlyInterest: 5000, graceMonths: 3 });
  throwsMsg(() => C.executeShareOut(db, ctxAt("2026-06-10"), 2026, { date: "2026-06-10" }), /OUTSIDE_DECEMBER/);
  throwsMsg(() => C.executeShareOut(db, ctxAt("2026-12-10", committee), 2026, { date: "2026-12-10" }), /FORBIDDEN/);
  const before = db.transactions.length, hist = L.memberLifetimeHistory(db, "SOB-001").length;
  const ev = C.executeShareOut(db, ctxAt("2026-12-10"), 2026, { date: "2026-12-10" });
  assert.equal(ev.totalWithdrawn, 307000);
  assert.equal(L.memberSavings(db, "SOB-001"), 0); assert.equal(L.memberSavings(db, "SOB-002"), 0, "loan holder withdrew savings"); assert.ok(L.loanOutstanding(db.loans[0], db, "2026-12-10") > 0, "their loan is still payable"); assert.deepEqual(ev.loanHolders, ["SOB-002"]);
  assert.equal(db.transactions.length, before + 3, "only Share-Out entries were added; nothing deleted");
  assert.equal(L.memberLifetimeHistory(db, "SOB-001").length, hist + 1, "lifetime history intact + the withdrawal");
  assert.equal(db.yearCycles.find((c) => c.year === 2026).status, "Closed"); assert.equal(db.yearCycles.find((c) => c.year === 2027).status, "Open");
  throwsMsg(() => C.executeShareOut(db, ctxAt("2026-12-11"), 2026, { date: "2026-12-11" }), /YEAR_CLOSED|ALREADY_EXECUTED/);
  seed(db, "SOB-001", 5000, "2027-01-15"); assert.equal(L.memberSavings(db, "SOB-001"), 5000, "next cycle starts clean");
  assert.equal(L.memberLifetimeHistory(db, "SOB-001", { year: 2026 }).length, 2);
});
t("profit distribution needs a pool, a date and a source note; posting is Admin-only", () => {
  const db = fresh(); seed(db, "SOB-001", 100000); seed(db, "SOB-002", 300000);
  const PR = require("../src/core/profit.js");
  throwsMsg(() => C.distributeProfit(db, ctxAt("2026-12-10"), { period: "2026-Q4" }), /CYCLE_NOT_SET/);
  throwsMsg(() => PR.setCycle(db, ctxAt("2026-12-10"), { period: "2026-Q4", measurementDate: "2026-12-10", pool: 0, sourceNote: "x", reason: "r" }), /INVALID/);
  throwsMsg(() => PR.setCycle(db, ctxAt("2026-12-10", chair), { period: "2026-Q4", measurementDate: "2026-12-10", pool: 4000, sourceNote: "x", reason: "r" }), /FORBIDDEN/);
  PR.setCycle(db, ctxAt("2026-12-10"), { period: "2026-Q4", measurementDate: "2026-12-10", pool: 4000, sourceNote: "loan interest received Q4", reason: "SOB minute (test)" });
  throwsMsg(() => C.distributeProfit(db, ctxAt("2026-12-10", chair), { period: "2026-Q4" }), /FORBIDDEN/);
  const r = C.distributeProfit(db, ctxAt("2026-12-10"), { period: "2026-Q4" });
  assert.equal(r.rows.find((x) => x.memberId === "SOB-001").entitlement, 1000); assert.equal(r.rows.find((x) => x.memberId === "SOB-002").entitlement, 3000);
});

console.log("dashboard KPIs and migration");
t("KPIs derive from the ledger and agree with each other", () => {
  const db = fresh(); seed(db, "SOB-001", 100000); seed(db, "SOB-002", 300000);
  LN.recordExistingLoan(db, ctxAt("2026-01-01"), { memberId: "SOB-001", amount: 80000, date: "2026-01-01", assignedMonthlyInterest: 8000, graceMonths: 0 });
  G.createEntry(db, ctxAt("2026-02-01"), { date: "2026-02-01", amount: 2000, type: "Expense", purpose: "stationery" });
  const k = K.dashboard(db, "2026-03-01", { year: 2026 });
  assert.equal(k.totalSavings.value, 400000); assert.equal(k.outstandingLoans.value, 80000 + 2 * 8000);
  assert.equal(k.availableCash.value, 400000 - 80000 - 2000); assert.equal(k.expenses.value, 2000); assert.equal(k.interestReceivable.value, 2 * 8000);
  assert.equal(k.members.value, 3); assert.equal(k.loanExposure.pct, 24);
  assert.equal(K.loanBook(db, "2026-03-01")[0].balance, k.outstandingLoans.value);
});
t("migration of the real data set is verified figure-for-figure and non-destructive", () => {
  const raw = require("./helpers/synth.js").legacyRaw();
  const snapshot = JSON.stringify(raw);
  const db = M.migrateLegacy(raw, "2026-10-06"); const v = M.verifyMigration(raw, db, "2026-10-06");
  assert(v.pass, JSON.stringify(v.checks.filter((c) => !c.pass)));
  assert.equal(JSON.stringify(raw), snapshot, "input untouched");
  assert.equal(db.legacyAdministration.length, raw.ledger.length);
  assert.equal(db.yearCycles[0].status, "Open"); assert(db.auditLog.some((a) => a.id === "AUD-MIGRATION"));
  assert(db.loans.every((l) => l.assignedMonthlyInterest > 0 && l.status === "Active" && l.legacy));
  assert.equal(M.migrateLegacy(M.migrateLegacy(raw, "2026-10-06").transactions && raw, "2026-10-06").loans.length, 10);
});
console.log("\n" + pass + " passed");
