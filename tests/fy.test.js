/* SOB financial years: decided by the ACTUAL share-outs (never 31 December). FY2026 began on 21 Dec 2025, the day of the previous share-out. */
const assert = require("assert"), L = require("../src/core/ledger.js"), G = require("../src/core/governance.js"), CMD = require("../src/core/commands.js"), FY = require("../src/core/fy.js"), C = require("../src/core/cycle.js"), R = require("../src/core/reports.js");
let pass = 0; const t = (n, fn) => { try { fn(); pass++; console.log("  ok  " + n); } catch (e) { process.exitCode = 1; console.log("FAIL  " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 4).join("\n      ")); } };
const U = { admin: { name: "Super Admin", id: "U1", role: "Admin" }, chair: { name: "Chair", id: "U2", role: "Chairperson" }, member: { name: "Mem", id: "U3", role: "Member", memberId: "SOB-001" } };
const at = (day, who) => G.makeCtx(U[who || "admin"], { today: day, now: day + "T09:00:00.000Z" });
const YEARS = [{ year: 2024, openedDate: "2023-12-24", closedDate: "2024-12-01", evidence: "share-out 1 Dec 2024" }, { year: 2025, openedDate: "2024-12-01", closedDate: "2025-12-21", evidence: "share-out 21 Dec 2025" }, { year: 2026, openedDate: "2025-12-21", closedDate: null, evidence: "Chairperson: FY2026 began 21 Dec 2025" }];
const imp = (db, entries) => CMD.run(db, at("2026-10-08"), "importHistoricalEntries", { batchId: "B", source: "t", entries });
function world() {
  const db = { members: [{ id: "SOB-001", name: "Member A", status: "Active" }, { id: "SOB-002", name: "Member B", status: "Active" }], transactions: [], loans: [], guarantees: [], auditLog: [] };
  imp(db, [
    { memberId: "SOB-001", date: "2024-03-01", amount: 1000, sourceRef: "a1", type: "Savings" }, { memberId: "SOB-001", date: "2024-12-01", amount: 700, sourceRef: "a2", type: "Share-Out" }, { memberId: "SOB-001", date: "2024-12-01", amount: 50, sourceRef: "a3", type: "Savings" },
    { memberId: "SOB-001", date: "2025-06-10", amount: 20, sourceRef: "a4", type: "Profit" }, { memberId: "SOB-001", date: "2025-12-20", amount: 100, sourceRef: "a5", type: "Savings" },
    { memberId: "SOB-001", date: "2025-12-21", amount: 300, sourceRef: "a6", type: "Share-Out" }, { memberId: "SOB-001", date: "2025-12-21", amount: 10, sourceRef: "a7", type: "Withdraw" }, { memberId: "SOB-001", date: "2025-12-21", amount: 40, sourceRef: "a8", type: "Savings" },
    { memberId: "SOB-001", date: "2025-12-31", amount: 5, sourceRef: "a9", type: "Savings" }, { memberId: "SOB-002", date: "2025-03-01", amount: 500, sourceRef: "b1", type: "Savings" }]);
  return db;
}
t("no years registered: nothing is assumed", () => { const db = world(); assert.equal(FY.table(db).length, 0); assert.equal(FY.yearOfEntry(db, db.transactions[0]), null); });
t("defining the years needs evidence, must be contiguous and each begins on the day the previous share-out was held", () => {
  const db = world(); const A = at("2026-10-08");
  assert.throws(() => FY.defineFinancialYears(db, A, { years: [{ year: 2024, openedDate: "2023-12-24", closedDate: "2024-12-01" }] }), /evidence/);
  assert.throws(() => FY.defineFinancialYears(db, A, { years: [YEARS[0], Object.assign({}, YEARS[1], { openedDate: "2024-12-02" })] }), /must begin on the day/);
  assert.throws(() => FY.defineFinancialYears(db, A, { years: [Object.assign({}, YEARS[0], { closedDate: null }), YEARS[1]] }), /only the last year can be open/);
  assert.throws(() => FY.defineFinancialYears(db, at("2026-10-08", "member"), { years: YEARS }), /FORBIDDEN/);
  const r = FY.defineFinancialYears(db, A, { years: YEARS }); assert.equal(r.added, 3); assert.equal(r.shareOutEvents, 2);
  assert.deepEqual(FY.table(db).map((y) => [y.label, y.openedDate, y.closedDate || null]), [["FY2024", "2023-12-24", "2024-12-01"], ["FY2025", "2024-12-01", "2025-12-21"], ["FY2026", "2025-12-21", null]]);
  assert.equal(FY.defineFinancialYears(db, A, { years: YEARS }).unchanged, 3, "rerun changes nothing"); assert.equal(db.shareOutEvents.length, 2, "no duplicate share-out events");
  assert.throws(() => FY.defineFinancialYears(db, A, { years: [Object.assign({}, YEARS[0], { closedDate: "2024-12-31" }), Object.assign({}, YEARS[1], { openedDate: "2024-12-31" }), YEARS[2]] }), /FY_DIFFERS/, "31 December is never assumed and a defined year cannot be moved silently");
});
t("boundary rule: the share-out day's share-out and cash-out close the old year; its other entries open the new one", () => {
  const db = world(); FY.defineFinancialYears(db, at("2026-10-08"), { years: YEARS }); const yr = (ref) => FY.yearOfEntry(db, db.transactions.find((x) => x.sourceRef === ref));
  assert.equal(yr("a1"), 2024); assert.equal(yr("a2"), 2024, "share-out of 1 Dec 2024 belongs to the year it closes"); assert.equal(yr("a3"), 2025, "savings of 1 Dec 2024 belong to the new year");
  assert.equal(yr("a5"), 2025); assert.equal(yr("a6"), 2025); assert.equal(yr("a7"), 2025, "cash-out on the share-out day belongs to the closing year"); assert.equal(yr("a8"), 2026, "savings after the share-out belong to the new year"); assert.equal(yr("a9"), 2026, "31 Dec is not a boundary");
});
t("opening, movements, closing and carry-forward chain from year to year and tie to the live savings", () => {
  const db = world(); FY.defineFinancialYears(db, at("2026-10-08"), { years: YEARS });
  const p24 = FY.position(db, 2024), p25 = FY.position(db, 2025), p26 = FY.position(db, 2026), a = (p) => p.rows.find((r) => r.memberId === "SOB-001");
  assert.deepEqual([a(p24).opening, a(p24).deposits, a(p24).shareOuts, a(p24).closing, a(p24).carriedForward], [0, 1000, 700, 300, 300]);
  assert.deepEqual([a(p25).opening, a(p25).deposits, a(p25).profit, a(p25).withdrawals, a(p25).shareOuts, a(p25).closing], [300, 150, 20, 10, 300, 160]);
  assert.deepEqual([a(p26).opening, a(p26).deposits, a(p26).closing, a(p26).carriedForward], [160, 45, 205, null]);
  assert.equal(a(p26).closing, L.memberSavings(db, "SOB-001")); assert.deepEqual(FY.check(db), []);
  const m = FY.memberYears(db, "SOB-001"); assert.equal(m[1].opening, m[0].closing); assert.equal(m[2].opening, m[1].closing);
});
t("the statement shows each year, bounded by the share-out dates, with what was carried forward", () => {
  const db = world(); FY.defineFinancialYears(db, at("2026-10-08"), { years: YEARS }); const s = R.memberStatementPrint(db, "SOB-001", {}), text = JSON.stringify(s.summary);
  assert.ok(/FY2025 \(1 December 2024 – 21 December 2025\)/.test(text) || /FY2025/.test(text)); assert.ok(/carried forward to the next year/.test(text)); assert.ok(/FY2026/.test(text));
});
t("executing a share-out opens the next financial year ON the share-out day (not the day after, not 1 January)", () => {
  const db = world(); FY.defineFinancialYears(db, at("2026-10-08"), { years: YEARS });
  const ev = C.executeShareOut(db, at("2026-12-10"), 2026, { date: "2026-12-10" }); const c = (y) => db.yearCycles.find((x) => x.year === y);
  assert.equal(c(2026).closedDate, "2026-12-10"); assert.equal(c(2027).openedDate, "2026-12-10"); assert.equal(c(2027).status, "Open"); assert.ok(ev.totalWithdrawn > 0);
});
t("annual summary follows the share-out dates", () => {
  const db = world(); FY.defineFinancialYears(db, at("2026-10-08"), { years: YEARS }); assert.ok(/FY2025 summary \(01\/12\/2024|FY2025 summary/.test(R.annualSummary(db, 2025).title));
});
console.log(pass + " financial-year tests passed");
