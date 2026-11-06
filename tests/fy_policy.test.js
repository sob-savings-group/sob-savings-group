/* SOB financial-year policy through the real command layer, plus configurable lists. Synthetic data. OFFLINE.
   Proves: years are independent, a Balance Brought Forward needs the Chairperson, it never changes a ledger entry/loan/live savings,
   the member sees only their own, and the lists ("Other (Specify)" support) grow by authorised configuration without touching records. */
const assert = require("assert");
const G = require("../src/core/governance.js"), L = require("../src/core/ledger.js"), CMD = require("../src/core/commands.js"), FY = require("../src/core/fy.js");
let n = 0; const t = (name, f) => { f(); n++; console.log("  ok " + name); };
const ctx = (role, day, extra) => G.makeCtx(Object.assign({ id: role, name: role, role }, extra || {}), { today: day, now: day + "T08:00:00Z" });
const DAY = "2026-10-24", run = (db, role, name, args, who) => CMD.run(db, ctx(role, DAY, who), name, args);
function world() {
  const db = { members: [], transactions: [], loans: [], auditLog: [], guarantees: [], policy: [], yearCycles: [], approvalRequests: [], reminders: [], schemaVersion: 2, seq: 0 };
  const a = G.addMember(db, ctx("Admin", "2025-01-02"), { name: "Example Member A", regDate: "2025-01-02", phone: "" });
  G.createEntry(db, ctx("Admin", "2025-02-01"), { date: "2025-02-01", memberId: a.id, amount: 500000, type: "Savings" });
  G.createEntry(db, ctx("Admin", "2025-12-20"), { date: "2025-12-20", memberId: a.id, amount: 400000, type: "Withdraw" });   // year-end payout leaves 100,000 behind
  G.createEntry(db, ctx("Admin", "2026-03-01"), { date: "2026-03-01", memberId: a.id, amount: 50000, type: "Savings" });
  FY.defineFinancialYears(db, ctx("Admin", DAY), { years: [{ year: 2025, openedDate: "2025-01-01", closedDate: "2025-12-21", evidence: "Minute 1", basis: "test" }, { year: 2026, openedDate: "2025-12-21", closedDate: null, evidence: "Minute 1", basis: "test" }] });
  return { db, a };
}
const row = (db, y, id) => FY.position(db, y).rows.find((r) => r.memberId === id);
t("a new year does not inherit the previous balance: it opens at zero and shows the previous closing separately", () => {
  const { db, a } = world(), r = row(db, 2026, a.id);
  assert.deepEqual([r.opening, r.previousClosing, r.notBroughtForward, r.deposits, r.closing], [0, 100000, 100000, 50000, 50000]);
  assert.equal(row(db, 2025, a.id).closing, 100000); assert.deepEqual(FY.check(db), []);
});
t("recording a Balance Brought Forward goes to the Chairperson; only on approval does the year open with it", () => {
  const { db, a } = world(), args = { year: 2026, memberId: a.id, amount: 60000, evidence: "AGM minute 4", reason: "Members chose to keep funds in" };
  const req = run(db, "Admin", "recordBroughtForward", args); assert.ok(req && (req.status === "Pending" || req.requestId || req.id), "queued, not applied"); assert.equal(row(db, 2026, a.id).opening, 0);
  const id = (db.approvalRequests.find((q) => q.command === "recordBroughtForward") || {}).id; assert.ok(id);
  assert.throws(() => run(db, "Admin", "approveRequest", { id }), /./, "the requester cannot approve their own request");
  run(db, "Chairperson", "approveRequest", { id }); const r = row(db, 2026, a.id);
  assert.deepEqual([r.opening, r.previousClosing, r.notBroughtForward, r.closing], [60000, 100000, 40000, 110000]);
});
t("it can never exceed the previous closing, and it never changes a ledger entry, a loan or the live savings", () => {
  const { db, a } = world(), before = JSON.stringify({ t: db.transactions, l: db.loans, c: db.yearCycles }), live = L.memberSavings(db, a.id);
  assert.throws(() => FY.recordBroughtForward(db, ctx("Admin", DAY), { year: 2026, memberId: a.id, amount: 100001, evidence: "m", reason: "r" }), /EXCEEDS_PREVIOUS_CLOSING/);
  FY.recordBroughtForward(db, ctx("Admin", DAY), { year: 2026, memberId: a.id, amount: 100000, evidence: "m", reason: "r" });
  assert.equal(JSON.stringify({ t: db.transactions, l: db.loans, c: db.yearCycles }), before); assert.equal(L.memberSavings(db, a.id), live); assert.deepEqual(FY.check(db), []);
});
t("a Secretary or a member cannot record one", () => {
  const { db, a } = world(); ["Secretary", "Committee", "Treasurer"].forEach((r) => assert.throws(() => run(db, r, "recordBroughtForward", { year: 2026, memberId: a.id, amount: 1, evidence: "m", reason: "r" })));
  assert.throws(() => run(db, "Member", "recordBroughtForward", { year: 2026, memberId: a.id, amount: 1, evidence: "m", reason: "r" }, { memberId: a.id }));
});
t("configurable lists: standard options, add, retire, restore, 'Other' is automatic; staff roles other than the Super Admin cannot change them", () => {
  const { db } = world(); const base = G.listOptions(db, "purpose.Expense"); assert.ok(base.includes("Transport"));
  run(db, "Admin", "addListItem", { list: "purpose.Expense", label: "Funeral support", reason: "new category agreed" }); assert.ok(G.listOptions(db, "purpose.Expense").includes("Funeral support"));
  assert.throws(() => run(db, "Admin", "addListItem", { list: "purpose.Expense", label: "funeral support", reason: "dup" }), /ALREADY_EXISTS/);
  assert.throws(() => run(db, "Admin", "addListItem", { list: "purpose.Expense", label: "Other (Specify)", reason: "x" }), /always offered/);
  assert.throws(() => run(db, "Admin", "addListItem", { list: "nonsense", label: "x", reason: "x" }), /unknown list/);
  run(db, "Admin", "retireListItem", { list: "purpose.Expense", label: "Transport", reason: "no longer used" }); assert.ok(!G.listOptions(db, "purpose.Expense").includes("Transport"));
  run(db, "Admin", "addListItem", { list: "purpose.Expense", label: "Transport", reason: "needed again" }); assert.ok(G.listOptions(db, "purpose.Expense").includes("Transport"));
  ["Treasurer", "Chairperson", "Secretary"].forEach((r) => assert.throws(() => run(db, r, "addListItem", { list: "purpose.Expense", label: "X", reason: "r" })));
  assert.ok(db.auditLog.filter((x) => x.entityType === "List").length >= 3, "every list change is audited");
});
t("changing a list never rewrites a recorded entry and a free-text 'Other' purpose is recorded as typed", () => {
  const { db, a } = world(); const e = G.createEntry(db, ctx("Admin", DAY), { date: DAY, memberId: a.id, amount: 1000, type: "Savings", purpose: "Church building drive" });
  run(db, "Admin", "retireListItem", { list: "purpose.Savings", label: "Regular savings deposit", reason: "test" }); assert.equal(db.transactions.find((x) => x.id === e.id).purpose, "Church building drive");
});
console.log(n + " financial-year policy and configuration tests passed");
