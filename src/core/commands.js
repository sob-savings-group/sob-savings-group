/* SOB core/commands — the ONLY ways to change the ledger. A closed whitelist: the server (and the demo UI) run exactly these,
   with a ctx built from the authenticated session, never from anything the client sends. Each command re-checks its permission in core. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./governance.js") : root.SOB.gov, isNode ? require("./loans.js") : root.SOB.loans, isNode ? require("./cycle.js") : root.SOB.cycle, isNode ? require("./reconcile.js") : root.SOB.reconcile, isNode ? require("./notify.js") : root.SOB.notify, isNode ? require("./airtime.js") : root.SOB.airtime, isNode ? require("./history.js") : root.SOB.history, isNode ? require("./security.js") : root.SOB.security, isNode ? require("./profit.js") : root.SOB.profit, isNode ? require("./histloans.js") : root.SOB.histloans, isNode ? require("./fy.js") : root.SOB.fy, isNode ? require("./reserve.js") : root.SOB.reserve, isNode ? require("./profitrec.js") : root.SOB.profitrec);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.commands = api; }
})(typeof self !== "undefined" ? self : this, function (G, LN, C, RC, N, AT, H, SEC, PR, HL, FYR, RSV, PRC) {
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
    openDiscrepancy: (db, ctx, a) => RC.openDiscrepancy(db, ctx, { kind: a.kind, subject: a.subject, summary: a.summary, platformValue: a.platformValue, sourceValue: a.sourceValue, source: a.source, detail: a.detail }),
    /* Batched forms used by the installer so a first load fits Google's six-minute limit: one read and one write for many items. Never gated, so ACCEPT_SOURCE_WITH_ENTRY (which posts an entry) is refused here. */
    openDiscrepancies: (db, ctx, a) => { const items = Array.isArray(a.items) ? a.items : []; if (items.length > 60) throw new Error("INVALID: at most 60 items per batch"); const out = { opened: 0, kept: 0 };
      items.forEach((d) => { if ((db.discrepancies || []).some((x) => x.subject === d.subject && x.kind === d.kind)) { out.kept++; return; } COMMANDS.openDiscrepancy(db, ctx, d); out.opened++; }); return out; },
    resolveDiscrepancies: (db, ctx, a) => { const items = Array.isArray(a.items) ? a.items : []; if (items.length > 60) throw new Error("INVALID: at most 60 items per batch"); const out = { resolved: 0, skipped: 0 };
      items.forEach((r) => { if (r.decision === "ACCEPT_SOURCE_WITH_ENTRY") throw new Error("INVALID: a resolution that posts an entry needs its own approval"); const it = (db.discrepancies || []).find((x) => x.subject === r.subject && x.status === "Open"); if (!it) { out.skipped++; return; }
        RC.resolveDiscrepancy(db, ctx, it.id, { decision: r.decision, reason: r.reason, evidence: r.evidence }); out.resolved++; }); return out; },
    resolveDiscrepancy: (db, ctx, a) => RC.resolveDiscrepancy(db, ctx, a.id, { decision: a.decision, reason: a.reason, evidence: a.evidence, entry: a.entry }),
    correctLoanDate: (db, ctx, a) => RC.correctLoanDate(db, ctx, a.loanId, a.date, a.reason, a.evidence),
    markLoanDateUnknown: (db, ctx, a) => RC.markLoanDateUnknown(db, ctx, a.loanId, a.reason, a.evidence),
    recordLoanComponents: (db, ctx, a) => RC.recordLoanComponents(db, ctx, a.loanId, a.components, a.reason, a.evidence),
    correctEntryDate: (db, ctx, a) => RC.correctEntryDate(db, ctx, a.id, a.date, a.reason, a.evidence),
    executeShareOut: (db, ctx, a) => C.executeShareOut(db, ctx, a.year, { date: a.date, force: a.force, reason: a.reason }),
    requestAirtime: (db, ctx, a) => AT.request(db, ctx, { memberId: a.memberId, amount: a.amount, phone: a.phone }),
    fulfilAirtime: (db, ctx, a) => AT.fulfil(db, ctx, a.id),
    rejectAirtime: (db, ctx, a) => AT.reject(db, ctx, a.id, a.reason),
    cancelAirtime: (db, ctx, a) => AT.cancel(db, ctx, a.id),
    sendMessage: (db, ctx, a) => N.send(db, ctx, { memberId: a.memberId, text: a.text, channel: a.channel }),
    cancelMessage: (db, ctx, a) => N.cancel(db, ctx, a.id, a.reason),
    importHistoricalEntries: (db, ctx, a) => H.importHistoricalEntries(db, ctx, { batchId: a.batchId, source: a.source, entries: a.entries || [], annotations: a.annotations, dryRun: a.dryRun }),
    importHistoricalLoans: (db, ctx, a) => HL.importHistoricalLoans(db, ctx, { batchId: a.batchId, source: a.source, accounts: a.accounts || [], events: a.events || [], dryRun: a.dryRun }),
    defineFinancialYears: (db, ctx, a) => FYR.defineFinancialYears(db, ctx, { years: a.years }),
    confirmFYProfit: (db, ctx, a) => RSV.confirmProfit(db, ctx, { year: a.year, amount: a.amount, evidence: a.evidence, reason: a.reason }),
    offsetHistoricalLoan: (db, ctx, a) => HL.offsetHistoricalLoan(db, ctx, { loanId: a.loanId, amount: a.amount, date: a.date, evidence: a.evidence, reason: a.reason }),
    writeOffHistoricalLoan: (db, ctx, a) => PRC.writeOff(db, ctx, { loanId: a.loanId, principal: a.principal, interest: a.interest, date: a.date, lossYear: a.lossYear, evidence: a.evidence, reason: a.reason }),
    settleFinancialYear: (db, ctx, a) => PRC.settle(db, ctx, { year: a.year, expectedResult: a.expectedResult, evidence: a.evidence, reason: a.reason }),
    openReserve: (db, ctx, a) => RSV.openReserve(db, ctx, { date: a.date, amount: a.amount, evidence: a.evidence, reason: a.reason }),
    transferToReserve: (db, ctx, a) => RSV.transferToReserve(db, ctx, { date: a.date, year: a.year, amount: a.amount, evidence: a.evidence, reason: a.reason }),
    utilizeReserve: (db, ctx, a) => RSV.utilizeReserve(db, ctx, { date: a.date, amount: a.amount, purpose: a.purpose, evidence: a.evidence, reason: a.reason }),
    setNotifyOptOut: (db, ctx, a) => N.setOptOut(db, ctx, a.memberId, !!a.optOut, a.reason)
  };
  /* FINAL SOB rule: material or exceptional financial actions are INITIATED by the Super Admin but only take effect when a DIFFERENT person, the Chairperson, approves.
     (New loan approval and exceptional security have their own two-step flows in loans.js / security.js; ledger entry types the Chairperson must also approve are
     handled in governance.createEntry.) The Super Admin cannot bypass this: the command is NOT executed, it is stored as a request with its arguments and the
     result of a trial run, and approveRequest alone (Chairperson only, never the requester) executes it. Routine savings deposits and loan repayments are not gated. */
  const GATED = {
    voidEntry: { perm: "ledger.void", label: "Void a transaction" }, restoreEntry: { perm: "ledger.restore", label: "Restore a voided transaction" },
    voidLoan: { perm: "loan.reverse", label: "Void a loan" }, restoreLoan: { perm: "ledger.restore", label: "Restore a voided loan" },
    editAssignedInterest: { perm: "loan.editInterest", label: "Change a loan's assigned interest" }, correctLoanDate: { perm: "reconcile.manage", label: "Correct a loan's start date" },
    offsetHistoricalLoan: { perm: "reconcile.manage", label: "Offset a member's savings against a historical loan" }, writeOffHistoricalLoan: { perm: "reserve.manage", label: "Write off an uncollectible historical loan balance" },
    markLoanDateUnknown: { perm: "reconcile.manage", label: "Mark a loan's start date as not established" }, recordLoanComponents: { perm: "reconcile.manage", label: "Record the component disbursements of a consolidated loan" },
    correctEntryDate: { perm: "reconcile.manage", label: "Correct a transaction's date" },
    resolveDiscrepancy: { perm: "reconcile.manage", label: "Resolve a reconciliation item", when: (a) => a && a.decision === "ACCEPT_SOURCE_WITH_ENTRY" },
    confirmFYProfit: { perm: "reserve.manage", label: "Verify a financial year's group profit" }, settleFinancialYear: { perm: "reserve.manage", label: "Settle a completed financial year into the General Reserve Fund" }, openReserve: { perm: "reserve.manage", label: "Record the General Reserve Fund opening balance" },
    transferToReserve: { perm: "reserve.manage", label: "Transfer unallocated profit to the General Reserve Fund" }, utilizeReserve: { perm: "reserve.manage", label: "Use money from the General Reserve Fund" },
    distributeProfit: { perm: "profit.distribute", label: "Post the final profit distribution" }, executeShareOut: { perm: "shareout.execute", label: "Post the December share-out" }
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const hashRows = (rows) => { const s = JSON.stringify(rows); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
  const summaryOf = (db, name, a) => {
    if (name === "voidEntry" || name === "restoreEntry" || name === "correctEntryDate") { const t = (db.transactions || []).find((x) => x.id === a.id); return t ? t.type + " " + t.amount + " on " + t.date + " (" + t.memberId + ")" : a.id; }
    if (name === "voidLoan" || name === "restoreLoan" || name === "editAssignedInterest" || name === "correctLoanDate" || name === "markLoanDateUnknown" || name === "recordLoanComponents") { const l = (db.loans || []).find((x) => x.id === a.loanId); return l ? "Loan " + l.id + " (" + l.memberId + ", " + l.loanAmount + ")" : a.loanId; }
    if (name === "offsetHistoricalLoan" || name === "writeOffHistoricalLoan") return (name === "offsetHistoricalLoan" ? "Savings offset UGX " + a.amount : "Write-off principal " + (a.principal || 0) + ", interest " + (a.interest || 0)) + " on historical loan " + a.loanId;
    if (name === "distributeProfit") return "Profit distribution " + a.period;
    if (name === "settleFinancialYear") return "Settle FY" + a.year + " into the General Reserve Fund (verified result" + (a.expectedResult !== undefined ? " UGX " + a.expectedResult : "") + "; gain moves in, loss is reflected, balance carries forward)";
    if (name === "confirmFYProfit") return "Verify FY" + a.year + " group profit as UGX " + a.amount;
    if (name === "openReserve") return "Reserve opening balance UGX " + a.amount + " on " + a.date;
    if (name === "transferToReserve") return "Move UGX " + a.amount + " of FY" + (a.year || "") + " unallocated profit to the General Reserve Fund";
    if (name === "utilizeReserve") return "Use UGX " + a.amount + " from the General Reserve Fund: " + a.purpose;
    if (name === "executeShareOut") return "Share-out " + a.year;
    return a.id || "";
  };
  function requestApproval(db, ctx, name, args) {
    const g = GATED[name]; G.require(ctx, g.perm);
    const trial = clone(db); let preview = null;                                  // validate now, so the Chairperson is never asked to approve something that cannot run
    if (name === "distributeProfit") { preview = PR.preview(trial, { period: args.period }); }
    COMMANDS[name](trial, Object.assign({}, ctx, { approvedRequest: "trial" }), args);
    const req = { id: G.uid("REQ"), command: name, label: g.label, args: clone(args), summary: summaryOf(db, name, args), status: "Pending", requestedBy: ctx.by, requestedById: ctx.userId || ctx.by, requestedByRole: ctx.role, requestedDate: ctx.today, requestedAt: ctx.now,
      reason: String(args.reason || args.sourceNote || "").slice(0, 300), requester: { name: ctx.by, id: ctx.userId, role: ctx.role, memberId: ctx.memberId || null } };
    if (preview) Object.assign(req, { schedule: { pool: preview.pool, date: preview.date, basis: preview.basis, formula: preview.formula, rows: preview.rows, distributed: preview.distributed, undistributed: preview.undistributed, hash: hashRows(preview.rows) } });
    (db.approvalRequests = db.approvalRequests || []).push(req);
    G.audit(db, ctx, "ApprovalRequest", req.id, "Requested", null, { command: name, summary: req.summary }, "Awaiting the Chairperson: " + g.label);
    return { pendingApproval: true, requestId: req.id, label: g.label, summary: req.summary };
  }
  function decideRequest(db, ctx, a, approve) {
    G.require(ctx, "ledger.approve");
    const req = (db.approvalRequests || []).find((x) => x.id === a.id); if (!req) throw new Error("NOT_FOUND: request " + a.id);
    if (req.status !== "Pending") throw new Error("BAD_STATE: request is " + req.status);
    if ((ctx.userId || ctx.by) === req.requestedById || ctx.by === req.requestedBy) throw new Error("SEPARATION: the person who initiated a request cannot approve it");
    if (!approve) {
      G.need(a.reason, "reason");
      Object.assign(req, { status: "Rejected", decidedBy: ctx.by, decidedDate: ctx.today, decidedAt: ctx.now, decisionNote: String(a.reason).trim() });
      G.audit(db, ctx, "ApprovalRequest", req.id, "Rejected", { status: "Pending" }, { status: "Rejected" }, a.reason); return req;
    }
    if (req.command === "distributeProfit") {                                  // post exactly what the Chairperson saw: the schedule must still be what it was
      const now = PR.preview(db, { period: req.args.period }); if (hashRows(now.rows) !== req.schedule.hash) throw new Error("STALE: savings or loans changed since this schedule was prepared; ask the Super Admin to submit it again");
    }
    const exec = Object.assign(G.makeCtx({ name: req.requester.name, id: req.requester.id, role: req.requester.role, memberId: req.requester.memberId }, { today: ctx.today, now: ctx.now }), { approvedRequest: req.id, approvedBy: ctx.by });
    const result = COMMANDS[req.command](db, exec, clone(req.args));
    N.onCommand(db, exec, req.command, clone(req.args), result);                  // the same best-effort notices an ordinary run would queue
    Object.assign(req, { status: "Approved", decidedBy: ctx.by, decidedDate: ctx.today, decidedAt: ctx.now, decisionNote: String(a.note || "").trim() });
    G.audit(db, ctx, "ApprovalRequest", req.id, "Approved and executed", { status: "Pending" }, { status: "Approved", command: req.command }, "Initiated by " + req.requestedBy + ", approved by " + ctx.by + (a.note ? ": " + a.note : ""));
    return { request: req, result };
  }
  COMMANDS.approveRequest = (db, ctx, a) => decideRequest(db, ctx, a, true);
  COMMANDS.rejectRequest = (db, ctx, a) => decideRequest(db, ctx, a, false);
  COMMANDS.cancelRequest = (db, ctx, a) => {
    const req = (db.approvalRequests || []).find((x) => x.id === a.id); if (!req) throw new Error("NOT_FOUND: request " + a.id);
    if (req.status !== "Pending") throw new Error("BAD_STATE: request is " + req.status); if ((ctx.userId || ctx.by) !== req.requestedById) throw new Error("FORBIDDEN: only the person who made the request can withdraw it");
    Object.assign(req, { status: "Withdrawn", decidedBy: ctx.by, decidedDate: ctx.today }); G.audit(db, ctx, "ApprovalRequest", req.id, "Withdrawn", { status: "Pending" }, { status: "Withdrawn" }, a.reason || ""); return req;
  };
  /* Every dated entry: blank = today (server clock, East Africa Time); a chosen date must be a real calendar day and not in the future.
     The date the Admin picks is the date the entry carries, and therefore the date used for interest, allocation and guarantee release. */
  const isRealDate = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const [y, m, d] = s.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
  const DATED = { createEntry: 1, repayLoan: 1, disburseLoan: 1, recordSubscription: 1, recordExistingLoan: 1 };
  function checkDate(ctx, name, args) {
    if (!DATED[name] || !args) return args;
    const d = args.date === undefined || args.date === null || String(args.date).trim() === "" ? ctx.today : String(args.date).trim();
    if (!isRealDate(d)) throw new Error("INVALID: date must be a real day written YYYY-MM-DD (got " + d + ")");
    if (d > ctx.today) throw new Error("INVALID: date " + d + " is in the future (today is " + ctx.today + ")");
    return Object.assign({}, args, { date: d });
  }
  function run(db, ctx, name, args) {
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, name)) throw new Error("UNKNOWN_COMMAND: " + name);
    if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) throw new Error("INVALID: args must be an object");
    args = checkDate(ctx, name, args);
    const gate = GATED[name];
    if (gate && !ctx.approvedRequest && (!gate.when || gate.when(args))) return requestApproval(db, ctx, name, args || {});
    const result = COMMANDS[name](db, ctx, args || {});
    N.onCommand(db, ctx, name, args || {}, result);   // best-effort outbox notices; never blocks the command
    return result;
  }
  return { COMMANDS, GATED, names: Object.keys(COMMANDS), run };
});
