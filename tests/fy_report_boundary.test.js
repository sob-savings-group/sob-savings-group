/* A share-out day is counted ONCE, in the right financial year, in EVERY report and statement: the share-out and withdrawals of that day belong to the year that closes; every other entry of that day to the year that opens. Run: node tests/fy_report_boundary.test.js */
const assert = require("assert"), RC = require("../src/core/reportcentre.js"), ST = require("../src/core/statements.js"), FY = require("../src/core/fy.js");
const tx = (id, date, type, amount, memberId) => ({ id, date, type, amount, memberId, purpose: "" });
const mkdb = () => ({ members: [{ id: "M1", name: "One", status: "Active" }, { id: "M2", name: "Two", status: "Active" }], yearCycles: [{ year: 2025, openedDate: "2024-12-01", closedDate: "2025-12-21", status: "Closed" }, { year: 2026, openedDate: "2025-12-21", closedDate: null, status: "Open" }], loans: [], guarantees: [], auditLog: [], approvalRequests: [],
  transactions: [tx("a", "2025-06-01", "Savings", 100, "M1"), tx("b", "2025-12-21", "Share-Out", 100, "M1"), tx("c", "2025-12-21", "Savings", 50, "M1"), tx("d", "2026-03-01", "Savings", 70, "M1"), tx("e", "2026-04-01", "Withdraw", 20, "M1"), tx("f", "2025-12-21", "Share-Out", 30, "M2"), tx("g", "2025-09-01", "Withdraw", 5, "M2"), tx("h", "2026-02-01", "Subscription", 10000, "M2"), tx("i", "2025-12-21", "Subscription", 10000, "M2")] });
let n = 0; const t = (name, fn) => { fn(); n++; };
const run = (id, y) => RC.run(mkdb(), id, { year: y }, "2026-11-18"), dates = (r) => (r.rows || []).map((x) => x.date).filter(Boolean);
t("FY2026 Withdrawals has no 2025 share-out; FY2025 Withdrawals has them", () => {
  assert.deepStrictEqual(dates(run("withdrawals", 2026)), ["01/04/2026"]); assert.ok(dates(run("withdrawals", 2025)).filter((d) => d === "21/12/2025").length === 2);
});
t("the first savings of the new year on the share-out day count in FY2026 only", () => { assert.ok(!dates(run("deposits", 2025)).includes("21/12/2025")); assert.ok(dates(run("deposits", 2026)).includes("21/12/2025")); });
t("a subscription on the share-out day counts in FY2026 only", () => { assert.strictEqual(run("subscriptions", 2025).rows.length, 0); assert.ok(dates(run("subscriptions", 2026)).includes("21/12/2025")); });
t("no ledger entry appears in two years", () => { const a = run("ledger", 2025).rows.map((r) => r.entry), b = run("ledger", 2026).rows.map((r) => r.entry); assert.deepStrictEqual(a.filter((x) => b.includes(x)), []); assert.strictEqual(a.length + b.length, mkdb().transactions.length); });
t("Income report never lists the same entry in two years", () => { assert.strictEqual(run("income", 2025).rows.length, 0); });
t("Cash Position: closing cash of FY2025 equals opening cash of FY2026", () => { const c5 = run("cash", 2025).totals.cashAtTheEnd, c6 = run("cash", 2026).totals.cashAtTheStart; assert.strictEqual(c5, c6); });
t("a member's FY2026 statement opens clean and does not include the share-out of the year before", () => {
  const db = mkdb(), st = ST.memberAccount(db, "M1", { from: "2025-12-21", to: "2026-11-18" }, { today: "2026-11-18", internal: true });
  assert.strictEqual(st.savings.shareOuts, 0); assert.strictEqual(st.savings.deposits, 120); assert.strictEqual(st.savings.withdrawals, 20);
  const s5 = ST.memberAccount(db, "M1", { from: "2024-12-01", to: "2025-12-21" }, { today: "2026-11-18", internal: true }); assert.strictEqual(s5.savings.shareOuts, 100); assert.strictEqual(s5.savings.deposits, 100);
});
t("a custom date range that starts on the share-out day is exactly what was typed (the rule applies only to financial years)", () => { const r = RC.run(mkdb(), "withdrawals", { from: "2025-12-21", to: "2026-11-18" }, "2026-11-18"); assert.ok(dates(r).includes("21/12/2025")); });
console.log(n + " financial-year boundary tests passed");
