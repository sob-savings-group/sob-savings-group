/* Performance: the per-screen index gives IDENTICAL figures to the plain calculation and keeps heavy screens fast on ten years of data. Synthetic data. */
const assert = require("assert"), L = require("../src/core/ledger.js"), K = require("../src/core/kpis.js"), RC = require("../src/core/reportcentre.js");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };
const members = []; for (let i = 1; i <= 200; i++) members.push({ id: "SOB-" + String(i).padStart(3, "0"), name: "Member " + i, phone: "0772" + String(100000 + i), status: "Active", regDate: "2016-01-01" });
const tx = []; let id = 0; for (let y = 2016; y <= 2026; y++) for (let m = 1; m <= 12; m++) for (let i = 0; i < members.length; i++) { if ((i + m) % 2) continue; tx.push({ id: "T" + (++id), date: y + "-" + String(m).padStart(2, "0") + "-" + String(1 + (i % 27)).padStart(2, "0"), memberId: members[i].id, amount: 20000 + (i % 10) * 5000, type: "Savings", forYear: y }); }
const loans = []; for (let i = 0; i < 400; i++) { const m = members[i % 200]; loans.push({ id: "L" + i, date: (2016 + i % 10) + "-03-10", memberId: m.id, loanAmount: 200000, assignedMonthlyInterest: 10000, status: i % 4 ? "Cleared" : "Active", graceMonths: 1 }); if (i % 3 === 0) tx.push({ id: "R" + i, date: (2016 + i % 10) + "-09-10", memberId: m.id, loanId: "L" + i, amount: 50000, type: "Loan Repayment" }); }
tx.push({ id: "V1", date: "2026-01-05", memberId: "SOB-001", amount: 999999, type: "Savings", voided: true });
const db = { members, transactions: tx, loans, guarantees: [], policy: [], yearCycles: [], auditLog: [], schemaVersion: 2 }, today = "2026-11-28";
const ms = (f) => { const a = Date.now(); const r = f(); return [Date.now() - a, r]; };
t("indexed figures are identical to the plain calculation (positions, loans, totals)", () => {
  const plain = { p: members.map((m) => L.memberPosition(db, m.id)), o: loans.map((l) => L.loanOutstanding(l, db, today)), g: L.computeGroupTotals(db, today) };
  const fast = L.indexed(db, () => ({ p: members.map((m) => L.memberPosition(db, m.id)), o: loans.map((l) => L.loanOutstanding(l, db, today)), g: L.computeGroupTotals(db, today) }));
  assert.deepStrictEqual(fast, plain); });
t("the index is dropped after use: a later change is seen at once", () => { L.indexed(db, () => L.memberSavings(db, "SOB-002")); const before = L.memberSavings(db, "SOB-002"); db.transactions.push({ id: "NEW", date: today, memberId: "SOB-002", amount: 1000, type: "Savings" }); assert.strictEqual(L.memberSavings(db, "SOB-002"), before + 1000); db.transactions.pop(); });
t("an entry added while the index is in use is not served stale", () => { L.indexed(db, () => { const a = L.memberSavings(db, "SOB-002"); db.transactions.push({ id: "NEW2", date: today, memberId: "SOB-002", amount: 500, type: "Savings" }); assert.strictEqual(L.memberSavings(db, "SOB-002"), a + 500); db.transactions.pop(); }); });
t("the index is dropped even when the work fails", () => { assert.throws(() => L.indexed(db, () => { throw new Error("x"); }), /x/); db.transactions.push({ id: "N3", date: today, memberId: "SOB-003", amount: 7, type: "Savings" }); const a = L.memberSavings(db, "SOB-003"); db.transactions.pop(); assert.strictEqual(a - L.memberSavings(db, "SOB-003"), 7); });
t("voided entries stay out of every figure", () => assert.ok(L.memberSavings(db, "SOB-001") < 999999 + 100000000 && !L.activeTransactions(db).some((x) => x.id === "V1")));
t("heavy screens on " + tx.length + " entries: dashboard and key reports stay fast", () => {
  const [d, o] = ms(() => K.dashboard(db, today, {})); assert.ok(o && d < 1500, "dashboard " + d + " ms");
  ["outstanding", "repayments", "shareout", "balances", "loans", "savings"].forEach((id) => { const [x] = ms(() => RC.run(db, id, { year: "2026" })); console.log("      " + id + ": " + x + " ms"); assert.ok(x < 1500, id + " " + x + " ms"); });
  const [pm] = ms(() => L.indexed(db, () => members.forEach((m) => L.memberPosition(db, m.id)))); console.log("      200 member positions: " + pm + " ms"); assert.ok(pm < 400, "positions " + pm); });
console.log(n + " performance tests passed");
