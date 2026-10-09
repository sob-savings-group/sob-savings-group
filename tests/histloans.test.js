/* Historical loan accounts: their own records (never today's loan book), interest charged as loan-interest records (never a savings withdrawal),
   repayments allocated interest first and oldest loan first, excess kept visible, nothing posted twice. */
const assert = require("assert"), L = require("../src/core/ledger.js"), G = require("../src/core/governance.js"), CMD = require("../src/core/commands.js"), HL = require("../src/core/histloans.js"), K = require("../src/core/kpis.js"), FR = require("../src/core/finreports.js"), I = require("../src/core/integrity.js");
let pass = 0; const t = (n, fn) => { try { fn(); pass++; console.log("  ok  " + n); } catch (e) { process.exitCode = 1; console.log("FAIL  " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 4).join("\n      ")); } };
const U = { admin: { name: "Super Admin", id: "U1", role: "Admin" }, chair: { name: "Chair", id: "U2", role: "Chairperson" }, member: { name: "Mem", id: "U3", role: "Member", memberId: "SOB-001" } };
const at = (day, who) => G.makeCtx(U[who || "admin"], { today: day, now: day + "T09:00:00.000Z" });
const fresh = () => ({ members: [{ id: "SOB-001", name: "Member A", status: "Active" }, { id: "SOB-002", name: "Member B", status: "Active" }], transactions: [], loans: [], guarantees: [], auditLog: [] });
const ACC = [{ key: "A1", memberId: "SOB-001", date: "2025-01-28", registerAmount: 600000, registerRef: "register row 1", evidence: "register + member sheet" }, { key: "A2", memberId: "SOB-001", date: "2025-06-26", registerAmount: 2000000, registerRef: "register row 2", evidence: "register + member sheet" }];
const EV = [
  { kind: "DISBURSEMENT", loanKey: "A1", memberId: "SOB-001", date: "2025-01-28", amount: 600000, sourceRef: "s1#p" }, { kind: "INTEREST", loanKey: "A1", memberId: "SOB-001", date: "2025-01-28", amount: 30000, sourceRef: "s1#i" },
  { kind: "INTEREST", loanKey: "A1", memberId: "SOB-001", date: "2025-05-28", amount: 27500, sourceRef: "s2", decisionNo: 2 }, { kind: "REPAYMENT", memberId: "SOB-001", date: "2025-06-01", amount: 20000, sourceRef: "s3", decisionNo: 3, loanKeys: ["A1", "A2"] },
  { kind: "DISBURSEMENT", loanKey: "A2", memberId: "SOB-001", date: "2025-07-09", amount: 850000, sourceRef: "s4", decisionNo: 4 }, { kind: "INTEREST", loanKey: "A2", memberId: "SOB-001", date: "2025-07-09", amount: 75000, sourceRef: "s5", decisionNo: 5 },
  { kind: "DISBURSEMENT", loanKey: "A2", memberId: "SOB-001", date: "2025-07-14", amount: 700000, sourceRef: "s6", decisionNo: 6 },
  { kind: "REPAYMENT", memberId: "SOB-001", date: "2025-09-15", amount: 200000, sourceRef: "s7", decisionNo: 7, loanKeys: ["A1", "A2"] }, { kind: "REPAYMENT", memberId: "SOB-001", date: "2025-10-19", amount: 1700000, sourceRef: "s8", decisionNo: 8, loanKeys: ["A1", "A2"] },
  { kind: "REPAYMENT", memberId: "SOB-001", date: "2025-11-09", amount: 285000, sourceRef: "s9", decisionNo: 9, loanKeys: ["A1", "A2"] }];
