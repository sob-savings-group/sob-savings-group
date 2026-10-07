const assert = require("assert");
const dates = require("../src/core/dates.js"), L = require("../src/core/ledger.js"), G = require("../src/core/governance.js"), LN = require("../src/core/loans.js");
const N = require("../src/core/notify.js"), AT = require("../src/core/airtime.js"), CMD = require("../src/core/commands.js");
let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { console.log("FAIL  " + name + "\n      " + e.message); process.exitCode = 1; } };
const throwsMsg = (fn, re) => assert.throws(fn, (e) => re.test(e.message), "expected /" + re + "/");
const admin = { name: "Admin", id: "U1", role: "Admin" }, committee = { name: "Cathy", id: "U2", role: "Committee" };
const ctxAt = (day, user, over) => G.makeCtx(user || admin, Object.assign({ today: day, now: day + "T09:00:00.000Z" }, over || {}));
const mctx = (id, day) => ctxAt(day || "2026-03-10", { name: id, id, role: "Member", memberId: id });
const fresh = () => ({ members: [["SOB-001", "0772123456"], ["SOB-002", "256701234567"], ["SOB-003", ""]].map(([id, phone]) => ({ id, name: "Member " + id.slice(-1), phone, status: "Active", regDate: "2025-01-01" })), transactions: [], loans: [], guarantees: [], auditLog: [] });
const seed = (db, id, amt) => G.createEntry(db, ctxAt("2026-01-05"), { date: "2026-01-05", memberId: id, amount: amt, type: "Savings" });
const live = (ok, log) => ({ live: true, send: (m) => { (log || []).push(m); return ok ? { ok: true, providerRef: "P1" } : { ok: false, error: "HTTP 500" }; } });

