/* Reporting periods follow the actual share-out financial years, never the calendar year. */
const test = require("node:test"), assert = require("node:assert/strict");
const D = require("../src/core/dates.js"), K = require("../src/core/kpis.js");
const YRS = [{ year: 2024, openedDate: "2023-12-24", closedDate: "2024-12-01" }, { year: 2025, openedDate: "2024-12-01", closedDate: "2025-12-21" }, { year: 2026, openedDate: "2025-12-21", closedDate: null }];
const TODAY = "2026-10-10";
test("This / Last financial year use the share-out dates", () => {
  const y = D.presetPeriod("year", TODAY, YRS), l = D.presetPeriod("lastYear", TODAY, YRS);
  assert.deepEqual([y.fy, y.from, y.to], [2026, "2025-12-21", TODAY]);
  assert.deepEqual([l.fy, l.from, l.to], [2025, "2024-12-01", "2025-12-21"]);
  assert.match(l.label, /Last financial year \(FY2025\)/); assert.match(l.text, /1 Dec 2024 – 21 Dec 2025/);
  assert.ok(!/31 Dec 2025/.test(l.text));
});
test("a share-out day is counted once, in the year it belongs to", () => {
  const db = { members: [], loans: [], transactions: [
    { id: "a", date: "2025-12-21", type: "Share-Out", amount: 100, memberId: "M" }, { id: "b", date: "2025-12-21", type: "Savings", amount: 50, memberId: "M" }, { id: "c", date: "2025-12-01", type: "Savings", amount: 10, memberId: "M" }] };
  const o25 = K.overview(db, D.presetPeriod("lastYear", TODAY, YRS)), o26 = K.overview(db, D.presetPeriod("year", TODAY, YRS));
  assert.equal(o25.savingsReceived.value, 10); assert.equal(o25.withdrawals.value, 100);
  assert.equal(o26.savingsReceived.value, 50); assert.equal(o26.withdrawals.value, 0);
});
test("without registered years the calendar fallback still works", () => { assert.equal(D.presetPeriod("year", TODAY).from, "2026-01-01"); });
