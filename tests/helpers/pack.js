/* Synthetic (public, invented) records pack in the same shape as the private real one. Names differ from the demo seed so demo-vs-real detection is testable. */
const synth = require("./synth.js"), I = require("../../src/core/integrity.js"), M = require("../../src/core/migrate.js");
function makePack() {
  const legacy = JSON.parse(JSON.stringify(synth.build().legacy).replace(/Demo Member/g, "Test Person"));
  const loan = legacy.loans[0], rep = legacy.transactions.find((t) => t.type === "Loan Repayment");
  const m1 = legacy.members[0].id, m2 = legacy.members[1].id;
  const entries = [
    { memberId: m1, date: "2023-05-19", amount: 50000, sourceRef: "T|a|r2", originalName: "A", type: "Savings", purpose: "Savings (historical)" },
    { memberId: m1, date: "2023-06-19", amount: 20000, sourceRef: "T|a|r3", originalName: "A", type: "Savings", purpose: "Savings (historical)" },
    { memberId: m2, date: "2023-07-01", amount: 10000, sourceRef: "T|b|r2", originalName: "B", type: "Savings", purpose: "Savings (historical)" },
    { memberId: m2, date: "2023-12-21", amount: 5000, sourceRef: "T|b|r3", originalName: "B", type: "Withdraw", purpose: "Withdrawal (historical)" },
    { memberId: "SOB-900", date: "2023-08-01", amount: 30000, sourceRef: "T|c|r2", originalName: "C", type: "Savings", purpose: "Savings (historical)" }
  ];
  const by = {}; entries.forEach((e) => { const b = (by[e.type] = by[e.type] || { count: 0, sum: 0 }); b.count++; b.sum += e.amount; });
  const held = { kind: "MISSING_ENTRY", subject: SUBJ(m1), summary: "Workbook row not imported (test)", platformValue: null, sourceValue: -1000, source: "T|a|r9" };
  function SUBJ(m) { return m + " | T|a|r9"; }
  const known = I.check(M.migrateLegacy(legacy, "2026-03-31"), "2026-10-08").findings.filter((f) => f.severity === "error").map((f) => ({ kind: "OTHER", subject: I.findingKey(f), summary: f.code + ": " + f.detail, platformValue: null, sourceValue: null, source: "synthetic test" }));
  return {
    kind: "SOB_RECORDS_PACK", version: 1, legacyAsOf: "2026-03-31", legacy,
    history: { batchId: "TEST-HIST", source: "synthetic test workbook", members: [{ id: "SOB-900", name: "Test Newcomer" }], entries, annotations: [{ sourceRef: "T|a|r10", memberId: m1, date: "", amount: 777, note: "undated amount (test)" }] },
    discrepancies: [held].concat(known), resolutions: [],
    plan: { steps: [{ name: "correctLoanDate", args: { loanId: loan.id, date: "2025-12-20", reason: "test correction", evidence: "test source" } }, { name: "voidEntry", args: { id: rep.id, reason: "test consolidated" } },
      { name: "createEntry", args: { date: "2026-01-02", memberId: rep.memberId, amount: rep.amount, type: "Loan Repayment", loanId: rep.loanId, purpose: "Loan Repayment (test split)" } }] },
    controls: { members: legacy.members.length + 1, legacyTransactions: legacy.transactions.length, historyEntries: entries.length, historyByType: by, heldExceptions: 1, annotations: 1 },
    missing: ["test: identity of a sheet"], decisions: ["test decision"]
  };
}
module.exports = { makePack };
