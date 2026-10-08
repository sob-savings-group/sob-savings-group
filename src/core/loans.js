/* SOB core/loans — application -> Super Admin review -> Chairperson approval (always) -> disbursement -> repayment -> clearance/reversal,
   plus the guarantor and security workflow. Interest is assigned per loan by Admin (assignedMonthlyInterest); SOB has no standard rate.
   SOB rules implemented here:
   - 3x savings is the STANDARD GUIDELINE, not a hard stop: a borrower who falls short may continue with guarantor(s) and/or exceptionally approved security.
   - MORE THAN ONE guarantor may back a loan; their commitments add up. A guarantee takes effect only when the guarantor ACCEPTS it, and from that instant the
     guaranteed amount is deducted from the guarantor's AVAILABLE savings (it stays in their account but cannot be withdrawn).
   - A guarantee secures the borrower's outstanding PRINCIPAL exposure beyond their own qualification (the shortfall). It is therefore released by the REDUCTION IN PRINCIPAL a repayment
     causes - not by the cash received (part of a payment may be interest). FINAL SOB rule (ledger.walkAllocation): accumulated unpaid interest is cleared first, the remainder reduces
     principal; only that principal reduction releases guarantee, so an interest-only payment releases nothing. Releases are pro rata to
     each guarantor's commitment and linked by repayment id; clearing the loan releases whatever remains; voiding a repayment re-commits exactly what it released.
   - Property / other security is an EXCEPTIONAL, separately recorded route (core/security.js), never the default. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./ledger.js") : root.SOB.ledger, isNode ? require("./governance.js") : root.SOB.gov);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.loans = api; }
})(typeof self !== "undefined" ? self : this, function (dates, L, G) {
  const LIVE_GUARANTEE = (g) => g.status === "Active";
  const OPEN_GUARANTEE = (g) => g.status === "Active" || g.status === "Requested";
  const PRE_DISBURSE = ["Pending", "AwaitingApproval", "Approved"];
  const getLoan = (db, id) => { const l = db.loans.find((x) => x.id === id); if (!l) throw new Error("NOT_FOUND: loan " + id); return l; };
  const stateMust = (loan, ...ok) => { if (!ok.includes(loan.status)) throw new Error("BAD_STATE: loan is " + loan.status + ", needs " + ok.join("/")); };
  const secs = (db, loanId) => (db.securities || []).filter((x) => x.loanId === loanId);

  /* --- guarantor exposure (single source: ledger.js) --- */
  const committed = (db, guarantorId) => L.memberCommitted(db, guarantorId);
  const loanCover = (db, loanId) => (db.guarantees || []).filter((g) => g.loanId === loanId && LIVE_GUARANTEE(g)).reduce((a, g) => a + L.guaranteeRemaining(g), 0);
  // guarantees that bound the loan at disbursement (still Active, or since released by repayments); not ones withdrawn before disbursement
  const bound = (db, loanId) => (db.guarantees || []).filter((g) => g.loanId === loanId && g.dateCommitted && !g.preRelease && (g.status === "Active" || g.status === "Released"));
  const loanGuaranteed = (db, loanId) => bound(db, loanId).reduce((a, g) => a + Number(g.amount), 0);
  const securityCover = (db, loanId) => secs(db, loanId).filter((x) => x.status === "Approved").reduce((a, x) => a + Number(x.acceptedCover || 0), 0);
  function qualifyingSavings(db, memberId) { return L.loanEligibility(db, memberId).qualifyingSavings; }
  const guarantorAvailable = (db, guarantorId) => L.memberAvailable(db, guarantorId);
  function exposureReport(db) {
    return db.members.map((m) => ({ memberId: m.id, name: m.name, committed: committed(db, m.id),
      guarantees: (db.guarantees || []).filter((g) => g.guarantorId === m.id && LIVE_GUARANTEE(g) && L.guaranteeRemaining(g) > 0).length }))
      .filter((r) => r.committed > 0);
  }

  /* The one transparent answer to "can this loan proceed, and why": own-savings guideline, the shortfall, and what backs it. */
  function assessLoan(db, memberId, amount, loanId) {
    const pol = L.getPolicy(db, "loan"), el = L.loanEligibility(db, memberId), amt = Number(amount);
    const guideline = el.maxLoan, shortfall = Math.max(0, amt - guideline);
    /* SOB decision: the guarantor policy BEGINS on guarantorPolicyStart (1 Jan 2027). From then guarantors back only the shortfall beyond the borrower's own qualification; before it nothing is required. */
    const start = pol.guarantorPolicyStart || "2027-01-01", guarantorsApply = dates.todayISO() >= start;
    const required = guarantorsApply ? shortfall : 0;
    const gs = loanId ? (db.guarantees || []).filter((g) => g.loanId === loanId && OPEN_GUARANTEE(g)) : [];
    const guaranteeCover = loanId ? loanCover(db, loanId) : 0, secCover = loanId ? securityCover(db, loanId) : 0, backing = guaranteeCover + secCover;
    const reasons = [];
    if (required > 0 && backing < required) reasons.push("Backing of " + required + " is needed (loan " + amt + " vs guideline " + guideline + " = " + el.multiple + "x savings of " + el.qualifyingSavings + ") but only " + backing + " is accepted (guarantees " + guaranteeCover + ", approved security " + secCover + ").");
    return { memberId, amount: amt, savings: el.qualifyingSavings, multiple: el.multiple, guideline, withinGuideline: amt <= guideline, shortfall, required, guarantorsApply, guarantorPolicyStart: start,
      guaranteeCover, guaranteesRequested: gs.filter((g) => g.status === "Requested").length, securityCover: secCover, securityBacked: secCover > 0, backing, shortBy: Math.max(0, required - backing), canApprove: reasons.length === 0, reasons };
  }

  function addGuarantee(db, ctx, loanId, guarantorId, amount) {
    G.require(ctx, "guarantee.manage");
    const loan = getLoan(db, loanId); stateMust(loan, ...PRE_DISBURSE);
    amount = Number(amount); if (!(amount > 0)) throw new Error("INVALID: guarantee amount must be a positive number");
    if (guarantorId === loan.memberId) throw new Error("INVALID: a member cannot guarantee their own loan");
    if (!db.members.some((m) => m.id === guarantorId)) throw new Error("UNKNOWN_MEMBER: " + guarantorId);
    if ((db.guarantees || []).some((g) => g.loanId === loanId && g.guarantorId === guarantorId && OPEN_GUARANTEE(g))) throw new Error("ALREADY_GUARANTOR: " + guarantorId + " already has an open guarantee on this loan");
    const avail = guarantorAvailable(db, guarantorId);
    if (amount > avail) throw new Error("INSUFFICIENT_GUARANTOR: guarantee of " + amount + " exceeds the guarantor's available savings (" + avail + ")");
    const g = { id: G.uid("GUA"), loanId, guarantorId, amount, status: "Requested", dateRequested: ctx.today, requestedBy: ctx.by, releasedAmount: 0 };
    (db.guarantees = db.guarantees || []).push(g);
    G.audit(db, ctx, "Guarantee", g.id, "Requested", null, { loanId, guarantorId, amount }, "Not binding until the guarantor accepts");
    return g;
  }
  /* The guarantor accepts for themself (portal), or Admin records an acceptance given elsewhere (evidence required). From this moment the amount is committed. */
  function acceptGuarantee(db, ctx, guaranteeId, o) {
    o = o || {};
    const g = (db.guarantees || []).find((x) => x.id === guaranteeId); if (!g) throw new Error("NOT_FOUND: guarantee " + guaranteeId);
    if (g.status !== "Requested") throw new Error("BAD_STATE: guarantee is " + g.status);
    const self = ctx.role === "Member" && ctx.memberId === g.guarantorId;
    if (self) G.require(ctx, "guarantee.accept");
    else { G.require(ctx, "guarantee.manage"); G.need(o.evidence, "evidence (how the guarantor accepted: signed form, call, message)"); }
    const loan = getLoan(db, g.loanId); stateMust(loan, ...PRE_DISBURSE);
    const avail = guarantorAvailable(db, g.guarantorId);
    if (g.amount > avail) throw new Error("INSUFFICIENT_GUARANTOR: guarantee of " + g.amount + " exceeds the guarantor's available savings (" + avail + ")");
    Object.assign(g, { status: "Active", dateCommitted: ctx.today, acceptedBy: ctx.by, acceptedVia: self ? "guarantor (self)" : "recorded by Admin: " + String(o.evidence).trim() });
    G.audit(db, ctx, "Guarantee", g.id, "Accepted and committed", { status: "Requested", available: avail }, { status: "Active", available: avail - g.amount, committed: committed(db, g.guarantorId) }, g.acceptedVia);
    return g;
  }
  function declineGuarantee(db, ctx, guaranteeId, reason) {
    const g = (db.guarantees || []).find((x) => x.id === guaranteeId); if (!g) throw new Error("NOT_FOUND: guarantee " + guaranteeId);
    if (g.status !== "Requested") throw new Error("BAD_STATE: only a pending request can be declined (a committed guarantee is released only by repayments)");
    const self = ctx.role === "Member" && ctx.memberId === g.guarantorId;
    if (!self) G.require(ctx, "guarantee.manage"); G.need(reason, "reason");
    Object.assign(g, { status: "Declined", dateReleased: ctx.today, releaseReason: String(reason).trim() });
    G.audit(db, ctx, "Guarantee", g.id, "Declined", { status: "Requested" }, { status: "Declined" }, reason);
    return g;
  }
  /* Before disbursement only: withdraw guarantor backing (e.g. guarantor asks out). After disbursement a guarantee is released ONLY by repayments. */
  function releaseGuarantor(db, ctx, loanId, reason, guaranteeId) {
    G.require(ctx, "guarantee.manage"); G.need(reason, "reason");
    const loan = getLoan(db, loanId); stateMust(loan, ...PRE_DISBURSE);
    (db.guarantees || []).filter((g) => g.loanId === loanId && (!guaranteeId || g.id === guaranteeId)).forEach((g) => { g.preRelease = true; });
    releaseGuarantees(db, ctx, loanId, reason, guaranteeId);
  }
  function releaseGuarantees(db, ctx, loanId, why, onlyId, viaEntry, onDate) {
    const day = onDate || ctx.today;
    (db.guarantees || []).filter((g) => g.loanId === loanId && OPEN_GUARANTEE(g) && (!onlyId || g.id === onlyId)).forEach((g) => {
      const left = L.guaranteeRemaining(g), was = g.status;
      if (was === "Active" && left > 0) (g.releases = g.releases || []).push({ date: day, entryId: viaEntry || null, amount: left, reason: why });
      g.releasedAmount = Number(g.releasedAmount || 0) + (was === "Active" ? left : 0);
      g.status = "Released"; g.dateReleased = day; g.releaseReason = why;
      G.audit(db, ctx, "Guarantee", g.id, "Released", { status: was, committed: was === "Active" ? left : 0 }, { status: "Released", committed: 0 }, why);
    });
    // approved security on the loan ends with the loan
    secs(db, loanId).filter((x) => x.status === "Approved" || x.status === "Proposed").forEach((x) => {
      const was = x.status; x.status = was === "Proposed" ? "Rejected" : "Released"; x.closedDate = ctx.today; x.closeReason = why;
      (x.history = x.history || []).push({ date: ctx.today, by: ctx.by, action: x.status, note: why });
      G.audit(db, ctx, "Security", x.id, x.status, { status: was }, { status: x.status }, why);
    });
  }
  /* Double entry: guarantee release FOLLOWS THE REDUCTION IN PRINCIPAL. syncReleases() is idempotent: for every counted repayment (in date order) it works out the principal
     reduction (confirmed rule, or the safe minimum while the rule is pending), caps the running total at what the guarantors committed, and makes the recorded releases match -
     releasing more, or re-committing, as needed. Each release row carries the repayment id, so it is traceable both ways. */
  const isClearRow = (r) => r.reason === "Loan cleared";
  function reverseRelease(db, ctx, g, r, why, entryId) {
    r.reversed = true; g.releasedAmount = Math.max(0, Number(g.releasedAmount || 0) - r.amount);
    if (g.status === "Released" && L.guaranteeRemaining(g) > 0) { g.status = "Active"; g.dateReleased = ""; g.releaseReason = ""; }
    G.audit(db, ctx, "Guarantee", g.id, "Re-committed", { committed: L.guaranteeRemaining(g) - r.amount }, { committed: L.guaranteeRemaining(g), repaymentEntry: entryId || r.entryId }, why);
  }
  function applyRelease(db, ctx, gs, rel, entry, note) {
    const total = gs.reduce((a, g) => a + L.guaranteeRemaining(g), 0); rel = Math.min(rel, total); if (!(rel > 0)) return 0;
    let left = rel; const sorted = gs.slice().sort((a, b) => L.guaranteeRemaining(b) - L.guaranteeRemaining(a) || (a.id < b.id ? -1 : 1));
    const take = (g, part) => {
      part = Math.min(part, L.guaranteeRemaining(g)); if (part <= 0) return; left -= part;
      (g.releases = g.releases || []).push({ date: entry.date, entryId: entry.id, amount: part });
      g.releasedAmount = Number(g.releasedAmount || 0) + part;
      if (L.guaranteeRemaining(g) === 0) { g.status = "Released"; g.dateReleased = entry.date; g.releaseReason = "Principal repaid"; }
      G.audit(db, ctx, "Guarantee", g.id, "Released by principal repayment", { committed: L.guaranteeRemaining(g) + part }, { committed: L.guaranteeRemaining(g), repaymentEntry: entry.id, loanId: entry.loanId }, note);
    };
    sorted.forEach((g, i) => take(g, i === sorted.length - 1 ? left : Math.floor(rel * L.guaranteeRemaining(g) / total)));
    sorted.forEach((g) => { if (left > 0) take(g, left); });                 // rounding remainder
    return rel - left;
  }
  function syncReleases(db, ctx, loan) {
    if (!loan || loan.voided || loan.status !== "Active") return { loanId: loan && loan.id, status: "n/a" };
    const all = bound(db, loan.id);
    if (!all.length) return { loanId: loan.id, status: "none" };
    const split = L.loanRepaymentSplit(loan, db, ctx.today), counted = new Set(split.steps.map((x) => x.entryId));
    // releases tied to a repayment that no longer counts (voided / rejected) are re-committed
    all.forEach((g) => (g.releases || []).filter((r) => !r.reversed && r.entryId && !counted.has(r.entryId) && !isClearRow(r)).forEach((r) => reverseRelease(db, ctx, g, r, "Repayment no longer counts", r.entryId)));
    const cap = all.reduce((a, g) => a + Number(g.amount), 0); let run = 0, pendingAmt = 0;
    split.steps.forEach((st) => {
      const want = Math.max(0, Math.min(cap, run + st.principal) - run); run += want;
      pendingAmt += Math.max(0, Math.min(st.possible, cap) - st.principal);
      const entry = db.transactions.find((t) => t.id === st.entryId);
      const mine = [].concat(...all.map((g) => (g.releases || []).filter((r) => r.entryId === st.entryId && !r.reversed && !isClearRow(r)).map((r) => ({ g, r })))), have = mine.reduce((a, x) => a + x.r.amount, 0);
      if (have === want) return;
      mine.forEach((x) => reverseRelease(db, ctx, x.g, x.r, "Release recalculated from the principal reduction", st.entryId));
      applyRelease(db, ctx, all.filter((g) => g.status === "Active" && L.guaranteeRemaining(g) > 0), want, entry, "Principal reduced by " + want + " of repayment " + st.amount + " (" + (split.status === "CONFIRMED" ? split.rule.replace("_", " ").toLowerCase() : "certain under any allocation rule") + ")");
    });
    return { loanId: loan.id, status: split.status, principalReduced: run, pendingAllocation: split.status === "PENDING" ? Math.max(0, Math.min(split.totalPossible, cap) - run) : 0 };
  }
  function clearIfRepaid(db, ctx, loan, entry) {
    if (loan.status === "Active" && L.loanOutstanding(loan, db, entry.date) <= 0) {
      Object.assign(loan, { status: "Cleared", datePaidFull: entry.date, clearedBy: ctx.by });
      releaseGuarantees(db, ctx, loan.id, "Loan cleared", null, entry.id, entry.date);      // fully repaid: principal is zero under any allocation rule
      G.audit(db, ctx, "Loan", loan.id, "Cleared", { status: "Active" }, { status: "Cleared" }, "Fully repaid");
    }
  }
  /* Re-evaluate every active loan (e.g. right after SOB confirms or changes the repayment-allocation rule). */
  function syncAllReleases(db, ctx) { return (db.loans || []).filter((l) => l.status === "Active" && !l.voided).map((l) => syncReleases(db, ctx, l)); }
  /* A repayment entry that becomes COUNTED (approved by the Chairperson) or is RESTORED triggers its release; one that is voided re-commits it. */
  function onRepaymentCounted(db, ctx, entry) {
    if (!entry || entry.type !== "Loan Repayment" || !entry.loanId) return;
    const loan = db.loans.find((l) => l.id === entry.loanId); if (!loan || loan.voided) return;
    syncReleases(db, ctx, loan); clearIfRepaid(db, ctx, loan, entry);
  }
  function onRepaymentRemoved(db, ctx, entry, why) {
    if (!entry || entry.type !== "Loan Repayment" || !entry.loanId) return;
    const loan = db.loans.find((l) => l.id === entry.loanId); if (!loan) return;
    (db.guarantees || []).forEach((g) => (g.releases || []).filter((r) => r.entryId === entry.id && !r.reversed).forEach((r) => reverseRelease(db, ctx, g, r, why || "repayment voided", entry.id)));
    if (loan.status === "Cleared" && L.loanOutstanding(loan, db, ctx.today) > 0) {
      (db.guarantees || []).filter((g) => g.loanId === loan.id).forEach((g) => (g.releases || []).filter((r) => !r.reversed && isClearRow(r)).forEach((r) => reverseRelease(db, ctx, g, r, why || "repayment voided", entry.id)));
      Object.assign(loan, { status: "Active", datePaidFull: "" });
      G.audit(db, ctx, "Loan", loan.id, "Re-opened (repayment removed)", { status: "Cleared" }, { status: "Active" }, why || "repayment voided");
    }
    syncReleases(db, ctx, loan);
  }
  /* What is held back for SOB's allocation decision, per loan (shown to Admin and in the guarantee statement). */
  function pendingRelease(db, loanId, today) {
    const loan = getLoan(db, loanId); if (loan.status !== "Active") return 0;
    const split = L.loanRepaymentSplit(loan, db, today); if (split.status !== "PENDING") return 0;
    const cap = loanGuaranteed(db, loanId); return Math.max(0, Math.min(split.totalPossible, cap) - Math.min(split.totalPrincipal, cap));
  }

  /* --- workflow --- */
  function applyForLoan(db, ctx, memberId, amount) {
    G.require(ctx, "loan.apply");
    if (ctx.role === "Member" && ctx.memberId !== memberId) throw new Error("FORBIDDEN: members apply only for themselves");
    if (!db.members.some((m) => m.id === memberId)) throw new Error("UNKNOWN_MEMBER: " + memberId);
    amount = Number(amount); if (!(amount > 0)) throw new Error("INVALID: amount");
    if (!(L.memberSavings(db, memberId) > 0)) throw new Error("NO_SAVINGS: a member must have savings before applying");
    if (L.memberHasOutstandingLoan(db, memberId)) throw new Error("HAS_OUTSTANDING_LOAN: clear the existing loan first");
    if ((db.loans || []).some((l) => l.memberId === memberId && !l.voided && PRE_DISBURSE.includes(l.status))) throw new Error("ALREADY_APPLIED");
    const loan = { id: G.uid("LOAN"), memberId, memberName: db.members.find((m) => m.id === memberId).name, loanAmount: amount, status: "Pending",
      applicationDate: ctx.today, appliedBy: ctx.by, graceMonths: 3 };
    db.loans.push(loan);
    G.audit(db, ctx, "Loan", loan.id, "Applied", null, { memberId, amount });
    return loan;
  }
  /* Approval. The Super Admin REVIEWS; that moves the loan to AwaitingApproval and only the Chairperson (a different person) can make it Approved. The 3x guideline never rejects by itself: backing for any shortfall is what is checked. */
  function approveLoan(db, ctx, loanId, note) {
    const second = G.can(ctx, "loan.secondApprove"), review = G.can(ctx, "loan.review");
    if (!second && !review) G.require(ctx, "loan.review");
    const loan = getLoan(db, loanId);
    const a = assessLoan(db, loan.memberId, loan.loanAmount, loanId);
    const needsChair = true;                                       // FINAL SOB rule: every new loan needs the Chairperson
    if (loan.status === "AwaitingApproval") {
      if (!second) throw new Error("FORBIDDEN: this loan awaits the Chairperson's approval");
      if (G.config.approval.separateApprover && loan.reviewedBy === ctx.by) throw new Error("SEPARATION: the reviewer cannot also give the second approval");
    } else { stateMust(loan, "Pending"); if (!review) throw new Error("FORBIDDEN: the Chairperson approves only loans reviewed by the Super Admin"); }
    if (!a.canApprove) throw new Error("NO_BACKING: " + a.reasons.join(" "));
    const next = loan.status === "Pending" && needsChair ? "AwaitingApproval" : "Approved";
    const prev = loan.status;
    if (next === "AwaitingApproval") Object.assign(loan, { status: next, reviewedBy: ctx.by, reviewedDate: ctx.today, assessment: a });
    else Object.assign(loan, { status: "Approved", approvedBy: ctx.by, approvedDate: ctx.today, assessment: a, securityException: a.securityBacked });
    G.audit(db, ctx, "Loan", loanId, next === "Approved" ? "Approved" : "Reviewed - awaiting Chairperson", { status: prev }, { status: next, assessment: { guideline: a.guideline, shortfall: a.shortfall, backing: a.backing, securityBacked: a.securityBacked } }, note);
    return loan;
  }
  function declineLoan(db, ctx, loanId, reason) {
    if (!G.can(ctx, "loan.secondApprove")) G.require(ctx, "loan.review"); G.need(reason, "reason");
    const loan = getLoan(db, loanId); stateMust(loan, ...PRE_DISBURSE);
    const prev = loan.status;
    Object.assign(loan, { status: "Declined", declinedBy: ctx.by, declinedDate: ctx.today, declineReason: reason });
    releaseGuarantees(db, ctx, loanId, "Loan declined");
    G.audit(db, ctx, "Loan", loanId, "Declined", { status: prev }, { status: "Declined" }, reason);
    return loan;
  }
  function disburse(db, ctx, loan, o, txnNote) {
    const rate = Number(o.assignedMonthlyInterest);
    if (o.assignedMonthlyInterest === undefined || o.assignedMonthlyInterest === "" || !(rate >= 0)) throw new Error("REQUIRED: assignedMonthlyInterest (Admin must assign interest for this loan)");
    const date = o.date || ctx.today; if (!dates.isISO(date)) throw new Error("INVALID: date");
    const grace = o.graceMonths === undefined ? (loan.graceMonths ?? 3) : Number(o.graceMonths);
    Object.assign(loan, { status: "Active", date, assignedMonthlyInterest: rate, graceMonths: grace, dueDate: dates.addMonths(date, grace),
      disbursedBy: ctx.by, interestHistory: [{ date: ctx.today, timestamp: ctx.now, previousAmount: null, newAmount: rate, reason: "Initial assignment at disbursement", changedByRole: ctx.role, changedBy: ctx.by }] });
    G.createEntry(db, ctx, { date, memberId: loan.memberId, amount: loan.loanAmount, type: "Loan Disbursement", purpose: txnNote, loanId: loan.id });
    G.audit(db, ctx, "Loan", loan.id, "Disbursed", null, { amount: loan.loanAmount, assignedMonthlyInterest: rate, date });
    return loan;
  }
  function disburseLoan(db, ctx, loanId, o) {
    G.require(ctx, "loan.disburse");
    const loan = getLoan(db, loanId); stateMust(loan, "Approved");
    const a = assessLoan(db, loan.memberId, loan.loanAmount, loanId);       // backing may have changed since approval (e.g. a guarantee was released)
    if (!a.canApprove) throw new Error("NO_BACKING: " + a.reasons.join(" "));
    return disburse(db, ctx, loan, o || {}, "Loan Disbursement");
  }
  /* Existing, already-approved loans (pre-workflow) are recorded without re-running the application steps. Always audited. */
  function recordExistingLoan(db, ctx, o) {
    G.require(ctx, "loan.disburse");
    const m = db.members.find((x) => x.id === o.memberId); if (!m) throw new Error("UNKNOWN_MEMBER: " + o.memberId);
    const amount = Number(o.amount); if (!(amount > 0)) throw new Error("INVALID: amount");
    const loan = { id: G.uid("LOAN"), memberId: m.id, memberName: m.name, loanAmount: amount, status: "Approved", legacy: true, approvedBy: ctx.by, approvedDate: ctx.today, remarks: o.remarks || "Existing loan recorded outside the application workflow" };
    db.loans.push(loan);
    G.audit(db, ctx, "Loan", loan.id, "Recorded existing loan", null, { memberId: m.id, amount }, "Legacy loan: guarantor workflow not applied");
    return disburse(db, ctx, loan, o, "Loan Disbursement (existing loan)");
  }
  function repayLoan(db, ctx, loanId, amount, date) {
    G.require(ctx, "loan.repay");
    const loan = getLoan(db, loanId); stateMust(loan, "Active");
    date = date || ctx.today; amount = Number(amount);
    if (!(amount > 0)) throw new Error("INVALID: amount");
    if (loan.date && date < loan.date) throw new Error("INVALID: a repayment cannot be dated before the loan was disbursed (" + loan.date + ")");
    const owing = L.loanOutstanding(loan, db, date);
    if (amount > owing) throw new Error("OVERPAYMENT: outstanding on " + date + " is " + owing);
    const entry = G.createEntry(db, ctx, { date, memberId: loan.memberId, amount, type: "Loan Repayment", purpose: "Loan Repayment", loanId });
    if (entry.approvalStatus === "Approved") onRepaymentCounted(db, ctx, entry);   // pending second approval: released only once the Chairperson approves
    return loan;
  }
  function editAssignedInterest(db, ctx, loanId, newAmount, reason) {
    G.require(ctx, "loan.editInterest"); G.need(reason, "reason");
    const loan = getLoan(db, loanId); stateMust(loan, "Active");
    newAmount = Number(newAmount); if (!(newAmount >= 0)) throw new Error("INVALID: interest amount");
    const prev = loan.assignedMonthlyInterest;
    (loan.interestHistory = loan.interestHistory || []).push({ date: ctx.today, timestamp: ctx.now, previousAmount: prev, newAmount, reason, changedByRole: ctx.role, changedBy: ctx.by });
    loan.assignedMonthlyInterest = newAmount;
    G.audit(db, ctx, "Loan", loanId, "Assigned interest corrected", { assignedMonthlyInterest: prev }, { assignedMonthlyInterest: newAmount }, reason);
    return loan;
  }
  function voidLoan(db, ctx, loanId, reason) {
    G.require(ctx, "loan.reverse"); G.need(reason, "reason");
    const loan = getLoan(db, loanId); if (loan.voided) throw new Error("ALREADY_VOIDED");
    Object.assign(loan, { voided: true, voidReason: reason, voidDate: ctx.today, voidTimestamp: ctx.now, voidedByRole: ctx.role, voidedBy: ctx.by });
    db.transactions.filter((t) => t.loanId === loanId && !t.voided).forEach((t) =>
      Object.assign(t, { voided: true, voidReason: "Voided with loan: " + reason, voidDate: ctx.today, voidTimestamp: ctx.now, voidedByRole: ctx.role, voidedBy: ctx.by, voidedWithLoan: true }));
    releaseGuarantees(db, ctx, loanId, "Loan voided");
    G.audit(db, ctx, "Loan", loanId, "Voided", { voided: false }, { voided: true }, reason);
    return loan;
  }
  function restoreLoan(db, ctx, loanId, reason) {
    G.require(ctx, "ledger.restore"); G.need(reason, "reason");
    const loan = getLoan(db, loanId); if (!loan.voided) throw new Error("NOT_VOIDED");
    if (!L.withinRestoreWindow(loan, new Date(ctx.now).getTime())) throw new Error("RESTORE_WINDOW_CLOSED");
    Object.assign(loan, { voided: false, restoredReason: reason, restoredDate: ctx.today, restoredTimestamp: ctx.now, restoredByRole: ctx.role, restoredBy: ctx.by });
    db.transactions.filter((t) => t.loanId === loanId && t.voidedWithLoan).forEach((t) => { t.voided = false; t.voidedWithLoan = false; t.restoredReason = reason; t.restoredDate = ctx.today; });
    // Guarantees released by the void are NOT silently re-committed: Admin must re-confirm capacity.
    G.audit(db, ctx, "Loan", loanId, "Restored", { voided: true }, { voided: false }, reason);
    return loan;
  }
  /* Everything the "drill-down" cards need about one loan, from the same engine. */
  function loanView(db, loan, asOf) {
    return { id: loan.id, status: loan.status, principal: Number(loan.loanAmount), assignedMonthlyInterest: Number(loan.assignedMonthlyInterest) || 0,
      unpaidMonths: L.loanMonthsAfterGrace(loan, asOf), accumulatedInterest: L.loanAccumulatedInterest(loan, asOf),
      penalties: L.loanTotalPenalties(loan, db), payable: L.loanPayable(loan, asOf, db), repaid: L.loanTotalRepaid(loan, db),
      balance: L.loanOutstanding(loan, db, asOf), repaymentAllocation: L.confirmedAllocation(db), guaranteed: loanGuaranteed(db, loan.id), guaranteeCommitted: loanCover(db, loan.id), securityCover: securityCover(db, loan.id), interestHistory: loan.interestHistory || [] };
  }
  /* The linked double-entry view of one loan: every repayment beside the guarantor releases it caused, with both sides' running positions. */
  function linkedLedger(db, loanId, asOf) {
    const loan = getLoan(db, loanId), rows = [], gs = (db.guarantees || []).filter((g) => g.loanId === loanId && g.status !== "Declined");
    const reps = L.activeTransactions(db).filter((t) => t.loanId === loanId && (t.type === "Loan Disbursement" || t.type === "Loan Repayment")).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const split = loan.status === "Active" || loan.status === "Cleared" ? L.loanRepaymentSplit(loan, db, asOf || dates.todayISO()) : { status: "n/a", steps: [] }, stepOf = {}; split.steps.forEach((x) => { stepOf[x.entryId] = x; });
    let paid = 0; const running = {}; gs.forEach((g) => { running[g.id] = 0; });
    gs.filter((g) => g.dateCommitted).sort((a, b) => (a.dateCommitted < b.dateCommitted ? -1 : 1)).forEach((g) => rows.push({ date: g.dateCommitted, event: "Guarantee committed", ref: g.id, guarantor: g.guarantorId, borrowerChange: 0, guarantorCommittedChange: Number(g.amount), _o: 0 }));
    reps.forEach((t) => {
      if (t.type === "Loan Disbursement") { rows.push({ date: t.date, event: "Loan disbursed", ref: t.id, guarantor: "", borrowerChange: Number(t.amount), guarantorCommittedChange: 0, _o: 1 }); return; }
      paid += Number(t.amount);
      const sp = stepOf[t.id] || { principal: Number(t.amount), possible: Number(t.amount) }, pr = sp.principal, wait = Math.max(0, sp.possible - sp.principal);   // principal reduction (not cash) is what the guarantee follows
      const rel = gs.reduce((a, g) => a.concat((g.releases || []).filter((r) => r.entryId === t.id && !r.reversed).map((r) => ({ g, r }))), []);
      if (!rel.length) rows.push({ date: t.date, event: "Repayment", ref: t.id, guarantor: "", borrowerChange: -pr, cashReceived: Number(t.amount), awaitingRule: wait, guarantorCommittedChange: 0, _o: 2 });
      rel.forEach(({ g, r }, i) => rows.push({ date: t.date, event: "Repayment" + (i ? " (continued)" : ""), ref: t.id, guarantor: g.guarantorId, borrowerChange: i ? 0 : -pr, cashReceived: i ? 0 : Number(t.amount), awaitingRule: i ? 0 : wait, guarantorCommittedChange: -r.amount, _o: 2 }));
    });
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a._o - b._o));
    let out = 0, com = 0;
    rows.forEach((r) => { out += r.borrowerChange; com += r.guarantorCommittedChange; r.borrowerPrincipalExposure = out; r.totalGuaranteeCommitted = com; delete r._o; });
    const rest = L.loanOutstanding(loan, db, asOf || dates.todayISO());
    return { loanId, rows, summary: { allocationRule: "INTEREST_FIRST", borrowerOutstanding: rest, guaranteeCommitted: loanCover(db, loanId), guaranteeReleased: gs.reduce((a, g) => a + Number(g.releasedAmount || 0), 0), totalRepaid: paid,
      reconciled: gs.every((g) => Number(g.releasedAmount || 0) === (g.releases || []).filter((r) => !r.reversed).reduce((a, r) => a + r.amount, 0)) } };
  }
  return { assessLoan, syncReleases, syncAllReleases, pendingRelease, acceptGuarantee, declineGuarantee, linkedLedger, onRepaymentCounted, onRepaymentRemoved, loanGuaranteed, securityCover, committed, loanCover, qualifyingSavings, guarantorAvailable, exposureReport, addGuarantee, releaseGuarantor, releaseGuarantees, applyForLoan, approveLoan,
    declineLoan, disburseLoan, recordExistingLoan, repayLoan, editAssignedInterest, voidLoan, restoreLoan, loanView };
});
