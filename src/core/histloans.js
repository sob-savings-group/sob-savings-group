/* SOB core/histloans — HISTORICAL LOAN ACCOUNTS (loans taken and repaid before the current loan register began on 21 Dec 2025).
   They are kept apart from the live loan book (db.loans), so they can never change today's loans owed, guarantees or dashboard exposure, yet every
   disbursement, interest charge and repayment is a dated, sourced, auditable record:
     db.historicalLoans      one record per loan account (member, register reference, evidence, optional dated component disbursements)
     db.loanInterestRecords  interest CHARGED on a historical loan (never a savings withdrawal)
     db.transactions         "Historical Loan Disbursement" / "Historical Loan Repayment" rows (historical:true, sourceRef; zero effect on savings and cash)
   Nothing is invented: an account exists only where the loan register / member sheets / the Chairperson's decision register show it. Repayments are
   allocated INTEREST FIRST, oldest loan first (SOB rule); a payment that exceeds what is due is kept visible as "excess", never dropped or hidden.
   The allocation is DERIVED from the stored facts every time, so voiding a record re-computes it and nothing is stored twice. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./governance.js") : root.SOB.gov);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.histloans = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, G) {
  const DISB = "Historical Loan Disbursement", REPAY = "Historical Loan Repayment", KINDS = ["DISBURSEMENT", "INTEREST", "REPAYMENT"];
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36).toUpperCase().padStart(7, "0"); };
  const idFor = (p, ref) => p + "-" + hash(ref) + hash(ref.split("").reverse().join(""));
  const loanIdFor = (key) => idFor("HLN", "loan:" + key);
  const live = (x) => x && !x.voided;
  const loansOf = (db, memberId) => (db.historicalLoans || []).filter((l) => live(l) && (!memberId || l.memberId === memberId)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));

  /* args: {batchId, source, accounts:[{key,memberId,date,registerDate?,registerAmount?,registerRef,evidence,note?}],
            events:[{kind, loanKey|loanKeys, memberId, date, amount, sourceRef, decisionNo?, note?, component?}], dryRun} */
  function importHistoricalLoans(db, ctx, a) {
    G.require(ctx, "history.import"); a = a || {};
    const batchId = G.need(a.batchId, "batchId"), source = G.need(a.source, "source");
    const accounts = Array.isArray(a.accounts) ? a.accounts : [], events = Array.isArray(a.events) ? a.events : [];
    if (!accounts.length && !events.length) throw new Error("REQUIRED: accounts or events");
    const members = new Set(db.members.map((m) => m.id)), haveLoan = new Map((db.historicalLoans || []).map((l) => [l.key, l]));
    const haveRef = new Set(db.transactions.filter((t) => t.sourceRef).map((t) => t.sourceRef)); (db.loanInterestRecords || []).forEach((r) => haveRef.add(r.sourceRef));
    const out = { batchId, accountsAdded: 0, accountsAlready: 0, disbursements: 0, interestRecords: 0, repayments: 0, alreadyImported: 0, rejected: [], dryRun: !!a.dryRun, sum: { disbursed: 0, interestCharged: 0, repaid: 0 } };
    const bad = (why, x) => out.rejected.push({ why, ref: x && (x.sourceRef || x.key) });
    const newAccounts = [], seenKey = new Set();
    accounts.forEach((x) => {
      if (!x || !x.key) return bad("account key required", x); if (!members.has(x.memberId)) return bad("unknown member " + x.memberId, x); if (!dates.isISO(x.date)) return bad("account date must be YYYY-MM-DD", x);
      if (!x.evidence) return bad("account evidence required", x); if (seenKey.has(x.key)) return bad("duplicate account key in batch", x); seenKey.add(x.key);
      if (haveLoan.has(x.key)) { out.accountsAlready++; return; } newAccounts.push(x);
    });
    const keys = new Set([...haveLoan.keys(), ...newAccounts.map((x) => x.key)]), toAdd = [], seenRef = new Set();
    events.forEach((e) => {
      if (!e || !e.sourceRef) return bad("sourceRef required", e); if (!KINDS.includes(e.kind)) return bad("kind must be one of " + KINDS.join("/"), e);
      if (!members.has(e.memberId)) return bad("unknown member " + e.memberId, e); if (e.dateUnknown) { if (!dates.isISO(e.dateAfter)) return bad("dateUnknown events need dateAfter (the last dated source row before it)", e); e.date = e.dateAfter; } if (!dates.isISO(e.date)) return bad("date must be YYYY-MM-DD", e); if (!(Number(e.amount) > 0)) return bad("amount must be positive", e);
      if (e.kind !== "REPAYMENT" && !keys.has(e.loanKey)) return bad("unknown loan " + e.loanKey, e);
      if (e.kind === "REPAYMENT" && (e.loanKeys || []).some((k) => !keys.has(k))) return bad("unknown loan in loanKeys", e);
      if (haveRef.has(e.sourceRef)) { out.alreadyImported++; return; } if (seenRef.has(e.sourceRef)) return bad("duplicate sourceRef inside batch", e); seenRef.add(e.sourceRef); toAdd.push(e);
    });
    if (out.rejected.length) throw new Error("INVALID: " + out.rejected.length + " row(s) rejected, nothing imported: " + JSON.stringify(out.rejected.slice(0, 3)));
    out.accountsAdded = newAccounts.length;
    toAdd.forEach((e) => { const amt = Number(e.amount); if (e.kind === "DISBURSEMENT") { out.disbursements++; out.sum.disbursed += amt; } else if (e.kind === "INTEREST") { out.interestRecords++; out.sum.interestCharged += amt; } else { out.repayments++; out.sum.repaid += amt; } });
    if (a.dryRun) return out;
    db.historicalLoans = db.historicalLoans || []; db.loanInterestRecords = db.loanInterestRecords || [];
    newAccounts.forEach((x) => {
      const m = db.members.find((y) => y.id === x.memberId);
      db.historicalLoans.push({ id: loanIdFor(x.key), key: x.key, memberId: x.memberId, memberName: m.name, date: x.date, registerDate: x.registerDate || "", registerAmount: x.registerAmount === undefined ? null : Number(x.registerAmount), registerRef: x.registerRef || "", evidence: String(x.evidence), note: x.note || "", registerCorrection: x.registerCorrection || undefined, historical: true, batchId, source, recordedBy: ctx.by, recordedAt: ctx.now });
      G.audit(db, ctx, "HistoricalLoan", loanIdFor(x.key), "Recorded", null, { memberId: x.memberId, date: x.date, registerRef: x.registerRef || "" }, String(x.evidence).slice(0, 300));
    });
    toAdd.forEach((e) => {
      const m = db.members.find((y) => y.id === e.memberId), amt = Number(e.amount), base = { memberId: e.memberId, memberName: m.name, date: e.date, amount: amt, historical: true, historicalLoan: true, sourceRef: e.sourceRef, batchId, source, decisionNo: e.decisionNo === undefined ? undefined : e.decisionNo, note: e.note || undefined, dateUnknown: e.dateUnknown ? true : undefined, dateAfter: e.dateUnknown ? e.dateAfter : undefined };
      if (e.kind === "INTEREST") db.loanInterestRecords.push(Object.assign({ id: idFor("LIR", e.sourceRef), loanId: loanIdFor(e.loanKey), kind: "CHARGED", recordedBy: ctx.by, recordedAt: ctx.now }, base, { historicalLoan: undefined }));
      else if (e.kind === "DISBURSEMENT") db.transactions.push(Object.assign({ id: idFor("HIS", e.sourceRef), type: DISB, purpose: "Historical loan paid out", histLoanId: loanIdFor(e.loanKey), approvalStatus: "Approved", approvedBy: ctx.by, approvedAt: ctx.now, createdBy: ctx.by, createdByRole: ctx.role, createdAt: ctx.now }, base));
      else db.transactions.push(Object.assign({ id: idFor("HIS", e.sourceRef), type: REPAY, purpose: "Historical loan repayment", histLoanIds: (e.loanKeys || []).map(loanIdFor), approvalStatus: "Approved", approvedBy: ctx.by, approvedAt: ctx.now, createdBy: ctx.by, createdByRole: ctx.role, createdAt: ctx.now }, base));
    });
    if (newAccounts.length || toAdd.length) G.audit(db, ctx, "HistoricalLoanImport", batchId, "Imported", null, { accounts: out.accountsAdded, disbursements: out.disbursements, interest: out.interestRecords, repayments: out.repayments, sum: out.sum }, "Historical loan accounts from the loan register, member sheets and the Chairperson's decision register; nothing posted without a source reference");
    return out;
  }

  /* The walk: every event of one member in date order (disbursement, interest charge, then repayment on the same day), repayments allocated interest first, oldest loan first. */
  const RANK = { D: 0, I: 1, R: 2 };
  function walk(db, memberId, asOf) {
    asOf = asOf || "9999-12-31"; const loans = loansOf(db, memberId), st = {}; loans.forEach((l) => { st[l.id] = { id: l.id, disbursed: 0, charged: 0, interestPaid: 0, principalPaid: 0, components: [], charges: [], payments: [] }; });
    const ev = [];
    L.activeTransactions(db).filter((t) => t.memberId === memberId && (t.type === DISB || t.type === REPAY) && t.date <= asOf).forEach((t) => ev.push({ r: t.type === DISB ? RANK.D : RANK.R, date: t.date, ref: t.sourceRef || t.id, t }));
    (db.loanInterestRecords || []).filter((x) => live(x) && x.memberId === memberId && x.date <= asOf).forEach((x) => ev.push({ r: RANK.I, date: x.date, ref: x.sourceRef || x.id, x }));
    ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.r - b.r || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)));
    const steps = []; let excess = 0;
    ev.forEach((e) => {
      if (e.r === RANK.D) { const s = st[e.t.histLoanId]; if (s) { s.disbursed += Number(e.t.amount); s.components.push({ date: e.t.date, amount: Number(e.t.amount), ref: e.t.sourceRef, decisionNo: e.t.decisionNo }); } }
      else if (e.r === RANK.I) { const s = st[e.x.loanId]; if (s) { s.charged += Number(e.x.amount); s.charges.push({ date: e.x.date, amount: Number(e.x.amount), ref: e.x.sourceRef, decisionNo: e.x.decisionNo }); } }
      else {
        let amt = Number(e.t.amount); const parts = [], only = (e.t.histLoanIds || []);
        loans.filter((l) => !only.length || only.includes(l.id)).forEach((l) => { const s = st[l.id]; if (amt <= 0) return;
          const di = Math.min(amt, Math.max(0, s.charged - s.interestPaid)); s.interestPaid += di; amt -= di;
          const dp = Math.min(amt, Math.max(0, s.disbursed - s.principalPaid)); s.principalPaid += dp; amt -= dp;
          if (di || dp) { parts.push({ loanId: l.id, interest: di, principal: dp }); s.payments.push({ date: e.t.date, entryId: e.t.id, interest: di, principal: dp }); } });
        if (amt > 0) excess += amt;
        steps.push({ entryId: e.t.id, date: e.t.date, amount: Number(e.t.amount), parts, excess: amt > 0 ? amt : 0, decisionNo: e.t.decisionNo, sourceRef: e.t.sourceRef, dateUnknown: !!e.t.dateUnknown });
      }
    });
    return { states: st, steps, excess, loans };
  }

  /* Approved write-offs (Chairperson, with evidence). The PRINCIPAL part is a group loss; written-off interest was never counted as earned, so it is not a further loss. */
  const writeOffsOf = (db, loanId, asOf) => (db.historicalWriteOffs || []).filter((x) => live(x) && x.loanId === loanId && (!asOf || x.date <= asOf));
  function recordWriteOff(db, ctx, a) {
    G.require(ctx, "reserve.manage"); a = a || {}; const loan = (db.historicalLoans || []).find((l) => l.id === a.loanId && live(l)); if (!loan) throw new Error("NOT_FOUND: historical loan " + a.loanId);
    const principal = Number(a.principal) || 0, interest = Number(a.interest) || 0; if (principal < 0 || interest < 0 || principal + interest <= 0) throw new Error("INVALID: a write-off needs a positive principal and/or interest amount");
    G.need(a.evidence, "evidence"); G.need(a.reason, "reason"); const date = a.date || ctx.today; if (!dates.isISO(date)) throw new Error("INVALID: date must be YYYY-MM-DD");
    const p = position(db, loan.id, "9999-12-31");
    if (principal > p.principalOutstanding) throw new Error("EXCEEDS_BALANCE: principal outstanding is only " + p.principalOutstanding); if (interest > p.interestOutstanding) throw new Error("EXCEEDS_BALANCE: interest outstanding is only " + p.interestOutstanding);
    const rec = { id: G.uid("HWO"), loanId: loan.id, memberId: loan.memberId, date, principal, interest, lossYear: a.lossYear === undefined ? null : Number(a.lossYear), evidence: a.evidence, reason: a.reason, approvedBy: ctx.approvedBy || ctx.by, recordedBy: ctx.by, recordedAt: ctx.now };
    (db.historicalWriteOffs = db.historicalWriteOffs || []).push(rec);
    G.audit(db, ctx, "HistoricalLoan", loan.id, "Written off (approved)", { outstanding: p.outstanding }, { principal, interest, lossYear: rec.lossYear }, a.reason + " | evidence: " + a.evidence);
    return rec;
  }
  /* Approved SAVINGS OFFSET: the member's own savings repay (part of) a historical loan, interest first. Two linked entries: Savings Offset (savings fall, no cash) + Historical Loan Repayment. Never more than the savings held or the loan outstanding. */
  function offsetHistoricalLoan(db, ctx, a) {
    G.require(ctx, "reconcile.manage"); a = a || {}; const loan = (db.historicalLoans || []).find((l) => l.id === a.loanId && live(l)); if (!loan) throw new Error("NOT_FOUND: historical loan " + a.loanId);
    const amt = Number(a.amount), date = a.date || ctx.today; if (!(amt > 0)) throw new Error("INVALID: amount must be positive"); if (!dates.isISO(date)) throw new Error("INVALID: date must be YYYY-MM-DD");
    G.need(a.evidence, "evidence"); G.need(a.reason, "reason"); const m = db.members.find((x) => x.id === loan.memberId);
    if (amt > L.memberSavingsAsOf(db, loan.memberId, date)) throw new Error("INSUFFICIENT_SAVINGS: the member holds " + L.memberSavingsAsOf(db, loan.memberId, date) + " on " + date);
    const p = position(db, loan.id, "9999-12-31"); if (amt > p.outstanding) throw new Error("EXCEEDS_BALANCE: the loan outstanding is only " + p.outstanding);
    const link = G.uid("OFS"), stamp = { approvalStatus: "Approved", approvedBy: ctx.approvedBy || ctx.by, approvedAt: ctx.now, createdBy: ctx.by, createdByRole: ctx.role, createdAt: ctx.now, memberId: loan.memberId, memberName: m.name, date, amount: amt, offsetId: link, evidence: a.evidence };
    const sav = Object.assign({ id: G.uid("TXN"), type: "Savings Offset", purpose: "Savings offset against historical loan " + loan.id + " | " + a.reason, offsetLoanId: loan.id }, stamp);
    const rep = Object.assign({ id: G.uid("TXN"), type: REPAY, purpose: "Historical loan repayment by savings offset | " + a.reason, histLoanIds: [loan.id], historical: true, historicalLoan: true, sourceRef: "OFFSET|" + link }, stamp);
    db.transactions.push(sav, rep);
    G.audit(db, ctx, "HistoricalLoan", loan.id, "Savings offset (approved)", { outstanding: p.outstanding, savings: L.memberSavingsAsOf(db, loan.memberId, date) + amt }, { offset: amt, savingsEntry: sav.id, repaymentEntry: rep.id }, a.reason + " | evidence: " + a.evidence);
    return { offsetId: link, savingsEntry: sav, repaymentEntry: rep };
  }
  /* Position of one historical loan as at a date. */
  function position(db, loanId, asOf) {
    const l = (db.historicalLoans || []).find((x) => x.id === loanId); if (!l) throw new Error("NOT_FOUND: historical loan " + loanId);
    const w = walk(db, l.memberId, asOf), s = w.states[loanId], wo = writeOffsOf(db, loanId, asOf), woP = wo.reduce((a, x) => a + x.principal, 0), woI = wo.reduce((a, x) => a + x.interest, 0);
    const iOut = s.charged - s.interestPaid - woI, pOut = s.disbursed - s.principalPaid - woP, out = iOut + pOut;
    return { loan: l, disbursed: s.disbursed, interestCharged: s.charged, interestReceived: s.interestPaid, principalRepaid: s.principalPaid, writtenOffPrincipal: woP, writtenOffInterest: woI, interestOutstanding: iOut, principalOutstanding: pOut,
      outstanding: out, components: s.components, charges: s.charges, payments: s.payments, writeOffs: wo, status: out <= 0 && s.disbursed > 0 ? (woP + woI > 0 ? "Written off" : "Settled") : "Open" };
  }
  /* Everything in a financial year [from, to): charged / received are counted by the date of the interest record / the repayment. */
  function periodFigures(db, from, to) {
    const inP = (d) => (!from || d >= from) && (!to || d < to), r = { interestCharged: 0, interestReceived: 0, principalRepaid: 0, disbursed: 0, repaid: 0, excess: 0 };
    (db.loanInterestRecords || []).filter((x) => live(x) && inP(x.date)).forEach((x) => { r.interestCharged += Number(x.amount); });
    L.activeTransactions(db).filter((t) => t.type === DISB && inP(t.date)).forEach((t) => { r.disbursed += Number(t.amount); });
    const mem = [...new Set((db.historicalLoans || []).map((l) => l.memberId))];
    mem.forEach((m) => { const w = walk(db, m); w.steps.filter((x) => inP(x.date)).forEach((x) => { r.repaid += x.amount; r.excess += x.excess; x.parts.forEach((p) => { r.interestReceived += p.interest; r.principalRepaid += p.principal; }); }); });
    return r;
  }
  /* Unpaid at a date, across all historical loans (for the receivable at a year end). */
  function outstandingAt(db, asOf, from, to) {
    const r = { interest: 0, principal: 0, loans: 0 };
    (db.historicalLoans || []).filter(live).filter((l) => (!from || l.date >= from) && (!to || l.date < to)).forEach((l) => { const p = position(db, l.id, asOf); if (p.outstanding > 0) { r.interest += p.interestOutstanding; r.principal += p.principalOutstanding; r.loans++; } });
    return r;
  }
  return { DISB, REPAY, idFor, loanIdFor, loansOf, importHistoricalLoans, writeOffsOf, recordWriteOff, offsetHistoricalLoan, walk, position, periodFigures, outstandingAt };
});
