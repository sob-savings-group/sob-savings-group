/* Deterministic SYNTHETIC data set shaped like the real legacy export (same fields, same kinds of oddities) but with invented names and
   amounts. The repository is public, so tests, the demo and fixtures use ONLY this. Real data can be used locally via SEED=<file>. */
const dates = require("../../src/core/dates.js");
let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pad = (n) => String(n).padStart(3, "0");
function build() {
  s = 12345; const members = [], tx = [], loans = []; let n = 0; const id = () => "TXN-" + (++n).toString(36).toUpperCase().padStart(6, "0");
  for (let i = 1; i <= 55; i++) members.push({ id: "SOB-" + pad(i), name: "Demo Member " + pad(i), phone: "", email: "", location: "", regDate: "2024-0" + (1 + (i % 9)) + "-15" });
  const nameOf = (m) => "Demo Member " + m.slice(4);
  const add = (date, memberId, amount, type, extra) => { const t = Object.assign({ id: id(), date, memberId, memberName: nameOf(memberId), amount, purpose: type === "Profit" ? "Profit distribution" : type, type }, extra || {}); tx.push(t); return t; };
  const day = (k) => dates.addDays("2025-12-21", k);
  // ~300 savings/withdraw/profit rows between 21 Dec 2025 and 26 Jul 2026
  for (let i = 1; i <= 55; i++) { const m = "SOB-" + pad(i); const k = 2 + Math.floor(rnd() * 5);
    for (let j = 0; j < k; j++) add(day(Math.floor(rnd() * 215)), m, (1 + Math.floor(rnd() * 20)) * 5000, "Savings");
    if (rnd() < 0.15) add(day(150 + Math.floor(rnd() * 60)), m, 5000, "Withdraw"); if (rnd() < 0.4) add(day(60 + Math.floor(rnd() * 90)), m, 1000 + Math.floor(rnd() * 5000), "Profit"); }
  tx.sort((a, b) => (a.date < b.date ? -1 : 1));
  const L = (memberId, amount, rate, wbDisb, over) => { const loan = Object.assign({ id: "LOAN-S" + pad(loans.length + 1), date: "2025-12-21", memberId, memberName: nameOf(memberId), loanAmount: amount, monthlyStandardInterest: rate, graceMonths: 3, dueDate: "2026-03-21", status: "Active", datePaidFull: "", remarks: "Approved standard interest applied", _wb: wbDisb }, over || {}); loans.push(loan); add("2025-12-21", memberId, amount, "Loan Disbursement", { loanId: loan.id }); return loan; };
  const l5 = L("SOB-005", 1200000, 40000, [["2026-01-05", 1200000]]), l2 = L("SOB-002", 300000, 20000, [["2026-01-09", 300000]]), l22 = L("SOB-022", 150000, 15000, [["2026-01-14", 150000]]),
    l32 = L("SOB-032", 250000, 25000, [["2026-02-03", 250000]]), l15 = L("SOB-015", 120000, 12000, [["2026-02-10", 120000]]), l35 = L("SOB-035", 900000, 30000, [["2026-02-16", 900000]]),
    l40 = L("SOB-040", 80000, 8000, [["2026-03-02", 80000]]), l25 = L("SOB-025", 180000, 18000, [["2026-03-11", 180000]]), l4 = L("SOB-004", 500000, 25000, [["2026-03-20", 300000], ["2026-05-02", 200000]]),
    l11 = L("SOB-011", 1100000, 45000, [["2026-03-27", 100000], ["2026-04-05", 1000000]]);
  const wbRepay = {};  // loan-id -> workbook repayment rows
  add("2026-01-01", "SOB-022", 60000, "Loan Repayment", { loanId: l22.id }); wbRepay[l22.id] = [["2026-05-20", 60000]];
  add("2026-01-01", "SOB-035", 700000, "Loan Repayment", { loanId: l35.id }); wbRepay[l35.id] = [["2026-04-21", 200000], ["2026-05-16", 300000], ["2026-07-05", 150000], ["2026-07-12", 50000]];
  // anomalies mirrored from real life: a withdrawal larger than savings, and a zero-amount entry
  const sav35 = tx.filter((t) => t.memberId === "SOB-035" && ["Savings", "Profit"].includes(t.type)).reduce((a, t) => a + t.amount, 0) - tx.filter((t) => t.memberId === "SOB-035" && t.type === "Withdraw").reduce((a, t) => a + t.amount, 0);
  add("2026-02-16", "SOB-035", Math.max(sav35, 0) + 20000, "Withdraw");
  add("2026-03-23", "SOB-004", 0, "Withdraw", { id: "TXN-ZERO01" });
  tx.sort((a, b) => (a.date < b.date ? -1 : 1));
  const legacy = { members, transactions: tx, loans: loans.map((l) => { const c = Object.assign({}, l); delete c._wb; return c; }), requests: [], airtimeRequests: [], ledger: [{ date: "2025-12-21", amount: 100000, bankedBy: "Demo", receivedBy: "", receiptNumber: "", type: "Deposit", purpose: "Deposit", memberId: "", loanAmount: "", profitEarned: 0, runningBalance: 100000 }], auditLog: [], reconciliations: [], smsFailures: [], seq: 0 };
  // "workbook" view of the same ledger: identical except loan rows carry their real dated entries
  let row = 1; const rows = [];
  tx.filter((t) => !["Loan Disbursement", "Loan Repayment"].includes(t.type)).forEach((t) => rows.push({ date: t.date, memberId: t.memberId, amount: t.amount, type: t.type }));
  loans.forEach((l) => { l._wb.forEach(([d, a]) => rows.push({ date: d, memberId: l.memberId, amount: a, type: "Loan Disbursement" })); (wbRepay[l.id] || []).forEach(([d, a]) => rows.push({ date: d, memberId: l.memberId, amount: a, type: "Loan Repayment" })); });
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.memberId < b.memberId ? -1 : 1)); rows.forEach((r) => (r.row = ++row));
  const admin = [{ row: 2, date: "2026-01-09", memberId: "SOB-002", amount: 300000, purpose: "Loan", bankedBy: "Demo" }, { row: 3, date: "2026-01-05", memberId: "SOB-005", amount: 400000, purpose: "Loan", bankedBy: "Demo" }];
  const system = { file: "SYNTH_SYSTEM.xlsx", banner: "Savings: 1 | Net Loans: 1", rows, admin };
  const cut = "2026-07-14", database = { file: "SYNTH_DATABASE.xlsx", banner: "Savings: 2 | Net Loans: 2", rows: rows.filter((r) => r.date <= cut) };
  // make sure the newer workbook really has later rows (like the real pair)
  ["2026-07-15", "2026-07-19", "2026-07-26"].forEach((d, i) => { const m = "SOB-0" + (10 + i); const a = (i + 1) * 10000; tx.push({ id: id(), date: d, memberId: m, memberName: nameOf(m), amount: a, purpose: "Savings", type: "Savings" }); system.rows.push({ row: ++row, date: d, memberId: m, amount: a, type: "Savings" }); });
  tx.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { legacy, system, database };
}
const fs = require("fs"), os = require("os"), path = require("path");
let cached; const get = () => cached || (cached = build());
module.exports = { build: get,
  legacyRaw: () => (process.env.SEED ? JSON.parse(fs.readFileSync(process.env.SEED, "utf8")) : JSON.parse(JSON.stringify(get().legacy))),
  usingRealData: () => !!process.env.SEED,
  writeTmp: () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sob-synth-")), d = get(); fs.writeFileSync(path.join(dir, "legacy.json"), JSON.stringify(d.legacy)); fs.writeFileSync(path.join(dir, "system.json"), JSON.stringify(d.system)); fs.writeFileSync(path.join(dir, "database.json"), JSON.stringify(d.database)); return dir; } };
