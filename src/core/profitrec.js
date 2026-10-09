/* SOB core/profitrec — PROFIT RECONCILIATION, financial year by financial year.
   For each year (as decided by the share-outs, see core/fy.js) it lays side by side, from the records only:
     loan interest CHARGED, interest RECEIVED (the part of recorded repayments that cleared interest first), interest still RECEIVABLE at the year end,
     group income and expenses, the profit CREDITED to members, the profit left UNDISTRIBUTED, the sums moved to the General Reserve Fund.
   It never turns a member credit into "group profit earned" (the reported UGX 315,740 is the sum of member profit credits), never plugs a gap and never
   adjusts a balance to force agreement: when two sources disagree the difference is printed, with the evidence, as a REMAINING DIFFERENCE.
   "Verified group profit" exists only when the Chairperson has confirmed it (reserve.confirmProfit). */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const dep = (n, f) => (isNode ? require("./" + f) : root.SOB[n]);
  const api = factory(dep("dates", "dates.js"), dep("ledger", "ledger.js"), dep("fy", "fy.js"), dep("histloans", "histloans.js"), dep("reserve", "reserve.js"));
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.profitrec = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, FY, HL, RS) {
  /* Current-register loans (db.loans) in a year [from, to). */
  function currentLoans(db, from, to, asOf) {
    const end = to && to <= dates.addDays(asOf, 1) ? dates.addDays(to, -1) : asOf, start = dates.addDays(from, -1); let charged = 0, received = 0, receivable = 0, loans = 0;
    L.activeLoans(db).forEach((l) => {
      if (!dates.isISO(l.date) || l.date > end) return; loans++;
      charged += Math.max(0, L.loanAccumulatedInterest(l, end) - (l.date <= start ? L.loanAccumulatedInterest(l, start) : 0));
      const p = L.loanInterestPosition(l, db, end); p.steps.filter((x) => x.date >= from && x.date <= end).forEach((x) => { received += x.interest; }); receivable += p.unpaidInterest;
    });
    return { charged, received, receivable, loans };
  }
  function year(db, y, asOf) {
    asOf = asOf || dates.todayISO(); const c = FY.byYear(db, y); if (!c) throw new Error("NOT_FOUND: financial year " + y);
    const from = c.openedDate, to = c.closedDate || dates.addDays(asOf, 1), end = c.closedDate ? dates.addDays(c.closedDate, -1) : asOf;
    const h = HL.periodFigures(db, from, to), cur = currentLoans(db, from, to, asOf), hOut = HL.outstandingAt(db, end, from, to);
    const tx = L.activeTransactions(db).filter((t) => FY.yearOfEntry(db, t) === c.year), sum = (ty) => tx.filter((t) => t.type === ty).reduce((a, t) => a + Number(t.amount), 0);
    const credited = sum("Profit"), income = sum("Subscription") + sum("Income"), expenses = sum("Expense");
    const interestCharged = h.interestCharged + cur.charged, interestReceived = h.interestReceived + cur.received, receivable = hOut.interest + cur.receivable;
    const earned = interestReceived + income - expenses, undistributed = earned - credited, av = RS.available(db, c.year);
    const groupLedger = (db.legacyAdministration || []).filter((r) => r && r.type === "Profit" && dates.isISO(r.date) && r.date >= from && r.date < to).reduce((a, r) => a + (Number(r.profitEarned) || 0), 0);
    const reserveIn = RS.live(db).filter((e) => e.kind === "TRANSFER" && Number(e.fyYear) === c.year).reduce((a, e) => a + Number(e.amount), 0);
    const flags = [];
    if (av.verified === null) flags.push("Group profit for " + c.label + " has not been verified by the Chairperson: nothing may move to the reserve yet.");
    if (credited > earned) flags.push("Profit credited to members (" + credited + ") is MORE than the interest recorded as received (" + earned + "): UGX " + (credited - earned) + " is unexplained by the records.");
    if (h.excess > 0) flags.push("Historical repayments of UGX " + h.excess + " were more than the interest and loan recorded as due (kept visible, not allocated).");
    if (groupLedger && groupLedger !== earned) flags.push("The archived group bank ledger records profit of " + groupLedger + " for this year; the interest-first figure is " + earned + ".");
    return { year: c.year, label: c.label, from, to: c.closedDate || null, status: c.status, interestCharged, interestReceived, interestReceivable: receivable, historicalCharged: h.interestCharged, currentCharged: cur.charged, otherIncome: income, expenses,
      earnedRecorded: earned, profitCredited: credited, undistributed, groupLedgerProfit: groupLedger, verifiedProfit: av.verified, reservedFromYear: reserveIn, reserveAvailable: av.available, historicalLoanPrincipalOpenAtYearEnd: hOut.principal, historicalLoansOpenAtYearEnd: hOut.loans, flags };
  }
  const all = (db, asOf) => FY.table(db).map((c) => year(db, c.year, asOf));
  /* The reported "UGX 315,740": show what it is made of and which sources it can be compared with. */
  function creditedTotal(db) { const tx = L.activeTransactions(db).filter((t) => t.type === "Profit"), by = {}; tx.forEach((t) => { const y = FY.yearOfEntry(db, t); by[y] = (by[y] || 0) + Number(t.amount); }); return { total: tx.reduce((a, t) => a + Number(t.amount), 0), byYear: by, entries: tx.length }; }
  return { year, all, creditedTotal, currentLoans };
});