console.log("notifications");
t("phone numbers normalise to +256, junk is rejected not guessed", () => {
  assert.equal(N.normalizePhone("0772 123-456"), "+256772123456");
  assert.equal(N.normalizePhone("256701234567"), "+256701234567");
  assert.equal(N.normalizePhone("+256701234567"), "+256701234567");
  ["", null, "12345", "0772", "+1 202 555 0100", "077212345678"].forEach((p) => assert.equal(N.normalizePhone(p), null));
});
t("a ledger entry queues a receipt in the outbox, once, and it is not sent anywhere", () => {
  const db = fresh(); const c = ctxAt("2026-01-05");
  CMD.run(db, c, "createEntry", { date: "2026-01-05", memberId: "SOB-001", amount: 50000, type: "Savings" });
  assert.equal(db.outbox.length, 1); const m = db.outbox[0];
  assert.equal(m.status, "QUEUED"); assert.equal(m.to, "+256772123456"); assert.match(m.body, /UGX 50,000/); assert.match(m.body, /05\/01\/2026/);
});
t("member without a phone or who opted out is SKIPPED with a visible reason; commands still succeed", () => {
  const db = fresh(); const c = ctxAt("2026-01-05");
  CMD.run(db, c, "createEntry", { date: "2026-01-05", memberId: "SOB-003", amount: 1000, type: "Savings" });
  assert.deepEqual([db.outbox[0].status, db.outbox[0].reason], ["SKIPPED", "NO_VALID_PHONE"]);
  CMD.run(db, c, "setNotifyOptOut", { memberId: "SOB-001", optOut: true, reason: "asked" });
  CMD.run(db, c, "createEntry", { date: "2026-01-05", memberId: "SOB-001", amount: 1000, type: "Savings" });
  assert.deepEqual([db.outbox[1].status, db.outbox[1].reason], ["SKIPPED", "OPTED_OUT"]);
});
t("dispatch with NO live gateway only renders: DRY_RUN, never SENT", () => {
  const db = fresh(); const c = ctxAt("2026-01-05"); seed(db, "SOB-001", 1000); CMD.run(db, c, "createEntry", { date: "2026-01-05", memberId: "SOB-001", amount: 5, type: "Savings" });
  const r = N.dispatch(db, c, { SMS: null }, {}); assert.equal(r.sent, 0); assert.equal(r.dryRun, 1);
  assert.equal(db.outbox[0].status, "DRY_RUN"); assert.equal(N.summary(db).SENT, 0);
  const r2 = N.dispatch(db, c, { SMS: { live: false, send() { throw new Error("must not be called"); } } }, {}); assert.equal(r2.sent, 0);
});
t("a live adapter marks SENT only on confirmed success; DRY_RUN messages go out once live", () => {
  const db = fresh(); const c = ctxAt("2026-01-05"); CMD.run(db, c, "createEntry", { date: "2026-01-05", memberId: "SOB-001", amount: 5, type: "Savings" });
  N.dispatch(db, c, {}, {}); assert.equal(db.outbox[0].status, "DRY_RUN");
  const log = []; const r = N.dispatch(db, c, { SMS: live(true, log) }, {});
  assert.equal(r.sent, 1); assert.equal(db.outbox[0].status, "SENT"); assert.equal(log[0].to, "+256772123456"); assert.equal(db.outbox[0].providerRef, "P1");
  assert.equal(N.dispatch(db, c, { SMS: live(true, log) }, {}).sent, 0, "SENT is never resent");
});
t("failures and thrown errors are logged to smsFailures, retried up to the limit, never marked SENT", () => {
  const db = fresh(); const c = ctxAt("2026-01-05"); CMD.run(db, c, "createEntry", { date: "2026-01-05", memberId: "SOB-001", amount: 5, type: "Savings" });
  for (let i = 0; i < 5; i++) N.dispatch(db, c, { SMS: live(false) }, {});
  assert.equal(db.outbox[0].status, "FAILED"); assert.equal(db.outbox[0].attempts, N.MAX_ATTEMPTS); assert.equal(db.smsFailures.length, N.MAX_ATTEMPTS);
  const db2 = fresh(); CMD.run(db2, c, "createEntry", { date: "2026-01-05", memberId: "SOB-001", amount: 5, type: "Savings" });
  N.dispatch(db2, c, { SMS: { live: true, send() { throw new Error("boom"); } } }, {}); assert.equal(db2.outbox[0].status, "FAILED"); assert.match(db2.outbox[0].reason, /boom/);
});
t("only Admin may dispatch/cancel/send; Members and Committee are refused", () => {
  const db = fresh();
  [ctxAt("2026-01-05", committee), mctx("SOB-001")].forEach((c) => {
    throwsMsg(() => N.dispatch(db, c, {}, {}), /FORBIDDEN/); throwsMsg(() => CMD.run(db, c, "sendMessage", { memberId: "SOB-001", text: "x" }), /FORBIDDEN/);
    throwsMsg(() => CMD.run(db, c, "cancelMessage", { id: "x", reason: "r" }), /FORBIDDEN/);
  });
});
t("a Member may change only their own consent; cancel needs a reason and refuses SENT", () => {
  const db = fresh(); const a = ctxAt("2026-01-05");
  CMD.run(db, mctx("SOB-001"), "setNotifyOptOut", { memberId: "SOB-001", optOut: true });
  throwsMsg(() => CMD.run(db, mctx("SOB-001"), "setNotifyOptOut", { memberId: "SOB-002", optOut: true }), /FORBIDDEN/);
  CMD.run(db, a, "setNotifyOptOut", { memberId: "SOB-001", optOut: false });
  const m = CMD.run(db, a, "sendMessage", { memberId: "SOB-001", text: "Meeting Saturday" });
  throwsMsg(() => CMD.run(db, a, "cancelMessage", { id: m.id }), /REQUIRED/);
  N.dispatch(db, a, { SMS: live(true) }, {}); throwsMsg(() => CMD.run(db, a, "cancelMessage", { id: m.id, reason: "x" }), /ALREADY_SENT/);
});
t("loan decisions and share-out queue notices (deduped); template text is bounded", () => {
  const db = fresh(); const a = ctxAt("2026-12-21"); seed(db, "SOB-001", 100000); seed(db, "SOB-002", 50000);
  const l = LN.recordExistingLoan(db, a, { memberId: "SOB-002", amount: 10000, date: "2026-02-01", assignedMonthlyInterest: 100, graceMonths: 3 });
  const rq = CMD.run(db, a, "executeShareOut", { year: 2026, date: "2026-12-21" }); assert.equal(rq.pendingApproval, true); CMD.run(db, ctxAt("2026-12-21", { name: "Chair", id: "U9", role: "Chairperson" }), "approveRequest", { id: rq.requestId });
  assert.equal(db.outbox.filter((m) => m.template === "shareOut").length, 2);
  assert.equal(N.render("custom", { text: "x".repeat(900) }).length, 320);
  throwsMsg(() => N.render("nope", {}), /UNKNOWN_TEMPLATE/);
});

