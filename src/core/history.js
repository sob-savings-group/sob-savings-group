/* SOB core/history — bulk, idempotent import of VERIFIED historical records (e.g. the 2024-2025 workbook) into members' lifetime histories.
   Every row keeps its ORIGINAL date and a source reference (file/sheet/row). Re-running a batch adds nothing (sourceRef idempotency), a row that
   matches an existing live entry (same member, date, type, amount) is reported as a possible duplicate and NOT added, and no amount is ever adjusted. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./governance.js") : root.SOB.gov);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.history = api; }
})(typeof self !== "undefined" ? self : this, function (dates, G) {
  const TYPES = ["Savings", "Withdraw", "Profit", "Share-Out"];
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36).toUpperCase().padStart(7, "0"); };
  const idFor = (ref) => "HIS-" + hash(ref) + hash(ref.split("").reverse().join(""));

  /* args: { batchId, source, entries:[{memberId,date,type,amount,sourceRef,purpose}], dryRun } */
  function importHistoricalEntries(db, ctx, a) {
    G.require(ctx, "history.import");
    const batchId = G.need(a.batchId, "batchId"), source = G.need(a.source, "source");
    const notes = Array.isArray(a.annotations) ? a.annotations : [];
    if (!Array.isArray(a.entries) || (!a.entries.length && !notes.length)) throw new Error("REQUIRED: entries");
    if (a.entries.length > 5000) throw new Error("INVALID: at most 5000 entries per call");
    const byRef = new Set(db.transactions.filter((t) => t.sourceRef).map((t) => t.sourceRef));
    const live = new Map(); db.transactions.filter((t) => !t.voided && !t.sourceRef).forEach((t) => { const k = [t.memberId, t.date, t.type, Number(t.amount)].join("|"); live.set(k, (live.get(k) || 0) + 1); });
    const members = new Set(db.members.map((m) => m.id));
    const out = { batchId, annotationsAdded: 0, annotationsAlreadyRecorded: 0, added: 0, alreadyImported: 0, possibleDuplicates: [], rejected: [], dryRun: !!a.dryRun, sum: { Savings: 0, Withdraw: 0, Profit: 0, "Share-Out": 0 } };
    const toAdd = [], seen = new Set();
    a.entries.forEach((e, i) => {
      const bad = (why) => out.rejected.push({ index: i, sourceRef: e && e.sourceRef, why });
      if (!e || !e.sourceRef) return bad("sourceRef required");
      if (!TYPES.includes(e.type)) return bad("type must be one of " + TYPES.join("/"));
      if (!members.has(e.memberId)) return bad("unknown member " + e.memberId);
      if (e.dateUnknown) { if (!dates.isISO(e.dateAfter)) return bad("dateUnknown rows need dateAfter (the last dated source row before it) as YYYY-MM-DD"); if (e.dateBefore && !dates.isISO(e.dateBefore)) return bad("dateBefore must be YYYY-MM-DD"); e = Object.assign({}, e, { date: e.dateAfter }); }
      else if (!dates.isISO(e.date)) return bad("date must be YYYY-MM-DD");
      const amt = Number(e.amount); if (!(amt > 0)) return bad("amount must be positive");
      if (byRef.has(e.sourceRef)) { out.alreadyImported++; return; }
      if (seen.has(e.sourceRef)) return bad("duplicate sourceRef inside batch");
      seen.add(e.sourceRef);
      const k = [e.memberId, e.date, e.type, amt].join("|");
      if (live.get(k) > 0) { out.possibleDuplicates.push({ index: i, sourceRef: e.sourceRef, memberId: e.memberId, date: e.date, type: e.type, amount: amt }); live.set(k, live.get(k) - 1); return; }
      toAdd.push({ e, amt });
    });
    if (out.rejected.length) throw new Error("INVALID: " + out.rejected.length + " row(s) rejected, nothing imported: " + JSON.stringify(out.rejected.slice(0, 3)));
    toAdd.forEach(({ e, amt }) => {
      out.added++; out.sum[e.type] += amt;
      if (a.dryRun) return;
      const m = db.members.find((x) => x.id === e.memberId);
      db.transactions.push({ id: idFor(e.sourceRef), date: e.date, memberId: e.memberId, memberName: m.name, amount: amt, type: e.type, purpose: e.purpose || e.type,
        historical: true, originalName: e.originalName || undefined, dateUnknown: e.dateUnknown ? true : undefined, dateAfter: e.dateUnknown ? e.dateAfter : undefined, dateBefore: e.dateUnknown && e.dateBefore ? e.dateBefore : undefined, sourceOrder: e.sourceOrder === undefined ? undefined : e.sourceOrder, decisionNo: e.decisionNo === undefined ? undefined : e.decisionNo, originalAmount: e.originalAmount === undefined ? undefined : Number(e.originalAmount), originalType: e.originalType || undefined, correctionNote: e.correctionNote || undefined, sourceRef: e.sourceRef, batchId, source, approvalStatus: "Approved", approvedBy: ctx.by, approvedAt: ctx.now, createdBy: ctx.by, createdByRole: ctx.role, createdAt: ctx.now });
    });
    /* Audit ANNOTATIONS: workbook rows with no amount, no date or a zero amount. They are disclosed and kept for the record but are NEVER ledger transactions. */
    const have = new Set((db.historicalNotes || []).map((n) => n.sourceRef));
    notes.forEach((n) => {
      if (!n || !n.sourceRef) throw new Error("INVALID: annotation needs a sourceRef"); if (have.has(n.sourceRef)) { out.annotationsAlreadyRecorded++; return; } have.add(n.sourceRef); out.annotationsAdded++;
      if (!a.dryRun) (db.historicalNotes = db.historicalNotes || []).push({ id: "HNO-" + hash(n.sourceRef) + hash(n.sourceRef.split("").reverse().join("")), sourceRef: String(n.sourceRef), memberId: n.memberId || "", date: n.date || "", amount: n.amount === undefined ? null : n.amount, note: String(n.note || "").slice(0, 400), batchId, source, recordedBy: ctx.by, recordedAt: ctx.now, isTransaction: false });
    });
    if (!a.dryRun) G.audit(db, ctx, "HistoricalImport", batchId, "Imported", null, { source, added: out.added, alreadyImported: out.alreadyImported, possibleDuplicates: out.possibleDuplicates.length, annotations: out.annotationsAdded, sum: out.sum }, "Verified historical records; original dates and source references preserved");
    return out;
  }
  return { TYPES, idFor, importHistoricalEntries };
});
