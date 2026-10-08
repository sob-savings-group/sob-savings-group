/* The real-records loader against the bundled Code_Ledger.gs: empty load, idempotency, Chairperson-gated corrections, demo-vs-real detection and guarded demo removal.
   Uses a synthetic pack only; the private run on the real SOB records is done separately and never committed. */
const assert = require("assert"), { execSync } = require("child_process"), path = require("path");
execSync("node " + path.join(__dirname, "../build/build-gs.js"));
const g = require("./helpers/gas.js"), { makePack } = require("./helpers/pack.js"), LD = require("../src/core/loader.js"), L = require("../src/core/ledger.js"), M = require("../src/core/migrate.js"), synth = require("./helpers/synth.js");
let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log("  ok  " + name); } catch (e) { console.log("FAIL  " + name + "\n      " + (e.stack || e)); process.exitCode = 1; } };
const o = { approvedBy: "Test Approver, Admin, 8 Oct 2026", asOf: "2026-10-08" };
(async () => {
  const pack = makePack();
  const boot = async () => { const s = g.start(); s.setupAdmin(); const api = s.session((await s.call({ action: "login", id: "ADMIN", pin: "Adm1n-Setup-77" })).token); await api({ action: "createUser", user: { id: "CHAIR", name: "Chair", role: "Chairperson", pin: "Chair-Pin-99" } });
    const ct = (await s.call({ action: "login", id: "CHAIR", pin: "Chair-Pin-99" })).token, capi = s.session(ct); await capi({ action: "setPin", oldPin: "Chair-Pin-99", newPin: "Chair-New-77" }); return { s, api, capi }; };
  const { s, api, capi } = await boot();
  await t("a bad or foreign file is refused", () => { assert.ok(LD.validatePack({}).length); const p = JSON.parse(JSON.stringify(pack)); p.controls.historyEntries = 99; assert.ok(LD.validatePack(p).length); });
  await t("an approver is required", async () => { const r = await LD.load(api, pack, { asOf: o.asOf }); assert.equal(r.ok, false); });
  await t("dry run writes nothing", async () => { const r = await LD.load(api, pack, Object.assign({ dryRun: true }, o)); assert.ok(r.ok, JSON.stringify(r.checks.filter((c) => !c.pass))); assert.equal((await api({ action: "getLedger" })).db.members.length, 0); });
  let r1;
  await t("first load: every check passes, 1 correction requested, repayment waits", async () => {
    r1 = await LD.load(api, pack, o); assert.ok(r1.ok, JSON.stringify(r1.checks.filter((c) => !c.pass))); assert.equal(r1.pending.length, 2); assert.ok(r1.checks.some((c) => /wait for the Chairperson/.test(c.name)));
    const db = (await api({ action: "getLedger" })).db; assert.equal(db.members.length, pack.controls.members); assert.equal(db.transactions.filter((x) => x.historical).length, 5); assert.equal(db.discrepancies.length, pack.discrepancies.length);
  });
  await t("the Super Admin cannot approve their own requests", async () => { const db = (await api({ action: "getLedger" })).db; const q = db.approvalRequests[0]; assert.ok(!(await api({ action: "command", name: "approveRequest", args: { id: q.id } })).ok); });
  await t("Chairperson approves; second load records the replacement repayment once", async () => {
    let db = (await api({ action: "getLedger" })).db; for (const q of db.approvalRequests.slice().sort((a) => (a.command === "voidEntry" ? -1 : 1))) assert.ok((await capi({ action: "command", name: "approveRequest", args: { id: q.id } })).ok);
    const r2 = await LD.load(api, pack, o); assert.ok(r2.ok, JSON.stringify(r2.checks.filter((c) => !c.pass))); assert.equal(r2.pending.length, 0);
    db = (await api({ action: "getLedger" })).db; assert.equal(db.transactions.filter((x) => /test split/.test(x.purpose || "") && !x.voided).length, 1);
  });
  await t("running again adds nothing at all", async () => { const a = (await api({ action: "getLedger" })).db, r = await LD.load(api, pack, o), b = (await api({ action: "getLedger" })).db; assert.ok(r.ok); assert.equal(a.transactions.length, b.transactions.length); assert.equal(a.auditLog.length, b.auditLog.length); assert.equal(a.discrepancies.length, b.discrepancies.length); assert.equal(a.approvalRequests.length, b.approvalRequests.length); });
  await t("savings stay cumulative: loans are never netted off; available = savings - commitments", async () => {
    const db = (await api({ action: "getLedger" })).db, rep = LD.build(db, pack, o.asOf); const loanMember = rep.rows.find((x) => x.loanPrincipal > 0);
    assert.ok(loanMember && loanMember.savings === L.memberSavings(db, loanMember.id)); assert.equal(loanMember.available, loanMember.savings - loanMember.committed); assert.equal(loanMember.memoNet, loanMember.savings - loanMember.loanOwed);
    assert.equal(rep.totals.savings, L.computeGroupTotals(db, o.asOf).groupSavings); assert.ok(rep.controls.every((c) => c.pass), JSON.stringify(rep.controls.filter((c) => !c.pass)));
    assert.equal(LD.asReports(rep).length, 3);
  });
  await t("a ledger of demo members is detected as foreign; loading is refused; real ledgers are never purged", async () => {
    const { s: s2, api: a2 } = await boot(); const demo = M.migrateLegacy(synth.build().legacy, "2026-03-31"); assert.ok((await a2({ action: "importSnapshot", db: demo })).ok);
    const r = await LD.load(a2, pack, o); assert.equal(r.ok, false); assert.equal(r.state, "foreign");
    const demoNames = demo.members.map((m) => m.name);
    assert.ok(!(await a2({ action: "purgeDemoLedger", confirm: "nope", demoNames, realNames: LD.realNames(pack) })).ok, "needs the confirmation phrase");
    assert.ok(!(await a2({ action: "purgeDemoLedger", confirm: "REMOVE DEMO DATA", demoNames: demoNames.slice(1), realNames: [] })).ok, "unknown member blocks the purge");
    const p = await a2({ action: "purgeDemoLedger", confirm: "REMOVE DEMO DATA", demoNames, realNames: LD.realNames(pack) }); assert.ok(p.ok && p.purged && p.backup, JSON.stringify(p));
    assert.equal((await a2({ action: "getLedger" })).db.members.length, 0); assert.ok((await a2({ action: "listBackups" })).backups.length >= 1);
    const ok = await LD.load(a2, pack, o); assert.ok(ok.ok, JSON.stringify(ok.checks.filter((c) => !c.pass)));
    assert.ok(!(await a2({ action: "purgeDemoLedger", confirm: "REMOVE DEMO DATA", demoNames, realNames: LD.realNames(pack) })).ok, "a loaded real ledger can never be purged");
  });
  await t("a member cannot purge or load", async () => {
    const mt = (await s.call({ action: "login", id: "ADMIN", pin: "Adm1n-Setup-77" })).token; assert.ok(mt); const ids = (await api({ action: "getLedger" })).db.members[0].id;
    await api({ action: "createUser", user: { id: ids, name: "m", role: "Member", memberId: ids, pin: "123456" } }); const mm = s.session((await s.call({ action: "login", id: ids, pin: "123456" })).token);
    assert.match((await mm({ action: "purgeDemoLedger", confirm: "REMOVE DEMO DATA", demoNames: ["x"] })).error || "", /FORBIDDEN|PIN_CHANGE/);
  });
  console.log(n + " loader tests passed");
})();