console.log("airtime");
const withSavings = () => { const db = fresh(); seed(db, "SOB-001", 100000); seed(db, "SOB-002", 1000); return db; };
t("request shows cap and fee, creates Pending request, no money moves yet, admin alert + member ack queued", () => {
  const db = withSavings(); const before = L.memberSavings(db, "SOB-001");
  const r = CMD.run(db, mctx("SOB-001"), "requestAirtime", { amount: 5000 });
  assert.deepEqual([r.status, r.airtimeAmount, r.fee, r.total, r.phone], ["Pending", 5000, 200, 5200, "+256772123456"]);
  assert.equal(L.memberSavings(db, "SOB-001"), before);
  assert.ok(db.outbox.some((m) => m.to === "ADMIN" && m.template === "airtimeAdminAlert")); assert.ok(db.outbox.some((m) => m.memberId === "SOB-001" && m.template === "airtimeRequested"));
});
t("a Member can only request for themselves, even if they send someone else's id", () => {
  const db = withSavings();
  const r = CMD.run(db, mctx("SOB-001"), "requestAirtime", { memberId: "SOB-002", amount: 1000 });
  assert.equal(r.memberId, "SOB-001");
  throwsMsg(() => CMD.run(db, ctxAt("2026-03-10", committee), "requestAirtime", { memberId: "SOB-001", amount: 1000 }), /FORBIDDEN/);
});
t("monthly cap UGX 20,000 counts Pending+Fulfilled, not Rejected/Cancelled, and resets next month", () => {
  const db = withSavings(); const m = mctx("SOB-001");
  const a = CMD.run(db, m, "requestAirtime", { amount: 12000 });
  throwsMsg(() => CMD.run(db, m, "requestAirtime", { amount: 8001 }), /OVER_MONTHLY_CAP/);
  CMD.run(db, m, "requestAirtime", { amount: 8000 });
  throwsMsg(() => CMD.run(db, m, "requestAirtime", { amount: 1 }), /OVER_MONTHLY_CAP/);
  CMD.run(db, ctxAt("2026-03-10"), "rejectAirtime", { id: a.id, reason: "not an emergency" });
  CMD.run(db, m, "requestAirtime", { amount: 12000 });
  CMD.run(db, mctx("SOB-001", "2026-04-02"), "requestAirtime", { amount: 20000 });
});
t("amount must be a positive whole number; phone must be valid", () => {
  const db = withSavings(); const m = mctx("SOB-001");
  [0, -5, 10.5, "abc", null].forEach((x) => throwsMsg(() => CMD.run(db, m, "requestAirtime", { amount: x }), /INVALID/));
  throwsMsg(() => CMD.run(db, m, "requestAirtime", { amount: 1000, phone: "123" }), /INVALID/);
  CMD.run(db, m, "requestAirtime", { amount: 1000, phone: "0701000000" });
});
t("blocked while any loan is unpaid (legacy rule), allowed again once cleared", () => {
  const db = withSavings(); LN.recordExistingLoan(db, ctxAt("2026-03-10"), { memberId: "SOB-001", amount: 1000, date: "2026-03-01", assignedMonthlyInterest: 0, graceMonths: 3 });
  throwsMsg(() => CMD.run(db, mctx("SOB-001"), "requestAirtime", { amount: 1000 }), /BLOCKED_BY_LOAN/);
  const loan = db.loans[0]; CMD.run(db, ctxAt("2026-03-10"), "repayLoan", { loanId: loan.id, amount: 1000, date: "2026-03-10" });
  CMD.run(db, mctx("SOB-001"), "requestAirtime", { amount: 1000 });
});
t("airtime + fee must fit AVAILABLE savings: pending requests and live guarantees reserve savings", () => {
  const db = fresh(); seed(db, "SOB-001", 10000); const m = mctx("SOB-001");
  CMD.run(db, m, "requestAirtime", { amount: 9000 });        // 9,200 reserved of 10,000
  throwsMsg(() => CMD.run(db, m, "requestAirtime", { amount: 1000 }), /INSUFFICIENT_SAVINGS/);
  const db2 = fresh(); seed(db2, "SOB-001", 10000); seed(db2, "SOB-002", 100);
  const loan = LN.applyForLoan(db2, mctx("SOB-002"), "SOB-002", 8000);
  const g = LN.addGuarantee(db2, ctxAt("2026-03-10"), loan.id, "SOB-001", 8000); LN.acceptGuarantee(db2, mctx("SOB-001"), g.id);   // accepted: 8,000 of SOB-001's savings now committed
  throwsMsg(() => CMD.run(db2, m, "requestAirtime", { amount: 2000 }), /INSUFFICIENT_SAVINGS/);
  CMD.run(db2, m, "requestAirtime", { amount: 1800 });
});
t("Admin fulfils: one audited Withdraw entry of airtime+fee debits savings; cannot fulfil twice; Member cannot fulfil", () => {
  const db = withSavings(); const before = L.memberSavings(db, "SOB-001");
  const r = CMD.run(db, mctx("SOB-001"), "requestAirtime", { amount: 5000 });
  throwsMsg(() => CMD.run(db, mctx("SOB-001"), "fulfilAirtime", { id: r.id }), /FORBIDDEN/);
  CMD.run(db, ctxAt("2026-03-11"), "fulfilAirtime", { id: r.id });
  assert.equal(L.memberSavings(db, "SOB-001"), before - 5200);
  const e = db.transactions.find((x) => x.airtimeRequestId === r.id); assert.deepEqual([e.type, e.amount], ["Withdraw", 5200]);
  assert.equal(db.airtimeRequests[0].status, "Fulfilled"); assert.ok(db.auditLog.some((a) => a.entityType === "Airtime" && a.action === "Fulfilled"));
  throwsMsg(() => CMD.run(db, ctxAt("2026-03-11"), "fulfilAirtime", { id: r.id }), /NOT_PENDING/);
});
t("fulfil is re-checked at fulfilment time (savings withdrawn meanwhile / loan taken meanwhile)", () => {
  const db = withSavings(); const r = CMD.run(db, mctx("SOB-001"), "requestAirtime", { amount: 5000 });
  G.createEntry(db, ctxAt("2026-03-10"), { date: "2026-03-10", memberId: "SOB-001", amount: 99000, type: "Withdraw" });
  throwsMsg(() => CMD.run(db, ctxAt("2026-03-11"), "fulfilAirtime", { id: r.id }), /INSUFFICIENT_SAVINGS/);
});
t("reject needs a reason; Member may cancel only their own Pending request", () => {
  const db = withSavings(); const r = CMD.run(db, mctx("SOB-001"), "requestAirtime", { amount: 1000 });
  throwsMsg(() => CMD.run(db, ctxAt("2026-03-10"), "rejectAirtime", { id: r.id }), /REQUIRED/);
  throwsMsg(() => CMD.run(db, mctx("SOB-002"), "cancelAirtime", { id: r.id }), /FORBIDDEN/);
  CMD.run(db, mctx("SOB-001"), "cancelAirtime", { id: r.id }); assert.equal(db.airtimeRequests[0].status, "Cancelled");
  throwsMsg(() => CMD.run(db, mctx("SOB-001"), "cancelAirtime", { id: r.id }), /NOT_PENDING/);
});
console.log(pass + " passed"); if (process.exitCode) process.exit(1);
