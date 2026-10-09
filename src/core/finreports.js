/* SOB core/finreports — reports for the financial-year structure, the historical loan accounts, the profit reconciliation and the General Reserve Fund.
   Same shape as every other report ({title, columns, rows, totals, labels}) so they print on the SOB letterhead and export to CSV. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const dep = (n, f) => (isNode ? require("./" + f) : root.SOB[n]);
  const api = factory(dep("dates", "dates.js"), dep("ledger", "ledger.js"), dep("fy", "fy.js"), dep("histloans", "histloans.js"), dep("profitrec", "profitrec.js"), dep("reserve", "reserve.js"));
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.finreports = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, FY, HL, PRC, RS) {
  const R = (title, columns, rows, totals, labels) => ({ title, columns, rows, totals: totals || {}, labels: labels || {} });
  const nm = (db, id) => (db.members.find((m) => m.id === id) || {}).name || id;
  const span = (c) => dates.toDisplay(c.openedDate) + " – " + (c.closedDate ? dates.toDisplay(c.closedDate) : "now (open)");

  function financialYears(db) {
    const rows = FY.summary(db).map((y) => ({ year: y.label, from: dates.toDisplay(y.openedDate), shareOut: y.closedDate ? dates.toDisplay(y.closedDate) : "open", opening: y.opening, deposits: y.deposits, profit: y.profit, withdrawals: y.withdrawals, shareOuts: y.shareOuts, closing: y.closing, carriedForward: y.carriedForward === null ? "" : y.carriedForward }));
    const rep = R("Financial years (each closes at its approved annual share-out)", ["year", "from", "shareOut", "opening", "deposits", "profit", "withdrawals", "shareOuts", "closing", "carriedForward"], rows, { yearsDefined: rows.length },
      { year: "Financial year", from: "Began", shareOut: "Share-out held", opening: "Opening (carried in)", deposits: "Savings deposited", profit: "Profit credited", withdrawals: "Withdrawals", shareOuts: "Share-outs paid", closing: "Closing", carriedForward: "Carried forward" });
    rep.hideTotals = false; return rep;
  }
  function financialYear(db, year) {
    const p = FY.position(db, year);
    return R("Financial year " + p.label + " (" + span(p) + ")", ["memberId", "name", "opening", "deposits", "profit", "withdrawals", "shareOuts", "closing", "carriedForward"],
      p.rows.map((r) => ({ memberId: r.memberId, name: r.name, opening: r.opening, deposits: r.deposits, profit: r.profit, withdrawals: r.withdrawals, shareOuts: r.shareOuts, closing: r.closing, carriedForward: r.carriedForward === null ? "" : r.carriedForward })),
      p.totals, { memberId: "Member ID", name: "Member", opening: "Opening (carried in)", deposits: "Savings deposited", profit: "Profit credited", withdrawals: "Withdrawals", shareOuts: "Share-out paid", closing: "Closing", carriedForward: "Carried forward to next year" });
  }
  function profitReconciliation(db, asOf) {
    const rows = PRC.all(db, asOf).map((p) => ({ year: p.label, period: dates.toDisplay(p.from) + " – " + (p.to ? dates.toDisplay(p.to) : "to date"), interestCharged: p.interestCharged, interestReceived: p.interestReceived, interestReceivable: p.interestReceivable, otherIncome: p.otherIncome, expenses: p.expenses, earnedRecorded: p.earnedRecorded,
      profitCredited: p.profitCredited, undistributed: p.undistributed, groupLedger: p.groupLedgerProfit, verified: p.verifiedProfit === null ? "not verified" : p.verifiedProfit, reserve: p.reservedFromYear, notes: p.flags.join(" ") }));
    const cr = PRC.creditedTotal(db);
    return R("Profit reconciliation by financial year", ["year", "period", "interestCharged", "interestReceived", "interestReceivable", "otherIncome", "expenses", "earnedRecorded", "profitCredited", "undistributed", "groupLedger", "verified", "reserve", "notes"], rows,
      { profitCreditedToMembersAllYears: cr.total, note: "Member profit credits are NOT the group's profit earned. 'Profit earned (recorded)' is loan interest received (interest first) plus income less expenses, from the records only." },
      { year: "Financial year", period: "Period", interestCharged: "Loan interest charged", interestReceived: "Loan interest received", interestReceivable: "Interest receivable at year end", otherIncome: "Other income", expenses: "Expenses", earnedRecorded: "Profit earned (recorded)", profitCredited: "Profit credited to members", undistributed: "Earned less credited", groupLedger: "Group bank ledger (archive)", verified: "Verified by Chairperson", reserve: "Moved to General Reserve", notes: "Differences and notes" });
  }
  function historicalLoans(db, asOf) {
    const rows = (db.historicalLoans || []).filter((l) => !l.voided).map((l) => { const p = HL.position(db, l.id, asOf);
      return { member: nm(db, l.memberId), memberId: l.memberId, date: dates.toDisplay(l.date), registerAmount: l.registerAmount === null ? "" : l.registerAmount, disbursed: p.disbursed, interestCharged: p.interestCharged, interestReceived: p.interestReceived, principalRepaid: p.principalRepaid, interestUnpaid: p.interestOutstanding, principalUnpaid: p.principalOutstanding, status: p.status, register: l.registerRef }; });
    const s = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    return R("Historical loan accounts (taken before the current loan register; never part of today's loans owed)", ["memberId", "member", "date", "registerAmount", "disbursed", "interestCharged", "interestReceived", "principalRepaid", "interestUnpaid", "principalUnpaid", "status", "register"], rows,
      { disbursed: s("disbursed"), interestCharged: s("interestCharged"), interestReceived: s("interestReceived"), principalRepaid: s("principalRepaid"), interestUnpaid: s("interestUnpaid"), principalUnpaid: s("principalUnpaid"), allocation: "Interest first, oldest loan first" },
      { memberId: "Member ID", member: "Member", date: "Loan date", registerAmount: "Loan register amount", disbursed: "Disbursed", interestCharged: "Interest charged", interestReceived: "Interest received", principalRepaid: "Principal repaid", interestUnpaid: "Interest unpaid", principalUnpaid: "Principal unpaid", status: "Status", register: "Loan register reference" });
  }
  function historicalLoanStatement(db, loanId, asOf) {
    const l = (db.historicalLoans || []).find((x) => x.id === loanId); if (!l) throw new Error("NOT_FOUND: historical loan " + loanId);
    const w = HL.walk(db, l.memberId, asOf), st = w.states[loanId], rows = []; let left = 0;
    st.components.forEach((c) => rows.push({ date: c.date, event: "Loan paid out" + (c.decisionNo ? " (decision #" + c.decisionNo + ")" : ""), amount: c.amount, interest: "", principal: "" }));
    st.charges.forEach((c) => rows.push({ date: c.date, event: "Interest charged" + (c.decisionNo ? " (decision #" + c.decisionNo + ")" : ""), amount: c.amount, interest: "", principal: "" }));
    w.steps.forEach((x) => { const part = x.parts.find((q) => q.loanId === loanId); if (part) rows.push({ date: x.date, event: "Repayment" + (x.dateUnknown ? " - date not recorded in the source; listed after this date" : "") + (x.decisionNo ? " (decision #" + x.decisionNo + ")" : ""), amount: x.amount, interest: part.interest, principal: part.principal }); });
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); const out = rows.map((r) => { if (r.event.indexOf("Loan paid out") === 0) left += r.amount; else if (r.event.indexOf("Interest charged") === 0) left += r.amount; else left -= (Number(r.interest) || 0) + (Number(r.principal) || 0); return Object.assign({}, r, { date: dates.toDisplay(r.date), owedAfter: left }); });
    return R("Historical loan statement — " + nm(db, l.memberId) + " (" + l.registerRef + ")", ["date", "event", "amount", "interest", "principal", "owedAfter"], out, { evidence: l.evidence }, { date: "Date", event: "Event", amount: "Amount", interest: "To interest", principal: "To loan", owedAfter: "Owed after" });
  }
  function generalReserve(db) {
    const st = RS.statement(db), rows = st.rows.map((r) => ({ year: r.label, opening: r.opening, openingRecorded: r.openingBalanceIntroduced, transfers: r.transfers, losses: r.losses, utilization: r.utilization, closing: r.closing }));
    const ent = st.entries.map((e) => ({ date: dates.toDisplay(e.date), kind: e.kind === "OPENING" ? "Opening balance" : e.kind === "TRANSFER" ? "Transfer in" : e.kind === "LOSS" ? "Loss reflected" : "Used", amount: e.amount, authorisedBy: e.authorisedBy || "", evidence: e.evidence, reason: e.reason + (e.purpose ? " - " + e.purpose : "") }));
    const rep = R("SOB General Reserve Fund (belongs to SOB collectively, not to members)", ["year", "opening", "openingRecorded", "transfers", "losses", "utilization", "closing"], rows, { balance: st.balance, movements: ent.length }, { year: "Financial year", opening: "Opening", openingRecorded: "Opening balance recorded", transfers: "Verified profit in", losses: "Verified losses", utilization: "Used", closing: "Closing" });
    rep.entries = ent; return rep;
  }
  function reserveMovements(db) {
    const st = RS.statement(db);
    return R("General Reserve Fund: every movement with its evidence", ["date", "kind", "amount", "authorisedBy", "evidence", "reason"], st.entries.map((e) => ({ date: dates.toDisplay(e.date), kind: e.kind === "OPENING" ? "Opening balance" : e.kind === "TRANSFER" ? "Transfer in (FY" + e.fyYear + ")" : e.kind === "LOSS" ? "Loss reflected (FY" + e.fyYear + ")" : "Used", amount: e.amount, authorisedBy: e.authorisedBy || "", evidence: e.evidence, reason: e.reason + (e.purpose ? " - " + e.purpose : "") })), { balance: st.balance },
      { date: "Date", kind: "Movement", amount: "Amount", authorisedBy: "Approved by", evidence: "Supporting evidence", reason: "Reason" });
  }
  return { financialYears, financialYear, profitReconciliation, historicalLoans, historicalLoanStatement, generalReserve, reserveMovements };
});
