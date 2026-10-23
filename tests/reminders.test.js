/* Loan reminder and recovery (WhatsApp, officer-sent). Synthetic data only. OFFLINE: proves the engine, commands and wiring; no WhatsApp or Google is contacted.
   Covers: live figures from the engine, no hard-coded figures, urgency from configured dates, duplicate prevention, delivery honesty, bulk privacy, financial safety, roles, audit. */
"use strict";
const assert = require("assert");
const G = require("../src/core/governance.js"), L = require("../src/core/ledger.js"), LN = require("../src/core/loans.js"), CMD = require("../src/core/commands.js"), RM = require("../src/core/reminders.js");
const API = require("../src/backend/api.js");
let n = 0; const t = (name, f) => { f(); n++; console.log("  ok " + name); };
const ctx = (role, day, extra) => G.makeCtx(Object.assign({ id: role, name: role, role }, extra || {}), { today: day, now: day + "T08:00:00Z" });
const fresh = () => ({ members: [], transactions: [], loans: [], auditLog: [], guarantees: [], policy: [], yearCycles: [], approvalRequests: [], reminders: [], schemaVersion: 2, seq: 0 });
const mem = (db, name, phone) => G.addMember(db, ctx("Admin", "2026-01-02"), { name, regDate: "2026-01-02", phone });
const save = (db, m, amt, day) => G.createEntry(db, ctx("Admin", day), { date: day, memberId: m.id, amount: amt, type: "Savings" });
function loan(db, m, amount, rate, day) {
  const l = LN.applyForLoan(db, ctx("Member", day, { memberId: m.id }), m.id, amount); LN.approveLoan(db, ctx("Admin", day), l.id); LN.approveLoan(db, ctx("Chairperson", day), l.id);
  LN.disburseLoan(db, ctx("Admin", day), l.id, { date: day, assignedMonthlyInterest: rate }); return l;
}
const setDates = (db, day, so, dl) => { const r = CMD.run(db, ctx("Admin", day), "setReminderDates", { shareOutDate: so || "2026-12-19", deadline: dl || "2026-12-05", reason: "committee decision (test)" }); CMD.run(db, ctx("Chairperson", day), "approveRequest", { id: r.requestId }); return r; };
const world = () => { const db = fresh(), a = mem(db, "Example Member A", "0772123456"); save(db, a, 300000, "2026-01-05"); const l = loan(db, a, 100000, 10000, "2026-02-03"); return { db, a, l }; };
const run = (db, role, day, name, args) => CMD.run(db, ctx(role, day), name, args);
const num = (s, label) => Number((new RegExp(label + ": UGX ([\\d,]+)").exec(s) || [])[1].replace(/,/g, ""));

t("nothing is prepared until the share-out date and approved deadline are configured (nothing is guessed)", () => {
  const { db, l } = world(); assert.throws(() => run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id }), /NOT_CONFIGURED/);
  assert.equal(db.reminders.length, 0);
});

t("the dates are gated: the Admin asks, the Chairperson approves, and the requester cannot approve their own", () => {
  const { db } = world(); const r = run(db, "Admin", "2026-10-22", "setReminderDates", { shareOutDate: "2026-12-19", deadline: "2026-12-05", reason: "committee" });
  assert.equal(r.pendingApproval, true); assert.equal(RM.getConfig(db).shareOutDate, null, "no effect before approval");
  assert.throws(() => run(db, "Admin", "2026-10-22", "approveRequest", { id: r.requestId }), /FORBIDDEN|SEPARATION/);
  run(db, "Chairperson", "2026-10-22", "approveRequest", { id: r.requestId });
  const c = RM.getConfig(db); assert.equal(c.shareOutDate, "2026-12-19"); assert.equal(c.deadline, "2026-12-05");
  assert.ok(db.auditLog.some((x) => x.entityType === "ReminderDates"), "audit trail of the dates");
});

t("date rules: share-out in December, not in the past; deadline a real day not after the share-out", () => {
  const { db } = world(); const bad = (a, re) => assert.throws(() => run(db, "Admin", "2026-10-22", "setReminderDates", Object.assign({ shareOutDate: "2026-12-19", deadline: "2026-12-05", reason: "x" }, a)), re);
  bad({ shareOutDate: "2026-11-19" }, /December/); bad({ shareOutDate: "2025-12-19" }, /passed|December/); bad({ deadline: "2026-12-25" }, /after the share-out/); bad({ deadline: "2026-02-30" }, /real day/); bad({ reason: "" }, /REQUIRED|reason/);
});

