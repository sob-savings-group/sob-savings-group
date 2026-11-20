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
  const DELIVERY = ["PREPARED", "OPENED", "SMS_ACCEPTED", "SENT_CONFIRMED", "CANCELLED"];
  const DELIVERY_LABEL = { PREPARED: "Prepared (not opened)", OPENED: "WhatsApp opened (delivery NOT confirmed)", SMS_ACCEPTED: "SMS accepted by gateway (delivery NOT confirmed)", SENT_CONFIRMED: "Sent (confirmed by officer)", CANCELLED: "Cancelled" };
  const FOLLOW = ["NONE", "AWAITING_REPLY", "REPLIED", "PROMISE_TO_PAY", "NO_RESPONSE", "CLOSED"];
  const FOLLOW_LABEL = { NONE: "No follow-up yet", AWAITING_REPLY: "Awaiting reply", REPLIED: "Member replied", PROMISE_TO_PAY: "Promised to pay", NO_RESPONSE: "No response", CLOSED: "Closed" };
  const PLACEHOLDERS = ["name", "id", "deadline", "daysToDeadline", "shareOutDate", "daysToShareOut"];
  const FIELDS = ["intro", "request", "stewardship", "scripture", "thanks", "signature"];
  /* Wording only. NO amounts, dates or rates appear here: those are filled from the ledger and the configuration. The scripture is configurable; the signature too. */
  const DEFAULT_TEMPLATES = {
    FRIENDLY: { intro: "SOB reminder:", stewardship: "", request: "Kindly pay by {deadline}; unpaid loans go to Church Administration, then the Bishop.", thanks: "", scripture: "", signature: "" },
    URGENT: { intro: "SOB URGENT:", stewardship: "", request: "Pay by {deadline} or your name goes to Church Administration and the Bishop.", thanks: "", scripture: "", signature: "" },
    FINAL: { intro: "SOB FINAL NOTICE:", stewardship: "", request: "Pay by {deadline} or your name goes to Church Administration and the Bishop.", thanks: "", scripture: "", signature: "" }
  };
  const DEFAULTS = { shareOutDate: null, deadline: null, loanDeadlines: {}, urgentDays: 30, finalDays: 7, minIntervalDays: 7 };

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const fullDate = (iso) => (D.isISO(iso) ? Number(iso.slice(8, 10)) + " " + FULL_MONTHS[Number(iso.slice(5, 7)) - 1] + " " + iso.slice(0, 4) : "");
  const padDate = (iso) => (D.isISO(iso) ? iso.slice(8, 10) + " " + D.longDate(iso).split(" ")[1] + " " + iso.slice(0, 4) : "");
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
    const T = cfg.templates[level], vars = { name: member.name, id: member.id, deadline: fullDate(sch.deadline), daysToDeadline: String(Math.abs(sch.daysToDeadline)), shareOutDate: fullDate(sch.shareOutDate), daysToShareOut: String(sch.daysToShareOut) };
    /* ONE short message (the length of a single SMS, about 160 characters): who, what is owed, by when. Nothing else unless the committee adds wording in Settings. */
    const part = (x) => fill(x || "", vars).trim(), tail = ["stewardship", "thanks", "scripture", "signature"].map((k) => part(T[k])).filter(Boolean).join(" ");
    const build = (nm) => [part(T.intro), nm + ", your loan balance is " + money(f.totalOutstanding) + ".", part(T.request), tail].filter(Boolean).join(" ").replace(/\s+/g, " ");
    let text = build(member.name); if (text.length > 160 && /\s/.test(member.name.trim())) text = build(member.name.trim().split(/\s+/)[0]);
    const L1 = [text];
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
    /* a prepared-but-unsent reminder whose figures no longer match the ledger (a repayment or adjustment came after it) can never be sent: it is withdrawn automatically so the member can be reminded with the right balance */
    (db.reminders || []).filter((r) => r.loanId === loan.id && (r.delivery === "PREPARED" || r.delivery === "OPENED") && r.figures && !sameFigures(r.figures, msg.figures)).forEach((r) => cancel(db, ctx, { id: r.id, reason: "Replaced: the loan balance changed after this reminder was prepared (" + money(r.figures.totalOutstanding) + " then, " + money(msg.figures.totalOutstanding) + " now)" }));
    const prior = (db.reminders || []).filter((r) => r.loanId === loan.id && r.delivery !== "CANCELLED" && r.deadline === sch.deadline);   /* a notice issued under an earlier deadline never blocks one with the current deadline */
    const dup = prior.find((r) => r.bodyHash === bodyHash && r.asOf === asOf) || prior.find((r) => rank(r.level) >= rank(level) && daysBetween(r.asOf, asOf) < cfg.minIntervalDays);
    if (dup) throw new Error("DUPLICATE_REMINDER: a " + LEVEL_LABEL[dup.level] + " for this loan was already prepared on " + D.longDate(dup.asOf) + " (" + dup.id + "). The next reminder at this level is allowed " + D.longDate(D.addDays(dup.asOf, cfg.minIntervalDays)) + ", or choose a firmer level. To send the same one again, tap 'Open WhatsApp' on that history line: the window has 'Send by SMS' too.");
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
    const sch0 = schedule(db, getConfig(db), loan, ctx.today); if (!sch0.error && sch0.deadline !== rec.deadline) throw new Error("STALE_REMINDER: the approved repayment deadline changed from " + D.longDate(rec.deadline) + " to " + D.longDate(sch0.deadline) + " after this reminder was prepared. Prepare a new reminder; the old one must not be sent.");
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
  /* SMS through the gateway. The officer taps "Send by SMS" for ONE prepared reminder. The text is re-checked against the ledger right now (same rules as WhatsApp),
     the member must not have opted out, and the message goes to the outbox with a key that makes a second tap harmless. "Accepted by the gateway" is NOT "delivered". */
  /* SMS is sent in a VERY BRIEF form: never more than SMS_MAX characters (urgency, amount, action only). The detailed notice is for WhatsApp. Wording only: the amount and date come from the
     ledger and the approved configuration at the moment of sending. Each stage has a few shorter fall-backs; if none fits, nothing is sent (never a longer message). */
  const SMS_MAX = 50;
  const SMS_TEMPLATES = {
    FRIENDLY: ["SOB: Loan {total} due {dl}. Pay now.", "SOB: Pay {total} by {dl}.", "SOB: Pay {amt} by {dl}."],
    URGENT: ["SOB: {total} unpaid. Name to Church Admin.", "SOB: {total} unpaid. Name to Admin.", "SOB: {amt} unpaid. Name to Admin."],
    FINAL: ["SOB FINAL: Pay {total} now. Bishop next.", "SOB FINAL: Pay {amt} now. Bishop next.", "SOB FINAL: Pay {amt}. Bishop next."]
  };
  const asciiSms = (t) => String(t).replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, "-");
  const smsText = (t) => asciiSms(String(t).replace(/(^|\s)_/gm, "$1").replace(/_(?=\s|$)/gm, "").replace(/\*/g, ""));
  const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function composeSms(db, rec, f) {
    const cfg = getConfig(db), custom = (cfg.templates[rec.level] || {}).sms, left = D.isISO(rec.deadline) && D.isISO(rec.asOf) ? daysBetween(rec.asOf, rec.deadline) : null;
    /* the friendly reminder counts down to the deadline, so each day's SMS reads differently: "5 days left", "4 days left" ... "Due tomorrow", "Due TODAY" */
    const COUNT = left === null || left < 0 ? null : left === 0 ? ["SOB: Due TODAY {dl}. Pay {total} now.", "SOB: Due today. Pay {amt} now.", "SOB: Due today. Pay {amt}."] : left === 1 ? ["SOB: Due TOMORROW. Pay {total} today.", "SOB: Due tomorrow. Pay {amt} today.", "SOB: Due tomorrow. Pay {amt}."] : left === 2 ? ["SOB: Only 2 days left! Pay {total} by {dl}.", "SOB: 2 days left! Pay {amt} by {dl}.", "SOB: 2 days left. Pay {amt}."] : ["SOB: {n} days left. Pay {total} by {dl}.", "SOB: {n} days left. Pay {amt} by {dl}.", "SOB: {n} days left. Pay {amt}."];
    const list = custom ? [custom] : (rec.level === "FRIENDLY" && COUNT ? COUNT : SMS_TEMPLATES[rec.level]);
    /* the deadline is the one recorded on the notice when it was issued, never a value typed here or read later */
    const dl = D.isISO(rec.deadline) ? Number(rec.deadline.slice(8, 10)) + " " + SHORT_MONTHS[Number(rec.deadline.slice(5, 7)) - 1] : "", n = Math.round(f.totalOutstanding);
    const v = { total: money(n), amt: n.toLocaleString("en-US"), dl, n: String(left === null ? "" : left) };
    for (const tpl of list) { const t = smsText(fill(tpl, v)); if (t.length <= SMS_MAX) return t; }
    throw new Error("SMS_TOO_LONG: the message would be longer than " + SMS_MAX + " characters, so it was not sent. Use WhatsApp for this member.");
  }
  function queueSms(db, ctx, a) {
    G.require(ctx, "notify.manage"); const r = byId(db, a && a.id); const chk = revalidate(db, ctx, { id: r.id });
    if (r.delivery === "SMS_ACCEPTED" || r.delivery === "SENT_CONFIRMED") throw new Error("BAD_STATE: this reminder was already sent; prepare a new one when the next reminder is due");
    const smsBody = composeSms(db, r, figures(db, (db.loans || []).find((l) => l.id === r.loanId), ctx.today)); r.smsBody = smsBody;
    const member = (db.members || []).find((m) => m.id === r.memberId); if (member && member.notifyOptOut) throw new Error("OPTED_OUT: the member switched notifications off, so no SMS is sent");
    const msg = N.queue(db, ctx, { memberId: r.memberId, template: "loanReminderSms", vars: { text: smsBody }, channel: "SMS", dedupeKey: "REMSMS:" + r.id });
    if (msg.status === "SKIPPED") throw new Error("NO_VALID_PHONE: " + msg.reason);
    r.smsOutboxId = msg.id; event(r, ctx, "SMS_QUEUED", "SMS prepared for the gateway (" + msg.id + "). Not sent until the gateway accepts it.");
    G.audit(db, ctx, "Reminder", r.id, "SMS queued", null, { outbox: msg.id }, "Officer asked for this reminder to go by SMS"); return { reminder: r, outboxId: msg.id };
  }
  /* After the outbox ran: record honestly what the gateway answered. */
  function syncSms(db, ctx, a) {
    G.require(ctx, "notify.manage"); const r = byId(db, a && a.id); const m = (db.outbox || []).find((x) => x.id === r.smsOutboxId); if (!m) throw new Error("NOT_FOUND: no SMS was queued for this reminder");
    if (m.status === "SENT" && r.delivery !== "SMS_ACCEPTED" && r.delivery !== "SENT_CONFIRMED") {
      r.delivery = "SMS_ACCEPTED"; r.smsAcceptedAt = m.lastAttemptAt || ctx.now; if (r.followUp === "NONE") r.followUp = "AWAITING_REPLY";
      event(r, ctx, "SMS_ACCEPTED", "The SMS gateway accepted the message. This does not prove the member received it."); G.audit(db, ctx, "Reminder", r.id, "SMS accepted by gateway", null, { delivery: r.delivery }, "Gateway acceptance is not delivery");
    } else if (m.status === "FAILED") event(r, ctx, "SMS_FAILED", String(m.reason || "").slice(0, 200));
    else if (m.status === "DRY_RUN") event(r, ctx, "SMS_NOT_SENT", "The SMS gateway is not switched on, so nothing was sent.");
    return { reminder: r, outboxStatus: m.status, reason: m.reason || "" };
  }

  /* ---------- ESCALATION: overdue loans reported to the church administrator, then to the bishop (officer-sent SMS) ----------
     Steps are configured (who, their phone, how many days after the approved deadline). The list is ALWAYS rebuilt here from the ledger when sending; nothing the
     screen shows can be typed into a message. Contacts live only in the Sheet (db.policy), approved by the Chairperson, and are never sent to members. */
  const STEP_IDS = ["ADMIN", "BISHOP"];
  function getEscalation(db) {
    const rec = ((db && db.policy) || []).find((p) => p.id === KEY) || {}, cur = rec.escalation || {};
    return STEP_IDS.map((id, i) => Object.assign({ id, label: id === "ADMIN" ? "Church Administrator" : "Bishop", phone: "", afterDays: i === 0 ? 1 : 3, name: "" }, cur[id] || {}));
  }
  function setEscalation(db, ctx, a) {
    G.require(ctx, "policy.manage"); a = a || {}; G.need(a.reason, "reason");
    const steps = a.steps || {}, next = {};
    STEP_IDS.forEach((id) => {
      const v = steps[id] || {}, cur = getEscalation(db).find((x) => x.id === id), phone = v.phone !== undefined ? String(v.phone).trim() : cur.phone, days = v.afterDays !== undefined ? Number(v.afterDays) : cur.afterDays;
      if (phone && !N.normalizePhone(phone)) throw new Error("INVALID: " + cur.label + " phone number is not a valid Uganda number");
      if (!Number.isInteger(days) || days < 0 || days > 60) throw new Error("INVALID: days after the deadline must be a whole number from 0 to 60");
      next[id] = { phone: phone ? N.normalizePhone(phone) : "", afterDays: days, name: String(v.name !== undefined ? v.name : cur.name || "").slice(0, 60) };
    });
    if (next.BISHOP.afterDays < next.ADMIN.afterDays) throw new Error("INVALID: the Bishop (highest escalation) cannot come before the church administrator");
    db.policy = db.policy || []; let rec = db.policy.find((p) => p.id === KEY); if (!rec) { rec = { id: KEY }; db.policy.push(rec); }
    const before = clone(getEscalation(db)); rec.escalation = next;
    G.audit(db, ctx, "ReminderEscalation", KEY, "Changed", before.map((x) => ({ id: x.id, afterDays: x.afterDays, hasPhone: !!x.phone })), STEP_IDS.map((id) => ({ id, afterDays: next[id].afterDays, hasPhone: !!next[id].phone })), a.reason);
    return getEscalation(db);
  }
  /* The overdue list for one step as at a day. Read-only. */
  function escalationPlan(db, a) {
    const asOf = a.asOf, cfg = getConfig(db), steps = getEscalation(db), step = steps.find((x) => x.id === a.step); if (!step) throw new Error("INVALID: step must be ADMIN or BISHOP");
    const rows = [];
    L.activeLoans(db).forEach((loan) => {
      if (loan.status === "Cleared" || problemOf(db, loan, asOf)) return;
      const dl = effectiveDeadline(cfg, loan); if (!isReal(dl)) return;
      const over = daysBetween(dl, asOf); if (over < step.afterDays || over < 1) return;       // only AFTER the approved deadline has passed
      const f = figures(db, loan, asOf); if (!(f.totalOutstanding > 0)) return;
      const m = (db.members || []).find((x) => x.id === loan.memberId); rows.push({ memberId: loan.memberId, name: m ? m.name : loan.memberId, owed: Math.round(f.totalOutstanding), deadline: dl, daysOverdue: over, loanId: loan.id });
    });
    rows.sort((x, y) => y.daysOverdue - x.daysOverdue || (x.memberId < y.memberId ? -1 : 1));
    const head = "SOB Savings Group - " + step.label + ": loans unpaid after the approved deadline, as at " + asOf + ". ", tail = " Confidential: for follow-up only.";
    const lines = rows.map((r, i) => (i + 1) + ". " + r.name + " (" + r.memberId + ") " + money(r.owed)), parts = []; let cur = "";
    lines.forEach((l) => { if (cur && (head + cur + l).length > 420) { parts.push(cur.trim()); cur = ""; } cur += l + "; "; }); if (cur) parts.push(cur.trim());
    const texts = parts.map((t, i) => head + (parts.length > 1 ? "(Part " + (i + 1) + "/" + parts.length + ") " : "") + t + (i === parts.length - 1 ? " Total " + money(rows.reduce((x, r) => x + r.owed, 0)) + "." : "") + tail);
    return { step, asOf, rows, texts, total: rows.reduce((x, r) => x + r.owed, 0), ready: !!step.phone && rows.length > 0, note: !step.phone ? "No phone number is set for the " + step.label + "." : !rows.length ? "Nobody is overdue by " + step.afterDays + " day(s) or more." : "" };
  }
  function queueEscalation(db, ctx, a) {
    G.require(ctx, "notify.manage"); a = a || {}; const plan = escalationPlan(db, { step: a.step, asOf: ctx.today });
    if (!plan.step.phone) throw new Error("NO_VALID_PHONE: no phone number is set for the " + plan.step.label);
    if (!plan.rows.length) throw new Error("NOTHING_TO_SEND: nobody is overdue by " + plan.step.afterDays + " day(s) or more");
    const ids = plan.texts.map((t, i) => N.queue(db, ctx, { to: plan.step.phone, template: "loanReminderSms", vars: { text: t }, channel: "SMS", dedupeKey: "ESC:" + plan.step.id + ":" + ctx.today + ":" + hash(t) }).id);
    G.audit(db, ctx, "Escalation", plan.step.id, "SMS queued", null, { messages: ids.length, members: plan.rows.map((r) => r.memberId), total: plan.total }, "Overdue loans reported to the " + plan.step.label + " (officer-sent; the gateway's answer is recorded in the outbox)");
    return { outboxIds: ids, members: plan.rows.length, total: plan.total };
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
    if (r.delivery === "SENT_CONFIRMED" || r.delivery === "SMS_ACCEPTED") throw new Error("BAD_STATE: a reminder that was sent cannot be cancelled; record a follow-up instead");
    if (r.delivery === "CANCELLED") return r;
    const prev = r.delivery; r.delivery = "CANCELLED"; r.cancelReason = String(a.reason).trim(); event(r, ctx, "CANCELLED", a.reason);
    G.audit(db, ctx, "Reminder", r.id, "Cancelled", prev, "CANCELLED", a.reason); return r;
  }
  /* ---------- TRANSACTION SMS RECEIPTS ----------
     When switched ON (Chairperson-approved) every successful transaction sends the member ONE short SMS: what it was, the amount, the new savings balance and, if the member has an active loan,
     the loan balance. It goes out automatically, only when the SMS gateway is live. A withdrawal is sent only after a person other than the one who entered it has approved it.
     Imported historical or outstanding entries never send a receipt. Every message, sent or not, is recorded in the audit trail. A receipt never changes a ledger entry or a balance. */
  const RECEIPT_MAX = 160, RECEIPT_KIND = { "Savings": ["Savings", "received"], "Subscription": ["Subscription", "received"], "Loan Repayment": ["Loan repayment", "received"], "Withdraw": ["Withdrawal", "paid"], "Loan Disbursement": ["Loan", "paid out"] };
  function getReceipts(db) { const r = (((db && db.policy) || []).find((p) => p.id === KEY) || {}).receipts || {}; return { enabled: r.enabled === true, updatedBy: r.updatedBy || "", updatedDate: r.updatedDate || "" }; }
  function setReceipts(db, ctx, a) {
    G.require(ctx, "policy.manage"); a = a || {}; G.need(a.reason, "reason"); if (a.enabled === undefined) throw new Error("REQUIRED: enabled");
    const on = a.enabled === true || a.enabled === "true" || a.enabled === "yes"; db.policy = db.policy || []; let rec = db.policy.find((p) => p.id === KEY); if (!rec) { rec = { id: KEY }; db.policy.push(rec); }
    const before = clone(getReceipts(db)); rec.receipts = { enabled: on, updatedBy: ctx.by, updatedDate: ctx.today }; G.audit(db, ctx, "ReceiptSms", KEY, "Changed", before, clone(getReceipts(db)), a.reason); return getReceipts(db);
  }
  function receiptText(db, e, asOf) {
    const k = RECEIPT_KIND[e.type], amount = money(e.amount), day = D.isISO(e.date) ? Number(e.date.slice(8, 10)) + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(e.date.slice(5, 7)) - 1] : "";
    const sav = Math.round(L.memberPosition(db, e.memberId).savings), loans = L.activeLoans(db).filter((l) => !l.voided && l.memberId === e.memberId && /^Active$/i.test(String(l.status))), owed = Math.round(loans.reduce((x, l) => x + L.loanOutstanding(l, db, asOf), 0));
    if (e.type === "Loan Repayment" && e.viaSavings) {          // paid from the member's own savings: say so plainly (no cash came in)
      const all = owed <= 0, h2 = (d) => "SOB: " + (all ? "Your loan was fully paid from your savings (" + amount + ")" : amount + " of your loan was paid from your savings") + (d && day ? " on " + day : "") + ".", sb2 = " Savings bal " + money(sav) + ".", lb2 = all ? " Loan cleared." : " Loan bal " + money(owed) + ".";
      for (const t of [h2(true) + sb2 + lb2, h2(false) + sb2 + lb2, h2(false) + lb2]) if (t.length <= RECEIPT_MAX) return t; return h2(false);
    }
    const head = (d) => "SOB: " + k[0] + " " + amount + " " + k[1] + (d && day ? " " + day : "") + ".", sb = " Savings bal " + money(sav) + ".", lb = owed > 0 ? " Loan bal " + money(owed) + "." : (e.type === "Loan Repayment" ? " Loan cleared." : "");
    for (const t of [head(true) + sb + lb, head(false) + sb + lb, head(false) + sb, head(false)]) if (t.length <= RECEIPT_MAX) return t;
    return head(false);
  }
  /* ---------- INTEREST RELIEF NOTICE ----------
     When the interest on a loan was reduced by stopping it (Lock interest), the member is told how many months of interest now apply instead of how many would have, and how much was taken off.
     Facts come from the loan's own records; the officer chooses who is told and presses Send; each loan is told once per lock. Nothing here changes a loan, an entry or a balance. */
  function interestRelief(db, asOf) {
    asOf = asOf || D.todayISO();
    return (db.loans || []).filter((l) => !l.voided && l.status === "Active" && (l.interestLocks || []).length && D.isISO(l.date)).map((l) => {
      const open = Object.assign({}, l, { interestLocks: [] }), monthsNow = L.loanMonthsAfterGrace(l, asOf), monthsBefore = L.loanMonthsAfterGrace(open, asOf);
      const cut = Math.max(0, Math.round(L.loanAccumulatedInterest(open, asOf, db) - L.loanAccumulatedInterest(l, asOf, db))), key = "relief:" + l.id + ":" + (l.interestLocks || []).map((x) => x.from + ">" + (x.to || "")).join(",");
      const told = (db.outbox || []).some((m) => m.dedupeKey === key && m.status !== "CANCELLED" && m.status !== "FAILED");
      const owed = Math.round(L.loanOutstanding(l, db, asOf)), member = (db.members || []).find((m) => m.id === l.memberId) || {};
      const text = (l.memberId || "SOB") + ": Good news. Interest on your loan is now charged for " + monthsNow + " month" + (monthsNow === 1 ? "" : "s") + " instead of " + monthsBefore + ", to help you pay. Interest reduced by " + money(cut) + ". Loan bal " + money(owed) + ".";
      return { loanId: l.id, memberId: l.memberId, name: member.name || l.memberName || l.memberId, monthsNow, monthsBefore, cut, owed, key, told, hasPhone: !!N.normalizePhone(member.phone), text, eligible: cut > 0 && monthsBefore > monthsNow };
    });
  }
  function sendInterestRelief(db, ctx, a) {
    G.require(ctx, "loan.editInterest"); const ids = (a && a.loanIds) || []; if (!ids.length) throw new Error("REQUIRED: choose at least one loan");
    const by = {}; interestRelief(db, ctx.today).forEach((r) => { by[r.loanId] = r; }); const out = { queued: [], skipped: [] };
    ids.forEach((id) => { const r = by[id];
      if (!r || !r.eligible) return out.skipped.push({ loanId: id, why: "no interest reduction to report" });
      if (r.told) return out.skipped.push({ loanId: id, why: "already told" });
      const m = N.queue(db, ctx, { memberId: r.memberId, template: "transactionReceipt", vars: { text: r.text }, dedupeKey: r.key, channel: "SMS" });
      G.audit(db, ctx, "ReceiptSms", m.id, "Interest relief notice", null, { loanId: id, memberId: r.memberId, monthsNow: r.monthsNow, monthsBefore: r.monthsBefore, cut: r.cut, status: m.status }, "Member told that interest was reduced");
      out.queued.push({ loanId: id, msgId: m.id, status: m.status, reason: m.reason }); });
    return out;
  }
  /* called after a command succeeded (commands.js); queues at most one receipt per entry; never throws into a financial command */
  function receiptAfter(db, ctx, name, args, result) {
    try {
      if (!getReceipts(db).enabled) return; args = args || {}; let e = null;
      if (name === "createEntry" || name === "recordSubscription" || name === "approveEntry") e = result;
      else if (name === "repayLoan" || name === "settleLoanFromSavings") e = (db.transactions || []).slice().reverse().find((t) => t.loanId === args.loanId && t.type === "Loan Repayment");
      else if (name === "disburseLoan") e = (db.transactions || []).slice().reverse().find((t) => t.loanId === args.loanId && t.type === "Loan Disbursement");
      if (!e || !e.memberId || !RECEIPT_KIND[e.type] || e.approvalStatus !== "Approved" || e.voided) return;
      if (e.importBatch || e.historical || e.sourceRef || e.splitFrom || e.correctsId) return;              // imported / corrected entries never send receipts
      if (e.type === "Withdraw" && !(ctx.approvedRequest || (e.approvedBy && e.approvedBy !== e.createdBy))) { G.audit(db, ctx, "ReceiptSms", e.id, "Not sent", null, { memberId: e.memberId, type: e.type }, "Withdrawal receipt waits for approval by someone other than the person who entered it"); return; }
      N.queue(db, ctx, { memberId: e.memberId, template: "transactionReceipt", vars: { text: receiptText(db, e, ctx.today) }, dedupeKey: "rcpt:" + e.id, channel: "SMS" });
    } catch (x) { /* a notification problem must never block a financial command */ }
  }
  /* sends the receipts just queued, if the SMS gateway is live; otherwise they are cancelled with the reason (never left to go out late); each outcome is audited */
  function sendReceipts(db, ctx, gateways, ids) {
    const live = !!(gateways && gateways.SMS && gateways.SMS.live === true), mine = (db.outbox || []).filter((m) => ids.includes(m.id) && m.status === "QUEUED");
    if (!live) mine.forEach((m) => { m.status = "CANCELLED"; m.reason = "SMS gateway is not live: receipt not sent"; });
    else if (mine.length) N.dispatch(db, ctx, gateways, { ids: mine.map((m) => m.id) });
    (db.outbox || []).filter((m) => ids.includes(m.id)).forEach((m) => G.audit(db, ctx, "ReceiptSms", m.id, m.status === "SENT" ? "Sent" : m.status === "SKIPPED" ? "Skipped" : m.status === "FAILED" ? "Failed" : "Not sent", null,
      { memberId: m.memberId, to: m.to ? m.to.slice(0, -3).replace(/\d/g, "*") + m.to.slice(-3) : "", status: m.status, reason: m.reason || "", text: m.body }, "Automatic transaction receipt"));
  }

  /* ---------- AUTOMATIC REMINDERS (SMS, sent by the daily schedule) ----------
     Three stages, all measured from the approved repayment deadline and configurable (db.policy "reminders".auto; the Chairperson approves any change):
       REGULAR  before the deadline, every `regularEveryDays` days, to members who still owe;
       ADMIN    after `adminAfterDays` days with no repayment since the first reminder: the member is told their name and balance will go to Church Administration;
       BISHOP   when `bishopDaysBefore` days (or fewer) remain before the deadline and the loan is still unpaid: the member is told the matter will go to the Bishop.
     Nothing is sent unless it is switched on AND the SMS gateway is live and tested. Each message is an ordinary reminder record (figures re-verified, audited), never longer than 50 characters.
     Each stage goes once per loan per deadline; a failed send is cancelled with its reason and retried at the next run. No ledger entry, loan or balance is ever changed. */
  const AUTO_DEFAULTS = { enabled: false, regularEveryDays: 7, adminAfterDays: 3, bishopDaysBefore: 2 };
  const STAGE_LEVEL = { REGULAR: "FRIENDLY", ADMIN: "URGENT", BISHOP: "FINAL" };
  const STAGE_LABEL = { REGULAR: "Regular reminder", ADMIN: "Notice: name goes to Church Administration", BISHOP: "Serious reminder: matter goes to the Bishop" };
  function getAuto(db) {
    const a = (((db && db.policy) || []).find((p) => p.id === KEY) || {}).auto || {}, n = (k) => (Number.isInteger(Number(a[k])) && a[k] !== "" && a[k] !== null && a[k] !== undefined ? Number(a[k]) : AUTO_DEFAULTS[k]);
    return { enabled: a.enabled === true, regularEveryDays: n("regularEveryDays"), adminAfterDays: n("adminAfterDays"), bishopDaysBefore: n("bishopDaysBefore"), updatedBy: a.updatedBy || "", updatedDate: a.updatedDate || "" };
  }
  function setAuto(db, ctx, a) {
    G.require(ctx, "policy.manage"); a = a || {}; G.need(a.reason, "reason"); const cur = getAuto(db);
    const int = (k, lo, hi, what) => { const v = a[k] === undefined ? cur[k] : Number(a[k]); if (!Number.isInteger(v) || v < lo || v > hi) throw new Error("INVALID: " + what + " must be a whole number from " + lo + " to " + hi); return v; };
    const next = { enabled: a.enabled === undefined ? cur.enabled : a.enabled === true || a.enabled === "true" || a.enabled === "yes", regularEveryDays: int("regularEveryDays", 1, 30, "days between regular reminders"), adminAfterDays: int("adminAfterDays", 1, 30, "days of non-payment before the Church Administration notice"), bishopDaysBefore: int("bishopDaysBefore", 0, 14, "days before the deadline for the Bishop notice") };
    db.policy = db.policy || []; let rec = db.policy.find((p) => p.id === KEY); if (!rec) { rec = { id: KEY }; db.policy.push(rec); }
    const before = clone(getAuto(db)); rec.auto = Object.assign({}, next, { updatedBy: ctx.by, updatedDate: ctx.today });
    G.audit(db, ctx, "AutoReminders", KEY, "Changed", before, clone(getAuto(db)), a.reason); return getAuto(db);
  }
  function autoRun(db, ctx, gateways) {
    G.require(ctx, "notify.manage"); const auto = getAuto(db), today = ctx.today, out = { date: today, enabled: auto.enabled, sent: [], skipped: [], failed: [], note: "" };
    if (!auto.enabled) { out.note = "Automatic reminders are switched off. Nothing was sent."; return out; }
    if (!(gateways && gateways.SMS && gateways.SMS.live === true)) { out.note = "The SMS gateway is not live (set up and tested). Nothing was sent."; G.audit(db, ctx, "AutoReminderRun", today, "Run skipped", null, { reason: out.note }, "Scheduled daily run"); return out; }
    const cfg = getConfig(db), done = (r) => r.delivery === "SMS_ACCEPTED" || r.delivery === "SENT_CONFIRMED";
    for (const loan of L.activeLoans(db).filter((l) => !l.voided)) {
      let rec = null;
      try {
        const member = (db.members || []).find((m) => m.id === loan.memberId);
        if (!member || !/^Active$/i.test(String(member.status || "Active"))) { out.skipped.push({ loanId: loan.id, reason: "member not active" }); continue; }
        if (member.notifyOptOut) { out.skipped.push({ loanId: loan.id, memberId: member.id, reason: "member switched notifications off" }); continue; }
        if (!N.normalizePhone(member.phone)) { out.skipped.push({ loanId: loan.id, memberId: member.id, reason: "no valid phone number" }); continue; }
        const f = figures(db, loan, today); if (f.error) { out.skipped.push({ loanId: loan.id, reason: f.error }); continue; } if (!(f.totalOutstanding > 0)) continue;
        const sch = schedule(db, cfg, loan, today); if (sch.error) { out.note = sch.error; break; }
        if (sch.daysToDeadline < 0) { out.skipped.push({ loanId: loan.id, memberId: member.id, reason: "deadline has passed: officers follow up" }); continue; }
        const mine = (db.reminders || []).filter((r) => r.auto && r.loanId === loan.id && r.deadline === sch.deadline && done(r)), has = (st) => mine.some((r) => r.stage === st);
        const first = mine.slice().sort((x, y) => (x.asOf < y.asOf ? -1 : 1))[0], last = mine.slice().sort((x, y) => (x.asOf < y.asOf ? 1 : -1))[0];   // "last" = the latest automatic message of any kind, so the daily countdown carries on between the two notices
        const repaidSince = first && L.activeTransactions(db).some((t) => t.loanId === loan.id && t.type === "Loan Repayment" && t.date > first.asOf);
        let stage = null;
        if (sch.daysToDeadline <= auto.bishopDaysBefore && !has("BISHOP")) stage = "BISHOP";
        else if (first && !has("ADMIN") && !has("BISHOP") && !repaidSince && daysBetween(first.asOf, today) >= auto.adminAfterDays) stage = "ADMIN";
        else if (!last || daysBetween(last.asOf, today) >= auto.regularEveryDays) stage = "REGULAR";
        if (!stage) continue;
        rec = prepare(db, ctx, { loanId: loan.id, level: STAGE_LEVEL[stage] }); rec.auto = true; rec.stage = stage;
        const q = queueSms(db, ctx, { id: rec.id }); N.dispatch(db, ctx, gateways, { ids: [q.outboxId] }); syncSms(db, ctx, { id: rec.id });
        if (rec.delivery === "SMS_ACCEPTED") out.sent.push({ loanId: loan.id, memberId: member.id, stage, reminderId: rec.id, sms: rec.smsBody });
        else { cancel(db, ctx, { id: rec.id, reason: "Automatic SMS was not accepted by the gateway; it will be tried again at the next run" }); out.failed.push({ loanId: loan.id, memberId: member.id, stage }); }
      } catch (e) {
        if (rec && rec.delivery !== "SMS_ACCEPTED" && rec.delivery !== "CANCELLED") { try { cancel(db, ctx, { id: rec.id, reason: "Automatic reminder could not be completed: " + String(e.message).slice(0, 120) }); } catch (x) { /* already closed */ } }
        out.skipped.push({ loanId: loan.id, reason: String(e.message).replace(/^[A-Z_]+: /, "").slice(0, 160) });
      }
    }
    G.audit(db, ctx, "AutoReminderRun", today, "Automatic reminders run", null, { sent: out.sent.length, skipped: out.skipped.length, failed: out.failed.length, stages: out.sent.map((x) => x.memberId + ":" + x.stage) }, "Scheduled daily run");
    return out;
  }
  return { getReceipts, setReceipts, interestRelief, sendInterestRelief, receiptAfter, sendReceipts, receiptText, getAuto, setAuto, autoRun, AUTO_DEFAULTS, STAGE_LABEL, getEscalation, setEscalation, escalationPlan, queueEscalation, KEY, LEVELS, LEVEL_LABEL, DELIVERY, DELIVERY_LABEL, FOLLOW, FOLLOW_LABEL, PLACEHOLDERS, FIELDS, DEFAULT_TEMPLATES, SMS_TEMPLATES, composeSms, getConfig, setSettings, setDates, figures, candidates, schedule, recommendedLevel, compose, waLink, prepare, prepareMany, revalidate, markOpened, queueSms, syncSms, confirmSent, setFollowUp, cancel, daysBetween, eatTime, eatDate, money };
});
