/* SOB core/integrity — read-only health checks over a ledger. Reports findings; never modifies anything. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.integrity = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L) {
  function check(db, asOf) {
    asOf = asOf || dates.todayISO(); const out = [];
    const add = (severity, code, detail) => out.push({ severity, code, detail });
    const dupes = (arr, what) => { const seen = new Set(); arr.forEach((r) => { if (seen.has(r.id)) add("error", "DUPLICATE_ID", what + " " + r.id); seen.add(r.id); }); };
    dupes(db.members, "member"); dupes(db.transactions, "transaction"); dupes(db.loans, "loan");
    const mem = new Set(db.members.map((m) => m.id)), loanIds = new Set(db.loans.map((l) => l.id));
    db.transactions.forEach((t) => {
      if (!dates.isISO(t.date)) add("error", "BAD_DATE", "transaction " + t.id + " date '" + t.date + "'");
      else if (t.date > asOf) add("warning", "FUTURE_DATE", "transaction " + t.id + " dated " + t.date);
      if (!(Number(t.amount) > 0)) add("error", "BAD_AMOUNT", "transaction " + t.id + " amount " + t.amount);
      if (t.memberId && !mem.has(t.memberId)) add("error", "UNKNOWN_MEMBER", "transaction " + t.id + " -> " + t.memberId);
      if (t.loanId && !loanIds.has(t.loanId)) add("error", "UNKNOWN_LOAN", "transaction " + t.id + " -> " + t.loanId);
    });
    db.loans.filter((l) => !l.voided).forEach((l) => {
      if (!mem.has(l.memberId)) add("error", "LOAN_UNKNOWN_MEMBER", l.id);
      if (!dates.isISO(l.date) && !["Pending", "Declined"].includes(l.status)) add("error", "LOAN_BAD_DATE", l.id);
      if (!(l.assignedMonthlyInterest >= 0) && l.status === "Active") add("error", "LOAN_NO_INTEREST", l.id + " has no assigned interest");
      const disb = L.activeTransactions(db).filter((t) => t.loanId === l.id && t.type === "Loan Disbursement").reduce((a, t) => a + Number(t.amount), 0);
      if (["Active", "Cleared"].includes(l.status) && disb !== Number(l.loanAmount)) add("error", "LOAN_LEDGER_MISMATCH", l.id + " principal " + l.loanAmount + " vs disbursement entries " + disb);
      const over = L.loanOutstanding(l, db, asOf); if (over < 0) add("error", "OVERPAID", l.id + " balance " + over);
    });
    db.members.forEach((m) => { const s = L.memberSavings(db, m.id); if (s < 0) add("error", "NEGATIVE_SAVINGS", m.id + " " + s); });
    db.members.forEach((m) => { const c = L.memberCommitted(db, m.id); if (c > 0 && L.memberSavings(db, m.id) < c) add("error", "GUARANTEE_OVERCOMMIT", m.id + " has " + c + " committed to guarantees but savings of only " + L.memberSavings(db, m.id)); });
    (db.guarantees || []).forEach((g) => {
      const rel = (g.releases || []).filter((r) => !r.reversed).reduce((a, r) => a + Number(r.amount), 0);
      if (rel !== Number(g.releasedAmount || 0)) add("error", "GUARANTEE_RELEASE_MISMATCH", g.id + " releasedAmount " + (g.releasedAmount || 0) + " vs release records " + rel);
      if (Number(g.releasedAmount || 0) > Number(g.amount)) add("error", "GUARANTEE_OVER_RELEASED", g.id);
    });
    const audIds = new Set(); (db.auditLog || []).forEach((a) => { if (audIds.has(a.id)) add("error", "DUPLICATE_AUDIT_ID", a.id); audIds.add(a.id); });
    (db.guarantees || []).filter((g) => g.status === "Active").forEach((g) => { const l = db.loans.find((x) => x.id === g.loanId);
      if (!l || l.voided || ["Cleared", "Declined"].includes(l.status)) add("error", "STALE_GUARANTEE", g.id + " on " + g.loanId); });
    const open = (db.discrepancies || []).filter((d) => d.status === "Open").length; if (open) add("warning", "OPEN_DISCREPANCIES", open + " open reconciliation item(s)");
    return { ok: !out.some((x) => x.severity === "error"), errors: out.filter((x) => x.severity === "error").length, warnings: out.filter((x) => x.severity === "warning").length, findings: out };
  }
  /* Stable identity of a finding, used to match it to a reconciliation-register item. */
  const findingKey = (f) => { const m = String(f.detail).match(/(?:TXN|LOAN|SOB|GUA|AUD)-[A-Z0-9]+/); return f.code + ":" + (m ? m[0] : f.detail); };
  /* Errors that no register item (open or resolved) accounts for. */
  const unaccounted = (db, asOf) => { const keys = new Set((db.discrepancies || []).map((d) => d.subject)); return check(db, asOf).findings.filter((f) => f.severity === "error" && !keys.has(findingKey(f))); };
  return { check, findingKey, unaccounted };
});
