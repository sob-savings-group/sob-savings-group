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
    qualifyingSavingsRule: null,   // retired: total savings, 3x guideline (loanEligibility)
    repaymentAllocation: null,     // interest-first vs principal-first: awaiting SOB (split is not recorded until decided)
    interestReceivableBasis: null  // Open Q7 ("accrued_to_date" | "due_today")
  };

  /* --- policy: SOB-approved settings kept IN the ledger (db.policy), so they persist and are audited. Nothing here invents a rule:
     every default is either confirmed by SOB or an explicit, visible, changeable setting. --- */
  const POLICY_DEFAULTS = {
    approval: { requiredTypes: [], loanSecondApproval: false },                       // WHICH items need the Chairperson is SOB's call; none by default
    loan: { guidelineMultiple: 3,                                                      // confirmed: standard guideline up to 3x savings
            guaranteeCover: "SHORTFALL",                                               // guarantors back the part of a loan beyond the 3x guideline ("FULL_LOAN" = back the whole loan)
            repaymentAllocation: "INTEREST_FIRST", allocationConfirmed: false },       // how repayments split interest/principal for the Interest Receivable display
    profit: { factors: [{ id: "LOAN_HOLDER_EXCLUSION", kind: "eligibility", name: "Members with an outstanding loan do not share in profit", approvedBy: "SOB (confirmed rule)", approvalRef: "SOB rules: loan-holders get no profit" }] }
  };
  const getPolicy = (db, key) => { const rec = ((db && db.policy) || []).find((p) => p.id === key) || {}; return Object.assign({}, POLICY_DEFAULTS[key] || {}, rec); };

  // Entries awaiting/failed second-person approval never count toward any figure.
  const isCounted = (t) => !t.voided && (t.approvalStatus === undefined || t.approvalStatus === "Approved");
  const activeTransactions = (db) => (db.transactions || []).filter(isCounted);
  // Loans that are not (yet / any longer) booked never count toward outstanding or exposure.
  const NOT_BOOKED = ["Pending", "AwaitingApproval", "Approved", "Declined", "Reversed"];
  const activeLoans = (db) => (db.loans || []).filter((l) => !l.voided && !NOT_BOOKED.includes(l.status));

  function classifyTransaction(t) {
    const amt = Number(t.amount) || 0;
    switch (t.type) {
      case "Savings": return { savings: amt, loan: 0, profit: 0, cashflow: amt };
      case "Withdraw":
      case "Bank Charge": return { savings: -amt, loan: 0, profit: 0, cashflow: -amt };
      case "Profit": return { savings: amt, loan: 0, profit: amt, cashflow: amt };
      case "Loan Disbursement": return { savings: 0, loan: -amt, profit: 0, cashflow: -amt };
      case "Loan Repayment": return { savings: 0, loan: amt, profit: 0, cashflow: amt };
      // Group-level movements: they change cash, never a member's savings.
      // (CONFIRMED by SOB: the UGX 5,000 annual subscription is group income, separate from member savings.)
      case "Subscription":
      case "Income": return { savings: 0, loan: 0, profit: 0, cashflow: amt };
      case "Expense": return { savings: 0, loan: 0, profit: 0, cashflow: -amt };
      case "Share-Out": return { savings: -amt, loan: 0, profit: 0, cashflow: -amt };
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
  // A cleared loan stops accruing on the day it was cleared (otherwise "months to today" would revive its balance).
  const effectiveAsOf = (loan, asOf) =>
    (loan.status === "Cleared" && dates.isISO(loan.datePaidFull)) ? loan.datePaidFull : (asOf || dates.todayISO());
  function loanMonthsAfterGrace(loan, asOf) {
    if (!dates.isISO(loan.date)) return 0;
    const elapsed = dates.monthsBetween(loan.date, effectiveAsOf(loan, asOf));
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
  /* --- guarantees: the guarantor's own money committed to other people's loans. Committed savings stay in the account (they are still
     the guarantor's savings) but are NOT available to withdraw until released by repayments / clearance. --- */
  const guaranteeRemaining = (g) => Math.max(0, Number(g.amount) - Number(g.releasedAmount || 0));
  const liveGuarantee = (g) => g.status === "Active";
  const memberCommitted = (db, memberId) => (db.guarantees || []).filter((g) => g.guarantorId === memberId && liveGuarantee(g)).reduce((a, g) => a + guaranteeRemaining(g), 0);
  const memberAvailable = (db, memberId) => memberSavings(db, memberId) - memberCommitted(db, memberId);
  const memberPosition = (db, memberId) => { const savings = memberSavings(db, memberId), committed = memberCommitted(db, memberId); return { savings, committed, available: savings - committed, withdrawable: Math.max(0, savings - committed) }; };

  /* --- loan interest position: how much of the money repaid went to interest and how much interest is still unpaid.
     Allocation order is db.policy "loan".repaymentAllocation (INTEREST_FIRST by default); repayments are walked in date order so interest
     accrued AFTER a payment is still unpaid. Invariant: principalOutstanding + unpaidInterest + unpaidPenalties == loanOutstanding. --- */
  function loanInterestPosition(loan, db, asOf) {
    asOf = asOf || dates.todayISO();
    const policy = getPolicy(db, "loan"), principal = Number(loan.loanAmount) || 0;
    const reps = activeTransactions(db).filter((t) => t.loanId === loan.id && t.type === "Loan Repayment" && t.date <= effectiveAsOf(loan, asOf)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const pens = activeTransactions(db).filter((t) => t.loanId === loan.id && t.type === "Penalty");
    let interestPaid = 0, principalPaid = 0, penaltiesPaid = 0;
    reps.forEach((t) => {
      let amt = Number(t.amount);
      const interestDue = Math.max(0, loanAccumulatedInterest(loan, t.date) - interestPaid);
      const penDue = Math.max(0, pens.filter((x) => x.date <= t.date).reduce((a, x) => a + Number(x.amount), 0) - penaltiesPaid);
      const principalDue = Math.max(0, principal - principalPaid);
      const order = policy.repaymentAllocation === "PRINCIPAL_FIRST" ? [["principal", principalDue], ["interest", interestDue], ["pen", penDue]] : [["interest", interestDue], ["pen", penDue], ["principal", principalDue]];
      order.forEach(([k, due]) => { const x = Math.min(amt, due); amt -= x; if (k === "interest") interestPaid += x; else if (k === "pen") penaltiesPaid += x; else principalPaid += x; });
      if (amt > 0) principalPaid += amt;                                     // overpayment is kept visible, never dropped
    });
    const e = effectiveAsOf(loan, asOf), accrued = loanAccumulatedInterest(loan, e), penTotal = pens.reduce((a, x) => a + Number(x.amount), 0);
    return { principal, accruedInterest: accrued, penalties: penTotal, interestPaid, penaltiesPaid, principalPaid, unpaidInterest: Math.max(0, accrued - interestPaid), unpaidPenalties: Math.max(0, penTotal - penaltiesPaid),
      principalOutstanding: principal - principalPaid, totalRepaid: interestPaid + penaltiesPaid + principalPaid, allocation: policy.repaymentAllocation, allocationConfirmed: !!policy.allocationConfirmed };
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
  /* SOB rule: a member normally qualifies mainly on their TOTAL savings, standard guideline up to 3x. It is a guideline, not a hard stop:
     a loan beyond it may continue when guarantors / approved security back the shortfall (see loans.assessLoan). */
  function loanEligibility(db, memberId) {
    const q = memberSavings(db, memberId), mult = Number(getPolicy(db, "loan").guidelineMultiple) || 3;
    return { qualifyingSavings: q, multiple: mult, maxLoan: mult * q };
  }
  /* Eligibility for distribution — the loan-exclusion rule IS confirmed, independent of the formula. */
  function allocateRepayment() {
    if (!CONFIG_PENDING.repaymentAllocation) throw new Error("PENDING_SOB_DECISION: repayment allocation - interest first or principal first (awaiting SOB)");
    return CONFIG_PENDING.repaymentAllocation.apply(null, arguments);
  }
  const eligibleForDistribution = (db, memberId, asOf) => !memberHasOutstandingLoan(db, memberId, asOf);

  return {
    RESTORE_WINDOW_HOURS, CONFIG_PENDING, allocateRepayment, NOT_BOOKED, effectiveAsOf, isCounted, activeTransactions, activeLoans, classifyTransaction, withinRestoreWindow,
    loanMonthsAfterGrace, loanAccumulatedInterest, loanTotalPenalties, loanPayable, loanTotalRepaid, loanOutstanding,
    POLICY_DEFAULTS, getPolicy, guaranteeRemaining, liveGuarantee, memberCommitted, memberAvailable, memberPosition, loanInterestPosition,
    memberSavings, memberHasOutstandingLoan, computeGroupTotals, inPeriod, memberLifetimeHistory,
    profitShare, loanEligibility, eligibleForDistribution
  };
});
