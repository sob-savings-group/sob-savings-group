/* SOB core/loader — loads the VERIFIED SOB records pack into the live ledger through the server's own audited actions.
   Runs in the browser (Admin screen) and in Node (tests) from the same code: everything goes through `api(body) -> parsed JSON` (the signed-in Admin session).
   Rules it keeps: nothing is invented or altered to force a balance; uncertain rows stay in the reconciliation register; running it twice adds nothing
   (legacy ledger only into an empty ledger; history is idempotent by sourceRef; register items by subject; corrections by request/target);
   cumulative savings and available savings (savings less guarantee commitments) are reported separately and a loan is NEVER netted off savings. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const dep = (n, f) => (isNode ? require("./" + f) : root.SOB[n]);
  const api = factory(dep("dates", "dates.js"), dep("ledger", "ledger.js"), dep("migrate", "migrate.js"), dep("integrity", "integrity.js"), dep("fy", "fy.js"), dep("histloans", "histloans.js"), dep("profitrec", "profitrec.js"), dep("reserve", "reserve.js"));
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.loader = api; }
})(typeof self !== "undefined" ? self : this, function (D, L, M, I, FY, HL, PRC, RSV) {
  const PACK_KIND = "SOB_RECORDS_PACK";
  const norm = (s) => String(s || "").trim().toLowerCase();
  const must = (r, what) => { if (!r || !r.ok) throw new Error(what + ": " + ((r && r.error) || "no answer")); return r; };
  const money = (n) => Math.round(Number(n) || 0);

  function validatePack(p) {
    const e = [];
    if (!p || p.kind !== PACK_KIND) return ["This is not an SOB records file."];
    if (!p.legacy || !Array.isArray(p.legacy.members) || !Array.isArray(p.legacy.transactions)) e.push("The current-records section is missing.");
    if (!p.history || !Array.isArray(p.history.entries)) e.push("The historical-records section is missing.");
    if (!p.controls) e.push("The control totals are missing.");
    if (p.history && p.controls && p.controls.historyEntries !== p.history.entries.length) e.push("Historical row count does not match the control total.");
    if (p.legacy && p.controls && p.controls.legacyTransactions !== p.legacy.transactions.length) e.push("Current-record count does not match the control total.");
    return e;
  }
  const realNames = (p) => (p.legacy.members || []).concat(p.history.members || []).map((m) => m.name);

  /* What is in the Google Sheet right now, compared with the pack. */
  function inspect(db, pack) {
    const real = new Set(realNames(pack).map(norm)), have = db.members || [];
    const out = { members: have.length, transactions: (db.transactions || []).length, loans: (db.loans || []).length, matching: have.filter((m) => real.has(norm(m.name))).length };
    if (!have.length && !out.transactions && !out.loans) out.state = "empty";
    else if (out.matching === 0) out.state = "foreign";                       // nothing in it is an SOB member: demo or sample data
    else if (out.matching === have.length || out.matching >= pack.legacy.members.length) out.state = "loaded";
    else out.state = "mixed";
    return out;
  }

  const checks = () => { const list = []; return { list, add(name, pass, detail) { list.push({ name, pass: !!pass, detail: detail || "" }); return !!pass; }, get ok() { return list.every((c) => c.pass); } }; };

  /* Full, idempotent load. `o`: {approvedBy, asOf, dryRun, say(msg)}. Returns {ok, checks, state, pending[]}. */
  async function load(api, pack, o) {
    o = o || {}; const say = o.say || (() => {}), c = checks(), asOf = o.asOf || D.todayISO(), pending = [];
    const bad = validatePack(pack); if (bad.length) { c.add("records file is valid", false, bad.join(" ")); return { ok: false, checks: c.list, pending }; }
    if (!o.approvedBy || String(o.approvedBy).trim().length < 5) { c.add("an approver name, role and date is required", false); return { ok: false, checks: c.list, pending }; }
    const read = async () => must(await api({ action: "getLedger" }), "read ledger").db;
    let db = await read(), st = inspect(db, pack);
    c.add("Sheet state: " + st.state + " (" + st.members + " members, " + st.transactions + " transactions, " + st.loans + " loans)", st.state !== "foreign" && st.state !== "mixed",
      st.state === "foreign" ? "The Sheet holds records that are not SOB members (demo/sample). Remove them first with the clean-up button; nothing was changed." : st.state === "mixed" ? "The Sheet mixes SOB members with unknown ones; nothing was changed. Ask for help." : "");
    if (st.state === "foreign" || st.state === "mixed") return { ok: false, checks: c.list, state: st.state, pending };

    /* 1. current ledger (members, savings, loans, repayments, interest, guarantees): only into an empty ledger */
    const asOfLegacy = pack.legacyAsOf || asOf;
    if (st.state === "empty") {
      say("Checking the current records…");
      const mig = M.migrateLegacy(pack.legacy, asOfLegacy), ver = M.verifyMigration(pack.legacy, mig, asOfLegacy);
      c.add("current records re-computed figure-for-figure before saving", ver.pass, ver.checks.filter((x) => !x.pass).map((x) => x.name).join(", "));
      if (!ver.pass) return { ok: false, checks: c.list, pending };
      if (o.dryRun) { c.add("DRY RUN: nothing was written", true); return { ok: c.ok, dryRun: true, checks: c.list, pending }; }
      say("Taking a backup, then saving the current records…");
      await api({ action: "backupNow", force: true });
      must(await api({ action: "importSnapshot", db: mig }), "import current records");
      db = await read();
      c.add("current records saved: " + db.members.length + " members, " + db.transactions.length + " transactions, " + db.loans.length + " loans", db.members.length === mig.members.length && db.transactions.length === mig.transactions.length && db.loans.length === mig.loans.length);
      c.add("every current transaction id preserved", mig.transactions.every((x) => db.transactions.some((y) => y.id === x.id && y.date === x.date && y.amount === x.amount)));
      c.add("savings per member identical after saving", mig.members.every((m) => L.memberSavings(db, m.id) === L.memberSavings(mig, m.id)));
    } else {
      c.add("current records already in the Sheet: skipped (no duplicates)", true);
      if (o.dryRun) { c.add("DRY RUN: nothing was written", true); }
    }

    /* 2. historical records: new members, then rows (idempotent by source reference), then audit-only annotations */
    const H = pack.history, src = H.source + " | Approved by: " + o.approvedBy;
    const hargs = (entries, extra) => Object.assign({ batchId: H.batchId, source: src, entries }, extra || {});
    for (const m of (H.members || [])) {
      const ex = db.members.find((x) => x.id === m.id);
      if (ex) { c.add("member " + m.id + " already exists with the same name", norm(ex.name) === norm(m.name), ex.name); continue; }
      if (o.dryRun) continue;
      must(await api({ action: "command", name: "addMember", args: { id: m.id, name: m.name, regDate: m.regDate || "" } }), "add member " + m.id);
    }
    db = await read();
    const todo = H.entries.filter((e) => !db.transactions.some((x) => x.sourceRef === e.sourceRef));
    if (!o.dryRun) {
      say("Importing " + todo.length + " historical records…");
      const pre = db;
      for (let i = 0; i < todo.length; i += 150) must(await api({ action: "command", name: "importHistoricalEntries", args: hargs(todo.slice(i, i + 150)) }), "history rows " + i);
      const haveNotes = (d) => new Set((d.historicalNotes || []).map((n) => n.sourceRef)), missingNotes = (H.annotations || []).filter((n) => !haveNotes(db).has(n.sourceRef));
      if (missingNotes.length) must(await api({ action: "command", name: "importHistoricalEntries", args: hargs([], { annotations: missingNotes }) }), "annotations");
      db = await read();
      c.add("audit-only notes recorded (not transactions): " + (H.annotations || []).length, (H.annotations || []).every((n) => haveNotes(db).has(n.sourceRef)) && (db.historicalNotes || []).every((n) => n.isTransaction === false));
      c.add("historical rows in the Sheet: " + H.entries.length + " of " + H.entries.length + " (" + todo.length + " new this time, " + (H.entries.length - todo.length) + " already there)", H.entries.every((e) => db.transactions.some((x) => x.sourceRef === e.sourceRef)));
      c.add("existing records untouched by the history import", pre.transactions.every((x) => JSON.stringify(db.transactions.find((y) => y.id === x.id)) === JSON.stringify(x)));
      const net = {}; todo.forEach((e) => { net[e.memberId] = (net[e.memberId] || 0) + (["Savings", "Profit"].includes(e.type) ? e.amount : -e.amount); });
      c.add("each member's savings moved by exactly the imported rows", db.members.every((m) => L.memberSavings(db, m.id) - L.memberSavings(pre, m.id) === (net[m.id] || 0)));
      c.add("original dates, amounts and member IDs preserved", H.entries.every((e) => { const x = db.transactions.find((y) => y.sourceRef === e.sourceRef); return x && x.date === (e.dateUnknown ? e.dateAfter : e.date) && (!e.dateUnknown || x.dateUnknown === true) && x.memberId === e.memberId && x.amount === e.amount && x.historical === true; }));
      const again = must(await api({ action: "command", name: "importHistoricalEntries", args: hargs(H.entries, { dryRun: true }) }), "re-run check").result;
      c.add("running it again would add nothing", again.added === 0 && again.possibleDuplicates.length === 0);
    }

    /* 2b. historical LOAN accounts (disbursements, interest charged, repayments): their own records, never part of today's loan book; idempotent by source reference */
    if (!o.dryRun && H.loans && ((H.loans.accounts || []).length || (H.loans.events || []).length)) {
      say("Recording the historical loan accounts…");
      const lhave = (d) => new Set(d.transactions.map((t) => t.sourceRef).concat((d.loanInterestRecords || []).map((r) => r.sourceRef))), lg = (extra) => Object.assign({ batchId: H.batchId + "-LOANS", source: src }, extra);
      const evs = H.loans.events, ev0 = evs.filter((e) => !lhave(db).has(e.sourceRef)), pre2 = db;
      const needAcc = (H.loans.accounts || []).some((a) => !(db.historicalLoans || []).some((l) => l.key === a.key));
      for (let i = 0; i < (ev0.length ? Math.ceil(ev0.length / 150) : needAcc ? 1 : 0); i += 1) must(await api({ action: "command", name: "importHistoricalLoans", args: lg({ accounts: i === 0 ? H.loans.accounts : [], events: ev0.slice(i * 150, i * 150 + 150) }) }), "historical loans " + i);
      db = await read();
      const sumOf = (k) => evs.filter((e) => e.kind === k).reduce((a, e) => a + e.amount, 0), have2 = lhave(db);
      c.add("historical loan accounts recorded: " + (H.loans.accounts || []).length, (H.loans.accounts || []).every((a) => (db.historicalLoans || []).some((l) => l.key === a.key && l.memberId === a.memberId)));
      c.add("every loan disbursement, interest charge and repayment recorded once (" + evs.length + " records; " + ev0.length + " new this time)", evs.every((e) => have2.has(e.sourceRef)) && (db.historicalLoans || []).length === (H.loans.accounts || []).length);
      c.add("historical loan totals agree with the source: disbursed " + sumOf("DISBURSEMENT") + ", interest charged " + sumOf("INTEREST") + ", repaid " + sumOf("REPAYMENT"),
        db.transactions.filter((t) => t.type === HL.DISB && !t.voided).reduce((a, t) => a + t.amount, 0) === sumOf("DISBURSEMENT") && (db.loanInterestRecords || []).filter((r) => !r.voided).reduce((a, r) => a + r.amount, 0) === sumOf("INTEREST") && db.transactions.filter((t) => t.type === HL.REPAY && !t.voided).reduce((a, t) => a + t.amount, 0) === sumOf("REPAYMENT"));
      c.add("historical loan records changed no member's savings and no live loan", db.members.every((m) => L.memberSavings(db, m.id) === L.memberSavings(pre2, m.id)) && (db.loans || []).length === (pre2.loans || []).length);
      const again2 = must(await api({ action: "command", name: "importHistoricalLoans", args: lg({ accounts: H.loans.accounts, events: evs, dryRun: true }) }), "loan re-run check").result;
      c.add("running the loan records again would add nothing", again2.accountsAdded === 0 && again2.disbursements + again2.interestRecords + again2.repayments === 0);
    }
    /* 2c. financial years from the actual share-out dates (never 31 December) */
    if (!o.dryRun && H.financialYears && H.financialYears.length) {
      const r = must(await api({ action: "command", name: "defineFinancialYears", args: { years: H.financialYears } }), "financial years");
      db = await read(); const prob = FY.check(db);
      c.add("financial years set by the share-outs: " + FY.table(db).map((y) => y.label + " " + y.openedDate + (y.closedDate ? " to " + y.closedDate : " (open)")).join("; "), H.financialYears.every((y) => { const t = FY.byYear(db, y.year); return t && t.openedDate === y.openedDate && (t.closedDate || null) === (y.closedDate || null); }), "");
      c.add("each year starts on the day the previous share-out was held, and the last year's closing equals total savings", prob.length === 0, prob.join("; "));
    }

    /* 3. reconciliation register: uncertain items stay open, with their evidence */
    if (!o.dryRun) {
      say("Recording the reconciliation exceptions…");
      let opened = 0, kept = 0, failed = [];
      for (const d of (pack.discrepancies || [])) {
        if ((db.discrepancies || []).some((x) => x.subject === d.subject && x.kind === d.kind)) { kept++; continue; }
        const r = await api({ action: "command", name: "openDiscrepancy", args: d }); if (r.ok) { opened++; db = r.db; } else failed.push(d.subject + ": " + r.error);
      }
      c.add("exception register: " + opened + " recorded, " + kept + " already there", failed.length === 0, failed.slice(0, 3).join("; "));
      for (const res of (pack.resolutions || [])) {
        const item = (db.discrepancies || []).find((x) => x.subject === res.subject && x.status === "Open"); if (!item) continue;
        const r = await api({ action: "command", name: "resolveDiscrepancy", args: { id: item.id, decision: res.decision, reason: res.reason, evidence: res.evidence } });
        if (r.ok && r.result && r.result.pendingApproval) pending.push(r.result.label + " (" + res.subject + ")");
        if (r.ok) db = r.db; else c.add("resolution recorded: " + res.subject, false, r.error);
      }
    }

    /* 4. SOB-approved corrections: Super Admin REQUESTS, the Chairperson approves. Repayments that replace a voided consolidated one wait for that approval. */
    if (!o.dryRun && pack.plan && pack.plan.steps) {
      say("Submitting the approved corrections for the Chairperson…");
      db = await read();
      const reqs = db.approvalRequests || [], targetOf = (s) => s.args.loanId || s.args.id || s.args.year;
      const voidStep = pack.plan.steps.find((s) => s.name === "voidEntry"), voided = voidStep && (db.transactions.find((t) => t.id === voidStep.args.id) || {}).voided;
      let submitted = 0, already = 0, waiting = 0, created = 0;
      for (const s of pack.plan.steps) {
        const args = Object.assign({}, s.args); if (args.reason) args.reason += " | Approved by: " + o.approvedBy;
        if (s.name === "createEntry") {
          if (db.transactions.some((t) => !t.voided && t.memberId === args.memberId && t.date === args.date && t.amount === args.amount && t.type === args.type && t.loanId === args.loanId)) { already++; continue; }
          if (!voided) { waiting++; continue; }
          const r = await api({ action: "command", name: "createEntry", args }); if (r.ok) { created++; db = r.db; } else c.add("repayment " + args.date + " " + args.amount, false, r.error);
          continue;
        }
        if (reqs.some((q) => q.command === s.name && targetOf({ args: q.args }) === targetOf(s) && ["Pending", "Approved"].includes(q.status))) { already++; continue; }
        const r = await api({ action: "command", name: s.name, args });
        if (r.ok && r.result && r.result.pendingApproval) { submitted++; pending.push(r.result.label + ": " + r.result.summary); } else c.add("request " + s.name + " " + targetOf(s), false, r.error);
      }
      c.add("corrections: " + submitted + " newly requested, " + already + " already requested/applied" + (waiting ? ", " + waiting + " repayments wait for the Chairperson to approve the void first (run this again afterwards)" : "") + (created ? ", " + created + " repayments recorded" : ""), true);
    }
    /* A register item for a loan date is closed only once the Chairperson-approved correction has actually been applied; items still needing an SOB decision stay open. */
    if (!o.dryRun && pack.plan && pack.plan.steps) {
      db = await read(); let closed = 0;
      for (const s of pack.plan.steps.filter((x) => x.name === "correctLoanDate")) {
        const loan = db.loans.find((l) => l.id === s.args.loanId), item = (db.discrepancies || []).find((x) => x.status === "Open" && x.kind === "LOAN_DATE" && x.subject === s.args.loanId);
        if (!loan || !item || loan.date !== s.args.date) continue;
        const r = await api({ action: "command", name: "resolveDiscrepancy", args: { id: item.id, decision: "NO_ACTION_EXPLAINED", reason: "Start date corrected to the dated source record by an approved correction (original date kept in the loan's history).", evidence: s.args.evidence } });
        if (r.ok) { closed++; db = r.db; }
      }
      if (closed) c.add("register: " + closed + " loan-date item(s) closed because their approved correction is now applied", true);
    }
    db = await read();
    if (pack.coverage && pack.coverage.rows) {
      const have = new Set(); db.transactions.forEach((x) => { if (x.sourceRef) have.add(String(x.sourceRef).split("#")[0]); }); (db.loanInterestRecords || []).forEach((x) => { if (x.sourceRef) have.add(String(x.sourceRef).split("#")[0]); }); (db.historicalNotes || []).forEach((x) => { if (x.sourceRef) have.add(String(x.sourceRef).split("#")[0]); });
      const gone = pack.coverage.rows.filter((r) => !have.has(r));
      c.add("every numeric row of the member sheets is accounted for: " + pack.coverage.rows.length + " rows posted, recorded as loan events or kept as audit notes; " + (pack.coverage.blankRows || []).length + " dated rows without an amount are held and disclosed, none posted", gone.length === 0 && pack.coverage.unaccounted === 0, gone.slice(0, 5).join(", "));
    }
    const un = I.unaccounted(db, asOf); c.add("ledger integrity: every error is accounted for in the reconciliation register", un.length === 0, un.map((f) => f.code + " " + f.detail).join("; "));
    return { ok: c.ok, checks: c.list, state: inspect(db, pack).state, pending };
  }

  /* ---------- the reconciliation report (computed from the live ledger; no hard-coded figures) ---------- */
  function build(db, pack, asOf) {
    const active = (db.transactions || []).filter((t) => !t.voided), sumBy = (f) => active.filter(f).reduce((a, t) => a + (Number(t.amount) || 0), 0);
    const rows = db.members.map((m) => {
      const pos = L.memberPositionAsAt(db, m.id, asOf), loans = (db.loans || []).filter((l) => l.memberId === m.id && !l.voided && l.status !== "Voided");
      let principal = 0, unpaidInterest = 0, penalties = 0;
      loans.forEach((l) => { const w = L.loanInterestPosition(l, db, asOf); principal += w.principalOutstanding; unpaidInterest += w.unpaidInterest; penalties += w.unpaidPenalties; });
      const owed = principal + unpaidInterest + penalties, profit = active.filter((t) => t.memberId === m.id && t.type === "Profit").reduce((a, t) => a + t.amount, 0);
      const sumT = (ty) => active.filter((t) => t.memberId === m.id && t.type === ty).reduce((a, t) => a + (Number(t.amount) || 0), 0), dep = sumT("Savings"), wd = sumT("Withdraw"), so = sumT("Share-Out");
      return { id: m.id, name: m.name, deposits: money(dep), withdrawals: money(wd), shareOuts: money(so), otherMovements: money(pos.savings - (dep + profit - wd - so)), savings: money(pos.savings), committed: money(pos.committed), available: money(pos.available), profitCredited: money(profit), loanPrincipal: money(principal), unpaidInterest: money(unpaidInterest), loanOwed: money(owed), memoNet: money(pos.savings - owed), historyRows: active.filter((t) => t.memberId === m.id && t.historical && !t.historicalLoan).length };
    });
    const base = (pack.baseline && pack.baseline.savings) || null;
    rows.forEach((r) => { r.original = base ? money(base[r.id] || 0) : null; r.correction = base ? r.savings - r.original : null; r.revised = r.savings; });
    const tot = (k) => rows.reduce((a, r) => a + r[k], 0), g = L.computeGroupTotals(db, asOf), reg = db.discrepancies || [];
    const hist = active.filter((t) => t.historical && !t.historicalLoan), byType = {}; hist.forEach((t) => { const b = (byType[t.type] = byType[t.type] || { count: 0, sum: 0 }); b.count++; b.sum += t.amount; });
    const ctl = pack.controls || {}, t = [];
    const add = (name, expected, actual, note) => t.push({ name, expected, actual, pass: expected === actual, note: note || "" });
    add("Members in the Sheet", ctl.members, db.members.length);
    const legacyIds = new Set((pack.legacy.transactions || []).map((x) => x.id));
    add("Current-record transactions (original ids still in the ledger)", ctl.legacyTransactions, db.transactions.filter((x) => legacyIds.has(x.id)).length, "a voided original stays in the ledger, marked void");
    add("Historical rows imported", ctl.historyEntries, hist.length);
    Object.keys(ctl.historyByType || {}).forEach((k) => { add("Historical " + k + " (count)", ctl.historyByType[k].count, (byType[k] || {}).count || 0); add("Historical " + k + " (UGX)", ctl.historyByType[k].sum, (byType[k] || {}).sum || 0); });
    add("Open exceptions in the register (historical rows held)", ctl.heldExceptions, reg.filter((d) => d.status === "Open" && d.kind === "MISSING_ENTRY").length);
    if (ctl.historyLoanAccounts !== undefined) {
      add("Historical loan accounts", ctl.historyLoanAccounts, (db.historicalLoans || []).filter((l) => !l.voided).length);
      const HT = { DISBURSEMENT: HL.DISB, REPAYMENT: HL.REPAY };
      Object.keys(ctl.historyLoanEvents || {}).forEach((k) => { const x = ctl.historyLoanEvents[k], rowsK = k === "INTEREST" ? (db.loanInterestRecords || []).filter((r) => !r.voided) : active.filter((t) => t.type === HT[k]); add("Historical loan " + k.toLowerCase() + " (count)", x.count, rowsK.length); add("Historical loan " + k.toLowerCase() + " (UGX)", x.sum, rowsK.reduce((a, t) => a + Number(t.amount), 0)); });
    }
    if (ctl.financialYears !== undefined) add("Financial years defined by share-out", ctl.financialYears, FY.table(db).length);
    const histLoans = (db.historicalLoans || []).filter((l) => !l.voided).map((l) => { const p = HL.position(db, l.id, asOf), mm = db.members.find((x) => x.id === l.memberId) || {};
      return { loanId: l.id, memberId: l.memberId, member: mm.name || l.memberId, date: l.date, registerAmount: l.registerAmount, disbursed: p.disbursed, interestCharged: p.interestCharged, interestReceived: p.interestReceived, principalRepaid: p.principalRepaid, interestOutstanding: p.interestOutstanding, principalOutstanding: p.principalOutstanding, status: p.status, registerCorrection: l.registerCorrection || null, evidence: l.registerRef + (l.note ? " - " + l.note : "") + (l.registerCorrection ? " | CORRECTED by Chairperson: " + l.registerCorrection : "") }; });
    const remaining = [];
    histLoans.filter((x) => x.interestOutstanding + x.principalOutstanding > 0).forEach((x) => remaining.push({ item: "Historical loan not settled by the records: " + x.memberId + " " + x.member + " (" + x.loanId + ")", amount: x.interestOutstanding + x.principalOutstanding, detail: "principal " + x.principalOutstanding + " + interest " + x.interestOutstanding + " unpaid at the last record; no record carries it into the current loan register or settles it" }));
    histLoans.filter((x) => x.registerAmount != null && x.registerAmount !== x.disbursed && !x.registerCorrection).forEach((x) => remaining.push({ item: "Loan register amount differs from the disbursements recorded: " + x.memberId + " " + x.member, amount: x.registerAmount - x.disbursed, detail: "register " + x.registerAmount + " vs member-sheet disbursements " + x.disbursed }));
    [...new Set((db.historicalLoans || []).map((l) => l.memberId))].forEach((mid) => { const w = HL.walk(db, mid, asOf); if (w.excess > 0) remaining.push({ item: "Repayments above what the records show as due: " + mid + " " + ((db.members.find((x) => x.id === mid) || {}).name || ""), amount: w.excess, detail: "kept visible; no interest or loan record explains it" }); });
    rows.filter((r) => r.savings < 0).forEach((r) => remaining.push({ item: "Negative savings: " + r.id + " " + r.name, amount: r.savings, detail: "the recorded withdrawals/share-outs exceed the recorded deposits" }));
    (pack.observations || []).forEach((o2) => remaining.push({ item: o2.item, amount: o2.amount === undefined ? "" : o2.amount, detail: o2.detail }));
    return {
      asOf, rows, totals: { deposits: tot("deposits"), withdrawals: tot("withdrawals"), shareOuts: tot("shareOuts"), otherMovements: tot("otherMovements"), savings: tot("savings"), committed: tot("committed"), available: tot("available"), profitCredited: tot("profitCredited"), loanPrincipal: tot("loanPrincipal"), unpaidInterest: tot("unpaidInterest"), loanOwed: tot("loanOwed"), memoNet: tot("memoNet") },
      group: g, historyByType: byType, controls: t, register: reg.map((d) => ({ kind: d.kind, subject: d.subject, summary: d.summary, status: d.status, decision: d.decision || "" })),
      negative: rows.filter((r) => r.savings < 0).map((r) => r.id + " " + r.name), missing: pack.missing || [], decisions: pack.decisions || [],
      years: FY.summary(db), profit: PRC.all(db, asOf), profitCredited: PRC.creditedTotal(db), histLoans, remaining, reserve: RSV.statement(db), fyCheck: FY.check(db),
      contributions: { deposits: sumBy((x) => x.type === "Savings"), withdrawals: sumBy((x) => x.type === "Withdraw"), loanRepayments: sumBy((x) => x.type === "Loan Repayment"), disbursed: (db.loans || []).filter((l) => !l.voided).reduce((a, l) => a + (Number(l.loanAmount) || 0), 0) }
    };
  }
  /* Same shape every other report uses, so it prints on the SOB letterhead and exports to CSV like the rest. */
  function asReports(rep) {
    const R = (title, columns, rows, totals, labels) => ({ title, columns, rows, totals: totals || {}, labels: labels || {} });
    return [
      R("Reconciliation: per-member position as at " + D.toDisplay(rep.asOf), ["id", "name"].concat(rep.rows.some((r) => r.original !== null) ? ["original", "correction", "revised"] : []).concat(["deposits", "profitCredited", "withdrawals", "shareOuts", "otherMovements", "savings", "committed", "available", "loanPrincipal", "unpaidInterest", "loanOwed", "memoNet"]), rep.rows, Object.assign({}, rep.totals, rep.rows.some((r) => r.original !== null) ? { original: rep.rows.reduce((a, r) => a + (r.original || 0), 0), correction: rep.rows.reduce((a, r) => a + (r.correction || 0), 0), revised: rep.totals.savings } : {}), { original: "Original actual savings (before the approved decisions)", correction: "Approved corrections (35 decisions)", revised: "Revised actual savings", id: "ID", name: "Member", deposits: "Savings deposited", withdrawals: "Withdrawals", shareOuts: "Share-outs paid", otherMovements: "Other movements", savings: "Actual savings (after withdrawals and share-outs)", committed: "Guarantee commitments", available: "Available savings", profitCredited: "Profit credited", loanPrincipal: "Loan principal outstanding", unpaidInterest: "Unpaid interest", loanOwed: "Total loan owed", memoNet: "Memo: savings less loan owed (not used in any KPI)" }),
      R("Financial years (set by the actual share-outs)", ["label", "openedDate", "closedDate", "status", "opening", "deposits", "profit", "withdrawals", "shareOuts", "closing", "carriedForward"], rep.years.map((y) => Object.assign({}, y, { openedDate: D.toDisplay(y.openedDate), closedDate: y.closedDate ? D.toDisplay(y.closedDate) : "open", carriedForward: y.carriedForward === null ? "" : y.carriedForward })), {}, { label: "Year", openedDate: "Began", closedDate: "Share-out held", status: "Status", opening: "Opening (carried in)", deposits: "Savings deposited", profit: "Profit credited", withdrawals: "Withdrawals", shareOuts: "Share-outs paid", closing: "Closing", carriedForward: "Carried forward to next year" }),
      R("Profit reconciliation by financial year", ["label", "interestCharged", "interestReceived", "interestReceivable", "otherIncome", "expenses", "earnedRecorded", "profitCredited", "undistributed", "groupLedgerProfit", "verifiedProfit", "reservedFromYear"], rep.profit.map((p) => Object.assign({}, p, { verifiedProfit: p.verifiedProfit === null ? "not verified" : p.verifiedProfit })), { memberProfitCreditsAllYears: rep.profitCredited.total }, { label: "Year", interestCharged: "Loan interest charged", interestReceived: "Loan interest received", interestReceivable: "Interest receivable at year end", otherIncome: "Other income", expenses: "Expenses", earnedRecorded: "Profit earned (recorded)", profitCredited: "Profit credited to members", undistributed: "Undistributed (earned less credited)", groupLedgerProfit: "Group bank-ledger profit (archive)", verifiedProfit: "Verified by Chairperson", reservedFromYear: "Moved to General Reserve" }),
      R("Historical loan accounts (before the current loan register)", ["memberId", "member", "date", "registerAmount", "disbursed", "interestCharged", "interestReceived", "principalRepaid", "interestOutstanding", "principalOutstanding", "status", "evidence"], rep.histLoans, {}, { memberId: "ID", member: "Member", date: "Date", registerAmount: "Loan register amount", disbursed: "Disbursed (member sheet)", interestCharged: "Interest charged", interestReceived: "Interest received", principalRepaid: "Principal repaid", interestOutstanding: "Interest unpaid", principalOutstanding: "Principal unpaid", status: "Status", evidence: "Evidence" }),
      R("General Reserve Fund", ["label", "opening", "openingBalanceIntroduced", "transfers", "losses", "utilization", "closing"], rep.reserve.rows, { balance: rep.reserve.balance }, { label: "Year", opening: "Opening", openingBalanceIntroduced: "Opening balance recorded", transfers: "Verified profit transferred in", losses: "Verified losses reflected", utilization: "Utilised", closing: "Closing" }),
      R("Reconciliation: remaining differences (not adjusted, for the Chairperson)", ["item", "amount", "detail"], rep.remaining, { total: rep.remaining.length }, { item: "Item", amount: "UGX", detail: "Evidence" }),
      R("Reconciliation: control totals", ["name", "expected", "actual", "pass", "note"], rep.controls.map((c) => Object.assign({}, c, { pass: c.pass ? "OK" : "DIFFERENT" })), {}, { name: "Control", expected: "Source records", actual: "Platform", pass: "Result", note: "Note" }),
      R("Reconciliation: exceptions and open items", ["kind", "subject", "summary", "status", "decision"], rep.register, { total: rep.register.length }, { kind: "Kind", subject: "Subject", summary: "What is uncertain", status: "Status", decision: "Decision" })
    ];
  }
  return { PACK_KIND, validatePack, inspect, load, build, asReports, realNames };
});
