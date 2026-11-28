/* SOB core/commands — the ONLY ways to change the ledger. A closed whitelist: the server (and the demo UI) run exactly these,
   with a ctx built from the authenticated session, never from anything the client sends. Each command re-checks its permission in core. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./governance.js") : root.SOB.gov, isNode ? require("./loans.js") : root.SOB.loans, isNode ? require("./cycle.js") : root.SOB.cycle, isNode ? require("./reconcile.js") : root.SOB.reconcile, isNode ? require("./notify.js") : root.SOB.notify, isNode ? require("./airtime.js") : root.SOB.airtime, isNode ? require("./history.js") : root.SOB.history, isNode ? require("./security.js") : root.SOB.security, isNode ? require("./profit.js") : root.SOB.profit, isNode ? require("./histloans.js") : root.SOB.histloans, isNode ? require("./fy.js") : root.SOB.fy, isNode ? require("./reserve.js") : root.SOB.reserve, isNode ? require("./profitrec.js") : root.SOB.profitrec, isNode ? require("./reminders.js") : root.SOB.reminders, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./batch.js") : root.SOB.batch, isNode ? require("./content.js") : root.SOB.content, isNode ? require("./content_seed.js") : root.SOB.contentSeed);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.commands = api; }
})(typeof self !== "undefined" ? self : this, function (G, LN, C, RC, N, AT, H, SEC, PR, HL, FYR, RSV, PRC, RM, L, BT, CT, SEED) {
  /* A bank charge typed on a loan payout: attached to the payout entry this command just created (same transaction, saved or refused together). */
  function withDisbursementCharge(db, ctx, a, n0) {
    const chg = G.chargeOf(a); if (!(chg.amount > 0)) return;
    const main = db.transactions.slice(n0).reverse().find((t) => /^Loan Disbursement/.test(t.type)); if (!main) throw new Error("INVALID: no loan payout was recorded, so no bank charge was added");
    G.addBankCharge(db, ctx, main, chg);
  }
  const COMMANDS = {
    saveContent: (db, ctx, a) => CT.save(db, ctx, a),
    setContentStatus: (db, ctx, a) => CT.setStatus(db, ctx, a),
    loadStarterContent: (db, ctx) => CT.loadStarter(db, ctx, SEED),
    createEntries: (db, ctx, a) => BT.apply(db, ctx, a.entries, { acceptWarnings: a.acceptWarnings }),   // many ledger lines in one go: all saved or none
    createEntry: (db, ctx, a) => G.createEntry(db, ctx, { date: a.date, memberId: a.memberId, amount: a.amount, type: a.type, purpose: a.purpose, loanId: a.loanId, receipt: a.receipt, reference: a.reference || undefined, bankCharge: a.type === "Withdraw" ? a.bankCharge : 0, chargedTo: a.chargedTo }),

    /* OUTSTANDING ENTRIES: records the owner has confirmed but not yet entered, supplied as a PRIVATE file (never in the repository). Everything goes through the
       existing rules: Savings and Loan Repayment post with their original date (repayments through repayLoan, so the loan, its owner, its start date and the outstanding
       balance are all checked); every Withdraw is stored as a request the Chairperson must approve. Each entry carries a unique sourceRef, so a second run adds nothing.
       The whole batch is trial-run on a copy first: if any line fails, nothing at all is posted. */
    processOutstandingEntries: (db, ctx, a) => {
      G.require(ctx, "ledger.create"); G.require(ctx, "loan.repay");
      const batch = String(a.batchId || "").trim(), approvedBy = String(a.approvedBy || "").trim(), list = a.entries;
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(batch)) throw new Error("INVALID: batchId");
      G.need(approvedBy, "approvedBy"); if (!Array.isArray(list) || !list.length || list.length > 100) throw new Error("INVALID: entries must be a list of 1 to 100 lines");
      const refs = new Set(), plan = list.map((e, i) => {
        const ref = "OUTSTANDING|" + batch + "|" + (e.ref || i + 1); if (refs.has(ref)) throw new Error("INVALID: line " + (i + 1) + " repeats reference " + ref); refs.add(ref);
        const amount = Number(e.amount); if (!Number.isInteger(amount) || amount <= 0) throw new Error("INVALID: line " + (i + 1) + " amount");
        if (!isRealDate(String(e.date || ""))) throw new Error("INVALID: line " + (i + 1) + " needs a real date YYYY-MM-DD"); if (e.date > ctx.today) throw new Error("INVALID: line " + (i + 1) + " is dated in the future");
        if (!["Savings", "Loan Repayment", "Withdraw"].includes(e.type)) throw new Error("INVALID: line " + (i + 1) + " type must be Savings, Loan Repayment or Withdraw");
        if (!db.members.some((m) => m.id === e.memberId)) throw new Error("UNKNOWN_MEMBER: line " + (i + 1) + " " + e.memberId);
        if (e.type === "Loan Repayment") { if (!e.loanId) throw new Error("REQUIRED: line " + (i + 1) + " needs the loan ID"); } else if (e.loanId) throw new Error("INVALID: line " + (i + 1) + " must not carry a loan ID");
        return { i, ref, date: e.date, memberId: e.memberId, type: e.type, amount, loanId: e.loanId || "" };
      }).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.i - y.i));
      const exec = (work) => plan.map((p) => {
        const row = { line: p.i + 1, ref: p.ref, date: p.date, memberId: p.memberId, type: p.type, amount: p.amount, loanId: p.loanId };
        const dup = work.transactions.find((t) => t.sourceRef === p.ref) || (work.approvalRequests || []).find((r) => r.command === "postOutstandingWithdrawal" && r.args && r.args.sourceRef === p.ref);
        if (dup) return Object.assign(row, { result: "already processed", detail: dup.id });
        const tag = { sourceRef: p.ref, importBatch: batch, importNote: "Outstanding entry confirmed by " + approvedBy };
        if (p.type === "Savings") { const e = G.createEntry(work, ctx, Object.assign({ date: p.date, memberId: p.memberId, amount: p.amount, type: "Savings", purpose: "Savings" }, tag)); return Object.assign(row, { result: "posted", detail: e.id }); }
        if (p.type === "Loan Repayment") {
          const loan = work.loans.find((l) => l.id === p.loanId); if (!loan) throw new Error("LOAN_NOT_FOUND: line " + row.line + " " + p.loanId);
          if (loan.memberId !== p.memberId) throw new Error("LOAN_MISMATCH: line " + row.line + " loan " + p.loanId + " belongs to " + loan.memberId + ", not " + p.memberId);
          const n = work.transactions.length; LN.repayLoan(work, ctx, p.loanId, p.amount, p.date);
          const e = work.transactions[work.transactions.length - 1]; if (work.transactions.length !== n + 1 || e.type !== "Loan Repayment" || e.loanId !== p.loanId) throw new Error("INTERNAL: repayment line " + row.line + " was not recorded as expected");
          Object.assign(e, tag); return Object.assign(row, { result: "posted", detail: e.id });
        }
        const r = run(work, ctx, "postOutstandingWithdrawal", Object.assign({ date: p.date, memberId: p.memberId, amount: p.amount }, tag));
        return Object.assign(row, { result: "awaiting Chairperson approval", detail: r.requestId });
      });
      const trial = clone(db), rows = exec(trial);                                // any failure here stops everything before the real ledger is touched
      const summary = { posted: rows.filter((r) => r.result === "posted").length, awaitingApproval: rows.filter((r) => r.result.startsWith("awaiting")).length, alreadyProcessed: rows.filter((r) => r.result === "already processed").length };
      if (a.dryRun) return Object.assign({ dryRun: true, batchId: batch, rows }, summary);
      const done = exec(db);
      G.audit(db, ctx, "OutstandingBatch", batch, "Outstanding entries processed", null, { posted: summary.posted, awaitingApproval: summary.awaitingApproval, alreadyProcessed: summary.alreadyProcessed, refs: done.map((r) => r.ref) }, "Confirmed by " + approvedBy + "; original dates kept");
      return Object.assign({ dryRun: false, batchId: batch, rows: done }, summary);
    },
    postOutstandingWithdrawal: (db, ctx, a) => {
      G.require(ctx, "ledger.create"); if (!a.sourceRef) throw new Error("REQUIRED: sourceRef");
      if (db.transactions.some((t) => t.sourceRef === a.sourceRef)) throw new Error("DUPLICATE: " + a.sourceRef + " was already posted");
      return G.createEntry(db, ctx, { date: a.date, memberId: a.memberId, amount: a.amount, type: "Withdraw", purpose: "Member withdrawal", sourceRef: a.sourceRef, importBatch: a.importBatch, importNote: a.importNote });
    },
    splitRepayment: (db, ctx, a) => {
      G.require(ctx, "reconcile.manage"); G.need(a.reason, "reason"); G.need(a.evidence, "evidence");
      const t = db.transactions.find((x) => x.id === a.id); if (!t) throw new Error("NOT_FOUND: entry " + a.id);
      if (t.voided) throw new Error("BAD_STATE: entry is voided"); if (t.type !== "Loan Repayment" || !t.loanId) throw new Error("INVALID: only a loan repayment can be split");
      const parts = Array.isArray(a.parts) ? a.parts : []; if (parts.length < 2) throw new Error("INVALID: a split has at least two parts");
      const sum = parts.reduce((x, p) => x + (Number(p.amount) || 0), 0); if (sum !== Number(t.amount)) throw new Error("INVALID: the parts add up to " + sum + " but the repayment is " + t.amount);
      parts.forEach((p) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || "") || !(Number(p.amount) > 0)) throw new Error("INVALID: every part needs a real date and an amount"); });
      const loan = db.loans.find((l) => l.id === t.loanId); if (loan && loan.date && !loan.dateUnknown && parts.some((p) => p.date < loan.date)) throw new Error("INVALID: a part is dated before the loan began (" + loan.date + ")");
      Object.assign(t, { voided: true, voidReason: "Split into the dated repayments recorded in the source register: " + a.reason, voidDate: ctx.today, voidTimestamp: ctx.now, voidedByRole: ctx.role, voidedBy: ctx.by, splitInto: [] });
      LN.onRepaymentRemoved(db, ctx, t, "split into dated parts");
      parts.slice().sort((x, y) => (x.date < y.date ? -1 : 1)).forEach((p) => { const e = G.createEntry(db, ctx, { date: p.date, memberId: t.memberId, amount: Number(p.amount), type: "Loan Repayment", purpose: "Loan Repayment (dated part of " + t.id + ")", loanId: t.loanId, sourceRef: p.ref || "", splitFrom: t.id }); t.splitInto.push(e.id); if (e.approvalStatus === "Approved") LN.onRepaymentCounted(db, ctx, e); });
      G.audit(db, ctx, "Transaction", t.id, "Split into dated repayments", { amount: t.amount, date: t.date }, { parts: parts.map((p) => p.date + ":" + p.amount), entries: t.splitInto }, a.reason + " | evidence: " + a.evidence);
      return t;
    },
    /* Correct the AMOUNT of a savings deposit to the figure on the source record: the original is voided (kept, with its reason) and replaced by a dated entry for the right amount. Nothing is edited in place. */
    correctEntryAmount: (db, ctx, a) => {
      G.require(ctx, "reconcile.manage"); G.need(a.reason, "reason"); G.need(a.evidence, "evidence");
      const t = db.transactions.find((x) => x.id === a.id); if (!t) throw new Error("NOT_FOUND: entry " + a.id); if (t.voided) throw new Error("BAD_STATE: entry is voided");
      if (t.type !== "Savings" || t.loanId) throw new Error("INVALID: only a savings deposit can be corrected this way");
      const amt = Number(a.amount); if (!(amt > 0) || amt === Number(t.amount)) throw new Error("INVALID: the corrected amount must be positive and different from " + t.amount);
      Object.assign(t, { voided: true, voidReason: "Amount corrected from " + t.amount + " to " + amt + " per the source record: " + a.reason, voidDate: ctx.today, voidTimestamp: ctx.now, voidedByRole: ctx.role, voidedBy: ctx.by });
      const e = G.createEntry(db, ctx, { date: t.date, memberId: t.memberId, amount: amt, type: "Savings", purpose: "Savings (amount corrected from " + t.amount + "; replaces " + t.id + ")", sourceRef: a.ref || "", correctsId: t.id });
      t.replacedBy = e.id;
      const dsc = a.discrepancySubject && (db.discrepancies || []).find((x) => x.subject === a.discrepancySubject && x.status === "Open");
      if (dsc) Object.assign(dsc, { status: "Resolved", resolvedDate: ctx.today, resolvedBy: ctx.by, decision: "ACCEPT_SOURCE_WITH_ENTRY", resolutionReason: a.reason, evidence: a.evidence, correctingEntryId: e.id });
      G.audit(db, ctx, "Transaction", t.id, "Amount corrected", { amount: t.amount, date: t.date }, { amount: amt, entry: e.id }, a.reason + " | evidence: " + a.evidence);
      return e;
    },
    voidEntry: (db, ctx, a) => { const t = G.voidEntry(db, ctx, a.id, a.reason); LN.onRepaymentRemoved(db, ctx, t, a.reason); return t; },          // a voided repayment re-commits what it released
    restoreEntry: (db, ctx, a) => { const t = G.restoreEntry(db, ctx, a.id, a.reason); if (t.approvalStatus === "Approved") LN.onRepaymentCounted(db, ctx, t); return t; },
    approveEntry: (db, ctx, a) => { const t = G.approveEntry(db, ctx, a.id, a.decision, a.reason); if (t.approvalStatus === "Approved") LN.onRepaymentCounted(db, ctx, t); return t; },
    addMember: (db, ctx, a) => G.addMember(db, ctx, { id: a.id, regDate: a.regDate, name: a.name, phone: a.phone, email: a.email, location: a.location }),
    updateMemberContact: (db, ctx, a) => G.updateMemberContact(db, ctx, { memberId: a.memberId, phone: a.phone, email: a.email, location: a.location, allowShared: !!a.allowShared, reason: a.reason }),
    applyForLoan: (db, ctx, a) => LN.applyForLoan(db, ctx, a.memberId, a.amount, a.purpose),
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
    disburseLoan: (db, ctx, a) => { const n0 = db.transactions.length, r = LN.disburseLoan(db, ctx, a.loanId, { assignedMonthlyInterest: a.assignedMonthlyInterest, graceMonths: a.graceMonths, graceAuthorisedBy: a.graceAuthorisedBy, date: a.date }); withDisbursementCharge(db, ctx, a, n0); return r; },
    settleLoanFromSavings: (db, ctx, a) => LN.settleFromSavings(db, ctx, a.loanId, a.date, a.amount),
    addDisbursement: (db, ctx, a) => { const n0 = db.transactions.length, r = LN.addDisbursement(db, ctx, a.loanId, { amount: a.amount, date: a.date, reason: a.reason }); withDisbursementCharge(db, ctx, a, n0); return r; },
    recordExistingLoan: (db, ctx, a) => { const n0 = db.transactions.length, r = LN.recordExistingLoan(db, ctx, { memberId: a.memberId, amount: a.amount, date: a.date, assignedMonthlyInterest: a.assignedMonthlyInterest, graceMonths: a.graceMonths, graceAuthorisedBy: a.graceAuthorisedBy, remarks: a.remarks }); withDisbursementCharge(db, ctx, a, n0); return r; },
    repayLoan: (db, ctx, a) => LN.repayLoan(db, ctx, a.loanId, a.amount, a.date),
    editAssignedInterest: (db, ctx, a) => LN.editAssignedInterest(db, ctx, a.loanId, a.amount, a.reason),
    lockInterest: (db, ctx, a) => LN.lockInterest(db, ctx, a.loanId, a.reason, a.date), unlockInterest: (db, ctx, a) => LN.unlockInterest(db, ctx, a.loanId, a.reason, a.date),
    voidLoan: (db, ctx, a) => LN.voidLoan(db, ctx, a.loanId, a.reason),
    restoreLoan: (db, ctx, a) => LN.restoreLoan(db, ctx, a.loanId, a.reason),
    correctLoan: (db, ctx, a) => {
      /* ONE correction, three optional parts, run in a fixed order: restore, then monthly interest, then lock. Each part is the SAME function that stands alone, so every
         rule (48-hour restore window, who may do it, no lock before the payout date) still applies. If any part fails nothing is saved: the server writes only after the whole command succeeds. */
      G.need(a.reason, "reason");
      const loan = (db.loans || []).find((x) => x.id === a.loanId); if (!loan) throw new Error("NOT_FOUND: loan " + a.loanId);
      const wantRestore = a.restore === true || a.restore === "true" || a.restore === "yes", hasAmt = a.amount !== undefined && a.amount !== null && String(a.amount).trim() !== "", lockFrom = a.lockFrom ? String(a.lockFrom).trim() : "";
      if (!wantRestore && !hasAmt && !lockFrom) throw new Error("INVALID: choose at least one correction (restore, monthly interest, or lock)");
      const approved = ctx.approvedBy && ctx.approvedRequest && ctx.approvedRequest !== "trial", steps = [];
      const stamp = () => { if (approved) { const row = db.auditLog[db.auditLog.length - 1]; row.reason = String(row.reason || "") + " · Loan correction " + ctx.approvedRequest + ": requested by " + ctx.by + " (" + ctx.role + "), approved by " + ctx.approvedBy; } };
      if (wantRestore) { LN.restoreLoan(db, ctx, loan.id, a.reason); stamp(); steps.push("Restored the loan"); }
      if (hasAmt) { const prev = Number(loan.assignedMonthlyInterest) || 0, amt = Number(a.amount); if (!(amt >= 0)) throw new Error("INVALID: monthly interest"); if (amt !== prev) { LN.editAssignedInterest(db, ctx, loan.id, amt, a.reason); stamp(); steps.push("Monthly interest " + prev + " to " + amt); } }
      if (lockFrom) { LN.lockInterest(db, ctx, loan.id, a.reason, lockFrom); stamp(); steps.push("Interest locked from " + lockFrom); }
      if (!steps.length) throw new Error("INVALID: nothing to change (the monthly interest is already that amount)");
      G.audit(db, ctx, "Loan", loan.id, "Loan correction completed", null, { steps }, String(a.reason) + (approved ? " · Loan correction " + ctx.approvedRequest + ": requested by " + ctx.by + " (" + ctx.role + "), approved by " + ctx.approvedBy : ""));
      return { loan, steps };
    },
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
    /* Close the balances still held in the ledger after the last share-out. SOB pays out ALL savings in December and the register opens every member at zero on that day, so any amount the
       old workbook left behind (rounding of profit shares, loans netted off, rows the workbook never recorded) is posted as a dated Share-Out. Each line must equal exactly what the ledger holds
       for that member from before the savings year, so the request cannot be misapplied or applied twice. Nothing is deducted from a loan and no cash is invented: the cash
       falls by the same amount, which is what ties the platform's cash to the register's cash. */
    closeYearBalances: (db, ctx, a) => {
      G.require(ctx, "reconcile.manage"); G.need(a.reason, "reason"); G.need(a.evidence, "evidence");
      const date = a.date; if (!isRealDate(String(date))) throw new Error("INVALID: date"); if (!Array.isArray(a.lines) || !a.lines.length) throw new Error("REQUIRED: lines");
      const plan = [];
      a.lines.forEach((l) => {                                                   // validate everything first: nothing is posted unless every line is exactly right
        const carry = L.memberSavingsAsOf(db, l.memberId, date) - L.memberVerifiedSavingsAsOf(db, l.memberId, date);
        if (carry === 0 && db.transactions.some((t) => t.sourceRef === "CLOSE|" + date + "|" + l.memberId || (t.offsetId && t.memberId === l.memberId && t.date === date))) return;   // already closed
        if (!(Number(l.amount) > 0) || Number(l.amount) !== carry) throw new Error("STALE: " + l.memberId + " holds " + carry + " from before the savings year, not " + l.amount);
        const offs = (l.offsets || []).map((o) => { const loan = HL.loansOf(db, l.memberId).find((x) => x.key === o.key); if (!loan) throw new Error("NOT_FOUND: historical loan " + o.key);
          const pos = HL.position(db, loan.id, "9999-12-31"); if (Number(o.amount) !== pos.outstanding) throw new Error("STALE: " + o.key + " owes " + pos.outstanding + ", not " + o.amount); return { loanId: loan.id, amount: Number(o.amount), key: o.key }; });
        const offTotal = offs.reduce((x, o) => x + o.amount, 0); if (offTotal > carry) throw new Error("INSUFFICIENT_SAVINGS: " + l.memberId + " held " + carry + " at the share-out, the loan(s) need " + offTotal);
        plan.push({ memberId: l.memberId, carry, offs, rest: carry - offTotal });
      });
      if (!plan.length) return { added: 0, alreadyClosed: a.lines.length };
      const entries = [];
      plan.forEach((p) => {
        p.offs.forEach((o) => HL.offsetHistoricalLoan(db, ctx, { loanId: o.loanId, amount: o.amount, date, reason: "Savings held at the " + date + " share-out covered the loan in full (SOB settlement rule)", evidence: a.evidence }));
        if (p.rest > 0) entries.push({ memberId: p.memberId, date, type: "Share-Out", amount: p.rest, purpose: "Balance paid out at the " + date + " share-out (closing entry)", sourceRef: "CLOSE|" + date + "|" + p.memberId });
      });
      const r = entries.length ? H.importHistoricalEntries(db, ctx, { batchId: "CLOSE-" + date, source: "Closing of brought-forward balances at the " + date + " share-out | " + a.evidence, entries }) : { added: 0 };
      G.audit(db, ctx, "YearClose", "CLOSE-" + date, "Brought-forward balances closed", null, { members: plan.length, paidOut: entries.reduce((x, e) => x + e.amount, 0), settledFromSavings: plan.reduce((x, p) => x + p.offs.reduce((y, o) => y + o.amount, 0), 0) }, a.reason);
      return r;
    },
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
    confirmPhones: (db, ctx, a) => N.confirmPhones(db, ctx, { memberIds: a.memberIds, note: a.note }),
    setSmsRule: (db, ctx, a) => N.setSmsRule(db, ctx, { requireConfirmed: a.requireConfirmed, reason: a.reason }),
    sendNotice: (db, ctx, a) => N.sendNotice(db, ctx, { memberIds: a.memberIds, text: a.text, reason: a.reason }),
    setNotifyOptOut: (db, ctx, a) => N.setOptOut(db, ctx, a.memberId, !!a.optOut, a.reason),
    /* Loan reminders (WhatsApp, officer-sent). They never touch loans, repayments, interest or balances: see core/reminders.js. */
    prepareReminder: (db, ctx, a) => RM.prepare(db, ctx, { loanId: a.loanId, level: a.level }),
    prepareReminders: (db, ctx, a) => RM.prepareMany(db, ctx, { loanIds: a.loanIds, level: a.level }),
    revalidateReminder: (db, ctx, a) => RM.revalidate(db, ctx, { id: a.id }),
    markReminderOpened: (db, ctx, a) => RM.markOpened(db, ctx, { id: a.id }),
    sendInterestRelief: (db, ctx, a) => RM.sendInterestRelief(db, ctx, { loanIds: a.loanIds }),
    queueReminderSms: (db, ctx, a) => RM.queueSms(db, ctx, { id: a.id }),
    setEscalation: (db, ctx, a) => RM.setEscalation(db, ctx, { steps: a.steps, reason: a.reason }),
    queueEscalation: (db, ctx, a) => RM.queueEscalation(db, ctx, { step: a.step }),
    syncReminderSms: (db, ctx, a) => RM.syncSms(db, ctx, { id: a.id }),
    confirmReminderSent: (db, ctx, a) => RM.confirmSent(db, ctx, { id: a.id, note: a.note }),
    setReminderFollowUp: (db, ctx, a) => RM.setFollowUp(db, ctx, { id: a.id, followUp: a.followUp, note: a.note, promiseDate: a.promiseDate }),
    cancelReminder: (db, ctx, a) => RM.cancel(db, ctx, { id: a.id, reason: a.reason }),
    setReminderSettings: (db, ctx, a) => RM.setSettings(db, ctx, { urgentDays: a.urgentDays, finalDays: a.finalDays, minIntervalDays: a.minIntervalDays, templates: a.templates, reason: a.reason }),
    addListItem: (db, ctx, a) => G.addListItem(db, ctx, { list: a.list, label: a.label, reason: a.reason }),
    retireListItem: (db, ctx, a) => G.retireListItem(db, ctx, { list: a.list, label: a.label, reason: a.reason }),
    recordBroughtForward: (db, ctx, a) => FYR.recordBroughtForward(db, ctx, { year: a.year, memberId: a.memberId, amount: a.amount, evidence: a.evidence, reason: a.reason }),
    voidBroughtForward: (db, ctx, a) => FYR.voidBroughtForward(db, ctx, { id: a.id, reason: a.reason }),
    setReceiptSms: (db, ctx, a) => RM.setReceipts(db, ctx, { enabled: a.enabled, reason: a.reason }),
    setAutoReminders: (db, ctx, a) => RM.setAuto(db, ctx, { enabled: a.enabled, regularEveryDays: a.regularEveryDays, adminAfterDays: a.adminAfterDays, bishopDaysBefore: a.bishopDaysBefore, contactPhone: a.contactPhone, reason: a.reason }),
    setReminderDates: (db, ctx, a) => RM.setDates(db, ctx, { shareOutDate: a.shareOutDate, deadline: a.deadline, loanDeadlines: a.loanDeadlines, reason: a.reason })
  };
  /* FINAL SOB rule: material or exceptional financial actions are INITIATED by the Super Admin but only take effect when a DIFFERENT person, the Chairperson, approves.
     (New loan approval and exceptional security have their own two-step flows in loans.js / security.js; ledger entry types the Chairperson must also approve are
     handled in governance.createEntry.) The Super Admin cannot bypass this: the command is NOT executed, it is stored as a request with its arguments and the
     result of a trial run, and approveRequest alone (Chairperson only, never the requester) executes it. Routine savings deposits and loan repayments are not gated. */
  const GATED = {
    voidEntry: { perm: "ledger.void", label: "Void a transaction" }, restoreEntry: { perm: "ledger.restore", label: "Restore a voided transaction" },
    voidLoan: { perm: "loan.reverse", label: "Void a loan" }, restoreLoan: { perm: "ledger.restore", label: "Restore a voided loan" },
    correctLoan: { perm: "loan.editInterest", label: "Correct a loan (restore, monthly interest, lock)" },
    editAssignedInterest: { perm: "loan.editInterest", label: "Change a loan's assigned interest" }, lockInterest: { perm: "loan.editInterest", label: "Lock interest on a loan" }, unlockInterest: { perm: "loan.editInterest", label: "Unlock interest on a loan" }, correctLoanDate: { perm: "reconcile.manage", label: "Correct a loan's start date" },
    offsetHistoricalLoan: { perm: "reconcile.manage", label: "Offset a member's savings against a historical loan" }, writeOffHistoricalLoan: { perm: "reserve.manage", label: "Write off an uncollectible historical loan balance" },
    markLoanDateUnknown: { perm: "reconcile.manage", label: "Mark a loan's start date as not established" }, recordLoanComponents: { perm: "reconcile.manage", label: "Record the component disbursements of a consolidated loan" },
    correctEntryAmount: { perm: "reconcile.manage", label: "Correct a savings deposit's amount to the source record" },
    closeYearBalances: { perm: "reconcile.manage", label: "Close members' brought-forward balances at the share-out date" },
    postOutstandingWithdrawal: { perm: "ledger.create", label: "Post a confirmed withdrawal that was not yet entered" },
    settleLoanFromSavings: { perm: "loan.repay", label: "Pay a loan from the member's savings (all or part)" },
    addDisbursement: { perm: "loan.disburse", label: "Add a further payout to a running loan" },
    splitRepayment: { perm: "reconcile.manage", label: "Split a consolidated repayment into its dated repayments" },
    correctEntryDate: { perm: "reconcile.manage", label: "Correct a transaction's date" },
    resolveDiscrepancy: { perm: "reconcile.manage", label: "Resolve a reconciliation item", when: (a) => a && a.decision === "ACCEPT_SOURCE_WITH_ENTRY" },
    confirmFYProfit: { perm: "reserve.manage", label: "Verify a financial year's group profit" }, settleFinancialYear: { perm: "reserve.manage", label: "Settle a completed financial year into the General Reserve Fund" }, openReserve: { perm: "reserve.manage", label: "Record the General Reserve Fund opening balance" },
    transferToReserve: { perm: "reserve.manage", label: "Transfer unallocated profit to the General Reserve Fund" }, utilizeReserve: { perm: "reserve.manage", label: "Use money from the General Reserve Fund" },
    recordBroughtForward: { perm: "reconcile.manage", label: "Record a member's Balance Brought Forward into a financial year" }, voidBroughtForward: { perm: "reconcile.manage", label: "Void a Balance Brought Forward record" },
    setEscalation: { perm: "policy.manage", label: "Set who is told about overdue loans (church administrator and bishop) and when" },
    setReceiptSms: { perm: "policy.manage", label: "Switch automatic SMS receipts on or off" },
    setAutoReminders: { perm: "policy.manage", label: "Change the automatic reminder schedule" },
    confirmPhones: { perm: "notify.manage", label: "Confirm members' phone numbers" },
    setSmsRule: { perm: "policy.manage", label: "Send amounts and warnings only to confirmed numbers" },
    sendNotice: { perm: "notify.manage", label: "Send a message to chosen members" },
    setReminderDates: { perm: "policy.manage", label: "Set the share-out date and approved repayment deadlines used in loan reminders" },
    distributeProfit: { perm: "profit.distribute", label: "Post the final profit distribution" }, executeShareOut: { perm: "shareout.execute", label: "Post the December share-out" }
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const hashRows = (rows) => { const s = JSON.stringify(rows); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
  const summaryOf = (db, name, a) => {
    if (name === "voidEntry" || name === "restoreEntry" || name === "correctEntryDate" || name === "splitRepayment") { const t = (db.transactions || []).find((x) => x.id === a.id); return t ? t.type + " " + t.amount + " on " + t.date + " (" + t.memberId + ")" : a.id; }
    if (name === "correctLoan") { const l = (db.loans || []).find((x) => x.id === a.loanId), parts = []; if (a.restore === true || a.restore === "true" || a.restore === "yes") parts.push("restore the loan"); if (a.amount !== undefined && a.amount !== null && String(a.amount).trim() !== "") parts.push("monthly interest " + (l ? (Number(l.assignedMonthlyInterest) || 0) : "?") + " to " + Number(a.amount)); if (a.lockFrom) parts.push("lock interest from " + a.lockFrom); return "Loan " + a.loanId + (l ? " (" + l.memberId + ")" : "") + ": " + parts.join("; then "); }
    if (name === "voidLoan" || name === "restoreLoan" || name === "editAssignedInterest" || name === "lockInterest" || name === "unlockInterest" || name === "correctLoanDate" || name === "markLoanDateUnknown" || name === "recordLoanComponents" || name === "addDisbursement" || name === "settleLoanFromSavings") { const l = (db.loans || []).find((x) => x.id === a.loanId); return l ? "Loan " + l.id + " (" + l.memberId + ", " + l.loanAmount + ")" : a.loanId; }
    if (name === "offsetHistoricalLoan" || name === "writeOffHistoricalLoan") return (name === "offsetHistoricalLoan" ? "Savings offset UGX " + a.amount : "Write-off principal " + (a.principal || 0) + ", interest " + (a.interest || 0)) + " on historical loan " + a.loanId;
    if (name === "correctEntryAmount") { const t = (db.transactions || []).find((x) => x.id === a.id); return t ? "Savings " + t.amount + " on " + t.date + " (" + t.memberId + ") becomes " + a.amount : a.id; }
    if (name === "closeYearBalances") return "Close " + (a.lines || []).length + " brought-forward balances (total UGX " + (a.lines || []).reduce((x, l) => x + Number(l.amount), 0) + ") as paid out at the " + a.date + " share-out";
    if (name === "postOutstandingWithdrawal") return "Withdrawal UGX " + a.amount + " for " + a.memberId + " dated " + a.date + " (outstanding entry, batch " + (a.importBatch || "") + ")";
    if (name === "setEscalation") return "Overdue-loan escalation: church administrator after " + ((a.steps || {}).ADMIN || {}).afterDays + " day(s), bishop after " + ((a.steps || {}).BISHOP || {}).afterDays + " day(s) past the approved deadline";
    if (name === "distributeProfit") return "Profit distribution " + a.period;
    if (name === "settleFinancialYear") return "Settle FY" + a.year + " into the General Reserve Fund (verified result" + (a.expectedResult !== undefined ? " UGX " + a.expectedResult : "") + "; gain moves in, loss is reflected, balance carries forward)";
    if (name === "confirmFYProfit") return "Verify FY" + a.year + " group profit as UGX " + a.amount;
    if (name === "recordBroughtForward") return "Balance Brought Forward UGX " + a.amount + " for " + a.memberId + " into FY" + a.year;
    if (name === "voidBroughtForward") return "Void Balance Brought Forward " + a.id;
    if (name === "openReserve") return "Reserve opening balance UGX " + a.amount + " on " + a.date;
    if (name === "transferToReserve") return "Move UGX " + a.amount + " of FY" + (a.year || "") + " unallocated profit to the General Reserve Fund";
    if (name === "utilizeReserve") return "Use UGX " + a.amount + " from the General Reserve Fund: " + a.purpose;
    if (name === "executeShareOut") return "Share-out " + a.year;
    if (name === "confirmPhones") return "Confirm the phone numbers of " + (a.memberIds || []).length + " member(s): " + (a.memberIds || []).join(", ");
    if (name === "setSmsRule") return "Amounts and warnings by SMS only to confirmed numbers: " + (a.requireConfirmed === true || a.requireConfirmed === "true" || a.requireConfirmed === "yes" ? "ON" : "OFF");
    if (name === "sendNotice") return "Message to " + (a.memberIds || []).length + " member(s): " + String(a.text || "").slice(0, 120);
    if (name === "setReceiptSms") return "Automatic SMS receipts to members: " + (a.enabled === true || a.enabled === "true" || a.enabled === "yes" ? "ON" : "OFF");
    if (name === "setAutoReminders") return "Automatic reminders " + (a.enabled === undefined ? "settings" : (a.enabled === true || a.enabled === "true" || a.enabled === "yes" ? "ON" : "OFF")) + ": regular every " + a.regularEveryDays + " days; Church Administration notice after " + a.adminAfterDays + " days unpaid; Bishop notice " + a.bishopDaysBefore + " days before the deadline";
    if (name === "setReminderDates") return "Reminder dates: share-out " + a.shareOutDate + ", approved repayment deadline " + a.deadline + (a.loanDeadlines && Object.keys(a.loanDeadlines).filter((k) => a.loanDeadlines[k]).length ? ", plus " + Object.keys(a.loanDeadlines).filter((k) => a.loanDeadlines[k]).length + " loan-specific deadline(s)" : "");
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
    N.onCommand(db, exec, req.command, clone(req.args), result); RM.receiptAfter(db, exec, req.command, clone(req.args), result);                  // the same best-effort notices an ordinary run would queue
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
    if (name !== "approveRequest") RM.receiptAfter(db, ctx, name, args || {}, result);
    N.onCommand(db, ctx, name, args || {}, result);   // best-effort outbox notices; never blocks the command
    return result;
  }
  return { COMMANDS, GATED, names: Object.keys(COMMANDS), run };
});