t("the message carries every required item and every figure equals the engine's own at that moment", () => {
  const { db, l } = world(); setDates(db, "2026-10-22");
  const rec = run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id }), s = rec.body;
  assert.match(s, /Dear Example Member A,/); assert.match(s, /SOB-001/); assert.match(s, /Praise the Lord\./); assert.match(s, /1 Corinthians 4:2/); assert.match(s, /SOB Savings Group Administration\./);
  assert.equal(num(s, "Loan Principal"), 100000); assert.match(s, /Disbursement Date: 3 Feb 2026/); assert.equal(num(s, "Monthly Interest"), 10000);
  assert.match(s, /Interest Period: 8 calendar months \(3 Feb 2026 to 22 Oct 2026\)/);
  assert.equal(num(s, "Accrued Interest"), L.loanAccumulatedInterest(l, "2026-10-22")); assert.equal(num(s, "Accrued Interest"), 80000);
  assert.equal(num(s, "Repayments Received"), 0); assert.equal(num(s, "Outstanding Principal"), 100000); assert.equal(num(s, "Unpaid Interest"), 80000);
  assert.equal(num(s, "Total Outstanding"), L.loanOutstanding(l, db, "2026-10-22")); assert.equal(num(s, "Total Outstanding"), 180000);
  assert.match(s, /Repayment Deadline: 5 Dec 2026/); assert.match(s, /Days Remaining: 44 days/); assert.match(s, /Annual Share-Out: 19 Dec 2026 \(58 days to go\)/); assert.match(s, /Figures as at 22 Oct 2026, 11:00 EAT/);
});

t("interest-first repayments are reflected exactly (20,000 then 60,000 -> principal 40,000 repaid, 60,000 outstanding)", () => {
  const { db, l } = world(); setDates(db, "2026-05-01", "2026-12-19", "2026-12-05");
  run(db, "Admin", "2026-05-10", "repayLoan", { loanId: l.id, amount: 20000, date: "2026-05-10" }); run(db, "Admin", "2026-06-02", "repayLoan", { loanId: l.id, amount: 60000, date: "2026-06-02" });
  const rec = run(db, "Admin", "2026-06-02", "prepareReminder", { loanId: l.id }), s = rec.body;
  assert.equal(num(s, "Repayments Received"), 80000); assert.equal(num(s, "Total Outstanding"), 60000 + 0); assert.equal(num(s, "Outstanding Principal"), 60000); assert.equal(num(s, "Unpaid Interest"), 0);
  assert.equal(num(s, "Total Outstanding"), L.loanOutstanding(l, db, "2026-06-02"));
});

t("LIVE: a repayment recorded after a reminder is reflected by the next one, and the old one is refused as stale", () => {
  const { db, l } = world(); setDates(db, "2026-10-22");
  const r1 = run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id, level: "FRIENDLY" });
  assert.equal(run(db, "Admin", "2026-10-22", "revalidateReminder", { id: r1.id }).text, r1.body, "unchanged balance: same text may be opened again");
  run(db, "Admin", "2026-10-22", "repayLoan", { loanId: l.id, amount: 50000, date: "2026-10-22" });
  assert.throws(() => run(db, "Admin", "2026-10-22", "revalidateReminder", { id: r1.id }), /STALE_REMINDER/);
  const r2 = run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id, level: "URGENT" });
  assert.equal(num(r2.body, "Repayments Received"), 50000); assert.equal(num(r2.body, "Total Outstanding"), 130000);
  assert.throws(() => run(db, "Admin", "2026-10-23", "revalidateReminder", { id: r2.id }), /STALE_REMINDER/, "tomorrow interest/days have moved on");
});

t("settled loans are excluded automatically and cannot be reminded", () => {
  const { db, l } = world(); setDates(db, "2026-10-22");
  run(db, "Admin", "2026-10-22", "repayLoan", { loanId: l.id, amount: 180000, date: "2026-10-22" });
  const c = RM.candidates(db, "2026-10-22"); assert.equal(c.rows.length, 0); assert.ok(c.excluded.settled >= 1);
  assert.throws(() => run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id }), /SETTLED|not an active|CANNOT/);
});

