/* SOB core/governance — roles, permissions, audit trail, controlled corrections.
   Nothing financial is ever deleted: corrections are void/restore with a reason, fully logged.
   Open SOB decisions (Committee split, approval policy) are explicit config, defaulting to the SAFE side. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.gov = api; }
})(typeof self !== "undefined" ? self : this, function (dates, ledger) {
  /* Roles. "Admin" is the SUPER ADMIN: the only role that can input or edit financial records. The Chairperson is the SECOND APPROVER
     (reviews/approves, never inputs). The Treasurer records routine transactions (see TREASURER_WRITE). The Secretary is view-only. "Committee" is the generic read-only reviewer. */
  const WRITE = ["ledger.create", "ledger.void", "ledger.restore", "loan.review", "loan.disburse", "loan.repay", "loan.editInterest", "loan.reverse", "guarantee.manage",
    "subscription.record", "shareout.execute", "reconcile.manage", "notify.manage", "airtime.manage", "member.manage", "history.import", "reserve.manage", "security.manage", "policy.manage", "profit.distribute", "system.admin"];
  const APPROVE = ["ledger.approve", "loan.secondApprove", "security.approve"];
  const READ = ["report.view", "audit.view", "shareout.preview", "report.export"];   // report.export = the Export / Share menu (PDF, print, WhatsApp, CSV); officers only
  const ALL = WRITE.concat(["loan.apply"], READ);          // Super Admin: every input permission, NOT the second-approval ones
  const ROLES = ["Admin", "Chairperson", "Treasurer", "Secretary", "Committee", "Member"];
  /* Treasurer: routine money entries only (savings/other ledger entries, loan repayments, subscriptions). Voids, loan approval/payout, interest changes, reconciliation, members, security, policy, share-out and system stay with the Super Admin; gated actions still need the Chairperson. */
  const TREASURER_WRITE = ["ledger.create", "loan.repay", "subscription.record"];

  // Committee permissions are an OPEN SOB DECISION (Q5). Safe default = read-only. Set via config.committeePermissions (never write permissions).
  const config = {
    committeePermissions: null,
    // WHICH entry types need the Chairperson is SOB's decision: default none. Also settable (and persisted) via db.policy "approval".
    approval: { requiredTypes: [], separateApprover: true }
  };
  const PERMS = {
    Admin: () => ALL,
    Chairperson: () => READ.concat(APPROVE, ["self.view"]),
    Treasurer: () => READ.concat(TREASURER_WRITE, ["self.view"]),
    Secretary: () => ["report.view", "self.view"],   // records and permitted reports, view-only; no export menu
    Committee: () => (config.committeePermissions || ["report.view", "shareout.preview"]).filter((p) => !WRITE.includes(p) && !APPROVE.includes(p)),
    Member: () => ["self.view", "loan.apply", "report.self", "airtime.request", "guarantee.accept"]
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
    if (["Withdraw", "Share-Out", "Bank Charge"].includes(e.type) && e.memberId) {
      /* A guarantor can never withdraw money committed against an unpaid loan: only savings genuinely AVAILABLE after commitments can leave. */
      const pos = ledger.memberPosition(db, e.memberId);
      if (amount > pos.withdrawable) throw new Error("COMMITTED_GUARANTEE: only " + pos.withdrawable + " is available to withdraw (savings " + pos.savings + ", committed to guarantees " + pos.committed + ")");
    }
    const needsApproval = config.approval.requiredTypes.concat(ledger.getPolicy(db, "approval").requiredTypes || []).includes(e.type);
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
    if (m.id !== undefined && !/^SOB-\d{3}$/.test(String(m.id))) throw new Error("INVALID: member id must look like SOB-057");
    if (m.regDate && !dates.isISO(m.regDate)) throw new Error("INVALID: regDate must be YYYY-MM-DD");
    const id = m.id || "SOB-" + String(db.members.length + 1).padStart(3, "0");
    if (db.members.some((x) => x.id === id)) throw new Error("DUPLICATE_MEMBER: " + id);
    const member = { id, name: need(m.name, "name"), phone: m.phone || "", email: m.email || "", location: m.location || "", regDate: m.regDate === undefined ? ctx.today : String(m.regDate), status: "Active" };
    db.members.push(member);
    audit(db, ctx, "Member", id, "Created", null, member);
    return member;
  }

  /* Contact details of an EXISTING member (WhatsApp/phone, e-mail, location). Super Admin only (member.manage). Changes ONLY these three fields: never the id, name,
     registration date, status, savings, loans or any financial record. Every change is audited with the previous and the new values. */
  const CONTACT_FIELDS = ["phone", "email", "location"];
  function cleanPhone(v) {
    const s = String(v == null ? "" : v).trim(); if (s === "") return "";
    const t = s.replace(/[\s\-().]/g, ""); let m;
    if ((m = /^\+?256(\d{9})$/.exec(t))) return "0" + m[1];      // stored in the local form the members sheet already uses: 0772000000
    if ((m = /^0(\d{9})$/.exec(t))) return "0" + m[1];
    throw new Error("INVALID: the phone number must be a Uganda number such as 0772 123 456 or +256 772 123 456");
  }
  function updateMemberContact(db, ctx, a) {
    require_(ctx, "member.manage"); a = a || {};
    const id = need(a.memberId, "memberId"), member = (db.members || []).find((x) => x.id === id); if (!member) throw new Error("NOT_FOUND: member " + id);
    const next = {}; CONTACT_FIELDS.forEach((k) => { if (a[k] !== undefined && a[k] !== null) next[k] = String(a[k]).trim(); });
    if (!Object.keys(next).length) throw new Error("INVALID: give at least one of phone, email or location");
    if (next.phone !== undefined) next.phone = cleanPhone(next.phone);
    if (next.email !== undefined && next.email !== "" && !(next.email.length <= 120 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(next.email))) throw new Error("INVALID: that e-mail address does not look right");
    if (next.location !== undefined && (next.location.length > 100 || /[\u0000-\u001f\u007f]/.test(next.location))) throw new Error("INVALID: the location must be plain text of at most 100 characters");
    if (next.phone) {
      const other = db.members.find((x) => x.id !== id && x.phone && (() => { try { return cleanPhone(x.phone) === next.phone; } catch (e) { return false; } })());
      if (other && !a.allowShared) throw new Error("DUPLICATE_PHONE: " + next.phone + " is already the number of " + other.id + ". Reminders would go to the same WhatsApp for both members. If the two members really share one number, tick that option.");
    }
    const before = {}, after = {}; CONTACT_FIELDS.forEach((k) => { before[k] = member[k] || ""; after[k] = next[k] !== undefined ? next[k] : (member[k] || ""); });
    if (CONTACT_FIELDS.every((k) => before[k] === after[k])) throw new Error("NO_CHANGE: those details are already recorded");
    CONTACT_FIELDS.forEach((k) => { if (next[k] !== undefined) member[k] = next[k]; });
    audit(db, ctx, "Member", id, "ContactUpdated", before, after, a.reason || "Contact details updated");
    return { id, name: member.name, phone: member.phone || "", email: member.email || "", location: member.location || "" };
  }

  /* SOB-approved settings, stored in the ledger itself (db.policy) and audited. Only validated, known settings can be changed; every change needs a reason. */
  const ENTRY_TYPES = ["Savings", "Withdraw", "Profit", "Loan Disbursement", "Loan Repayment", "Subscription", "Income", "Expense", "Share-Out", "Bank Charge", "Interest", "Penalty"];
  /* FINAL SOB rules are fixed in code (3x guideline, shortfall backing, interest-first repayment, savings-proportional profit with the loan-holder exclusion, the list of
     actions that always need the Chairperson). The ONLY adjustable setting left is to ADD ledger entry types to the Chairperson's queue; it can never remove a requirement. */
  function setPolicy(db, ctx, key, values, reason) {
    require_(ctx, "policy.manage"); need(reason, "reason");
    if (!ledger.POLICY_DEFAULTS[key]) throw new Error("INVALID: unknown policy '" + key + "'");
    if (key !== "approval") throw new Error("INVALID: the '" + key + "' rules are fixed by SOB and cannot be changed here");
    const cur = ledger.getPolicy(db, key), next = Object.assign({}, cur), v = values || {};
    if (v.loanSecondApproval === false) throw new Error("INVALID: loan approval always needs the Chairperson; this cannot be switched off");
    if (v.requiredTypes !== undefined) {
      if (Array.isArray(v.requiredTypes) && v.requiredTypes.some((x) => ["Savings", "Loan Repayment"].includes(x))) throw new Error("INVALID: routine savings deposits and normal loan repayments do not need the Chairperson");
      if (!Array.isArray(v.requiredTypes) || v.requiredTypes.some((x) => !ENTRY_TYPES.includes(x))) throw new Error("INVALID: requiredTypes must be a list of ledger entry types");
      const keep = v.requiredTypes.slice(); (cur.requiredTypes || []).forEach((x) => { if (!keep.includes(x)) throw new Error("INVALID: a requirement for the Chairperson cannot be removed (" + x + ")"); });
      next.requiredTypes = keep;
    }
    db.policy = db.policy || []; let rec = db.policy.find((p) => p.id === key);
    if (!rec) { rec = { id: key }; db.policy.push(rec); }
    Object.assign(rec, next, { id: key, updatedBy: ctx.by, updatedDate: ctx.today });
    audit(db, ctx, "Policy", key, "Changed", cur, next, reason);
    return rec;
  }
  return { ALL, ROLES, setPolicy, WRITE, APPROVE, READ, config, can, require: require_, need, uid, makeCtx, audit, createEntry, approveEntry, voidEntry, restoreEntry, addMember, updateMemberContact };
});
