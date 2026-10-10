/* SOB core/kpis — every dashboard figure, derived only from the ledger (core/ledger.js).
   Each KPI carries its definition so a drill-down can always show "how this is calculated". */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./loans.js") : root.SOB.loans, isNode ? require("./cycle.js") : root.SOB.cycle);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.kpis = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, LN, C) {
  /* Financial-year periods (period.fy): the share-out day belongs to BOTH labels, so each entry on it is counted once, in the year it belongs to:
     share-out/withdrawal entries close the year that ends that day; everything else on that day opens the next year (same rule as fy.yearOfEntry). */
  const SETTLE = ["Share-Out", "Withdraw"];
  const fyEnd = (period) => (period && period.fy && period.fyClosed && period.to === period.fyClosed) ? (t) => t.date === period.to && !SETTLE.includes(t.type) : null;      // belongs to the NEXT year
  const fyStart = (period) => (period && period.fy && period.fyOpened) ? (t) => t.date === period.fyOpened && SETTLE.includes(t.type) : null;                           // belongs to the PREVIOUS year
  const upTo = (db, asOf, out) => Object.assign({}, db, { transactions: db.transactions.filter((t) => t.date <= asOf && !(out && out(t))) });
  const cls = L.classifyTransaction, sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  /* ======================================================================================================================
     ONE calculation per KPI, used by the dashboard card, its drill-down table AND its report/PDF, so they cannot disagree.
     A KPI has a BASIS that decides which date selector is financially correct:
       asAt   a balance or position (savings, loans owed, interest owed, guarantees): the figure on the period's LAST day.
       cash   a balance with movement: opening balance on the first day + money in - money out = closing balance on the last day.
       period an activity total (deposits, repayments, expenses...): what happened from the first day to the last day.
       now    a live queue (awaiting approval, loan pipeline): not a date question, always the present position.
     period = {from, to}; from "" means "since the start of the records". Nothing dated after `to` is ever counted.
     ====================================================================================================================== */
  function frame(db, period) {
    const to = (period && period.to) || dates.todayISO(), from = (period && period.from) || "";
    const oe = fyEnd(period), os = fyStart(period), d = upTo(db, to, oe), live = L.activeTransactions(d), names = {}; (db.members || []).forEach((m) => { names[m.id] = m.name; });
    const f = { db, d, to, from, live, loans: L.activeLoansAsAt(d, to), name: (id) => (id ? names[id] || id : "Group"), inP: (t) => (!from || t.date >= from) && t.date <= to && !(os && os(t)) && !(oe && oe(t)), cache: {} };
    f.pos = (l) => (f.cache[l.id] = f.cache[l.id] || L.loanInterestPosition(l, d, to));
    f.owed = (l) => L.loanOutstanding(l, d, to);
    f.loanOf = (id) => f.loans.find((l) => l.id === id);
    return f;
  }
  const kd = dates.toDisplay;
  const basisText = (f, basis) => basis === "now" ? "Right now" : basis === "asAt" ? "As at " + dates.longDate(f.to) : basis === "cash" ? (f.from ? dates.longDate(f.from) + " – " + dates.longDate(f.to) : "Start of records – " + dates.longDate(f.to)) : (f.from ? dates.longDate(f.from) + " – " + dates.longDate(f.to) : "Start of records – " + dates.longDate(f.to));
  const mk = (f, key, o) => Object.assign({ key, basis: o.basis, unit: "UGX", period: basisText(f, o.basis), asAt: f.to, from: f.from, to: f.to, labels: {}, summary: [], totals: {} }, o);

  const BUILD = {
    totalSavings(f) {
      const per = {}; let value = 0; f.live.forEach((t) => { const e = cls(t).savings; if (e) { value += e; per[t.memberId] = (per[t.memberId] || 0) + e; } });
      const rows = (f.db.members || []).map((m) => ({ memberId: m.id, name: m.name, savings: per[m.id] || 0, _open: { kind: "member", id: m.id } })).filter((r) => r.savings !== 0);
      const rest = value - sum(rows, "savings"); if (rest !== 0) rows.push({ memberId: "—", name: "Not linked to a member", savings: rest });
      return mk(f, "totalSavings", { basis: "asAt", title: "Total Savings", value, columns: ["memberId", "name", "savings"], labels: { memberId: "Member ID", name: "Member", savings: "Savings (UGX)" }, rows, totals: { totalSavings: value },
        definition: "Every member's savings as at the date: deposits and profit shares less withdrawals, bank charges and share-outs. Entries after the date, voided entries and entries awaiting approval are not counted." });
    },
    availableCash(f) {
      const cash = f.live.filter((t) => cls(t).cashflow !== 0).sort(byDate); let opening = 0, value = 0, inn = 0, out = 0;
      cash.forEach((t) => { const c = cls(t).cashflow; value += c; if (f.from && t.date < f.from) opening += c; });
      let run = opening; const rows = cash.filter(f.inP).map((t) => { const c = cls(t).cashflow; run += c; if (c > 0) inn += c; else out -= c;
        return { date: kd(t.date), member: t.memberId ? f.name(t.memberId) : "Group", type: t.type, details: t.purpose || "", moneyIn: c > 0 ? c : 0, moneyOut: c < 0 ? -c : 0, balance: run, _open: { kind: "entry", id: t.id } }; });
      return mk(f, "availableCash", { basis: "cash", title: "Available Cash", value, columns: ["date", "member", "type", "details", "moneyIn", "moneyOut", "balance"], labels: { date: "Date", member: "Member", type: "Type", details: "Details", moneyIn: "Money in", moneyOut: "Money out", balance: "Balance" }, rows,
        summary: [["Opening balance", opening], ["Money in", inn], ["Money out", out], ["Closing balance", value]], totals: { openingBalance: opening, moneyIn: inn, moneyOut: out, closingBalance: value }, opening, moneyIn: inn, moneyOut: out,
        definition: "Opening balance on the first day, plus every deposit, repayment, subscription and income, less every withdrawal, loan paid out and expense, equals the closing balance on the last day." });
    },
    outstandingLoans(f) {
      const all = f.loans.map((l) => ({ l, bal: f.owed(l) })), rows = all.filter((x) => x.bal > 0).map(({ l, bal }) => ({ loanId: l.id, member: f.name(l.memberId), disbursed: kd(l.date), principal: Number(l.loanAmount), interestCharged: L.loanAccumulatedInterest(l, f.to), penalties: L.loanTotalPenalties(l, f.d), repaid: L.loanTotalRepaid(l, f.d), balance: bal, _open: { kind: "loan", id: l.id } }));
      const value = all.reduce((a, x) => a + Math.max(0, x.bal), 0);
      return mk(f, "outstandingLoans", { basis: "asAt", title: "Outstanding Loans", value, count: rows.length, columns: ["loanId", "member", "disbursed", "principal", "interestCharged", "penalties", "repaid", "balance"], labels: { loanId: "Loan", member: "Member", disbursed: "Paid out", principal: "Loan amount", interestCharged: "Interest charged", penalties: "Penalties", repaid: "Repaid", balance: "Still owed" }, rows,
        totals: { stillOwed: value, loans: rows.length }, definition: "For each loan paid out on or before the date: loan amount plus interest charged to the date (after its grace period) plus penalties, less every repayment up to the date." });
    },
    interestReceivable(f) {
      const ir = interestReceivable(f.db, f.to), rows = ir.rows.map((r) => ({ member: r.member, loanId: r.loanId, principal: r.principal, monthlyInterest: r.assignedMonthlyInterest, disbursed: kd(r.disbursed), interestFrom: kd(r.interestStartsAfter), monthsElapsed: r.monthsElapsed, monthsCharged: r.monthsCharged, accumulatedInterest: r.accumulatedInterest, paymentsMade: r.paymentsMade, unpaidInterest: r.unpaidInterest, outstanding: r.outstanding, _open: { kind: "loan", id: r.loanId } }));
      return mk(f, "interestReceivable", { basis: "asAt", title: "Interest Receivable", value: ir.total, count: rows.length, loans: rows.length, columns: ["member", "loanId", "principal", "monthlyInterest", "disbursed", "interestFrom", "monthsElapsed", "monthsCharged", "accumulatedInterest", "paymentsMade", "unpaidInterest", "outstanding"],
        labels: { member: "Member", loanId: "Loan", principal: "Loan amount", monthlyInterest: "Monthly interest", disbursed: "Paid out", interestFrom: "Interest from", monthsElapsed: "Months elapsed", monthsCharged: "Months charged", accumulatedInterest: "Interest charged", paymentsMade: "Payments made", unpaidInterest: "Unpaid interest", outstanding: "Loan still owed" }, rows,
        totals: { unpaidInterest: ir.total, accumulatedInterest: ir.accumulated, paymentsMade: ir.paymentsMade, outstanding: ir.outstanding }, definition: "Interest charged to the date on loans still owed, less the part of repayments applied to interest. SOB rule: a repayment clears accumulated unpaid interest first; only the remainder reduces the loan." });
    },
    loanExposure(f) {
      const out = BUILD.outstandingLoans(f).value, sav = BUILD.totalSavings(f).value, gs = (f.db.guarantees || []).filter((g) => (g.status === "Active" || g.status === "Released") && !(g.dateCommitted && g.dateCommitted > f.to));
      const rows = gs.map((g) => { const l = (f.db.loans || []).find((x) => x.id === g.loanId) || {}, left = L.guaranteeRemainingAsOf(g, f.to); return { guarantor: f.name(g.guarantorId), borrower: f.name(l.memberId), loanId: g.loanId, guaranteed: Number(g.amount), released: Number(g.amount) - left, committed: left, _open: { kind: "loan", id: g.loanId } }; }).filter((r) => r.committed > 0 || r.released > 0);
      const committed = sum(rows, "committed"), pct = sav > 0 ? Math.round((out / sav) * 1000) / 10 : null;
      return mk(f, "loanExposure", { basis: "asAt", title: "Loan Exposure", unit: "%", value: pct, pct, guaranteed: committed, outstanding: out, savings: sav, columns: ["guarantor", "borrower", "loanId", "guaranteed", "released", "committed"], labels: { guarantor: "Guarantor", borrower: "Borrower", loanId: "Loan", guaranteed: "Guaranteed", released: "Released so far", committed: "Still committed" }, rows,
        summary: [["Loans still owed", out], ["Total savings", sav], ["Exposure (loans owed ÷ savings, %)", pct == null ? "n/a" : pct], ["Guarantees still committed", committed]], totals: { loansStillOwed: out, totalSavings: sav, exposurePercent: pct == null ? 0 : pct, guaranteesCommitted: committed },
        definition: "Loans still owed divided by total savings, both as at the date. 'Still committed' is what guarantors have pledged and repayments (principal reduced) have not yet released." });
    },
    members(f) {
      const rows = (f.db.members || []).filter((m) => m.status !== "Inactive" && !(dates.isISO(m.regDate) && m.regDate > f.to)).map((m) => ({ memberId: m.id, name: m.name, registered: dates.isISO(m.regDate) ? kd(m.regDate) : "", phone: m.phone || "", _open: { kind: "member", id: m.id } }));
      return mk(f, "members", { basis: "asAt", title: "Active Members", unit: "count", value: rows.length, columns: ["memberId", "name", "registered", "phone"], labels: { memberId: "Member ID", name: "Member", registered: "Registered", phone: "Phone" }, rows, totals: { members: rows.length }, definition: "Registered members who are not marked inactive, registered on or before the date." });
    },
    savingsReceived: (f) => flow(f, "savingsReceived", "Savings Received", ["Savings"], "Savings deposits recorded in the period.", true),
    withdrawals: (f) => flow(f, "withdrawals", "Withdrawals & Share-Out", ["Withdraw", "Share-Out"], "Savings withdrawn or shared out in the period.", true),
    subscriptions: (f) => flow(f, "subscriptions", "Subscriptions", ["Subscription"], "Annual subscriptions received in the period (group income, not savings).", true),
    otherIncome: (f) => flow(f, "otherIncome", "Other Income", ["Income"], "Other group income recorded in the period.", false),
    profit: (f) => flow(f, "profit", "Profit Recorded", ["Profit"], "Profit entries recorded in the period.", true),
    expenses: (f) => flow(f, "expenses", "Expenses", ["Expense"], "Expense entries recorded in the period.", false),
    loansDisbursed(f) {
      const rows = f.loans.filter((l) => dates.isISO(l.date) && (!f.from || l.date >= f.from) && l.date <= f.to).sort(byDate).map((l) => ({ date: kd(l.date), loanId: l.id, member: f.name(l.memberId), amount: Number(l.loanAmount), monthlyInterest: Number(l.assignedMonthlyInterest) || 0, graceMonths: Number(l.graceMonths) || 0, _open: { kind: "loan", id: l.id } })), value = sum(rows, "amount");
      return mk(f, "loansDisbursed", { basis: "period", title: "Loans Paid Out", value, count: rows.length, columns: ["date", "loanId", "member", "amount", "monthlyInterest", "graceMonths"], labels: { date: "Date", loanId: "Loan", member: "Member", amount: "Loan amount", monthlyInterest: "Monthly interest", graceMonths: "Grace months" }, rows, totals: { loansPaidOut: value, loans: rows.length }, definition: "Loans paid out to members in the period." });
    },
    repaymentsReceived: (f) => repay(f, "repaymentsReceived", "Loan Repayments Received", false),
    interestReceived: (f) => repay(f, "interestReceived", "Interest Received", true)
  };
  function flow(f, key, title, types, definition, plus) {
    const rows = f.live.filter((t) => types.includes(t.type) && f.inP(t)).sort(byDate).map((t) => ({ date: kd(t.date), member: t.memberId ? f.name(t.memberId) : "Group", type: t.type, details: t.purpose || "", amount: Number(t.amount), _open: { kind: "entry", id: t.id } })), value = sum(rows, "amount");
    return mk(f, key, { basis: "period", title, value, count: rows.length, columns: ["date", "member", "type", "details", "amount"], labels: { date: "Date", member: "Member", type: "Type", details: "Details", amount: "Amount" }, rows, totals: { [key]: value, entries: rows.length }, definition });
  }
  /* Each repayment is split exactly as the SOB rule applies it (interest first, then penalties, then principal) - the same walk that releases guarantees. */
  function repay(f, key, title, interestOnly) {
    const step = {}; f.loans.forEach((l) => { if (f.live.some((t) => t.loanId === l.id && t.type === "Loan Repayment" && f.inP(t))) f.pos(l).steps.forEach((x) => { step[x.entryId] = x; }); });
    const rows = f.live.filter((t) => t.type === "Loan Repayment" && f.inP(t)).sort(byDate).map((t) => { const x = step[t.id], amt = Number(t.amount), i = x ? x.interest : 0, pe = x ? x.penalties : 0, p = x ? x.principal : 0, loan = (f.db.loans || []).find((l) => l.id === t.loanId) || {};
      return { date: kd(t.date), member: f.name(t.memberId || loan.memberId), loanId: t.loanId || "", payment: amt, interest: i, penalties: pe, loanReduced: p, unallocated: amt - i - pe - p, _open: { kind: "loan", id: t.loanId } }; }).filter((r) => !interestOnly || r.interest > 0);
    const value = interestOnly ? sum(rows, "interest") : sum(rows, "payment"), tot = { [key]: value, interest: sum(rows, "interest"), penalties: sum(rows, "penalties"), loanReduced: sum(rows, "loanReduced") }; const un = sum(rows, "unallocated"); if (un) tot.notSplit = un;
    return mk(f, key, { basis: "period", title, value, count: rows.length, columns: ["date", "member", "loanId", "payment", "interest", "penalties", "loanReduced"].concat(rows.some((r) => r.unallocated) ? ["unallocated"] : []), labels: { date: "Date", member: "Member", loanId: "Loan", payment: "Payment", interest: "Interest part", penalties: "Penalty part", loanReduced: "Loan reduced", unallocated: "Not split" }, rows, totals: tot,
      definition: interestOnly ? "The interest part of repayments received in the period. SOB rule: each repayment clears accumulated unpaid interest first." : "Loan repayments received in the period, each split into interest and the amount that reduced the loan (SOB rule: interest first)." });
  }
  const KEYS = Object.keys(BUILD);
  /* The total of the entries listed in the drill-down, computed independently of the card; the screen shows both and says whether they tie. */
  const TIE = { totalSavings: (d) => sum(d.rows, "savings"), availableCash: (d) => (d.rows.length ? d.rows[d.rows.length - 1].balance : d.opening), outstandingLoans: (d) => sum(d.rows, "balance"), interestReceivable: (d) => sum(d.rows, "unpaidInterest"), loanExposure: (d) => sum(d.rows, "committed"), members: (d) => d.rows.length,
    loansDisbursed: (d) => sum(d.rows, "amount"), repaymentsReceived: (d) => sum(d.rows, "payment"), interestReceived: (d) => sum(d.rows, "interest") };
  const detail = (db, key, period) => { if (!BUILD[key]) throw new Error("Unknown KPI: " + key); const d = BUILD[key](frame(db, period)); d.rowsTotal = (TIE[key] || ((x) => sum(x.rows, "amount")))(d); d.tied = key === "loanExposure" ? d.rowsTotal === d.guaranteed : d.rowsTotal === d.value; return d; };
  /* The dashboard: every KPI computed once for the chosen period (a card shows value + basis; a click opens report(key) for the same period). */
  function overview(db, period) { const f = frame(db, period), o = {}; KEYS.forEach((k) => { o[k] = BUILD[k](f); }); o.awaitingApproval = awaiting(db); o.period = { from: f.from, to: f.to }; return o; }
  /* The report/PDF behind a KPI: the very same detail, in the shape every printable report uses. */
  function report(db, key, period, opt) {
    const d = detail(db, key, period), clean = (r) => { const o = {}; Object.keys(r).forEach((k) => { if (k !== "_open") o[k] = r[k]; }); return o; };
    return { title: d.title + " — " + d.period, columns: d.columns, labels: d.labels, rows: opt && opt.open ? d.rows : d.rows.map(clean), totals: d.totals, summary: d.summary, period: d.period, kpi: { key, value: d.value, basis: d.basis, unit: d.unit, rowsTotal: d.rowsTotal, tied: d.tied }, definition: d.definition, hideTotals: d.summary.length > 0 };
  }
  const awaiting = (db) => (db.transactions || []).filter((t) => t.approvalStatus === "PendingApproval" && !t.voided).length + (db.loans || []).filter((l) => l.status === "AwaitingApproval" && !l.voided).length + (db.securities || []).filter((x) => x.status === "Proposed").length + (db.approvalRequests || []).filter((x) => x.status === "Pending").length;
  /* Older call shape kept for callers that only know an as-at date and an optional year/quarter/from/to filter. */
  function dashboard(db, asOf, period) {
    asOf = asOf || dates.todayISO(); const p = period || {}; let from = p.from || "", to = asOf;
    if (p.year) { const a = p.year + "-" + (p.quarter ? String((p.quarter - 1) * 3 + 1).padStart(2, "0") : "01") + "-01"; if (!from || a > from) from = a; if (p.quarter) { const e = dates.addDays(dates.addMonths(a, 3), -1); if (e < to) to = e; } else if (p.year + "-12-31" < to) to = p.year + "-12-31"; }
    if (p.to && p.to < to) to = p.to;
    const o = overview(db, p.fy ? { from, to, fy: p.fy, fyOpened: p.fyOpened, fyClosed: p.fyClosed } : { from, to });
    return { asOf, period: period || null, totalSavings: o.totalSavings, availableCash: o.availableCash, outstandingLoans: o.outstandingLoans, interestReceivable: o.interestReceivable, profit: o.profit, expenses: o.expenses, members: o.members,
      loanExposure: o.loanExposure, awaitingApproval: { value: o.awaitingApproval, definition: "Items waiting for the Chairperson's second approval (loans, exceptional security, voids/adjustments, profit distribution, share-out)." } };
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
    const rows = L.activeLoansAsAt(d, asOf).filter((l) => L.loanOutstanding(l, d, asOf) > 0).map((l) => {
      const p = L.loanInterestPosition(l, d, asOf), m = db.members.find((x) => x.id === l.memberId) || {};
      return { memberId: l.memberId, member: m.name || l.memberId, loanId: l.id, status: l.status, principal: p.principal, assignedMonthlyInterest: Number(l.assignedMonthlyInterest) || 0, disbursed: l.date, dateUnknown: !!l.dateUnknown, graceMonths: Number(l.graceMonths) || 0, interestStartsAfter: dates.addMonths(l.date, Number(l.graceMonths) || 0),
        monthsElapsed: dates.monthsBetween(l.date, asOf), monthsCharged: L.loanMonthsAfterGrace(l, asOf), accumulatedInterest: p.accruedInterest, paymentsMade: p.totalRepaid, paidToInterest: p.interestPaid, paidToPrincipal: p.principalPaid === null ? null : p.principalPaid + p.penaltiesPaid,
        unpaidInterest: p.unpaidInterest, principalOutstanding: p.principalOutstanding, outstanding: L.loanOutstanding(l, d, asOf), interestHistory: l.interestHistory || [], payments: L.activeTransactions(d).filter((t) => t.loanId === l.id && t.type === "Loan Repayment").map((t) => ({ date: t.date, amount: Number(t.amount), id: t.id })) };
    });
    const pol = L.getPolicy(db, "loan");
    return { asOf, rows, total: rows.reduce((a, r) => a + r.unpaidInterest, 0), accumulated: rows.reduce((a, r) => a + r.accumulatedInterest, 0), paymentsMade: rows.reduce((a, r) => a + r.paymentsMade, 0), outstanding: rows.reduce((a, r) => a + r.outstanding, 0),
      allocation: "INTEREST_FIRST", allocationConfirmed: true };
  }
  return { dashboard, overview, detail, report, awaiting, KEYS, loanBook, pipeline, interestReceivable };
});
