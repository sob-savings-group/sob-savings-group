/* Renders a long report to a real PDF in Chromium and proves the SOB header and footer are on EVERY page. */
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const { execSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const R = require("../src/core/reports.js");
(async () => {
  const rows = Array.from({ length: 150 }, (_, i) => ({ date: "01/01/2026", member: "Member " + i, amount: 10000 + i }));
  const rep = { title: "Long test report", columns: ["date", "member", "amount"], rows, totals: { rows: 150 } };
  const html = R.toPrintHTML(rep, { generated: "07/10/2026", period: "Jan–Dec 2026" });
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }), pg = await b.newPage();
  await pg.setContent(html); const f = path.join(os.tmpdir(), "sob-long.pdf"); await pg.pdf({ path: f, format: "A4", printBackground: true }); await b.close();
  const pages = Number(/Pages:\s+(\d+)/.exec(execSync("pdfinfo " + f).toString())[1]);
  if (pages < 3) throw new Error("expected multi-page, got " + pages);
  for (let p = 1; p <= pages; p++) {
    const txt = execSync(`pdftotext -f ${p} -l ${p} ${f} -`).toString();
    ["Sons of Bethel (SOB) Savings Group", "Long test report", "Kironde John", "0706 496 404", "Kagimu Francis", "0755 924 822", "Nabawanuka Amina", "0703 154 463", "Ssebadduka Joshua", "0774 020 205", "Kuteesa Waddimba", "+256 772 834 290"].forEach((s) => { if (!txt.includes(s)) throw new Error("page " + p + " missing: " + s); });
    if (execSync(`pdfimages -list -f ${p} -l ${p} ${f}`).toString().trim().split("\n").length < 3) throw new Error("page " + p + " has no logo");
  }
  /* a real member statement + loan statement from synthetic data: plain wording, formatted numbers, positions on top */
  const M = require("../src/core/migrate.js"), L = require("../src/core/ledger.js"), seed = require("../tests/helpers/synth.js").legacyRaw(), db = M.migrateLegacy(seed, "2026-03-31");
  const mem = db.members.find((m) => L.memberSavings(db, m.id) > 0), loan = (db.loans || []).find((l) => l.status === "Active");
  const pdfOf = async (rep, name) => { const b2 = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }), p2 = await b2.newPage(); await p2.setContent(R.toPrintHTML(rep, { generated: "07/10/2026", period: "As at 7 Oct 2026" })); const f2 = path.join(os.tmpdir(), name); await p2.pdf({ path: f2, format: "A4", printBackground: true }); await b2.close(); return f2; };
  const sf = await pdfOf(R.memberStatementPrint(db, mem.id, {}), "sob-stmt.pdf"), st1 = execSync("pdftotext -layout " + sf + " -").toString();
  ["Savings statement", "Total savings", "Available to you", "Transaction", "Savings balance", "Page 1 of"].forEach((x) => { if (!st1.includes(x)) throw new Error("member statement PDF missing: " + x); });
  if (/savingsEffect|undefined|NaN|\[object/.test(st1)) throw new Error("member statement PDF has technical/broken text");
  fs.copyFileSync(sf, "/tmp/sob-stmt.pdf");
  if (loan) { const lf = await pdfOf(R.loanMemberStatement(db, loan.id, "2026-03-31"), "sob-loan.pdf"), lt = execSync("pdftotext -layout " + lf + " -").toString(); ["Loan statement", "Loan left", "Interest due now", "Total owed today"].forEach((x) => { if (!lt.includes(x)) throw new Error("loan statement PDF missing: " + x); }); fs.copyFileSync(lf, "/tmp/sob-loan.pdf"); }
  console.log("PASS pdf: " + pages + " pages, header + footer + logo on every page"); fs.copyFileSync(f, "/tmp/sob-long.pdf");
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
