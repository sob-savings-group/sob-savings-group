/* SOB core/cycle — annual subscription, year cycles and the December share-out.
   Confirmed: UGX 5,000 annual subscription (group income, never part of savings); FULL savings withdrawn in December for EVERY member,
   including members with an outstanding loan (the loan stays separately payable); members with an outstanding loan are NOT eligible
   for PROFIT distribution; history is never deleted at share-out.
   Still blocked: the profit formula. Flagged, not decided: a guarantor's withdrawn savings can leave a live loan without cover
   (shown as guaranteeAtRisk in the preview). */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./governance.js") : root.SOB.gov, isNode ? require("./loans.js") : root.SOB.loans);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.cycle = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, G, LN) {
  const SUBSCRIPTION_AMOUNT = 5000;

  /* --- subscriptions --- */
  const subscriptionEntry = (db, memberId, year) =>
    L.activeTransactions(db).find((t) => t.type === "Subscription" && t.memberId === memberId && Number(t.forYear) === Number(year));
  function recordSubscription(db, ctx, memberId, year, date) {
    G.require(ctx, "subscription.record");
    if (subscriptionEntry(db, memberId, year)) throw new Error("ALREADY_PAID: subscription " + year + " for " + memberId);
    return G.createEntry(db, ctx, { date: date || ctx.today, memberId, amount: SUBSCRIPTION_AMOUNT, type: "Subscription", purpose: "Annual subscription " + year, forYear: Number(year) });
  }
  function subscriptionCompliance(db, year) {
    const members = db.members.filter((m) => m.status !== "Inactive");
    const paid = members.filter((m) => subscriptionEntry(db, m.id, year));
    return { year: Number(year), amount: SUBSCRIPTION_AMOUNT, expected: members.length * SUBSCRIPTION_AMOUNT, collected: paid.length * SUBSCRIPTION_AMOUNT,
      paid: paid.map((m) => m.id), unpaid: members.filter((m) => !paid.includes(m)).map((m) => m.id) };
  }

  /* --- year cycles (lifetime history is never partitioned: a cycle is a status record over the same ledger) --- */
  function ensureCycle(db, year, openedDate) {
    db.yearCycles = db.yearCycles || [];
    let c = db.yearCycles.find((x) => x.year === Number(year));
    if (!c) { c = { year: Number(year), status: "Open", openedDate: openedDate || year + "-01-01", closedDate: null, shareOutId: null }; db.yearCycles.push(c); }
    return c;
  }

  /* --- December share-out --- */
  function previewShareOut(db, year, asOf) {
    const rows = db.members.filter((m) => m.status !== "Inactive").map((m) => {
      const savings = L.memberSavings(db, m.id);
      const owing = L.activeLoans(db).filter((l) => l.memberId === m.id).reduce((a, l) => a + Math.max(0, L.loanOutstanding(l, db, asOf)), 0);
      const hasLoan = owing > 0;
      return { memberId: m.id, name: m.name, savings, outstandingLoan: owing, eligibleForProfit: !hasLoan,
        savingsAction: savings <= 0 ? "NONE" : "WITHDRAW_FULL", guaranteeAtRisk: savings > 0 ? LN.committed(db, m.id) : 0, profit: "PENDING_SOB_FORMULA" };
    });
    return { year: Number(year), rows,
      totals: { withdrawable: rows.filter((r) => r.savingsAction === "WITHDRAW_FULL").reduce((a, r) => a + r.savings, 0),
        withdrawableByLoanHolders: rows.filter((r) => r.outstandingLoan > 0 && r.savingsAction === "WITHDRAW_FULL").reduce((a, r) => a + r.savings, 0),
        guaranteesAtRisk: rows.filter((r) => r.guaranteeAtRisk > 0).length,
        eligibleMembers: rows.filter((r) => r.eligibleForProfit).length, excludedMembers: rows.filter((r) => !r.eligibleForProfit).length } };
  }
  function executeShareOut(db, ctx, year, o) {
    G.require(ctx, "shareout.execute"); o = o || {}; year = Number(year);
    const date = o.date || ctx.today;
    const cycle = ensureCycle(db, year);
    if (cycle.status !== "Open") throw new Error("YEAR_CLOSED: " + year + " already closed");
    if ((db.shareOutEvents || []).some((e) => e.year === year)) throw new Error("ALREADY_EXECUTED: " + year);
    if (!dates.isISO(date) || dates.yearOf(date) !== year) throw new Error("INVALID: share-out date must fall in " + year);
    if (date.slice(5, 7) !== "12" && !(o.force && o.reason)) throw new Error("OUTSIDE_DECEMBER: share-out is a December event (force requires a reason)");
    const pv = previewShareOut(db, year, date);
    const event = { id: G.uid("SHO"), year, date, executedBy: ctx.by, entries: [], profit: { status: "PENDING_SOB_FORMULA" }, loanHolders: pv.rows.filter((r) => r.outstandingLoan > 0).map((r) => r.memberId) };
    pv.rows.filter((r) => r.savingsAction === "WITHDRAW_FULL").forEach((r) => {
      const t = G.createEntry(db, ctx, { date, memberId: r.memberId, amount: r.savings, type: "Share-Out", purpose: "December share-out " + year, shareOutId: event.id });
      event.entries.push({ memberId: r.memberId, savingsWithdrawn: r.savings, entryId: t.id });
    });
    event.totalWithdrawn = event.entries.reduce((a, e) => a + e.savingsWithdrawn, 0);
    (db.shareOutEvents = db.shareOutEvents || []).push(event);
    Object.assign(cycle, { status: "Closed", closedDate: date, shareOutId: event.id });
    ensureCycle(db, year + 1, dates.addDays(date, 1)); // next cycle begins automatically; nothing is deleted
    G.audit(db, ctx, "YearCycle", String(year), "Share-out executed and year closed", { status: "Open" }, { status: "Closed", totalWithdrawn: event.totalWithdrawn, loanHolders: event.loanHolders.length, guaranteesAtRisk: pv.totals.guaranteesAtRisk }, o.reason);
    return event;
  }
  /* Profit distribution is blocked until SOB approves a formula; this never guesses. */
  function distributeProfit(db, ctx, period) {
    G.require(ctx, "shareout.execute");
    return L.profitShare(db, period);
  }

  return { SUBSCRIPTION_AMOUNT, subscriptionEntry, recordSubscription, subscriptionCompliance, ensureCycle, previewShareOut, executeShareOut, distributeProfit };
});
