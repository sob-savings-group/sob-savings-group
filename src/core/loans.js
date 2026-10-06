/* SOB core/loans — application -> review -> approval/decline -> disbursement -> repayment -> clearance/reversal,
   plus guarantor exposure. Interest is assigned per loan by Admin (assignedMonthlyInterest); SOB has no standard rate.
   Rules awaiting SOB (qualifying savings, guarantor sufficiency) are read from ledger.CONFIG_PENDING and BLOCK, never guessed. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./governance.js") : root.SOB.gov);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.loans = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, G) {
  const LIVE_GUARANTEE = (g) => g.status === "Active";
  const getLoan = (db, id) => { const l = db.loans.find((x) => x.id === id); if (!l) throw new Error("NOT_FOUND: loan " + id); return l; };
  const stateMust = (loan, ...ok) => { if (!ok.includes(loan.status)) throw new Error("BAD_STATE: loan is " + loan.status + ", needs " + ok.join("/")); };

  /* --- guarantor exposure --- */
  const committed = (db, guarantorId) =>
    (db.guarantees || []).filter((g) => g.guarantorId === guarantorId && LIVE_GUARANTEE(g)).reduce((a, g) => a + g.amount, 0);
  const loanCover = (db, loanId) =>
    (db.guarantees || []).filter((g) => g.loanId === loanId && LIVE_GUARANTEE(g)).reduce((a, g) => a + g.amount, 0);
  function qualifyingSavings(db, memberId) {
    if (!L.CONFIG_PENDING.qualifyingSavingsRule) throw new Error("PENDING_SOB_DECISION: qualifying-savings definition (Open Q2)");
    return L.CONFIG_PENDING.qualifyingSavingsRule(db, memberId);
  }
  function guarantorAvailable(db, guarantorId) {
    if (!L.CONFIG_PENDING.guarantorSufficiencyRule) throw new Error("PENDING_SOB_DECISION: guarantor sufficiency rule (Open Q3)");
    return L.CONFIG_PENDING.guarantorSufficiencyRule({ qualifying: qualifyingSavings(db, guarantorId), committed: committed(db, guarantorId) });
  }
  function exposureReport(db) {
    return db.members.map((m) => ({ memberId: m.id, name: m.name, committed: committed(db, m.id),
      guarantees: (db.guarantees || []).filter((g) => g.guarantorId === m.id && LIVE_GUARANTEE(g)).length }))
      .filter((r) => r.committed > 0);
  }
  function addGuarantee(db, ctx, loanId, guarantorId, amount) {
    G.require(ctx, "guarantee.manage");
    const loan = getLoan(db, loanId); stateMust(loan, "Pending", "Approved");
    amount = Number(amount); if (!(amount > 0)) throw new Error("INVALID: guarantee amount");
    if (guarantorId === loan.memberId) throw new Error("INVALID: a member cannot guarantee their own loan");
    if (!db.members.some((m) => m.id === guarantorId)) throw new Error("UNKNOWN_MEMBER: " + guarantorId);
    if (amount > guarantorAvailable(db, guarantorId)) throw new Error("INSUFFICIENT_GUARANTOR: requested " + amount + " exceeds available capacity");
    const g = { id: G.uid("GUA"), loanId, guarantorId, amount, status: "Active", dateCommitted: ctx.today, committedBy: ctx.by };
    (db.guarantees = db.guarantees || []).push(g);
    G.audit(db, ctx, "Guarantee", g.id, "Committed", null, { loanId, guarantorId, amount });
    return g;
  }
  function releaseGuarantees(db, ctx, loanId, why) {
    (db.guarantees || []).filter((g) => g.loanId === loanId && LIVE_GUARANTEE(g)).forEach((g) => {
      g.status = "Released"; g.dateReleased = ctx.today; g.releaseReason = why;
      G.audit(db, ctx, "Guarantee", g.id, "Released", { status: "Active" }, { status: "Released" }, why);
    });
  }

  /* --- workflow --- */
  function applyForLoan(db, ctx, memberId, amount) {
    G.require(ctx, "loan.apply");
    if (ctx.role === "Member" && ctx.memberId !== memberId) throw new Error("FORBIDDEN: members apply only for themselves");
    if (!db.members.some((m) => m.id === memberId)) throw new Error("UNKNOWN_MEMBER: " + memberId);
    amount = Number(amount); if (!(amount > 0)) throw new Error("INVALID: amount");
    if (!(L.memberSavings(db, memberId) > 0)) throw new Error("NO_SAVINGS: a member must have savings before applying");
    if (L.memberHasOutstandingLoan(db, memberId)) throw new Error("HAS_OUTSTANDING_LOAN: clear the existing loan first");
    if ((db.loans || []).some((l) => l.memberId === memberId && !l.voided && ["Pending", "Approved"].includes(l.status))) throw new Error("ALREADY_APPLIED");
    const loan = { id: G.uid("LOAN"), memberId, memberName: db.members.find((m) => m.id === memberId).name, loanAmount: amount, status: "Pending",
      applicationDate: ctx.today, appliedBy: ctx.by, graceMonths: 3 };
    db.loans.push(loan);
    G.audit(db, ctx, "Loan", loan.id, "Applied", null, { memberId, amount });
    return loan;
  }
  function approveLoan(db, ctx, loanId, note) {
    G.require(ctx, "loan.review");
    const loan = getLoan(db, loanId); stateMust(loan, "Pending");
    const q = L.loanEligibility(db, loan.memberId); // throws PENDING_SOB_DECISION until SOB defines qualifying savings
    if (loan.loanAmount > q.maxLoan) throw new Error("OVER_LIMIT: " + loan.loanAmount + " exceeds 3x qualifying savings (" + q.maxLoan + ")");
    if (loanCover(db, loanId) < loan.loanAmount) throw new Error("NO_GUARANTOR_COVER: every loan needs guarantor backing for the full amount");
    Object.assign(loan, { status: "Approved", approvedBy: ctx.by, approvedDate: ctx.today });
    G.audit(db, ctx, "Loan", loanId, "Approved", { status: "Pending" }, { status: "Approved" }, note);
    return loan;
  }
  function declineLoan(db, ctx, loanId, reason) {
    G.require(ctx, "loan.review"); G.need(reason, "reason");
    const loan = getLoan(db, loanId); stateMust(loan, "Pending", "Approved");
    Object.assign(loan, { status: "Declined", declinedBy: ctx.by, declinedDate: ctx.today, declineReason: reason });
    releaseGuarantees(db, ctx, loanId, "Loan declined");
    G.audit(db, ctx, "Loan", loanId, "Declined", null, { status: "Declined" }, reason);
    return loan;
  }
  function disburse(db, ctx, loan, o, txnNote) {
    const rate = Number(o.assignedMonthlyInterest);
    if (o.assignedMonthlyInterest === undefined || o.assignedMonthlyInterest === "" || !(rate >= 0)) throw new Error("REQUIRED: assignedMonthlyInterest (Admin must assign interest for this loan)");
    const date = o.date || ctx.today; if (!dates.isISO(date)) throw new Error("INVALID: date");
    const grace = o.graceMonths === undefined ? (loan.graceMonths ?? 3) : Number(o.graceMonths);
    Object.assign(loan, { status: "Active", date, assignedMonthlyInterest: rate, graceMonths: grace, dueDate: dates.addMonths(date, grace),
      disbursedBy: ctx.by, interestHistory: [{ date: ctx.today, timestamp: ctx.now, previousAmount: null, newAmount: rate, reason: "Initial assignment at disbursement", changedByRole: ctx.role, changedBy: ctx.by }] });
    G.createEntry(db, ctx, { date, memberId: loan.memberId, amount: loan.loanAmount, type: "Loan Disbursement", purpose: txnNote, loanId: loan.id });
    G.audit(db, ctx, "Loan", loan.id, "Disbursed", null, { amount: loan.loanAmount, assignedMonthlyInterest: rate, date });
    return loan;
  }
  function disburseLoan(db, ctx, loanId, o) {
    G.require(ctx, "loan.disburse");
    const loan = getLoan(db, loanId); stateMust(loan, "Approved");
    return disburse(db, ctx, loan, o || {}, "Loan Disbursement");
  }
  /* Existing, already-approved loans (pre-workflow) are recorded without re-running the application steps. Always audited. */
  function recordExistingLoan(db, ctx, o) {
    G.require(ctx, "loan.disburse");
    const m = db.members.find((x) => x.id === o.memberId); if (!m) throw new Error("UNKNOWN_MEMBER: " + o.memberId);
    const amount = Number(o.amount); if (!(amount > 0)) throw new Error("INVALID: amount");
    const loan = { id: G.uid("LOAN"), memberId: m.id, memberName: m.name, loanAmount: amount, status: "Approved", legacy: true, approvedBy: ctx.by, approvedDate: ctx.today, remarks: o.remarks || "Existing loan recorded outside the application workflow" };
    db.loans.push(loan);
    G.audit(db, ctx, "Loan", loan.id, "Recorded existing loan", null, { memberId: m.id, amount }, "Legacy loan: guarantor workflow not applied");
    return disburse(db, ctx, loan, o, "Loan Disbursement (existing loan)");
  }
  function repayLoan(db, ctx, loanId, amount, date) {
    G.require(ctx, "loan.repay");
    const loan = getLoan(db, loanId); stateMust(loan, "Active");
    date = date || ctx.today; amount = Number(amount);
    if (!(amount > 0)) throw new Error("INVALID: amount");
    const owing = L.loanOutstanding(loan, db, date);
    if (amount > owing) throw new Error("OVERPAYMENT: outstanding on " + date + " is " + owing);
    G.createEntry(db, ctx, { date, memberId: loan.memberId, amount, type: "Loan Repayment", purpose: "Loan Repayment", loanId });
    if (L.loanOutstanding(loan, db, date) <= 0) {
      Object.assign(loan, { status: "Cleared", datePaidFull: date, clearedBy: ctx.by });
      releaseGuarantees(db, ctx, loanId, "Loan cleared");
      G.audit(db, ctx, "Loan", loanId, "Cleared", { status: "Active" }, { status: "Cleared" }, "Fully repaid");
    }
    return loan;
  }
  function editAssignedInterest(db, ctx, loanId, newAmount, reason) {
    G.require(ctx, "loan.editInterest"); G.need(reason, "reason");
    const loan = getLoan(db, loanId); stateMust(loan, "Active");
    newAmount = Number(newAmount); if (!(newAmount >= 0)) throw new Error("INVALID: interest amount");
    const prev = loan.assignedMonthlyInterest;
    (loan.interestHistory = loan.interestHistory || []).push({ date: ctx.today, timestamp: ctx.now, previousAmount: prev, newAmount, reason, changedByRole: ctx.role, changedBy: ctx.by });
    loan.assignedMonthlyInterest = newAmount;
    G.audit(db, ctx, "Loan", loanId, "Assigned interest corrected", { assignedMonthlyInterest: prev }, { assignedMonthlyInterest: newAmount }, reason);
    return loan;
  }
  function voidLoan(db, ctx, loanId, reason) {
    G.require(ctx, "loan.reverse"); G.need(reason, "reason");
    const loan = getLoan(db, loanId); if (loan.voided) throw new Error("ALREADY_VOIDED");
    Object.assign(loan, { voided: true, voidReason: reason, voidDate: ctx.today, voidTimestamp: ctx.now, voidedByRole: ctx.role, voidedBy: ctx.by });
    db.transactions.filter((t) => t.loanId === loanId && !t.voided).forEach((t) =>
      Object.assign(t, { voided: true, voidReason: "Voided with loan: " + reason, voidDate: ctx.today, voidTimestamp: ctx.now, voidedByRole: ctx.role, voidedBy: ctx.by, voidedWithLoan: true }));
    releaseGuarantees(db, ctx, loanId, "Loan voided");
    G.audit(db, ctx, "Loan", loanId, "Voided", { voided: false }, { voided: true }, reason);
    return loan;
  }
  function restoreLoan(db, ctx, loanId, reason) {
    G.require(ctx, "ledger.restore"); G.need(reason, "reason");
    const loan = getLoan(db, loanId); if (!loan.voided) throw new Error("NOT_VOIDED");
    if (!L.withinRestoreWindow(loan, new Date(ctx.now).getTime())) throw new Error("RESTORE_WINDOW_CLOSED");
    Object.assign(loan, { voided: false, restoredReason: reason, restoredDate: ctx.today, restoredTimestamp: ctx.now, restoredByRole: ctx.role, restoredBy: ctx.by });
    db.transactions.filter((t) => t.loanId === loanId && t.voidedWithLoan).forEach((t) => { t.voided = false; t.voidedWithLoan = false; t.restoredReason = reason; t.restoredDate = ctx.today; });
    // Guarantees released by the void are NOT silently re-committed: Admin must re-confirm capacity.
    G.audit(db, ctx, "Loan", loanId, "Restored", { voided: true }, { voided: false }, reason);
    return loan;
  }
  /* Everything the "drill-down" cards need about one loan, from the same engine. */
  function loanView(db, loan, asOf) {
    return { id: loan.id, status: loan.status, principal: Number(loan.loanAmount), assignedMonthlyInterest: Number(loan.assignedMonthlyInterest) || 0,
      unpaidMonths: L.loanMonthsAfterGrace(loan, asOf), accumulatedInterest: L.loanAccumulatedInterest(loan, asOf),
      penalties: L.loanTotalPenalties(loan, db), payable: L.loanPayable(loan, asOf, db), repaid: L.loanTotalRepaid(loan, db),
      balance: L.loanOutstanding(loan, db, asOf), guaranteed: loanCover(db, loan.id), interestHistory: loan.interestHistory || [] };
  }
  return { committed, loanCover, qualifyingSavings, guarantorAvailable, exposureReport, addGuarantee, releaseGuarantees, applyForLoan, approveLoan,
    declineLoan, disburseLoan, recordExistingLoan, repayLoan, editAssignedInterest, voidLoan, restoreLoan, loanView };
});