t("urgency follows the configured dates and becomes progressively firmer (overdue = Final Notice)", () => {
  const { db, l } = world(); setDates(db, "2026-10-22");
  const at = (day) => run(db, "Admin", day, "prepareReminder", { loanId: l.id });
  const early = at("2026-10-22"), mid = at("2026-11-20"), late = at("2026-12-01"), over = at("2026-12-08");
  assert.deepEqual([early, mid, late, over].map((r) => r.level), ["FRIENDLY", "URGENT", "FINAL", "FINAL"]);
  assert.match(mid.body, /Days Remaining: 15 days/); assert.match(late.body, /Days Remaining: 4 days/); assert.match(over.body, /Deadline passed 3 days ago/);
  assert.match(late.body, /final notice/i); assert.match(mid.body, /fellow members who are expecting their savings/); assert.match(over.body, /fellow members who are expecting their savings/);
  assert.notEqual(early.body.split("\n")[4], late.body.split("\n")[4], "wording differs by level");
});

t("a loan-specific approved deadline overrides the general one", () => {
  const { db, l } = world(); setDates(db, "2026-10-22");
  const r = run(db, "Admin", "2026-10-22", "setReminderDates", { shareOutDate: "2026-12-19", deadline: "2026-12-05", loanDeadlines: { [l.id]: "2026-11-15" }, reason: "agreed with member" }); run(db, "Chairperson", "2026-10-22", "approveRequest", { id: r.requestId });
  const rec = run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id }); assert.match(rec.body, /Repayment Deadline: 15 Nov 2026/); assert.match(rec.body, /Days Remaining: 24 days/); assert.equal(rec.level, "URGENT");
});

t("duplicates are prevented; a firmer level or the next interval is allowed; cancelling frees the slot", () => {
  const { db, l } = world(); setDates(db, "2026-10-22");
  const r1 = run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id });
  assert.throws(() => run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id }), /DUPLICATE_REMINDER/);
  assert.throws(() => run(db, "Admin", "2026-10-25", "prepareReminder", { loanId: l.id, level: "FRIENDLY" }), /DUPLICATE_REMINDER/, "inside the 7-day interval");
  assert.ok(run(db, "Admin", "2026-10-25", "prepareReminder", { loanId: l.id, level: "URGENT" }), "firmer level is an escalation, allowed");
  assert.ok(run(db, "Admin", "2026-11-02", "prepareReminder", { loanId: l.id, level: "URGENT" }), "after the interval");
  const { db: d2, l: l2 } = world(); setDates(d2, "2026-10-22"); const x = run(d2, "Admin", "2026-10-22", "prepareReminder", { loanId: l2.id });
  run(d2, "Admin", "2026-10-22", "cancelReminder", { id: x.id, reason: "wrong level chosen" }); assert.ok(run(d2, "Admin", "2026-10-22", "prepareReminder", { loanId: l2.id }));
  void r1;
});

t("opening WhatsApp is NOT delivery: only the officer's own confirmation marks it sent; nothing skips a step", () => {
  const { db, l } = world(); setDates(db, "2026-10-22"); const r = run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id });
  assert.equal(r.delivery, "PREPARED"); assert.throws(() => run(db, "Admin", "2026-10-22", "confirmReminderSent", { id: r.id }), /open WhatsApp first/);
  assert.throws(() => run(db, "Admin", "2026-10-22", "setReminderFollowUp", { id: r.id, followUp: "REPLIED" }), /BAD_STATE/);
  const o = run(db, "Admin", "2026-10-22", "markReminderOpened", { id: r.id }); assert.equal(o.delivery, "OPENED"); assert.ok(!("sentConfirmedAt" in o), "no sent time just because it was opened");
  assert.match(RM.DELIVERY_LABEL.OPENED, /NOT confirmed/); assert.ok(!Object.keys(RM.DELIVERY_LABEL).some((k) => /DELIVERED/.test(k)), "there is no DELIVERED state");
  const s = run(db, "Admin", "2026-10-22", "confirmReminderSent", { id: r.id, note: "sent from officer phone" }); assert.equal(s.delivery, "SENT_CONFIRMED"); assert.equal(s.followUp, "AWAITING_REPLY");
  assert.throws(() => run(db, "Admin", "2026-10-22", "cancelReminder", { id: r.id, reason: "x" }), /cannot be cancelled/);
  assert.throws(() => run(db, "Admin", "2026-10-22", "setReminderFollowUp", { id: r.id, followUp: "PROMISE_TO_PAY" }), /date/);
  const f = run(db, "Admin", "2026-10-23", "setReminderFollowUp", { id: r.id, followUp: "PROMISE_TO_PAY", promiseDate: "2026-11-01", note: "by phone" }); assert.equal(f.promiseDate, "2026-11-01");
  assert.equal(L.loanOutstanding(l, db, "2026-10-23"), 100000 + 80000 + 10000 * 0 + 0, "a promise to pay changes no balance");
  assert.ok(f.events.length >= 4 && f.events.every((e) => e.at && e.by), "every step is timestamped and attributed");
});

