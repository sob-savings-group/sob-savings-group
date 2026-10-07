const assert = require("assert");
const G = require("../src/core/governance.js"), H = require("../src/core/history.js"), CMD = require("../src/core/commands.js"), L = require("../src/core/ledger.js"), S = require("../src/backend/store.js");
let f = 0; const t = (n, fn) => { try { fn(); console.log("  ok  " + n); } catch (e) { f++; process.exitCode = 1; console.log("FAIL  " + n + "\n      " + e.message); } };
const mk = () => ({ members: [{ id: "SOB-001", name: "Demo A" }, { id: "SOB-002", name: "Demo B" }], transactions: [{ id: "T1", date: "2026-01-04", memberId: "SOB-001", amount: 5000, type: "Savings" }], loans: [], auditLog: [] });
const admin = G.makeCtx({ name: "Admin", id: "u1", role: "Admin" }), member = G.makeCtx({ name: "M", id: "u2", role: "Member", memberId: "SOB-001" });
const rows = () => [
  { memberId: "SOB-001", date: "2024-03-03", type: "Savings", amount: 20000, sourceRef: "wb:A!r5" },
  { memberId: "SOB-001", date: "2025-03-31", type: "Profit", amount: 1234, sourceRef: "wb:A!r9", purpose: "Interest credited (historical)" },
  { memberId: "SOB-001", date: "2025-12-21", type: "Share-Out", amount: 21000, sourceRef: "wb:A!r10" }];
