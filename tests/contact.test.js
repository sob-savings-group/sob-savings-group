/* Edit contact details of an existing member (phone/WhatsApp, e-mail, location). Super Admin only. Synthetic data. OFFLINE.
   Proves: validation, audit with before/after, nothing financial or identifying changes, role refusals, duplicate-number guard, and that the new number is what Loan Reminders use. */
const assert = require("assert");
const G = require("../src/core/governance.js"), L = require("../src/core/ledger.js"), LN = require("../src/core/loans.js"), CMD = require("../src/core/commands.js"), RM = require("../src/core/reminders.js");
let n = 0; const t = (name, f) => { f(); n++; console.log("  ok " + name); };
const ctx = (role, day, extra) => G.makeCtx(Object.assign({ id: role, name: role, role }, extra || {}), { today: day, now: day + "T08:00:00Z" });
const fresh = () => ({ members: [], transactions: [], loans: [], auditLog: [], guarantees: [], policy: [], yearCycles: [], approvalRequests: [], reminders: [], schemaVersion: 2, seq: 0 });
const DAY = "2026-10-24", run = (db, role, name, args) => CMD.run(db, ctx(role, DAY), name, args);
function world() {
  const db = fresh(), a = G.addMember(db, ctx("Admin", "2026-01-02"), { name: "Example Member A", regDate: "2026-01-02", phone: "" }), b = G.addMember(db, ctx("Admin", "2026-01-02"), { name: "Example Member B", regDate: "2026-01-02", phone: "0772123456", email: "b@example.org", location: "Kampala" });
  [a, b].forEach((m) => G.createEntry(db, ctx("Admin", "2026-01-05"), { date: "2026-01-05", memberId: m.id, amount: 300000, type: "Savings" }));
  const l = LN.applyForLoan(db, ctx("Member", "2026-02-01", { memberId: a.id }), a.id, 100000); LN.approveLoan(db, ctx("Admin", "2026-02-02"), l.id); LN.approveLoan(db, ctx("Chairperson", "2026-02-02"), l.id);
  LN.disburseLoan(db, ctx("Admin", "2026-02-03"), l.id, { date: "2026-02-03", assignedMonthlyInterest: 10000 });
  return { db, a, b, l };
}
const money = (db) => JSON.stringify({ t: db.transactions, l: db.loans, g: db.guarantees, y: db.yearCycles, ap: db.approvalRequests });

