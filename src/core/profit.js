/* SOB core/profit — profit distribution that is transparent and explainable member by member.
   SOB rule: profit is shared PROPORTIONALLY to members' savings, together with the other legitimate underlying factors that apply to the distribution.
   Nothing is invented: the engine uses only (1) each member's savings at the distribution date and (2) factors that SOB has APPROVED and Admin has registered
   in the approved-factor list (db.policy "profit"), each with its approver and reference. The confirmed exclusion (members with an outstanding loan share in no profit)
   is pre-registered. Every result carries the factors, per-member values, weights and rounding, so Admin can drill down to see exactly how each figure arose.
   Rounding: each entitlement is rounded DOWN to a whole shilling; any remainder is shown as undistributed — it is never silently assigned to someone. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./governance.js") : root.SOB.gov);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.profit = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, G) {
  const asAt = (db, date) => Object.assign({}, db, { transactions: db.transactions.filter((t) => t.date <= date) });

  function preview(db, a) {
    a = a || {};
    const pool = Number(a.pool); if (!(pool > 0)) throw new Error("INVALID: pool (the profit amount to distribute) must be positive");
    const date = a.date; if (!dates.isISO(date)) throw new Error("INVALID: date (YYYY-MM-DD) - savings are measured at this date");
    const reg = L.getPolicy(db, "profit").factors || [], fv = a.factorValues || {};
    Object.keys(fv).forEach((id) => { if (!reg.some((f) => f.id === id)) throw new Error("UNAPPROVED_FACTOR: '" + id + "' is not in SOB's approved-factor list"); });
    const snap = asAt(db, date);
    const rows = db.members.filter((m) => m.status !== "Inactive").map((m) => {
      const savings = L.memberSavings(snap, m.id), factors = [], why = [];
      let weight = savings > 0 ? savings : 0, eligible = savings > 0;
      if (savings <= 0) why.push("no savings at " + date);
      reg.forEach((f) => {
        if (f.id === "LOAN_HOLDER_EXCLUSION") { const owes = L.memberHasOutstandingLoan(snap, m.id, date); factors.push({ id: f.id, name: f.name, kind: f.kind, value: owes ? "outstanding loan - excluded" : "no outstanding loan" }); if (owes) { eligible = false; why.push("has an outstanding loan"); } return; }
        const v = fv[f.id] ? fv[f.id][m.id] : undefined;
        if (f.kind === "eligibility") { const ok = v === undefined ? true : !!v; factors.push({ id: f.id, name: f.name, kind: f.kind, value: ok }); if (!ok) { eligible = false; why.push(f.name); } }
        else { const mult = v === undefined ? 1 : Number(v); if (!(mult >= 0)) throw new Error("INVALID: factor " + f.id + " value for " + m.id); factors.push({ id: f.id, name: f.name, kind: f.kind, value: mult, defaulted: v === undefined }); weight *= mult; }
      });
      if (!eligible) weight = 0;
      return { memberId: m.id, name: m.name, savings, eligible, excludedBecause: why.join("; "), factors, weight };
    });
    const total = rows.reduce((x, r) => x + r.weight, 0);
    rows.forEach((r) => { r.sharePct = total > 0 ? Math.round((r.weight / total) * 1e6) / 1e4 : 0; r.entitlement = total > 0 ? Math.floor(pool * r.weight / total) : 0; });
    const distributed = rows.reduce((x, r) => x + r.entitlement, 0);
    return { date, pool, basis: "Savings balance of each member at " + date + " (lifetime ledger up to that date)", factorsUsed: reg.map((f) => ({ id: f.id, name: f.name, kind: f.kind, approvedBy: f.approvedBy, approvalRef: f.approvalRef })),
      totalWeight: total, rows, distributed, undistributed: pool - distributed, eligibleMembers: rows.filter((r) => r.eligible).length, excludedMembers: rows.filter((r) => !r.eligible && r.savings > 0).length,
      formula: "entitlement = floor( pool x weight / sum of weights ), weight = savings x product of approved multiplier factors (0 if excluded)" };
  }
  function distribute(db, ctx, a) {
    G.require(ctx, "profit.distribute"); a = a || {};
    const period = G.need(a.period, "period (e.g. 2026-Q1)"); G.need(a.sourceNote, "sourceNote (where this profit came from)");
    if ((db.profitDistributions || []).some((d) => d.period === period && d.status === "Posted")) throw new Error("ALREADY_DISTRIBUTED: " + period);
    const pv = preview(db, a);
    const rec = { id: G.uid("PRD"), period, status: "Posted", date: pv.date, pool: pv.pool, sourceNote: String(a.sourceNote).trim(), basis: pv.basis, formula: pv.formula, factorsUsed: pv.factorsUsed, rows: pv.rows, distributed: pv.distributed, undistributed: pv.undistributed, executedBy: ctx.by, executedDate: ctx.today };
    (db.profitDistributions = db.profitDistributions || []).push(rec);
    pv.rows.filter((r) => r.entitlement > 0).forEach((r) => { const t = G.createEntry(db, ctx, { date: pv.date, memberId: r.memberId, amount: r.entitlement, type: "Profit", purpose: "Profit distribution " + period, profitDistributionId: rec.id }); r.entryId = t.id; });
    G.audit(db, ctx, "ProfitDistribution", rec.id, "Posted", null, { period, pool: pv.pool, distributed: pv.distributed, undistributed: pv.undistributed, members: pv.rows.filter((r) => r.entitlement > 0).length }, a.sourceNote);
    return rec;
  }
  return { preview, distribute };
});
