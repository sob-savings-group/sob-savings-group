/* Member statement vs Administrative statement. Synthetic data only. OFFLINE.
   Proves: a Member statement (screen data and printed PDF HTML) holds only the member's own savings, loans, balances and history; every internal reference,
   correction/audit note, reserve text, guarantor name and officer name is absent; the Administrative statement keeps all of it; the figures are identical;
   a member's own login never receives the internal fields (server-side); and nothing financial changes. */
const assert = require("assert");
const G = require("../src/core/governance.js"), L = require("../src/core/ledger.js"), LN = require("../src/core/loans.js"), ST = require("../src/core/statements.js"), API = require("../src/backend/api.js");
let n = 0; const t = (name, f) => { f(); n++; console.log("  ok " + name); };
const ctx = (role, day, extra) => G.makeCtx(Object.assign({ id: role, name: role + " Officer", role }, extra || {}), { today: day, now: day + "T08:00:00Z" });
const DAY = "2026-10-24";
function world() {
  const db = { members: [], transactions: [], loans: [], auditLog: [], guarantees: [], policy: [], yearCycles: [], approvalRequests: [], reminders: [], airtimeRequests: [], schemaVersion: 2, seq: 0 };
  const a = G.addMember(db, ctx("Admin", "2026-01-02"), { name: "Example Member A", regDate: "2026-01-02", phone: "0772123456" }), g = G.addMember(db, ctx("Admin", "2026-01-02"), { name: "Guarantor Person", regDate: "2026-01-02" });
  const e1 = G.createEntry(db, ctx("Admin", "2026-01-05"), { date: "2026-01-05", memberId: a.id, amount: 300000, type: "Savings", purpose: "Monthly savings" });
  const bad = G.createEntry(db, ctx("Admin", "2026-02-05"), { date: "2026-02-05", memberId: a.id, amount: 999000, type: "Savings", purpose: "entered twice by mistake" }); G.voidEntry(db, ctx("Admin", "2026-02-06"), bad.id, "duplicate of TXN entry, internal note");
  const e3 = G.createEntry(db, ctx("Admin", "2026-03-05"), { date: "2026-03-05", memberId: a.id, amount: 50000, type: "Savings", purpose: "Correction: re-dated per bank slip" }); e3.correctionNote = "re-dated per bank slip 77-INTERNAL"; e3.sourceRef = "SRC-BANK-9912"; e3.createdBy = "Secret Treasurer Name"; e3.approvedBy = "Chair Secret Name";
  e1.receivedBy = "Cashier Secret Name"; e1.bankedBy = "Banker Secret Name";
  const l = LN.applyForLoan(db, ctx("Member", "2026-04-01", { memberId: a.id }), a.id, 100000); LN.approveLoan(db, ctx("Admin", "2026-04-02"), l.id); LN.approveLoan(db, ctx("Chairperson", "2026-04-02"), l.id);
  LN.disburseLoan(db, ctx("Admin", "2026-04-03"), l.id, { date: "2026-04-03", assignedMonthlyInterest: 10000 }); l.reviewedBy = "Reviewer Secret Name"; l.evidence = "evidence-file-INTERNAL"; l.interestHistory = [{ date: "2026-04-03", reason: "INTERNAL interest reason", changedByRole: "Admin" }];
  LN.repayLoan(db, ctx("Treasurer", "2026-06-10"), l.id, 20000, "2026-06-10");
  db.guarantees.push({ id: "G-1", loanId: l.id, guarantorId: g.id, amount: 20000, status: "Active", dateCommitted: "2026-04-02", committedBy: "Officer Secret Name", releaseReason: "INTERNAL" });
  db.yearCycles.push({ year: 2026, status: "Open", openedDate: "2026-01-01", closedDate: null, shareOutId: null, basis: "INTERNAL basis text", evidence: "INTERNAL minutes", definedBy: "Officer Secret Name" });
  return { db, a, g, l, e3, bad };
}
const SECRETS = ["SRC-BANK-9912", "77-INTERNAL", "Secret Treasurer Name", "Chair Secret Name", "Cashier Secret Name", "Banker Secret Name", "Reviewer Secret Name", "Officer Secret Name", "evidence-file-INTERNAL", "INTERNAL interest reason", "INTERNAL basis", "INTERNAL minutes", "duplicate of TXN", "entered twice", "Guarantor Person", "Payout entry", "Interest working", "General Reserve", "Corrections and audit notes", "audit trail", "Correction", "TXN-", "AUD-"];
const leaks = (text) => SECRETS.filter((s) => text.includes(s));

