/* One-step installation (Run > installSOBRecords in the Apps Script editor): bundled Code_Ledger.gs + private Code_Records.gs on a mock Sheet. Synthetic pack. */
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), { execSync } = require("child_process");
execSync("node " + path.join(__dirname, "../build/build-gs.js"));
const g = require("./helpers/gas.js"), { makePack } = require("./helpers/pack.js"), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sob-inst-")), pf = path.join(tmp, "pack.json"), gsf = path.join(tmp, "Code_Records.gs");
fs.writeFileSync(pf, JSON.stringify(makePack())); execSync("node " + path.join(__dirname, "../tools/make-records-gs.js") + " " + pf + " " + gsf);
let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log("  ok  " + name); } catch (e) { console.log("FAIL  " + name + "\n      " + (e.stack || e)); process.exitCode = 1; } };
(async () => {
  const s = g.start({}, fs.readFileSync(gsf, "utf8")); s.setupAdmin();
  const logText = () => (s.sheets["SOB Load Log"] ? "x" : "");
  await t("refuses to run without an Admin or the records file", async () => { const s2 = g.start(); s2.setupAdmin(); assert.throws(() => s2.sb.installSOBRecords && s2.sb.installSOBRecords(), /Code_Records/); });
  await t("first run loads everything, writes the log and sign-ins; corrections wait for the Chairperson", async () => {
    assert.equal(await s.sb.installSOBRecords(), true);
    assert.ok(s.sheets["SOB Load Log"] && s.sheets["PIN slips - DELETE AFTER PRINTING"], "log and slips sheets exist");
    const db = (await s.call({ action: "login", id: "ADMIN", pin: "Adm1n-Setup-77" })); const api = s.session(db.token); const led = (await api({ action: "getLedger" })).db;
    assert.equal(led.members.length, makePack().controls.members); assert.ok(led.approvalRequests.some((q) => q.status === "Pending"));
  });
  await t("the Chairperson signs in with the slip PIN, approves, and a second run finishes the job", async () => {
    const sl = s.sheets["PIN slips - DELETE AFTER PRINTING"], rows = sl.getRange(1, 1, sl.getLastRow(), 4).getValues(), chair = rows.find((r) => r[0] === "CHAIR");
    const lg = await s.call({ action: "login", id: "CHAIR", pin: chair[3] }); assert.ok(lg.ok && lg.user.mustChangePin); const capi = s.session(lg.token); assert.ok((await capi({ action: "setPin", oldPin: chair[3], newPin: "Chair-New-77" })).ok);
    const api = s.session((await s.call({ action: "login", id: "ADMIN", pin: "Adm1n-Setup-77" })).token); const led = (await api({ action: "getLedger" })).db;
    for (const q of led.approvalRequests.filter((x) => x.status === "Pending").sort((a) => (a.command === "voidEntry" ? -1 : 1))) assert.ok((await capi({ action: "command", name: "approveRequest", args: { id: q.id } })).ok);
    assert.equal(await s.sb.installSOBRecords(), true);
    const after = (await api({ action: "getLedger" })).db; assert.equal(after.transactions.filter((x) => /test split/.test(x.purpose || "") && !x.voided).length, 1);
  });
  await t("a third run changes nothing", async () => { const api = s.session((await s.call({ action: "login", id: "ADMIN", pin: "Adm1n-Setup-77" })).token), a = (await api({ action: "getLedger" })).db; assert.equal(await s.sb.installSOBRecords(), true); const b = (await api({ action: "getLedger" })).db; assert.equal(a.transactions.length, b.transactions.length); assert.equal(a.auditLog.length, b.auditLog.length); assert.equal(Object.keys(s.sheets).length >= 3, true); });
  await t("demo sample records are removed first (with a backup), real records then load; a Sheet of unknown members is refused untouched", async () => {
    const synth = require("./helpers/synth.js"), M = require("../src/core/migrate.js"), demo = M.migrateLegacy(synth.build().legacy, "2026-03-31");
    const s2 = g.start({}, fs.readFileSync(gsf, "utf8")); s2.setupAdmin(); const api = s2.session((await s2.call({ action: "login", id: "ADMIN", pin: "Adm1n-Setup-77" })).token);
    assert.ok((await api({ action: "importSnapshot", db: demo })).ok); assert.equal(await s2.sb.installSOBRecords(), true);
    const led = (await api({ action: "getLedger" })).db; assert.ok(!led.members.some((m) => /^Demo Member/.test(m.name))); assert.equal(led.members.length, makePack().controls.members); assert.ok((await api({ action: "listBackups" })).backups.length >= 1);
    const s3 = g.start({}, fs.readFileSync(gsf, "utf8")); s3.setupAdmin(); const a3 = s3.session((await s3.call({ action: "login", id: "ADMIN", pin: "Adm1n-Setup-77" })).token);
    const odd = JSON.parse(JSON.stringify(demo)); odd.members.forEach((m) => { m.name = "Somebody " + m.id; }); await a3({ action: "importSnapshot", db: odd });
    assert.equal(await s3.sb.installSOBRecords(), false); assert.equal((await a3({ action: "getLedger" })).db.members.length, odd.members.length);
  });
  console.log(n + " install tests passed");
})();
