/* SOB core/security — the controlled facility for loans backed by OTHER approved security / property.
   SOB strongly discourages property as security, so this is NEVER the default route: it exists for the case where SOB exceptionally chooses to accept it.
   Security is recorded SEPARATELY from savings-backed guarantors, with description, valuation (where applicable), evidence documents, a written
   reason for the exception, the Chairperson's approval and a full history. It counts toward a loan's backing only for the cover amount the Chairperson
   explicitly accepts (never more than the recorded valuation, never more than the loan) — no valuation formula or haircut is invented here. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates, isNode ? require("./governance.js") : root.SOB.gov);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.security = api; }
})(typeof self !== "undefined" ? self : this, function (dates, G) {
  const KINDS = ["Property", "Land", "Vehicle", "Equipment", "Other"];
  const NEEDS_VALUATION = ["Property", "Land", "Vehicle", "Equipment"];
  const PRE = ["Pending", "AwaitingApproval", "Approved"];
  const list = (db) => (db.securities = db.securities || []);
  const get = (db, id) => { const x = list(db).find((s) => s.id === id); if (!x) throw new Error("NOT_FOUND: security " + id); return x; };
  const cleanDocs = (docs, ctx) => (docs || []).map((d) => ({ name: G.need(d && d.name, "document name"), reference: String((d && d.reference) || ""), note: String((d && d.note) || ""), addedBy: ctx.by, addedDate: ctx.today }));
  const log = (x, ctx, action, note) => (x.history = x.history || []).push({ date: ctx.today, timestamp: ctx.now, by: ctx.by, role: ctx.role, action, note: note || "" });

  function proposeSecurity(db, ctx, a) {
    G.require(ctx, "security.manage");
    const loan = db.loans.find((l) => l.id === a.loanId); if (!loan) throw new Error("NOT_FOUND: loan " + a.loanId);
    if (!PRE.includes(loan.status)) throw new Error("BAD_STATE: security can only be proposed before disbursement (loan is " + loan.status + ")");
    if (!KINDS.includes(a.kind)) throw new Error("INVALID: kind must be one of " + KINDS.join("/"));
    const description = G.need(a.description, "description"); if (description.length < 8) throw new Error("INVALID: describe the security properly (what, where, who owns it)");
    const owner = G.need(a.owner, "owner (whose security this is)");
    let valuation = null;
    if (a.valuation !== undefined && a.valuation !== null && a.valuation !== "") { valuation = Number(a.valuation); if (!(valuation > 0)) throw new Error("INVALID: valuation"); if (!dates.isISO(a.valuationDate)) throw new Error("INVALID: valuationDate (YYYY-MM-DD) is required with a valuation"); G.need(a.valuedBy, "valuedBy (who valued it)"); }
    else if (NEEDS_VALUATION.includes(a.kind)) throw new Error("REQUIRED: valuation for " + a.kind + " security");
    const documents = cleanDocs(a.documents, ctx); if (!documents.length) throw new Error("REQUIRED: at least one document / evidence reference (title deed, sale agreement, valuation report ...)");
    const x = { id: G.uid("SEC"), loanId: loan.id, memberId: loan.memberId, kind: a.kind, description, owner, valuation, valuationDate: valuation ? a.valuationDate : "", valuedBy: valuation ? String(a.valuedBy).trim() : "",
      documents, status: "Proposed", proposedBy: ctx.by, proposedDate: ctx.today, acceptedCover: 0, history: [] };
    list(db).push(x); log(x, ctx, "Proposed", description);
    G.audit(db, ctx, "Security", x.id, "Proposed", null, { loanId: x.loanId, kind: x.kind, valuation, documents: documents.length }, "Exceptional security proposed (not the default route)");
    return x;
  }
  function addSecurityDocument(db, ctx, id, doc) {
    G.require(ctx, "security.manage");
    const x = get(db, id); if (!["Proposed", "Approved"].includes(x.status)) throw new Error("BAD_STATE: security is " + x.status);
    const d = cleanDocs([doc], ctx)[0]; x.documents.push(d); log(x, ctx, "Document added", d.name);
    G.audit(db, ctx, "Security", id, "Document added", null, { name: d.name, reference: d.reference });
    return x;
  }
  /* The Chairperson (second approver) accepts or rejects. Acceptance needs the reason SOB is making an exception and the exact cover accepted. */
  function decideSecurity(db, ctx, id, decision, o) {
    G.require(ctx, "security.approve"); o = o || {};
    const x = get(db, id); if (x.status !== "Proposed") throw new Error("BAD_STATE: security is " + x.status);
    if (decision === "reject") { G.need(o.reason, "reason"); Object.assign(x, { status: "Rejected", decidedBy: ctx.by, decidedDate: ctx.today, decisionReason: String(o.reason).trim() }); log(x, ctx, "Rejected", o.reason); G.audit(db, ctx, "Security", id, "Rejected", { status: "Proposed" }, { status: "Rejected" }, o.reason); return x; }
    if (decision !== "approve") throw new Error("INVALID: decision must be approve or reject");
    const reason = G.need(o.reason, "reason (why SOB exceptionally accepts security instead of guarantors)");
    const cover = Number(o.acceptedCover); if (!(cover > 0)) throw new Error("REQUIRED: acceptedCover (the part of the loan this security is accepted to back)");
    const loan = db.loans.find((l) => l.id === x.loanId);
    if (cover > Number(loan.loanAmount)) throw new Error("INVALID: acceptedCover cannot exceed the loan amount");
    if (x.valuation && cover > x.valuation) throw new Error("INVALID: acceptedCover cannot exceed the recorded valuation (" + x.valuation + ")");
    Object.assign(x, { status: "Approved", acceptedCover: cover, decidedBy: ctx.by, decidedDate: ctx.today, decisionReason: String(reason), exceptional: true });
    log(x, ctx, "Approved", "cover " + cover + " - " + reason);
    G.audit(db, ctx, "Security", id, "Approved (exception)", { status: "Proposed" }, { status: "Approved", acceptedCover: cover }, reason);
    return x;
  }
  function releaseSecurity(db, ctx, id, reason) {
    G.require(ctx, "security.manage"); G.need(reason, "reason");
    const x = get(db, id); if (!["Proposed", "Approved"].includes(x.status)) throw new Error("BAD_STATE: security is " + x.status);
    const loan = db.loans.find((l) => l.id === x.loanId);
    if (loan && loan.status === "Active") throw new Error("BAD_STATE: security backing an outstanding loan is released only when the loan is cleared");
    const was = x.status; Object.assign(x, { status: "Released", closedDate: ctx.today, closeReason: String(reason).trim() }); log(x, ctx, "Released", reason);
    G.audit(db, ctx, "Security", id, "Released", { status: was }, { status: "Released" }, reason);
    return x;
  }
  return { KINDS, proposeSecurity, addSecurityDocument, decideSecurity, releaseSecurity };
});
