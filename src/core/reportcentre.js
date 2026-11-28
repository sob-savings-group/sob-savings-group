/* SOB core/reportcentre — ONE catalogue of reports for authorised officers, with the same filters everywhere:
   financial year, from/to date, member and status. Every report is built from the same ledger functions as the dashboard (core/kpis, core/ledger, core/finreports),
   so a report can never disagree with a screen. Nothing here writes anything.
   run(db, id, filters, today) -> { title, columns, labels, rows, totals, period, notes } ready for the screen, the PDF, the Excel file and the CSV. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const dep = (n, f) => (isNode ? require("./" + f) : root.SOB[n]);
  const api = factory(dep("dates", "dates.js"), dep("ledger", "ledger.js"), dep("kpis", "kpis.js"), dep("reports", "reports.js"), dep("finreports", "finreports.js"), dep("fy", "fy.js"));
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.reportcentre = api; }
})(typeof self !== "undefined" ? self : this, function (D, L, K, R, FRP, FYM) {
  const nm = (db, id) => (((db.members || []).find((m) => m.id === id)) || {}).name || id || "Group";
  const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const upTo = (db, to) => Object.assign({}, db, { transactions: (db.transactions || []).filter((t) => t.date <= to) });
  const kd = D.toDisplay;

  /* ---- the period every report uses: a financial year (from share-out to share-out), or the dates typed, or "start of records to today" ---- */
  function periodOf(db, f, today) {
    f = f || {}; let from = "", to = today, label = "", fy = null;
    if (f.year) { const c = FYM.byYear(db, f.year); if (c) { from = c.openedDate || ""; to = c.closedDate && c.closedDate < today ? c.closedDate : today; label = c.label + " · "; fy = { fy: c.year, fyOpened: c.openedDate || "", fyClosed: c.closedDate || null }; } }
    if (f.from) { from = f.from; fy = null; } if (f.to) { to = f.to > today ? today : f.to; fy = null; }
    if (from && to < from) throw new Error("INVALID: the end date is before the start date");
    return Object.assign({ from, to, text: label + (from ? D.longDate(from) + " – " + D.longDate(to) : "Start of records – " + D.longDate(to)) }, fy || {});
  }
  const inP = (p) => (t) => L.inPeriod(t, p);
  /* the date an entry counts on for this period: a share-out/withdrawal on the opening share-out day belongs to the year before (so it is before the start); anything else on the closing share-out day belongs to the next year (so it is after the end) */
  const SETT = ["Share-Out", "Withdraw"];
  const effDate = (p, t) => { if (p.fy && p.fyOpened && p.from === p.fyOpened && t.date === p.fyOpened && SETT.includes(t.type)) return D.addDays(t.date, -1); if (p.fy && p.fyClosed && p.to === p.fyClosed && t.date === p.fyClosed && !SETT.includes(t.type)) return D.addDays(t.date, 1); return t.date; };
  const upToP = (db, p) => Object.assign({}, db, { transactions: (db.transactions || []).filter((t) => effDate(p, t) <= p.to) });
  const mk = (title, columns, labels, rows, o) => Object.assign({ title, columns, labels, rows, totals: {}, notes: [] }, o || {});
  const totalsOf = (rows, cols) => { const o = {}; cols.forEach((c) => { o[c] = sum(rows, c); }); return o; };
  const live = (db) => L.activeTransactions(db);
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.id) < String(b.id) ? -1 : 1);
  const memberOk = (f) => (id) => !f.memberId || id === f.memberId;

  /* ---- the catalogue ---- */
  const DEFS = [];
  const def = (group, id, title, about, filters, build, o) => DEFS.push(Object.assign({ id, group, title, about, filters, build }, o || {}));

  /* wrap a dashboard figure so its report, the dashboard card and the PDF all come from one calculation */
  const kpi = (key, sumCols, memberKey) => (db, f, p) => {
    const r = K.report(db, key, p.fy ? { from: p.from, to: p.to, fy: p.fy, fyOpened: p.fyOpened, fyClosed: p.fyClosed } : { from: p.from, to: p.to }), mf = memberOk(f), id = f.memberId;
    let rows = r.rows; const filtered = !!id;
    if (id) rows = rows.filter((x) => (memberKey || ["memberId"]).some((k) => x[k] === id || x[k] === nm(db, id)) || (x.loanId && (db.loans || []).some((l) => l.id === x.loanId && l.memberId === id)));
    return mk(r.title.replace(/ — .*$/, ""), r.columns, r.labels, rows, { totals: Object.assign({}, filtered ? {} : r.totals, totalsOf(rows, sumCols || [])), notes: [r.definition].filter(Boolean) });
  };

  /* Savings */
  def("Savings and members", "savings", "Savings Report", "Every member's savings as at the end date.", ["period", "member"], (db, f, p) => {
    const r = kpi("totalSavings", ["savings"])(db, f, p); r.title = "Savings Report"; return r; });
  def("Savings and members", "balances", "Member Balances", "Savings, loan still owed and the net position of every member as at the end date.", ["period", "member", "status"], (db, f, p) => {
    const d = upToP(db, p), out = {}; L.activeLoansAsAt(d, p.to).forEach((l) => { out[l.memberId] = (out[l.memberId] || 0) + Math.max(0, L.loanOutstanding(l, d, p.to)); });
    const sav = {}; live(d).forEach((t) => { const e = L.classifyTransaction(t); if (e.savings && t.memberId) sav[t.memberId] = (sav[t.memberId] || 0) + e.savings; });
    const rows = (db.members || []).filter((m) => (!f.memberId || m.id === f.memberId) && (!f.status || m.status === f.status)).map((m) => ({ memberId: m.id, member: m.name, status: m.status || "", savings: sav[m.id] || 0, loanOwed: out[m.id] || 0, net: (sav[m.id] || 0) - (out[m.id] || 0) }));
    return mk("Member Balances", ["memberId", "member", "status", "savings", "loanOwed", "net"], { memberId: "Member ID", member: "Member", status: "Status", savings: "Savings (UGX)", loanOwed: "Loan owed (UGX)", net: "Savings less loan (UGX)" }, rows, { totals: totalsOf(rows, ["savings", "loanOwed", "net"]), notes: ["Loan owed is the loan plus interest charged to the date, less repayments."] }); });
  def("Savings and members", "details", "Member Details", "Each member's SOB number, name, status, phone and e-mail. Personal data: officers who may export only; keep the file private.", ["member", "status"], (db, f) => {
    const rows = (db.members || []).filter((m) => (!f.memberId || m.id === f.memberId) && (!f.status || m.status === f.status)).map((m) => ({ memberId: m.id, member: m.name, status: m.status || "", phone: m.phone || "", email: m.email || "" }));
    return mk("Member Details", ["memberId", "member", "status", "phone", "email"], { memberId: "SOB number", member: "Member", status: "Status", phone: "Phone", email: "E-mail" }, rows, { notes: ["Personal data. Share it only with a person who needs it, and never in a public place.", rows.length + " member" + (rows.length === 1 ? "" : "s") + " listed."] }); }, { personal: true });
  def("Accounts", "bankcharges", "Bank Charges Report", "Every bank charge typed on a withdrawal or a loan payout: who paid it (the member or the group) and the transaction it belongs to.", ["period", "member"], (db, f, p) => {
    const all = (db.transactions || []).filter((x) => !x.voided && x.chargeFor), by = {}; (db.transactions || []).forEach((x) => { by[x.id] = x; });
    const rows = all.filter((x) => x.date <= p.to && (!p.from || x.date >= p.from)).filter((x) => { const m = x.memberId || (by[x.chargeFor] || {}).memberId; return !f.memberId || m === f.memberId; }).sort((a, b) => (a.date < b.date ? -1 : 1)).map((x) => { const mainTx = by[x.chargeFor] || {}, who = x.memberId || mainTx.memberId || "";
      return { date: kd(x.date), memberId: who, member: nm(db, who), on: (mainTx.type || "") + (mainTx.amount ? " of " + Number(mainTx.amount).toLocaleString("en-US") : ""), paidBy: x.chargedTo === "Group" ? "Group" : "Member", amount: Number(x.amount) || 0, ref: x.chargeFor }; });
    return mk("Bank Charges Report", ["date", "memberId", "member", "on", "paidBy", "amount", "ref"], { date: "Date", memberId: "SOB number", member: "Member", on: "Charge on", paidBy: "Paid by", amount: "Charge (UGX)", ref: "Transaction" }, rows,
      { totals: { amount: sum(rows, "amount"), member: sum(rows.filter((r) => r.paidBy === "Member"), "amount"), group: sum(rows.filter((r) => r.paidBy === "Group"), "amount") }, notes: ["Member = taken from the member's savings. Group = a group expense."] }); });
  def("Savings and members", "deposits", "Deposits Report", "Savings received in the period.", ["period", "member"], (db, f, p) => kpi("savingsReceived", ["amount"], ["memberId", "member"])(db, f, p));
  def("Savings and members", "withdrawals", "Withdrawals Report", "Withdrawals and share-out payments in the period.", ["period", "member"], (db, f, p) => kpi("withdrawals", ["amount"], ["memberId", "member"])(db, f, p));
  def("Savings and members", "subscriptions", "Subscriptions Report", "Annual subscriptions received in the period.", ["period", "member"], (db, f, p) => kpi("subscriptions", ["amount"], ["memberId", "member"])(db, f, p));

  /* Loans and interest */
  def("Loans and interest", "loans", "Loan Report", "Every loan with its amount, interest, repayments and balance as at the end date.", ["period", "member", "status"], (db, f, p) => {
    const d = upToP(db, p), rows = K.loanBook(d, p.to).filter((v) => { const l = db.loans.find((x) => x.id === v.id); return l && l.date <= p.to && (!f.memberId || l.memberId === f.memberId) && (!f.status || v.status === f.status); })
      .map((v) => { const l = db.loans.find((x) => x.id === v.id); return { loanId: v.id, memberId: l.memberId, member: nm(db, l.memberId), date: kd(l.date), principal: v.principal, interest: v.accumulatedInterest, repaid: v.repaid, balance: v.balance, status: v.status, locked: v.interestLocked ? "Interest locked" : "" }; });
    return mk("Loan Report", ["loanId", "member", "date", "principal", "interest", "repaid", "balance", "status", "locked"], { loanId: "Loan", member: "Member", date: "Paid out", principal: "Loan amount (UGX)", interest: "Interest charged (UGX)", repaid: "Repaid (UGX)", balance: "Balance (UGX)", status: "Status", locked: "Interest" }, rows, { totals: totalsOf(rows, ["principal", "interest", "repaid", "balance"]) }); });
  def("Loans and interest", "outstanding", "Outstanding Loans", "Loans still owed at the end date.", ["period", "member"], (db, f, p) => { const r = kpi("outstandingLoans", ["principal", "interestCharged", "penalties", "repaid", "balance"], ["member"])(db, f, p); r.title = "Outstanding Loans"; return r; });
  def("Loans and interest", "repayments", "Loan Repayments", "Repayments received in the period.", ["period", "member"], (db, f, p) => kpi("repaymentsReceived", ["amount"], ["memberId", "member"])(db, f, p));
  def("Loans and interest", "interest", "Interest Report", "Interest charged, interest received and interest still unpaid, loan by loan, as at the end date.", ["period", "member", "status"], (db, f, p) => {
    const d = upToP(db, p), rows = L.activeLoansAsAt(d, p.to).filter((l) => (!f.memberId || l.memberId === f.memberId) && (!f.status || l.status === f.status)).map((l) => { const w = L.loanInterestPosition(l, d, p.to);
      return { loanId: l.id, member: nm(db, l.memberId), charged: w.accruedInterest, received: w.interestPaid, unpaid: w.unpaidInterest, locked: L.loanInterestLocked(l) ? "Locked" : "" }; });
    return mk("Interest Report", ["loanId", "member", "charged", "received", "unpaid", "locked"], { loanId: "Loan", member: "Member", charged: "Interest charged (UGX)", received: "Interest received (UGX)", unpaid: "Interest unpaid (UGX)", locked: "Interest" }, rows, { totals: totalsOf(rows, ["charged", "received", "unpaid"]), notes: ["Each repayment clears unpaid interest first, then the loan."] }); });
  def("Loans and interest", "disbursed", "Loans Paid Out", "Loans paid out in the period.", ["period", "member"], (db, f, p) => kpi("loansDisbursed", ["amount"], ["memberId", "member"])(db, f, p));

  /* Profit and share-out */
  def("Profit and share-out", "profit", "Profit Distribution Report", "Profit shares posted to members.", ["period", "member"], (db, f, p) => {
    const rows = []; (db.profitDistributions || []).filter((x) => x.status === "Posted" && x.date <= p.to && (!p.from || x.date >= p.from)).forEach((x) => (x.rows || []).forEach((r) => { if (!f.memberId || r.memberId === f.memberId) rows.push({ period: x.period, date: kd(x.date), member: r.name || nm(db, r.memberId), savings: r.savings, share: r.sharePct, entitlement: r.entitlement }); }));
    return mk("Profit Distribution Report", ["period", "date", "member", "savings", "share", "entitlement"], { period: "Period", date: "Posted", member: "Member", savings: "Savings used (UGX)", share: "Share (%)", entitlement: "Profit (UGX)" }, rows, { totals: totalsOf(rows, ["entitlement"]) }); });
  def("Profit and share-out", "shareout", "Share-Out Report", "What each member receives at the share-out of the chosen financial year.", ["year", "member"], (db, f, p) => {
    const y = f.year || (FYM.current(db) || { year: Number(p.to.slice(0, 4)) }).year, r = R.shareOut(db, y, p.to);
    if (r.blocked) return mk("Share-Out Report", ["member"], { member: "Member" }, [], { notes: [r.reason || "The share-out cannot be shown yet."] });
    const rows = f.memberId ? r.rows.filter((x) => x.memberId === f.memberId || x.member === nm(db, f.memberId)) : r.rows;
    return mk("Share-Out Report — Financial Year " + y, r.columns, r.labels || {}, rows, { totals: r.totals, period: "Financial Year " + y }); });
  def("Profit and share-out", "fysummary", "Financial Year Summary", "The financial year from opening to closing: deposits, profit, withdrawals and share-out.", ["year"], (db, f, p) => {
    const cur = FYM.current(db), y = f.year || (cur && cur.year);
    if (!y || !FYM.byYear(db, y)) return mk("Financial Year Summary", ["member"], { member: "Member" }, [], { notes: ["No financial year is registered yet. Each year begins on the day of the previous approved share-out."] });
    const r = FRP.financialYear(db, y); return mk(r.title, r.columns, r.labels || {}, r.rows, { totals: r.totals, period: "Financial Year " + y }); });

  /* Accounts */
  def("Accounts", "cash", "Cash Position", "Cash at the start, money in, money out and cash at the end of the period, by kind of entry.", ["period"], (db, f, p) => {
    const tx = live(db).filter((t) => L.classifyTransaction(t).cashflow !== 0); let open = 0; const inn = {}, out = {};
    tx.forEach((t) => { const c = L.classifyTransaction(t).cashflow; if (p.from && effDate(p, t) < p.from) open += c; else if (effDate(p, t) <= p.to) { if (c > 0) inn[t.type] = (inn[t.type] || 0) + c; else out[t.type] = (out[t.type] || 0) - c; } });
    const rows = [{ line: "Cash at the start", moneyIn: 0, moneyOut: 0, balance: open }]; let run = open;
    Object.keys(inn).sort().forEach((k) => { run += inn[k]; rows.push({ line: k, moneyIn: inn[k], moneyOut: 0, balance: run }); });
    Object.keys(out).sort().forEach((k) => { run -= out[k]; rows.push({ line: k, moneyIn: 0, moneyOut: out[k], balance: run }); });
    rows.push({ line: "Cash at the end", moneyIn: sum(rows, "moneyIn"), moneyOut: sum(rows, "moneyOut"), balance: run });
    return mk("Cash Position", ["line", "moneyIn", "moneyOut", "balance"], { line: "Line", moneyIn: "Money in (UGX)", moneyOut: "Money out (UGX)", balance: "Cash (UGX)" }, rows, { totals: { cashAtTheStart: open, cashAtTheEnd: run } }); });
  def("Accounts", "ledger", "General Ledger", "Every entry in date order, with the effect on cash, savings and loans.", ["period", "member"], (db, f, p) => {
    let cash = 0, sv = 0, rows = []; const all = live(db).slice().sort(byDate);
    all.forEach((t) => { const e = L.classifyTransaction(t); if (f.memberId && t.memberId === f.memberId && effDate(p, t) <= p.to) sv += e.savings; if (p.from && effDate(p, t) < p.from) { cash += e.cashflow; return; } if (effDate(p, t) > p.to) return; cash += e.cashflow;
      if (f.memberId && t.memberId !== f.memberId) return;
      rows.push({ savingsAfter: sv, date: kd(t.date), entry: t.id, member: t.memberId ? nm(db, t.memberId) : "Group", type: t.type, details: t.purpose || "", moneyIn: e.cashflow > 0 ? e.cashflow : 0, moneyOut: e.cashflow < 0 ? -e.cashflow : 0, savings: e.savings, loan: e.loan, cash }); });
    const cols = ["date", "entry", "member", "type", "details", "moneyIn", "moneyOut", "savings", "loan"].concat(f.memberId ? ["savingsAfter"] : ["cash"]);
    return mk("General Ledger", cols, { date: "Date", entry: "Entry", member: "Member", type: "Type", details: "Details", moneyIn: "Money in (UGX)", moneyOut: "Money out (UGX)", savings: "Savings effect (UGX)", loan: "Loan effect (UGX)", cash: "Cash after (UGX)", savingsAfter: "Member savings after (UGX)" }, rows, { totals: totalsOf(rows, ["moneyIn", "moneyOut", "savings", "loan"]), notes: ["Only approved entries are shown; cancelled entries and entries awaiting approval count nowhere."] }); });
  def("Accounts", "trial", "Trial Balance", "Every account with its debit or credit balance as at the end date. Debits must equal credits.", ["period"], (db, f, p) => {
    const d = upToP(db, p), tx = live(d); let cash = 0, savings = 0, exp = 0, subs = 0, other = 0, ip = 0, princ = 0;
    tx.forEach((t) => { const e = L.classifyTransaction(t); cash += e.cashflow; savings += e.savings; if (t.type === "Expense") exp += Number(t.amount) || 0; if (t.type === "Subscription") subs += Number(t.amount) || 0; if (t.type === "Income") other += Number(t.amount) || 0; });
    L.activeLoansAsAt(d, p.to).forEach((l) => { const w = L.loanInterestPosition(l, d, p.to); ip += w.interestPaid + w.penaltiesPaid; princ += Math.max(0, w.principalOutstanding); });
    const lines = [["Cash", cash, 0], ["Loans receivable (principal)", princ, 0], ["Expenses", exp, 0], ["Members' savings", 0, savings], ["Interest and penalties received", 0, ip], ["Subscriptions", 0, subs], ["Other income", 0, other]];
    const rows = lines.map(([account, dr, cr]) => ({ account, debit: dr, credit: cr })), dr = sum(rows, "debit"), cr = sum(rows, "credit"), diff = dr - cr;
    const notes = ["Interest charged but not yet paid is not an entry in the ledger, so it is not on this statement (see the Interest Report)."];
    if (diff !== 0) { rows.push({ account: "Difference not yet explained", debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0 }); notes.push("The debits and credits differ by UGX " + Math.abs(diff).toLocaleString("en-US") + ". Nothing has been adjusted to hide it."); }
    rows.push({ account: "Total", debit: sum(rows, "debit"), credit: sum(rows, "credit") });
    return mk("Trial Balance", ["account", "debit", "credit"], { account: "Account", debit: "Debit (UGX)", credit: "Credit (UGX)" }, rows, { totals: { difference: diff }, notes, balanced: diff === 0 }); });
  def("Accounts", "income", "Income and Expenses", "Income and expenses recorded in the period.", ["period"], (db, f, p) => { const r = R.incomeExpenses(db, p.fy ? { from: p.from, to: p.to, fy: p.fy, fyOpened: p.fyOpened, fyClosed: p.fyClosed } : { from: p.from, to: p.to }); return mk("Income and Expenses", r.columns, r.labels || {}, r.rows, { totals: r.totals }); });

  /* Records */
  def("Records", "audit", "Audit Report", "Every recorded action: who did it, when, to what, and why.", ["period", "member"], (db, f, p) => {
    const rows = (db.auditLog || []).filter((a) => (!p.from || a.date >= p.from) && a.date <= p.to && (!f.memberId || a.entityId === f.memberId || [a.previousValue, a.newValue].some((v) => v && v.memberId === f.memberId))).slice().sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .map((a) => ({ date: kd(a.date), time: String(a.timestamp || "").slice(11, 16), by: a.by, role: a.role, entity: a.entityType + " " + a.entityId, action: a.action, reason: a.reason || "" }));
    return mk("Audit Report", ["date", "time", "by", "role", "entity", "action", "reason"], { date: "Date", time: "Time", by: "By", role: "Role", entity: "Record", action: "Action", reason: "Reason" }, rows, { notes: [rows.length + " recorded action" + (rows.length === 1 ? "" : "s")] }); });
  def("Records", "approvals", "Approvals Report", "Requests waiting for, or decided by, the Chairperson.", ["period"], (db, f, p) => {
    const rows = (db.approvalRequests || []).filter((x) => (!p.from || x.requestedDate >= p.from) && x.requestedDate <= p.to).map((x) => ({ date: kd(x.requestedDate), action: x.label, detail: x.summary, requestedBy: x.requestedBy, status: x.status, decidedBy: x.decidedBy || "" }));
    return mk("Approvals Report", ["date", "action", "detail", "requestedBy", "status", "decidedBy"], { date: "Requested", action: "Action", detail: "Detail", requestedBy: "Requested by", status: "Status", decidedBy: "Decided by" }, rows); });

  const GROUPS = ["Savings and members", "Loans and interest", "Profit and share-out", "Accounts", "Records"];
  const CAT = { ledger: 1, deposits: 1, withdrawals: 1, subscriptions: 1, repayments: 1, disbursed: 1 };
  const catalogue = () => DEFS.map((d) => ({ id: d.id, group: d.group, title: d.title, about: d.about, personal: !!d.personal, filters: CAT[d.id] ? d.filters.concat(["category"]) : d.filters }));
  function run(db, id, filters, today) {
    const d = DEFS.find((x) => x.id === id); if (!d) throw new Error("NOT_FOUND: report " + id);
    const f = Object.assign({}, filters || {}); if (f.year) f.year = Number(f.year);
    const p = periodOf(db, f, today), rep = d.build(db, f, p);
    if (f.category && rep.columns.indexOf("details") >= 0) {   /* Category = the purpose recorded on the entry (a managed list); totals are re-added from the lines that remain */
      const want = String(f.category).trim().toLowerCase(); rep.rows = rep.rows.filter((r) => String(r.details || "").toLowerCase().indexOf(want) === 0);
      const t2 = {}; Object.keys(rep.totals || {}).forEach((k) => { if (rep.columns.indexOf(k) >= 0) t2[k] = rep.rows.reduce((a, r) => a + (Number(r[k]) || 0), 0); }); rep.totals = t2;
      if (rep.columns.indexOf("balance") >= 0 || rep.columns.indexOf("cash") >= 0) rep.notes = (rep.notes || []).concat(["Running balances count every entry; only the lines shown are filtered by category."]);
    }
    const RUN = { deposits: "Running total (UGX)", withdrawals: "Running total (UGX)", subscriptions: "Running total (UGX)", repayments: "Running total (UGX)", disbursed: "Running total (UGX)" };
    if (RUN[id]) rep.title = d.title;
    if (RUN[id] && rep.columns.indexOf("amount") >= 0 && rep.rows.length) { let run = 0; rep.rows = rep.rows.map((r) => Object.assign({}, r, { running: (run += Number(r.amount) || 0) })); rep.columns = rep.columns.concat(["running"]); rep.labels = Object.assign({}, rep.labels, { running: RUN[id] }); }
    rep.id = id; rep.period = rep.period || p.text; rep.filters = { year: f.year || "", from: p.from, to: p.to, memberId: f.memberId || "", status: f.status || "" }; rep.generated = today;
    if (f.memberId) rep.period += " · " + nm(db, f.memberId); if (f.status) rep.period += " · " + f.status; if (f.category) rep.period += " · " + f.category;
    return rep;
  }
  return { catalogue, run, GROUPS, periodOf };
});
