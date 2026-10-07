/* SOB core/governance — roles, permissions, audit trail, controlled corrections.
   Nothing financial is ever deleted: corrections are void/restore with a reason, fully logged.
   Open SOB decisions (Committee split, approval policy) are explicit config, defaulting to the SAFE side. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.gov = api; }
})(typeof self !== "undefined" ? self : this, function (dates, ledger) {
  const ALL = ["ledger.create", "ledger.void", "ledger.restore", "ledger.approve", "loan.apply", "loan.review", "loan.disburse",
    "loan.repay", "loan.editInterest", "loan.reverse", "guarantee.manage", "subscription.record", "shareout.preview",
    "shareout.execute", "reconcile.manage", "member.manage", "report.view", "audit.view", "system.admin"];

  // Committee permissions are an OPEN SOB DECISION (Q5). Safe default = read-only. Set via config.committeePermissions.
  const config = {
    committeePermissions: null,
    // Approval policy is an OPEN SOB DECISION (Q6). Default: no entry type needs a second person.
    approval: { requiredTypes: [], separateApprover: true }
  };
  const PERMS = {
    Admin: () => ALL,
    Committee: () => config.committeePermissions || ["report.view", "shareout.preview"],
    Member: () => ["self.view", "loan.apply", "report.self"]
  };
  const can = (ctx, action) => !!ctx && (PERMS[ctx.role] || (() => []))().includes(action);
  function require_(ctx, action) {
    if (!can(ctx, action)) throw new Error("FORBIDDEN: role '" + (ctx && ctx.role) + "' may not " + action);
  }
  const need = (v, name) => { if (v === undefined || v === null || String(v).trim() === "") throw new Error("REQUIRED: " + name); return String(v).trim(); };

  let seq = 0;
  const uid = (p) => p + "-" + Date.now().toString(36).toUpperCase().slice(-4) + (++seq).toString(36).toUpperCase().padStart(2, "0") + Math.random().toString(36).slice(2, 5).toUpperCase();

  function makeCtx(user, over) {
    const now = dates.nowInEAT().toISOString();
    return Object.assign({ by: user.name, userId: user.id, role: user.role, memberId: user.memberId || null, now, today: now.slice(0, 10) }, over || {});
  }

  function audit(db, ctx, entityType, entityId, action, previousValue, newValue, reason) {
    (db.auditLog = db.auditLog || []).push({
      id: uid("AUD"), timestamp: ctx.now, date: ctx.today, entityType, entityId, action,
      previousValue: previousValue === undefined ? null : previousValue, newValue: newValue === undefined ? null : newValue,
      by: ctx.by, role: ctx.role, reason: reason || ""
    });
  }

  /* --- ledger entries: the single place money movements are created --- */
  function createEntry(db, ctx, e) {
    require_(ctx, "ledger.create");
    const amount = Number(e.amount);
    if (!(amount > 0)) throw new Error("INVALID: amount must be a positive number");
    if (!dates.isISO(e.date)) throw new Error("INVALID: date must be YYYY-MM-DD");
    need(e.type, "type");
    if (e.memberId && !db.members.some((m) => m.id === e.memberId)) throw new Error("UNKNOWN_MEMBER: " + e.memberId);
    const needsApproval = config.approval.requiredTypes.includes(e.type);
    const entry = Object.assign({}, e, {
      id: e.id || uid("TXN"), amount, createdBy: ctx.by, createdByRole: ctx.role, createdAt: ctx.now,
      approvalStatus: needsApproval ? "PendingApproval" : "Approved"
    });
    if (e.memberId && !entry.memberName) entry.memberName = db.members.find((m) => m.id === e.memberId).name;
    if (!needsApproval) { entry.approvedBy = ctx.by; entry.approvedAt = ctx.now; }
    db.transactions.push(entry);
    audit(db, ctx, "Transaction", entry.id, "Created", null, { type: entry.type, amount, memberId: entry.memberId, date: entry.date });
    return entry;
  }
  function approveEntry(db, ctx, id, decision, reason) {
    require_(ctx, "ledger.approve");
    const t = db.transactions.find((x) => x.id === id);
    if (!t || t.approvalStatus !== "PendingApproval") throw new Error("NOT_PENDING: " + id);
    if (config.approval.separateApprover && t.createdBy === ctx.by) throw new Error("SEPARATION: creator cannot approve their own entry");
    const next = decision === "reject" ? "Rejected" : "Approved";
    if (next === "Rejected") need(reason, "reason");
    audit(db, ctx, "Transaction", id, next, t.approvalStatus, next, reason);
    t.approvalStatus = next; t.approvedBy = ctx.by; t.approvedAt = ctx.now;
    return t;
  }
  function voidEntry(db, ctx, id, reason) {
    require_(ctx, "ledger.void");
    need(reason, "reason");
    const t = db.transactions.find((x) => x.id === id);
    if (!t) throw new Error("NOT_FOUND: " + id);
    if (t.voided) throw new Error("ALREADY_VOIDED: " + id);
    Object.assign(t, { voided: true, voidReason: reason.trim(), voidDate: ctx.today, voidTimestamp: ctx.now, voidedByRole: ctx.role, voidedBy: ctx.by });
    audit(db, ctx, "Transaction", id, "Voided", { voided: false }, { voided: true }, reason);
    return t;
  }
  function restoreEntry(db, ctx, id, reason) {
    require_(ctx, "ledger.restore");
    need(reason, "reason");
    const t = db.transactions.find((x) => x.id === id);
    if (!t || !t.voided) throw new Error("NOT_VOIDED: " + id);
    if (!ledger.withinRestoreWindow(t, new Date(ctx.now).getTime())) throw new Error("RESTORE_WINDOW_CLOSED: record stays voided; enter a new correcting entry");
    Object.assign(t, { voided: false, restoredReason: reason.trim(), restoredDate: ctx.today, restoredTimestamp: ctx.now, restoredByRole: ctx.role, restoredBy: ctx.by });
    audit(db, ctx, "Transaction", id, "Restored", { voided: true }, { voided: false }, reason);
    return t;
  }

  /* --- members --- */
  function addMember(db, ctx, m) {
    require_(ctx, "member.manage");
    const id = m.id || "SOB-" + String(db.members.length + 1).padStart(3, "0");
    if (db.members.some((x) => x.id === id)) throw new Error("DUPLICATE_MEMBER: " + id);
    const member = { id, name: need(m.name, "name"), phone: m.phone || "", email: m.email || "", location: m.location || "", regDate: m.regDate || ctx.today, status: "Active" };
    db.members.push(member);
    audit(db, ctx, "Member", id, "Created", null, member);
    return member;
  }

  return { ALL, config, can, require: require_, need, uid, makeCtx, audit, createEntry, approveEntry, voidEntry, restoreEntry, addMember };
});
