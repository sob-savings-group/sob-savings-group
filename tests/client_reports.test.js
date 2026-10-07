const assert = require("assert"), fs = require("fs");
const C = require("../src/client/store.js"), R = require("../src/core/reports.js"), M = require("../src/core/migrate.js"), L = require("../src/core/ledger.js");
const raw = require("./helpers/synth.js").legacyRaw();
const AS_OF = "2026-03-31"; const db0 = M.migrateLegacy(raw, AS_OF);
const tests = []; const t = (n, f) => tests.push([n, f]);
const memStorage = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, removeItem: (k) => { delete m[k]; }, m }; };
function fakeServer() { const s = { calls: [], auth: false, fail: null };
  s.fetch = async (url, o) => { const b = JSON.parse(o.body); s.calls.push(b); const J = (x) => ({ json: async () => x });
    if (b.action === "login") return b.pin === "good" ? J({ ok: true, token: "TOK", user: { id: "A", role: "Admin" } }) : J({ ok: false, error: "BAD_CREDENTIALS" });
    if (b.token !== "TOK") return J({ ok: false, error: "UNAUTHENTICATED" });
    if (b.action === "whoami") return J({ ok: true, user: { id: "A", role: "Admin" } });
    if (b.action === "getLedger") return J({ ok: true, db: { members: [] } });
    if (b.action === "command") return b.name === "bad" ? J({ ok: false, error: "FORBIDDEN: no" }) : J({ ok: true, result: { id: "R1" }, db: { members: [1] } });
    return J({ ok: true }); };
  return s; }
