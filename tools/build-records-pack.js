#!/usr/bin/env node
/* Builds the PRIVATE SOB records pack (one file the Super Admin picks in the app) from the verified source files.
   usage: node tools/build-records-pack.js --legacy <SOB_FINAL_DATA_V2.json> --history <history-pack.json> --held <history-held-register.json> --recon <reconciliation.json> --out <pack.json>
   The pack holds real names and amounts: it is written OUTSIDE the repository and refused inside it. Control totals are computed from the inputs. */
const fs = require("fs"), path = require("path");
const arg = (n) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : null; };
const need = ["legacy", "history", "held", "recon", "out"].filter((k) => !arg(k)); if (need.length) { console.error("missing: --" + need.join(" --")); process.exit(2); }
const out = path.resolve(arg("out")); if (out.startsWith(path.resolve(__dirname, "..") + path.sep)) { console.error("REFUSED: write the pack outside the repository (real data)."); process.exit(2); }
const J = (k) => JSON.parse(fs.readFileSync(arg(k), "utf8")), legacy = J("legacy"), history = J("history"), held = J("held"), recon = J("recon");
const byType = {}; history.entries.forEach((e) => { const b = (byType[e.type] = byType[e.type] || { count: 0, sum: 0 }); b.count++; b.sum += e.amount; });
const pack = {
  kind: "SOB_RECORDS_PACK", version: 1, builtAt: new Date().toISOString(), legacyAsOf: recon.asOf && typeof recon.asOf === "string" ? recon.asOf : "2026-10-07",
  legacy, history,
  discrepancies: recon.discrepancies.concat(held.discrepancies), resolutions: (recon.resolutions || []).concat(held.resolutions || []), plan: recon.plan,
  controls: { members: legacy.members.length + history.members.length, legacyTransactions: legacy.transactions.length, historyEntries: history.entries.length, historyByType: byType, heldExceptions: held.discrepancies.length, annotations: (history.annotations || []).length },
  missing: [
    "SOB-003 (Bishop): 108 historical rows sit in a staged sheet whose member identity is not established. They are NOT imported and no member was guessed.",
    "The 50 held historical rows (see the register): the workbook does not say whether each is an ordinary savings movement, a loan movement or a December share-out.",
    "Two undated workbook amounts (SOB-004 -150,000 and SOB-006 +1,400,000) are recorded as audit notes only; no date was invented."
    ,"Guarantor records: the source records contain none, so guarantee commitments show 0 and available savings equal cumulative savings until guarantors are recorded for loans.",
    "Annual UGX 5,000 subscription receipts: no subscription entries exist in the source records, so subscription income starts at 0."
  ],
  decisions: recon.plan.excluded.map((x) => x.loanId + " (" + x.memberId + "): " + x.why)
};
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(pack), { mode: 0o600 });
console.log("pack written:", out, JSON.stringify(pack.controls));
