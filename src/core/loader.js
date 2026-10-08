/* SOB core/loader — loads the VERIFIED SOB records pack into the live ledger through the server's own audited actions.
   Runs in the browser (Admin screen) and in Node (tests) from the same code: everything goes through `api(body) -> parsed JSON` (the signed-in Admin session).
   Rules it keeps: nothing is invented or altered to force a balance; uncertain rows stay in the reconciliation register; running it twice adds nothing
   (legacy ledger only into an empty ledger; history is idempotent by sourceRef; register items by subject; corrections by request/target);
   cumulative savings and available savings (savings less guarantee commitments) are reported separately and a loan is NEVER netted off savings. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const dep = (n, f) => (isNode ? require("./" + f) : root.SOB[n]);
  const api = factory(dep("dates", "dates.js"), dep("ledger", "ledger.js"), dep("migrate", "migrate.js"), dep("integrity", "integrity.js"));
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.loader = api; }
})(typeof self !== "undefined" ? self : this, function (D, L, M, I) {
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
      const reqs = db.approvalRequests || [], targetOf = (s) => s.args.loanId || s.args.id;
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
      return { id: m.id, name: m.name, deposits: money(dep), withdrawals: money(wd), shareOuts: money(so), otherMovements: money(pos.savings - (dep + profit - wd - so)), savings: money(pos.savings), committed: money(pos.committed), available: money(pos.available), profitCredited: money(profit), loanPrincipal: money(principal), unpaidInterest: money(unpaidInterest), loanOwed: money(owed), memoNet: money(pos.savings - owed), historyRows: active.filter((t) => t.memberId === m.id && t.historical).length };
    });
    const tot = (k) => rows.reduce((a, r) => a + r[k], 0), g = L.computeGroupTotals(db, asOf), reg = db.discrepancies || [];
    const hist = active.filter((t) => t.historical), byType = {}; hist.forEach((t) => { const b = (byType[t.type] = byType[t.type] || { count: 0, sum: 0 }); b.count++; b.sum += t.amount; });
    const ctl = pack.controls || {}, t = [];
    const add = (name, expected, actual, note) => t.push({ name, expected, actual, pass: expected === actual, note: note || "" });
    add("Members in the Sheet", ctl.members, db.members.length);
    const legacyIds = new Set((pack.legacy.transactions || []).map((x) => x.id));
    add("Current-record transactions (original ids still in the ledger)", ctl.legacyTransactions, db.transactions.filter((x) => legacyIds.has(x.id)).length, "a voided original stays in the ledger, marked void");
    add("Historical rows imported", ctl.historyEntries, hist.length);
    Object.keys(ctl.historyByType || {}).forEach((k) => { add("Historical " + k + " (count)", ctl.historyByType[k].count, (byType[k] || {}).count || 0); add("Historical " + k + " (UGX)", ctl.historyByType[k].sum, (byType[k] || {}).sum || 0); });
    add("Open exceptions in the register (historical rows held)", ctl.heldExceptions, reg.filter((d) => d.status === "Open" && d.kind === "MISSING_ENTRY").length);
    return {
      asOf, rows, totals: { deposits: tot("deposits"), withdrawals: tot("withdrawals"), shareOuts: tot("shareOuts"), otherMovements: tot("otherMovements"), savings: tot("savings"), committed: tot("committed"), available: tot("available"), profitCredited: tot("profitCredited"), loanPrincipal: tot("loanPrincipal"), unpaidInterest: tot("unpaidInterest"), loanOwed: tot("loanOwed"), memoNet: tot("memoNet") },
      group: g, historyByType: byType, controls: t, register: reg.map((d) => ({ kind: d.kind, subject: d.subject, summary: d.summary, status: d.status, decision: d.decision || "" })),
      negative: rows.filter((r) => r.savings < 0).map((r) => r.id + " " + r.name), missing: pack.missing || [], decisions: pack.decisions || [],
      contributions: { deposits: sumBy((x) => x.type === "Savings"), withdrawals: sumBy((x) => x.type === "Withdraw"), loanRepayments: sumBy((x) => x.type === "Loan Repayment"), disbursed: (db.loans || []).filter((l) => !l.voided).reduce((a, l) => a + (Number(l.loanAmount) || 0), 0) }
    };
  }
  /* Same shape every other report uses, so it prints on the SOB letterhead and exports to CSV like the rest. */
  function asReports(rep) {
    const R = (title, columns, rows, totals, labels) => ({ title, columns, rows, totals: totals || {}, labels: labels || {} });
    return [
      R("Reconciliation: per-member position as at " + D.toDisplay(rep.asOf), ["id", "name", "deposits", "profitCredited", "withdrawals", "shareOuts", "otherMovements", "savings", "committed", "available", "loanPrincipal", "unpaidInterest", "loanOwed", "memoNet"], rep.rows, rep.totals, { id: "ID", name: "Member", deposits: "Savings deposited", withdrawals: "Withdrawals", shareOuts: "Share-outs paid", otherMovements: "Other movements", savings: "Actual savings (after withdrawals and share-outs)", committed: "Guarantee commitments", available: "Available savings", profitCredited: "Profit credited", loanPrincipal: "Loan principal outstanding", unpaidInterest: "Unpaid interest", loanOwed: "Total loan owed", memoNet: "Memo: savings less loan owed (not used in any KPI)" }),
      R("Reconciliation: control totals", ["name", "expected", "actual", "pass", "note"], rep.controls.map((c) => Object.assign({}, c, { pass: c.pass ? "OK" : "DIFFERENT" })), {}, { name: "Control", expected: "Source records", actual: "Platform", pass: "Result", note: "Note" }),
      R("Reconciliation: exceptions and open items", ["kind", "subject", "summary", "status", "decision"], rep.register, { total: rep.register.length }, { kind: "Kind", subject: "Subject", summary: "What is uncertain", status: "Status", decision: "Decision" })
    ];
  }
  return { PACK_KIND, validatePack, inspect, load, build, asReports, realNames };
});
