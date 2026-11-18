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
  assert.match(s, /Dear Example Member A,/); assert.match(s, /Praise the Lord\./); assert.match(s, /SOB Savings Group Administration\./);
  assert.equal(num(s, "Loan Principal"), 100000); assert.match(s, /Loan Disbursement Date: 3 February 2026/);
  assert.equal(num(s, "Accrued Interest"), L.loanAccumulatedInterest(l, "2026-10-22")); assert.equal(num(s, "Accrued Interest"), 80000);
  assert.equal(num(s, "Total Balance Due"), L.loanOutstanding(l, db, "2026-10-22")); assert.equal(num(s, "Total Balance Due"), 180000);
  assert.match(s, /Payment Deadline: 5 December 2026/); assert.ok(!/Days Remaining|Monthly Interest|Interest Period/.test(s), "brief official layout");
});

t("interest-first repayments are reflected exactly (20,000 then 60,000 -> principal 40,000 repaid, 60,000 outstanding)", () => {
  const { db, l } = world(); setDates(db, "2026-05-01", "2026-12-19", "2026-12-05");
  run(db, "Admin", "2026-05-10", "repayLoan", { loanId: l.id, amount: 20000, date: "2026-05-10" }); run(db, "Admin", "2026-06-02", "repayLoan", { loanId: l.id, amount: 60000, date: "2026-06-02" });
  const rec = run(db, "Admin", "2026-06-02", "prepareReminder", { loanId: l.id }), s = rec.body;
  assert.equal(num(s, "Repayments Received"), 80000); assert.equal(num(s, "Total Balance Due"), 60000);
  assert.equal(num(s, "Total Balance Due"), L.loanOutstanding(l, db, "2026-06-02"));
  assert.equal(num(s, "Loan Principal") + num(s, "Accrued Interest") - num(s, "Repayments Received"), num(s, "Total Balance Due"), "the lines add up");
});

t("LIVE: a repayment recorded after a reminder is reflected by the next one, and the old one is refused as stale", () => {
  const { db, l } = world(); setDates(db, "2026-10-22");
  const r1 = run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id, level: "FRIENDLY" });
  assert.equal(run(db, "Admin", "2026-10-22", "revalidateReminder", { id: r1.id }).text, r1.body, "unchanged balance: same text may be opened again");
  run(db, "Admin", "2026-10-22", "repayLoan", { loanId: l.id, amount: 50000, date: "2026-10-22" });
  assert.throws(() => run(db, "Admin", "2026-10-22", "revalidateReminder", { id: r1.id }), /STALE_REMINDER/);
  const r2 = run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id, level: "URGENT" });
  assert.equal(num(r2.body, "Repayments Received"), 50000); assert.equal(num(r2.body, "Total Balance Due"), 130000);
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
  assert.match(mid.body, /Payment Deadline: 5 December 2026/); assert.match(over.body, /Payment Deadline: 5 December 2026/);
  assert.match(late.body, /final notice/i); assert.match(mid.body, /urgent/i); assert.match(over.body, /Church Administration/);
  assert.notEqual(early.body.split("\n")[4], late.body.split("\n")[4], "wording differs by level");
});

t("a loan-specific approved deadline overrides the general one", () => {
  const { db, l } = world(); setDates(db, "2026-10-22");
  const r = run(db, "Admin", "2026-10-22", "setReminderDates", { shareOutDate: "2026-12-19", deadline: "2026-12-05", loanDeadlines: { [l.id]: "2026-11-15" }, reason: "agreed with member" }); run(db, "Chairperson", "2026-10-22", "approveRequest", { id: r.requestId });
  const rec = run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id }); assert.match(rec.body, /Payment Deadline: 15 November 2026/); assert.equal(rec.level, "URGENT");
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

