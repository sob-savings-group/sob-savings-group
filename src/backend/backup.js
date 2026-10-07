/* SOB backend/backup — point-in-time snapshots of the ledger. Portable (all Sheets access via the injected `ss`).
   In-sheet snapshots live in a "Backups" sheet (chunked JSON + SHA-256), are verified on read, and are pruned by a retention rule that never
   touches the newest ones. Credentials (Users sheet) are NEVER part of a backup: after a disaster, sign-ins are re-provisioned. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./store.js") : root.SOB.store);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.backup = api; }
})(typeof self !== "undefined" ? self : this, function (S) {
  const SHEET = "Backups", HEADER = ["backupId", "label", "createdAt", "revision", "chunk", "chunks", "sha256", "data"], CHUNK = 40000;
  const FORMAT = "SOB-BACKUP-1";
  const counts = (db) => ({ members: db.members.length, transactions: db.transactions.length, loans: db.loans.length, auditLog: (db.auditLog || []).length });
  function strip(db) { const c = Object.assign({}, db); delete c.users; return c; }
  /* Portable export object (also what `sobctl backup` writes). */
  function makeExport(env, db, label) {
    const payload = JSON.stringify(strip(db));
    return { format: FORMAT, label: label || "", createdAt: env.now(), revision: Number(db.revision || 0), counts: counts(db), sha256: env.hash(payload), payload };
  }
  function verifyExport(env, ex) {
    if (!ex || ex.format !== FORMAT || typeof ex.payload !== "string") return { ok: false, error: "NOT_A_SOB_BACKUP" };
    if (env.hash(ex.payload) !== ex.sha256) return { ok: false, error: "CHECKSUM_MISMATCH" };
    let db; try { db = JSON.parse(ex.payload); } catch (e) { return { ok: false, error: "UNREADABLE" }; }
    const c = counts(db);
    for (const k of Object.keys(c)) if (c[k] !== ex.counts[k]) return { ok: false, error: "COUNT_MISMATCH " + k };
    return { ok: true, db, counts: c };
  }
  function sheet(ss) {
    let sh = ss.getSheetByName(SHEET);
    if (!sh) { sh = ss.insertSheet(SHEET); sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]); }
    return sh;
  }
  function rows(ss) { const sh = ss.getSheetByName(SHEET); return !sh || sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, HEADER.length).getValues().filter((r) => r[0] !== ""); }
  function list(ss) {
    const m = {}; rows(ss).forEach((r) => { if (!m[r[0]]) m[r[0]] = { id: r[0], label: r[1], createdAt: r[2], revision: Number(r[3]), chunks: Number(r[5]), sha256: r[6], found: 0 }; m[r[0]].found++; });
    return Object.keys(m).map((k) => m[k]).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  function write(ss, rs) {
    const sh = sheet(ss);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, HEADER.length).clearContent();
    if (rs.length) sh.getRange(2, 1, rs.length, HEADER.length).setValues(rs);
  }
  /* Take a snapshot. Skips (returns skipped:true) when nothing changed since the newest snapshot unless force. */
  function snapshot(ss, env, label, o) {
    o = o || {};
    const db = S.readAll(ss), cur = list(ss);
    if (!o.force && cur[0] && cur[0].revision === Number(db.revision || 0) && !/^pre-restore/.test(label || "")) return { ok: true, skipped: true, id: cur[0].id };
    const ex = makeExport(env, db, label);
    const id = "BK-" + ex.createdAt.replace(/[^0-9]/g, "").slice(0, 14) + "-" + (cur.length + 1);
    const n = Math.max(1, Math.ceil(ex.payload.length / CHUNK));
    const add = []; for (let i = 0; i < n; i++) add.push([id, ex.label, ex.createdAt, ex.revision, i, n, ex.sha256, ex.payload.slice(i * CHUNK, (i + 1) * CHUNK)]);
    write(ss, rows(ss).concat(add));
    prune(ss, o.keep);
    return { ok: true, id, revision: ex.revision, chunks: n, counts: ex.counts };
  }
  function read(ss, env, id) {
    const rs = rows(ss).filter((r) => r[0] === id).sort((a, b) => Number(a[4]) - Number(b[4]));
    if (!rs.length) return { ok: false, error: "NOT_FOUND" };
    if (rs.length !== Number(rs[0][5])) return { ok: false, error: "INCOMPLETE_BACKUP" };
    const payload = rs.map((r) => r[7]).join("");
    const first = rs[0], db = (() => { try { return JSON.parse(payload); } catch (e) { return null; } })();
    if (env.hash(payload) !== first[6] || !db) return { ok: false, error: "CHECKSUM_MISMATCH" };
    return { ok: true, id, db, revision: Number(first[3]), counts: counts(db) };
  }
  /* Retention: newest `daily` snapshots + the newest snapshot of each of the last `monthly` months + every pre-restore snapshot. */
  function prune(ss, keep) {
    keep = Object.assign({ daily: 30, monthly: 12 }, keep || {});
    const all = list(ss), keepIds = new Set(), months = new Set();
    all.forEach((b, i) => {
      if (i < keep.daily || /^pre-restore/.test(b.label)) keepIds.add(b.id);
      const mo = String(b.createdAt).slice(0, 7); if (!months.has(mo) && months.size < keep.monthly) { months.add(mo); keepIds.add(b.id); }
    });
    const rs = rows(ss), kept = rs.filter((r) => keepIds.has(r[0]));
    if (kept.length !== rs.length) write(ss, kept);
    return all.length - keepIds.size;
  }
  /* Disaster recovery from an in-sheet snapshot. Editor-only (never reachable through the web API). Takes a pre-restore snapshot first,
     writes every collection back (users untouched), bumps the revision, and records the restore in the audit log. */
  function restore(ss, env, id, who) {
    const b = read(ss, env, id); if (!b.ok) return b;
    const pre = snapshot(ss, env, "pre-restore (before restoring " + id + ")", { force: true });
    const cur = S.readAll(ss), dropped = { transactions: Math.max(0, cur.transactions.length - b.db.transactions.length), auditLog: Math.max(0, (cur.auditLog || []).length - (b.db.auditLog || []).length) };
    const db = Object.assign({}, b.db); db.auditLog = (db.auditLog || []).concat([{ id: "AUD-RESTORE-" + Date.now().toString(36).toUpperCase(), timestamp: env.now(), date: env.now().slice(0, 10), entityType: "System", entityId: id, action: "Restored from backup",
      previousValue: { revision: cur.revision, counts: counts(cur) }, newValue: { revision: b.revision, counts: b.counts, droppedAfterBackup: dropped }, by: who || "editor", role: "Owner", reason: "Disaster recovery; the state before restore is kept in snapshot " + pre.id }]);
    S.writeAll(ss, db);
    const rev = Number(cur.revision || 0) + 1;
    S.writeMeta(ss, { revision: rev, schemaVersion: db.schemaVersion || 2, seq: db.seq || 0, lastWrite: env.now() });
    return { ok: true, restored: id, preRestoreSnapshot: pre.id, revision: rev, counts: b.counts, droppedAfterBackup: dropped };
  }
  return { SHEET, FORMAT, makeExport, verifyExport, snapshot, list, read, prune, restore };
});
