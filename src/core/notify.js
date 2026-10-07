/* SOB core/notify — SMS / WhatsApp notification framework. SAFE BY DEFAULT: every message is rendered into an OUTBOX record; nothing leaves the
   system unless a gateway adapter reports `live: true` (which needs real credentials set server-side). Without one, messages are marked
   DRY_RUN ("rendered, NOT sent"). A message is only ever marked SENT after a live adapter confirmed it. Failures are logged, never hidden. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./governance.js") : root.SOB.gov, isNode ? require("./dates.js") : root.SOB.dates);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.notify = api; }
})(typeof self !== "undefined" ? self : this, function (G, D) {
  const CHANNELS = ["SMS", "WHATSAPP"];
  const MAX_ATTEMPTS = 3;
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
    custom: (v) => String(v.text || "").slice(0, 320)
  };
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
      body: render(o.template, o.vars), status, reason, dedupeKey: o.dedupeKey || "", attempts: 0, mode: "" };
    outbox.push(rec);
    return rec;
  }
  /* Dispatch: gateways = { SMS: adapter|null, WHATSAPP: adapter|null, adminPhone }. adapter = { live:boolean, send(msg)->{ok,providerRef?,error?} }. */
  function dispatch(db, ctx, gateways, o) {
    G.require(ctx, "notify.manage");
    gateways = gateways || {};
    const limit = (o && o.limit) || 100;
    const out = { sent: 0, failed: 0, dryRun: 0, skipped: 0 };
    const todo = (db.outbox || []).filter((m) => m.status === "QUEUED" || m.status === "DRY_RUN" || (m.status === "FAILED" && m.attempts < MAX_ATTEMPTS)).slice(0, limit);
    todo.forEach((m) => {
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
  /* Automatic, best-effort notices after a successful command. Never allowed to break the command itself. */
  function onCommand(db, ctx, name, args, result) {
    try {
      const q = (memberId, template, vars, key) => queue(db, ctx, { memberId, template, vars, dedupeKey: key });
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
  return { CHANNELS, MAX_ATTEMPTS, TEMPLATES, normalizePhone, render, queue, dispatch, cancel, send, setOptOut, onCommand, summary };
});
