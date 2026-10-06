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
    const accrued = loans.reduce((a, l) => a + L.loanAccumulatedInterest(l, asOf) + L.loanTotalPenalties(l, d), 0);
    const guaranteed = (db.guarantees || []).filter((g) => g.status === "Active").reduce((a, g) => a + g.amount, 0);
    return {
      asOf, period: period || null,
      totalSavings: { value: savings, definition: "Net of all member savings, withdrawals, charges and share-outs, up to the as-of date." },
      availableCash: { value: cash, definition: "Net cash movement in the ledger (deposits, repayments, subscriptions, income minus withdrawals, disbursements, expenses)." },
      outstandingLoans: { value: outstanding, count: loans.filter((l) => L.loanOutstanding(l, d, asOf) > 0).length, definition: "Sum of Loan Payable minus repayments across booked loans." },
      interestReceivable: { value: accrued, provisional: !L.CONFIG_PENDING.interestReceivableBasis,
        definition: "Interest (and penalties) accrued to date on booked loans, before repayments. Basis awaiting SOB decision (Open Q7)." },
      profit: { value: profit, definition: "Profit entries recorded in the selected period." },
      expenses: { value: expenses, definition: "Expense entries recorded in the selected period." },
      members: { value: db.members.filter((m) => m.status !== "Inactive").length, definition: "Active registered members." },
      loanExposure: { pct: savings > 0 ? Math.round((outstanding / savings) * 1000) / 10 : null, guaranteed,
        definition: "Outstanding Loans / Total Savings; 'guaranteed' is the total currently committed by guarantors." }
    };
  }
  function loanBook(db, asOf) {
    asOf = asOf || dates.todayISO();
    return L.activeLoans(db).map((l) => LN.loanView(db, l, asOf));
  }
  function pipeline(db) {
    const c = { Pending: 0, Approved: 0, Active: 0, Cleared: 0, Declined: 0 };
    (db.loans || []).filter((l) => !l.voided).forEach((l) => { if (c[l.status] !== undefined) c[l.status]++; });
    return c;
  }
  return { dashboard, loanBook, pipeline };
});
