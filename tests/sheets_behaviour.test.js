/* Real Google Sheets behaviour that a plain in-memory mock hides: text that looks like a date, a date-time or a number is converted when a script writes it, and getValues then returns a Date.
   Regression tests for the installer failure "FY_DIFFERS ... Sun Dec 24 2023 00:00:00 GMT+0300" and for the partial install that an earlier version left behind. Synthetic pack only. */
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), { execSync } = require("child_process");
execSync("node " + path.join(__dirname, "../build/build-gs.js"));
const g = require("./helpers/gas.js"), { makePack } = require("./helpers/pack.js"), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sob-sh-")), pf = path.join(tmp, "pack.json"), gsf = path.join(tmp, "Code_Records.gs");
fs.writeFileSync(pf, JSON.stringify(makePack())); execSync("node " + path.join(__dirname, "../tools/make-records-gs.js") + " " + pf + " " + gsf);
const rec = fs.readFileSync(gsf, "utf8"); let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log("  ok  " + name); } catch (e) { console.log("FAIL  " + name + "\n      " + (e.stack || e)); process.exitCode = 1; } };
const ledger = async (s) => (await s.session((await s.call({ action: "login", id: "ADMIN", pin: "Adm1n-Setup-77" })).token)({ action: "getLedger" })).db;
(async () => {
  await t("the mock really behaves like Sheets: a date written as text comes back as a Date", async () => {
    const s = g.start({}, rec); s.setupAdmin(); const sh = s.sheets.Members || (s.sheets.Members = null); const ss = s.sb.SpreadsheetApp.getActiveSpreadsheet(), x = ss.insertSheet("probe"); x.getRange(1, 1, 1, 3).setValues([["2023-12-24", "0774020205", "text"]]);
    const v = x.getRange(1, 1, 1, 3).getValues()[0]; assert.ok(v[0] instanceof Date); assert.equal(typeof v[1], "number"); assert.equal(v[2], "text");
  });
  await t("dates, phone numbers and sign-in data are stored as TEXT and read back exactly", async () => {
    const s = g.start({}, rec); s.setupAdmin(); assert.equal(await s.sb.installSOBRecords(), true); const db = await ledger(s);
    assert.ok(db.transactions.length > 0 && db.transactions.every((x) => typeof x.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.date)), "every ledger date is a plain YYYY-MM-DD");
    assert.ok(db.yearCycles.every((y) => /^\d{4}-\d{2}-\d{2}$/.test(y.openedDate) && (!y.closedDate || /^\d{4}-\d{2}-\d{2}$/.test(y.closedDate))), "year boundaries are plain dates");
    assert.equal(s.sheets.Ledger.getRange(2, 2, 1, 1).getNumberFormat(), "@", "the date column is formatted as plain text");
  });
  await t("a Date that Sheets did convert is repaired on reading (calendar day in the Sheet's own time zone)", async () => {
    const s = g.start({}, rec); s.setupAdmin(); assert.equal(await s.sb.installSOBRecords(), true);
    const cy = s.sheets.YearCycles; cy.getRange(2, 1, 1, 5).setNumberFormat("General"); const row = cy.getRange(2, 1, 1, 5).getValues()[0]; cy.getRange(2, 3, 1, 1).setValues([[new Date(Date.UTC(2023, 11, 23, 21, 0, 0))]]);   // 24 Dec 2023, midnight in East Africa Time
    const db = await ledger(s); assert.equal(db.yearCycles[0].openedDate, "2023-12-24");
  });
  await t("running the installer again never reports a financial-year difference caused by the Sheet's own conversion", async () => {
    const s = g.start({}, rec); s.setupAdmin(); assert.equal(await s.sb.installSOBRecords(), true); assert.equal(await s.sb.installSOBRecords(), true); assert.equal(await s.sb.installSOBRecords(), true);
  });
  await t("a partial install saved with shifted dates by an earlier version is cleared and reloaded when nothing was approved", async () => {
    const s = g.start({}, rec); s.setupAdmin(); assert.equal(await s.sb.installSOBRecords(), true); const before = (await ledger(s)).transactions.length;
    s.sheets.Ledger.getRange(2, 2, 1, 1).setNumberFormat("General"); s.sheets.Ledger.getRange(2, 2, 1, 1).setValues([['json:"2025-01-31T21:00:00.000Z"']]);   // exactly what the earlier version left
    assert.equal(await s.sb.installSOBRecords(), true); const db = await ledger(s); assert.equal(db.transactions.length, before); assert.ok(db.transactions.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date)));
  });
  await t("the same damage is NEVER cleared once an approval has been made", async () => {
    const s = g.start({}, rec); s.setupAdmin(); assert.equal(await s.sb.installSOBRecords(), true);
    const sl = s.sheets["PIN slips - DELETE AFTER PRINTING"], rows = sl.getRange(1, 1, sl.getLastRow(), 4).getValues(), chair = rows.find((r) => r[0] === "CHAIR"), lg = await s.call({ action: "login", id: "CHAIR", pin: chair[3] }), capi = s.session(lg.token); await capi({ action: "setPin", oldPin: chair[3], newPin: "Chair-New-77" });
    const db = await ledger(s), q = db.approvalRequests.find((x) => x.status === "Pending"); assert.ok((await capi({ action: "command", name: "approveRequest", args: { id: q.id } })).ok);
    s.sheets.Ledger.getRange(2, 2, 1, 1).setNumberFormat("General"); s.sheets.Ledger.getRange(2, 2, 1, 1).setValues([['json:"2025-01-31T21:00:00.000Z"']]); const count = s.sheets.Ledger.getLastRow();
    await assert.rejects(async () => { await s.sb.installSOBRecords(); }, /approvals have already been made/); assert.equal(s.sheets.Ledger.getLastRow(), count, "nothing was cleared");
  });
  console.log(n + " real-Sheets behaviour tests passed");
})();
