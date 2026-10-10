/* SOB core/statements — the complete member account statement and the year-end reconciliation to the General Reserve Fund.
   One data object (memberAccount) feeds the on-screen statement, the PDF and the audit; nothing is calculated twice.
   Every figure is derived from the ledger, and each statement carries its own tie-out checks (savings opening + movements = closing,
   financial-year rows add up, each loan's pieces add up to what the ledger says is owed). Nothing here posts or changes a record. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const dep = (n, f) => (isNode ? require("./" + f) : root.SOB[n]);
  const api = factory(dep("dates", "dates.js"), dep("ledger", "ledger.js"), dep("fy", "fy.js"), dep("histloans", "histloans.js"), dep("reserve", "reserve.js"), dep("profitrec", "profitrec.js"), dep("finreports", "finreports.js"), dep("reports", "reports.js"));
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.statements = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, FY, HL, RS, PRC, FRP, RP) {
  const ugx = (n) => "UGX " + Math.round(Number(n) || 0).toLocaleString("en-US");
  const num = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
  const esc = (v) => String(v === undefined || v === null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthName = (iso) => MONTHS[Number(iso.slice(5, 7)) - 1] + " " + iso.slice(0, 4);
  const TYPE_LABEL = { Savings: "Savings deposit", Withdraw: "Withdrawal", Profit: "Profit share", "Loan Disbursement": "Loan paid out", "Loan Repayment": "Loan repayment", Subscription: "Annual subscription", "Share-Out": "Annual share-out", "Bank Charge": "Bank charge", Penalty: "Penalty",
    "Savings Offset": "Savings offset against a loan", "Historical Loan Disbursement": "Earlier loan paid out", "Historical Loan Repayment": "Earlier loan repayment", Income: "Income", Expense: "Expense" };
  const BUCKET = { Savings: "deposits", Profit: "profit", Withdraw: "withdrawals", "Bank Charge": "withdrawals", "Share-Out": "shareOuts", "Savings Offset": "offsets" };
  const NOTE_ACTION = /correct|void|restor|date|adjust|reclass|annot|note|offset|write|settle|decision|resolved|approved/i;

  /* the ledger as it stood on a past day, so an "as at" statement never shows later entries */
  const asAt = (db, to) => (to >= dates.todayISO() ? db : Object.assign({}, db, { transactions: (db.transactions || []).filter((t) => t.date <= to) }));

  function loanBlock(dd, l, to, db) {
    const w = L.loanInterestPosition(l, dd, to), monthly = Number(l.assignedMonthlyInterest) || 0, grace = Number(l.graceMonths) || 0;
    const end = (l.status === "Cleared" && dates.isISO(l.datePaidFull) && l.datePaidFull < to) ? l.datePaidFull : to;
    const known = dates.isISO(l.date), elapsed = known ? dates.monthsBetween(l.date, end) : 0, chargeable = Math.max(0, elapsed - grace);
    const owed = L.loanOutstanding(l, dd, to), parts = w.principalOutstanding + w.unpaidInterest + w.unpaidPenalties;
    const disb = (dd.transactions || []).find((t) => t.loanId === l.id && t.type === "Loan Disbursement" && !t.voided);
    let left = w.principal;
    const reps = w.steps.map((x) => { left -= x.principal; return { date: x.date, ref: x.entryId, amount: x.amount, interest: x.interest, penalties: x.penalties, principal: x.principal, principalLeft: left }; });
    const gs = (db.guarantees || []).filter((g) => g.loanId === l.id && g.status !== "Declined" && g.status !== "Requested").map((g) => ({ name: (db.members.find((m) => m.id === g.guarantorId) || {}).name || g.guarantorId, id: g.guarantorId, amount: Number(g.amount), status: g.status }));
    const dateText = l.dateUnknown ? "Not established (shown at " + dates.toDisplay(l.date) + " as a placeholder until the source record is found)" : dates.toDisplay(l.date);
    const working = known ? "Calendar months from " + monthName(l.date) + " to " + monthName(end) + " = " + elapsed + "; less " + grace + " grace month" + (grace === 1 ? "" : "s") + " = " + chargeable + " interest-bearing month" + (chargeable === 1 ? "" : "s") + "; " + chargeable + " × " + ugx(monthly) + " = " + ugx(chargeable * monthly) + "." : "Start date not established, so interest months cannot be counted.";
    const payouts = (l.components || []).map((c, i) => ({ n: i + 1, date: c.date, amount: Number(c.amount), ref: c.ref || "" }));
    return { kind: "Current", ref: l.id, payouts, status: l.status, principal: w.principal, dateText, dateKnown: !l.dateUnknown, date: l.date, disbursementRef: disb ? disb.id : "", disbursementDate: disb ? disb.date : l.date, monthlyInterest: monthly, graceMonths: grace, dueDate: l.dueDate || "", elapsedMonths: elapsed, chargeableMonths: chargeable, working,
      accruedInterest: w.accruedInterest, interestPaid: w.interestPaid, interestDue: w.unpaidInterest, penalties: w.penalties, penaltiesDue: w.unpaidPenalties, principalPaid: w.principalPaid, principalLeft: w.principalOutstanding, totalRepaid: w.totalRepaid, totalOwed: owed,
      repayments: reps, guarantors: gs, interestHistory: l.interestHistory || [], rule: "Each repayment clears unpaid interest first, then penalties, then the loan itself.",
      checks: { interestMatchesRule: !known || chargeable * monthly === w.accruedInterest, partsAddUp: parts === owed } };
  }

  function histBlock(dd, l, to) {
    const p = HL.position(dd, l.id, to), st = FRP.historicalLoanStatement(dd, l.id, to);
    return { kind: "Earlier", ref: l.registerRef || l.id, id: l.id, status: p.status, date: l.date, dateText: l.dateUnknown ? "Not established" : dates.toDisplay(l.date), registerAmount: l.registerAmount === null ? "" : l.registerAmount, disbursed: p.disbursed, interestCharged: p.interestCharged, interestReceived: p.interestReceived, principalRepaid: p.principalRepaid,
      writtenOff: (p.writtenOffPrincipal || 0) + (p.writtenOffInterest || 0), interestDue: p.interestOutstanding, principalLeft: p.principalOutstanding, totalOwed: p.interestOutstanding + p.principalOutstanding, rows: st.rows, evidence: l.evidence || "",
      checks: { partsAddUp: p.disbursed + p.interestCharged - p.interestReceived - p.principalRepaid - ((p.writtenOffPrincipal || 0) + (p.writtenOffInterest || 0)) === p.interestOutstanding + p.principalOutstanding } };
  }

  function memberAccount(db, memberId, period, opts) {
    opts = opts || {}; period = period || {};
    const m = (db.members || []).find((x) => x.id === memberId); if (!m) throw new Error("NOT_FOUND: member " + memberId);
    const today = opts.today || dates.todayISO(), to = period.to && period.to < today ? period.to : today, from = period.from || "", dd = asAt(db, to);
    const hist = L.memberLifetimeHistory(dd, memberId, null).filter((t) => t.date <= to), inP = hist.filter((t) => !from || t.date >= from);
    const opening = from ? L.memberSavingsAsOf(dd, memberId, dates.addDays(from, -1)) : 0, closing = L.memberSavingsAsOf(dd, memberId, to);
    const mv = { deposits: 0, profit: 0, withdrawals: 0, shareOuts: 0, offsets: 0, other: 0 };
    inP.forEach((t) => { const e = L.classifyTransaction(t).savings; if (!e) return; const b = BUCKET[t.type] || "other"; mv[b] += (b === "deposits" || b === "profit" || b === "other") ? e : -e; });   // "other" keeps its own sign
    const net = mv.deposits + mv.profit - mv.withdrawals - mv.shareOuts - mv.offsets + mv.other;
    const savings = Object.assign({ opening, closing }, mv, { net, checks: { movementsAddUp: opening + net === closing, matchesRunningBalance: !inP.length || inP[inP.length - 1].runningSavings === closing || !!from, matchesPosition: L.memberPositionAsAt(dd, memberId, to).savings === closing } });
    const years = FY.table(dd).filter((c) => c.openedDate <= to && (!from || !c.closedDate || c.closedDate >= from)).map((c) => { const r = FY.position(dd, c.year).rows.find((x) => x.memberId === memberId) || { opening: 0, deposits: 0, profit: 0, withdrawals: 0, shareOuts: 0, other: 0, closing: 0 };
      return { label: c.label, year: c.year, opened: c.openedDate, closed: c.closedDate || null, open: c.status !== "Closed", opening: r.opening, deposits: r.deposits, profit: r.profit, withdrawals: r.withdrawals, shareOuts: r.shareOuts, other: r.other || 0, closing: r.closing, rowAddsUp: r.opening + r.deposits + r.profit - r.withdrawals - r.shareOuts + (r.other || 0) === r.closing }; });
    const only = opts.loanId || "";
    const loans = (dd.loans || []).filter((l) => l.memberId === memberId && !l.voided && (!dates.isISO(l.date) || l.date <= to) && (!only || l.id === only)).sort((a, b) => (a.date < b.date ? -1 : 1)).map((l) => loanBlock(dd, l, to, db));
    const earlier = (dd.historicalLoans || []).filter((l) => l.memberId === memberId && !l.voided && (!dates.isISO(l.date) || l.date <= to) && (!only || l.id === only || l.registerRef === only)).map((l) => histBlock(dd, l, to));
    const loanTotals = { principalLeft: loans.reduce((a, x) => a + x.principalLeft, 0), interestDue: loans.reduce((a, x) => a + x.interestDue, 0), penaltiesDue: loans.reduce((a, x) => a + x.penaltiesDue, 0), owed: loans.reduce((a, x) => a + x.totalOwed, 0), earlierOwed: earlier.reduce((a, x) => a + x.totalOwed, 0) };
    const compsOf = (t) => { const ln = t.type === "Loan Disbursement" && !t.instalment ? (dd.loans || []).find((x) => x.id === t.loanId) : null; return ln && ln.components && ln.components.length > 1 && ln.components.reduce((a, c) => a + Number(c.amount), 0) === Number(t.amount) ? ln.components : null; };
    const transactions = [].concat(...inP.filter((t) => !only || t.loanId === only).map((t) => { const cs = compsOf(t); return cs ? cs.map((c, i) => Object.assign({}, t, { id: t.id + "-P" + (i + 1), baseId: t.id, date: c.date, amount: Number(c.amount), sourceRef: c.ref || t.sourceRef, purpose: "Part " + (i + 1) + " of " + cs.length + " of one loan paid out in instalments" })) : [t]; })).map((t) => ({ loanId: t.loanId || "", date: t.date, ref: t.id, source: t.sourceRef || "", type: TYPE_LABEL[t.type] || t.type, details: [t.purpose && t.purpose !== t.type ? t.purpose : "", t.correctionNote ? "Correction: " + t.correctionNote : "", t.dateUnknown ? "Date not established" : ""].filter(Boolean).join(" · "), amount: Number(t.amount), effect: L.classifyTransaction(t).savings, balance: t.runningSavings, open: { kind: "entry", id: t.baseId || t.id } }));
    /* corrections and audit notes: nothing is overwritten; each correction sits beside the original */
    const mine = (db.transactions || []).filter((t) => t.memberId === memberId && (!only || t.loanId === only)), ids = {}; mine.forEach((t) => { ids[t.id] = 1; }); [].concat(loans, earlier).forEach((x) => { ids[x.id || x.ref] = 1; }); if (!only) ids[memberId] = 1;
    const notes = [];
    mine.forEach((t) => { if (t.date > to) return; if (t.voided) notes.push({ date: t.date, ref: t.id, note: "Voided and not counted" + (t.voidReason ? ": " + t.voidReason : "") });
      if (t.correctionNote || t.originalType || t.originalDate) notes.push({ date: t.date, ref: t.id, note: [t.correctionNote, t.originalType ? "originally recorded as " + t.originalType : "", t.originalDate ? "original date " + dates.toDisplay(t.originalDate) : ""].filter(Boolean).join(" · ") }); });
    (db.auditLog || []).filter((a) => ids[a.entityId] && NOTE_ACTION.test(a.action || "") && a.date <= to).forEach((a) => notes.push({ date: a.date, ref: a.entityId, note: (a.action || "") + (a.reason ? " — " + a.reason : "") + (a.by ? " (" + a.by + ")" : "") }));
    notes.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const pending = opts.internal ? (db.approvalRequests || []).filter((q) => q.status === "Pending" && new RegExp("\\b(" + [memberId].concat(loans.map((x) => x.ref)).join("|") + ")\\b").test(q.summary || "")).map((q) => ({ ref: q.id, label: q.label, summary: q.summary })) : [];
    const review = opts.internal ? (db.discrepancies || []).filter((d) => d.status === "Open" && new RegExp("\\b" + memberId + "\\b").test((d.subject || "") + " " + (d.summary || ""))).map((d) => ({ ref: d.id, kind: d.kind, summary: d.summary })) : [];
    /* where the year-end balance sits relative to the General Reserve Fund */
    const carried = years.filter((y) => y.closed && y.closed <= to && y.closing > 0).map((y) => ({ label: y.label, closed: y.closed, amount: y.closing }));
    const rb = RS.balance(dd, to);
    const reserve = { balance: rb, carried, text: carried.length ? carried.map((c) => c.label + " closing UGX " + num(c.amount) + " is the member's own savings left after the " + dates.longDate(c.closed) + " share-out and carried into the next year.").join(" ") + " It is not part of the General Reserve Fund, which holds only verified group profit (balance " + ugx(rb) + " as at " + dates.longDate(to) + ")." : "The General Reserve Fund holds only verified group profit and is separate from member savings (balance " + ugx(rb) + " as at " + dates.longDate(to) + ")." };
    const checks = { savingsMovements: savings.checks.movementsAddUp && savings.checks.matchesPosition, years: years.every((y) => y.rowAddsUp), loans: loans.every((x) => x.checks.interestMatchesRule && x.checks.partsAddUp), earlier: earlier.every((x) => x.checks.partsAddUp) };
    checks.all = checks.savingsMovements && checks.years && checks.loans && checks.earlier;
    return { ref: (only ? "LST-" + only + "-" : "STM-" + memberId + "-") + to.replace(/-/g, ""), kind: only ? "Loan statement" : "Member account statement", mode: only ? "loan" : "full", loanId: only, member: { id: m.id, name: m.name, phone: m.phone || "", email: m.email || "", location: m.location || "", status: m.status || "", regDate: m.regDate || "" },
      period: { from, to, text: from ? dates.longDate(from) + " – " + dates.longDate(to) : "From the start of records – " + dates.longDate(to) }, generated: opts.generated || dates.longDate(today), internal: !!opts.internal,
      savings, years, loans, earlier, loanTotals, transactions, notes, pending, review, reserve, checks };
  }

  /* ---------------- the printable statement ---------------- */
  const tbl = (cols, rows, cls) => '<table class="d' + (cls ? " " + cls : "") + '"><thead><tr>' + cols.map((c) => '<th class="' + (c.n ? "n" : "") + '">' + esc(c.h) + "</th>").join("") + "</tr></thead><tbody>" + rows.map((r) => "<tr>" + cols.map((c) => '<td class="' + (c.n ? "n" : "") + (c.k === "ref" ? " ref" : c.k === "type" ? " nw" : "") + '">' + esc(c.f ? c.f(r) : r[c.k]) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
  const kv = (rows, cls) => '<table class="sum ' + (cls || "") + '">' + rows.map((r) => "<tr" + (r[2] ? ' class="' + r[2] + '"' : "") + "><th>" + esc(r[0]) + '</th><td class="n">' + esc(typeof r[1] === "number" ? ugx(r[1]) : r[1]) + "</td></tr>").join("") + "</table>";
  const ST_CSS = '<style>.idb{display:grid;grid-template-columns:1fr 1fr;gap:2px 18px;border:1px solid #d5ddec;border-radius:6px;padding:8px 12px;background:#f9fbfe;margin:6px 0 10px}.idb div{display:flex;gap:8px}.idb b{min-width:92px;color:#41506b;font-weight:600}.sec{font-size:13px;color:#0f2a56;margin:14px 0 4px;border-bottom:2px solid #b8892b;padding-bottom:2px;break-after:avoid}table.sum tr.tot th,table.sum tr.tot td{border-top:2px solid #0f2a56;font-size:13px;color:#0f2a56}table.sum tr.sub th{padding-left:26px;font-weight:500}.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:10px;font-weight:700;background:#e1f5ec;color:#0a6e4c}.pill.w{background:#fbefd6;color:#8f5a08}.cf{font-size:10.5px;color:#41506b;margin:4px 0}.lh{display:flex;justify-content:space-between;align-items:baseline;margin:12px 0 2px;break-after:avoid}.lh b{font-size:13px;color:#0f2a56}table.d td{font-size:11px}.conf{border:1px dashed #b8892b;background:#fdf8ea;color:#5d430a;font-size:10px;padding:5px 8px;border-radius:5px;margin:8px 0}.box{break-inside:avoid}td.ref{white-space:nowrap;font-size:9.5px;letter-spacing:-.15px}td.nw{white-space:nowrap}table.d{break-inside:auto}</style>';

  function toPrintHTML(a, meta) {
    meta = Object.assign({}, meta || {});
    const s = a.savings, p = a.period, M = a.member;
    let h = ST_CSS + '<div class="idb"><div><b>Member</b><span>' + esc(M.name) + "</span></div><div><b>Member ID</b><span>" + esc(M.id) + "</span></div><div><b>Phone</b><span>" + esc(M.phone || "—") + "</span></div><div><b>Status</b><span>" + esc(M.status || "—") + "</span></div><div><b>Member since</b><span>" + esc(M.regDate ? dates.toDisplay(M.regDate) : "—") + "</span></div><div><b>Statement no.</b><span>" + esc(a.ref) + "</span></div><div><b>Period</b><span>" + esc(p.text) + "</span></div><div><b>Issued</b><span>" + esc(a.generated) + "</span></div></div>";
    h += '<div class="conf">CONFIDENTIAL — prepared for the named member only. Please do not forward. Figures are in Uganda Shillings (UGX).</div>';
    const full = a.mode !== "loan"; let k = 0; const sec = (t) => '<h3 class="sec">' + (++k) + ". " + t + "</h3>";
    if (full) h += sec("Savings summary") + kv([["Savings brought forward" + (p.from ? " (" + dates.longDate(dates.addDays(p.from, -1)) + ")" : ""), s.opening], ["Savings deposited", s.deposits], ["Profit credited", s.profit], ["Withdrawals", -s.withdrawals], ["Annual share-outs paid", -s.shareOuts]].concat(s.offsets ? [["Offset against a loan (approved)", -s.offsets]] : []).concat(s.other ? [["Other adjustments", s.other]] : []).concat([["Savings position as at " + dates.longDate(p.to) + " (closing savings)", s.closing, "tot"]])) + '<div class="cf">Savings position = savings + profit − withdrawals − share-outs. Loans are NOT deducted from it.</div>' + (a.loans.length ? sec("Owed to SOB (shown separately — not deducted from savings)") + kv([["Loan still owed", a.loans.reduce((x, l) => x + l.principalLeft, 0)], ["Interest and penalties still due", a.loans.reduce((x, l) => x + l.interestDue + l.penaltiesDue, 0)], ["Total owed on current loans", a.loanTotals.owed, "tot"]]) : "");
    if (full) h += '<div class="cf">Check: opening ' + num(s.opening) + " + movements " + num(s.net) + " = closing " + num(s.closing) + (s.checks.movementsAddUp ? ' <span class="pill">agrees with the ledger</span>' : ' <span class="pill w">DOES NOT AGREE — report to the Treasurer</span>') + "</div>";
    if (full && a.years.length) h += sec("By financial year (share-out to share-out)") + tbl([{ h: "Year", f: (y) => y.label + " (" + dates.toDisplay(y.opened) + " – " + (y.closed ? dates.toDisplay(y.closed) : "open") + ")" }, { h: "Opening", n: 1, f: (y) => num(y.opening) }, { h: "Deposits", n: 1, f: (y) => num(y.deposits) }, { h: "Profit", n: 1, f: (y) => num(y.profit) }, { h: "Withdrawn", n: 1, f: (y) => num(y.withdrawals) }, { h: "Share-out", n: 1, f: (y) => num(y.shareOuts) }, { h: "Closing", n: 1, f: (y) => num(y.closing) + (y.open ? "*" : "") }], a.years) + '<div class="cf">*Open year, to date. A closed year\'s closing balance is carried forward as the opening of the next year.</div>';
    if (full) h += '<div class="box">' + sec("Year-end savings and the General Reserve Fund") + '<div class="cf">' + esc(a.reserve.text) + "</div></div>";
    h += sec(full ? "Loans" : "Loan details");
    if (!a.loans.length && !a.earlier.length) h += '<div class="cf">No loans on record for this member in the period.</div>';
    a.loans.forEach((l) => {
      h += '<div class="box"><div class="lh"><b>Loan ' + esc(l.ref) + '</b><span class="pill ' + (l.totalOwed ? "w" : "") + '">' + esc(l.status) + "</span></div>" + kv([["Loan paid out", l.principal], ["Date paid out", l.dateText], ["Payout entry", l.disbursementRef || "—"], ["Agreed interest per month", l.monthlyInterest], ["Grace period", l.graceMonths + " month" + (l.graceMonths === 1 ? "" : "s") + (l.dueDate ? " (interest-free period ends " + dates.toDisplay(l.dueDate) + ")" : "")]]) +
        (l.payouts.length > 1 ? '<div class="cf">Paid out in ' + l.payouts.length + " parts as ONE loan; interest counts from the first payout (" + dates.toDisplay(l.payouts[0].date) + "):</div>" + tbl([{ h: "Part", f: (r) => String(r.n) }, { h: "Date", f: (r) => dates.toDisplay(r.date) }, { h: "Amount", n: 1, f: (r) => num(r.amount) }, { h: "Source", k: "ref" }], l.payouts) : "") +
        '<div class="cf">Interest working: ' + esc(l.working) + "</div>" +
        kv([["Loan paid out", l.principal], ["Interest charged to date", l.accruedInterest, "sub"], ["Interest paid", -l.interestPaid, "sub"], ["Interest still due", l.interestDue, "sub"], ["Loan repaid so far", -l.principalPaid], ["Loan still owed", l.principalLeft]].concat(l.penalties ? [["Penalties still due", l.penaltiesDue]] : []).concat([["TOTAL OWED as at " + dates.longDate(p.to), l.totalOwed, "tot"]])) +
        '<div class="cf">Working: loan still owed ' + num(l.principalLeft) + " + interest still due " + num(l.interestDue) + (l.penaltiesDue ? " + penalties " + num(l.penaltiesDue) : "") + " = " + num(l.totalOwed) + (l.checks.partsAddUp ? ' <span class="pill">agrees with the ledger</span>' : ' <span class="pill w">DOES NOT AGREE</span>') + "</div>" +
        (l.repayments.length ? tbl([{ h: "Date", f: (r) => dates.toDisplay(r.date) }, { h: "Reference", k: "ref" }, { h: "Paid", n: 1, f: (r) => num(r.amount) }, { h: "To interest", n: 1, f: (r) => num(r.interest) }, { h: "To loan", n: 1, f: (r) => num(r.principal) }, { h: "Loan left", n: 1, f: (r) => num(r.principalLeft) }], l.repayments) : '<div class="cf">No repayments recorded yet. ' + esc(l.rule) + "</div>") +
        (l.guarantors.length ? '<div class="cf">Guarantors: ' + l.guarantors.map((g) => esc(g.name) + " (" + esc(g.id) + ") " + num(g.amount)).join("; ") + "</div>" : "") + "</div>";
    });
    if (a.loans.length > 1) h += kv([["Total owed on current loans", a.loanTotals.owed, "tot"]]);
    a.earlier.forEach((l) => {
      h += '<div class="box"><div class="lh"><b>Earlier loan ' + esc(l.ref) + " (before the current register)</b><span class=\"pill " + (l.totalOwed ? "w" : "") + '">' + esc(l.status) + "</span></div>" + kv([["Paid out", l.disbursed], ["Interest charged", l.interestCharged], ["Interest received", -l.interestReceived], ["Loan repaid", -l.principalRepaid]].concat(l.writtenOff ? [["Written off (approved)", -l.writtenOff]] : []).concat([["Still owed", l.totalOwed, "tot"]])) +
        tbl([{ h: "Date", k: "date" }, { h: "Event", k: "event" }, { h: "Amount", n: 1, f: (r) => num(r.amount) }, { h: "To interest", n: 1, f: (r) => (r.interest === "" ? "" : num(r.interest)) }, { h: "To loan", n: 1, f: (r) => (r.principal === "" ? "" : num(r.principal)) }, { h: "Owed after", n: 1, f: (r) => num(r.owedAfter) }], l.rows) + "</div>";
    });
    if (full) h += sec("Every transaction") + tbl([{ h: "Date", f: (t) => dates.toDisplay(t.date) }, { h: "Ref", k: "ref" }, { h: "Transaction", k: "type" }, { h: "Details", k: "details" }, { h: "Amount", n: 1, f: (t) => num(t.amount) }, { h: "Effect on savings", n: 1, f: (t) => num(t.effect) }, { h: "Savings balance", n: 1, f: (t) => num(t.balance) }], a.transactions);
    if (full && !a.transactions.length) h += '<div class="cf">No transactions in this period.</div>';
    if (a.notes.length) h += sec("Corrections and audit notes") + '<div class="cf">Nothing is overwritten: each correction sits beside the original and is recorded in the audit trail.</div>' + tbl([{ h: "Date", f: (n) => dates.toDisplay(n.date) }, { h: "Reference", k: "ref" }, { h: "Note", k: "note" }], a.notes.slice(0, 60)) + (a.notes.length > 60 ? '<div class="cf">…and ' + (a.notes.length - 60) + " more in the audit trail.</div>" : "");
    if (a.internal && (a.pending.length || a.review.length)) h += sec("For the officers: awaiting decision") + (a.pending.length ? tbl([{ h: "Request", k: "ref" }, { h: "Action", k: "label" }, { h: "Detail", k: "summary" }], a.pending) : "") + (a.review.length ? tbl([{ h: "Register item", k: "ref" }, { h: "Kind", k: "kind" }, { h: "Detail", k: "summary" }], a.review) : "");
    h += '<p class="fine">Issued from the SOB platform; the ledger is the record of truth. ' + (a.checks.all ? "All totals on this statement were checked against the ledger." : "A total on this statement does not agree with the ledger: please report it to the Treasurer.") + "</p>";
    return RP.brandedPage((full ? "Member account statement — " : "Loan statement " + a.loanId + " — ") + M.name + " (" + M.id + ")", h, Object.assign({ period: p.text, generated: a.generated }, meta));
  }

  /* ---------------- year-end reconciliation to the General Reserve Fund (whole group) ---------------- */
  function yearEnd(db, year) {
    const sm = FY.summary(db).find((y) => y.year === Number(year)); if (!sm) throw new Error("NOT_FOUND: financial year " + year);
    const pr = PRC.all(db, dates.todayISO()).find((p) => p.year === Number(year)) || {}, st = RS.statement(db).rows.find((r) => r.year === Number(year)) || {};
    const req = (db.approvalRequests || []).filter((q) => q.status === "Pending" && q.command === "settleFinancialYear" && Number((q.args || {}).year) === Number(year));
    const members = FY.position(db, year).rows.filter((r) => r.closing).map((r) => ({ id: r.memberId, member: (db.members.find((m) => m.id === r.memberId) || {}).name || r.memberId, closing: r.closing }));
    const lines = [
      { line: "Members' savings at the end of " + sm.label + " (carried into the next year)", amount: sm.closing, note: members.length + " members hold a balance; each is the member's own money." },
      { line: "Group loan interest received in " + sm.label, amount: pr.interestReceived || 0, note: "From the loan records, interest first." },
      { line: "Profit credited to members for " + sm.label, amount: pr.profitCredited || 0, note: "Already inside the members' savings above; it does not move to the reserve." },
      { line: "Interest received less profit credited", amount: pr.undistributed || 0, note: "Verified group result left after distributions: the only money that can go to the reserve." },
      { line: "Moved to the General Reserve Fund (approved)", amount: st.transfers || 0, note: req.length ? "A transfer for this year is waiting for the Chairperson (" + req.map((q) => q.id).join(", ") + ")." : "" },
      { line: "General Reserve Fund closing balance for " + sm.label, amount: st.closing || 0, note: "Belongs to SOB collectively." }];
    const rep = { title: "Year-end reconciliation: member savings and the General Reserve Fund — " + sm.label, columns: ["line", "amount", "note"], rows: lines, totals: {}, labels: { line: "Line", amount: "UGX", note: "Note" }, members, period: dates.longDate(sm.openedDate) + " – " + (sm.closedDate ? dates.longDate(sm.closedDate) : "open"), hideTotals: true };
    rep.summary = [["Member savings carried forward are separate from the reserve", "Yes"], ["Members with a carried-forward balance", members.length]];
    return rep;
  }

  return { memberAccount, toPrintHTML, yearEnd, TYPE_LABEL };
});
