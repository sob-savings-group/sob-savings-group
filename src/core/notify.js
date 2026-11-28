/* SOB core/notify — SMS / WhatsApp notification framework. SAFE BY DEFAULT: every message is rendered into an OUTBOX record; nothing leaves the
   system unless a gateway adapter reports `live: true` (which needs real credentials set server-side). Without one, messages are marked
   DRY_RUN ("rendered, NOT sent"). A message is only ever marked SENT after a live adapter confirmed it. Failures are logged, never hidden. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./governance.js") : root.SOB.gov, isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./templates.js") : root.SOB.templates);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.notify = api; }
})(typeof self !== "undefined" ? self : this, function (G, D, TP) {
  const CHANNELS = ["SMS", "WHATSAPP"];
  const MAX_ATTEMPTS = 3;
  const RECEIPT_TEMPLATES = ["receipt", "repaymentReceived", "loanDisbursed", "transactionReceipt"];
  const receiptsOn = (db) => { const r = ((db && db.policy) || []).find((p) => p.id === "reminders"); return !!(r && r.receipts && r.receipts.enabled === true); };
  const money = (n) => "UGX " + Math.round(Number(n) || 0).toLocaleString("en-US");
  const TEMPLATES = {
    receipt: (v) => "SOB: we received " + money(v.amount) + " (" + v.type + ") on " + D.toDisplay(v.date) + ". Ref " + v.ref + ".",
    loanApproved: (v) => "SOB: your loan application of " + money(v.amount) + " has been approved. Ref " + v.ref + ".",
    loanDeclined: (v) => "SOB: your loan application of " + money(v.amount) + " was not approved." + (v.reason ? " Reason: " + v.reason : "") + " Ref " + v.ref + ".",
    loanDisbursed: (v) => "SOB: loan " + v.ref + " of " + money(v.amount) + " has been disbursed.",
    repaymentReceived: (v) => "SOB: loan repayment of " + money(v.amount) + " received on " + D.toDisplay(v.date) + ". Loan " + v.ref + ".",
    shareOut: (v) => "SOB: December " + v.year + " share-out recorded. Your savings withdrawn: " + money(v.amount) + ".",
    airtimeRequested: (v) => "SOB: airtime request " + v.ref + " of " + money(v.amount) + " received (fee " + money(v.fee) + "). Awaiting approval.",
    airtimeAdminAlert: (v) => "SOB Airtime request: " + v.name + " (" + v.memberId + ") wants " + money(v.amount) + " to " + v.phone + ". Open the app to fulfil.",
    airtimeFulfilled: (v) => "SOB: your airtime request of " + money(v.amount) + " has been fulfilled. Thank you.",
    airtimeRejected: (v) => "SOB: your airtime request " + v.ref + " was not approved." + (v.reason ? " Reason: " + v.reason : ""),
    repaymentReminder: (v) => "SOB: reminder - loan " + v.ref + " balance is " + money(v.amount) + " as of " + D.toDisplay(v.date) + ".",
    signIn: (v) => "SOB: your sign-in has been set up. Member ID " + v.id + ". Ask the Admin for your PIN in person.",
    loanReminderSms: (v) => String(v.text || ""),
    transactionReceipt: (v) => String(v.text || ""),
    custom: (v) => String(v.text || "").slice(0, 320)
  };
  /* The wording of the editable messages comes from the Message wording setting (core/templates); everything else is fixed. A broken saved wording falls back to the default. */
  const prep = (v) => ({ amount: money(v.amount), date: D.toDisplay(v.date), ref: v.ref, type: v.type, year: v.year, fee: money(v.fee), reasonLine: v.reason ? " Reason: " + v.reason : "" });
  function renderFor(db, template, vars) { return TP && TP.has(template) ? TP.render(db, template, prep(vars || {})) : render(template, vars); }
  /* Uganda numbers: 07XXXXXXXX / 2567XXXXXXXX / +2567XXXXXXXX -> +2567XXXXXXXX. Anything else is rejected (never guessed). */
  function normalizePhone(p) {
    const s = String(p == null ? "" : p).replace(/[\s\-().]/g, "");
    let m;
    if ((m = /^\+?256(\d{9})$/.exec(s))) return "+256" + m[1];
    if ((m = /^0(\d{9})$/.exec(s))) return "+256" + m[1];
    return null;
  }
  function render(template, vars) {
    if (!Object.prototype.hasOwnProperty.call(TEMPLATES, template)) throw new Error("UNKNOWN_TEMPLATE: " + template);
    return TEMPLATES[template](vars || {});
  }
  /* Every SMS says who it is for: the member's SOB ID replaces a bare "SOB:" at the start, so a wrong recipient can see it is not theirs. Safe to apply twice. */
  function identify(body, id) {
    body = String(body == null ? "" : body); id = String(id || ""); if (!id || body.indexOf(id) === 0) return body;
    const m = /^SOB( FINAL)?:\s*/.exec(body); return m ? id + ": " + (m[1] ? "FINAL: " : "") + body.slice(m[0].length) : id + ": " + body;
  }
  /* A number is "confirmed" when the member proved it (typed the code sent to it) or an officer confirmed it by speaking to the member. A new or changed number is not confirmed. */
  const phoneConfirmed = (m) => !!(m && m.phoneConfirmed && m.phoneConfirmedNo && m.phoneConfirmedNo === normalizePhone(m.phone));
  const RULE_ID = "SMS_RULE", NOT_CONFIRMED_TEXT = "SOB: You have a notice about your account. Please open the app or call the Treasurer.";
  const getSmsRule = (db) => { const r = ((db && db.policy) || []).find((p) => p.id === RULE_ID) || {}; return { requireConfirmed: r.requireConfirmed === true, updatedBy: r.updatedBy || "", updatedDate: r.updatedDate || "" }; };
  const NO_RULE_TEMPLATES = ["signIn", "custom"];   // no money details in these
  /* Internal: create an outbox record. Never throws for "cannot deliver" cases — those become SKIPPED with a visible reason. */
  function queue(db, ctx, o) {
    const channel = (o.channel || "SMS").toUpperCase();
    if (!CHANNELS.includes(channel)) throw new Error("INVALID: channel");
    const outbox = (db.outbox = db.outbox || []);
    if (o.dedupeKey) { const ex = outbox.find((x) => x.dedupeKey === o.dedupeKey && x.status !== "CANCELLED"); if (ex) return ex; }
    const member = o.memberId ? (db.members || []).find((m) => m.id === o.memberId) : null;
    let to = o.to === "ADMIN" ? "ADMIN" : normalizePhone(o.to || (member && member.phone));
    let status = "QUEUED", reason = "";
    if (member && member.notifyOptOut) { status = "SKIPPED"; reason = "OPTED_OUT"; }
    else if (!to) { status = "SKIPPED"; reason = "NO_VALID_PHONE"; }
    const rec = { id: G.uid("MSG"), createdAt: ctx.now, createdBy: ctx.by, memberId: o.memberId || "", to: to || "", channel, template: o.template,
      body: channel === "SMS" && member ? identify(renderFor(db, o.template, o.vars), member.id) : renderFor(db, o.template, o.vars), status, reason, dedupeKey: o.dedupeKey || "", attempts: 0, mode: "" };
    /* when the committee switched the rule on, amounts and warnings go only to a confirmed number; any other number gets a plain notice */
    if (channel === "SMS" && member && status === "QUEUED" && !NO_RULE_TEMPLATES.includes(o.template) && getSmsRule(db).requireConfirmed && !phoneConfirmed(member)) { rec.body = identify(NOT_CONFIRMED_TEXT, member.id); rec.downgraded = true; rec.reason = "Number not confirmed: sent a plain notice without amounts"; }
    outbox.push(rec);
    return rec;
  }
  /* Dispatch: gateways = { SMS: adapter|null, WHATSAPP: adapter|null, adminPhone }. adapter = { live:boolean, send(msg)->{ok,providerRef?,error?} }. */
  function dispatch(db, ctx, gateways, o) {
    G.require(ctx, "notify.manage");
    gateways = gateways || {};
    const limit = (o && o.limit) || 100;
    const out = { sent: 0, failed: 0, dryRun: 0, skipped: 0 };
    const only = o && Array.isArray(o.ids) && o.ids.length ? new Set(o.ids) : null;   // a targeted run touches nothing else in the outbox; only a targeted (deliberate) run may retry a failed SMS
    const todo = (db.outbox || []).filter((m) => (!only || only.has(m.id)) && (m.status === "QUEUED" || m.status === "DRY_RUN" || (m.status === "FAILED" && m.attempts < (m.channel === "SMS" && !only ? 1 : MAX_ATTEMPTS)))).slice(0, limit);
    todo.forEach((m) => {
      /* A receipt is only worth sending while it is fresh: an old queued one (made while no gateway was live) is cancelled, never sent late, so members are not flooded with old news. */
      if (RECEIPT_TEMPLATES.includes(m.template) && Date.parse(ctx.now) - Date.parse(m.createdAt) > 3 * 86400000) { m.status = "CANCELLED"; m.reason = "STALE_RECEIPT: older than 3 days, not sent"; out.skipped++; return; }
      const ad = gateways[m.channel];
      const to = m.to === "ADMIN" ? normalizePhone(gateways.adminPhone) : m.to;
      m.lastAttemptAt = ctx.now;
      if (!to) { m.status = "SKIPPED"; m.reason = "NO_VALID_PHONE"; out.skipped++; return; }
      if (!ad || ad.live !== true) { m.status = "DRY_RUN"; m.mode = "DRY_RUN"; m.reason = "NO_LIVE_GATEWAY"; out.dryRun++; return; }
      m.attempts = (m.attempts || 0) + 1;
      let r;
      try { r = ad.send({ id: m.id, to, body: m.body, channel: m.channel }); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
      if (r && r.ok === true) { m.status = "SENT"; m.mode = "LIVE"; m.providerRef = r.providerRef || ""; m.reason = ""; out.sent++; }
      else {
        m.status = "FAILED"; m.reason = String((r && r.error) || "UNKNOWN_ERROR").slice(0, 300); out.failed++;
        (db.smsFailures = db.smsFailures || []).push({ id: G.uid("SMF"), date: ctx.today, context: m.template + " -> " + (m.memberId || "admin") + " (" + m.channel + ")", error: m.reason });
      }
    });
    if (todo.length) G.audit(db, ctx, "Outbox", "dispatch", "Dispatch run", null, out);
    return out;
  }
  function cancel(db, ctx, id, reason) {
    G.require(ctx, "notify.manage"); G.need(reason, "reason");
    const m = (db.outbox || []).find((x) => x.id === id);
    if (!m) throw new Error("NOT_FOUND: " + id);
    if (m.status === "SENT") throw new Error("ALREADY_SENT: " + id);
    const prev = m.status; m.status = "CANCELLED"; m.reason = reason.trim();
    G.audit(db, ctx, "Outbox", id, "Cancelled", prev, "CANCELLED", reason);
    return m;
  }
  /* Manual message to a member (Admin). */
  function send(db, ctx, o) {
    G.require(ctx, "notify.manage"); G.need(o.memberId, "memberId"); G.need(o.text, "text");
    if (!(db.members || []).some((m) => m.id === o.memberId)) throw new Error("UNKNOWN_MEMBER: " + o.memberId);
    const rec = queue(db, ctx, { memberId: o.memberId, template: "custom", vars: { text: o.text }, channel: o.channel });
    G.audit(db, ctx, "Outbox", rec.id, "Queued", null, { memberId: o.memberId, template: "custom" });
    return rec;
  }
  function setOptOut(db, ctx, memberId, optOut, reason) {
    if (!(G.can(ctx, "notify.manage") || (ctx.role === "Member" && ctx.memberId === memberId))) throw new Error("FORBIDDEN: role '" + ctx.role + "' may not change notification consent for " + memberId);
    const m = (db.members || []).find((x) => x.id === memberId);
    if (!m) throw new Error("UNKNOWN_MEMBER: " + memberId);
    const prev = !!m.notifyOptOut; m.notifyOptOut = !!optOut;
    G.audit(db, ctx, "Member", memberId, optOut ? "Notifications opted out" : "Notifications opted in", prev, m.notifyOptOut, reason);
    return m;
  }
  function confirmPhones(db, ctx, a) {
    G.require(ctx, "notify.manage"); a = a || {}; G.need(a.note, "note (how you confirmed, e.g. 'phoned the member')"); const ids = [].concat(a.memberIds || []).filter(Boolean); if (!ids.length) throw new Error("INVALID: choose at least one member");
    const done = [];
    ids.forEach((id) => { const m = (db.members || []).find((x) => x.id === id); if (!m) throw new Error("UNKNOWN_MEMBER: " + id); const no = normalizePhone(m.phone); if (!no) throw new Error("NO_VALID_PHONE: " + id + " has no valid phone number to confirm");
      const before = { confirmed: phoneConfirmed(m) }; m.phoneConfirmed = ctx.today; m.phoneConfirmedNo = no; m.phoneConfirmedBy = ctx.by; G.audit(db, ctx, "Member", id, "Phone number confirmed", before, { confirmed: true, number: no }, a.note); done.push(id); });
    return { confirmed: done };
  }
  function setSmsRule(db, ctx, a) {
    G.require(ctx, "policy.manage"); a = a || {}; G.need(a.reason, "reason"); db.policy = db.policy || []; let rec = db.policy.find((p) => p.id === RULE_ID); if (!rec) { rec = { id: RULE_ID }; db.policy.push(rec); }
    const before = getSmsRule(db); rec.requireConfirmed = a.requireConfirmed === true || a.requireConfirmed === "true" || a.requireConfirmed === "yes"; rec.updatedBy = ctx.by; rec.updatedDate = ctx.today;
    G.audit(db, ctx, "SmsRule", RULE_ID, "Changed", before, getSmsRule(db), a.reason); return getSmsRule(db);
  }
  /* The Admin's own message to chosen members (for example an apology). One SMS each: the member's SOB ID is put in front, and the whole text may not pass 160 characters. */
  const GSM_OK = /^[\x20-\x7E\n]*$/;
  function sendNotice(db, ctx, a) {
    G.require(ctx, "notify.manage"); a = a || {}; const ids = [].concat(a.memberIds || []).filter(Boolean); if (!ids.length) throw new Error("INVALID: choose at least one member");
    const text = String(a.text || "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-").trim(); if (!text) throw new Error("INVALID: write the message");
    if (!GSM_OK.test(text)) throw new Error("INVALID: use plain letters and numbers only (no special characters) so it stays one SMS");
    const day = ctx.today, tag = text.length + ":" + text.split("").reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7), out = { queued: [], tooLong: [] };
    ids.forEach((id) => { const m = (db.members || []).find((x) => x.id === id); if (!m) throw new Error("UNKNOWN_MEMBER: " + id); const full = identify(text, id); if (full.length > 160) { out.tooLong.push(id); return; }
      const r = queue(db, ctx, { memberId: id, template: "custom", vars: { text: full }, channel: "SMS", dedupeKey: "MSG:" + id + ":" + day + ":" + tag }); out.queued.push({ memberId: id, outboxId: r.id, status: r.status, reason: r.reason, body: r.body }); });
    if (out.tooLong.length) throw new Error("TOO_LONG: the message is over 160 characters with the SOB ID in front, so nothing was queued. Shorten it by " + (Math.max.apply(null, out.tooLong.map((id) => identify(text, id).length)) - 160) + " characters.");
    G.audit(db, ctx, "Message", "custom", "Message queued", null, { to: ids, text }, a.reason || "Admin message to members"); return out;
  }
  /* Automatic, best-effort notices after a successful command. Never allowed to break the command itself. */
  function onCommand(db, ctx, name, args, result) {
    try {
      const q = (memberId, template, vars, key) => queue(db, ctx, { memberId, template, vars, dedupeKey: key });
      if (receiptsOn(db) && (name === "createEntry" || name === "repayLoan" || name === "disburseLoan")) return;   // the SMS receipt feature (reminders.js) replaces the plain receipts
      if (name === "createEntry" && result && result.memberId && result.approvalStatus === "Approved" && ["Savings", "Repayment", "Subscription", "Withdraw"].includes(result.type)) {
        q(result.memberId, "receipt", { amount: result.amount, type: result.type === "Withdraw" ? "Withdrawal" : result.type, date: result.date, ref: result.id }, "receipt:" + result.id);
      } else if (name === "approveLoan" || name === "declineLoan" || name === "disburseLoan") {
        const loan = (db.loans || []).find((l) => l.id === args.loanId);
        if (loan) {
          const tpl = name === "approveLoan" ? "loanApproved" : name === "declineLoan" ? "loanDeclined" : "loanDisbursed";
          q(loan.memberId, tpl, { amount: loan.loanAmount, ref: loan.id, reason: args.reason }, tpl + ":" + loan.id);
        }
      } else if (name === "repayLoan") {
        const loan = (db.loans || []).find((l) => l.id === args.loanId);
        if (loan) q(loan.memberId, "repaymentReceived", { amount: args.amount, date: args.date || ctx.today, ref: loan.id }, null);
      } else if (name === "executeShareOut" && result && result.entries) {
        result.entries.forEach((e) => q(e.memberId, "shareOut", { year: result.year, amount: e.savingsWithdrawn }, "shareout:" + result.id + ":" + e.memberId));
      }
    } catch (e) { /* notification trouble must never block a financial command */ }
  }
  function summary(db) {
    const s = { QUEUED: 0, DRY_RUN: 0, SENT: 0, FAILED: 0, SKIPPED: 0, CANCELLED: 0 };
    (db.outbox || []).forEach((m) => { s[m.status] = (s[m.status] || 0) + 1; });
    return s;
  }
  return { CHANNELS, MAX_ATTEMPTS, TEMPLATES, identify, phoneConfirmed, getSmsRule, confirmPhones, setSmsRule, sendNotice, NOT_CONFIRMED_TEXT, normalizePhone, render, queue, dispatch, cancel, send, setOptOut, onCommand, summary };
});
