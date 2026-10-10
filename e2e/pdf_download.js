/* Download PDF: builds real PDF files in the browser from the branded documents and validates every page. */
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PW_PATH || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright")); }
const { execSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const R = require("../src/core/reports.js"), M = require("../src/core/migrate.js"), L = require("../src/core/ledger.js");
(async () => {
  const meta = { generated: "07/10/2026", period: "As at 7 Oct 2026" };
  const rows = Array.from({ length: 150 }, (_, i) => ({ date: "01/01/2026", member: "Member " + i + " with a fairly long descriptive name", amount: 10000 + i }));
  const db = M.migrateLegacy(require("../tests/helpers/synth.js").legacyRaw(), "2026-03-31");
  const mem = db.members.find((m) => L.memberSavings(db, m.id) > 0), loan = (db.loans || []).find((l) => l.status === "Active");
  const docs = { long: [R.toPrintHTML({ title: "Long test report", columns: ["date", "member", "amount"], rows, totals: { rows: 150 } }, meta), 3, ["Long test report"]],
    stmt: [R.toPrintHTML(R.memberStatementPrint(db, mem.id, {}), meta), 1, ["Savings statement", "Total savings", "Available to you", "Savings balance"]] };
  if (loan) docs.loan = [R.toPrintHTML(R.loanMemberStatement(db, loan.id, "2026-03-31"), meta), 1, ["Loan statement", "Loan left", "Total owed today"]];
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
    const pg = await b.newPage({ viewport: vp }); await pg.addScriptTag({ path: path.join(__dirname, "../src/client/pdf.js") });
    for (const [k, [html, minPages, must]] of Object.entries(docs)) {
      const arr = await pg.evaluate((h) => Array.from(window.SOB.pdf.fromHTML(h)), html), f = path.join(os.tmpdir(), "sob-dl-" + k + ".pdf"); fs.writeFileSync(f, Buffer.from(arr));
      const info = execSync("pdfinfo " + f).toString(), pages = Number(/Pages:\s+(\d+)/.exec(info)[1]);
      if (!/A4|595/.test(info)) throw new Error(k + ": not A4"); if (pages < minPages) throw new Error(k + ": expected >= " + minPages + " pages, got " + pages);
      for (let p = 1; p <= pages; p++) {
        const t = execSync(`pdftotext -layout -f ${p} -l ${p} ${f} -`).toString();
        ["Sons of Bethel (SOB) Savings Group", "Chairperson", "Treasurer", "Secretary", "Coordinator", "Patron", "Page " + p + " of " + pages].concat(p === 1 ? must : []).forEach((s) => { if (!t.includes(s)) throw new Error(`${k} page ${p} missing: ${s}`); });
        if (/undefined|NaN|\[object|savingsEffect|&amp;|&#/.test(t)) throw new Error(k + " page " + p + " has broken text");
        if (execSync(`pdfimages -list -f ${p} -l ${p} ${f}`).toString().trim().split("\n").length < 3) throw new Error(`${k} page ${p}: no logo`);
      }
      if (execSync(`pdftoppm -r 40 -png ${f} ${f}.img 2>&1; ls ${f}.img* | wc -l`).toString().trim() < "1") throw new Error(k + ": does not render");
      if (vp.width === 1280) fs.copyFileSync(f, "/tmp/sob-dl-" + k + ".pdf");
    }
    await pg.close();
  }
  await b.close(); console.log("PASS pdf download: long/statement/loan PDFs valid, header+officers+logo+page numbers on every page");
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
