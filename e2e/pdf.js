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
  console.log("PASS pdf: " + pages + " pages, header + footer + logo on every page"); fs.copyFileSync(f, "/tmp/sob-long.pdf");
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
