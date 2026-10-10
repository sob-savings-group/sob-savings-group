const assert = require("assert"), crypto = require("crypto");
const S = require("../src/backend/store.js"), B = require("../src/backend/backup.js"), M = require("../src/core/migrate.js"), L = require("../src/core/ledger.js");
const raw = require("./helpers/synth.js").legacyRaw();
function mockSS() {
  const sheets = {};
  const mk = () => { const data = []; return { data, getLastRow: () => data.length, getLastColumn: () => data.reduce((a, r) => Math.max(a, r.length), 0),
    getRange(r, c, nr, nc) { return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (data[r - 1 + i] && data[r - 1 + i][c - 1 + j] !== undefined ? data[r - 1 + i][c - 1 + j] : ""))),
      setValues: (v) => { if (v.length !== nr || v.some((row) => row.length !== nc)) throw new Error("The number of columns in the data does not match the number of columns in the range. The data has " + (v[0] ? v[0].length : 0) + " but the range has " + nc + "."); v.forEach((row, i) => row.forEach((x, j) => { data[r - 1 + i] = data[r - 1 + i] || []; data[r - 1 + i][c - 1 + j] = x; })); },
      clearContent: () => { for (let i = 0; i < nr; i++) if (data[r - 1 + i]) for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = ""; } }; } }; };
  return { sheets, getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mk()) };
}
let clock = Date.parse("2026-01-01T02:00:00Z");
const env = { now: () => new Date(clock).toISOString(), hash: (s) => crypto.createHash("sha256").update(s).digest("hex") };
const day = (n) => { clock += (n || 1) * 86400000; };
let pass = 0; const t = (n, f) => { try { f(); pass++; console.log("  ok  " + n); } catch (e) { process.exitCode = 1; console.log("FAIL  " + n + "\n      " + e.message); } };
const world = () => { const ss = mockSS(); const db = M.migrateLegacy(raw, "2026-03-31"); S.writeAll(ss, db); S.writeCollection(ss, "users", [{ id: "ADMIN", name: "A", role: "Admin", salt: "s", pinHash: "h", status: "Active" }]); S.writeMeta(ss, { revision: 5, schemaVersion: 2, seq: 0 }); return { ss, db }; };
const bump = (ss) => { const m = S.readMeta(ss); S.writeMeta(ss, { revision: Number(m.revision) + 1, schemaVersion: 2, seq: 0 }); };

console.log("backups");
t("snapshot is chunked, verified on read, excludes credentials, and equals the live ledger", () => {
  const { ss } = world(); const r = B.snapshot(ss, env, "t"); assert.ok(r.ok && r.chunks >= 1);
  const b = B.read(ss, env, r.id); assert.ok(b.ok); assert.equal(b.db.users, undefined); assert.ok(!JSON.stringify(b.db).includes('"pinHash"'));
  const live = S.readAll(ss); assert.equal(b.db.transactions.length, live.transactions.length); assert.equal(L.computeGroupTotals(b.db, "2026-03-31").groupSavings, L.computeGroupTotals(live, "2026-03-31").groupSavings);
});
t("unchanged ledger is not re-snapshotted; a change is", () => {
  const { ss } = world(); const a = B.snapshot(ss, env, "t"); day(); const b = B.snapshot(ss, env, "t"); assert.ok(b.skipped); assert.equal(b.id, a.id);
  bump(ss); const c = B.snapshot(ss, env, "t"); assert.ok(!c.skipped); assert.equal(B.list(ss).length, 2);
});
t("tampering with a stored chunk is detected; a missing chunk is detected; export checks counts too", () => {
  const { ss } = world(); const r = B.snapshot(ss, env, "t", { force: true });
  const sh = ss.getSheetByName("Backups"); const orig = sh.data[1][7]; sh.data[1][7] = orig.replace("SOB-001", "SOB-0O1");
  assert.equal(B.read(ss, env, r.id).error, "CHECKSUM_MISMATCH"); sh.data[1][7] = orig; assert.ok(B.read(ss, env, r.id).ok);
  if (sh.data.length > 2) { const dropped = sh.data.pop(); assert.equal(B.read(ss, env, r.id).error, "INCOMPLETE_BACKUP"); sh.data.push(dropped); }
  const ex = B.makeExport(env, S.readAll(ss), "x"); assert.ok(B.verifyExport(env, ex).ok);
  assert.equal(B.verifyExport(env, Object.assign({}, ex, { payload: ex.payload.replace("SOB-001", "SOB-0O1") })).error, "CHECKSUM_MISMATCH");
  assert.equal(B.verifyExport(env, { format: "other" }).error, "NOT_A_SOB_BACKUP");
});
t("retention keeps the newest 3 plus one per month and every pre-restore snapshot; newest are never pruned", () => {
  const { ss } = world();
  for (let i = 0; i < 70; i++) { bump(ss); B.snapshot(ss, env, "daily", { keep: { daily: 3, monthly: 2 } }); day(); }
  const l = B.list(ss); const months = new Set(l.map((b) => b.createdAt.slice(0, 7)));
  assert.ok(l.length <= 3 + 2, "kept " + l.length); assert.equal(l[0].revision, Number(S.readMeta(ss).revision), "newest snapshot is the current state");
  assert.ok(l.slice(0, 3).every((b, i) => i === 0 || b.createdAt < l[i - 1].createdAt)); assert.ok(months.size >= 2);
  B.snapshot(ss, env, "pre-restore (x)", { force: true }); for (let i = 0; i < 5; i++) { bump(ss); B.snapshot(ss, env, "daily", { keep: { daily: 1, monthly: 1 } }); day(); }
  assert.ok(B.list(ss).some((b) => /^pre-restore/.test(b.label)));
});
t("restore returns the ledger to the snapshot, keeps users, snapshots the pre-restore state first, and audits the restore", () => {
  const { ss } = world(); const snap = B.snapshot(ss, env, "good"); const n0 = S.readCollection(ss, "transactions").length;
  const tx = S.readCollection(ss, "transactions"); tx.push({ id: "TXN-LATE", date: "2026-04-01", memberId: tx[0].memberId, amount: 777, type: "Savings" }); S.writeCollection(ss, "transactions", tx); bump(ss); day();
  const r = B.restore(ss, env, snap.id, "Owner"); assert.ok(r.ok, r.error); assert.equal(r.droppedAfterBackup.transactions, 1);
  assert.equal(S.readCollection(ss, "transactions").length, n0); assert.equal(S.readCollection(ss, "users").length, 1);
  const aud = S.readCollection(ss, "auditLog").pop(); assert.equal(aud.action, "Restored from backup"); assert.equal(aud.newValue.droppedAfterBackup.transactions, 1);
  const pre = B.read(ss, env, r.preRestoreSnapshot); assert.ok(pre.ok); assert.ok(pre.db.transactions.some((x) => x.id === "TXN-LATE"), "nothing is lost: the pre-restore state is kept");
  assert.equal(S.readMeta(ss).revision, 7); assert.equal(B.restore(ss, env, "BK-nope").error, "NOT_FOUND");
});
t("a corrupted snapshot is refused for restore and leaves the ledger untouched", () => {
  const { ss } = world(); const snap = B.snapshot(ss, env, "x"); ss.getSheetByName("Backups").data[1][7] += "x"; const before = JSON.stringify(S.readAll(ss));
  assert.equal(B.restore(ss, env, snap.id).error, "CHECKSUM_MISMATCH"); assert.equal(JSON.stringify(S.readAll(ss)), before);
});
console.log(pass + " passed");