t("bulk reminders are individually addressed private chats, never group links; each shows only its own member's data", () => {
  const db = fresh(); const names = ["Alpha One", "Bravo Two", "Charlie Three"], ms = names.map((nm, i) => mem(db, nm, "07721234" + (10 + i))); ms.forEach((m) => save(db, m, 400000, "2026-01-05"));
  ms.forEach((m, i) => loan(db, m, 100000 * (i + 1), 5000 * (i + 1), "2026-03-03")); setDates(db, "2026-10-22");
  const res = run(db, "Admin", "2026-10-22", "prepareReminders", {}); assert.equal(res.results.filter((x) => x.ok).length, 3);
  assert.equal(new Set(res.results.map((x) => x.reminderId)).size, 3, "one record per member");
  db.reminders.forEach((r) => {
    const m = ms.find((x) => x.id === r.memberId), link = RM.waLink(m.phone, r.body);
    assert.match(link, /^https:\/\/wa\.me\/256772123\d{3}\?text=/); assert.ok(!/chat\.whatsapp\.com|whatsapp\.com\/send\?|wa\.me\/\?/.test(link), "never a group or an open-recipient link");
    ms.filter((x) => x.id !== r.memberId).forEach((o) => { assert.ok(!r.body.includes(o.name) && !r.body.includes(o.id), "no other member's name or id"); });
    assert.equal(num(r.body, "Loan Principal"), 100000 * (ms.indexOf(m) + 1));
  });
  assert.equal(RM.waLink("not a number", "x"), null); assert.equal(db.reminders.filter((r) => r.delivery !== "PREPARED").length, 0, "bulk prepare sends nothing");
});

t("bulk skips what cannot be reminded safely, and says why (no phone, opted out, unestablished start date, settled)", () => {
  const db = fresh(), a = mem(db, "Has Phone", "0772000001"), b = mem(db, "No Phone", ""), c = mem(db, "Opted Out", "0772000003"), d = mem(db, "Unknown Date", "0772000004");
  [a, b, c, d].forEach((m) => save(db, m, 300000, "2026-01-05")); const la = loan(db, a, 50000, 5000, "2026-03-03"), lb = loan(db, b, 50000, 5000, "2026-03-03"), lc = loan(db, c, 50000, 5000, "2026-03-03"), ld = loan(db, d, 50000, 5000, "2026-03-03");
  c.notifyOptOut = true; ld.dateUnknown = true; setDates(db, "2026-10-22");
  const r = run(db, "Admin", "2026-10-22", "prepareReminders", {}), by = (l) => r.results.find((x) => x.loanId === l.id);
  assert.equal(by(la).ok, true); assert.match(by(lb).reason, /NO_VALID_PHONE/); assert.match(by(lc).reason, /OPTED_OUT/); assert.match(by(ld).reason, /CANNOT_VERIFY/);
  assert.equal(db.reminders.length, 1);
});

t("figures that cannot be verified never produce a reminder", () => {
  const { db, l } = world(); setDates(db, "2026-10-22"); const before = db.reminders.length;
  l.loanAmount = "not a number"; assert.throws(() => run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id }), /CANNOT_VERIFY|not valid/); assert.equal(db.reminders.length, before);
});

