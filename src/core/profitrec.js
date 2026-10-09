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
  const api = factory(dep("dates", "dates.js"), dep("ledger", "ledger.js"), dep("fy", "fy.js"), dep("histloans", "histloans.js"), dep("reserve", "reserve.js"), dep("gov", "governance.js"));
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.profitrec = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, FY, HL, RS, G) {
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
    const woLoss = (db.historicalWriteOffs || []).filter((x) => !x.voided && Number(x.lossYear) === c.year).reduce((a, x) => a + x.principal, 0);
    const earned = interestReceived + income - expenses - woLoss, undistributed = earned - credited, av = RS.available(db, c.year);
    const groupLedger = (db.legacyAdministration || []).filter((r) => r && r.type === "Profit" && dates.isISO(r.date) && r.date >= from && r.date < to).reduce((a, r) => a + (Number(r.profitEarned) || 0), 0);
    const reserveIn = RS.live(db).filter((e) => (e.kind === "TRANSFER" || e.kind === "LOSS") && Number(e.fyYear) === c.year).reduce((a, e) => a + (e.kind === "LOSS" ? -1 : 1) * Number(e.amount), 0);   // net: gains in, losses out
    const flags = [];
    if (av.verified === null) flags.push("Group profit for " + c.label + " has not been verified by the Chairperson: nothing may move to the reserve yet.");
    if (credited > earned) flags.push("Profit credited to members (" + credited + ") is MORE than the interest recorded as received (" + earned + "): UGX " + (credited - earned) + " is unexplained by the records.");
    if (h.excess > 0) flags.push("Historical repayments of UGX " + h.excess + " were more than the interest and loan recorded as due (kept visible, not allocated).");
    if (groupLedger && groupLedger !== earned) flags.push("The archived group bank ledger records profit of " + groupLedger + " for this year; the interest-first figure is " + earned + ".");
    return { year: c.year, label: c.label, from, to: c.closedDate || null, status: c.status, interestCharged, interestReceived, interestReceivable: receivable, historicalCharged: h.interestCharged, currentCharged: cur.charged, otherIncome: income, expenses, writeOffLoss: woLoss,
      earnedRecorded: earned, profitCredited: credited, undistributed, groupLedgerProfit: groupLedger, verifiedProfit: av.verified, reservedFromYear: reserveIn, reserveAvailable: av.available, shortfall: av.shortfall, settled: (FY.byYear(db, c.year) || {}).settled || null, historicalLoanPrincipalOpenAtYearEnd: hOut.principal, historicalLoansOpenAtYearEnd: hOut.loans, flags };
  }

  /* SETTLE a completed financial year into the General Reserve Fund (Chairperson policy, 9 Oct 2026):
       verified group result = interest actually received (interest first) + other income - expenses, all taken from the recorded ledger;
       remaining after the distributions credited to members: positive -> transferred to the reserve, negative -> the loss is reflected in the reserve;
       the reserve balance (positive or negative) carries forward. Only the CURRENT, still-open year is refused (its result stays separate until it closes).
       Member savings, loans owed, member entitlements and unexplained differences are never moved: the figure is computed from records, not typed in.
       a.expectedResult pins the figure the Chairperson approved: if the records later give another figure the command refuses instead of posting. */
  function settle(db, ctx, a) {
    G.require(ctx, "reserve.manage"); a = a || {}; const c = FY.byYear(db, a.year); if (!c) throw new Error("NOT_FOUND: financial year " + a.year);
    if (c.status !== "Closed" || !c.closedDate) throw new Error("OPEN_YEAR: FY" + c.year + " has not closed; its result stays separate until its share-out and final distribution are approved");
    const rec = (db.yearCycles || []).find((x) => x.year === c.year); if (rec.settled) throw new Error("ALREADY_SETTLED: FY" + c.year + " was settled on " + rec.settled.at);
    const evidence = G.need(a.evidence, "evidence"), reason = G.need(a.reason, "reason"), p = year(db, c.year, ctx.today || dates.todayISO()), result = p.earnedRecorded;
    if (a.expectedResult !== undefined && Number(a.expectedResult) !== result) throw new Error("RESULT_DIFFERS: the records give a FY" + c.year + " result of " + result + ", not the approved " + a.expectedResult);
    const prev = rec.verifiedProfit === undefined ? null : rec.verifiedProfit;
    rec.verifiedProfit = result; rec.verifiedProfitEvidence = evidence; rec.verifiedBy = ctx.approvedBy || ctx.by; rec.verifiedAt = ctx.now;
    (rec.verifiedProfitHistory = rec.verifiedProfitHistory || []).push({ at: ctx.now, by: ctx.approvedBy || ctx.by, previous: prev, amount: result, evidence, reason });
    G.audit(db, ctx, "FinancialYear", "FY" + c.year, "Group result verified", { verifiedProfit: prev }, { verifiedProfit: result }, reason + " | evidence: " + evidence);
    const av = RS.available(db, c.year), moved = av.remaining; let entry = null;
    if (moved !== 0) entry = RS.postYearResult(db, ctx, c, moved, { evidence, reason });
    rec.settled = { at: ctx.now, by: ctx.approvedBy || ctx.by, result, credited: av.credited, reserveMovement: moved, reserveEntryId: entry ? entry.id : null };
    G.audit(db, ctx, "FinancialYear", "FY" + c.year, "Settled into the General Reserve Fund", null, rec.settled, reason);
    return { year: c.year, result, credited: av.credited, reserveMovement: moved, entry };
  }

  /* APPROVED WRITE-OFF of an uncollectible historical loan balance (Chairperson). The principal written off is a verified group loss of the year it is attributed to
     (lossYear, a CLOSED year): it lowers that year's result, and if the year was already settled the loss is also reflected in the reserve now. Written-off interest was never
     counted as earned, so it is no further loss. Nothing is ever written off automatically, and member savings are never touched. */
  function writeOff(db, ctx, a) {
    G.require(ctx, "reserve.manage"); a = a || {}; const principal = Number(a.principal) || 0;
    let c = null;
    if (principal > 0) {
      c = FY.byYear(db, a.lossYear); if (!c) throw new Error("REQUIRED: lossYear (the closed financial year whose result bears this loss)");
      if (c.status !== "Closed" || !c.closedDate) throw new Error("OPEN_YEAR: FY" + c.year + " has not closed; a loss cannot be charged to the reserve for an open year");
    }
    const rec = HL.recordWriteOff(db, ctx, a);
    if (c) {
      const y = (db.yearCycles || []).find((x) => x.year === c.year);
      if (y.settled) {
        const prev = y.verifiedProfit; y.verifiedProfit = Number(prev) - principal; (y.verifiedProfitHistory = y.verifiedProfitHistory || []).push({ at: ctx.now, by: ctx.approvedBy || ctx.by, previous: prev, amount: y.verifiedProfit, evidence: a.evidence, reason: "Approved write-off " + rec.id + ": " + a.reason });
        const entry = RS.postYearResult(db, ctx, c, -principal, { evidence: a.evidence, reason: "Approved write-off of historical loan " + rec.loanId + ": " + a.reason });
        (y.settled.lateWriteOffs = y.settled.lateWriteOffs || []).push({ id: rec.id, principal, reserveEntryId: entry ? entry.id : null });
      }
    }
    return rec;
  }
  const all = (db, asOf) => FY.table(db).map((c) => year(db, c.year, asOf));
  /* The reported "UGX 315,740": show what it is made of and which sources it can be compared with. */
  function creditedTotal(db) { const tx = L.activeTransactions(db).filter((t) => t.type === "Profit"), by = {}; tx.forEach((t) => { const y = FY.yearOfEntry(db, t); by[y] = (by[y] || 0) + Number(t.amount); }); return { total: tx.reduce((a, t) => a + Number(t.amount), 0), byYear: by, entries: tx.length }; }
  return { year, all, creditedTotal, currentLoans, settle, writeOff };
});
