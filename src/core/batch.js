/* SOB core/batch — enter many ledger lines, check them ALL together, submit them ALL together.
   validate(db, rows, o) never writes anything. It returns, for every line, the errors that block it and the warnings that need a decision, so the person fixes everything in one pass.
   apply(db, ctx, rows, o) re-runs the same validation on the server and then records every line in one command: either all are saved or none (a failure rolls the whole command back).
   A line: { memberId, type: Savings|Withdraw|Expense|Income, amount, date, reference, purpose, bankCharge, chargedTo }. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./governance.js") : root.SOB.gov, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./notify.js") : root.SOB.notify, isNode ? require("./dates.js") : root.SOB.dates);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.batch = api;
  }
})(typeof self !== "undefined" ? self : this, function (G, L, N, D) {
  const TYPES = ["Savings", "Withdraw", "Expense", "Income"], MEMBER_TYPES = ["Savings", "Withdraw"], MAX_ROWS = 200, RECEIPT_TYPES = ["Savings", "Withdraw"];
  const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(String(v).replace(/,/g, "")));
  const ugx = (n) => "UGX " + Math.round(n).toLocaleString("en-US");
  const blank = (r) => !r || !["memberId", "amount", "reference", "purpose", "bankCharge"].some((k) => String(r[k] == null ? "" : r[k]).trim() !== "");

  function validate(db, rows, o) {
    o = o || {}; const today = o.today || (new Date().toISOString().slice(0, 10)), receipts = !!o.receiptsOn, out = [], seenRef = {}, seenKey = {}, running = {};
    const ledgerRefs = {}, ledgerKeys = {};
    (db.transactions || []).filter((t) => !t.voided).forEach((t) => { [t.reference, t.sourceRef].filter(Boolean).forEach((r) => { ledgerRefs[String(r).trim().toLowerCase()] = t; }); ledgerKeys[[t.memberId || "", t.type, Number(t.amount), t.date].join("|")] = t; });
    const list = (rows || []).map((r, i) => ({ r, i })).filter((x) => !blank(x.r));
    if (list.length > MAX_ROWS) return { ok: false, rows: [], errorCount: 1, warningCount: 0, summary: ["A batch can hold at most " + MAX_ROWS + " lines; split it into smaller batches."], total: list.length };
    list.forEach(({ r, i }) => {
      const e = [], w = [], f = {};   // f: field -> message, so the screen can mark the box
      const bad = (field, msg) => { e.push(msg); f[field] = msg; };
      const type = String(r.type || "").trim(); if (!TYPES.includes(type)) bad("type", "Choose what this line is (Savings, Withdrawal, Expense or Income).");
      const mid = String(r.memberId || "").trim(), m = mid ? (db.members || []).find((x) => x.id === mid) : null;
      if (MEMBER_TYPES.includes(type) && !mid) bad("memberId", "Choose the member."); else if (mid && !m) bad("memberId", "Member " + mid + " is not in the register.");
      else if (m && m.status && !["Active", "Pending"].includes(m.status)) w.push(m.name + " is marked " + m.status + ". Check this line is right.");
      const amt = num(r.amount); if (!(amt > 0) || !isFinite(amt)) bad("amount", "Enter an amount above 0."); else if (Math.round(amt) !== amt) bad("amount", "Use whole shillings, no decimals."); else if (amt > 500000000) bad("amount", "This amount looks too large. Check the zeros.");
      const date = String(r.date || "").trim(); if (!D.isISO(date) || !D.isRealDate(date)) bad("date", "Enter a real date."); else if (date > today) bad("date", "This date is in the future."); else if (date < "2000-01-01") bad("date", "This date is too far back.");
      const ref = String(r.reference || "").trim();
      if (ref) { const k = ref.toLowerCase(); if (seenRef[k] !== undefined) bad("reference", "Reference " + ref + " is also on line " + (seenRef[k] + 1) + "."); else seenRef[k] = i; if (ledgerRefs[k]) bad("reference", "Reference " + ref + " is already in the ledger (" + (ledgerRefs[k].date || "") + ", " + (ledgerRefs[k].memberName || ledgerRefs[k].type) + ")."); }
      if (["Expense", "Income"].includes(type) && !String(r.purpose || "").trim()) bad("purpose", "Say what this " + type.toLowerCase() + " is for.");
      const chRaw = r.bankCharge === undefined || r.bankCharge === null || String(r.bankCharge).trim() === "" ? 0 : num(r.bankCharge), ch = chRaw;
      if (!(ch >= 0) || !isFinite(ch)) bad("bankCharge", "The bank charge must be 0 or a number."); else if (ch > 0) { if (type !== "Withdraw") bad("bankCharge", "A bank charge goes only on a withdrawal."); else if (Math.round(ch) !== ch) bad("bankCharge", "Use whole shillings for the bank charge."); else if (amt > 0 && ch > amt) w.push("The bank charge is larger than the withdrawal. Check it."); }
      if (ch > 0 && r.chargedTo && !["Member", "Group"].includes(r.chargedTo)) bad("chargedTo", "Choose who pays the bank charge.");
      /* money available: the member's position now, plus the lines above that put money in or take it out */
      if (m && date && D.isISO(date) && amt > 0) {
        const key = m.id; if (!running[key]) { const pos = L.memberPosition(db, m.id); running[key] = { avail: pos.withdrawable, savings: pos.savings }; }
        const st = running[key];
        if (type === "Savings") { st.avail += amt; st.savings += amt; }
        if (type === "Withdraw") { const memberCharge = ch > 0 && (r.chargedTo || "Member") === "Member" ? ch : 0, need = amt + memberCharge;
          if (need > st.avail) bad("amount", m.name + " can withdraw only " + ugx(Math.max(0, st.avail)) + (running[key].lines ? " after the lines above" : "") + (memberCharge ? " (the bank charge of " + ugx(memberCharge) + " also comes from their savings)" : "") + ". This needs " + ugx(need) + "."); else { st.avail -= need; st.savings -= need; }
          running[key].lines = true; }
      }
      /* the same line twice (same member, type, amount, date) is almost always a double entry */
      if (m && amt > 0 && date) { const k = [m.id, type, amt, date].join("|"); if (seenKey[k] !== undefined) w.push("Looks the same as line " + (seenKey[k] + 1) + " (same member, type, amount and date). Is it a double entry?"); else seenKey[k] = i; if (ledgerKeys[k]) w.push("The ledger already has the same member, type, amount and date. Is it a double entry?"); }
      /* SMS receipts: warn when this line would send one but the member's number cannot receive it */
      if (receipts && m && RECEIPT_TYPES.includes(type) && !N.normalizePhone(m.phone)) w.push(m.name + " has " + (m.phone ? "an invalid phone number (" + m.phone + ")" : "no phone number") + ", so no SMS receipt can be sent. Fix it in Members, or accept that no SMS goes out for this line.");
      out.push({ index: i, line: i + 1, errors: e, warnings: w, fields: f, ok: e.length === 0 });
    });
    const errorCount = out.reduce((a, x) => a + x.errors.length, 0), warningCount = out.reduce((a, x) => a + x.warnings.length, 0);
    const money = (types, key) => list.reduce((a, { r }) => (types.includes(String(r.type)) ? a + (num(r[key]) > 0 ? num(r[key]) : 0) : a), 0);
    return { ok: errorCount === 0 && out.length > 0, rows: out, errorCount, warningCount, total: out.length, deposits: money(["Savings", "Income"], "amount"), payouts: money(["Withdraw", "Expense"], "amount"), charges: money(["Withdraw"], "bankCharge") };
  }

  /* Records every line in one go. Throws before saving anything if a single error remains; warnings must be accepted (o.acceptWarnings). */
  function apply(db, ctx, rows, o) {
    o = o || {}; const v = validate(db, rows, { today: ctx.today, receiptsOn: false });
    if (!v.total) throw new Error("INVALID: there are no lines to submit");
    if (v.errorCount) throw new Error("INVALID: " + v.errorCount + " problem" + (v.errorCount === 1 ? "" : "s") + " still to fix. Nothing was saved. First: line " + v.rows.find((x) => x.errors.length).line + ": " + v.rows.find((x) => x.errors.length).errors[0]);
    if (v.warningCount && !(o.acceptWarnings === true || o.acceptWarnings === "true")) throw new Error("WARNINGS: " + v.warningCount + " warning" + (v.warningCount === 1 ? "" : "s") + " have not been accepted. Nothing was saved.");
    const made = []; const list = (rows || []).filter((r) => !blank(r));
    list.forEach((r) => {
      const type = String(r.type).trim(), amount = num(r.amount), purpose = String(r.purpose || "").trim() || (type === "Savings" ? "Savings" : type === "Withdraw" ? "Member withdrawal" : type), ref = String(r.reference || "").trim(), ch = num(r.bankCharge) > 0 ? num(r.bankCharge) : 0;
      const e = { date: String(r.date).trim(), memberId: String(r.memberId || "").trim() || undefined, amount, type, purpose };
      if (ref) e.reference = ref; if (type === "Withdraw" && ch > 0) { e.bankCharge = ch; e.chargedTo = r.chargedTo === "Group" ? "Group" : "Member"; }
      made.push(G.createEntry(db, ctx, e));
    });
    G.audit(db, ctx, "Batch", "BATCH", "Recorded", null, { lines: made.length, ids: made.map((x) => x.id) }, "Batch entry");
    return made;
  }
  return { validate, apply, TYPES, MAX_ROWS };
});
