/* SOB core/fy — FINANCIAL YEARS are decided by the ACTUAL annual share-outs, never by calendar dates.
   SOB rule (Chairperson, consolidated instructions): each financial year closes at its approved annual share-out and the next begins immediately afterward
   (FY2026 began on 21 December 2025 - the day of the previous share-out). 31 December is never assumed.
   Boundary rule for a share-out day D: the share-out and any cash-out recorded on D belong to the year that is closing; every other entry dated D
   (e.g. the first savings of the new year) belongs to the new year. Savings not withdrawn at the share-out stay the member's property and carry forward.
   The registry is db.yearCycles (one record per year, kept for ever); this module only READS it, plus one idempotent, audited definition command. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./governance.js") : root.SOB.gov);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.fy = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, G) {
  const label = (y) => "FY" + y;
  const SETTLEMENT = ["Share-Out", "Withdraw"];                       // recorded on the share-out day itself they close the old year
  const table = (db) => (db.yearCycles || []).filter((c) => c && c.year).slice().sort((a, b) => a.year - b.year).map((c) => Object.assign({}, c, { id: label(c.year), label: label(c.year) }));
  const byYear = (db, y) => table(db).find((c) => c.year === Number(y)) || null;
  const current = (db) => { const t = table(db); return t.filter((c) => c.status !== "Closed").pop() || t[t.length - 1] || null; };

  /* The financial year a ledger entry belongs to. Null only when no years are registered yet. */
  function yearOfEntry(db, t, tb) {
    tb = tb || table(db); if (!tb.length) return null; const d = t.date;
    for (const c of tb) {
      const inside = d >= c.openedDate && (!c.closedDate || d < c.closedDate), settles = !!c.closedDate && d === c.closedDate && SETTLEMENT.includes(t.type);
      if (inside || settles) return c.year;
    }
    return d < tb[0].openedDate ? tb[0].year : tb[tb.length - 1].year;
  }
  const yearOfDate = (db, d) => yearOfEntry(db, { date: d, type: "Savings" });

  const eff = (t) => L.classifyTransaction(t).savings;
  /* BALANCE BROUGHT FORWARD (SOB policy): financial years are independent. Nothing is inherited automatically; a member's savings left after a share-out
     are part of the club's consolidated position unless an authorised officer deliberately records them as a Balance Brought Forward for the new year.
     Those records live in db.yearOpenings and NEVER change a ledger entry, a loan, a profit figure or a member's live savings total. */
  const openings = (db) => (db.yearOpenings || []).filter((o) => o && !o.voided);
  const openingOf = (db, year, memberId) => openings(db).filter((o) => Number(o.year) === Number(year) && o.memberId === memberId).reduce((a, o) => a + Number(o.amount), 0);
  /* The movements of every member inside each year (deposits, profit, withdrawals, share-outs, other), from the ledger only. */
  function movements(db, tb) {
    const mv = {}; L.activeTransactions(db).forEach((t) => {
      if (!t.memberId) return; const e = eff(t); if (!e) return; const y = yearOfEntry(db, t, tb); if (y === null) return;
      const r = ((mv[y] = mv[y] || {})[t.memberId] = mv[y][t.memberId] || { deposits: 0, profit: 0, withdrawals: 0, shareOuts: 0, other: 0 }), cyc = tb.find((c) => c.year === y);
      if (t.type === "Savings") r.deposits += e; else if (t.type === "Profit") r.profit += e; else if (t.type === "Withdraw" && cyc && cyc.closedDate && t.date === cyc.closedDate) r.shareOuts += -e;
      else if (t.type === "Withdraw" || t.type === "Bank Charge") r.withdrawals += -e; else if (t.type === "Share-Out") r.shareOuts += -e; else r.other += e;
    }); return mv;
  }
  const net = (r) => r.deposits + r.profit - r.withdrawals - r.shareOuts + r.other;
  /* One year at a time: opening = ONLY the recorded Balance Brought Forward; previousClosing = the year before's closing position (shown for information);
     notBroughtForward = the part of that closing that stays in the club's consolidated position; closing = opening + this year's own movements. */
  function position(db, year) {
    const tb = table(db), cyc = tb.find((c) => c.year === Number(year)); if (!cyc) throw new Error("NOT_FOUND: financial year " + year);
    const mv = movements(db, tb), zero = { deposits: 0, profit: 0, withdrawals: 0, shareOuts: 0, other: 0 };
    const closingIn = (y, id) => openingOf(db, y, id) + net(((mv[y] || {})[id]) || zero);
    const prev = tb.filter((c) => c.year < cyc.year).pop() || null;
    const ids = {}; (db.members || []).forEach((m) => { ids[m.id] = m.name; });
    const rows = Object.keys(ids).map((id) => {
      const m = ((mv[cyc.year] || {})[id]) || zero, opening = openingOf(db, cyc.year, id), previousClosing = prev ? closingIn(prev.year, id) : 0, closing = opening + net(m);
      return { memberId: id, name: ids[id], opening, previousClosing, notBroughtForward: previousClosing - opening, deposits: m.deposits, profit: m.profit, withdrawals: m.withdrawals, shareOuts: m.shareOuts, other: m.other, closing };
    }).filter((r) => r.opening || r.previousClosing || r.deposits || r.profit || r.withdrawals || r.shareOuts || r.other);
    const next = tb.find((c) => c.year === cyc.year + 1);
    rows.forEach((r) => { r.broughtForwardNext = next ? openingOf(db, next.year, r.memberId) : null; });
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    return { year: cyc.year, label: cyc.label, openedDate: cyc.openedDate, closedDate: cyc.closedDate || null, status: cyc.status, shareOutDate: cyc.closedDate || null, rows,
      totals: { opening: sum("opening"), previousClosing: sum("previousClosing"), notBroughtForward: sum("notBroughtForward"), deposits: sum("deposits"), profit: sum("profit"), withdrawals: sum("withdrawals"), shareOuts: sum("shareOuts"), other: sum("other"), closing: sum("closing"), broughtForwardNext: next ? sum("broughtForwardNext") : null } };
  }
  const summary = (db) => table(db).map((c) => { const p = position(db, c.year); return Object.assign({ year: c.year, label: c.label, openedDate: c.openedDate, closedDate: c.closedDate || null, status: c.status, basis: c.basis || "", evidence: c.evidence || "" }, p.totals); });
  /* One member across every financial year (for statements). */
  function memberYears(db, memberId) {
    return table(db).map((c) => { const r = position(db, c.year).rows.find((x) => x.memberId === memberId) || { opening: 0, previousClosing: 0, notBroughtForward: 0, deposits: 0, profit: 0, withdrawals: 0, shareOuts: 0, other: 0, closing: 0 };
      return { year: c.year, label: c.label, openedDate: c.openedDate, closedDate: c.closedDate || null, status: c.status, opening: r.opening, previousClosing: r.previousClosing, notBroughtForward: r.notBroughtForward, deposits: r.deposits, profit: r.profit, withdrawals: r.withdrawals, shareOuts: r.shareOuts, other: r.other, closing: r.closing }; });
  }
  /* Health: years are contiguous and the last year's closing equals the live savings total. */
  function check(db) {
    const tb = table(db), out = [];
    tb.forEach((c, i) => { if (i && tb[i - 1].closedDate !== c.openedDate) out.push("FY" + c.year + " does not begin on the day FY" + tb[i - 1].year + " closed"); if (c.status === "Closed" && !c.closedDate) out.push(c.label + " is closed without a share-out date"); });
    if (tb.length) { /* every year stands alone, so the years' own movements must add up to the live savings total */
      const all = tb.map((c) => position(db, c.year)), moved = all.reduce((a, p) => a + p.rows.reduce((x, r) => x + net(r), 0), 0), live = L.computeGroupTotals(db).groupSavings;
      if (moved !== live) out.push("the movements of all financial years (" + moved + ") differ from group savings (" + live + ")");
      all.forEach((p) => p.rows.forEach((r) => { if (r.opening < 0 || (r.opening > 0 && r.opening > r.previousClosing)) out.push(p.label + ": Balance Brought Forward for " + r.memberId + " (" + r.opening + ") is more than the previous year's closing (" + r.previousClosing + ")"); })); }
    return out;
  }

  /* DEFINE the years from the verified records (idempotent). list: [{year, openedDate, closedDate|null, evidence, basis}].
     A year already defined with the same dates is left alone; a different date is refused (a correction needs the Chairperson); the placeholder year
     created by the old migration (not yet "defined") is adopted. Closed years also get a historical share-out event built from the ledger entries on the day. */
  function defineFinancialYears(db, ctx, a) {
    G.require(ctx, "history.import"); a = a || {}; const list = (a.years || []).slice().sort((x, y) => x.year - y.year);
    if (!list.length) throw new Error("REQUIRED: years");
    list.forEach((y, i) => {
      if (!Number.isInteger(Number(y.year))) throw new Error("INVALID: year");
      if (!dates.isISO(y.openedDate)) throw new Error("INVALID: openedDate for FY" + y.year);
      if (y.closedDate && !dates.isISO(y.closedDate)) throw new Error("INVALID: closedDate for FY" + y.year);
      if (y.closedDate && y.closedDate <= y.openedDate) throw new Error("INVALID: FY" + y.year + " closes before it opens");
      if (i && list[i - 1].closedDate !== y.openedDate) throw new Error("INVALID: FY" + y.year + " must begin on the day FY" + list[i - 1].year + " closed (the share-out day)");
      if (i < list.length - 1 && !y.closedDate) throw new Error("INVALID: only the last year can be open");
      G.need(y.evidence, "evidence for FY" + y.year);
    });
    db.yearCycles = db.yearCycles || []; db.shareOutEvents = db.shareOutEvents || []; const out = { added: 0, adopted: 0, unchanged: 0, shareOutEvents: 0 };
    list.forEach((y) => {
      let c = db.yearCycles.find((x) => x.year === Number(y.year)); const want = { openedDate: y.openedDate, closedDate: y.closedDate || null, status: y.closedDate ? "Closed" : "Open" };
      if (!c) { c = Object.assign({ year: Number(y.year), shareOutId: null }, want, { defined: true, basis: y.basis || "", evidence: y.evidence, definedBy: ctx.by, definedAt: ctx.now }); db.yearCycles.push(c); out.added++; G.audit(db, ctx, "FinancialYear", label(c.year), "Defined", null, want, y.evidence); }
      else if (c.defined) { if (c.openedDate !== want.openedDate || (c.closedDate || null) !== want.closedDate) throw new Error("FY_DIFFERS: " + label(c.year) + " is already defined as " + c.openedDate + " to " + (c.closedDate || "open") + "; changing it needs a Chairperson-approved correction"); out.unchanged++; }
      else { const prev = { openedDate: c.openedDate, closedDate: c.closedDate, status: c.status }; Object.assign(c, want, { defined: true, basis: y.basis || "", evidence: y.evidence, definedBy: ctx.by, definedAt: ctx.now }); out.adopted++; G.audit(db, ctx, "FinancialYear", label(c.year), "Adopted from the verified records", prev, want, y.evidence); }
      if (c.closedDate && !db.shareOutEvents.some((e) => e.year === c.year)) {
        const on = L.activeTransactions(db).filter((t) => t.date === c.closedDate && SETTLEMENT.includes(t.type) && t.memberId), id = "SHO-" + label(c.year);
        db.shareOutEvents.push({ id, year: c.year, date: c.closedDate, executedBy: "Historical record", historical: true, evidence: y.evidence, entries: on.map((t) => ({ memberId: t.memberId, savingsWithdrawn: Number(t.amount), entryId: t.id, type: t.type })), totalWithdrawn: on.reduce((s, t) => s + Number(t.amount), 0), profit: { status: "SEPARATE", note: "Profit credited to members is recorded separately" } });
        if (!c.shareOutId) c.shareOutId = id; out.shareOutEvents++;
      }
    });
    return out;
  }
  /* RECORD a Balance Brought Forward: an officer deliberately opens a member's new year with (part of) what they held at the previous share-out.
     Needs evidence and a reason, may never exceed what the member's previous-year closing position still allows, and (see commands.js GATED) takes effect only
     when the Chairperson approves. It is a separate record: no ledger entry, loan, profit or live savings figure changes. */
  function recordBroughtForward(db, ctx, a) {
    G.require(ctx, "reconcile.manage"); a = a || {}; const year = Number(a.year), amount = Number(a.amount), tb = table(db), cyc = tb.find((c) => c.year === year);
    if (!cyc) throw new Error("NOT_FOUND: financial year " + a.year); const prev = tb.filter((c) => c.year < year).pop(); if (!prev) throw new Error("INVALID: the first recorded financial year has no previous year to bring a balance forward from");
    const m = (db.members || []).find((x) => x.id === a.memberId); if (!m) throw new Error("NOT_FOUND: member " + a.memberId);
    if (!(amount > 0) || !Number.isInteger(amount)) throw new Error("INVALID: amount must be a whole positive number of shillings");
    const evidence = G.need(a.evidence, "evidence (the minute or decision that approves this Balance Brought Forward)"), reason = G.need(a.reason, "reason");
    const row = position(db, year).rows.find((r) => r.memberId === a.memberId), room = row ? row.previousClosing - row.opening : 0;
    if (amount > room) throw new Error("EXCEEDS_PREVIOUS_CLOSING: " + a.memberId + " had " + (row ? row.previousClosing : 0) + " at the close of FY" + prev.year + " with " + (row ? row.opening : 0) + " already brought forward, so at most " + Math.max(0, room) + " can be brought forward");
    const e = { id: G.uid("BBF"), year, memberId: a.memberId, amount, date: cyc.openedDate, previousYear: prev.year, previousClosing: row ? row.previousClosing : 0, evidence, reason, recordedBy: ctx.by, authorisedBy: ctx.approvedBy || null, createdAt: ctx.now };
    (db.yearOpenings = db.yearOpenings || []).push(e); G.audit(db, ctx, "BalanceBroughtForward", e.id, "Balance Brought Forward recorded", null, { year, memberId: e.memberId, amount }, reason + " | evidence: " + evidence); return e;
  }
  function voidBroughtForward(db, ctx, a) {
    G.require(ctx, "reconcile.manage"); a = a || {}; const e = (db.yearOpenings || []).find((x) => x.id === a.id && !x.voided); if (!e) throw new Error("NOT_FOUND: Balance Brought Forward " + a.id);
    const reason = G.need(a.reason, "reason"); e.voided = true; e.voidReason = reason; e.voidedBy = ctx.by; e.voidedAt = ctx.now;
    G.audit(db, ctx, "BalanceBroughtForward", e.id, "Balance Brought Forward voided", { amount: e.amount }, { voided: true }, reason); return e;
  }
  return { recordBroughtForward, voidBroughtForward, openings, openingOf, label, table, byYear, current, yearOfEntry, yearOfDate, position, summary, memberYears, check, defineFinancialYears, SETTLEMENT };
});