t("the Super Admin updates phone, e-mail and location; the previous and new values are in the audit trail", () => {
  const { db, a } = world(); const r = run(db, "Admin", "updateMemberContact", { memberId: a.id, phone: "+256 772 000 111", email: "grace@example.org", location: "Mukono", reason: "member gave a new number" });
  assert.equal(r.phone, "0772000111", "stored in the local form the Members sheet already uses"); assert.equal(a.email, "grace@example.org"); assert.equal(a.location, "Mukono");
  const e = db.auditLog.filter((x) => x.entityType === "Member" && x.action === "ContactUpdated"); assert.equal(e.length, 1);
  assert.deepEqual(e[0].previousValue, { phone: "", email: "", location: "" }); assert.deepEqual(e[0].newValue, { phone: "0772000111", email: "grace@example.org", location: "Mukono" });
  assert.equal(e[0].role, "Admin"); assert.equal(e[0].reason, "member gave a new number");
});
t("only contact fields change: id, name, registration date, status, savings, loans and every financial record are untouched", () => {
  const { db, a, l } = world(), before = money(db), idn = JSON.stringify({ id: a.id, name: a.name, regDate: a.regDate, status: a.status }), sav = L.memberSavings(db, a.id), out = L.loanOutstanding(l, db, DAY), nMem = db.members.length;
  run(db, "Admin", "updateMemberContact", { memberId: a.id, phone: "0701234567", location: "Entebbe" });
  assert.equal(money(db), before); assert.equal(JSON.stringify({ id: a.id, name: a.name, regDate: a.regDate, status: a.status }), idn);
  assert.equal(L.memberSavings(db, a.id), sav); assert.equal(L.loanOutstanding(l, db, DAY), out); assert.equal(db.members.length, nMem);
  assert.throws(() => run(db, "Admin", "updateMemberContact", { memberId: a.id, phone: "0701234567", name: "Someone Else", status: "Closed", id: "SOB-099" }), /NO_CHANGE/, "name/status/id arguments are ignored, never applied"); assert.equal(a.name, "Example Member A"); assert.equal(a.status, "Active");
});
t("validation: Uganda numbers in common written forms are accepted and stored uniformly; nonsense is refused", () => {
  const { db, a } = world();
  [["0772 123 457", "0772123457"], ["+256-772-123-458", "0772123458"], ["256772123459", "0772123459"], ["(0772)123460", "0772123460"]].forEach(([inp, want]) => { assert.equal(run(db, "Admin", "updateMemberContact", { memberId: a.id, phone: inp }).phone, want); });
  ["12345", "0772 12", "+1 202 555 0100", "abc", "0772123456789"].forEach((bad) => assert.throws(() => run(db, "Admin", "updateMemberContact", { memberId: a.id, phone: bad }), /INVALID/, bad));
  ["not-an-email", "a b@c.org", "x@y", "a@b.c"].forEach((bad) => assert.throws(() => run(db, "Admin", "updateMemberContact", { memberId: a.id, email: bad }), /INVALID/, bad));
  assert.throws(() => run(db, "Admin", "updateMemberContact", { memberId: a.id, location: "x".repeat(101) }), /INVALID/); assert.throws(() => run(db, "Admin", "updateMemberContact", { memberId: a.id, location: "bad\u0007text" }), /INVALID/);
  assert.throws(() => run(db, "Admin", "updateMemberContact", { memberId: a.id }), /INVALID/, "nothing to change"); assert.throws(() => run(db, "Admin", "updateMemberContact", { memberId: "SOB-404", phone: "0772000000" }), /NOT_FOUND/);
  assert.throws(() => run(db, "Admin", "updateMemberContact", { memberId: a.id, phone: "0772123460" }), /NO_CHANGE/, "an unchanged save is refused and writes no audit entry");
  assert.equal(db.auditLog.filter((x) => x.action === "ContactUpdated").length, 4, "refused attempts leave no audit entries");
});
t("a number already held by another member is refused unless the Super Admin states they share one; a field can be cleared", () => {
  const { db, a, b } = world();
  assert.throws(() => run(db, "Admin", "updateMemberContact", { memberId: a.id, phone: "+256772123456" }), /DUPLICATE_PHONE: .*SOB-002/);
  assert.equal(run(db, "Admin", "updateMemberContact", { memberId: a.id, phone: "0772 123 456", allowShared: true }).phone, "0772123456");
  assert.equal(run(db, "Admin", "updateMemberContact", { memberId: b.id, email: "", location: "" }).email, "", "an e-mail/location can be removed"); assert.equal(b.phone, "0772123456", "fields not given are left alone");
});
t("only the Super Admin: Chairperson, Treasurer, Secretary, Committee and members are refused (also through the server)", () => {
  const { db, a } = world(); const before = JSON.stringify(db.members);
  ["Chairperson", "Treasurer", "Secretary", "Committee"].forEach((r) => assert.throws(() => run(db, r, "updateMemberContact", { memberId: a.id, phone: "0772000999" }), /FORBIDDEN/, r));
  assert.throws(() => CMD.run(db, ctx("Member", DAY, { memberId: a.id }), "updateMemberContact", { memberId: a.id, phone: "0772000999" }), /FORBIDDEN/, "a member cannot change even their own record here");
  assert.equal(JSON.stringify(db.members), before); assert.ok(!CMD.GATED.updateMemberContact, "no Chairperson step: it moves no money and the Super Admin is the member-records authority");
});
t("the new number is exactly what Loan Reminders use (no number -> cannot be reminded; after the edit -> private chat link to the new number)", () => {
  const { db, a, l } = world(); const so = run(db, "Admin", "setReminderDates", { shareOutDate: "2026-12-19", deadline: "2026-12-05", reason: "committee decision (test)" }); run(db, "Chairperson", "approveRequest", { id: so.requestId });
  let row = RM.candidates(db, DAY).rows.find((r) => r.loan.id === l.id); assert.match(row.problem, /NO_VALID_PHONE/);
  assert.throws(() => run(db, "Admin", "prepareReminder", { loanId: l.id }), /NO_VALID_PHONE/);
  run(db, "Admin", "updateMemberContact", { memberId: a.id, phone: "0752 987 654" });
  row = RM.candidates(db, DAY).rows.find((r) => r.loan.id === l.id); assert.ok(!row.problem, "the loan can now be reminded");
  const rec = run(db, "Admin", "prepareReminder", { loanId: l.id }); const link = RM.waLink(db.members.find((m) => m.id === a.id).phone, rec.text);
  assert.ok(link.startsWith("https://wa.me/256752987654?text="), link.slice(0, 40)); assert.ok(!/chat\.whatsapp\.com|\/g\//.test(link), "a private chat, never a group");
  run(db, "Admin", "updateMemberContact", { memberId: a.id, phone: "0772 000 222" }); assert.ok(RM.waLink(db.members.find((m) => m.id === a.id).phone, "x").startsWith("https://wa.me/256772000222"), "a later change is used by the next reminder");
});
console.log(n + " contact-detail tests passed");
