/* SOB core/reports — every report is derived from the ledger and returns {title, columns, rows, totals} so the same data feeds
   the on-screen table, CSV export and print-ready HTML. Blocked (pending SOB decision) reports return {blocked:true, reason}. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./loans.js") : root.SOB.loans, isNode ? require("./cycle.js") : root.SOB.cycle, isNode ? require("./kpis.js") : root.SOB.kpis, isNode ? require("./profit.js") : root.SOB.profit);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.reports = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, LN, C, K, PR) {
  const name = (db, id) => (db.members.find((m) => m.id === id) || {}).name || id;
  const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const R = (title, columns, rows, totals) => ({ title, columns, rows, totals: totals || {} });

  function memberStatement(db, memberId, period) {
    const h = L.memberLifetimeHistory(db, memberId, period);
    const rows = h.map((r) => ({ date: dates.toDisplay(r.date), type: r.type, purpose: r.purpose || "", amount: r.amount, savingsEffect: L.classifyTransaction(r).savings, balance: r.runningSavings }));
    return R("Member statement — " + name(db, memberId), ["date", "type", "purpose", "amount", "savingsEffect", "balance"], rows, { closingBalance: rows.length ? rows[rows.length - 1].balance : 0, ...L.memberPosition(db, memberId) });
  }
  /* What a member has committed as guarantor, with the borrower side linked: commitments reduce AVAILABLE savings and return as the borrower repays. */
  function guaranteeStatement(db, memberId) {
    const pos = L.memberPosition(db, memberId);
    const rows = (db.guarantees || []).filter((g) => g.guarantorId === memberId && g.status !== "Declined").map((g) => { const loan = db.loans.find((l) => l.id === g.loanId) || {};
      return { guaranteeId: g.id, loanId: g.loanId, borrower: name(db, loan.memberId), status: g.status, guaranteed: g.amount, released: Number(g.releasedAmount || 0), stillCommitted: g.status === "Active" ? L.guaranteeRemaining(g) : 0, borrowerOutstanding: loan.id ? L.loanOutstanding(loan, db, dates.todayISO()) : 0, committedOn: g.dateCommitted || "", }; });
    return R("Guarantee statement — " + name(db, memberId), ["guaranteeId", "loanId", "borrower", "status", "guaranteed", "released", "stillCommitted", "borrowerOutstanding"], rows,
      { actualSavings: pos.savings, committedToGuarantees: pos.committed, availableBalance: pos.available });
  }
  /* Linked double entry for one loan: borrower repayments beside the guarantor releases they caused. */
  function loanStatement(db, loanId, asOf) {
    const l = LN.linkedLedger(db, loanId, asOf), loan = db.loans.find((x) => x.id === loanId);
    const rows = l.rows.map((r) => ({ date: dates.toDisplay(r.date), event: r.event, ref: r.ref, guarantor: r.guarantor ? name(db, r.guarantor) : "", borrowerChange: r.borrowerChange, guarantorCommittedChange: r.guarantorCommittedChange, borrowerPrincipalExposure: r.borrowerPrincipalExposure, totalGuaranteeCommitted: r.totalGuaranteeCommitted }));
    return R("Loan statement — " + loanId + " (" + name(db, loan.memberId) + ")", ["date", "event", "ref", "guarantor", "borrowerChange", "guarantorCommittedChange", "borrowerPrincipalExposure", "totalGuaranteeCommitted"], rows, l.summary);
  }
  function securities(db) {
    const rows = (db.securities || []).map((x) => ({ id: x.id, loanId: x.loanId, borrower: name(db, x.memberId), kind: x.kind, description: x.description, owner: x.owner, valuation: x.valuation == null ? "" : x.valuation, acceptedCover: x.acceptedCover || 0, documents: (x.documents || []).length, status: x.status, decidedBy: x.decidedBy || "", reason: x.decisionReason || "" }));
    return R("Exceptional security register", ["id", "loanId", "borrower", "kind", "description", "owner", "valuation", "acceptedCover", "documents", "status", "decidedBy", "reason"], rows, { approved: rows.filter((r) => r.status === "Approved").length, proposed: rows.filter((r) => r.status === "Proposed").length });
  }
  function interestReceivable(db, asOf) {
    const d = K.interestReceivable(db, asOf);
    const rows = d.rows.map((r) => ({ member: r.member, loanId: r.loanId, principal: r.principal, monthlyInterest: r.assignedMonthlyInterest, disbursed: dates.toDisplay(r.disbursed), interestFrom: dates.toDisplay(r.interestStartsAfter), monthsElapsed: r.monthsElapsed, monthsCharged: r.monthsCharged, accumulatedInterest: r.accumulatedInterest, paymentsMade: r.paymentsMade, unpaidInterest: r.unpaidInterest, outstanding: r.outstanding }));
    return R("Interest Receivable (unpaid interest on outstanding loans)", ["member", "loanId", "principal", "monthlyInterest", "disbursed", "interestFrom", "monthsElapsed", "monthsCharged", "accumulatedInterest", "paymentsMade", "unpaidInterest", "outstanding"], rows,
      { unpaidInterest: d.total, accumulatedInterest: d.accumulated, paymentsMade: d.paymentsMade, outstanding: d.outstanding, allocation: d.allocation + (d.allocationConfirmed ? "" : " (assumed until SOB confirms)") });
  }
  function approvals(db) {
    const rows = [].concat((db.transactions || []).filter((t) => t.approvalStatus === "PendingApproval" && !t.voided).map((t) => ({ kind: "Ledger entry", ref: t.id, member: name(db, t.memberId), detail: t.type + " " + t.amount + " on " + dates.toDisplay(t.date), enteredBy: t.createdBy })),
      (db.loans || []).filter((l) => l.status === "AwaitingApproval" && !l.voided).map((l) => ({ kind: "Loan", ref: l.id, member: name(db, l.memberId), detail: "Loan " + l.loanAmount, enteredBy: l.reviewedBy })),
      (db.securities || []).filter((x) => x.status === "Proposed").map((x) => ({ kind: "Exceptional security", ref: x.id, member: name(db, x.memberId), detail: x.kind + ": " + x.description, enteredBy: x.proposedBy })));
    return R("Awaiting Chairperson approval", ["kind", "ref", "member", "detail", "enteredBy"], rows, { waiting: rows.length });
  }
  function savings(db) {
    const rows = db.members.map((m) => ({ memberId: m.id, name: m.name, savings: L.memberSavings(db, m.id) }));
    return R("Savings by member", ["memberId", "name", "savings"], rows, { total: sum(rows, "savings") });
  }
  function loans(db, asOf) {
    const rows = K.loanBook(db, asOf).map((v) => ({ loanId: v.id, member: name(db, (db.loans.find((l) => l.id === v.id) || {}).memberId), principal: v.principal, interest: v.accumulatedInterest, repaid: v.repaid, balance: v.balance, status: v.status }));
    return R("Loan book", ["loanId", "member", "principal", "interest", "repaid", "balance", "status"], rows, { principal: sum(rows, "principal"), balance: sum(rows, "balance") });
  }
  function repayments(db, period) {
    const rows = L.activeTransactions(db).filter((t) => t.type === "Loan Repayment" && L.inPeriod(t, period)).map((t) => ({ date: dates.toDisplay(t.date), member: name(db, t.memberId), loanId: t.loanId, amount: t.amount }));
    return R("Loan repayments", ["date", "member", "loanId", "amount"], rows, { total: sum(rows, "amount") });
  }
  function guarantors(db) {
    const rows = (db.guarantees || []).map((g) => ({ guarantor: name(db, g.guarantorId), loanId: g.loanId, amount: g.amount, released: Number(g.releasedAmount || 0), committed: g.status === "Active" ? L.guaranteeRemaining(g) : 0, status: g.status }));
    return R("Guarantor exposure", ["guarantor", "loanId", "amount", "released", "committed", "status"], rows, { activeTotal: sum(rows.filter((r) => r.status === "Active"), "amount"), committedTotal: sum(rows, "committed") });
  }
  function subscriptions(db, year) {
    const c = C.subscriptionCompliance(db, year);
    const rows = db.members.filter((m) => m.status !== "Inactive").map((m) => ({ memberId: m.id, name: m.name, paid: c.paid.includes(m.id) ? "Paid" : "Unpaid" }));
    return R("Subscriptions " + year, ["memberId", "name", "paid"], rows, { collected: c.collected, expected: c.expected });
  }
  function incomeExpenses(db, period) {
    const live = L.activeTransactions(db).filter((t) => L.inPeriod(t, period));
    const rows = live.filter((t) => ["Expense", "Subscription", "Income", "Profit"].includes(t.type)).map((t) => ({ date: dates.toDisplay(t.date), type: t.type, purpose: t.purpose || "", amount: t.amount }));
    return R("Income & expenses", ["date", "type", "purpose", "amount"], rows, { income: sum(rows.filter((r) => r.type !== "Expense"), "amount"), expenses: sum(rows.filter((r) => r.type === "Expense"), "amount") });
  }
  function shareOut(db, year, asOf) {
    const p = C.previewShareOut(db, year, asOf || year + "-12-31");
    return R("December share-out " + year + " (preview)", ["memberId", "name", "savings", "committed", "available", "withdraw", "retained", "outstandingLoan", "savingsAction"], p.rows, p.totals);
  }
  /* Latest posted distribution (or a named period) with every factor and per-member figure; a preview needs pool + date. */
  function quarterlyDistribution(db, period) {
    const posted = (db.profitDistributions || []).filter((d) => d.status === "Posted" && (!period || !period.period || d.period === period.period));
    if (period && period.pool && period.date) { try { const pv = PR.preview(db, period); return R("Profit distribution (preview)", ["memberId", "name", "savings", "eligible", "excludedBecause", "sharePct", "entitlement"], pv.rows, { pool: pv.pool, distributed: pv.distributed, undistributed: pv.undistributed }); } catch (e) { return { blocked: true, title: "Profit distribution", reason: String(e.message) }; } }
    const d = posted[posted.length - 1]; if (!d) return { blocked: true, title: "Profit distribution", reason: "No profit distribution has been posted yet. Admin can preview one by entering the pool and the date." };
    return R("Profit distribution " + d.period, ["memberId", "name", "savings", "eligible", "excludedBecause", "sharePct", "entitlement"], d.rows, { pool: d.pool, distributed: d.distributed, undistributed: d.undistributed, basis: d.basis, formula: d.formula });
  }
  function repaymentAllocation(db) {
    try { L.allocateRepayment(db); } catch (e) { return { blocked: true, title: "Interest vs principal received", reason: String(e.message) }; }
  }
  function annualSummary(db, year) {
    const d = K.dashboard(db, year + "-12-31", { year: Number(year) });
    return R("Annual summary " + year, ["measure", "value"], ["totalSavings", "availableCash", "outstandingLoans", "interestReceivable", "profit", "expenses", "members"].map((k) => ({ measure: k, value: d[k].value })), {});
  }
  const esc = (v) => String(v === undefined || v === null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function toCSV(rep) {
    if (rep.blocked) throw new Error("BLOCKED: " + rep.reason);
    const q = (v) => { v = v === undefined || v === null ? "" : String(v); if (/^[=+\-@]/.test(v) && isNaN(Number(v))) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [rep.columns.join(",")].concat(rep.rows.map((r) => rep.columns.map((c) => q(r[c])).join(","))).join("\n");
  }
  function toPrintHTML(rep, meta) {
    meta = meta || {};
    if (rep.blocked) return "<h1>" + esc(rep.title) + "</h1><p>Blocked: " + esc(rep.reason) + "</p>";
    const t = Object.keys(rep.totals).map((k) => "<tr><th>" + esc(k) + "</th><td>" + esc(rep.totals[k]) + "</td></tr>").join("");
    return '<!doctype html><meta charset="utf-8"><title>' + esc(rep.title) + "</title><style>body{font:13px sans-serif;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:4px 8px;text-align:left}h1{color:#0b1f3a}@media print{body{margin:0}}</style><h1>Sons of Bethel Savings Group</h1><h2>" +
      esc(rep.title) + "</h2><p>Generated " + esc(meta.generated || "") + "</p><table><thead><tr>" + rep.columns.map((c) => "<th>" + esc(c) + "</th>").join("") + "</tr></thead><tbody>" +
      rep.rows.map((r) => "<tr>" + rep.columns.map((c) => "<td>" + esc(r[c]) + "</td>").join("") + "</tr>").join("") + "</tbody></table><h3>Totals</h3><table>" + t + "</table>";
  }
  function airtime(db) {
    const rows = (db.airtimeRequests || []).map((r) => ({ date: dates.toDisplay(r.date), member: r.memberName || name(db, r.memberId), phone: r.phone, airtime: r.airtimeAmount, fee: r.fee, total: r.total, status: r.status }));
    const done = rows.filter((r) => r.status === "Fulfilled");
    return R("Airtime requests", ["date", "member", "phone", "airtime", "fee", "total", "status"], rows, { fulfilledAirtime: sum(done, "airtime"), fulfilledFees: sum(done, "fee"), fulfilledTotal: sum(done, "total"), pending: rows.filter((r) => r.status === "Pending").length });
  }
  function notificationLog(db) {
    const rows = (db.outbox || []).map((m) => ({ created: dates.toDisplay(String(m.createdAt).slice(0, 10)), to: m.to === "ADMIN" ? "Admin phone" : m.memberId ? name(db, m.memberId) : m.to, channel: m.channel, template: m.template, status: m.status, note: m.reason || "" }));
    const c = (k) => rows.filter((r) => r.status === k).length;
    return R("Notification log", ["created", "to", "channel", "template", "status", "note"], rows, { queued: c("QUEUED"), dryRun: c("DRY_RUN"), sent: c("SENT"), failed: c("FAILED"), skipped: c("SKIPPED") });
  }
  function reconciliationRegister(db) {
    const rows = (db.discrepancies || []).map((d) => ({ kind: d.kind, subject: d.subject, summary: d.summary, status: d.status, decision: d.decision || "", reason: d.resolutionReason || "", evidence: d.evidence || "" }));
    return R("Reconciliation register", ["kind", "subject", "summary", "status", "decision", "reason", "evidence"], rows, { open: rows.filter((r) => r.status === "Open").length, resolved: rows.filter((r) => r.status === "Resolved").length });
  }
  return { guaranteeStatement, loanStatement, securities, interestReceivable, approvals, airtime, notificationLog, reconciliationRegister, memberStatement, savings, loans, repayments, guarantors, subscriptions, incomeExpenses, shareOut, quarterlyDistribution, repaymentAllocation, annualSummary, toCSV, toPrintHTML };
});
