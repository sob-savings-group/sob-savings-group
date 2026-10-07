/* SOB core/airtime — emergency airtime requests (rules carried over from the legacy system):
   UGX 20,000 total airtime per member per calendar month; blocked while the member has any unpaid loan; flat UGX 200 two-way SMS fee
   shown before submission; the member's savings (airtime + fee) are debited by a normal, audited Withdraw entry only when Admin FULFILS.
   Pending requests reserve the member's available savings (savings minus live guarantees minus other pending requests). */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./governance.js") : root.SOB.gov, isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger,
    isNode ? require("./loans.js") : root.SOB.loans, isNode ? require("./notify.js") : root.SOB.notify);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.airtime = api; }
})(typeof self !== "undefined" ? self : this, function (G, D, L, LN, N) {
  const MONTHLY_CAP = 20000, SMS_FEE = 200;
  const COUNTS = ["Pending", "Approved", "Fulfilled"];
  const list = (db) => (db.airtimeRequests = db.airtimeRequests || []);
  const usedThisMonth = (db, memberId, date) => list(db).filter((r) => r.memberId === memberId && COUNTS.includes(r.status) && String(r.date).slice(0, 7) === String(date).slice(0, 7))
    .reduce((a, r) => a + Number(r.airtimeAmount), 0);
  const reserved = (db, memberId, exceptId) => list(db).filter((r) => r.memberId === memberId && r.status === "Pending" && r.id !== exceptId).reduce((a, r) => a + Number(r.total), 0);
  function eligibility(db, memberId, date) {
    const used = usedThisMonth(db, memberId, date);
    const blockedByLoan = L.memberHasOutstandingLoan(db, memberId, date);
    const available = LN.guarantorAvailable(db, memberId) - reserved(db, memberId);
    return { monthlyCap: MONTHLY_CAP, fee: SMS_FEE, used, remaining: Math.max(0, MONTHLY_CAP - used), blockedByLoan, availableSavings: available };
  }
  function request(db, ctx, a) {
    let memberId;
    if (ctx.role === "Member") { G.require(ctx, "airtime.request"); memberId = ctx.memberId; }   // a Member can only ever request for themselves
    else { G.require(ctx, "airtime.manage"); memberId = G.need(a.memberId, "memberId"); }
    const member = (db.members || []).find((m) => m.id === memberId);
    if (!member || member.status === "Inactive") throw new Error("UNKNOWN_MEMBER: " + memberId);
    const amount = Number(a.amount);
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("INVALID: airtime amount must be a whole number of UGX above zero");
    const e = eligibility(db, memberId, ctx.today);
    if (e.blockedByLoan) throw new Error("BLOCKED_BY_LOAN: airtime is not available while you have an unpaid loan");
    if (amount > e.remaining) throw new Error("OVER_MONTHLY_CAP: only UGX " + e.remaining.toLocaleString("en-US") + " of the UGX " + MONTHLY_CAP.toLocaleString("en-US") + " monthly limit remains");
    const total = amount + SMS_FEE;
    if (total > e.availableSavings) throw new Error("INSUFFICIENT_SAVINGS: airtime plus fee (UGX " + total.toLocaleString("en-US") + ") exceeds available savings (UGX " + Math.max(0, e.availableSavings).toLocaleString("en-US") + ")");
    const phone = N.normalizePhone(a.phone || member.phone);
    if (!phone) throw new Error("INVALID: a valid Uganda phone number is required (e.g. 0772123456)");
    const req = { id: G.uid("AIR"), date: ctx.today, memberId, memberName: member.name, phone, airtimeAmount: amount, fee: SMS_FEE, total, status: "Pending", createdBy: ctx.by };
    list(db).push(req);
    G.audit(db, ctx, "Airtime", req.id, "Requested", null, { memberId, amount, fee: SMS_FEE, phone });
    N.queue(db, ctx, { memberId, template: "airtimeRequested", vars: { amount, fee: SMS_FEE, ref: req.id }, dedupeKey: "airreq:" + req.id });
    N.queue(db, ctx, { to: "ADMIN", template: "airtimeAdminAlert", vars: { name: member.name, memberId, amount, phone }, dedupeKey: "airadmin:" + req.id });
    return req;
  }
  const find = (db, id) => { const r = list(db).find((x) => x.id === id); if (!r) throw new Error("NOT_FOUND: " + id); return r; };
  function fulfil(db, ctx, id) {
    G.require(ctx, "airtime.manage");
    const r = find(db, id);
    if (r.status !== "Pending") throw new Error("NOT_PENDING: " + id + " is " + r.status);
    if (r.total > LN.guarantorAvailable(db, r.memberId) - reserved(db, r.memberId, r.id)) throw new Error("INSUFFICIENT_SAVINGS: available savings no longer cover this request");
    if (L.memberHasOutstandingLoan(db, r.memberId, ctx.today)) throw new Error("BLOCKED_BY_LOAN: member now has an unpaid loan");
    const t = G.createEntry(db, ctx, { date: ctx.today, memberId: r.memberId, amount: r.total, type: "Withdraw", purpose: "Airtime purchase (UGX " + r.airtimeAmount.toLocaleString("en-US") + " to " + r.phone + ") + UGX " + r.fee + " notification fee", airtimeRequestId: r.id });
    Object.assign(r, { status: "Fulfilled", fulfilledDate: ctx.today, fulfilledBy: ctx.by, entryId: t.id });
    G.audit(db, ctx, "Airtime", id, "Fulfilled", "Pending", "Fulfilled", "entry " + t.id);
    N.queue(db, ctx, { memberId: r.memberId, template: "airtimeFulfilled", vars: { amount: r.airtimeAmount }, dedupeKey: "airful:" + r.id });
    return r;
  }
  function reject(db, ctx, id, reason) {
    G.require(ctx, "airtime.manage"); G.need(reason, "reason");
    const r = find(db, id);
    if (r.status !== "Pending") throw new Error("NOT_PENDING: " + id + " is " + r.status);
    Object.assign(r, { status: "Rejected", rejectedDate: ctx.today, rejectedBy: ctx.by, rejectReason: reason.trim() });
    G.audit(db, ctx, "Airtime", id, "Rejected", "Pending", "Rejected", reason);
    N.queue(db, ctx, { memberId: r.memberId, template: "airtimeRejected", vars: { ref: r.id, reason: reason.trim() }, dedupeKey: "airrej:" + r.id });
    return r;
  }
  function cancel(db, ctx, id) {
    const r = find(db, id);
    if (!(G.can(ctx, "airtime.manage") || (ctx.role === "Member" && ctx.memberId === r.memberId && G.can(ctx, "airtime.request")))) throw new Error("FORBIDDEN: not your request");
    if (r.status !== "Pending") throw new Error("NOT_PENDING: " + id + " is " + r.status);
    r.status = "Cancelled"; r.cancelledDate = ctx.today;
    G.audit(db, ctx, "Airtime", id, "Cancelled", "Pending", "Cancelled");
    return r;
  }
  return { MONTHLY_CAP, SMS_FEE, usedThisMonth, eligibility, request, fulfil, reject, cancel };
});