t("wording is configurable without code, but a template can never carry a figure of its own", () => {
  const { db, l } = world(); setDates(db, "2026-10-22");
  run(db, "Admin", "2026-10-22", "setReminderSettings", { templates: { FRIENDLY: { intro: "Greetings in Christ, {name}. A gentle reminder before our share-out." } }, urgentDays: 40, finalDays: 10, minIntervalDays: 3, reason: "committee wording" });
  const c = RM.getConfig(db); assert.equal(c.urgentDays, 40); assert.equal(c.finalDays, 10); assert.equal(c.minIntervalDays, 3);
  const rec = run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id }); assert.match(rec.body, /Greetings in Christ, Example Member A\./);
  const bad = (templates, re) => assert.throws(() => run(db, "Admin", "2026-10-22", "setReminderSettings", { templates, reason: "x" }), re);
  bad({ FRIENDLY: { intro: "Please pay UGX 180,000 now" } }, /amounts or other long numbers/); bad({ FRIENDLY: { intro: "Pay 180000" } }, /long numbers/); bad({ FRIENDLY: { intro: "Hello {balance}" } }, /unknown placeholder/);
  bad({ NICE: { intro: "x" } }, /unknown level/); bad({ FRIENDLY: { intro: "" } }, /empty/); bad({ FRIENDLY: { bogus: "x" } }, /unknown wording field/);
  assert.throws(() => run(db, "Admin", "2026-10-22", "setReminderSettings", { urgentDays: 5, finalDays: 9, reason: "x" }), /shorter/);
  assert.ok(db.auditLog.some((x) => x.entityType === "ReminderSettings"));
  assert.ok(!/\d{4,}/.test(JSON.stringify(RM.DEFAULT_TEMPLATES).replace(/\{[^}]*\}/g, "")), "built-in wording contains no long numbers");
});

t("who may do what: Admin only; Chairperson approves dates only; Treasurer, Secretary, Committee and members are refused", () => {
  const { db, a, l } = world(); setDates(db, "2026-10-22");
  ["Chairperson", "Treasurer", "Secretary", "Committee"].forEach((role) => { assert.throws(() => run(db, role, "2026-10-22", "prepareReminder", { loanId: l.id }), /FORBIDDEN/, role); assert.throws(() => run(db, role, "2026-10-22", "prepareReminders", {}), /FORBIDDEN/, role); });
  assert.throws(() => CMD.run(db, ctx("Member", "2026-10-22", { memberId: a.id }), "prepareReminder", { loanId: l.id }), /FORBIDDEN/);
  assert.throws(() => run(db, "Treasurer", "2026-10-22", "setReminderDates", { shareOutDate: "2026-12-19", deadline: "2026-12-05", reason: "x" }), /FORBIDDEN/);
  assert.throws(() => run(db, "Chairperson", "2026-10-22", "setReminderSettings", { urgentDays: 20, reason: "x" }), /FORBIDDEN/);
});

t("FINANCIAL SAFETY: preparing, opening, confirming and cancelling reminders changes no loan, repayment, interest, balance or approval", () => {
  const { db, a, l } = world(); setDates(db, "2026-10-22"); run(db, "Admin", "2026-10-22", "repayLoan", { loanId: l.id, amount: 20000, date: "2026-10-22" });
  const snap = () => JSON.stringify({ loans: db.loans, transactions: db.transactions, guarantees: db.guarantees, members: db.members, approvalRequests: db.approvalRequests, yearCycles: db.yearCycles });
  const before = snap(), pos = [L.loanOutstanding(l, db, "2026-10-22"), L.memberSavings(db, a.id)];
  const r = run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id }); run(db, "Admin", "2026-10-22", "markReminderOpened", { id: r.id }); run(db, "Admin", "2026-10-22", "confirmReminderSent", { id: r.id });
  run(db, "Admin", "2026-10-22", "setReminderFollowUp", { id: r.id, followUp: "REPLIED" }); run(db, "Admin", "2026-10-22", "prepareReminders", {}); try { run(db, "Admin", "2026-10-22", "revalidateReminder", { id: r.id }); } catch (e) { /* allowed to be stale */ }
  assert.equal(snap(), before); assert.deepEqual([L.loanOutstanding(l, db, "2026-10-22"), L.memberSavings(db, a.id)], pos);
  assert.ok(db.auditLog.filter((x) => x.entityType === "Reminder").length >= 4, "every reminder action is audit-logged");
});

t("the reminder history is Super-Admin-only: other staff and members never receive it", () => {
  const { db, a, l } = world(); setDates(db, "2026-10-22"); run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id }); db.users = [];
  assert.equal(API.viewFor(db, { role: "Admin", id: "ADMIN" }, "2026-10-22").reminders.length, 1);
  ["Chairperson", "Treasurer", "Secretary", "Committee"].forEach((role) => assert.deepEqual(API.viewFor(db, { role, id: role }, "2026-10-22").reminders, [], role));
  const mv = API.viewFor(db, { role: "Member", id: a.id, memberId: a.id }, "2026-10-22"); assert.ok(!mv.reminders || mv.reminders.length === 0); assert.ok(!JSON.stringify(mv).includes("Praise the Lord"), "member view contains no reminder text");
});

console.log(n + " reminder tests passed");
