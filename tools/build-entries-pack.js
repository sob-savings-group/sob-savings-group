#!/usr/bin/env node
/* Builds the PRIVATE outstanding-entries file from the owner's CSV (date,member,type,amount,loan,note). Output goes outside the repository (real member data).
   usage: node tools/build-entries-pack.js <ENTRIES_TO_ENTER.csv> <out/SOB_ENTRIES_PACK.json> <batchId> */
const fs = require("fs"), path = require("path"), [inp, out, batchId] = process.argv.slice(2);
if (!inp || !out || !batchId) { console.error("usage: build-entries-pack.js <entries.csv> <out.json> <batchId>"); process.exit(2); }
if (path.resolve(out).startsWith(path.resolve(__dirname, "..") + path.sep)) { console.error("REFUSED: write outside the repository (real data)."); process.exit(2); }
const lines = fs.readFileSync(inp, "utf8").split(/\r?\n/).filter((l) => l.trim()), head = lines.shift().split(",").map((x) => x.trim());
const col = (n) => head.indexOf(n); ["date", "member", "type", "amount", "loan"].forEach((c) => { if (col(c) < 0) { console.error("missing column " + c); process.exit(2); } });
const entries = lines.map((l, i) => { const c = l.split(","); return Object.assign({ ref: String(i + 1) }, { date: c[col("date")].trim(), memberId: c[col("member")].trim(), type: c[col("type")].trim(), amount: Number(c[col("amount")]) }, c[col("loan")].trim() ? { loanId: c[col("loan")].trim() } : {}); });
const pack = { kind: "SOB_ENTRIES_PACK", batchId, entries, controls: { count: entries.length, withdrawals: entries.filter((e) => e.type === "Withdraw").length, total: entries.reduce((s, e) => s + e.amount, 0) } };
fs.writeFileSync(out, JSON.stringify(pack, null, 1), { mode: 0o600 }); console.log("written", out, JSON.stringify(pack.controls));