const load = (db) => CMD.run(db, at("2026-10-08"), "importHistoricalLoans", { batchId: "HL", source: "test", accounts: ACC, events: EV });
t("the historical loan records need the history permission and valid sources", () => {
  const db = fresh(); assert.throws(() => CMD.run(db, at("2026-10-08", "member"), "importHistoricalLoans", { batchId: "HL", source: "t", accounts: ACC, events: EV }), /FORBIDDEN/);
  assert.throws(() => CMD.run(db, at("2026-10-08"), "importHistoricalLoans", { batchId: "HL", source: "t", accounts: ACC, events: [{ kind: "INTEREST", loanKey: "NOPE", memberId: "SOB-001", date: "2025-01-01", amount: 5, sourceRef: "z" }] }), /unknown loan/);
  assert.throws(() => CMD.run(db, at("2026-10-08"), "importHistoricalLoans", { batchId: "HL", source: "t", accounts: ACC, events: [{ kind: "INTEREST", loanKey: "A1", memberId: "SOB-001", date: "2025-01-01", amount: 5 }] }), /sourceRef/);
  assert.equal(db.transactions.length, 0, "a rejected batch writes nothing");
});
t("interest charged is a loan-interest record, NOT a savings withdrawal; none of it changes savings, live loans or the dashboard", () => {
  const db = fresh(); G.createEntry(db, at("2025-01-01"), { date: "2025-01-01", memberId: "SOB-001", amount: 100000, type: "Savings" }); const before = JSON.stringify([L.memberSavings(db, "SOB-001"), K.overview(db, { to: "2026-10-08" }).outstandingLoans.value, K.overview(db, { to: "2026-10-08" }).availableCash.value, db.loans.length]);
  const r = load(db); assert.deepEqual([r.accountsAdded, r.disbursements, r.interestRecords, r.repayments], [2, 3, 3, 4]);
  assert.equal(db.loanInterestRecords.length, 3); assert.ok(db.loanInterestRecords.every((x) => x.kind === "CHARGED")); assert.ok(!db.transactions.some((x) => x.type === "Withdraw"));
  assert.equal(JSON.stringify([L.memberSavings(db, "SOB-001"), K.overview(db, { to: "2026-10-08" }).outstandingLoans.value, K.overview(db, { to: "2026-10-08" }).availableCash.value, db.loans.length]), before);
  assert.deepEqual(I.check(db, "2026-10-08").findings.filter((f) => f.severity === "error"), [], "integrity is clean");
});
t("idempotent: a second run (and a dry run) adds nothing, audits nothing", () => {
  const db = fresh(); load(db); const n = db.transactions.length, a = db.auditLog.length, i = db.loanInterestRecords.length;
  const again = load(db); assert.deepEqual([again.accountsAdded, again.disbursements, again.interestRecords, again.repayments], [0, 0, 0, 0]); assert.equal(again.alreadyImported, EV.length);
  assert.equal(db.transactions.length, n); assert.equal(db.loanInterestRecords.length, i); assert.equal(db.auditLog.length, a);
  const dry = CMD.run(fresh(), at("2026-10-08"), "importHistoricalLoans", { batchId: "HL", source: "t", accounts: ACC, events: EV, dryRun: true }); assert.equal(dry.dryRun, true);
});
t("repayments clear interest first, oldest loan first; the second loan is reached only when the first is fully paid", () => {
  const db = fresh(); load(db); const a1 = HL.position(db, HL.loanIdFor("A1")), a2 = HL.position(db, HL.loanIdFor("A2"));
  assert.equal(a1.interestCharged, 57500); assert.equal(a1.interestReceived, 57500); assert.equal(a1.principalRepaid, 600000); assert.equal(a1.status, "Settled");
  assert.equal(a2.disbursed, 1550000); assert.equal(a2.interestCharged, 75000); assert.equal(a2.interestReceived, 75000); assert.equal(a2.principalRepaid, 1472500); assert.equal(a2.principalOutstanding, 77500); assert.equal(a2.status, "Open");
  const w = HL.walk(db, "SOB-001"); const s3 = w.steps.find((x) => x.decisionNo === 3), s8 = w.steps.find((x) => x.decisionNo === 8);
  assert.deepEqual(s3.parts.map((p) => [p.interest, p.principal]), [[20000, 0]], "the first payment goes to interest");
  assert.deepEqual(s8.parts.map((p) => [p.loanId, p.interest, p.principal]), [[HL.loanIdFor("A1"), 0, 437500], [HL.loanIdFor("A2"), 75000, 1187500]], "the first loan is cleared, only then the next one is reached (interest first)");
  assert.equal(w.excess, 0);
});
t("a payment above what is due is kept visible as excess, never dropped or hidden", () => {
  const db = fresh(); CMD.run(db, at("2026-10-08"), "importHistoricalLoans", { batchId: "HL", source: "t", accounts: [ACC[0]], events: [EV[0], { kind: "REPAYMENT", memberId: "SOB-001", date: "2025-03-01", amount: 620000, sourceRef: "x1", loanKeys: ["A1"] }] });
  const w = HL.walk(db, "SOB-001"); assert.equal(w.excess, 20000); assert.equal(HL.position(db, HL.loanIdFor("A1")).principalRepaid, 600000);
});
t("voiding a repayment re-computes the position (nothing is stored twice)", () => {
  const db = fresh(); load(db); const t9 = db.transactions.find((x) => x.sourceRef === "s9"); CMD.run(db, at("2026-10-08"), "voidEntry", { id: t9.id, reason: "test" }); const r = CMD.run(db, at("2026-10-09", "chair"), "approveRequest", { id: db.approvalRequests[0].id });
  assert.equal(HL.position(db, HL.loanIdFor("A2")).principalOutstanding, 77500 + 285000);
});
t("reports: the historical loan book and a loan statement list every event with its decision number", () => {
  const db = fresh(); load(db); const rep = FR.historicalLoans(db, "2026-10-08"); assert.equal(rep.rows.length, 2); assert.equal(rep.totals.principalUnpaid, 77500); assert.equal(rep.rows[1].registerAmount, 2000000, "register amount shown beside what was disbursed");
  const st = FR.historicalLoanStatement(db, HL.loanIdFor("A2"), "2026-10-08"); assert.ok(st.rows.some((r) => /decision #5/.test(r.event))); assert.equal(st.rows[st.rows.length - 1].owedAfter, 77500);
});
console.log(pass + " historical-loan tests passed");
