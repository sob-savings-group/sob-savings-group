#!/usr/bin/env node
/* Builds the PRIVATE SOB records pack (one file the Super Admin picks in the app) from the verified source files.
   usage: node tools/build-records-pack.js --legacy <SOB_FINAL_DATA_V2.json> --history <history-pack.json> --held <history-held-register.json> --recon <reconciliation.json> --out <pack.json>
   The pack holds real names and amounts: it is written OUTSIDE the repository and refused inside it. Control totals are computed from the inputs. */
const fs = require("fs"), path = require("path");
const arg = (n) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : null; };
const need = ["legacy", "history", "held", "recon", "out"].filter((k) => !arg(k)); if (need.length) { console.error("missing: --" + need.join(" --")); process.exit(2); }
const out = path.resolve(arg("out")); if (out.startsWith(path.resolve(__dirname, "..") + path.sep)) { console.error("REFUSED: write the pack outside the repository (real data)."); process.exit(2); }
const J = (k) => JSON.parse(fs.readFileSync(arg(k), "utf8")), legacy = J("legacy"), history = J("history"), held = J("held"), recon = J("recon");
const loans = arg("loans") ? J("loans") : null, fys = arg("fy") ? J("fy") : null, corrections = arg("corrections") ? J("corrections") : null;   // optional: historical loan accounts, financial years, notes on corrected entries
const baseline = arg("baseline") ? J("baseline") : null, observations = arg("observations") ? J("observations") : [];
if (loans) history.loans = loans; if (fys) history.financialYears = fys;
const byType = {}; history.entries.forEach((e) => { const b = (byType[e.type] = byType[e.type] || { count: 0, sum: 0 }); b.count++; b.sum += e.amount; });
const pack = {
  kind: "SOB_RECORDS_PACK", version: 1, builtAt: new Date().toISOString(), legacyAsOf: recon.asOf && typeof recon.asOf === "string" ? recon.asOf : "2026-10-07",
  legacy, history,
  discrepancies: recon.discrepancies.concat(held.discrepancies), resolutions: (recon.resolutions || []).concat(held.resolutions || []), plan: recon.plan,
  controls: { members: legacy.members.length + history.members.length, legacyTransactions: legacy.transactions.length, historyEntries: history.entries.length, historyByType: byType, heldExceptions: held.discrepancies.length - (held.resolutions || []).length, annotations: (history.annotations || []).length,
    historyLoanAccounts: loans ? loans.accounts.length : 0, historyLoanEvents: loans ? ["DISBURSEMENT", "INTEREST", "REPAYMENT"].reduce((o, k) => { const r = loans.events.filter((e) => e.kind === k); o[k] = { count: r.length, sum: r.reduce((a, e) => a + e.amount, 0) }; return o; }, {}) : {}, financialYears: fys ? fys.length : 0 },
  baseline, observations,
  missing: held.missing || recon.missing || [],
  decisions: recon.decisions || []
};
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(pack), { mode: 0o600 });
console.log("pack written:", out, JSON.stringify(pack.controls));