t("login stores the token in the SESSION storage only (never localStorage-style persistence of the ledger)", async () => {
  const sv = fakeServer(), ss = memStorage(), c = C.create({ url: "u", fetch: sv.fetch, session: ss });
  await assert.rejects(() => c.login("A", "bad"), (e) => e.code === "BAD_CREDENTIALS"); assert.equal(c.signedIn, false);
  await c.login("A", "good"); assert.equal(ss.m["sob.session"], "TOK"); await c.load(); assert.deepEqual(Object.keys(ss.m), ["sob.session"], "ledger is not cached");
});
t("commands carry only name/args plus the token; server result replaces the local view", async () => {
  const sv = fakeServer(), c = C.create({ url: "u", fetch: sv.fetch, session: memStorage() }); await c.login("A", "good");
  const r = await c.command("createEntry", { amount: 1 }); assert.deepEqual(r, { id: "R1" }); assert.deepEqual(c.db.members, [1]);
  const sent = sv.calls[sv.calls.length - 1]; assert.deepEqual(Object.keys(sent).sort(), ["action", "args", "name", "token"], "no role/identity fields are sent");
});
t("a refused command surfaces the server's error and leaves the local ledger unchanged", async () => {
  const sv = fakeServer(), c = C.create({ url: "u", fetch: sv.fetch, session: memStorage() }); await c.login("A", "good"); await c.load();
  await assert.rejects(() => c.command("bad", {}), (e) => e.code === "FORBIDDEN"); assert.deepEqual(c.db, { members: [] });
});
t("expired/invalid session signs the client out and clears the stored token", async () => {
  const sv = fakeServer(), ss = memStorage(), c = C.create({ url: "u", fetch: sv.fetch, session: ss }); await c.login("A", "good");
  ss.m["sob.session"] = "TOK"; const c2 = C.create({ url: "u", fetch: async (u, o) => ({ json: async () => ({ ok: false, error: "UNAUTHENTICATED" }) }), session: ss });
  assert.equal(await c2.resume(), null); assert.equal(ss.m["sob.session"], undefined);
  await c.logout(); assert.equal(c.signedIn, false); assert.equal(ss.m["sob.session"], undefined);
});
t("sign-in contract: a response without a user falls back to whoami; a response without a session is a clear error, never a crash", async () => {
  const mk = (loginRes, whoRes) => C.create({ url: "u", session: memStorage(), fetch: async (u, o) => { const b = JSON.parse(o.body); return { json: async () => (b.action === "login" ? loginRes : whoRes) }; } });
  const u = { id: "ADMIN", name: "ADMIN", role: "Admin", mustChangePin: false };
  assert.deepEqual(await mk({ ok: true, token: "t", user: u }, {}).login("ADMIN", "x"), u);
  assert.equal((await mk({ ok: true, token: "t" }, { ok: true, user: u }).login("ADMIN", "x")).role, "Admin");
  const noFlag = await mk({ ok: true, token: "t", user: { id: "A", role: "Admin" } }, {}).login("A", "x"); assert.strictEqual(noFlag.mustChangePin, false);
  await assert.rejects(() => mk({ ok: true }, {}).login("A", "x"), /SIGNIN_CONTRACT/);
  await assert.rejects(() => mk({ ok: true, token: "t" }, { ok: true }).login("A", "x"), /SIGNIN_CONTRACT/);
});
t("reports: savings and loan book reconcile with the engine", () => {
  const s = R.savings(db0); assert.equal(s.totals.total, L.computeGroupTotals(db0, AS_OF).groupSavings);
  const lb = R.loans(db0, AS_OF); assert.equal(lb.rows.length, db0.loans.length);
  assert.equal(lb.totals.balance, db0.loans.reduce((a, l) => a + Math.max(0, L.loanOutstanding(l, db0, AS_OF)), 0));
});
t("reports: member statement closing balance equals member savings", () => {
  const id = db0.members.find((m) => L.memberSavings(db0, m.id) > 0).id;
  assert.equal(R.memberStatement(db0, id).totals.closingBalance, L.memberSavings(db0, id));
});
t("reports: blocked distribution, share-out preview, subscriptions, annual summary, guarantors", () => {
  assert.equal(R.quarterlyDistribution(db0, { year: 2026, quarter: 1 }).blocked, true);
  assert.throws(() => R.toCSV(R.quarterlyDistribution(db0, {})), /BLOCKED/);
  assert.equal(R.repaymentAllocation(db0).blocked, undefined); assert.equal(R.repaymentAllocation(db0).totals.rule, "INTEREST_FIRST");
  assert.equal(R.shareOut(db0, 2026, "2026-12-10").rows.length, db0.members.length);
  assert.equal(R.subscriptions(db0, 2026).totals.expected, db0.members.length * 5000);
  assert.ok(R.annualSummary(db0, 2026).rows.length === 7); assert.equal(R.guarantors(db0).rows.length, 0);
  R.incomeExpenses(db0, { year: 2026 }); R.repayments(db0, { year: 2026 });
});
t("reports: airtime, notification log and reconciliation register totals match their records", () => {
  const G = require("../src/core/governance.js"), AT = require("../src/core/airtime.js"), CMD = require("../src/core/commands.js");
  const db = JSON.parse(JSON.stringify(db0)), mem = db.members.find((m) => L.memberSavings(db, m.id) >= 10000 && !L.memberHasOutstandingLoan(db, m.id, AS_OF));
  const admin = G.makeCtx({ id: "A", name: "Admin", role: "Admin" }, { today: "2026-04-02", now: "2026-04-02T08:00:00.000Z" });
  const r1 = CMD.run(db, admin, "requestAirtime", { memberId: mem.id, amount: 3000, phone: "0772123456" }); CMD.run(db, admin, "requestAirtime", { memberId: mem.id, amount: 2000, phone: "0772123456" }); CMD.run(db, admin, "fulfilAirtime", { id: r1.id });
  const a = R.airtime(db); assert.deepEqual([a.rows.length, a.totals.fulfilledAirtime, a.totals.fulfilledFees, a.totals.fulfilledTotal, a.totals.pending], [2, 3000, 200, 3200, 1]);
  const n = R.notificationLog(db); assert.equal(n.rows.length, (db.outbox || []).length); assert.equal(n.totals.sent, 0);
  const rr = R.reconciliationRegister(db); assert.equal(rr.rows.length, (db.discrepancies || []).length);
});
t("CSV escapes quotes/commas and neutralises spreadsheet formulas; HTML escapes markup", () => {
  const rep = { title: "<x>", columns: ["a", "b"], rows: [{ a: 'he said "hi", ok', b: "=HYPERLINK(1)" }], totals: { t: 1 } };
  const csv = R.toCSV(rep).split("\n")[1]; assert.equal(csv, '"he said ""hi"", ok",\'=HYPERLINK(1)');
  const html = R.toPrintHTML(rep, {}); assert.ok(!html.includes("<x>")); assert.ok(html.includes("&lt;x&gt;"));
});
(async () => { let f = 0; for (const [n, fn] of tests) { try { await fn(); console.log("  ok  " + n); } catch (e) { f++; console.log("FAIL  " + n + "\n      " + e.message); } } console.log(f ? f + " FAILED" : tests.length + " passed"); if (f) process.exitCode = 1; })();