const N = require("../src/core/notify.js");
const smsWorld = () => { const w = world(); setDates(w.db, "2026-10-22"); const rec = run(w.db, "Admin", "2026-10-22", "prepareReminder", { loanId: w.l.id }); return Object.assign(w, { rec }); };
const gw = (live, answer) => { const sent = []; return { sent, g: { SMS: { live, send: (m) => { sent.push(m); return answer || { ok: true, providerRef: "" }; } }, adminPhone: "" } }; };
t("SMS: queue -> gateway -> accepted is recorded honestly (accepted is not delivered), the text is the verified reminder text, and it goes to the member's own number only", () => {
  const { db, rec } = smsWorld(), { g, sent } = gw(true); const q = run(db, "Admin", "2026-10-22", "queueReminderSms", { id: rec.id });
  assert.equal(db.outbox.length, 1); assert.equal(db.outbox[0].to, "+256772123456"); assert.equal(db.outbox[0].channel, "SMS");
  N.dispatch(db, ctx("Admin", "2026-10-22"), g, { ids: [q.outboxId] }); assert.equal(sent.length, 1); assert.ok(!/[*]|(^|\s)_/.test(sent[0].body), "no WhatsApp markup in an SMS"); assert.ok(/UGX/.test(sent[0].body)); assert.ok(sent[0].body.length <= 50, "an SMS is never longer than 50 characters"); assert.ok(!/[\u201C\u201D\u2014]/.test(sent[0].body), "plain characters only"); const bal = /(UGX [\d,]+)/.exec(sent[0].body); assert.ok(bal && db.reminders[0].body.includes(bal[1]), "the amount in the SMS equals the verified reminder balance"); assert.strictEqual(db.reminders[0].smsBody, sent[0].body);
  run(db, "Admin", "2026-10-22", "syncReminderSms", { id: rec.id }); const r = db.reminders[0]; assert.equal(r.delivery, "SMS_ACCEPTED"); assert.ok(r.events.some((e) => e.event === "SMS_ACCEPTED" && /does not prove/.test(e.note)));
  assert.throws(() => run(db, "Admin", "2026-10-22", "queueReminderSms", { id: rec.id }), /already sent/); assert.throws(() => run(db, "Admin", "2026-10-22", "cancelReminder", { id: rec.id, reason: "x" }), /cannot be cancelled/);
});
t("SMS: a second tap never sends twice; with the gateway off nothing is sent; a failure is recorded and can be retried", () => {
  const { db, rec } = smsWorld(); const a = run(db, "Admin", "2026-10-22", "queueReminderSms", { id: rec.id }), b = run(db, "Admin", "2026-10-22", "queueReminderSms", { id: rec.id }); assert.equal(a.outboxId, b.outboxId); assert.equal(db.outbox.length, 1);
  const off = gw(false); N.dispatch(db, ctx("Admin", "2026-10-22"), off.g, { ids: [a.outboxId] }); assert.equal(off.sent.length, 0); run(db, "Admin", "2026-10-22", "syncReminderSms", { id: rec.id }); assert.notEqual(db.reminders[0].delivery, "SMS_ACCEPTED"); assert.ok(db.reminders[0].events.some((e) => e.event === "SMS_NOT_SENT"));
  const bad = gw(true, { ok: false, error: "HTTP 401" }); N.dispatch(db, ctx("Admin", "2026-10-22"), bad.g, { ids: [a.outboxId] }); run(db, "Admin", "2026-10-22", "syncReminderSms", { id: rec.id }); assert.ok(db.reminders[0].events.some((e) => e.event === "SMS_FAILED" && /401/.test(e.note))); assert.notEqual(db.reminders[0].delivery, "SMS_ACCEPTED");
  const ok = gw(true); N.dispatch(db, ctx("Admin", "2026-10-22"), ok.g, { ids: [a.outboxId] }); run(db, "Admin", "2026-10-22", "syncReminderSms", { id: rec.id }); assert.equal(db.reminders[0].delivery, "SMS_ACCEPTED"); assert.equal(ok.sent.length, 1);
});
t("SMS: a targeted send touches nothing else in the outbox; stale figures, opted-out members and non-officers are refused", () => {
  const { db, rec, a } = smsWorld(); N.queue(db, ctx("Admin", "2026-10-22"), { memberId: a.id, template: "custom", vars: { text: "other queued message" }, channel: "SMS" });
  const q = run(db, "Admin", "2026-10-22", "queueReminderSms", { id: rec.id }), { g, sent } = gw(true); N.dispatch(db, ctx("Admin", "2026-10-22"), g, { ids: [q.outboxId] }); assert.equal(sent.length, 1); assert.equal(db.outbox.find((m) => m.template === "custom").status, "QUEUED");
  const w2 = smsWorld(); G.updateMemberContact; w2.db.members[0].notifyOptOut = true; assert.throws(() => run(w2.db, "Admin", "2026-10-22", "queueReminderSms", { id: w2.rec.id }), /OPTED_OUT/);
  const w3 = smsWorld(); G.createEntry(w3.db, ctx("Admin", "2026-10-22"), { date: "2026-10-22", memberId: w3.a.id, amount: 5000, type: "Loan Repayment", loanId: w3.l.id });
  assert.throws(() => run(w3.db, "Admin", "2026-10-22", "queueReminderSms", { id: w3.rec.id }), /STALE|changed|CANNOT/);
  const w4 = smsWorld(); ["Treasurer", "Secretary", "Committee"].forEach((r) => assert.throws(() => run(w4.db, r, "2026-10-22", "queueReminderSms", { id: w4.rec.id })));
  const before = JSON.stringify([w4.db.transactions, w4.db.loans]); N.dispatch(w4.db, ctx("Admin", "2026-10-22"), gw(true).g, { ids: [] }); assert.equal(JSON.stringify([w4.db.transactions, w4.db.loans]), before, "no financial record changes");
});
t("every reminder tells the member that unpaid loans after the deadline go to Church Administration", () => { const REM = require("../src/core/reminders.js"); ["FRIENDLY", "URGENT"].forEach((lv) => { const T = REM.DEFAULT_TEMPLATES ? REM.DEFAULT_TEMPLATES[lv] : null; if (T) assert.ok(/Church Administration/.test(T.request) && /Bishop/.test(T.request), lv); }); assert.ok(/Church Administration/.test(REM.DEFAULT_TEMPLATES.FINAL.request) && /Bishop has requested the list of members with outstanding loans after this date/.test(REM.DEFAULT_TEMPLATES.FINAL.request)); });
t("the deadline is a setting: notices keep the deadline they were issued with, and a changed deadline makes an old unsent notice stale", () => {
  const { db, l } = world(); setDates(db, "2026-10-22", "2026-12-19", "2026-11-24");
  const r1 = run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id, level: "FINAL" });
  assert.match(r1.body, /Payment Deadline: 24 November 2026/); assert.equal(r1.deadline, "2026-11-24");
  assert.match(r1.body, /your name and outstanding balance will be submitted to Church Administration/); assert.match(r1.body, /The Bishop has requested the list/);
  const sms = RM.composeSms(db, r1, r1.figures); assert.equal(sms, "SOB FINAL: Pay UGX 180,000 now. Bishop next."); assert.ok(sms.length <= 50);
  setDates(db, "2026-10-22", "2026-12-19", "2026-12-05");                                       // next cycle / a new decision: no code change
  assert.equal(r1.deadline, "2026-11-24"); assert.match(r1.body, /24 November 2026/, "the issued notice keeps its deadline");
  assert.throws(() => run(db, "Admin", "2026-10-22", "revalidateReminder", { id: r1.id }), /STALE_REMINDER.*deadline changed/);
  const r2 = run(db, "Admin", "2026-10-22", "prepareReminder", { loanId: l.id, level: "FINAL" }); assert.match(r2.body, /Payment Deadline: 5 December 2026/);
});
t("the deadline needs the Chairperson to approve it; no date is written into the program", () => { const { db } = world(); const r = run(db, "Admin", "2026-10-22", "setReminderDates", { shareOutDate: "2026-12-19", deadline: "2026-11-24", reason: "committee" }); assert.equal(r.pendingApproval, true); assert.equal(RM.getConfig(db).deadline, null); assert.ok(!/2026-11-24|24 November/.test(require("fs").readFileSync(require.resolve("../src/core/reminders.js"), "utf8")), "no hard-coded deadline in the code"); });
/* ---- automatic reminders ---- */
const autoWorld = () => { const w = world(); w.db.members[0].phone = "0772123456"; setDates(w.db, "2026-11-10", "2026-12-19", "2026-11-24"); return w; };
const setAuto = (db, day, a) => { const r = run(db, "Admin", day, "setAutoReminders", Object.assign({ reason: "committee decision (test)" }, a)); if (r.pendingApproval) run(db, "Chairperson", day, "approveRequest", { id: r.requestId }); };
const auto = (db, day, g) => RM.autoRun(db, ctx("Admin", day), g);
t("AUTO: nothing is sent while it is switched off, and switching it on needs the Chairperson", () => {
  const { db } = autoWorld(), { g, sent } = gw(true); assert.equal(auto(db, "2026-11-10", g).sent.length, 0); assert.equal(sent.length, 0);
  const r = run(db, "Admin", "2026-11-10", "setAutoReminders", { enabled: true, reason: "x" }); assert.equal(r.pendingApproval, true); assert.equal(RM.getAuto(db).enabled, false);
  run(db, "Chairperson", "2026-11-10", "approveRequest", { id: r.requestId }); assert.equal(RM.getAuto(db).enabled, true);
  assert.ok(db.auditLog.some((a) => a.entityType === "AutoReminders" && a.action === "Changed"));
});
t("AUTO: with the gateway not live nothing is sent and no record is created", () => { const { db } = autoWorld(), { g, sent } = gw(false); setAuto(db, "2026-11-10", { enabled: true }); const r = auto(db, "2026-11-10", g); assert.equal(sent.length, 0); assert.equal(db.reminders.length, 0); assert.match(r.note, /not live/); });
t("AUTO: regular reminder, then Church Administration after 3 days unpaid, then the Bishop before the deadline; every SMS is 50 characters or fewer; each goes once", () => {
  const { db } = autoWorld(), { g, sent } = gw(true); setAuto(db, "2026-11-10", { enabled: true });
  assert.equal(auto(db, "2026-11-10", g).sent[0].stage, "REGULAR"); assert.equal(auto(db, "2026-11-10", g).sent.length, 0, "same day: not sent twice");
  assert.equal(auto(db, "2026-11-12", g).sent.length, 0, "only 2 days after the first reminder");
  assert.equal(auto(db, "2026-11-13", g).sent[0].stage, "ADMIN"); assert.equal(auto(db, "2026-11-14", g).sent.length, 0, "the Church Administration notice goes once");
  assert.equal(auto(db, "2026-11-21", g).sent.length, 0, "3 days before the deadline: not yet the Bishop stage");
  assert.equal(auto(db, "2026-11-22", g).sent[0].stage, "BISHOP"); assert.equal(auto(db, "2026-11-23", g).sent.length, 0, "the Bishop notice goes once"); assert.equal(auto(db, "2026-11-25", g).sent.length, 0, "after the deadline officers follow up");
  assert.equal(sent.length, 3); sent.forEach((m) => assert.ok(m.body.length <= 50, m.body)); assert.match(sent[1].body, /Church Admin/); assert.match(sent[2].body, /Bishop/);
  const recs = db.reminders.filter((r) => r.auto); assert.deepEqual(recs.map((r) => r.stage), ["REGULAR", "ADMIN", "BISHOP"]); assert.ok(recs.every((r) => r.deadline === "2026-11-24" && r.delivery === "SMS_ACCEPTED" && /Church Administration/.test(r.body)));
  assert.ok(db.auditLog.filter((a) => a.entityType === "AutoReminderRun").length >= 3 && db.auditLog.some((a) => a.entityType === "Reminder" && a.action === "Prepared"));
});
t("AUTO: someone who has paid since the first reminder skips the Church Administration notice; a loan paid in full is not messaged again", () => {
  const { db, l } = autoWorld(), { g, sent } = gw(true); setAuto(db, "2026-11-10", { enabled: true }); auto(db, "2026-11-10", g);
  run(db, "Admin", "2026-11-12", "repayLoan", { loanId: l.id, amount: 10000, date: "2026-11-12" }); assert.equal(auto(db, "2026-11-13", g).sent.length, 0, "no Church Administration notice for someone who has been paying");
  assert.equal(auto(db, "2026-11-17", g).sent[0].stage, "REGULAR", "still gets the regular reminder");
  run(db, "Admin", "2026-11-18", "repayLoan", { loanId: l.id, amount: L.loanOutstanding(db.loans[0], db, "2026-11-18"), date: "2026-11-18" }); const n = sent.length; assert.equal(auto(db, "2026-11-22", g).sent.length, 0); assert.equal(sent.length, n);
});
t("AUTO: opted-out members are skipped; a failed send is cancelled and tried again next run; nothing in the ledger changes", () => {
  const { db } = autoWorld(), bad = gw(true, { ok: false, error: "HTTP 500" }), good = gw(true); setAuto(db, "2026-11-10", { enabled: true }); const before = JSON.stringify([db.transactions, db.loans]);
  const r1 = auto(db, "2026-11-10", bad.g); assert.equal(r1.failed.length, 1); assert.ok(db.reminders[0].delivery === "CANCELLED"); assert.equal(auto(db, "2026-11-11", good.g).sent.length, 1, "retried and sent");
  assert.equal(JSON.stringify([db.transactions, db.loans]), before); db.members[0].notifyOptOut = true; assert.equal(auto(db, "2026-11-20", good.g).sent.length, 0);
});
t("AUTO: the schedule can be changed without code, and bad values are refused", () => { const { db } = autoWorld(); setAuto(db, "2026-11-10", { enabled: true, regularEveryDays: 3, adminAfterDays: 2, bishopDaysBefore: 4 }); assert.deepEqual([RM.getAuto(db).regularEveryDays, RM.getAuto(db).adminAfterDays, RM.getAuto(db).bishopDaysBefore], [3, 2, 4]); assert.throws(() => run(db, "Admin", "2026-11-10", "setAutoReminders", { adminAfterDays: 0, reason: "x" }), /INVALID/); });
console.log(n + " reminder tests passed");
