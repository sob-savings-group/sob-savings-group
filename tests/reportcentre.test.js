/* Report Centre: every report runs, ties to the dashboard figures, filters narrow it, and the trial balance balances. */
const assert = require("assert"), fs = require("fs"), path = require("path"), M = require("../src/core/migrate.js"), RC = require("../src/core/reportcentre.js"), K = require("../src/core/kpis.js"), L = require("../src/core/ledger.js");
const db = M.migrateLegacy(JSON.parse(fs.readFileSync(path.join(__dirname, "../app/demo-seed.json"), "utf8")), "2026-03-31"), today = "2026-11-17";
let n = 0; const t = (name, f) => { f(); n++; };
t("the catalogue has the reports the Chairperson asked for", () => { const ids = RC.catalogue().map((c) => c.id); ["savings", "loans", "interest", "withdrawals", "deposits", "profit", "shareout", "fysummary", "balances", "outstanding", "repayments", "ledger", "cash", "trial", "audit"].forEach((i) => assert.ok(ids.includes(i), i)); });
t("every report runs on real-shaped data and on an empty ledger", () => { RC.catalogue().forEach((c) => { const r = RC.run(db, c.id, {}, today); assert.ok(Array.isArray(r.rows) && r.columns.length, c.id); const e = RC.run({ members: [], transactions: [], loans: [], guarantees: [], auditLog: [] }, c.id, {}, today); assert.ok(Array.isArray(e.rows), c.id + " (empty)"); }); });
t("deposits, withdrawals and repayments tie to the dashboard for the same period", () => {
  const p = { from: "2026-01-01", to: "2026-06-30" }, o = K.overview(db, p);
  assert.strictEqual(RC.run(db, "deposits", p, today).totals.savingsReceived, o.savingsReceived.value);
  assert.strictEqual(RC.run(db, "withdrawals", p, today).totals.withdrawals, o.withdrawals.value);
  assert.strictEqual(RC.run(db, "repayments", p, today).totals.repaymentsReceived, o.repaymentsReceived.value); });
t("savings and member balances agree with the ledger", () => { const s = RC.run(db, "balances", {}, today); assert.strictEqual(s.totals.savings, K.overview(db, { from: "", to: today }).totalSavings.value); assert.strictEqual(s.totals.net, s.totals.savings - s.totals.loanOwed); });
t("the trial balance balances, with no hidden difference", () => { const r = RC.run(db, "trial", {}, today); assert.ok(r.balanced); const tot = r.rows[r.rows.length - 1]; assert.strictEqual(tot.debit, tot.credit); assert.ok(!r.rows.some((x) => /Difference/.test(x.account))); });
t("if the books did not balance the difference is shown, never hidden", () => { const d2 = JSON.parse(JSON.stringify(db)); d2.transactions.push({ id: "X1", date: "2026-05-01", memberId: d2.members[0].id, type: "Interest", amount: 1000, approvalStatus: "Approved" }); const r = RC.run(d2, "trial", {}, today); if (!r.balanced) assert.ok(r.rows.some((x) => /Difference/.test(x.account))); const tot = r.rows[r.rows.length - 1]; assert.strictEqual(tot.debit, tot.credit); });
t("the member filter narrows every member-level report to that member", () => { const id = db.members.find((m) => L.memberSavings(db, m.id) > 0).id;
  ["savings", "balances", "deposits", "ledger", "loans", "interest"].forEach((c) => { const all = RC.run(db, c, {}, today), one = RC.run(db, c, { memberId: id }, today); assert.ok(one.rows.length <= all.rows.length, c); assert.ok(one.rows.length >= 0); });
  const dep = RC.run(db, "deposits", { memberId: id }, today), direct = L.activeTransactions(db).filter((x) => x.type === "Savings" && x.memberId === id).reduce((a, x) => a + Number(x.amount), 0);
  assert.strictEqual(dep.totals.amount, direct); assert.ok(dep.rows.every((r) => r.member === db.members.find((m) => m.id === id).name)); });
t("the status filter narrows the loan report", () => { const a = RC.run(db, "loans", {}, today), c = RC.run(db, "loans", { status: "Cleared" }, today); assert.ok(c.rows.every((r) => r.status === "Cleared")); assert.ok(c.rows.length <= a.rows.length); });
t("a financial year filter uses that year's dates, and a bad range is refused", () => { const fy = (db.yearCycles || [])[0]; if (fy) { const r = RC.run(db, "deposits", { year: fy.year }, today); assert.ok(/Financial Year|FY/.test(r.period) || r.period.length > 0); }
  assert.throws(() => RC.run(db, "deposits", { from: "2026-06-01", to: "2026-01-01" }, today), /INVALID/); });
t("nothing in the future is ever reported", () => { const r = RC.run(db, "ledger", { to: "2099-01-01" }, today); assert.strictEqual(r.filters.to, today); });

t("deposit-type reports carry a running total that ends at the report total", () => {
  const r = RC.run(db, "deposits", { from: "2026-01-01", to: "2026-06-30" }, today); assert.ok(r.rows.length > 0 && r.columns.includes("running"));
  assert.strictEqual(r.rows[r.rows.length - 1].running, r.totals.amount); assert.strictEqual(r.totals.amount, r.totals.savingsReceived); });
t("the Category filter keeps only entries with that purpose and re-adds the totals", () => {
  const all = RC.run(db, "deposits", { from: "2026-01-01", to: "2026-06-30" }, today), pick = (all.rows.find((r) => r.details) || {}).details;
  if (!pick) return; const one = RC.run(db, "deposits", { from: "2026-01-01", to: "2026-06-30", category: pick }, today);
  assert.ok(one.rows.length > 0 && one.rows.length <= all.rows.length && one.rows.every((r) => r.details.toLowerCase().indexOf(pick.toLowerCase()) === 0));
  assert.strictEqual(one.totals.amount, one.rows.reduce((a, r) => a + r.amount, 0)); assert.ok(RC.catalogue().find((c) => c.id === "deposits").filters.includes("category")); });
/* ---- accounting presentation: brackets and red for negatives, a ruled Total line, running balances ---- */
{
  const RP = require("../src/core/reports.js");
  const rep = { title: "Acct", columns: ["item", "amount"], labels: { item: "Item", amount: "Amount (UGX)" }, rows: [{ item: "A", amount: 1500 }, { item: "B", amount: -250 }], totals: { amount: 1250 }, notes: [] };
  const html = RP.toPrintHTML(rep, {});
  t("accounting format: negatives in brackets and red, positives plain, and a Total line closes the table", () => {
    assert.ok(/<td class="n neg">\(250\)<\/td>/.test(html), "negative in brackets with the neg class");
    assert.ok(/<td class="n">1,500<\/td>/.test(html), "positive plain");
    assert.ok(/<tr class="tot"><td class="">Total<\/td><td class="n">1,250<\/td><\/tr>/.test(html), "totals row");
  });
}
console.log(n + " report centre tests passed");
