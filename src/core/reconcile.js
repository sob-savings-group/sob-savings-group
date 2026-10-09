/* SOB core/reconcile — a register of data discrepancies between the platform and its source records, and an audited way to settle them.
   Nothing here edits history to make figures balance: a discrepancy is OPENED with its evidence, and RESOLVED only with a written
   decision, evidence reference and (optionally) a normal, dated, auditable ledger entry that explains the difference. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./governance.js") : root.SOB.gov);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.reconcile = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, G) {
  const KINDS = ["SAVINGS_BALANCE", "LOAN_DATE", "LOAN_BALANCE", "MISSING_ENTRY", "OTHER"];
  const list = (db) => (db.discrepancies = db.discrepancies || []);

  function openDiscrepancy(db, ctx, d) {
    G.require(ctx, "reconcile.manage");
    if (!KINDS.includes(d.kind)) throw new Error("INVALID: kind must be one of " + KINDS.join("/"));
    G.need(d.subject, "subject"); G.need(d.summary, "summary");
    const dup = list(db).find((x) => x.status === "Open" && x.kind === d.kind && x.subject === d.subject);
    if (dup) throw new Error("ALREADY_OPEN: " + dup.id);
    const rec = { id: G.uid("DSC"), kind: d.kind, subject: String(d.subject), summary: String(d.summary), platformValue: d.platformValue ?? null, sourceValue: d.sourceValue ?? null,
      source: d.source || "", detail: d.detail && typeof d.detail === "object" ? JSON.parse(JSON.stringify(d.detail)) : undefined, status: "Open", openedDate: ctx.today, openedBy: ctx.by };
    list(db).push(rec);
    G.audit(db, ctx, "Discrepancy", rec.id, "Opened", null, { kind: rec.kind, subject: rec.subject, platformValue: rec.platformValue, sourceValue: rec.sourceValue });
    return rec;
  }
  /* decision: ACCEPT_PLATFORM (platform is right, source stale) | ACCEPT_SOURCE_WITH_ENTRY (post a normal correcting entry) | NO_ACTION_EXPLAINED.
     The source is never silently adopted: a difference is only closed by a decision with evidence. */
  function resolveDiscrepancy(db, ctx, id, r) {
    G.require(ctx, "reconcile.manage"); r = r || {};
    const d = list(db).find((x) => x.id === id); if (!d) throw new Error("NOT_FOUND: discrepancy " + id);
    if (d.status !== "Open") throw new Error("BAD_STATE: already " + d.status);
    if (!["ACCEPT_PLATFORM", "ACCEPT_SOURCE_WITH_ENTRY", "NO_ACTION_EXPLAINED"].includes(r.decision)) throw new Error("INVALID: decision");
    G.need(r.reason, "reason"); G.need(r.evidence, "evidence");
    let entry = null;
    if (r.decision === "ACCEPT_SOURCE_WITH_ENTRY") {
      if (!r.entry) throw new Error("REQUIRED: entry (the correcting ledger entry to post)");
      entry = G.createEntry(db, ctx, Object.assign({}, r.entry, { purpose: "Reconciliation correction " + id + (r.entry.purpose ? " - " + r.entry.purpose : "") , reconciliationId: id }));
    }
    Object.assign(d, { status: "Resolved", resolvedDate: ctx.today, resolvedBy: ctx.by, decision: r.decision, resolutionReason: r.reason, evidence: r.evidence, correctingEntryId: entry ? entry.id : null });
    G.audit(db, ctx, "Discrepancy", id, "Resolved", { status: "Open" }, { status: "Resolved", decision: r.decision, correctingEntryId: d.correctingEntryId }, r.reason + " | evidence: " + r.evidence);
    return d;
  }
  /* Audited correction of a loan's start date (interest accrues from it). Keeps the old date and the linked disbursement entry's original date. */
  function correctLoanDate(db, ctx, loanId, newDate, reason, evidence) {
    G.require(ctx, "reconcile.manage"); G.need(reason, "reason"); G.need(evidence, "evidence");
    if (!dates.isISO(newDate)) throw new Error("INVALID: date must be YYYY-MM-DD");
    const loan = db.loans.find((l) => l.id === loanId); if (!loan) throw new Error("NOT_FOUND: loan " + loanId);
    if (loan.date === newDate && !loan.dateUnknown) throw new Error("INVALID: date unchanged");
    const prev = loan.date;
    (loan.dateHistory = loan.dateHistory || []).push({ date: ctx.today, timestamp: ctx.now, previousDate: prev, newDate, reason, evidence, by: ctx.by, role: ctx.role });
    loan.date = newDate; delete loan.dateUnknown; delete loan.placeholderDate; if (loan.graceMonths !== undefined) loan.dueDate = dates.addMonths(newDate, Number(loan.graceMonths));
    db.transactions.filter((t) => t.loanId === loanId && t.type === "Loan Disbursement" && !t.voided).forEach((t) => { t.originalDate = t.originalDate || t.date; t.date = newDate; delete t.dateUnknown; delete t.placeholderDate; });
    G.audit(db, ctx, "Loan", loanId, "Start date corrected", { date: prev }, { date: newDate }, reason + " | evidence: " + evidence);
    return loan;
  }
  /* A start date that no document establishes is marked UNKNOWN instead of being kept as if it were fact. The system's placeholder stays on the record only so the ledger keeps its order; every report shows the loan as "date not established" and any interest shown is indicative. */
  function markLoanDateUnknown(db, ctx, loanId, reason, evidence) {
    G.require(ctx, "reconcile.manage"); G.need(reason, "reason"); G.need(evidence, "evidence");
    const loan = db.loans.find((l) => l.id === loanId); if (!loan || loan.voided) throw new Error("NOT_FOUND: loan " + loanId);
    if (loan.dateUnknown) throw new Error("BAD_STATE: this loan's date is already marked unknown");
    (loan.dateHistory = loan.dateHistory || []).push({ date: ctx.today, timestamp: ctx.now, previousDate: loan.date, newDate: null, unknown: true, reason, evidence, by: ctx.by, role: ctx.role });
    loan.dateUnknown = true; loan.placeholderDate = loan.date;
    db.transactions.filter((t) => t.loanId === loanId && t.type === "Loan Disbursement" && !t.voided).forEach((t) => { t.dateUnknown = true; t.placeholderDate = t.date; });
    G.audit(db, ctx, "Loan", loanId, "Start date marked unknown", { date: loan.date }, { dateUnknown: true, placeholderDate: loan.date }, reason + " | evidence: " + evidence);
    return loan;
  }
  /* A consolidated loan stays ONE loan account; its dated component disbursements are kept on it for the record (they must add up to the loan amount exactly). */
  function recordLoanComponents(db, ctx, loanId, components, reason, evidence) {
    G.require(ctx, "reconcile.manage"); G.need(reason, "reason"); G.need(evidence, "evidence");
    const loan = db.loans.find((l) => l.id === loanId); if (!loan || loan.voided) throw new Error("NOT_FOUND: loan " + loanId);
    if (!Array.isArray(components) || components.length < 2) throw new Error("INVALID: a consolidated loan has at least two components");
    const comps = components.map((c) => { if (!dates.isISO(c.date)) throw new Error("INVALID: component date must be YYYY-MM-DD"); const amt = Number(c.amount); if (!(amt > 0)) throw new Error("INVALID: component amount must be positive"); return { date: c.date, amount: amt, ref: String(c.ref || "") }; }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const sum = comps.reduce((a, c) => a + c.amount, 0); if (sum !== Number(loan.loanAmount)) throw new Error("INVALID: components add up to " + sum + " but the loan is " + loan.loanAmount);
    const prev = loan.components || null; loan.components = comps; (loan.componentHistory = loan.componentHistory || []).push({ at: ctx.now, by: ctx.by, reason, evidence, previous: prev });
    G.audit(db, ctx, "Loan", loanId, "Component disbursements recorded", { components: prev }, { components: comps }, reason + " | evidence: " + evidence);
    return loan;
  }
  /* Audited re-dating of one ledger entry (e.g. a placeholder date from the old system). The original date stays on the record. */
  function correctEntryDate(db, ctx, entryId, newDate, reason, evidence) {
    G.require(ctx, "reconcile.manage"); G.need(reason, "reason"); G.need(evidence, "evidence");
    if (!dates.isISO(newDate)) throw new Error("INVALID: date must be YYYY-MM-DD");
    const t = db.transactions.find((x) => x.id === entryId); if (!t) throw new Error("NOT_FOUND: entry " + entryId);
    if (t.voided) throw new Error("BAD_STATE: entry is voided"); if (t.date === newDate) throw new Error("INVALID: date unchanged");
    const prev = t.date; t.originalDate = t.originalDate || prev; (t.dateHistory = t.dateHistory || []).push({ previousDate: prev, newDate, reason, evidence, by: ctx.by, at: ctx.now });
    t.date = newDate;
    G.audit(db, ctx, "Transaction", entryId, "Date corrected", { date: prev }, { date: newDate }, reason + " | evidence: " + evidence);
    return t;
  }
  /* Pure what-if: loan balances if each loan started on the date a source record shows. Changes nothing. */
  function loanDateImpact(db, sourceDates, asOf) {
    return db.loans.filter((l) => !l.voided && sourceDates[l.id]).map((l) => {
      const alt = Object.assign({}, l, { date: sourceDates[l.id] });
      return { loanId: l.id, memberId: l.memberId, platformDate: l.date, sourceDate: sourceDates[l.id], balanceNow: L.loanOutstanding(l, db, asOf), balanceIfSourceDate: L.loanOutstanding(alt, db, asOf),
        difference: L.loanOutstanding(alt, db, asOf) - L.loanOutstanding(l, db, asOf) };
    });
  }
  const summary = (db) => { const l = list(db); return { open: l.filter((x) => x.status === "Open").length, resolved: l.filter((x) => x.status === "Resolved").length, total: l.length }; };
  return { KINDS, openDiscrepancy, resolveDiscrepancy, correctLoanDate, markLoanDateUnknown, recordLoanComponents, correctEntryDate, loanDateImpact, summary };
});
