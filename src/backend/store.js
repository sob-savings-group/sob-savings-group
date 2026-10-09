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
    approvalRequests: { sheet: "ApprovalRequests", cols: [] },
    historicalNotes: { sheet: "HistoricalNotes", cols: [] },
    yearCycles: { sheet: "YearCycles", cols: ["year","status","openedDate","closedDate","shareOutId"] },
    shareOutEvents: { sheet: "ShareOutEvents", cols: ["id","year","date","executedBy","totalWithdrawn","loanHolderTreatment","entries","profit"] },
    historicalLoans: { sheet: "HistoricalLoans", cols: [] },
    loanInterestRecords: { sheet: "LoanInterestRecords", cols: [] },
    reserveFund: { sheet: "GeneralReserveFund", cols: [] },
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
  /* GOOGLE SHEETS CONVERTS TEXT THAT LOOKS LIKE A DATE / DATE-TIME / NUMBER into a real date or number when a script writes it, and getValues then returns a Date.
     Two defences: (1) text columns are formatted as plain text, so Sheets stores exactly what was written; (2) any Date that still comes back is turned into the text it must have been
     (yyyy-MM-dd for a calendar day, a full ISO timestamp otherwise), using the spreadsheet's own time zone. */
  const NUMERIC = new Set(["amount", "loanAmount", "assignedMonthlyInterest", "graceMonths", "forYear", "year", "totalWithdrawn", "airtimeAmount", "fee", "total", "attempts"]);
  const isDate = (v) => Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime());
  const tzOf = (ss) => { try { if (ss && ss.getSpreadsheetTimeZone) return ss.getSpreadsheetTimeZone() || "Africa/Kampala"; } catch (e) {} return "Africa/Kampala"; };
  function stamp(d, tz) {
    if (typeof Utilities !== "undefined" && Utilities.formatDate) return Utilities.formatDate(d, tz, "yyyy-MM-dd HH:mm:ss");
    const p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).forEach((x) => { p[x.type] = x.value; });
    return p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute + ":" + p.second;
  }
  const fixCell = (v, tz) => { if (!isDate(v)) return v; const t = stamp(v, tz); return t.slice(11) === "00:00:00" && v.getMilliseconds() === 0 ? t.slice(0, 10) : v.toISOString(); };
  function ensureText(sh, cols, needRows) {
    try {
      if (!sh.getRange || !sh.getMaxRows) return;
      let max = sh.getMaxRows(); if (max < needRows + 100) { sh.insertRowsAfter(max, needRows + 500 - max); max = sh.getMaxRows(); }   // formatting can only cover rows that exist
      const textAt = cols.map((c) => !NUMERIC.has(c)).concat([true]), first = textAt.indexOf(true), probe = sh.getRange(max, first + 1, 1, 1);
      if (probe.getNumberFormat && probe.getNumberFormat() === "@") return;
      for (let i = 0; i < textAt.length; i++) { if (!textAt[i]) continue; let j = i; while (j + 1 < textAt.length && textAt[j + 1]) j++; sh.getRange(1, i + 1, max, j - i + 1).setNumberFormat("@"); i = j; }   // one call per run of text columns
    } catch (e) { /* formatting is a safeguard; reading still repairs any converted value */ }
  }
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
    const tz = tzOf(ss), rows = sh.getRange(2, 1, sh.getLastRow() - 1, c.cols.length + 1).getValues().map((r) => r.map((v) => fixCell(v, tz)));
    if (!c.cols.length) return rows.map((r) => dec(r[0])).filter((x) => x !== undefined);
    return rows.filter((r) => r.some((v) => v !== "")).map((r) => fromRow(c.cols, r));
  }
  const CELL_LIMIT = 45000; // Google Sheets hard limit is 50,000 characters per cell
  function writeCollection(ss, k, list) {
    const c = COLLECTIONS[k]; const header = c.cols.length ? c.cols.concat(["_extra"]) : ["_extra"]; const sh = sheetOf(ss, c.sheet, header);
    const rows = c.cols.length ? list.map((o) => toRow(c.cols, o)) : list.map((o) => [enc(o)]); const width = c.cols.length ? c.cols.length + 1 : 1;   // exactly as wide as the range: Sheets rejects ragged data
    rows.forEach((r, i) => r.forEach((v) => { if (typeof v === "string" && v.length > CELL_LIMIT) throw new Error("CELL_TOO_LARGE: " + k + " row " + (i + 1) + " exceeds the Sheets cell limit"); }));
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(width, sh.getLastColumn())).clearContent();
    if (c.cols.length) ensureText(sh, c.cols, rows.length + 1);
    sh.getRange(1, 1, 1, width).setValues([header]);
    if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows);
  }
  /* An EARLIER version wrote dates that Google Sheets converted and then saved them back in a shifted form. Detect exactly that damage, so the installer can clear the partial install and reload from the verified records. */
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
  function damagedByEarlierVersion(ss) {
    const bad = (list, f) => list.some((r) => r[f] !== undefined && r[f] !== "" && !(typeof r[f] === "string" && ISO_DAY.test(r[f])));
    const tx = readCollection(ss, "transactions"), mem = readCollection(ss, "members"), cyc = readCollection(ss, "yearCycles"), loans = readCollection(ss, "loans");
    const damaged = bad(tx, "date") || bad(mem, "regDate") || bad(cyc, "openedDate") || bad(cyc, "closedDate") || bad(loans, "date");
    const approved = readCollection(ss, "approvalRequests").some((q) => q && (q.status === "Approved"));
    return { damaged, approved };
  }
  /* Clears every ledger table (never the sign-ins, never the backups). Only ever called by the installer on a partial install, before anything was approved. */
  function resetPlatformData(ss) {
    Object.keys(COLLECTIONS).forEach((k) => { if (k === "users") return; const sh = ss.getSheetByName(COLLECTIONS[k].sheet); if (sh && sh.getLastRow() > 1) writeCollection(ss, k, []); });
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
    if (sh && sh.getLastRow() >= 1) { const tz = tzOf(ss); sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach((r) => { if (r[0]) m[r[0]] = fixCell(r[1], tz); }); }
    return m;
  }
  function writeMeta(ss, m) {
    const sh = sheetOf(ss, META); const keys = Object.keys(m);
    sh.getRange(1, 1, keys.length, 2).setValues(keys.map((k) => [k, m[k]]));
  }
  return { COLLECTIONS, writeChanged, readCollection, writeCollection, readAll, writeAll, guardNoLoss, readMeta, writeMeta, toRow, fromRow, damagedByEarlierVersion, resetPlatformData };
});
