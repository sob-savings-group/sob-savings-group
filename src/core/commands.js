/* SOB core/commands — the ONLY ways to change the ledger. A closed whitelist: the server (and the demo UI) run exactly these,
   with a ctx built from the authenticated session, never from anything the client sends. Each command re-checks its permission in core. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./governance.js") : root.SOB.gov, isNode ? require("./loans.js") : root.SOB.loans, isNode ? require("./cycle.js") : root.SOB.cycle, isNode ? require("./reconcile.js") : root.SOB.reconcile, isNode ? require("./notify.js") : root.SOB.notify, isNode ? require("./airtime.js") : root.SOB.airtime, isNode ? require("./history.js") : root.SOB.history, isNode ? require("./security.js") : root.SOB.security, isNode ? require("./profit.js") : root.SOB.profit);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.commands = api; }
})(typeof self !== "undefined" ? self : this, function (G, LN, C, RC, N, AT, H, SEC, PR) {
  const COMMANDS = {
    createEntry: (db, ctx, a) => G.createEntry(db, ctx, { date: a.date, memberId: a.memberId, amount: a.amount, type: a.type, purpose: a.purpose, loanId: a.loanId, receipt: a.receipt }),
    voidEntry: (db, ctx, a) => { const t = G.voidEntry(db, ctx, a.id, a.reason); LN.onRepaymentRemoved(db, ctx, t, a.reason); return t; },          // a voided repayment re-commits what it released
    restoreEntry: (db, ctx, a) => { const t = G.restoreEntry(db, ctx, a.id, a.reason); if (t.approvalStatus === "Approved") LN.onRepaymentCounted(db, ctx, t); return t; },
    approveEntry: (db, ctx, a) => { const t = G.approveEntry(db, ctx, a.id, a.decision, a.reason); if (t.approvalStatus === "Approved") LN.onRepaymentCounted(db, ctx, t); return t; },
    addMember: (db, ctx, a) => G.addMember(db, ctx, { id: a.id, regDate: a.regDate, name: a.name, phone: a.phone, email: a.email, location: a.location }),
    applyForLoan: (db, ctx, a) => LN.applyForLoan(db, ctx, a.memberId, a.amount),
    addGuarantee: (db, ctx, a) => LN.addGuarantee(db, ctx, a.loanId, a.guarantorId, a.amount),
    acceptGuarantee: (db, ctx, a) => LN.acceptGuarantee(db, ctx, a.id, { evidence: a.evidence }),
    declineGuarantee: (db, ctx, a) => LN.declineGuarantee(db, ctx, a.id, a.reason),
    releaseGuarantor: (db, ctx, a) => LN.releaseGuarantor(db, ctx, a.loanId, a.reason, a.guaranteeId),
    proposeSecurity: (db, ctx, a) => SEC.proposeSecurity(db, ctx, { loanId: a.loanId, kind: a.kind, description: a.description, owner: a.owner, valuation: a.valuation, valuationDate: a.valuationDate, valuedBy: a.valuedBy, documents: a.documents }),
    addSecurityDocument: (db, ctx, a) => SEC.addSecurityDocument(db, ctx, a.id, { name: a.name, reference: a.reference, note: a.note }),
    decideSecurity: (db, ctx, a) => SEC.decideSecurity(db, ctx, a.id, a.decision, { reason: a.reason, acceptedCover: a.acceptedCover }),
    releaseSecurity: (db, ctx, a) => SEC.releaseSecurity(db, ctx, a.id, a.reason),
    setPolicy: (db, ctx, a) => { const r = G.setPolicy(db, ctx, a.key, a.values, a.reason); if (a.key === "loan") LN.syncAllReleases(db, ctx); return r; },
    setProfitCycle: (db, ctx, a) => PR.setCycle(db, ctx, { period: a.period, pool: a.pool, measurementDate: a.measurementDate, sourceNote: a.sourceNote, reason: a.reason }),
    previewProfit: (db, ctx, a) => { G.require(ctx, "profit.distribute"); return PR.preview(db, a); },
    distributeProfit: (db, ctx, a) => PR.distribute(db, ctx, { period: a.period, factorValues: a.factorValues }),
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
    executeShareOut: (db, ctx, a) => C.executeShareOut(db, ctx, a.year, { date: a.date, force: a.force, reason: a.reason }),
    requestAirtime: (db, ctx, a) => AT.request(db, ctx, { memberId: a.memberId, amount: a.amount, phone: a.phone }),
    fulfilAirtime: (db, ctx, a) => AT.fulfil(db, ctx, a.id),
    rejectAirtime: (db, ctx, a) => AT.reject(db, ctx, a.id, a.reason),
    cancelAirtime: (db, ctx, a) => AT.cancel(db, ctx, a.id),
    sendMessage: (db, ctx, a) => N.send(db, ctx, { memberId: a.memberId, text: a.text, channel: a.channel }),
    cancelMessage: (db, ctx, a) => N.cancel(db, ctx, a.id, a.reason),
    importHistoricalEntries: (db, ctx, a) => H.importHistoricalEntries(db, ctx, { batchId: a.batchId, source: a.source, entries: a.entries, dryRun: a.dryRun }),
    setNotifyOptOut: (db, ctx, a) => N.setOptOut(db, ctx, a.memberId, !!a.optOut, a.reason)
  };
  function run(db, ctx, name, args) {
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, name)) throw new Error("UNKNOWN_COMMAND: " + name);
    if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) throw new Error("INVALID: args must be an object");
    const result = COMMANDS[name](db, ctx, args || {});
    N.onCommand(db, ctx, name, args || {}, result);   // best-effort outbox notices; never blocks the command
    return result;
  }
  return { COMMANDS, names: Object.keys(COMMANDS), run };
});
