/* SOB core/kpis — every dashboard figure, derived only from the ledger (core/ledger.js).
   Each KPI carries its definition so a drill-down can always show "how this is calculated". */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./loans.js") : root.SOB.loans, isNode ? require("./cycle.js") : root.SOB.cycle);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.kpis = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, LN, C) {
  const upTo = (db, asOf) => Object.assign({}, db, { transactions: db.transactions.filter((t) => t.date <= asOf) });

  function dashboard(db, asOf, period) {
    asOf = asOf || dates.todayISO();
    const d = upTo(db, asOf);
    const live = L.activeTransactions(d);
    let savings = 0, cash = 0;
    live.forEach((t) => { const e = L.classifyTransaction(t); savings += e.savings; cash += e.cashflow; });
    const flow = live.filter((t) => L.inPeriod(t, period));
    const profit = flow.reduce((a, t) => a + L.classifyTransaction(t).profit, 0);
    const expenses = flow.filter((t) => t.type === "Expense").reduce((a, t) => a + Number(t.amount), 0);
    const loans = L.activeLoans(d);
    const outstanding = loans.reduce((a, l) => a + Math.max(0, L.loanOutstanding(l, d, asOf)), 0);
    const positions = loans.filter((l) => L.loanOutstanding(l, d, asOf) > 0).map((l) => L.loanInterestPosition(l, d, asOf));
    const unpaidInterest = positions.reduce((a, p) => a + p.unpaidInterest, 0);     // interest accrued less the part of payments applied to interest (interest first)
    const guaranteed = (db.guarantees || []).filter((g) => g.status === "Active").reduce((a, g) => a + L.guaranteeRemaining(g), 0);
    const pol = L.getPolicy(db, "loan");
    return {
      asOf, period: period || null,
      totalSavings: { value: savings, definition: "Net of all member savings, withdrawals, charges and share-outs, up to the as-of date." },
      availableCash: { value: cash, definition: "Net cash movement in the ledger (deposits, repayments, subscriptions, income minus withdrawals, disbursements, expenses)." },
      outstandingLoans: { value: outstanding, count: loans.filter((l) => L.loanOutstanding(l, d, asOf) > 0).length, definition: "Sum of Loan Payable minus repayments across booked loans." },
      interestReceivable: { value: unpaidInterest, loans: positions.length,
        definition: "Total accumulated UNPAID interest across all outstanding loans: interest accrued to date at each loan's assigned monthly interest (after its grace period, until the loan is fully repaid) less the part of repayments applied to interest (SOB rule: accumulated unpaid interest is cleared first, the remainder reduces principal). Tap for every member and loan." },
      profit: { value: profit, definition: "Profit entries recorded in the selected period." },
      expenses: { value: expenses, definition: "Expense entries recorded in the selected period." },
      members: { value: db.members.filter((m) => m.status !== "Inactive").length, definition: "Active registered members." },
      loanExposure: { pct: savings > 0 ? Math.round((outstanding / savings) * 1000) / 10 : null, guaranteed,
        definition: "Outstanding Loans / Total Savings; 'guaranteed' is the total still committed by guarantors (released progressively as borrowers repay)." },
      awaitingApproval: { value: (db.transactions || []).filter((t) => t.approvalStatus === "PendingApproval" && !t.voided).length + (db.loans || []).filter((l) => l.status === "AwaitingApproval" && !l.voided).length + (db.securities || []).filter((x) => x.status === "Proposed").length + (db.approvalRequests || []).filter((x) => x.status === "Pending").length,
        definition: "Items waiting for the Chairperson's second approval (loans, exceptional security, voids/adjustments, profit distribution, share-out)." }
    };
  }
  function loanBook(db, asOf) {
    asOf = asOf || dates.todayISO();
    return L.activeLoans(db).map((l) => LN.loanView(db, l, asOf));
  }
  function pipeline(db) {
    const c = { Pending: 0, AwaitingApproval: 0, Approved: 0, Active: 0, Cleared: 0, Declined: 0 };
    (db.loans || []).filter((l) => !l.voided).forEach((l) => { if (c[l.status] !== undefined) c[l.status]++; });
    return c;
  }
  /* Interest Receivable drill-down: every outstanding loan, how its interest arose and what is still unpaid. */
  function interestReceivable(db, asOf) {
    asOf = asOf || dates.todayISO(); const d = upTo(db, asOf);
    const rows = L.activeLoans(d).filter((l) => L.loanOutstanding(l, d, asOf) > 0).map((l) => {
      const p = L.loanInterestPosition(l, d, asOf), m = db.members.find((x) => x.id === l.memberId) || {};
      return { memberId: l.memberId, member: m.name || l.memberId, loanId: l.id, status: l.status, principal: p.principal, assignedMonthlyInterest: Number(l.assignedMonthlyInterest) || 0, disbursed: l.date, graceMonths: Number(l.graceMonths) || 0, interestStartsAfter: dates.addMonths(l.date, Number(l.graceMonths) || 0),
        monthsElapsed: dates.monthsBetween(l.date, asOf), monthsCharged: L.loanMonthsAfterGrace(l, asOf), accumulatedInterest: p.accruedInterest, paymentsMade: p.totalRepaid, paidToInterest: p.interestPaid, paidToPrincipal: p.principalPaid === null ? null : p.principalPaid + p.penaltiesPaid,
        unpaidInterest: p.unpaidInterest, principalOutstanding: p.principalOutstanding, outstanding: L.loanOutstanding(l, d, asOf), interestHistory: l.interestHistory || [], payments: L.activeTransactions(d).filter((t) => t.loanId === l.id && t.type === "Loan Repayment").map((t) => ({ date: t.date, amount: Number(t.amount), id: t.id })) };
    });
    const pol = L.getPolicy(db, "loan");
    return { asOf, rows, total: rows.reduce((a, r) => a + r.unpaidInterest, 0), accumulated: rows.reduce((a, r) => a + r.accumulatedInterest, 0), paymentsMade: rows.reduce((a, r) => a + r.paymentsMade, 0), outstanding: rows.reduce((a, r) => a + r.outstanding, 0),
      allocation: "INTEREST_FIRST", allocationConfirmed: true };
  }
  return { dashboard, loanBook, pipeline, interestReceivable };
});