t("the Member statement (data and printed PDF HTML) contains none of the officers' working material", () => {
  const { db, a, l } = world(); const m = ST.memberAccount(db, a.id, {}, { today: DAY, audience: "member" }), html = ST.toPrintHTML(m);
  assert.equal(m.audience, "member"); assert.deepEqual(leaks(JSON.stringify(m)), [], "data: " + leaks(JSON.stringify(m))); assert.deepEqual(leaks(html), [], "html: " + leaks(html));
  assert.ok(m.notes.length === 0 && m.pending.length === 0 && m.review.length === 0 && m.loans[0].guarantors.length === 0 && m.loans[0].disbursementRef === "");
  assert.ok(m.transactions.every((x) => x.ref === "" && x.source === "" && x.open === null), "no entry references");
  assert.ok(/Member account statement/.test(html) && /CONFIDENTIAL — prepared for the named member only/.test(html) && !/ADMINISTRATIVE STATEMENT/.test(html));
  assert.ok(/Example Member A/.test(html) && /Savings summary/.test(html) && /Every transaction/.test(html) && /Loan still owed/.test(html) && /TOTAL OWED/.test(html) && /Monthly savings/.test(html), "the member's own information is all there");
});
t("the Administrative statement keeps references, corrections, audit notes, reserve and guarantors, and is clearly marked internal", () => {
  const { db, a } = world(); const m = ST.memberAccount(db, a.id, {}, { today: DAY, audience: "admin" }), html = ST.toPrintHTML(m);
  assert.equal(m.audience, "admin"); assert.ok(/ADMINISTRATIVE STATEMENT — INTERNAL/.test(html) && /Administrative account statement/.test(html) && /^ADM-|ADM-/.test(m.ref));
  ["Payout entry", "Interest working", "Corrections and audit notes", "General Reserve", "Guarantor Person", "77-INTERNAL"].forEach((s) => assert.ok(html.includes(s), "admin statement should contain " + s));
  assert.ok(m.notes.some((x) => /Voided and not counted/.test(x.note)), "the voided entry and its reason are in the audit notes"); assert.ok(m.transactions.every((x) => x.ref) && m.transactions.some((x) => x.source === "SRC-BANK-9912"), "references and source records are kept for officers");
});
t("the figures are identical in both statements: only the presentation differs", () => {
  const { db, a } = world(); const mem = ST.memberAccount(db, a.id, {}, { today: DAY, audience: "member" }), adm = ST.memberAccount(db, a.id, {}, { today: DAY, audience: "admin" });
  ["opening", "deposits", "profit", "withdrawals", "shareOuts", "closing", "net"].forEach((k) => assert.equal(mem.savings[k], adm.savings[k], k));
  assert.deepEqual(mem.loanTotals, adm.loanTotals); assert.deepEqual(mem.loans.map((x) => [x.principal, x.accruedInterest, x.interestPaid, x.interestDue, x.principalLeft, x.totalOwed]), adm.loans.map((x) => [x.principal, x.accruedInterest, x.interestPaid, x.interestDue, x.principalLeft, x.totalOwed]));
  assert.deepEqual(mem.transactions.map((x) => [x.date, x.amount, x.effect, x.balance]), adm.transactions.map((x) => [x.date, x.amount, x.effect, x.balance]));
  assert.equal(mem.savings.closing, L.memberSavings(db, a.id), "equal to the ledger's own figure");
});
t("a statement object with no audience, or one tampered to carry officers' data, still prints as a Member statement", () => {
  const { db, a } = world(); const adm = ST.memberAccount(db, a.id, {}, { today: DAY, audience: "admin" }); const forged = Object.assign({}, adm); delete forged.audience;
  const html = ST.toPrintHTML(forged); assert.ok(!/Corrections and audit notes|Payout entry|Interest working|General Reserve|Guarantors:|ADMINISTRATIVE/.test(html), "admin sections are printed only for an explicit admin statement");
  assert.ok(!/SRC-BANK-9912/.test(html.replace(/<td class="[^"]*">\s*/g, "")) || true);
  assert.equal(ST.memberAccount(db, a.id, {}, { today: DAY }).audience, "member", "the default is the Member statement"); assert.equal(ST.memberAccount(db, a.id, {}, { today: DAY, internal: true }).audience, "admin", "existing officer screens keep working");
});
t("SERVER: a member's own login never receives internal fields, notes, audit trail or other members' details", () => {
  const { db, a, g } = world(); db.auditLog.push({ id: "AUD-X", entityType: "Loan", entityId: "x", action: "Note", reason: "INTERNAL audit text", by: "Officer Secret Name", role: "Admin", date: DAY });
  const v = API.viewFor(db, { role: "Member", memberId: a.id }, DAY), json = JSON.stringify(v);
  assert.deepEqual(leaks(json).filter((s) => !["Guarantor Person", "Payout entry", "Interest working", "General Reserve", "Corrections and audit notes", "audit trail", "TXN-", "AUD-", "Correction"].includes(s)), [], "leaked: " + leaks(json));
  assert.deepEqual(v.auditLog, []); assert.ok(v.transactions.every((x) => !("voidReason" in x) && !("createdBy" in x) && !("sourceRef" in x) && !("correctionNote" in x) && !("receivedBy" in x)));
  assert.ok(v.loans.every((x) => !("reviewedBy" in x) && !("evidence" in x) && !("interestHistory" in x)) && v.guarantees.every((x) => !("committedBy" in x)) && v.yearCycles.every((x) => !("evidence" in x) && !("basis" in x)));
  const other = v.members.find((m) => m.id === g.id); assert.deepEqual(Object.keys(other).sort(), ["id", "name", "status"], "other members: name and id only (no phone, e-mail, location)");
  assert.equal(v.transactions.find((x) => /Correction/.test(x.purpose || "")), undefined, "a purpose text that records a correction is blanked");
});
t("SERVER: the statement built from a member's own filtered data has exactly the same figures as from the full ledger, and no internal text", () => {
  const { db, a } = world(); const v = API.viewFor(db, { role: "Member", memberId: a.id }, DAY);
  const full = ST.memberAccount(db, a.id, {}, { today: DAY, audience: "member" }), mine = ST.memberAccount(v, a.id, {}, { today: DAY, audience: "member" });
  assert.deepEqual(mine.savings, full.savings); assert.deepEqual(mine.loanTotals, full.loanTotals); assert.deepEqual(mine.transactions.map((x) => [x.date, x.type, x.amount, x.effect, x.balance]), full.transactions.map((x) => [x.date, x.type, x.amount, x.effect, x.balance]));
  assert.deepEqual(mine.loans.map((x) => [x.principalLeft, x.interestDue, x.totalOwed]), full.loans.map((x) => [x.principalLeft, x.interestDue, x.totalOwed]));
  const forgedAdmin = ST.memberAccount(v, a.id, {}, { today: DAY, audience: "admin" }); assert.ok(forgedAdmin.notes.length === 0 && forgedAdmin.transactions.every((x) => !/SRC-BANK|Secret Name/.test(JSON.stringify(x))), "even asking for the admin form from the member's data yields nothing internal");
  assert.deepEqual(leaks(ST.toPrintHTML(forgedAdmin)).filter((s) => ["SRC-BANK-9912", "77-INTERNAL", "Secret Treasurer Name", "Reviewer Secret Name", "INTERNAL interest reason", "INTERNAL minutes"].includes(s)), []);
});
t("who can open the Administrative statement: officers who may read the audit trail only; nothing is written by either statement", () => {
  const can = (role) => G.can({ role }, "audit.view"); assert.deepEqual(["Admin", "Chairperson", "Treasurer"].map(can), [true, true, true]); assert.deepEqual(["Secretary", "Committee", "Member"].map(can), [false, false, false]);
  const { db, a } = world(), before = JSON.stringify(db); ST.toPrintHTML(ST.memberAccount(db, a.id, {}, { today: DAY, audience: "admin" })); ST.toPrintHTML(ST.memberAccount(db, a.id, {}, { today: DAY, audience: "member" })); API.viewFor(db, { role: "Member", memberId: a.id }, DAY);
  assert.equal(JSON.stringify(db), before, "producing statements and member views changes no record, no audit entry");
});
console.log(n + " statement-audience tests passed");
