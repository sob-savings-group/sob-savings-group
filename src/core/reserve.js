/* SOB core/reserve — the SOB GENERAL RESERVE FUND.
   It belongs to SOB collectively, never to individual members, and it is fed ONLY by verified group profit that is still unallocated after the approved
   distributions of a financial year. It can never receive members' savings, nor profit that has been approved for members but not yet collected.
   Every movement (opening balance, transfer in, utilisation) needs supporting evidence, is initiated by the Super Admin and takes effect only when the
   Chairperson approves (see commands.js GATED); each is audited, dated and kept for ever. Nothing here touches a member's savings entry. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./governance.js") : root.SOB.gov, isNode ? require("./fy.js") : root.SOB.fy);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.reserve = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, G, FY) {
  const KINDS = ["OPENING", "TRANSFER", "UTILIZATION"];
  const live = (db) => (db.reserveFund || []).filter((e) => e && !e.voided).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const sign = (e) => (e.kind === "UTILIZATION" ? -1 : 1) * Number(e.amount);
  const balance = (db, asOf) => live(db).filter((e) => !asOf || e.date <= asOf).reduce((a, e) => a + sign(e), 0);
  const yearOf = (db, d) => FY.yearOfDate(db, d);

  /* Profit still free to move into the reserve for a year: the Chairperson-verified group profit, less what was credited to members, less what is
     already reserved, less any distribution that is approved/pending but not yet posted. Zero until the year's profit has been verified. */
  function available(db, year) {
    const c = FY.byYear(db, year); if (!c) throw new Error("NOT_FOUND: financial year " + year);
    const verified = c.verifiedProfit === undefined || c.verifiedProfit === null ? null : Number(c.verifiedProfit);
    const credited = L.activeTransactions(db).filter((t) => t.type === "Profit" && FY.yearOfEntry(db, t) === c.year).reduce((a, t) => a + Number(t.amount), 0);
    const moved = live(db).filter((e) => e.kind === "TRANSFER" && Number(e.fyYear) === c.year).reduce((a, e) => a + Number(e.amount), 0);
    const pending = (db.approvalRequests || []).filter((r) => r.status === "Pending" && r.command === "distributeProfit" && r.schedule).reduce((a, r) => a + Number(r.schedule.distributed || 0), 0);
    return { year: c.year, verified, credited, transferred: moved, pendingDistributions: pending, available: verified === null ? 0 : Math.max(0, verified - credited - moved - pending) };
  }
  const base = (db, ctx, kind, a) => {
    G.require(ctx, "reserve.manage"); a = a || {}; const amount = Number(a.amount);
    if (!(amount > 0)) throw new Error("INVALID: amount must be a positive number"); if (!dates.isISO(a.date)) throw new Error("INVALID: date must be YYYY-MM-DD");
    const evidence = G.need(a.evidence, "evidence (the document or minute that supports this reserve movement)"), reason = G.need(a.reason, "reason");
    return { id: G.uid("RSV"), kind, date: a.date, amount, evidence, reason, fyYear: yearOf(db, a.date), postedYear: yearOf(db, a.date), requestedBy: ctx.by, authorisedBy: ctx.approvedBy || null, createdAt: ctx.now };
  };
  function openReserve(db, ctx, a) {
    if (live(db).some((e) => e.kind === "OPENING")) throw new Error("ALREADY_OPENED: the reserve already has an opening balance");
    const e = base(db, ctx, "OPENING", a); (db.reserveFund = db.reserveFund || []).push(e);
    G.audit(db, ctx, "ReserveFund", e.id, "Opening balance recorded", null, { amount: e.amount, date: e.date }, e.reason + " | evidence: " + e.evidence); return e;
  }
  function transferToReserve(db, ctx, a) {
    a = a || {}; const e = base(db, ctx, "TRANSFER", a); const year = Number(a.year || e.fyYear), av = available(db, year);
    if (av.verified === null) throw new Error("NOT_VERIFIED: the group profit of FY" + year + " has not been verified by the Chairperson, so nothing can be moved to the reserve yet");
    if (e.amount > av.available) throw new Error("EXCEEDS_UNALLOCATED_PROFIT: only " + av.available + " of verified profit is left unallocated for FY" + year + " (verified " + av.verified + ", credited to members " + av.credited + ", already reserved " + av.transferred + (av.pendingDistributions ? ", approved distribution not yet posted " + av.pendingDistributions : "") + ")");
    e.fyYear = year; e.source = "Verified unallocated group profit of FY" + year; (db.reserveFund = db.reserveFund || []).push(e);
    G.audit(db, ctx, "ReserveFund", e.id, "Transfer to reserve", { available: av.available }, { amount: e.amount, fy: "FY" + year }, e.reason + " | evidence: " + e.evidence); return e;
  }
  function utilizeReserve(db, ctx, a) {
    a = a || {}; const e = base(db, ctx, "UTILIZATION", a), bal = balance(db); G.need(a.purpose, "purpose");
    if (e.amount > bal) throw new Error("INSUFFICIENT_RESERVE: the reserve holds " + bal);
    e.purpose = String(a.purpose).trim(); (db.reserveFund = db.reserveFund || []).push(e);
    G.audit(db, ctx, "ReserveFund", e.id, "Reserve utilised", { balance: bal }, { amount: e.amount, purpose: e.purpose }, e.reason + " | evidence: " + e.evidence); return e;
  }
  /* The Chairperson's confirmation of the GROUP profit earned in a year (the figure the reserve rules rely on). It is never computed on its own authority. */
  function confirmProfit(db, ctx, a) {
    G.require(ctx, "reserve.manage"); a = a || {}; const c = FY.byYear(db, a.year); if (!c) throw new Error("NOT_FOUND: financial year " + a.year);
    const amount = Number(a.amount); if (!(amount >= 0)) throw new Error("INVALID: amount must be zero or more"); const evidence = G.need(a.evidence, "evidence"), reason = G.need(a.reason, "reason");
    const rec = (db.yearCycles || []).find((x) => x.year === c.year), prev = rec.verifiedProfit === undefined ? null : rec.verifiedProfit;
    rec.verifiedProfit = amount; rec.verifiedProfitEvidence = evidence; rec.verifiedBy = ctx.approvedBy || ctx.by; rec.verifiedAt = ctx.now;
    (rec.verifiedProfitHistory = rec.verifiedProfitHistory || []).push({ at: ctx.now, by: ctx.approvedBy || ctx.by, previous: prev, amount, evidence, reason });
    G.audit(db, ctx, "FinancialYear", "FY" + c.year, "Group profit verified", { verifiedProfit: prev }, { verifiedProfit: amount }, reason + " | evidence: " + evidence); return rec;
  }
  /* Per financial year: opening, transfers in, utilisation, closing. The reserve carries forward from year to year like savings do. */
  function statement(db) {
    const tb = FY.table(db), es = live(db); let carry = 0; const rows = [];
    const yr = (e) => (e.postedYear === undefined ? e.fyYear : e.postedYear), years = tb.length ? tb.map((c) => c.year) : [...new Set(es.map(yr))].sort();
    years.forEach((y) => { const of = es.filter((e) => Number(yr(e)) === y), op = of.filter((e) => e.kind === "OPENING").reduce((a, e) => a + Number(e.amount), 0), tr = of.filter((e) => e.kind === "TRANSFER").reduce((a, e) => a + Number(e.amount), 0), ut = of.filter((e) => e.kind === "UTILIZATION").reduce((a, e) => a + Number(e.amount), 0);
      rows.push({ year: y, label: "FY" + y, opening: carry, openingBalanceIntroduced: op, transfers: tr, utilization: ut, closing: carry + op + tr - ut }); carry += op + tr - ut; });
    return { rows, balance: carry, entries: es };
  }
  return { KINDS, live, balance, available, openReserve, transferToReserve, utilizeReserve, confirmProfit, statement };
});
