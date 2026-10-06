const assert = require("assert"), fs = require("fs");
const C = require("../src/client/store.js"), R = require("../src/core/reports.js"), M = require("../src/core/migrate.js"), L = require("../src/core/ledger.js");
const raw = JSON.parse(fs.readFileSync(process.env.SEED || "/mnt/user-data/outputs/SOB_FINAL_DATA_V2.json", "utf8"));
const AS_OF = "2026-03-31"; const db0 = M.migrateLegacy(raw, AS_OF);
const tests = []; const t = (n, f) => tests.push([n, f]);
const memStorage = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, m }; };
function fakeServer() { const s = { db: JSON.parse(JSON.stringify(db0)), rev: 3, down: false, calls: [] };
  s.fetch = async (url, o) => { const b = JSON.parse(o.body); s.calls.push(b.action); if (s.down) throw new Error("network");
    if (b.action === "getLedger") return { json: async () => ({ ok: true, db: Object.assign({}, s.db, { revision: s.rev }) }) };
    if (b.baseRevision !== s.rev) return { json: async () => ({ ok: false, error: "CONFLICT" }) };
    s.db = b.db; s.rev++; return { json: async () => ({ ok: true, revision: s.rev }) }; };
  return s; }
t("load: server copy replaces cache; cache written", async () => {
  const sv = fakeServer(), st = memStorage(), c = C.create({ url: "u", key: "k", fetch: sv.fetch, storage: st });
  const r = await c.load(); assert.equal(r.source, "server"); assert.equal(c.revision, 3); assert.ok(st.m["sob.ledger.v2"]);
});
t("load: offline with cache falls back to cache; offline without cache errors", async () => {
  const sv = fakeServer(), st = memStorage(); await C.create({ url: "u", fetch: sv.fetch, storage: st }).load(); sv.down = true;
  const c = C.create({ url: "u", fetch: sv.fetch, storage: st }); assert.equal((await c.load()).source, "cache"); assert.equal(c.status, "offline-cache");
  await assert.rejects(() => C.create({ url: "u", fetch: sv.fetch, storage: memStorage() }).load());
});
t("mutate: saves with baseRevision and advances revision", async () => {
  const sv = fakeServer(), c = C.create({ url: "u", fetch: sv.fetch, storage: memStorage() }); await c.load();
  await c.mutate((db) => { db.members[0].name = "Changed"; }); assert.equal(sv.db.members[0].name, "Changed"); assert.equal(c.revision, 4);
});
t("mutate: CONFLICT rolls the in-memory change back and surfaces the error", async () => {
  const sv = fakeServer(), c = C.create({ url: "u", fetch: sv.fetch, storage: memStorage() }); await c.load(); sv.rev = 9;
  const orig = c.db.members[0].name;
  await assert.rejects(() => c.mutate((db) => { db.members[0].name = "X"; }), (e) => e.code === "CONFLICT");
  assert.equal(c.db.members[0].name, orig); assert.equal(c.status, "conflict");
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
  assert.equal(R.shareOut(db0, 2026, "2026-12-10").rows.length, db0.members.length);
  assert.equal(R.subscriptions(db0, 2026).totals.expected, db0.members.length * 5000);
  assert.ok(R.annualSummary(db0, 2026).rows.length === 7); assert.equal(R.guarantors(db0).rows.length, 0);
  R.incomeExpenses(db0, { year: 2026 }); R.repayments(db0, { year: 2026 });
});
t("CSV escapes quotes/commas and neutralises spreadsheet formulas; HTML escapes markup", () => {
  const rep = { title: "<x>", columns: ["a", "b"], rows: [{ a: 'he said "hi", ok', b: "=HYPERLINK(1)" }], totals: { t: 1 } };
  const csv = R.toCSV(rep).split("\n")[1]; assert.equal(csv, '"he said ""hi"", ok",\'=HYPERLINK(1)');
  const html = R.toPrintHTML(rep, {}); assert.ok(!html.includes("<x>")); assert.ok(html.includes("&lt;x&gt;"));
});
(async () => { let f = 0; for (const [n, fn] of tests) { try { await fn(); console.log("  ok  " + n); } catch (e) { f++; console.log("FAIL  " + n + "\n      " + e.message); } } console.log(f ? f + " FAILED" : tests.length + " passed"); if (f) process.exitCode = 1; })();
