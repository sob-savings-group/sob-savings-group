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
console.log(f ? f + " FAILED" : "history passed");
