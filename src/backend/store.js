/* SOB backend/store — Sheets <-> ledger-db mapping. Portable: all Sheets access goes through an injected `ss` (SpreadsheetApp-like),
   so the same code is tested against a mock and could target another store later. Every collection has fixed columns plus an
   `_extra` JSON column, so fields added in future versions are never lost. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory();
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.store = api; }
})(typeof self !== "undefined" ? self : this, function () {
  const COLLECTIONS = {
    members: { sheet: "Members", cols: ["id","name","phone","email","location","regDate","status"] },
    transactions: { sheet: "Ledger", cols: ["id","date","memberId","amount","type","purpose","loanId","forYear","shareOutId","receipt","bankedBy","receivedBy","createdBy","approvedBy","approvalStatus","voided","voidReason","voidedAt","voidedBy"] },
    loans: { sheet: "Loans", cols: ["id","date","memberId","loanAmount","assignedMonthlyInterest","graceMonths","status","datePaidFull","legacy","voided","voidReason","purpose","interestHistory","penalties"] },
    guarantees: { sheet: "Guarantees", cols: ["id","loanId","guarantorId","amount","status","dateCommitted","dateReleased","releaseReason","committedBy"] },
    securities: { sheet: "Securities", cols: [] },
    policy: { sheet: "Policy", cols: [] },
    yearCycles: { sheet: "YearCycles", cols: ["year","status","openedDate","closedDate","shareOutId"] },
    shareOutEvents: { sheet: "ShareOutEvents", cols: ["id","year","date","executedBy","totalWithdrawn","loanHolderTreatment","entries","profit"] },
    profitDistributions: { sheet: "ProfitDistributions", cols: ["id","period","status","rows"] },
    auditLog: { sheet: "AuditLog", cols: ["id","timestamp","date","entityType","entityId","action","previousValue","newValue","by","role","reason"] },
    discrepancies: { sheet: "Discrepancies", cols: ["id","kind","subject","summary","platformValue","sourceValue","source","status","openedDate","openedBy","resolvedDate","resolvedBy","decision","resolutionReason","evidence","correctingEntryId"] },
    users: { sheet: "Users", cols: ["id","name","role","memberId","phone","status","salt","pinHash"] },
    requests: { sheet: "Requests", cols: ["id","date","memberId","type","amount","note","status"] },
    airtimeRequests: { sheet: "Airtime", cols: ["id","date","memberId","memberName","phone","airtimeAmount","fee","total","status","fulfilledDate","fulfilledBy","entryId","rejectReason"] },
    outbox: { sheet: "Outbox", cols: ["id","createdAt","memberId","to","channel","template","body","status","reason","attempts","lastAttemptAt","mode","providerRef","dedupeKey","createdBy"] },
    reconciliations: { sheet: "Reconciliations", cols: [] },
    smsFailures: { sheet: "SmsFailures", cols: [] },
    legacyAdministration: { sheet: "LegacyAdministration", cols: [] }
  };
  const META = "Meta";
  const enc = (v) => (v === undefined || v === null ? "" : (typeof v === "object" ? "json:" + JSON.stringify(v) : v));
  const dec = (v) => (typeof v === "string" && v.startsWith("json:") ? JSON.parse(v.slice(5)) : v === "" ? undefined : v);
  const NUM = /^-?\d+(\.\d+)?$/;
  function toRow(cols, obj) {
    const extra = {}; Object.keys(obj).forEach((k) => { if (!cols.includes(k) && obj[k] !== undefined) extra[k] = obj[k]; });
    return cols.map((c) => enc(obj[c])).concat([Object.keys(extra).length ? "json:" + JSON.stringify(extra) : ""]);
  }
  function fromRow(cols, row) {
    const o = {}; cols.forEach((c, i) => { const v = dec(row[i]); if (v !== undefined) o[c] = v; });
    const x = dec(row[cols.length]); if (x) Object.assign(o, x);
    return o;
  }
  function sheetOf(ss, name, header) {
    let sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); if (header) { sh.getRange(1, 1, 1, header.length).setValues([header]); } }
    return sh;
  }
  function readCollection(ss, k) {
    const c = COLLECTIONS[k]; const sh = ss.getSheetByName(c.sheet);
    if (!sh || sh.getLastRow() < 2) return [];
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, c.cols.length + 1).getValues();
    if (!c.cols.length) return rows.map((r) => dec(r[0])).filter((x) => x !== undefined);
    return rows.filter((r) => r.some((v) => v !== "")).map((r) => fromRow(c.cols, r));
  }
  const CELL_LIMIT = 45000; // Google Sheets hard limit is 50,000 characters per cell
  function writeCollection(ss, k, list) {
    const c = COLLECTIONS[k]; const header = c.cols.concat(["_extra"]); const sh = sheetOf(ss, c.sheet, header);
    const rows = c.cols.length ? list.map((o) => toRow(c.cols, o)) : list.map((o) => [enc(o), ""]); const width = c.cols.length + 1;
    rows.forEach((r, i) => r.forEach((v) => { if (typeof v === "string" && v.length > CELL_LIMIT) throw new Error("CELL_TOO_LARGE: " + k + " row " + (i + 1) + " exceeds the Sheets cell limit"); }));
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(width, sh.getLastColumn())).clearContent();
    sh.getRange(1, 1, 1, width).setValues([header]);
    if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows);
  }
  function readAll(ss) {
    const db = {};
    Object.keys(COLLECTIONS).forEach((k) => { db[k] = readCollection(ss, k); });
    const meta = readMeta(ss); db.schemaVersion = Number(meta.schemaVersion || 2); db.seq = Number(meta.seq || 0); db.revision = Number(meta.revision || 0);
    return db;
  }
  /* Writes are append-safe by design: a snapshot may never shrink the ledger or audit log (void, never delete). */
  function guardNoLoss(cur, db) {
    ["transactions", "loans", "members", "auditLog"].forEach((k) => {
      const have = new Set(cur[k].map((r) => String(r.id)));
      const sent = new Set((db[k] || []).map((r) => String(r.id)));
      have.forEach((id) => { if (!sent.has(id)) throw new Error("REJECTED: snapshot would remove " + k + " record " + id + " (records are voided, never deleted)"); });
    });
  }
  /* Users are never part of a ledger snapshot: credentials change only through the auth paths. */
  function writeAll(ss, db) {
    Object.keys(COLLECTIONS).forEach((k) => { if (k !== "users") writeCollection(ss, k, db[k] || []); });
  }
  /* Persist only the collections a command actually changed (faster, and untouched sheets cannot be damaged). */
  function writeChanged(ss, before, after) {
    const changed = [];
    Object.keys(COLLECTIONS).forEach((k) => { if (k === "users") return; if (JSON.stringify(before[k] || []) !== JSON.stringify(after[k] || [])) { writeCollection(ss, k, after[k] || []); changed.push(k); } });
    return changed;
  }
  function readMeta(ss) {
    const sh = ss.getSheetByName(META); const m = {};
    if (sh && sh.getLastRow() >= 1) sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach((r) => { if (r[0]) m[r[0]] = r[1]; });
    return m;
  }
  function writeMeta(ss, m) {
    const sh = sheetOf(ss, META); const keys = Object.keys(m);
    sh.getRange(1, 1, keys.length, 2).setValues(keys.map((k) => [k, m[k]]));
  }
  return { COLLECTIONS, writeChanged, readCollection, writeCollection, readAll, writeAll, guardNoLoss, readMeta, writeMeta, toRow, fromRow };
});
