#!/usr/bin/env node
/* Read-only comparison of the SOURCE ledger text (Trans_Date, Member_ID, Name, Amount, Purpose ...) with an export of the platform's Ledger tab.
   usage: node tools/compare-ledger.js <source-ledger.txt> <sheet-ledger-export.csv|tsv> [outDir]
   It changes NOTHING. Entries are matched on member + type + amount (exact date first, then the nearest unmatched date), so it reports:
   MISSING in the Sheet, EXTRA in the Sheet, and SAME entry with a DIFFERENT DATE. Voided Sheet entries are ignored. Real data stays outside the repository: the report is written
   to outDir (default: the current directory) and the tool refuses to write inside the repo. Nothing is posted: differences become approved requests, never silent edits. */
const fs = require("fs"), path = require("path");
const [src, sheet, outDir = process.cwd()] = process.argv.slice(2);
if (!src || !sheet) { console.error("usage: node tools/compare-ledger.js <source-ledger.txt> <sheet-ledger-export> [outDir]"); process.exit(2); }
if (path.resolve(outDir).startsWith(path.resolve(__dirname, ".."))) { console.error("REFUSED: write the report outside the repository (real data)."); process.exit(2); }
const num = (s) => Number(String(s == null ? "" : s).replace(/[,\s"]/g, "")), TYPEFIX = { "Loan Disbursement": "Loan Disbursement", "Loan Repayment": "Loan Repayment", Savings: "Savings", Withdraw: "Withdraw", Profit: "Profit" };
const split = (line, d) => { if (d === "\t") return line.split("\t"); const out = []; let cur = "", q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
const iso = (s) => { s = String(s || "").trim(); let m; if ((m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(s))) return "20" + m[3] + "-" + m[2] + "-" + m[1]; if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + "-" + m[2] + "-" + m[3]; if ((m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s))) return m[3] + "-" + m[2] + "-" + m[1]; return ""; };
const source = fs.readFileSync(src, "utf8").split(/\r?\n/).map((l, i) => ({ l, i: i + 1 })).filter((x) => x.i > 1 && x.l.trim()).map((x) => { const c = x.l.split("\t"); return { line: x.i, date: iso(c[0]), member: String(c[1] || "").trim(), name: String(c[2] || "").trim(), amount: num(c[3]), type: String(c[4] || "").trim() }; }).filter((r) => r.date && r.member && r.amount > 0);
const raw = fs.readFileSync(sheet, "utf8").split(/\r?\n/).filter((l) => l.trim()), d = raw[0].indexOf("\t") >= 0 ? "\t" : ",", head = split(raw[0], d).map((h) => h.trim().toLowerCase());
const ix = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; }, I = { id: ix("id"), date: ix("date"), member: ix("memberid", "member id", "member"), amount: ix("amount"), type: ix("type"), voided: ix("voided") };
if (I.date < 0 || I.member < 0 || I.amount < 0 || I.type < 0) { console.error("The export needs the columns date, memberId, amount and type (the Ledger tab has them)."); process.exit(2); }
const sheetRows = raw.slice(1).map((l, i) => { const c = split(l, d); return { line: i + 2, id: I.id >= 0 ? c[I.id] : "", date: iso(c[I.date]), member: String(c[I.member] || "").trim(), amount: num(c[I.amount]), type: String(c[I.type] || "").trim(), voided: I.voided >= 0 && /^(true|yes|1)$/i.test(String(c[I.voided] || "").trim()) }; }).filter((r) => r.date && r.member && r.amount > 0 && !r.voided);
const key = (r) => r.member + "|" + r.type + "|" + r.amount, groups = (rows) => rows.reduce((o, r) => ((o[key(r)] = o[key(r)] || []).push(r), o), {});
const A = groups(source), B = groups(sheetRows), missing = [], extra = [], moved = [], same = [];
Object.keys(Object.assign({}, A, B)).forEach((k) => {
  const a = (A[k] || []).slice(), b = (B[k] || []).slice();
  for (let i = a.length - 1; i >= 0; i--) { const j = b.findIndex((x) => x.date === a[i].date); if (j >= 0) { same.push(a[i]); a.splice(i, 1); b.splice(j, 1); } }
  const days = (x, y) => Math.abs(Date.parse(x) - Date.parse(y)) / 864e5;
  while (a.length && b.length) { let best = [0, 0, 1e9]; a.forEach((x, i) => b.forEach((y, j) => { const dd = days(x.date, y.date); if (dd < best[2]) best = [i, j, dd]; })); moved.push({ source: a[best[0]], sheet: b[best[1]], days: best[2] }); a.splice(best[0], 1); b.splice(best[1], 1); }
  a.forEach((x) => missing.push(x)); b.forEach((x) => extra.push(x));
});
const f = (n) => Math.round(n).toLocaleString("en-US"), sum = (rs) => rs.reduce((t, r) => t + r.amount, 0);
const out = ["# Source ledger vs platform Ledger tab (read-only comparison)", "", "Source entries: " + source.length + " · Sheet entries (not voided): " + sheetRows.length, "Matching exactly: " + same.length + " · Same entry, different date: " + moved.length + " · In the source but MISSING from the Sheet: " + missing.length + " (UGX " + f(sum(missing)) + ") · In the Sheet but NOT in the source: " + extra.length + " (UGX " + f(sum(extra)) + ")", "", "Nothing has been changed. Each difference needs a decision by an authorised officer before any record is touched.", ""];
const tbl = (title, rows, cols, fn) => { out.push("## " + title + " (" + rows.length + ")"); if (!rows.length) { out.push("None.", ""); return; } out.push(cols.join(" | "), cols.map(() => "---").join(" | ")); rows.forEach((r) => out.push(fn(r).join(" | "))); out.push(""); };
tbl("In the source but missing from the Sheet", missing.sort((x, y) => x.date < y.date ? -1 : 1), ["Source line", "Date", "Member", "Name", "Type", "Amount"], (r) => [r.line, r.date, r.member, r.name, r.type, f(r.amount)]);
tbl("In the Sheet but not in the source", extra.sort((x, y) => x.date < y.date ? -1 : 1), ["Sheet row", "Entry", "Date", "Member", "Type", "Amount"], (r) => [r.line, r.id || "", r.date, r.member, r.type, f(r.amount)]);
tbl("Same entry, different date", moved.sort((x, y) => y.days - x.days), ["Member", "Type", "Amount", "Source date", "Sheet date", "Days apart", "Sheet entry"], (m) => [m.source.member, m.source.type, f(m.source.amount), m.source.date, m.sheet.date, m.days, m.sheet.id || ""]);
fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, "LEDGER_COMPARISON.md"), out.join("\n"));
console.log(out.slice(2, 4).join("\n"), "\nReport: " + path.join(outDir, "LEDGER_COMPARISON.md"));
