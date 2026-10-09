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
  /* Opening, movements, closing and the balance carried forward for every member in one financial year. */
  function position(db, year) {
    const tb = table(db), cyc = tb.find((c) => c.year === Number(year)); if (!cyc) throw new Error("NOT_FOUND: financial year " + year);
    const per = {}; (db.members || []).forEach((m) => { per[m.id] = { memberId: m.id, name: m.name, opening: 0, deposits: 0, profit: 0, withdrawals: 0, shareOuts: 0, other: 0, closing: 0 }; });
    L.activeTransactions(db).forEach((t) => {
      if (!t.memberId || !per[t.memberId]) return; const e = eff(t); if (!e) return; const y = yearOfEntry(db, t, tb), r = per[t.memberId];
      if (y < cyc.year) r.opening += e;
      else if (y === cyc.year) { if (t.type === "Savings") r.deposits += e; else if (t.type === "Profit") r.profit += e; else if (t.type === "Withdraw" || t.type === "Bank Charge") r.withdrawals += -e; else if (t.type === "Share-Out") r.shareOuts += -e; else r.other += e; }
    });
    const rows = Object.keys(per).map((k) => per[k]).filter((r) => r.opening || r.deposits || r.profit || r.withdrawals || r.shareOuts || r.other);
    rows.forEach((r) => { r.closing = r.opening + r.deposits + r.profit - r.withdrawals - r.shareOuts + r.other; r.carriedForward = cyc.status === "Closed" ? r.closing : null; });
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    return { year: cyc.year, label: cyc.label, openedDate: cyc.openedDate, closedDate: cyc.closedDate || null, status: cyc.status, shareOutDate: cyc.closedDate || null, rows,
      totals: { opening: sum("opening"), deposits: sum("deposits"), profit: sum("profit"), withdrawals: sum("withdrawals"), shareOuts: sum("shareOuts"), other: sum("other"), closing: sum("closing"), carriedForward: cyc.status === "Closed" ? sum("closing") : null } };
  }
  const summary = (db) => table(db).map((c) => { const p = position(db, c.year); return Object.assign({ year: c.year, label: c.label, openedDate: c.openedDate, closedDate: c.closedDate || null, status: c.status, basis: c.basis || "", evidence: c.evidence || "" }, p.totals); });
  /* One member across every financial year (for statements). */
  function memberYears(db, memberId) {
    return table(db).map((c) => { const r = position(db, c.year).rows.find((x) => x.memberId === memberId) || { opening: 0, deposits: 0, profit: 0, withdrawals: 0, shareOuts: 0, other: 0, closing: 0 };
      return { year: c.year, label: c.label, openedDate: c.openedDate, closedDate: c.closedDate || null, status: c.status, opening: r.opening, deposits: r.deposits, profit: r.profit, withdrawals: r.withdrawals, shareOuts: r.shareOuts, closing: r.closing, carriedForward: c.status === "Closed" ? r.closing : null }; });
  }
  /* Health: years are contiguous and the last year's closing equals the live savings total. */
  function check(db) {
    const tb = table(db), out = [];
    tb.forEach((c, i) => { if (i && tb[i - 1].closedDate !== c.openedDate) out.push("FY" + c.year + " does not begin on the day FY" + tb[i - 1].year + " closed"); if (c.status === "Closed" && !c.closedDate) out.push(c.label + " is closed without a share-out date"); });
    if (tb.length) { const last = position(db, tb[tb.length - 1].year).totals.closing, live = L.computeGroupTotals(db).groupSavings; if (last !== live) out.push("closing of the last year (" + last + ") differs from group savings (" + live + ")"); }
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
  return { label, table, byYear, current, yearOfEntry, yearOfDate, position, summary, memberYears, check, defineFinancialYears, SETTLEMENT };
});
