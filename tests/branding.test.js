const assert = require("assert"), fs = require("fs"), path = require("path");
const R = require("../src/core/reports.js"), M = require("../src/core/migrate.js");
const db = M.migrateLegacy(require("./helpers/synth.js").legacyRaw(), "2026-03-31");
let n = 0; const t = (name, f) => { f(); n++; console.log("ok", name); };
const must = ["Sons of Bethel (SOB) Savings Group", "BWOMI logo", "data:image/jpeg;base64,", "Elder Pastor Kironde John", "Chairperson — 0706 496 404", "Min. Kagimu Francis", "Treasurer — 0755 924 822", "Min. Nabawanuka Amina", "Secretary — 0703 154 463", "Ssebadduka Joshua", "Coordinator — 0774 020 205", "Bishop Daniel Kuteesa Waddimba", "Patron — +256 772 834 290", "display:table-header-group", "display:table-footer-group"];
const check = (html, title) => { must.forEach((m) => assert.ok(html.includes(m) || (m.startsWith("display") && html.includes(m.replace("display:", "") ) ), title + " missing: " + m)); assert.ok(html.includes(title.replace(/&/g, "&amp;")), "title " + title); };
t("every report builder prints with the mandatory header and footer", () => {
  const m = db.members[0].id, loan = (db.loans[0] || {}).id;
  const reps = [R.memberStatement(db, m), R.savings(db), R.loans(db, "2026-03-31"), R.repayments(db, null), R.guarantors(db), R.subscriptions(db), R.incomeExpenses(db, null), R.shareOut(db), R.quarterlyDistribution(db, {}), R.repaymentAllocation(db), R.annualSummary(db), R.interestReceivable(db, "2026-03-31"), R.approvals(db), R.securities(db), R.airtime(db), R.notificationLog(db), R.reconciliationRegister(db), R.guaranteeStatement ? R.guaranteeStatement(db, m) : null, loan ? R.loanStatement(db, loan, "2026-03-31") : null].filter(Boolean);
  assert.ok(reps.length >= 15);
  reps.forEach((r) => { const html = R.toPrintHTML(r, { generated: "01/04/2026", period: "Q1 2026" }); check(html, r.title); assert.ok(html.includes("Reporting period: Q1 2026")); });
});
t("blocked reports are branded too; no unbranded path exists", () => {
  check(R.toPrintHTML({ title: "Blocked one", blocked: true, reason: "x", columns: [], rows: [], totals: {} }, {}), "Blocked one");
  const app = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
  const pr = app.slice(app.indexOf("function printReport"), app.indexOf("const printButton")), re = /document\.write|window\.open|\.print\(/g;
  assert.equal((app.match(re) || []).length, (pr.match(re) || []).length, "only printReport may open or print a document"); assert.ok(/R\.toPrintHTML/.test(pr));
  assert.ok(!/<h1>Sons of Bethel/.test(fs.readFileSync(path.join(__dirname, "../src/core/reports.js"), "utf8")));
});
console.log(n + " branding tests passed");
