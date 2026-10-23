/* SOB core/reminders — LOAN REMINDER AND RECOVERY (WhatsApp, officer-sent).
   READ-ONLY with respect to money: this module never creates, changes or removes a loan, a repayment, an interest figure, a balance or an approval.
   It only (a) READS the live ledger through the engine's own functions (ledger.loanInterestPosition / loanOutstanding / loanMonthsAfterGrace — the same ones the
   Loans screen, statements and reports use), (b) writes a message from those figures, and (c) records, in its own history (db.reminders), what was prepared and what the
   officer says happened to it.  No figure, date, rate or deadline is typed into a template: figures come from the ledger at the moment of preparation; the share-out date and
   the approved deadlines come from the configuration (db.policy "reminders"), and the reminder is REFUSED if they are not set or the figures cannot be verified.
   "Opened WhatsApp" is NOT delivery: wa.me gives no receipt. Delivery states are PREPARED -> OPENED -> SENT_CONFIRMED (the officer's own confirmation). */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./governance.js") : root.SOB.gov, isNode ? require("./notify.js") : root.SOB.notify);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.reminders = api; }
})(typeof self !== "undefined" ? self : this, function (D, L, G, N) {
  const KEY = "reminders";
  const LEVELS = ["FRIENDLY", "URGENT", "FINAL"], RANK = { FRIENDLY: 1, URGENT: 2, FINAL: 3 };
  const LEVEL_LABEL = { FRIENDLY: "Friendly Reminder", URGENT: "Urgent Reminder", FINAL: "Final Notice" };
  const DELIVERY = ["PREPARED", "OPENED", "SENT_CONFIRMED", "CANCELLED"];
  const DELIVERY_LABEL = { PREPARED: "Prepared (not opened)", OPENED: "WhatsApp opened (delivery NOT confirmed)", SENT_CONFIRMED: "Sent (confirmed by officer)", CANCELLED: "Cancelled" };
  const FOLLOW = ["NONE", "AWAITING_REPLY", "REPLIED", "PROMISE_TO_PAY", "NO_RESPONSE", "CLOSED"];
  const FOLLOW_LABEL = { NONE: "No follow-up yet", AWAITING_REPLY: "Awaiting reply", REPLIED: "Member replied", PROMISE_TO_PAY: "Promised to pay", NO_RESPONSE: "No response", CLOSED: "Closed" };
  const PLACEHOLDERS = ["name", "id", "deadline", "daysToDeadline", "shareOutDate", "daysToShareOut"];
  const FIELDS = ["intro", "request", "stewardship", "scripture", "thanks", "signature"];
  /* Wording only. NO amounts, dates or rates appear here: those are filled from the ledger and the configuration. The scripture is configurable; the signature too. */
  const DEFAULT_TEMPLATES = {
    FRIENDLY: { intro: "As we approach the annual SOB Savings Group share-out, we respectfully remind you of your outstanding loan obligation.",
      request: "We kindly request you to prioritize settlement within the approved period to facilitate timely reconciliation and a smooth share-out for all members.",
      stewardship: "These funds represent the savings of fellow members who have entrusted them to our collective stewardship.", scripture: "1 Corinthians 4:2 — Faithfulness in stewardship.", thanks: "Thank you for your cooperation and commitment.", signature: "SOB Savings Group Administration." },
    URGENT: { intro: "The annual SOB Savings Group share-out is now close, and your loan obligation remains outstanding. We humbly and respectfully urge you to settle without further delay.",
      request: "Please arrange your payment by {deadline}. Delayed repayment affects fellow members who are expecting their savings at the share-out.",
      stewardship: "These funds are the savings of our fellow members, entrusted to our collective stewardship. We must be found faithful with them.", scripture: "“Moreover it is required in stewards, that a man be found faithful.” — 1 Corinthians 4:2 (KJV)", thanks: "Thank you for giving this your prompt attention.", signature: "SOB Savings Group Administration." },
    FINAL: { intro: "This is a final notice regarding your outstanding loan, ahead of the annual SOB Savings Group share-out.",
      request: "We ask that you settle in full by {deadline}, or contact the Administration immediately. Delayed repayment directly affects fellow members who are expecting their savings at the share-out, and unpaid balances will be dealt with in line with the group's approved policies.",
      stewardship: "SOB is a serious financial institution holding the hard-earned savings of its members; we are accountable for every shilling entrusted to us.", scripture: "“Moreover it is required in stewards, that a man be found faithful.” — 1 Corinthians 4:2 (KJV)", thanks: "We trust you will respond with the same faithfulness you expect for your own savings.", signature: "SOB Savings Group Administration." }
  };
  const DEFAULTS = { shareOutDate: null, deadline: null, loanDeadlines: {}, urgentDays: 30, finalDays: 7, minIntervalDays: 7 };

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const money = (n) => "UGX " + Math.round(Number(n) || 0).toLocaleString("en-US");
  const daysBetween = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
  const eatTime = (nowISO) => { const t = Date.parse(nowISO); return isNaN(t) ? "" : new Date(t + 3 * 3600000).toISOString().slice(11, 16) + " EAT"; };
  const eatDate = (nowISO) => { const t = Date.parse(nowISO); return isNaN(t) ? "" : new Date(t + 3 * 3600000).toISOString().slice(0, 10); };

  /* ---------- configuration (stored in db.policy, id "reminders"; audited) ---------- */
  function getConfig(db) {
    const rec = ((db && db.policy) || []).find((p) => p.id === KEY) || {};
    const t = {}; LEVELS.forEach((lv) => { t[lv] = Object.assign({}, DEFAULT_TEMPLATES[lv], (rec.templates || {})[lv] || {}); });
    return { shareOutDate: rec.shareOutDate || null, deadline: rec.deadline || null, loanDeadlines: Object.assign({}, rec.loanDeadlines || {}),
      urgentDays: rec.urgentDays !== undefined ? Number(rec.urgentDays) : DEFAULTS.urgentDays, finalDays: rec.finalDays !== undefined ? Number(rec.finalDays) : DEFAULTS.finalDays,
      minIntervalDays: rec.minIntervalDays !== undefined ? Number(rec.minIntervalDays) : DEFAULTS.minIntervalDays, templates: t,
      datesSetBy: rec.datesSetBy || "", datesSetDate: rec.datesSetDate || "", updatedBy: rec.updatedBy || "", updatedDate: rec.updatedDate || "" };
  }
  const isReal = (s) => typeof s === "string" && D.isISO(s) && D.isRealDate(s);
  function validateTemplateText(level, field, v) {
    if (typeof v !== "string" || !v.trim()) throw new Error("INVALID: the " + LEVEL_LABEL[level] + " '" + field + "' wording cannot be empty");
    if (v.length > 600) throw new Error("INVALID: the " + LEVEL_LABEL[level] + " '" + field + "' wording is too long (600 characters at most)");
    const bad = (v.match(/\{([^}]*)\}/g) || []).map((x) => x.slice(1, -1)).filter((x) => !PLACEHOLDERS.includes(x));
    if (bad.length) throw new Error("INVALID: unknown placeholder {" + bad[0] + "} in the " + LEVEL_LABEL[level] + " '" + field + "' wording. Allowed: " + PLACEHOLDERS.map((x) => "{" + x + "}").join(" "));
    if (/\d[\d,.\s]{3,}\d|\d{4,}/.test(v.replace(/\{[^}]*\}/g, ""))) throw new Error("INVALID: wording must not contain amounts or other long numbers; figures are filled in automatically from the ledger (" + LEVEL_LABEL[level] + " '" + field + "')");
    return v.trim();
  }
  /* Wording, urgency thresholds and spacing: Super Admin, no Chairperson step (no money, no date is involved). */
  function setSettings(db, ctx, a) {
    G.require(ctx, "notify.manage"); G.need(a && a.reason, "reason"); a = a || {};
    const cur = getConfig(db), next = {};
    ["urgentDays", "finalDays", "minIntervalDays"].forEach((k) => { if (a[k] !== undefined && a[k] !== "") { const n = Number(a[k]); if (!Number.isInteger(n)) throw new Error("INVALID: " + k + " must be a whole number of days"); next[k] = n; } });
    const u = next.urgentDays !== undefined ? next.urgentDays : cur.urgentDays, f = next.finalDays !== undefined ? next.finalDays : cur.finalDays, mi = next.minIntervalDays !== undefined ? next.minIntervalDays : cur.minIntervalDays;
    if (!(f >= 0 && f < u && u <= 120)) throw new Error("INVALID: the Final Notice window must be shorter than the Urgent window (0 <= final < urgent <= 120 days)");
    if (!(mi >= 1 && mi <= 60)) throw new Error("INVALID: the minimum days between reminders must be 1 to 60");
    let templates = clone((((db.policy || []).find((p) => p.id === KEY) || {}).templates) || {});
    if (a.templates !== undefined) {
      if (typeof a.templates !== "object" || a.templates === null) throw new Error("INVALID: templates");
      Object.keys(a.templates).forEach((lv) => {
        if (!LEVELS.includes(lv)) throw new Error("INVALID: unknown level " + lv);
        Object.keys(a.templates[lv] || {}).forEach((f2) => { if (!FIELDS.includes(f2)) throw new Error("INVALID: unknown wording field " + f2); (templates[lv] = templates[lv] || {})[f2] = validateTemplateText(lv, f2, a.templates[lv][f2]); });
      });
    }
    db.policy = db.policy || []; let rec = db.policy.find((p) => p.id === KEY); if (!rec) { rec = { id: KEY }; db.policy.push(rec); }
    const before = clone(rec);
    Object.assign(rec, { urgentDays: u, finalDays: f, minIntervalDays: mi, templates, updatedBy: ctx.by, updatedDate: ctx.today });
    G.audit(db, ctx, "ReminderSettings", KEY, "Changed", before, clone(rec), a.reason);
    return getConfig(db);
  }
  /* The share-out date and the approved repayment deadlines. GATED in commands.js: the Super Admin asks, the Chairperson approves. */
  function setDates(db, ctx, a) {
    G.require(ctx, "policy.manage"); a = a || {}; G.need(a.reason, "reason");
    const cur = getConfig(db);
    const so = a.shareOutDate !== undefined ? String(a.shareOutDate).trim() : cur.shareOutDate, dl = a.deadline !== undefined ? String(a.deadline).trim() : cur.deadline;
    if (!isReal(so)) throw new Error("INVALID: the share-out date must be a real day written YYYY-MM-DD");
    if (so.slice(5, 7) !== "12") throw new Error("INVALID: the SOB share-out is held in December; " + so + " is not in December");
    if (so < ctx.today) throw new Error("INVALID: the share-out date " + so + " has already passed");
    if (!isReal(dl)) throw new Error("INVALID: the approved repayment deadline must be a real day written YYYY-MM-DD");
    if (dl > so) throw new Error("INVALID: the repayment deadline cannot be after the share-out date");
    const per = {}; const src = a.loanDeadlines !== undefined ? (a.loanDeadlines || {}) : cur.loanDeadlines;
    Object.keys(src).forEach((id) => { const v = src[id]; if (v === "" || v === null) return; if (!(db.loans || []).some((l) => l.id === id)) throw new Error("NOT_FOUND: loan " + id); if (!isReal(v) || v > so) throw new Error("INVALID: deadline for " + id + " must be a real day on or before the share-out date"); per[id] = v; });
    db.policy = db.policy || []; let rec = db.policy.find((p) => p.id === KEY); if (!rec) { rec = { id: KEY }; db.policy.push(rec); }
    const before = clone(rec);
    Object.assign(rec, { shareOutDate: so, deadline: dl, loanDeadlines: per, datesSetBy: ctx.by, datesSetDate: ctx.today });
    G.audit(db, ctx, "ReminderDates", KEY, "Changed", { shareOutDate: before.shareOutDate || null, deadline: before.deadline || null, loanDeadlines: before.loanDeadlines || {} }, { shareOutDate: so, deadline: dl, loanDeadlines: per }, a.reason);
    return getConfig(db);
  }

  /* ---------- the figures: ONLY engine functions, as at a date ---------- */
  function figures(db, loan, asOf) {
    const pos = L.loanInterestPosition(loan, db, asOf), outstanding = L.loanOutstanding(loan, db, asOf);
    const sum = pos.principalOutstanding + pos.unpaidInterest + pos.unpaidPenalties;
    if (!isFinite(outstanding) || Math.abs(sum - outstanding) > 0.5) return { error: "the loan figures do not reconcile (principal + interest + penalties = " + Math.round(sum) + " but the outstanding balance is " + Math.round(outstanding) + ")" };
    const months = L.loanMonthsAfterGrace(loan, asOf), grace = L.loanGraceMonths(loan);
    return { principal: Number(loan.loanAmount), disbursed: loan.date, monthlyInterest: Number(loan.assignedMonthlyInterest) || 0, interestMonths: months, graceMonths: grace, accruedInterest: pos.accruedInterest, unpaidInterest: pos.unpaidInterest,
      unpaidPenalties: pos.unpaidPenalties, repaid: pos.totalRepaid, outstandingPrincipal: pos.principalOutstanding, totalOutstanding: outstanding, asOf };
  }
  function problemOf(db, loan, asOf) {
    if (!D.isISO(loan.date)) return "the loan has no disbursement date";
    if (loan.dateUnknown || loan.placeholderDate) return "the loan's start date is not established in the records (resolve it under Reconciliation first)";
    if (!(Number(loan.loanAmount) > 0)) return "the loan amount is not valid";
    const f = figures(db, loan, asOf); return f.error || null;
  }
  const effectiveDeadline = (cfg, loan) => (cfg.loanDeadlines && cfg.loanDeadlines[loan.id]) || cfg.deadline;
  function recommendedLevel(cfg, daysToDeadline) { return daysToDeadline <= cfg.finalDays ? "FINAL" : daysToDeadline <= cfg.urgentDays ? "URGENT" : "FRIENDLY"; }
  function schedule(db, cfg, loan, asOf) {
    const dl = effectiveDeadline(cfg, loan);
    if (!isReal(cfg.shareOutDate) || !isReal(dl)) return { error: "NOT_CONFIGURED: set the official share-out date and the approved repayment deadline first (Reminders > Dates; the Chairperson approves them)" };
    if (cfg.shareOutDate < asOf) return { error: "NOT_CONFIGURED: the configured share-out date (" + D.longDate(cfg.shareOutDate) + ") has passed; set the date for the next share-out" };
    const daysToDeadline = daysBetween(asOf, dl);
    return { deadline: dl, shareOutDate: cfg.shareOutDate, daysToDeadline, daysToShareOut: daysBetween(asOf, cfg.shareOutDate), recommended: recommendedLevel(cfg, daysToDeadline) };
  }

  /* ---------- who can be reminded ---------- */
  function candidates(db, asOf) {
    const cfg = getConfig(db), out = [], excluded = { settled: 0 };
    L.activeLoans(db).forEach((loan) => {
      if (loan.status === "Cleared") { excluded.settled++; return; }
      const member = (db.members || []).find((m) => m.id === loan.memberId) || null;
      const prob = problemOf(db, loan, asOf);
      if (prob) { out.push({ loan, member, problem: "CANNOT_VERIFY: " + prob }); return; }
      const f = figures(db, loan, asOf);
      if (f.totalOutstanding <= 0) { excluded.settled++; return; }
      const sch = schedule(db, cfg, loan, asOf), phone = member ? N.normalizePhone(member.phone) : null;
      const last = (db.reminders || []).filter((r) => r.loanId === loan.id && r.delivery !== "CANCELLED").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] || null;
      let problem = sch.error || null; if (!problem && !member) problem = "NO_MEMBER: the loan's member record was not found";
      if (!problem && !phone) problem = "NO_VALID_PHONE: the member has no valid Uganda WhatsApp number on record";
      if (!problem && member && !/^Active$/i.test(String(member.status || "Active"))) problem = "MEMBER_NOT_ACTIVE: member status is " + member.status;
      out.push({ loan, member, figures: f, schedule: sch.error ? null : sch, phone, optedOut: !!(member && member.notifyOptOut), last, problem });
    });
    out.sort((a, b) => (a.loan.date < b.loan.date ? -1 : 1));
    return { rows: out, excluded, asOf, config: cfg };
  }

  /* ---------- the message ---------- */
  const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] === undefined ? m : v[k]));
  function compose(db, loan, level, asOf, nowISO) {
    if (!LEVELS.includes(level)) throw new Error("INVALID: level must be one of " + LEVELS.join(", "));
    const cfg = getConfig(db), member = (db.members || []).find((m) => m.id === loan.memberId);
    if (!member) throw new Error("NOT_FOUND: member " + loan.memberId);
    const prob = problemOf(db, loan, asOf); if (prob) throw new Error("CANNOT_VERIFY: " + prob + ". No reminder was prepared.");
    const f = figures(db, loan, asOf); if (f.totalOutstanding <= 0) throw new Error("SETTLED: this loan has no balance outstanding; no reminder is needed");
    const sch = schedule(db, cfg, loan, asOf); if (sch.error) throw new Error(sch.error);
    const T = cfg.templates[level], vars = { name: member.name, id: member.id, deadline: D.longDate(sch.deadline), daysToDeadline: String(Math.abs(sch.daysToDeadline)), shareOutDate: D.longDate(sch.shareOutDate), daysToShareOut: String(sch.daysToShareOut) };
    const L1 = [];
    const days = sch.daysToDeadline > 0 ? sch.daysToDeadline + " day" + (sch.daysToDeadline === 1 ? "" : "s") : sch.daysToDeadline === 0 ? "Due today" : "Deadline passed " + Math.abs(sch.daysToDeadline) + " day" + (Math.abs(sch.daysToDeadline) === 1 ? "" : "s") + " ago";
    const period = f.interestMonths + " calendar month" + (f.interestMonths === 1 ? "" : "s") + " (" + D.longDate(f.disbursed) + " to " + D.longDate(asOf) + ")" + (f.graceMonths ? ", after " + f.graceMonths + " month(s) of authorised grace" : "");
    L1.push("Dear " + member.name + ",", "", "Praise the Lord.", "", fill(T.intro, vars), "", "*Your Loan Summary*", "Member: " + member.name + " (" + member.id + ")",
      "Loan Principal: " + money(f.principal), "Disbursement Date: " + D.longDate(f.disbursed), "Monthly Interest: " + money(f.monthlyInterest), "Interest Period: " + period, "Accrued Interest: " + money(f.accruedInterest),
      "Repayments Received: " + money(f.repaid), "Outstanding Principal: " + money(f.outstandingPrincipal), "Unpaid Interest: " + money(f.unpaidInterest));
    if (f.unpaidPenalties > 0) L1.push("Unpaid Penalties: " + money(f.unpaidPenalties));
    L1.push("*Total Outstanding: " + money(f.totalOutstanding) + "*", "_Figures as at " + D.longDate(asOf) + ", " + eatTime(nowISO) + ". Interest is added for each calendar month the loan remains unsettled._", "",
      "Repayment Deadline: " + D.longDate(sch.deadline), "Days Remaining: " + days, "Annual Share-Out: " + D.longDate(sch.shareOutDate) + " (" + sch.daysToShareOut + " day" + (sch.daysToShareOut === 1 ? "" : "s") + " to go)", "",
      fill(T.request, vars), "", fill(T.stewardship, vars), "", "_" + fill(T.scripture, vars) + "_", "", fill(T.thanks, vars), "", fill(T.signature, vars));
    return { text: L1.join("\n"), figures: f, schedule: sch, level, member: { id: member.id, name: member.name } };
  }
  /* Private chat only: wa.me/<number>?text=... Never a group, never a number the member did not register. */
  function waLink(phone, text) { const n = N.normalizePhone(phone); if (!n) return null; return "https://wa.me/" + n.slice(1) + "?text=" + encodeURIComponent(text); }
  const sameFigures = (a, b) => ["principal", "disbursed", "monthlyInterest", "interestMonths", "accruedInterest", "unpaidInterest", "unpaidPenalties", "repaid", "outstandingPrincipal", "totalOutstanding"].every((k) => a[k] === b[k]);

  /* ---------- history ---------- */
  const rank = (lv) => RANK[lv] || 0;
  function event(rec, ctx, name, note) { (rec.events = rec.events || []).push({ at: ctx.now, by: ctx.by, event: name, note: note || "" }); }
  /* Prepare ONE reminder from the live ledger. Re-validates everything now; refuses duplicates; records exactly the text produced. */
  function prepare(db, ctx, a) {
    G.require(ctx, "notify.manage"); a = a || {}; G.need(a.loanId, "loanId");
    const asOf = ctx.today, loan = (db.loans || []).find((l) => l.id === a.loanId); if (!loan) throw new Error("NOT_FOUND: loan " + a.loanId);
    if (loan.voided || !L.activeLoans(db).includes(loan)) throw new Error("INVALID: loan " + loan.id + " is not an active loan");
    const cfg = getConfig(db), sch = schedule(db, cfg, loan, asOf); if (sch.error) throw new Error(sch.error);
    const level = a.level && a.level !== "AUTO" ? a.level : sch.recommended, member = (db.members || []).find((m) => m.id === loan.memberId);
    if (!member) throw new Error("NOT_FOUND: member " + loan.memberId);
    if (!N.normalizePhone(member.phone)) throw new Error("NO_VALID_PHONE: " + member.name + " has no valid Uganda WhatsApp number on record; update the member's phone first");
    if (!/^Active$/i.test(String(member.status || "Active"))) throw new Error("MEMBER_NOT_ACTIVE: member status is " + member.status);
    const msg = compose(db, loan, level, asOf, ctx.now), bodyHash = hash(msg.text.replace(/_Figures as at [^\n]*\n/, ""));
    const prior = (db.reminders || []).filter((r) => r.loanId === loan.id && r.delivery !== "CANCELLED");
    const dup = prior.find((r) => r.bodyHash === bodyHash && r.asOf === asOf) || prior.find((r) => rank(r.level) >= rank(level) && daysBetween(r.asOf, asOf) < cfg.minIntervalDays);
    if (dup) throw new Error("DUPLICATE_REMINDER: a " + LEVEL_LABEL[dup.level] + " for this loan was already prepared on " + D.longDate(dup.asOf) + " (" + dup.id + "). The next reminder at this level is allowed " + D.longDate(D.addDays(dup.asOf, cfg.minIntervalDays)) + ", or choose a firmer level. To send the same one again, use 'Open WhatsApp' on that history line.");
    const rec = { id: G.uid("REM"), loanId: loan.id, memberId: member.id, memberName: member.name, level, recommendedLevel: sch.recommended, delivery: "PREPARED", followUp: "NONE", body: msg.text, bodyHash,
      figures: msg.figures, asOf, calcAt: ctx.now, deadline: sch.deadline, shareOutDate: sch.shareOutDate, createdAt: ctx.now, createdBy: ctx.by, createdDate: ctx.today, events: [] };
    event(rec, ctx, "PREPARED", LEVEL_LABEL[level] + (a.level && a.level !== "AUTO" && a.level !== sch.recommended ? " (chosen by officer; system recommended " + LEVEL_LABEL[sch.recommended] + ")" : " (system recommended)"));
    (db.reminders = db.reminders || []).push(rec);
    G.audit(db, ctx, "Reminder", rec.id, "Prepared", null, { loanId: loan.id, memberId: member.id, level, totalOutstanding: msg.figures.totalOutstanding, asOf }, "WhatsApp loan reminder prepared (not sent)");
    return rec;
  }
  /* Bulk: one reminder per member's loan, each individually addressed; skips (with the reason) whatever cannot be prepared safely. Nothing is sent anywhere. */
  function prepareMany(db, ctx, a) {
    G.require(ctx, "notify.manage"); a = a || {};
    const c = candidates(db, ctx.today), want = Array.isArray(a.loanIds) && a.loanIds.length ? new Set(a.loanIds) : null, results = [];
    c.rows.forEach((r) => {
      if (want && !want.has(r.loan.id)) return;
      if (r.problem) { results.push({ loanId: r.loan.id, memberId: r.loan.memberId, ok: false, reason: r.problem }); return; }
      if (r.optedOut) { results.push({ loanId: r.loan.id, memberId: r.loan.memberId, ok: false, reason: "OPTED_OUT: the member switched notifications off; prepare this one individually if the officers decide to" }); return; }
      try { const rec = prepare(db, ctx, { loanId: r.loan.id, level: a.level }); results.push({ loanId: r.loan.id, memberId: rec.memberId, ok: true, reminderId: rec.id, level: rec.level }); }
      catch (e) { results.push({ loanId: r.loan.id, memberId: r.loan.memberId, ok: false, reason: String(e.message || e) }); }
    });
    G.audit(db, ctx, "Reminder", "bulk", "Bulk prepared", null, { prepared: results.filter((x) => x.ok).length, skipped: results.filter((x) => !x.ok).length }, "Bulk WhatsApp loan reminders prepared (individually addressed, not sent)");
    return { asOf: ctx.today, calcAt: ctx.now, results };
  }
  /* Re-validate a stored reminder against the ledger right now. Returns the text ONLY if every figure is unchanged; otherwise the reminder is stale and a new one must be prepared. */
  function revalidate(db, ctx, a) {
    G.require(ctx, "notify.manage"); const rec = (db.reminders || []).find((r) => r.id === (a && a.id)); if (!rec) throw new Error("NOT_FOUND: reminder " + (a && a.id));
    if (rec.delivery === "CANCELLED") throw new Error("BAD_STATE: this reminder was cancelled");
    const loan = (db.loans || []).find((l) => l.id === rec.loanId), member = (db.members || []).find((m) => m.id === rec.memberId);
    if (!loan || !member) throw new Error("NOT_FOUND: loan or member");
    if (rec.asOf !== ctx.today) throw new Error("STALE_REMINDER: this reminder was prepared on " + D.longDate(rec.asOf) + "; interest and days remaining have moved on. Prepare a new reminder.");
    const f = figures(db, loan, ctx.today); if (f.error) throw new Error("CANNOT_VERIFY: " + f.error);
    if (f.totalOutstanding <= 0) throw new Error("SETTLED: the loan has since been settled; no reminder is needed");
    if (!sameFigures(rec.figures, f)) throw new Error("STALE_REMINDER: the loan balance has changed since this reminder was prepared (a repayment or adjustment was recorded). Prepare a new reminder; the old one must not be sent.");
    if (!N.normalizePhone(member.phone)) throw new Error("NO_VALID_PHONE: the member's WhatsApp number is no longer valid");
    return { id: rec.id, text: rec.body, phone: member.phone, calcAt: rec.calcAt, verifiedAt: ctx.now };
  }
  const byId = (db, id) => { const r = (db.reminders || []).find((x) => x.id === id); if (!r) throw new Error("NOT_FOUND: reminder " + id); return r; };
  /* The officer's browser opened WhatsApp. That is all it means. */
  function markOpened(db, ctx, a) {
    G.require(ctx, "notify.manage"); const r = byId(db, a && a.id); if (r.delivery === "CANCELLED") throw new Error("BAD_STATE: cancelled");
    if (r.delivery === "PREPARED") { r.delivery = "OPENED"; r.openedAt = ctx.now; }
    event(r, ctx, "WHATSAPP_OPENED", "WhatsApp was opened with this message. This does not confirm that it was sent or delivered.");
    G.audit(db, ctx, "Reminder", r.id, "WhatsApp opened", null, { delivery: r.delivery }, "Opening WhatsApp is not delivery");
    return r;
  }
  function confirmSent(db, ctx, a) {
    G.require(ctx, "notify.manage"); const r = byId(db, a && a.id); if (r.delivery === "CANCELLED") throw new Error("BAD_STATE: cancelled");
    if (r.delivery === "PREPARED") throw new Error("BAD_STATE: open WhatsApp first; you cannot confirm sending a message that was never opened");
    if (r.delivery === "SENT_CONFIRMED") return r;
    r.delivery = "SENT_CONFIRMED"; r.sentConfirmedAt = ctx.now; r.sentConfirmedBy = ctx.by; if (r.followUp === "NONE") r.followUp = "AWAITING_REPLY";
    event(r, ctx, "SENT_CONFIRMED", (a.note || "") + " (officer's confirmation; WhatsApp provides no delivery receipt)");
    G.audit(db, ctx, "Reminder", r.id, "Sent confirmed by officer", null, { delivery: r.delivery }, a.note || "");
    return r;
  }
  function setFollowUp(db, ctx, a) {
    G.require(ctx, "notify.manage"); const r = byId(db, a && a.id); a = a || {};
    if (!FOLLOW.includes(a.followUp)) throw new Error("INVALID: follow-up must be one of " + FOLLOW.join(", "));
    if (r.delivery === "PREPARED" || r.delivery === "CANCELLED") throw new Error("BAD_STATE: record follow-up only after WhatsApp has been opened for this reminder");
    if (a.followUp === "PROMISE_TO_PAY") { if (!isReal(a.promiseDate)) throw new Error("INVALID: a promise to pay needs the date the member promised (YYYY-MM-DD)"); r.promiseDate = a.promiseDate; }
    const prev = r.followUp; r.followUp = a.followUp; if (a.note) r.followUpNote = String(a.note).slice(0, 300);
    event(r, ctx, "FOLLOW_UP:" + a.followUp, (a.note || "") + (a.promiseDate ? " promised by " + a.promiseDate : ""));
    G.audit(db, ctx, "Reminder", r.id, "Follow-up", prev, a.followUp, a.note || "");
    return r;
  }
  function cancel(db, ctx, a) {
    G.require(ctx, "notify.manage"); const r = byId(db, a && a.id); G.need(a.reason, "reason");
    if (r.delivery === "SENT_CONFIRMED") throw new Error("BAD_STATE: a reminder confirmed as sent cannot be cancelled; record a follow-up instead");
    if (r.delivery === "CANCELLED") return r;
    const prev = r.delivery; r.delivery = "CANCELLED"; r.cancelReason = String(a.reason).trim(); event(r, ctx, "CANCELLED", a.reason);
    G.audit(db, ctx, "Reminder", r.id, "Cancelled", prev, "CANCELLED", a.reason); return r;
  }
  return { KEY, LEVELS, LEVEL_LABEL, DELIVERY, DELIVERY_LABEL, FOLLOW, FOLLOW_LABEL, PLACEHOLDERS, FIELDS, DEFAULT_TEMPLATES, getConfig, setSettings, setDates, figures, candidates, schedule, recommendedLevel, compose, waLink, prepare, prepareMany, revalidate, markOpened, confirmSent, setFollowUp, cancel, daysBetween, eatTime, eatDate, money };
});
