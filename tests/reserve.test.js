/* General Reserve Fund + profit reconciliation: SOB's collective reserve is fed only by VERIFIED, still-unallocated group profit; never by members'
   savings or profit already approved for members; every movement has evidence, is Chairperson-approved and audited. The 315,740 pattern: member credits
   are not group profit earned. */
const assert = require("assert"), L = require("../src/core/ledger.js"), G = require("../src/core/governance.js"), CMD = require("../src/core/commands.js"), FY = require("../src/core/fy.js"), HL = require("../src/core/histloans.js"), RS = require("../src/core/reserve.js"), PRC = require("../src/core/profitrec.js"), FR = require("../src/core/finreports.js");
let pass = 0; const t = (n, fn) => { try { fn(); pass++; console.log("  ok  " + n); } catch (e) { process.exitCode = 1; console.log("FAIL  " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 4).join("\n      ")); } };
const U = { admin: { name: "Super Admin", id: "U1", role: "Admin" }, chair: { name: "Chair", id: "U2", role: "Chairperson" }, treas: { name: "Treas", id: "U4", role: "Treasurer" }, member: { name: "Mem", id: "U3", role: "Member", memberId: "SOB-001" } };
const at = (day, who) => G.makeCtx(U[who || "admin"], { today: day, now: day + "T09:00:00.000Z" });
const YEARS = [{ year: 2025, openedDate: "2024-12-01", closedDate: "2025-12-21", evidence: "share-out 21 Dec 2025" }, { year: 2026, openedDate: "2025-12-21", closedDate: null, evidence: "FY2026 began 21 Dec 2025" }];
function world() {
  const db = { members: [{ id: "SOB-001", name: "Member A", status: "Active" }, { id: "SOB-002", name: "Member B", status: "Active" }], transactions: [], loans: [], guarantees: [], auditLog: [] };
  CMD.run(db, at("2026-10-08"), "importHistoricalEntries", { batchId: "B", source: "t", entries: [{ memberId: "SOB-001", date: "2025-02-01", amount: 1000000, sourceRef: "a1", type: "Savings" }, { memberId: "SOB-002", date: "2025-02-01", amount: 500000, sourceRef: "b1", type: "Savings" },
    { memberId: "SOB-001", date: "2025-06-10", amount: 60000, sourceRef: "p1", type: "Profit" }, { memberId: "SOB-002", date: "2025-06-10", amount: 30000, sourceRef: "p2", type: "Profit" }] });
  CMD.run(db, at("2026-10-08"), "importHistoricalLoans", { batchId: "HL", source: "t", accounts: [{ key: "X", memberId: "SOB-002", date: "2025-03-01", registerAmount: 1000000, evidence: "register" }],
    events: [{ kind: "DISBURSEMENT", loanKey: "X", memberId: "SOB-002", date: "2025-03-01", amount: 1000000, sourceRef: "l1" }, { kind: "INTEREST", loanKey: "X", memberId: "SOB-002", date: "2025-03-01", amount: 200000, sourceRef: "l2" }, { kind: "REPAYMENT", memberId: "SOB-002", date: "2025-05-01", amount: 300000, sourceRef: "l3", loanKeys: ["X"] }] });
  FY.defineFinancialYears(db, at("2026-10-08"), { years: YEARS }); return db;
}
const approve = (db, r) => CMD.run(db, at("2026-10-09", "chair"), "approveRequest", { id: r.requestId });
t("profit reconciliation separates interest charged/received/receivable from the profit credited to members; member credits are not group profit earned", () => {
  const db = world(), p = PRC.year(db, 2025, "2026-10-08");
  assert.equal(p.interestCharged, 200000); assert.equal(p.interestReceived, 200000, "interest is cleared first"); assert.equal(p.interestReceivable, 0);
  assert.equal(p.profitCredited, 90000); assert.equal(p.earnedRecorded, 200000); assert.equal(p.undistributed, 110000); assert.equal(p.verifiedProfit, null);
  assert.ok(p.flags.some((f) => /not been verified/.test(f))); assert.equal(PRC.creditedTotal(db).total, 90000);
  const rep = FR.profitReconciliation(db, "2026-10-08"); assert.ok(/NOT the group's profit earned/i.test(rep.totals.note));
});
t("credits larger than the recorded earnings are flagged, never plugged", () => {
  const db = world(); CMD.run(db, at("2026-10-08"), "importHistoricalEntries", { batchId: "B2", source: "t", entries: [{ memberId: "SOB-001", date: "2025-09-10", amount: 500000, sourceRef: "p9", type: "Profit" }] });
  const p = PRC.year(db, 2025, "2026-10-08"); assert.equal(p.profitCredited, 590000); assert.equal(p.earnedRecorded, 200000); assert.ok(p.flags.some((f) => /MORE than the interest recorded as received/.test(f)));
});
t("nothing can move to the reserve until the Chairperson has verified the year's group profit", () => {
  const db = world(); const args = { year: 2025, date: "2026-10-09", amount: 10000, evidence: "minute 4", reason: "reserve" };
  assert.throws(() => CMD.run(db, at("2026-10-09"), "transferToReserve", args), /NOT_VERIFIED/, "refused when requested - the Chairperson is never asked to approve what cannot run"); assert.equal(RS.balance(db), 0);
});
t("verified profit less member credits less what is already reserved bounds every transfer; evidence is mandatory; the Chairperson approves; savings never move", () => {
  const db = world(), savings = L.computeGroupTotals(db).groupSavings, mem = L.memberSavings(db, "SOB-001");
  const v = CMD.run(db, at("2026-10-09"), "confirmFYProfit", { year: 2025, amount: 200000, evidence: "bank statement Dec 2025", reason: "interest received per register" }); assert.equal(v.pendingApproval, true);
  assert.throws(() => CMD.run(db, at("2026-10-09"), "approveRequest", { id: v.requestId }), /FORBIDDEN|SEPARATION/); approve(db, v); assert.equal(RS.available(db, 2025).available, 110000);
  assert.throws(() => CMD.run(db, at("2026-10-09"), "transferToReserve", { year: 2025, date: "2026-10-09", amount: 10000, reason: "x" }), /evidence/);
  assert.throws(() => CMD.run(db, at("2026-10-09"), "transferToReserve", { year: 2025, date: "2026-10-09", amount: 110001, evidence: "minute", reason: "too much" }), /EXCEEDS_UNALLOCATED_PROFIT/);
  const ok = CMD.run(db, at("2026-10-09"), "transferToReserve", { year: 2025, date: "2026-10-09", amount: 100000, evidence: "minute 7 of the committee", reason: "reserve" }); approve(db, ok);
  assert.equal(RS.balance(db), 100000); assert.equal(RS.available(db, 2025).available, 10000); const e = db.reserveFund[0]; assert.equal(e.authorisedBy, "Chair"); assert.equal(e.requestedBy, "Super Admin"); assert.equal(e.source, "Verified unallocated group profit of FY2025");
  assert.equal(L.computeGroupTotals(db).groupSavings, savings, "members' savings are never moved into the reserve"); assert.equal(L.memberSavings(db, "SOB-001"), mem);
  assert.ok(db.auditLog.some((a) => a.entityType === "ReserveFund" && /Transfer to reserve/.test(a.action)));
});
t("profit approved for members but not yet posted cannot be reserved", () => {
  const db = world(); approve(db, CMD.run(db, at("2026-10-09"), "confirmFYProfit", { year: 2025, amount: 200000, evidence: "e", reason: "r" }));
  db.approvalRequests.push({ id: "REQ-X", command: "distributeProfit", status: "Pending", schedule: { distributed: 105000 }, args: {} }); assert.equal(RS.available(db, 2025).available, 5000);
});
t("using the reserve needs a purpose, evidence, Chairperson approval and cannot exceed the balance; the statement carries the balance forward", () => {
  const db = world(); approve(db, CMD.run(db, at("2026-10-09"), "confirmFYProfit", { year: 2025, amount: 200000, evidence: "e", reason: "r" })); approve(db, CMD.run(db, at("2026-10-09"), "transferToReserve", { year: 2025, date: "2026-01-05", amount: 80000, evidence: "m", reason: "r" }));
  assert.throws(() => CMD.run(db, at("2026-10-09"), "utilizeReserve", { date: "2026-10-09", amount: 1000, evidence: "e", reason: "r" }), /purpose/);
  assert.throws(() => CMD.run(db, at("2026-10-09"), "utilizeReserve", { date: "2026-10-09", amount: 90000, purpose: "roof", evidence: "quote", reason: "r" }), /INSUFFICIENT_RESERVE/);
  approve(db, CMD.run(db, at("2026-10-09"), "utilizeReserve", { date: "2026-10-09", amount: 30000, purpose: "roof repair", evidence: "invoice 12", reason: "approved by committee" }));
  assert.equal(RS.balance(db), 50000); const st = RS.statement(db); assert.deepEqual(st.rows.map((r) => [r.label, r.opening, r.transfers, r.utilization, r.closing]), [["FY2025", 0, 0, 0, 0], ["FY2026", 0, 80000, 30000, 50000]]);
  assert.equal(FR.generalReserve(db).totals.balance, 50000);
});
t("the opening balance can be recorded once, with evidence; Treasurer, Member and Chairperson cannot initiate", () => {
  const db = world(); const r = CMD.run(db, at("2026-10-09"), "openReserve", { date: "2025-12-21", amount: 40000, evidence: "bank slip", reason: "balance brought forward" }); approve(db, r); assert.equal(RS.balance(db), 40000);
  assert.throws(() => CMD.run(db, at("2026-10-09"), "openReserve", { date: "2025-12-21", amount: 1, evidence: "e", reason: "r" }), /ALREADY_OPENED/);
  ["treas", "member", "chair"].forEach((w) => assert.throws(() => CMD.run(db, at("2026-10-09", w), "transferToReserve", { year: 2025, date: "2026-10-09", amount: 1, evidence: "e", reason: "r" }), /FORBIDDEN/));
});
const settle = (db, a) => approve(db, CMD.run(db, at("2026-10-09"), "settleFinancialYear", Object.assign({ evidence: "ledger", reason: "year-end policy" }, a)));
t("settling a completed year moves the verified unallocated profit into the reserve; the figure is computed from the records, not typed in", () => {
  const db = world(); assert.throws(() => CMD.run(db, at("2026-10-09"), "settleFinancialYear", { year: 2025, expectedResult: 999, evidence: "e", reason: "r" }), /RESULT_DIFFERS/);
  assert.throws(() => CMD.run(db, at("2026-10-09", "treas"), "settleFinancialYear", { year: 2025, evidence: "e", reason: "r" }), /FORBIDDEN|PERMISSION/i);
  const r = CMD.run(db, at("2026-10-09"), "settleFinancialYear", { year: 2025, expectedResult: 200000, evidence: "ledger", reason: "policy" }); assert.ok(r.pendingApproval, "the Super Admin only requests");
  assert.equal(RS.balance(db), 0, "nothing moves before the Chairperson approves"); approve(db, r);
  assert.equal(RS.balance(db), 110000, "200,000 earned less 90,000 credited to members"); const c = FY.byYear(db, 2025); assert.equal(c.verifiedProfit, 200000); assert.equal(c.settled.reserveMovement, 110000);
  assert.throws(() => CMD.run(db, at("2026-10-09"), "settleFinancialYear", { year: 2025, evidence: "e", reason: "r" }), /ALREADY_SETTLED/);
  assert.equal(L.memberSavings(db, "SOB-001"), 1060000, "member savings untouched"); assert.equal(L.memberSavings(db, "SOB-002"), 530000);
  const st = RS.statement(db).rows; assert.deepEqual(st.map((x) => [x.label, x.opening, x.transfers, x.closing]), [["FY2025", 0, 110000, 110000], ["FY2026", 110000, 0, 110000]], "the balance carries into FY2026");
});
t("a year whose distributions exceeded its verified result reflects the loss; the negative balance carries forward", () => {
  const db = world(); CMD.run(db, at("2026-10-08"), "importHistoricalEntries", { batchId: "B2", source: "t", entries: [{ memberId: "SOB-001", date: "2025-09-10", amount: 500000, sourceRef: "p9", type: "Profit" }] });
  settle(db, { year: 2025 }); assert.equal(RS.balance(db), -390000, "200,000 earned - 590,000 credited"); const e = RS.live(db)[0]; assert.equal(e.kind, "LOSS");
  const row = RS.statement(db).rows; assert.equal(row[0].losses, 390000); assert.equal(row[1].opening, -390000, "negative balance carried into FY2026");
  assert.throws(() => CMD.run(db, at("2026-10-09"), "utilizeReserve", { date: "2026-10-09", amount: 1, purpose: "x", evidence: "e", reason: "r" }), /INSUFFICIENT_RESERVE/, "a negative reserve cannot be spent");
});
t("the open year is excluded: its result stays separate until it closes", () => {
  const db = world(); assert.throws(() => CMD.run(db, at("2026-10-09"), "settleFinancialYear", { year: 2026, evidence: "e", reason: "r" }), /OPEN_YEAR/); assert.equal(RS.balance(db), 0);
});
t("settling never touches member savings, loans owed or unexplained differences", () => {
  const db = world(); const before = JSON.stringify([L.computeGroupTotals(db), (db.historicalLoans || []).length]); settle(db, { year: 2025 });
  assert.equal(JSON.stringify([L.computeGroupTotals(db), (db.historicalLoans || []).length]), before);
});
console.log(pass + " reserve and profit-reconciliation tests passed");
