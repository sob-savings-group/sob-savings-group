/* The member account statement and the year-end reconciliation: every figure ties out to the ledger, for every member and every kind of period.
   Hand-built cases prove the interest working (calendar months less grace), the placeholder-date label and the interest-first allocation;
   a full synthetic load proves the tie-outs for every member. No real data is used here. */
const assert = require("assert"), { execSync } = require("child_process"), path = require("path");
execSync("node " + path.join(__dirname, "../build/build-gs.js"));
const S = require("../src/core/statements.js"), L = require("../src/core/ledger.js"), g = require("./helpers/gas.js"), { makePack } = require("./helpers/pack.js"), LD = require("../src/core/loader.js");
let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log("  ok  " + name); } catch (e) { console.log("FAIL  " + name + "\n      " + (e.stack || e)); process.exitCode = 1; } };
const mk = () => ({ members: [{ id: "SOB-900", name: "Test Member", phone: "0700000000", status: "Active", regDate: "2023-11-20" }], transactions: [], loans: [], guarantees: [], yearCycles: [], auditLog: [], approvalRequests: [], discrepancies: [] });
const tx = (db, id, date, type, amount, extra) => db.transactions.push(Object.assign({ id, date, memberId: "SOB-900", amount, type, purpose: type }, extra || {}));
(async () => {
  await t("savings summary: opening + movements = closing, with each kind of movement separate", () => {
    const db = mk(); tx(db, "T1", "2025-01-10", "Savings", 100000); tx(db, "T2", "2025-02-10", "Profit", 5000); tx(db, "T3", "2025-03-10", "Withdraw", 20000); tx(db, "T4", "2025-12-21", "Share-Out", 50000); tx(db, "T5", "2026-01-05", "Savings", 10000);
    const a = S.memberAccount(db, "SOB-900", {}, { today: "2026-10-10" }), s = a.savings;
    assert.deepEqual([s.opening, s.deposits, s.profit, s.withdrawals, s.shareOuts, s.closing], [0, 110000, 5000, 20000, 50000, 45000]); assert.ok(a.checks.all);
    const p = S.memberAccount(db, "SOB-900", { from: "2025-03-01", to: "2025-12-31" }, { today: "2026-10-10" }).savings; assert.equal(p.opening, 105000); assert.equal(p.closing, 35000); assert.ok(p.checks.movementsAddUp);
    const past = S.memberAccount(db, "SOB-900", { to: "2025-02-28" }, { today: "2026-10-10" }); assert.equal(past.savings.closing, 105000); assert.equal(past.transactions.length, 2);
  });
  await t("a loan: the working is calendar months less grace, and the parts add up to what is owed", () => {
    const db = mk(); tx(db, "TXN-L1", "2025-12-21", "Loan Disbursement", 2000000, { loanId: "LOAN-X" });
    db.loans.push({ id: "LOAN-X", date: "2025-12-21", memberId: "SOB-900", loanAmount: 2000000, assignedMonthlyInterest: 60000, graceMonths: 3, status: "Active", dueDate: "2026-03-21", interestHistory: [], dateUnknown: true, placeholderDate: "2025-12-21" });
    const l = S.memberAccount(db, "SOB-900", {}, { today: "2026-10-10" }).loans[0];
    assert.equal(l.totalOwed, 2420000); assert.equal(l.accruedInterest, 420000); assert.equal(l.chargeableMonths, 7); assert.equal(l.elapsedMonths, 10); assert.ok(/10; less 3 grace months = 7 interest-bearing months; 7 × UGX 60,000 = UGX 420,000/.test(l.working));
    assert.ok(/Not established \(shown at 21\/12\/2025/.test(l.dateText)); assert.equal(l.disbursementDate, "2025-12-21"); assert.equal(l.disbursementRef, "TXN-L1"); assert.ok(l.checks.partsAddUp && l.checks.interestMatchesRule);
    const html = S.toPrintHTML(S.memberAccount(db, "SOB-900", {}, { today: "2026-10-10" })); assert.ok(/UGX 2,420,000/.test(html) && /UGX 2,000,000/.test(html) && /21\/12\/2025/.test(html));
  });
  await t("repayments clear interest first, then the loan, each shown with its reference", () => {
    const db = mk(); tx(db, "TXN-L1", "2025-12-21", "Loan Disbursement", 1000000, { loanId: "LOAN-X" });
    db.loans.push({ id: "LOAN-X", date: "2025-12-21", memberId: "SOB-900", loanAmount: 1000000, assignedMonthlyInterest: 30000, graceMonths: 3, status: "Active", interestHistory: [] });
    tx(db, "TXN-R1", "2026-08-01", "Loan Repayment", 100000, { loanId: "LOAN-X" });   // 8 months - 3 grace = 5 x 30,000 = 150,000 interest due: all of it goes to interest
    tx(db, "TXN-R2", "2026-09-01", "Loan Repayment", 100000, { loanId: "LOAN-X" });   // 9-3 = 6 months = 180,000 -> 30,000 still due on top of the 100,000 paid -> 80,000 more... interest first
    const l = S.memberAccount(db, "SOB-900", {}, { today: "2026-10-10" }).loans[0];
    assert.equal(l.repayments.length, 2); assert.equal(l.repayments[0].ref, "TXN-R1"); assert.equal(l.repayments[0].interest, 100000); assert.equal(l.repayments[0].principal, 0);
    assert.equal(l.repayments[1].interest, 80000); assert.equal(l.repayments[1].principal, 20000); assert.equal(l.principalLeft, 980000);
    assert.equal(l.totalOwed, l.principalLeft + l.interestDue); assert.ok(l.checks.partsAddUp);
  });
  await t("corrections and the year-end note appear; the General Reserve is kept separate from carried-forward savings", () => {
    const db = mk(); tx(db, "T1", "2025-06-01", "Savings", 161581); tx(db, "T2", "2025-12-21", "Share-Out", 161000, { correctionNote: "Recorded first as a withdrawal", originalType: "Withdraw" });
    db.yearCycles = [{ year: 2025, status: "Closed", openedDate: "2024-12-01", closedDate: "2025-12-21" }, { year: 2026, status: "Open", openedDate: "2025-12-21", closedDate: null }];
    const a = S.memberAccount(db, "SOB-900", {}, { today: "2026-10-10" });
    assert.ok(a.notes.some((x) => /Recorded first as a withdrawal/.test(x.note) && /originally recorded as Withdraw/.test(x.note))); assert.ok(/FY2025 closing UGX 581 is the member's own savings/.test(a.reserve.text) && /not part of the General Reserve Fund/.test(a.reserve.text));
    assert.equal(a.years[0].closing, 581); assert.ok(a.years.every((y) => y.rowAddsUp));
  });
  await t("a single-loan statement shows only that loan, its references and its working", () => {
    const db = mk(); tx(db, "T1", "2025-06-01", "Savings", 50000); tx(db, "TXN-L1", "2025-12-21", "Loan Disbursement", 500000, { loanId: "LOAN-A" }); tx(db, "TXN-L2", "2026-02-01", "Loan Disbursement", 300000, { loanId: "LOAN-B" });
    db.loans.push({ id: "LOAN-A", date: "2025-12-21", memberId: "SOB-900", loanAmount: 500000, assignedMonthlyInterest: 10000, graceMonths: 3, status: "Active", interestHistory: [] }, { id: "LOAN-B", date: "2026-02-01", memberId: "SOB-900", loanAmount: 300000, assignedMonthlyInterest: 5000, graceMonths: 3, status: "Active", interestHistory: [] });
    const a = S.memberAccount(db, "SOB-900", {}, { today: "2026-10-10", loanId: "LOAN-B" }); assert.equal(a.loans.length, 1); assert.equal(a.loans[0].ref, "LOAN-B"); assert.equal(a.mode, "loan");
    const h = S.toPrintHTML(a); assert.ok(/Loan statement LOAN-B/.test(h) && !/Savings summary/.test(h) && !/LOAN-A/.test(h) && /TXN-L2/.test(h));
  });
  await t("full synthetic load: every member's statement ties out for lifetime, financial-year and as-at periods, and the PDF renders", async () => {
    const s = g.start(); s.setupAdmin(); const api = s.session((await s.call({ action: "login", id: "ADMIN", pin: "Adm1n-Setup-77" })).token);
    const r = await LD.load(api, makePack(), { approvedBy: "Test Approver, Admin, 8 Oct 2026", asOf: "2026-10-08" }); assert.ok(r.ok);
    const db = (await api({ action: "getLedger" })).db; assert.ok(db.members.length > 5);
    let checked = 0; db.members.forEach((m) => { [{}, { from: "2024-12-01", to: "2025-12-21" }, { from: "2025-12-21" }, { to: "2025-06-30" }].forEach((per) => { const a = S.memberAccount(db, m.id, per, { internal: true, today: "2026-10-09" }); assert.ok(a.checks.all, m.id + " " + JSON.stringify(per) + " " + JSON.stringify(a.checks)); const h = S.toPrintHTML(a); assert.ok(h.includes(m.id) && h.includes("Member account statement") && /CONFIDENTIAL/.test(h)); checked++; }); });
    assert.ok(checked >= db.members.length * 4);
    (db.yearCycles || []).forEach((c) => { const rep = S.yearEnd(db, c.year); assert.equal(rep.rows.length, 6); assert.ok(/separate/.test(rep.summary[0][0])); });
  });
  console.log(n + " statement tests passed");
})();
