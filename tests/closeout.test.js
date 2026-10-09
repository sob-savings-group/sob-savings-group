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

const run = (db, name, args, who, day) => CMD.run(db, at(day || "2026-10-09", who || "admin"), name, args);
const settle2 = (db, a) => approve(db, run(db, "settleFinancialYear", Object.assign({ evidence: "ledger", reason: "year-end policy" }, a)));
const loanId = (db) => db.historicalLoans[0].id;
t("a savings offset needs approval, repays the loan interest first, lowers savings, moves no cash, and cannot exceed savings or the balance", () => {
  const db = world(), id = loanId(db), sav0 = L.memberSavings(db, "SOB-002"), cash0 = L.computeGroupTotals(db).cashflow;
  const r = run(db, "offsetHistoricalLoan", { loanId: id, amount: 100000, date: "2026-10-09", evidence: "member signed consent", reason: "approved offset" }); assert.equal(r.pendingApproval, true);
  assert.equal(HL.position(db, id).outstanding, 900000, "nothing happens before the Chairperson approves"); approve(db, r);
  assert.equal(HL.position(db, id).outstanding, 800000); assert.equal(L.memberSavings(db, "SOB-002"), sav0 - 100000);
  assert.equal(L.computeGroupTotals(db).cashflow, cash0, "a savings offset moves no cash");
  assert.throws(() => run(db, "offsetHistoricalLoan", { loanId: id, amount: 1, date: "2026-10-09", reason: "r" }), /evidence/);
  assert.throws(() => run(db, "offsetHistoricalLoan", { loanId: id, amount: 10000000, date: "2026-10-09", evidence: "e", reason: "r" }), /INSUFFICIENT_SAVINGS/);
  ["treas", "member", "chair"].forEach((w) => assert.throws(() => run(db, "offsetHistoricalLoan", { loanId: id, amount: 1, evidence: "e", reason: "r" }, w), /FORBIDDEN/));
});
t("a write-off needs the Chairperson, evidence and a CLOSED year; principal is the group loss, interest is not; amounts cannot exceed the balance", () => {
  const db = world(), id = loanId(db);
  assert.throws(() => run(db, "writeOffHistoricalLoan", { loanId: id, principal: 1000, lossYear: 2026, evidence: "e", reason: "r" }), /OPEN_YEAR/);
  assert.throws(() => run(db, "writeOffHistoricalLoan", { loanId: id, principal: 900001, lossYear: 2025, evidence: "e", reason: "r" }), /EXCEEDS_BALANCE/);
  assert.throws(() => run(db, "writeOffHistoricalLoan", { loanId: id, principal: 1000, lossYear: 2025, reason: "r" }), /evidence/);
  const before = HL.position(db, id).outstanding; const q = run(db, "writeOffHistoricalLoan", { loanId: id, principal: 900000, lossYear: 2025, evidence: "committee minute 12", reason: "member untraceable" }); assert.equal(HL.position(db, id).outstanding, before, "pending until approved");
  approve(db, q); const p = HL.position(db, id); assert.equal(p.outstanding, 0); assert.equal(p.status, "Written off");
  assert.equal(PRC.year(db, 2025, "2026-10-09").writeOffLoss, 900000); assert.equal(PRC.year(db, 2025, "2026-10-09").earnedRecorded, 200000 - 900000);
});
t("a verified loss is reflected as a NEGATIVE reserve movement and the balance carries forward; savings and loans receivable are untouched", () => {
  const db = world(), id = loanId(db), tot = JSON.stringify(L.computeGroupTotals(db).groupSavings);
  approve(db, run(db, "writeOffHistoricalLoan", { loanId: id, principal: 900000, lossYear: 2025, evidence: "minute 12", reason: "uncollectible" }));
  settle2(db, { year: 2025, expectedResult: -700000 });   // 200,000 interest received - 900,000 principal lost
  assert.equal(PRC.year(db, 2025, "2026-10-09").earnedRecorded, -700000); assert.equal(RS.balance(db), -790000, "result -700,000 less 90,000 already credited to members");
  assert.equal(JSON.stringify(L.computeGroupTotals(db).groupSavings), tot); const st = RS.statement(db); assert.ok(st.rows.find((r) => r.label === "FY2025").losses > 0);
});
t("a write-off approved AFTER the year was settled posts its loss to the reserve at once, once, and updates the verified result", () => {
  const db = world(), id = loanId(db); settle2(db, { year: 2025 }); const b0 = RS.balance(db);
  approve(db, run(db, "writeOffHistoricalLoan", { loanId: id, principal: 50000, lossYear: 2025, evidence: "minute 13", reason: "partly uncollectible" }));
  assert.equal(RS.balance(db), b0 - 50000); assert.equal(FY.byYear(db, 2025).verifiedProfit, 150000); assert.equal(db.reserveFund.filter((e) => e.kind === "LOSS").length, 1);
});
t("an interest-only write-off is not a group loss and the reserve does not move", () => {
  const db = world(), id = loanId(db); db.loanInterestRecords.push({ id: "LIR-T", loanId: id, memberId: "SOB-002", kind: "CHARGED", date: "2025-09-01", amount: 40000, sourceRef: "t-int", historical: true }); settle2(db, { year: 2025 }); const b0 = RS.balance(db), p0 = HL.position(db, id);
  approve(db, run(db, "writeOffHistoricalLoan", { loanId: id, interest: p0.interestOutstanding, evidence: "minute", reason: "interest waived" }));
  assert.equal(HL.position(db, id).interestOutstanding, 0); assert.equal(RS.balance(db), b0);
});
t("a loan date can be marked NOT ESTABLISHED (audited, approved) and later corrected from a document; no false date is kept as fact", () => {
  const db = world(); db.loans.push({ id: "LOAN-T", memberId: "SOB-001", date: "2025-12-21", loanAmount: 100000, graceMonths: 3, status: "Active", assignedMonthlyInterest: 3000 });
  db.transactions.push({ id: "TXN-T", type: "Loan Disbursement", memberId: "SOB-001", amount: 100000, date: "2025-12-21", loanId: "LOAN-T", approvalStatus: "Approved" });
  assert.throws(() => run(db, "markLoanDateUnknown", { loanId: "LOAN-T", reason: "r" }), /evidence/);
  const q = run(db, "markLoanDateUnknown", { loanId: "LOAN-T", reason: "no document states it", evidence: "searched member sheet, register, bank ledger" }); assert.equal(q.pendingApproval, true); approve(db, q);
  const l = db.loans[0]; assert.equal(l.dateUnknown, true); assert.equal(l.placeholderDate, "2025-12-21"); assert.equal(db.transactions.find((x) => x.id === "TXN-T").dateUnknown, true);
  assert.ok(db.auditLog.some((a) => /marked unknown/.test(a.action))); assert.throws(() => run(db, "markLoanDateUnknown", { loanId: "LOAN-T", reason: "r", evidence: "e" }), /already/);
  approve(db, run(db, "correctLoanDate", { loanId: "LOAN-T", date: "2025-12-21", reason: "receipt found", evidence: "receipt 77" })); assert.ok(!db.loans[0].dateUnknown);
});
t("re-importing a source row with a DIFFERENT amount never overwrites the recorded (possibly corrected) entry or loan event", () => {
  const db = world(), n0 = db.transactions.length, snap = JSON.stringify(db.transactions.filter((x) => x.sourceRef === "a1")), loanSnap = JSON.stringify(db.transactions.filter((x) => x.sourceRef === "l3"));
  const r = run(db, "importHistoricalEntries", { batchId: "B-AGAIN", source: "t", entries: [{ memberId: "SOB-001", date: "2025-02-01", amount: 999999, sourceRef: "a1", type: "Savings" }] }); assert.equal(r.added, 0); assert.equal(r.alreadyImported, 1);
  const r2 = run(db, "importHistoricalLoans", { batchId: "HL-AGAIN", source: "t", events: [{ kind: "REPAYMENT", memberId: "SOB-002", date: "2025-05-01", amount: 1, sourceRef: "l3", loanKeys: ["X"] }] }); assert.equal(r2.repayments, 0);
  assert.equal(db.transactions.length, n0); assert.equal(JSON.stringify(db.transactions.filter((x) => x.sourceRef === "a1")), snap); assert.equal(JSON.stringify(db.transactions.filter((x) => x.sourceRef === "l3")), loanSnap);
  assert.throws(() => run(db, "importHistoricalEntries", { batchId: "B-AGAIN", source: "t", entries: [{ memberId: "SOB-001", date: "2025-02-01", amount: 5, sourceRef: "a1b", type: "Savings", sourceRefOf: "x" }], annotations: [{ sourceRef: "" }] }), /INVALID|REQUIRED/);
});
console.log(pass + " close-out governance tests passed");
