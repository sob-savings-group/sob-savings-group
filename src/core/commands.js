/* SOB core/commands — the ONLY ways to change the ledger. A closed whitelist: the server (and the demo UI) run exactly these,
   with a ctx built from the authenticated session, never from anything the client sends. Each command re-checks its permission in core. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./governance.js") : root.SOB.gov, isNode ? require("./loans.js") : root.SOB.loans, isNode ? require("./cycle.js") : root.SOB.cycle, isNode ? require("./reconcile.js") : root.SOB.reconcile);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.commands = api; }
})(typeof self !== "undefined" ? self : this, function (G, LN, C, RC) {
  const COMMANDS = {
    createEntry: (db, ctx, a) => G.createEntry(db, ctx, { date: a.date, memberId: a.memberId, amount: a.amount, type: a.type, purpose: a.purpose, loanId: a.loanId, receipt: a.receipt }),
    voidEntry: (db, ctx, a) => G.voidEntry(db, ctx, a.id, a.reason),
    restoreEntry: (db, ctx, a) => G.restoreEntry(db, ctx, a.id, a.reason),
    approveEntry: (db, ctx, a) => G.approveEntry(db, ctx, a.id, a.decision, a.reason),
    addMember: (db, ctx, a) => G.addMember(db, ctx, { name: a.name, phone: a.phone, email: a.email, location: a.location }),
    applyForLoan: (db, ctx, a) => LN.applyForLoan(db, ctx, a.memberId, a.amount),
    addGuarantee: (db, ctx, a) => LN.addGuarantee(db, ctx, a.loanId, a.guarantorId, a.amount),
    releaseGuarantor: (db, ctx, a) => LN.releaseGuarantor(db, ctx, a.loanId, a.reason),
    approveLoan: (db, ctx, a) => LN.approveLoan(db, ctx, a.loanId, a.note),
    declineLoan: (db, ctx, a) => LN.declineLoan(db, ctx, a.loanId, a.reason),
    disburseLoan: (db, ctx, a) => LN.disburseLoan(db, ctx, a.loanId, { assignedMonthlyInterest: a.assignedMonthlyInterest, graceMonths: a.graceMonths, date: a.date }),
    recordExistingLoan: (db, ctx, a) => LN.recordExistingLoan(db, ctx, { memberId: a.memberId, amount: a.amount, date: a.date, assignedMonthlyInterest: a.assignedMonthlyInterest, graceMonths: a.graceMonths, remarks: a.remarks }),
    repayLoan: (db, ctx, a) => LN.repayLoan(db, ctx, a.loanId, a.amount, a.date),
    editAssignedInterest: (db, ctx, a) => LN.editAssignedInterest(db, ctx, a.loanId, a.amount, a.reason),
    voidLoan: (db, ctx, a) => LN.voidLoan(db, ctx, a.loanId, a.reason),
    restoreLoan: (db, ctx, a) => LN.restoreLoan(db, ctx, a.loanId, a.reason),
    recordSubscription: (db, ctx, a) => C.recordSubscription(db, ctx, a.memberId, a.year, a.date),
    openDiscrepancy: (db, ctx, a) => RC.openDiscrepancy(db, ctx, { kind: a.kind, subject: a.subject, summary: a.summary, platformValue: a.platformValue, sourceValue: a.sourceValue, source: a.source }),
    resolveDiscrepancy: (db, ctx, a) => RC.resolveDiscrepancy(db, ctx, a.id, { decision: a.decision, reason: a.reason, evidence: a.evidence, entry: a.entry }),
    correctLoanDate: (db, ctx, a) => RC.correctLoanDate(db, ctx, a.loanId, a.date, a.reason, a.evidence),
    correctEntryDate: (db, ctx, a) => RC.correctEntryDate(db, ctx, a.id, a.date, a.reason, a.evidence),
    executeShareOut: (db, ctx, a) => C.executeShareOut(db, ctx, a.year, { date: a.date, force: a.force, reason: a.reason })
  };
  function run(db, ctx, name, args) {
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, name)) throw new Error("UNKNOWN_COMMAND: " + name);
    if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) throw new Error("INVALID: args must be an object");
    return COMMANDS[name](db, ctx, args || {});
  }
  return { COMMANDS, names: Object.keys(COMMANDS), run };
});
