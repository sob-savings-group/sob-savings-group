/* SOB core/migrate — legacy (SOB_FINAL_DATA_V2 / live Sheet) -> Lifetime Platform schema. Non-destructive: the input is never mutated,
   legacy bank-ledger rows are archived untouched, and a verification report proves every figure survived. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./cycle.js") : root.SOB.cycle);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.migrate = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, C) {
  const SCHEMA_VERSION = 2;
  function migrateLegacy(raw, asOf) {
    const src = JSON.parse(JSON.stringify(raw));
    asOf = asOf || dates.todayISO();
    const db = {
      schemaVersion: SCHEMA_VERSION,
      members: src.members.map((m) => Object.assign({ status: "Active" }, m)),
      transactions: src.transactions,
      loans: src.loans.map((l) => {
        const n = Object.assign({}, l, { legacy: true });
        if (n.monthlyStandardInterest !== undefined) { n.assignedMonthlyInterest = Number(n.monthlyStandardInterest); delete n.monthlyStandardInterest; }
        if (!n.status || n.status === "Active" || /paid/i.test(n.status) === false) n.status = /paid/i.test(l.status || "") ? "Cleared" : "Active";
        n.interestHistory = n.interestHistory || [];
        return n;
      }),
      guarantees: [], securities: [], policy: [], yearCycles: [], shareOutEvents: [], profitDistributions: [],
      users: src.users || [], requests: src.requests || [], airtimeRequests: src.airtimeRequests || [],
      auditLog: (src.auditLog || []).slice(), reconciliations: src.reconciliations || [], smsFailures: src.smsFailures || [],
      legacyAdministration: src.ledger || [], // archived bank-level rows; they do NOT feed any total
      seq: src.seq || 0
    };
    const first = db.transactions.map((t) => t.date).filter(dates.isISO).sort()[0];
    C.ensureCycle(db, dates.yearOf(asOf), first || dates.yearOf(asOf) + "-01-01");
    db.auditLog.push({ id: "AUD-MIGRATION", timestamp: new Date().toISOString(), date: asOf, entityType: "System", entityId: "migration", action: "Migrated to schema v" + SCHEMA_VERSION,
      previousValue: null, newValue: { members: db.members.length, transactions: db.transactions.length, loans: db.loans.length }, by: "migration", role: "system", reason: "Lifetime Platform migration" });
    return db;
  }
  /* Proves the migration changed no figure: compares against the legacy computation done independently. */
  function verifyMigration(raw, db, asOf) {
    const checks = [];
    const ok = (name, a, b) => checks.push({ name, legacy: a, migrated: b, pass: JSON.stringify(a) === JSON.stringify(b) });
    ok("member count", raw.members.length, db.members.length);
    ok("transaction count", raw.transactions.length, db.transactions.length);
    ok("loan count", raw.loans.length, db.loans.length);
    let s = 0; raw.transactions.filter((t) => !t.voided).forEach((t) => (s += L.classifyTransaction(t).savings));
    ok("group savings", s, L.computeGroupTotals(db, asOf).groupSavings);
    raw.loans.forEach((o, i) => {
      const months = Math.max(0, dates.monthsBetween(o.date, asOf) - (o.graceMonths || 0));
      const paid = raw.transactions.filter((t) => !t.voided && t.loanId === o.id && t.type === "Loan Repayment").reduce((a, t) => a + t.amount, 0);
      ok("loan balance " + o.memberId, o.loanAmount + months * o.monthlyStandardInterest - paid, L.loanOutstanding(db.loans[i], db, asOf));
    });
    ok("no legacy interest field remains", true, db.loans.every((l) => l.monthlyStandardInterest === undefined));
    return { pass: checks.every((c) => c.pass), checks };
  }
  return { SCHEMA_VERSION, migrateLegacy, verifyMigration };
});
