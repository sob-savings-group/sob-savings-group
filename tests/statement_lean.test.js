/* Statements keep only the key facts: no explanations, no previous-year lines in a current-year statement, no internal references for the member. Synthetic data only. */
const assert = require("assert"), S = require("../src/core/statements.js");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };
const db = () => { const d = { members: [{ id: "SOB-900", name: "Test Member", phone: "0700000000", status: "Active", regDate: "2023-11-20" }], transactions: [], loans: [], guarantees: [], yearCycles: [{ year: 2025, status: "Closed", openedDate: "2024-12-01", closedDate: "2025-12-21" }, { year: 2026, status: "Open", openedDate: "2025-12-21" }], auditLog: [], approvalRequests: [], discrepancies: [] };
  const tx = (id, date, type, amount, extra) => d.transactions.push(Object.assign({ id, date, memberId: "SOB-900", amount, type, purpose: type }, extra || {}));
  tx("T1", "2025-03-10", "Savings", 30000); tx("T2", "2025-12-21", "Share-Out", 5000); tx("T3", "2026-01-04", "Savings", 10000); tx("T4", "2026-02-02", "Withdraw", 4000); return d; };
const member = (extra) => { const a = S.memberAccount(db(), "SOB-900", extra || {}, { today: "2026-11-19", audience: "member" }); return a; };
const BANNED = [/Previous year closing/, /consolidated position/i, /Each year stands alone/, /not carried over/i, /officer-recorded/i, /Savings position =/, /NOT deducted/, /Interest is UGX/, /Nothing is overwritten/, /record of truth/, /checked against the ledger/, /Interest working/, /Working:/, /\(decision #/];
t("a current-year Member statement has none of the explanations or previous-year notes", () => { const a = member({ from: "2025-12-21", to: "2026-11-19" }), html = S.toPrintHTML(a); BANNED.forEach((r) => assert.ok(!r.test(html), String(r))); });
t("the year that closed on the day the period starts is not shown, and a single year gets no year table", () => { const html = S.toPrintHTML(member({ from: "2025-12-21", to: "2026-11-19" })); assert.ok(!/FY2025/.test(html)); assert.ok(!/By financial year/.test(html)); });
t("a longer period that really spans two years still shows both, without footnotes", () => { const html = S.toPrintHTML(member({})); assert.ok(/By financial year/.test(html) && /FY2025/.test(html) && /FY2026/.test(html)); assert.ok(!/Each year stands alone/.test(html)); });
t("an earlier loan already settled before the period is left out; one still owing is kept; references like 'decision #' never print", () => { const a = member({ from: "2025-12-21", to: "2026-11-19" });
  const e = (date, owed) => ({ kind: "H", ref: "", status: owed ? "Active" : "Settled", date, dateText: "x", disbursed: 100, interestCharged: 0, interestReceived: 0, principalRepaid: 0, writtenOff: 0, interestDue: 0, principalLeft: owed, totalOwed: owed, rows: [{ date: "2025-01-01", event: "Repayment (decision #19)", amount: 1, interest: 0, principal: 1, owedAfter: owed }], checks: { partsAddUp: true } });
  a.earlier = [e("2025-04-29", 0), e("2025-05-01", 50)]; const html = S.toPrintHTML(a); assert.strictEqual((html.match(/Earlier loan/g) || []).length, 1); assert.ok(!/decision #/.test(html)); });
t("the Administrative statement is short too: no interest working, no explanatory notes, no spreadsheet evidence", () => { const a = S.memberAccount(db(), "SOB-900", { from: "2025-12-21", to: "2026-11-19" }, { today: "2026-11-19", audience: "admin" });
  a.notes = [{ date: "2026-01-01", ref: "TXN-X", note: "Split into dated repayments | Approved by: Treasurer | evidence: SOB_SYSTEM_.xlsx MEMBERS rows 1, 2" }]; const html = S.toPrintHTML(a);
  BANNED.filter((r) => !/decision/.test(r)).forEach((r) => assert.ok(!r.test(html), String(r))); assert.ok(/ADMINISTRATIVE — INTERNAL/.test(html) && /Corrections and audit notes/.test(html) && /Approved by: Treasurer/.test(html) && !/SOB_SYSTEM_/.test(html)); });
t("if a total does not agree with the ledger the statement still says so", () => { const a = member({}); a.checks.all = false; assert.ok(/does not agree with the ledger/.test(S.toPrintHTML(a))); });

t("a loan whose interest was reduced shows one line saying by how much, on the Member and the Administrative statement; an unreduced loan shows none", () => {
  const G = require("../src/core/governance.js"), CMD = require("../src/core/commands.js"), TODAY = "2026-11-19", mk = (id, role, day, h) => G.makeCtx({ id, name: id, role }, { today: day, now: day + "T" + (h || "08") + ":00:00Z" });
  const d = db(); G.createEntry(d, mk("A", "Admin", "2026-11-01"), { date: "2025-12-01", memberId: "SOB-900", amount: 900000, type: "Savings" });
  CMD.run(d, mk("A", "Admin", "2026-11-01"), "recordExistingLoan", { memberId: "SOB-900", amount: 200000, date: "2026-01-11", assignedMonthlyInterest: 30000, remarks: "test" });
  const q = () => S.memberAccount(d, "SOB-900", { from: "2025-12-21", to: TODAY }, { today: TODAY, audience: "member" });
  assert.ok(!/Interest reduced by/.test(S.toPrintHTML(q())));
  const r = CMD.run(d, mk("A", "Admin", TODAY), "lockInterest", { loanId: d.loans[0].id, reason: "Committee reduced the interest period", date: "2026-06-19" }); if (r && r.requestId) CMD.run(d, mk("C", "Chairperson", TODAY, "09"), "approveRequest", { id: r.requestId });
  const a = q(), l = a.loans[0]; assert.ok(l.interestCut > 0 && l.interestFull === l.accruedInterest + l.interestCut);
  const txt = "Interest reduced by — " + l.monthsNow + " months charged instead of " + l.monthsBefore + " (" + l.accruedInterest.toLocaleString("en-US") + " instead of " + l.interestFull.toLocaleString("en-US") + ")"; const _old = "(charged " + l.accruedInterest.toLocaleString("en-US") + " instead of " + l.interestFull.toLocaleString("en-US") + ")";
  assert.ok(S.toPrintHTML(a).includes(txt)); const ad = S.memberAccount(d, "SOB-900", { from: "2025-12-21", to: TODAY }, { today: TODAY, audience: "admin" }); assert.ok(S.toPrintHTML(ad).includes(txt)); });
console.log(n + " lean-statement tests passed");
