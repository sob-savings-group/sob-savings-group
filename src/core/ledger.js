/* SOB core/ledger — the single source of financial truth.
   Every dashboard figure, statement and report must call these functions.
   Loan interest is a pure, stateless calculation: nothing is ever posted for it.
   Open SOB decisions are NOT guessed here; see CONFIG_PENDING. */
(function (root, factory) {
  const deps = (typeof module === "object" && module.exports) ? require("./dates.js") : root.SOB.dates;
  const api = factory(deps);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.SOB = root.SOB || {}; root.SOB.ledger = api; }
})(typeof self !== "undefined" ? self : this, function (dates) {
  const RESTORE_WINDOW_HOURS = 48;

  // Decisions still awaiting SOB (proposal Section 7). Engines read these and refuse to guess.
  const CONFIG_PENDING = {
    profitFormula: null,           // Open Q1
    qualifyingSavingsRule: null,   // Open Q2
    guarantorSufficiencyRule: null,// Open Q3
    interestReceivableBasis: null  // Open Q7 ("accrued_to_date" | "due_today")
  };

  const activeTransactions = (db) => (db.transactions || []).filter((t) => !t.voided);
  const activeLoans = (db) => (db.loans || []).filter((l) => !l.voided);

  function classifyTransaction(t) {
    const amt = Number(t.amount) || 0;
    switch (t.type) {
      case "Savings": return { savings: amt, loan: 0, profit: 0, cashflow: amt };
      case "Withdraw":
      case "Bank Charge": return { savings: -amt, loan: 0, profit: 0, cashflow: -amt };
      case "Profit": return { savings: amt, loan: 0, profit: amt, cashflow: amt };
      case "Loan Disbursement": return { savings: 0, loan: -amt, profit: 0, cashflow: -amt };
      case "Loan Repayment": return { savings: 0, loan: amt, profit: 0, cashflow: amt };
      case "Interest":
      case "Penalty": return { savings: 0, loan: -amt, profit: 0, cashflow: 0 };
      default: return { savings: 0, loan: 0, profit: 0, cashflow: 0 };
    }
  }

  function withinRestoreWindow(record, nowMs) {
    const stamp = record.voidTimestamp || record.voidDate;
    if (!stamp) return false;
    const at = new Date(stamp).getTime();
    if (isNaN(at)) return false;
    return ((nowMs ?? dates.nowInEAT().getTime()) - at) <= RESTORE_WINDOW_HOURS * 3600 * 1000;
  }

  /* --- Loans: assignedMonthlyInterest is set per loan by Admin; SOB has no standard rate. --- */
  function loanMonthsAfterGrace(loan, asOf) {
    if (!dates.isISO(loan.date)) return 0;
    const elapsed = dates.monthsBetween(loan.date, asOf || dates.todayISO());
    return Math.max(0, elapsed - (Number(loan.graceMonths) || 0));
  }
  const loanAccumulatedInterest = (loan, asOf) =>
    loanMonthsAfterGrace(loan, asOf) * (Number(loan.assignedMonthlyInterest) || 0);
  const loanTotalPenalties = (loan, db) =>
    activeTransactions(db).filter((t) => t.loanId === loan.id && t.type === "Penalty").reduce((a, t) => a + Number(t.amount), 0);
  const loanPayable = (loan, asOf, db) =>
    Number(loan.loanAmount) + loanAccumulatedInterest(loan, asOf) + (db ? loanTotalPenalties(loan, db) : 0);
  const loanTotalRepaid = (loan, db) =>
    activeTransactions(db).filter((t) => t.loanId === loan.id && t.type === "Loan Repayment").reduce((a, t) => a + Number(t.amount), 0);
  const loanOutstanding = (loan, db, asOf) => loanPayable(loan, asOf, db) - loanTotalRepaid(loan, db);

  function memberSavings(db, memberId) {
    return activeTransactions(db).filter((t) => t.memberId === memberId)
      .reduce((a, t) => a + classifyTransaction(t).savings, 0);
  }
  const memberHasOutstandingLoan = (db, memberId, asOf) =>
    activeLoans(db).some((l) => l.memberId === memberId && loanOutstanding(l, db, asOf) > 0);

  function computeGroupTotals(db, asOf) {
    let groupSavings = 0, profitEarned = 0;
    activeTransactions(db).forEach((t) => { const e = classifyTransaction(t); groupSavings += e.savings; profitEarned += e.profit; });
    const loans = activeLoans(db);
    return {
      groupSavings, profitEarned,
      loanDisbursed: loans.reduce((a, l) => a + Number(l.loanAmount), 0),
      loansOutstanding: loans.reduce((a, l) => a + loanOutstanding(l, db, asOf), 0)
    };
  }

  /* Filter by period, always derived from dates — years are a filter, never a storage boundary. */
  function inPeriod(t, p) {
    if (!p) return true;
    if (p.year && dates.yearOf(t.date) !== p.year) return false;
    if (p.quarter && dates.quarterOf(t.date) !== p.quarter) return false;
    if (p.from && t.date < p.from) return false;
    if (p.to && t.date > p.to) return false;
    return true;
  }
  function memberLifetimeHistory(db, memberId, period) {
    let run = 0;
    return activeTransactions(db).filter((t) => t.memberId === memberId)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((t) => { run += classifyTransaction(t).savings; return { ...t, runningSavings: run }; })
      .filter((t) => inPeriod(t, period));
  }

  /* Stubs that refuse to invent SOB's rules. */
  function profitShare() {
    if (!CONFIG_PENDING.profitFormula) throw new Error("PENDING_SOB_DECISION: profit-distribution formula (Open Q1)");
    return CONFIG_PENDING.profitFormula.apply(null, arguments);
  }
  function loanEligibility(db, memberId) {
    if (!CONFIG_PENDING.qualifyingSavingsRule) throw new Error("PENDING_SOB_DECISION: qualifying-savings definition (Open Q2)");
    const q = CONFIG_PENDING.qualifyingSavingsRule(db, memberId);
    return { qualifyingSavings: q, maxLoan: 3 * q }; // 3x cap is confirmed
  }
  /* Eligibility for distribution — the loan-exclusion rule IS confirmed, independent of the formula. */
  const eligibleForDistribution = (db, memberId, asOf) => !memberHasOutstandingLoan(db, memberId, asOf);

  return {
    RESTORE_WINDOW_HOURS, CONFIG_PENDING, activeTransactions, activeLoans, classifyTransaction, withinRestoreWindow,
    loanMonthsAfterGrace, loanAccumulatedInterest, loanTotalPenalties, loanPayable, loanTotalRepaid, loanOutstanding,
    memberSavings, memberHasOutstandingLoan, computeGroupTotals, inPeriod, memberLifetimeHistory,
    profitShare, loanEligibility, eligibleForDistribution
  };
});
