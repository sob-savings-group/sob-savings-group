/* KPI -> drill-down -> underlying transactions -> report/PDF: for every KPI and every kind of period, ONE calculation feeds them all, and a
   past date really shows the position on that date (a ledger truncated to that date gives the same answer). */
const assert = require("assert");
require("../src/core/ledger.js").POLICY_DEFAULTS.loan.guarantorPolicyStart = "2020-01-01";   // these tests exercise the guarantor rules, which SOB starts on 1 Jan 2027 in production
const D = require("../src/core/dates.js"), L = require("../src/core/ledger.js"), G = require("../src/core/governance.js"), LN = require("../src/core/loans.js"), K = require("../src/core/kpis.js"), R = require("../src/core/reports.js");
let pass = 0, f = 0; const t = (n, fn) => { try { fn(); pass++; console.log("  ok  " + n); } catch (e) { f++; process.exitCode = 1; console.log("FAIL  " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 5).join("\n      ")); } };
const U = { admin: { name: "Super Admin", id: "U1", role: "Admin" }, chair: { name: "Chair", id: "U2", role: "Chairperson" } };
const at = (day, who) => G.makeCtx(U[who || "admin"], { today: day, now: day + "T09:00:00.000Z" });
const mem = (id, day) => G.makeCtx({ name: "m" + id, id, role: "Member", memberId: id }, { today: day, now: day + "T09:00:00.000Z" });
const NAMES = ["A", "B", "C", "D", "E", "F"];
function scenario() {
  const db = { members: NAMES.map((x, i) => ({ id: "SOB-00" + (i + 1), name: "Member " + x, status: "Active", regDate: i === 5 ? "2026-06-01" : "2025-01-01" })), transactions: [], loans: [], guarantees: [], auditLog: [] };
  const add = (day, id, amount, type, purpose) => G.createEntry(db, at(day), { date: day, memberId: id, amount, type, purpose });
  [["2026-01-05", "SOB-001", 50000], ["2026-01-12", "SOB-002", 300000], ["2026-01-20", "SOB-003", 120000], ["2026-02-02", "SOB-004", 80000], ["2026-02-15", "SOB-001", 25000], ["2026-03-10", "SOB-005", 200000], ["2026-04-05", "SOB-003", 40000], ["2026-06-10", "SOB-006", 30000], ["2026-07-07", "SOB-002", 100000], ["2026-09-01", "SOB-001", 15000]].forEach(([d, m, a]) => add(d, m, a, "Savings"));
  add("2026-05-20", "SOB-004", 10000, "Withdraw"); add("2026-02-10", "", 5000, "Subscription", "Annual subscription"); add("2026-03-01", "", 3000, "Expense", "stationery"); add("2026-04-15", "", 7000, "Income", "bank interest"); add("2026-06-30", "SOB-005", 9000, "Profit", "Profit distribution");
  // loan 1: guaranteed by SOB-002, repaid partly (interest first), then cleared
  const l1 = LN.applyForLoan(db, at("2026-02-01"), "SOB-001", 100000); LN.addGuarantee(db, at("2026-02-02"), l1.id, "SOB-002", 40000); LN.acceptGuarantee(db, mem("SOB-002", "2026-02-02"), db.guarantees[0].id);
  LN.approveLoan(db, at("2026-02-03"), l1.id); LN.approveLoan(db, at("2026-02-03", "chair"), l1.id); LN.disburseLoan(db, at("2026-02-03"), l1.id, { date: "2026-02-03", assignedMonthlyInterest: 10000, graceMonths: 3 });
  LN.repayLoan(db, at("2026-04-10"), l1.id, 20000, "2026-04-10"); LN.repayLoan(db, at("2026-07-15"), l1.id, 50000, "2026-07-15");
  // loan 2: SOB-003, interest-bearing, still running
  const l2 = LN.applyForLoan(db, at("2026-05-01"), "SOB-003", 60000); LN.approveLoan(db, at("2026-05-03"), l2.id); LN.approveLoan(db, at("2026-05-03", "chair"), l2.id); LN.disburseLoan(db, at("2026-05-05"), l2.id, { date: "2026-05-05", assignedMonthlyInterest: 6000, graceMonths: 1 });
  LN.repayLoan(db, at("2026-08-01"), l2.id, 4000, "2026-08-01");
  return { db, l1, l2 };
}
const TODAY = "2026-10-07", P = (k) => D.presetPeriod(k, TODAY), periods = [P("month"), P("lastMonth"), P("quarter"), P("year"), P("lastYear"), P("all"), D.customPeriod("2026-02-01", "2026-06-30", TODAY), D.customPeriod("2026-07-15", "2026-07-15", TODAY), D.customPeriod("2026-04-30", "2026-04-30", TODAY), D.customPeriod("2026-03-01", "2026-09-30", TODAY)];
const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