t("imports with original dates, source refs and audit; savings arithmetic exact", () => {
  const db = mk(); const r = CMD.run(db, admin, "importHistoricalEntries", { batchId: "B1", source: "workbook", entries: rows() });
  assert.equal(r.added, 3); const x = db.transactions.find((q) => q.sourceRef === "wb:A!r5");
  assert.equal(x.date, "2024-03-03"); assert.equal(x.amount, 20000); assert.ok(x.historical && x.id.startsWith("HIS-"));
  assert.equal(L.memberSavings(db, "SOB-001"), 5000 + 20000 + 1234 - 21000);
  assert.ok(db.auditLog.some((a) => a.entityType === "HistoricalImport"));
});
t("idempotent: re-running adds nothing and ids are deterministic", () => {
  const db = mk(); CMD.run(db, admin, "importHistoricalEntries", { batchId: "B1", source: "w", entries: rows() });
  const ids = db.transactions.map((q) => q.id); const r = CMD.run(db, admin, "importHistoricalEntries", { batchId: "B1", source: "w", entries: rows() });
  assert.equal(r.added, 0); assert.equal(r.alreadyImported, 3); assert.deepEqual(db.transactions.map((q) => q.id), ids);
  const db2 = mk(); CMD.run(db2, admin, "importHistoricalEntries", { batchId: "B1", source: "w", entries: rows() }); assert.deepEqual(db2.transactions.map((q) => q.id), ids);
});
t("a row equal to an existing live entry is reported, not duplicated", () => {
  const db = mk(); const r = CMD.run(db, admin, "importHistoricalEntries", { batchId: "B2", source: "w", entries: [{ memberId: "SOB-001", date: "2026-01-04", type: "Savings", amount: 5000, sourceRef: "wb:Z!r1" }] });
  assert.equal(r.added, 0); assert.equal(r.possibleDuplicates.length, 1); assert.equal(db.transactions.length, 1);
});
t("any bad row rejects the whole batch (nothing imported); unknown member / bad date / bad type", () => {
  const db = mk(); const bad = rows().concat([{ memberId: "SOB-999", date: "2024-01-01", type: "Savings", amount: 1, sourceRef: "x" }]);
  assert.throws(() => CMD.run(db, admin, "importHistoricalEntries", { batchId: "B3", source: "w", entries: bad }), /rejected/); assert.equal(db.transactions.length, 1);
  assert.throws(() => CMD.run(db, admin, "importHistoricalEntries", { batchId: "B3", source: "w", entries: [{ memberId: "SOB-001", date: "01/02/2024", type: "Savings", amount: 5, sourceRef: "y" }] }), /rejected/);
  assert.throws(() => CMD.run(db, admin, "importHistoricalEntries", { batchId: "B3", source: "w", entries: [{ memberId: "SOB-001", date: "2024-01-02", type: "Loan Disbursement", amount: 5, sourceRef: "y" }] }), /rejected/);
});
t("dry run changes nothing; Members cannot import", () => {
  const db = mk(); const r = CMD.run(db, admin, "importHistoricalEntries", { batchId: "B4", source: "w", entries: rows(), dryRun: true });
  assert.equal(r.added, 3); assert.equal(db.transactions.length, 1);
  assert.throws(() => CMD.run(db, member, "importHistoricalEntries", { batchId: "B4", source: "w", entries: rows() }), /FORBIDDEN/);
});
t("sourceRef survives the Sheet round-trip (idempotency holds after storage)", () => {
  const db = mk(); CMD.run(db, admin, "importHistoricalEntries", { batchId: "B5", source: "w", entries: rows() });
  const back = S.fromRow(S.COLLECTIONS.transactions.cols, S.toRow(S.COLLECTIONS.transactions.cols, db.transactions.find((q) => q.sourceRef === "wb:A!r9")));
  assert.equal(back.sourceRef, "wb:A!r9"); assert.equal(back.historical, true); assert.equal(back.date, "2025-03-31");
});
t("addMember accepts only a well-formed, unused confirmed id", () => {
  const db = mk(); const m = CMD.run(db, admin, "addMember", { id: "SOB-057", name: "Confirmed One", regDate: "2024-01-14" }); assert.equal(m.id, "SOB-057"); assert.equal(m.regDate, "2024-01-14");
  assert.throws(() => CMD.run(db, admin, "addMember", { id: "SOB-057", name: "Again" }), /DUPLICATE_MEMBER/); const blank = CMD.run(db, admin, "addMember", { id: "SOB-056", name: "No Date Known", regDate: "" }); assert.equal(blank.regDate, "", "an unknown registration date stays blank, never assumed");
  assert.throws(() => CMD.run(db, admin, "addMember", { id: "57", name: "Bad" }), /INVALID/);
  const r = CMD.run(db, admin, "importHistoricalEntries", { batchId: "B6", source: "w", entries: [{ memberId: "SOB-057", date: "2024-01-14", type: "Savings", amount: 100, sourceRef: "n1", originalName: "As Written" }] });
  assert.equal(db.transactions.find((q) => q.sourceRef === "n1").originalName, "As Written");
});
t("rows without a date or amount are audit ANNOTATIONS: stored once, never ledger transactions, idempotent, savings unchanged", () => {
  const db = mk(), notes = [{ sourceRef: "wb:A!r50", memberId: "SOB-001", amount: -150000, note: "no date: not posted" }, { sourceRef: "wb:A!r51", memberId: "SOB-002", amount: 0, date: "2025-01-01", note: "zero amount" }];
  const before = L.memberSavings(db, "SOB-001"), n0 = db.transactions.length;
  const dry = CMD.run(db, admin, "importHistoricalEntries", { batchId: "B7", source: "w", entries: [], annotations: notes, dryRun: true }); assert.equal(dry.annotationsAdded, 2); assert.equal(db.historicalNotes, undefined);
  const r = CMD.run(db, admin, "importHistoricalEntries", { batchId: "B7", source: "w", entries: [], annotations: notes }); assert.equal(r.annotationsAdded, 2); assert.equal(db.historicalNotes.length, 2); assert.equal(db.transactions.length, n0); assert.equal(L.memberSavings(db, "SOB-001"), before);
  const again = CMD.run(db, admin, "importHistoricalEntries", { batchId: "B7", source: "w", entries: [], annotations: notes }); assert.equal(again.annotationsAdded, 0); assert.equal(again.annotationsAlreadyRecorded, 2); assert.equal(db.historicalNotes.length, 2);
  assert.equal(db.historicalNotes.every((x) => x.isTransaction === false), true);
  assert.throws(() => CMD.run(db, member, "importHistoricalEntries", { batchId: "B8", source: "w", entries: [], annotations: notes }), /FORBIDDEN/);
});
t("exception-register items carry the full disclosure detail", () => {
  const db = mk(); const d = CMD.run(db, admin, "openDiscrepancy", { kind: "MISSING_ENTRY", subject: "SOB-001 | r9", summary: "row not imported", sourceValue: 5000, detail: { member: "SOB-001", sourceRow: "r9", date: "2025-01-01", amount: 5000, unknown: "savings or loan repayment", why: "no label", affectsCurrentBalance: "Yes" } });
  assert.equal(d.detail.affectsCurrentBalance, "Yes"); const back = S.fromRow(S.COLLECTIONS.discrepancies.cols, S.toRow(S.COLLECTIONS.discrepancies.cols, d)); assert.equal(back.detail.unknown, "savings or loan repayment");
});
console.log(f ? f + " FAILED" : "history passed");