t("every KPI: dashboard value = report value = sum of the drill-down rows, for every period type", () => {
  const { db } = scenario();
  for (const p of periods) {
    const o = K.overview(db, p);
    K.KEYS.forEach((k) => {
      const d = K.detail(db, k, p), rep = K.report(db, k, p), tag = k + " @ " + p.text;
      assert.ok(d.tied, tag + " drill-down total ties to the card (" + d.rowsTotal + " vs " + d.value + ")"); assert.deepEqual(o[k].value, d.value, tag + " card vs detail"); assert.deepEqual(rep.kpi.value, d.value, tag + " report vs detail"); assert.ok(rep.rows.every((r) => !("_open" in r)), "no internals in the report");
      if (k === "totalSavings") assert.equal(sum(d.rows, "savings"), d.value, tag);
      else if (k === "availableCash") { assert.equal(d.opening + d.moneyIn - d.moneyOut, d.value, tag + " opening+in-out=closing"); assert.equal(d.rows.length ? d.rows[d.rows.length - 1].balance : d.opening, d.value, tag + " running balance"); assert.equal(sum(d.rows, "moneyIn"), d.moneyIn); assert.equal(sum(d.rows, "moneyOut"), d.moneyOut); }
      else if (k === "outstandingLoans") assert.equal(sum(d.rows, "balance"), d.value, tag);
      else if (k === "interestReceivable") assert.equal(sum(d.rows, "unpaidInterest"), d.value, tag);
      else if (k === "loanExposure") assert.equal(sum(d.rows, "committed"), d.guaranteed, tag);
      else if (k === "members") assert.equal(d.rows.length, d.value, tag);
      else if (k === "repaymentsReceived") { assert.equal(sum(d.rows, "payment"), d.value, tag); d.rows.forEach((r) => assert.equal(r.interest + r.penalties + r.loanReduced + r.unallocated, r.payment, tag + " split adds up")); }
      else if (k === "interestReceived") assert.equal(sum(d.rows, "interest"), d.value, tag);
      else assert.equal(sum(d.rows, k === "loansDisbursed" ? "amount" : "amount"), d.value, tag);
    });
  }
});
t("activity KPIs list exactly the ledger entries of that type inside the period (nothing outside it)", () => {
  const { db } = scenario(), live = L.activeTransactions(db);
  for (const p of periods) [["savingsReceived", ["Savings"]], ["expenses", ["Expense"]], ["subscriptions", ["Subscription"]], ["profit", ["Profit"]], ["otherIncome", ["Income"]], ["withdrawals", ["Withdraw", "Share-Out"]]].forEach(([k, types]) => {
    const want = live.filter((x) => types.includes(x.type) && x.date <= p.to && (!p.from || x.date >= p.from)).map((x) => x.id).sort(), got = K.detail(db, k, p).rows.map((r) => r._open.id).sort(); assert.deepEqual(got, want, k + " @ " + p.text); });
});
t("worked figures on a known ledger (balances as at a date; activity for a period)", () => {
  const { db, l1, l2 } = scenario(), at30Apr = D.customPeriod("2026-04-30", "2026-04-30", TODAY);
  assert.equal(K.detail(db, "totalSavings", at30Apr).value, 50000 + 300000 + 120000 + 80000 + 25000 + 200000 + 40000, "savings on 30 Apr");
  assert.equal(K.detail(db, "outstandingLoans", at30Apr).value, 80000, "loan 1 on 30 Apr: 100,000 less the 10 Apr repayment, still in grace, loan 2 not yet paid out");
  assert.equal(K.detail(db, "interestReceivable", at30Apr).value, 0, "no interest charged yet (grace)");
  assert.equal(K.detail(db, "loanExposure", at30Apr).guaranteed, 20000, "20,000 of the 40,000 guarantee was released by the 10 Apr repayment (principal reduced)");
  assert.equal(K.detail(db, "loanExposure", D.customPeriod("2026-04-09", "2026-04-09", TODAY)).guaranteed, 40000, "before that repayment the whole guarantee was committed");
  assert.equal(K.detail(db, "loanExposure", D.customPeriod("2026-07-14", "2026-07-14", TODAY)).guaranteed, 20000);
  assert.equal(K.detail(db, "loanExposure", D.customPeriod("2026-07-15", "2026-07-15", TODAY)).guaranteed, 0, "the 15 Jul repayment paid interest first, then reduced principal enough to release the rest");
});
t("a past date shows that day's position: a ledger cut off at that date gives identical balances", () => {
  const { db } = scenario(), cut = (asOf) => {
    const c = JSON.parse(JSON.stringify(db)); c.transactions = c.transactions.filter((x) => x.date <= asOf);
    c.loans = c.loans.filter((l) => l.date <= asOf).map((l) => (l.status === "Cleared" && l.datePaidFull > asOf ? Object.assign(l, { status: "Active", datePaidFull: "" }) : l));
    c.guarantees = c.guarantees.filter((g) => !g.dateCommitted || g.dateCommitted <= asOf).map((g) => { const rel = (g.releases || []).filter((r) => !r.reversed && r.date <= asOf); const left = Number(g.amount) - rel.reduce((a, r) => a + r.amount, 0); return Object.assign(g, { releases: rel, releasedAmount: Number(g.amount) - left, status: left > 0 ? "Active" : "Released" }); });
    return c;
  };
  for (const asOf of ["2026-01-31", "2026-02-03", "2026-03-31", "2026-04-30", "2026-05-05", "2026-06-30", "2026-07-14", "2026-07-15", "2026-08-31", "2026-10-07"]) {
    const p = D.customPeriod("2026-01-01", asOf, TODAY), full = K.overview(db, p), part = K.overview(cut(asOf), p);
    ["totalSavings", "availableCash", "outstandingLoans", "interestReceivable", "members", "savingsReceived", "repaymentsReceived", "interestReceived", "loansDisbursed", "expenses"].forEach((k) => assert.equal(full[k].value, part[k].value, k + " as at " + asOf));
    assert.equal(full.loanExposure.guaranteed, part.loanExposure.guaranteed, "guarantee commitments as at " + asOf); assert.equal(full.loanExposure.pct, part.loanExposure.pct, "exposure % as at " + asOf);
  }
});
t("a loan paid out AFTER the chosen date is not counted; a loan cleared AFTER it still is (and still owes interest to that date)", () => {
  const { db, l1, l2 } = scenario();
  assert.equal(K.detail(db, "outstandingLoans", D.customPeriod("2026-05-01", "2026-05-01", TODAY)).rows.some((r) => r.loanId === l2.id), false);
  assert.equal(K.detail(db, "outstandingLoans", D.customPeriod("2026-05-01", "2026-05-05", TODAY)).rows.some((r) => r.loanId === l2.id), true);
  const l = db.loans.find((x) => x.id === l1.id); l.status = "Cleared"; l.datePaidFull = "2026-09-01";
  const early = D.customPeriod("2026-01-01", "2026-06-30", TODAY), row = K.detail(db, "outstandingLoans", early).rows.find((r) => r.loanId === l1.id);
  assert.ok(row && row.balance > 0, "still owed before it was cleared"); assert.equal(row.interestCharged, 10000 * Math.max(0, D.monthsBetween("2026-02-03", "2026-06-30") - 3), "interest runs to the chosen date, not to the later clearance date");
});
t("drill chain: each member row ties to that member's statement (same date) and to the entries behind it", () => {
  const { db } = scenario();
  for (const p of [P("year"), D.customPeriod("2026-01-01", "2026-04-30", TODAY)]) {
    const d = K.detail(db, "totalSavings", p);
    d.rows.filter((r) => r._open).forEach((r) => { const st = R.memberStatementPrint(db, r._open.id, { to: p.to }); assert.equal(st.summary.find((x) => /Total savings/.test(x[0]))[1], r.savings, r.memberId); assert.equal(st.rows.length ? st.rows[st.rows.length - 1]["Savings balance"] : 0, r.savings); assert.ok(st.rows.every((x) => !!x._open.id)); });
  }
  const p = D.customPeriod("2026-03-01", "2026-06-30", TODAY), st = R.memberStatementPrint(db, "SOB-001", p); assert.equal(st.summary[0][1], 75000, "brought forward = savings before the period"); assert.ok(/Mar 2026/.test(st.period));
});
t("the PDF carries the period and the same total as the card; every report goes through the mandatory letterhead", () => {
  const { db } = scenario(), p = P("year");
  for (const k of K.KEYS) { const rep = K.report(db, k, p), html = R.toPrintHTML(rep, {}), d = K.detail(db, k, p);
    assert.ok(html.includes("Reporting period: " + d.period.replace(/&/g, "&amp;")), k + " period in header"); assert.ok(/BWOMI/.test(html) && /Chairperson/.test(html), k + " letterhead");
    if (d.unit === "UGX" && d.value) assert.ok(html.includes(Math.round(d.value).toLocaleString("en-US")), k + " total printed: " + d.value); }
});
t("period selector: presets are real calendar ranges, never reach into the future, and custom ranges are validated", () => {
  assert.equal(P("month").to, TODAY); assert.equal(P("lastMonth").from, "2026-09-01"); assert.equal(P("lastMonth").to, "2026-09-30"); assert.equal(P("lastYear").to, "2025-12-31"); assert.equal(P("quarter").from, "2026-10-01"); assert.equal(D.presetPeriod("lastMonth", "2026-01-10").from, "2025-12-01");
  assert.throws(() => D.customPeriod("2026-02-30", "2026-03-01", TODAY), /real dates/); assert.throws(() => D.customPeriod("2026-05-02", "2026-05-01", TODAY), /after/); assert.throws(() => D.customPeriod("2026-05-01", "2026-12-31", TODAY), /future/);
});
console.log(pass + " passed" + (f ? ", " + f + " FAILED" : ""));
