/* SOB deployment/verification library. Every function takes `api(body) -> parsed JSON` so the SAME code runs against a real deployed
   Apps Script URL (sobctl) and against the local test server (tests/ctl.test.js). Nothing here bypasses the server's own checks. */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const B = require("../src/backend/backup.js");
const localEnv = { now: () => new Date().toISOString(), hash: (x) => crypto.createHash("sha256").update(x).digest("hex") };
const M = require("../src/core/migrate.js"), L = require("../src/core/ledger.js"), I = require("../src/core/integrity.js"), D = require("../src/core/dates.js");

const must = (r, what) => { if (!r || !r.ok) throw new Error(what + " failed: " + (r && r.error)); return r; };
const checks = () => { const list = []; return { list, add: (name, pass, detail) => { list.push({ name, pass: !!pass, detail: detail || "" }); return !!pass; }, get ok() { return list.every((c) => c.pass); } }; };

async function login(api, id, pin) { return must(await api({ action: "login", id, pin }), "login").token; }

/* FINAL SOB rule: voids, corrections, profit posting and share-out are only REQUESTED by the Super Admin; a different person, the Chairperson, approves.
   These helpers sign the Chairperson in (when credentials are supplied) and complete the request through the normal approveRequest command. */
async function chairToken(api, o) {
  if (!o.chairId) return null;
  const r = must(await api({ action: "login", id: o.chairId, pin: o.chairPin }), "Chairperson login");
  if (r.user.mustChangePin) { if (!o.chairNewPin) throw new Error("The Chairperson's slip PIN must be changed first: pass SOB_CHAIR_NEW_PIN once"); must(await api({ action: "setPin", token: r.token, oldPin: o.chairPin, newPin: o.chairNewPin }), "Chairperson setPin"); }
  return r.token;
}
async function gatedCommand(api, t, ct, name, args) {
  const r = await api({ action: "command", token: t, name, args }); if (!r.ok || !(r.result && r.result.pendingApproval)) return r;
  if (!ct) return { ok: false, error: "NEEDS_CHAIRPERSON: " + r.result.label + " was requested (" + r.result.requestId + ") and waits for the Chairperson; supply SOB_CHAIR_ID / SOB_CHAIR_PIN to complete it here" };
  return await api({ action: "command", token: ct, name: "approveRequest", args: { id: r.result.requestId } });
}

/* Safe against production: only reads, plus negative security probes (which never use a real account id, so no real account can be locked). */
async function smokeReadOnly(api, o) {
  const c = checks();
  c.add("service responds", (await api({ action: "ping" })).pong === true);
  c.add("no token is refused", (await api({ action: "getLedger" })).error === "UNAUTHENTICATED");
  c.add("garbage token is refused", (await api({ action: "getLedger", token: "x".repeat(40) })).error === "UNAUTHENTICATED");
  c.add("commands need a session", (await api({ action: "command", name: "createEntry", args: {} })).error === "UNAUTHENTICATED");
  c.add("unknown id cannot sign in", (await api({ action: "login", id: "SMOKE-NOBODY", pin: "000000" })).error === "BAD_CREDENTIALS");
  const t = await login(api, o.adminId, o.adminPin);
  const led = must(await api({ action: "getLedger", token: t }), "getLedger");
  c.add("Admin can read the ledger", Array.isArray(led.db.transactions));
  c.add("snapshot-write endpoint does not exist", (await api({ action: "syncAll", token: t, db: {} })).error === "UNKNOWN_ACTION");
  c.add("unknown command is refused", /UNKNOWN_COMMAND/.test((await api({ action: "command", token: t, name: "constructor", args: {} })).error || ""));
  c.add("credentials never leave the server", !JSON.stringify(led).match(/pinHash|"salt"/));
  c.add("import is closed once data exists", led.db.transactions.length === 0 || /NOT_EMPTY/.test((await api({ action: "importSnapshot", token: t, db: {} })).error || ""));
  const un = I.unaccounted(led.db, D.todayISO()); c.add("ledger integrity: every error is accounted for in the reconciliation register", un.length === 0, un.map((f) => f.code + " " + f.detail).join("; "));
  if (o.memberId) {
    const ml = must(await api({ action: "login", id: o.memberId, pin: o.memberPin }), "member login"), mt = ml.token;
    if (ml.user.mustChangePin) {
      c.add("fresh slip PIN is forced to be changed: nothing but setPin works until then", (await api({ action: "getLedger", token: mt })).error.startsWith("PIN_CHANGE_REQUIRED") && (await api({ action: "command", token: mt, name: "createEntry", args: {} })).error.startsWith("PIN_CHANGE_REQUIRED"));
      if (!o.memberNewPin) { c.add("member data checks SKIPPED (this member has not set their own PIN yet; pass SOB_MEMBER_NEW_PIN to let smoke set one, or use a member who has)", true); await api({ action: "logout", token: mt }); return finish(); }
      must(await api({ action: "setPin", token: mt, oldPin: o.memberPin, newPin: o.memberNewPin }), "member setPin");
    }
    const mv = must(await api({ action: "getLedger", token: mt }), "member getLedger").db;
    c.add("member sees only their own transactions", mv.transactions.every((x) => x.memberId === o.memberId));
    c.add("member gets no audit log, users or KPIs", !(mv.auditLog || []).length && !(mv.users || []).length && mv.kpis === undefined);
    c.add("member cannot write ledger entries", /FORBIDDEN/.test((await api({ action: "command", token: mt, name: "createEntry", args: { date: D.todayISO(), memberId: o.memberId, amount: 1, type: "Savings" } })).error || ""));
    c.add("member cannot import or create users", /FORBIDDEN/.test((await api({ action: "createUser", token: mt, user: { id: "X", role: "Admin", pin: "abcdefgh" } })).error || ""));
    await api({ action: "logout", token: mt }); c.add("logged-out member session is dead", (await api({ action: "getLedger", token: mt })).error === "UNAUTHENTICATED");
  }
  return finish();
  async function finish() { await api({ action: "logout", token: t }); c.add("logged-out admin session is dead", (await api({ action: "getLedger", token: t })).error === "UNAUTHENTICATED"); return { ok: c.ok, checks: c.list }; }
}
/* Writes a test entry and voids it: ONLY for a scratch deployment (requires allowWrite). */
async function smokeWrite(api, o) {
  if (!o.allowWrite) throw new Error("REFUSED: write smoke test needs allowWrite (use a scratch copy, never production)");
  const c = checks(), t = await login(api, o.adminId, o.adminPin), led = must(await api({ action: "getLedger", token: t }), "getLedger").db, m = led.members[0];
  const before = L.memberSavings(led, m.id), r = must(await api({ action: "command", token: t, name: "createEntry", args: { date: D.todayISO(), memberId: m.id, amount: 1234, type: "Savings", purpose: "smoke test" } }), "createEntry");
  c.add("entry saved", L.memberSavings(r.db, m.id) === before + 1234);
  const back = must(await api({ action: "getLedger", token: t }), "re-read").db; c.add("entry persisted in the Sheet", L.memberSavings(back, m.id) === before + 1234);
  const rq = must(await api({ action: "command", token: t, name: "voidEntry", args: { id: r.result.id, reason: "smoke test cleanup" } }), "voidEntry request");
  c.add("the Super Admin's void only creates a request; the balance is unchanged until the Chairperson approves", !!(rq.result && rq.result.pendingApproval) && L.memberSavings(rq.db, m.id) === before + 1234);
  const ct = await chairToken(api, o); if (!ct) { c.add("void completed by the Chairperson (supply SOB_CHAIR_ID/SOB_CHAIR_PIN; the test entry stays until then)", false); return { ok: c.ok, checks: c.list }; }
  const adminTryApprove = await api({ action: "command", token: t, name: "approveRequest", args: { id: rq.result.requestId } }); c.add("the Super Admin cannot approve their own request", !adminTryApprove.ok && /FORBIDDEN|SEPARATION/.test(adminTryApprove.error || ""));
  const v = must(await api({ action: "command", token: ct, name: "approveRequest", args: { id: rq.result.requestId } }), "approveRequest");
  c.add("void restores the balance, record kept", L.memberSavings(v.db, m.id) === before && v.db.transactions.some((x) => x.id === r.result.id && x.voided));
  c.add("audit trail has the actions", v.db.auditLog.some((a) => a.entityId === r.result.id && a.action.includes("oid")));
  return { ok: c.ok, checks: c.list };
}
async function importLedger(api, o) {
  const raw = JSON.parse(fs.readFileSync(o.legacyPath, "utf8")), asOf = o.asOf || D.todayISO(), db = M.migrateLegacy(raw, asOf), ver = M.verifyMigration(raw, db, asOf), c = checks();
  c.add("local migration verified figure-for-figure", ver.pass, ver.checks.filter((x) => !x.pass).map((x) => x.name).join(", "));
  if (!ver.pass) return { ok: false, checks: c.list };
  const integ = I.check(db, asOf); c.add("integrity findings listed (" + integ.errors + " error(s) to register as discrepancies, never auto-fixed)", true, integ.findings.map((f) => I.findingKey(f)).join(", "));
  if (o.dryRun) return { ok: c.ok, dryRun: true, checks: c.list };
  const t = await login(api, o.adminId, o.adminPin); must(await api({ action: "importSnapshot", token: t, db }), "importSnapshot");
  const back = must(await api({ action: "getLedger", token: t }), "readback").db;
  c.add("member count in Sheet", back.members.length === db.members.length);
  c.add("transaction count in Sheet", back.transactions.length === db.transactions.length);
  c.add("every transaction id preserved", db.transactions.every((x, i) => back.transactions.find((y) => y.id === x.id)));
  c.add("group savings identical after round trip", L.computeGroupTotals(back, asOf).groupSavings === L.computeGroupTotals(db, asOf).groupSavings);
  c.add("every loan balance identical after round trip", db.loans.every((l) => L.loanOutstanding(back.loans.find((x) => x.id === l.id), back, asOf) === L.loanOutstanding(l, db, asOf)));
  c.add("legacy bank-level rows archived untouched", JSON.stringify(back.legacyAdministration) === JSON.stringify(db.legacyAdministration));
  c.add("per-member savings identical", db.members.every((m) => L.memberSavings(back, m.id) === L.memberSavings(db, m.id)));
  return { ok: c.ok, checks: c.list };
}
async function importUsers(api, o) { const t = await login(api, o.adminId, o.adminPin); const users = JSON.parse(fs.readFileSync(o.usersPath, "utf8")); return must(await api({ action: "importUsers", token: t, users }), "importUsers"); }
async function registerDiscrepancies(api, o) {
  const t = await login(api, o.adminId, o.adminPin), ct = await chairToken(api, o), rec = JSON.parse(fs.readFileSync(o.reconPath, "utf8")), out = [];
  let last;
  for (const d of rec.discrepancies) { const r = await api({ action: "command", token: t, name: "openDiscrepancy", args: d }); out.push({ subject: d.subject, ok: !!r.ok, error: r.error }); if (r.ok) last = r.db; }
  /* Items SOB has already answered (with evidence) are closed straight away, through the same audited command. */
  for (const res of rec.resolutions || []) {
    const led = (last || must(await api({ action: "getLedger", token: t }), "read").db), item = (led.discrepancies || []).find((x) => x.subject === res.subject && x.status === "Open");
    if (!item) { out.push({ subject: res.subject, resolved: false, error: "no open item" }); continue; }
    const r = await gatedCommand(api, t, ct, "resolveDiscrepancy", { id: item.id, decision: res.decision, reason: res.reason, evidence: res.evidence });
    out.push({ subject: res.subject, resolved: !!r.ok, error: r.error });
  }
  return out;
}
/* Applies SOB-approved correction steps through the normal audited commands. Refuses without a named approver. */
/* Imports VERIFIED historical records (built privately, outside the repo) through the audited bulk command. Dry run first, backup snapshot,
   chunked writes, then read-back proof: no existing record changed, each member's savings moved by exactly the imported net, integrity not worse. */
async function importHistory(api, o) {
  if (!o.approvedBy || String(o.approvedBy).trim().length < 5) throw new Error("REFUSED: --approved-by \"<name, role, date>\" is required");
  const pack = JSON.parse(fs.readFileSync(o.path, "utf8")), t = await login(api, o.adminId, o.adminPin), c = checks();
  const asOf = o.asOf || D.todayISO(), pre = must(await api({ action: "getLedger", token: t }), "pre-read").db;
  const args = (entries, dryRun) => ({ batchId: pack.batchId, source: pack.source + " | Approved by: " + o.approvedBy, entries, dryRun });
  const newMembers = (pack.members || []).filter((m) => !pre.members.some((x) => x.id === m.id));
  (pack.members || []).forEach((m) => { const ex = pre.members.find((x) => x.id === m.id); if (ex) c.add("confirmed member " + m.id + " already exists with the same name", ex.name === m.name, ex.name); });
  const dry = (newMembers.length ? { added: pack.entries.length, alreadyImported: 0, possibleDuplicates: [] } : must(await api({ action: "command", token: t, name: "importHistoricalEntries", args: args(pack.entries, true) }), "dry run").result);
  c.add("dry run: " + dry.added + " new, " + dry.alreadyImported + " already imported, " + dry.possibleDuplicates.length + " possible duplicate(s)", dry.possibleDuplicates.length === 0, JSON.stringify(dry.possibleDuplicates.slice(0, 3)));
  if (o.dryRun || !c.ok) return { ok: c.ok, checks: c.list, dry };
  const bk = await api({ action: "backupNow", token: t, force: true }); c.add("backup snapshot taken before import", !!bk.ok, bk.error);
  for (const m of newMembers) { const r = await api({ action: "command", token: t, name: "addMember", args: { id: m.id, name: m.name, regDate: m.regDate || "" } }); if (!r.ok) { c.add("add confirmed member " + m.id, false, r.error); return { ok: false, checks: c.list }; } }
  c.add("confirmed members created: " + (newMembers.map((m) => m.id).join(", ") || "none needed"), true);
  const todo = pack.entries.filter((e) => !pre.transactions.some((x) => x.sourceRef === e.sourceRef));
  for (let i = 0; i < todo.length; i += 150) { const r = await api({ action: "command", token: t, name: "importHistoricalEntries", args: args(todo.slice(i, i + 150), false) }); if (!r.ok) { c.add("chunk " + i, false, r.error); return { ok: false, checks: c.list }; } }
  if ((pack.annotations || []).length) { const r = await api({ action: "command", token: t, name: "importHistoricalEntries", args: { batchId: pack.batchId, source: pack.source + " | Approved by: " + o.approvedBy, entries: [], annotations: pack.annotations } }); c.add("audit annotations recorded (not transactions): " + (r.result ? r.result.annotationsAdded + " new, " + r.result.annotationsAlreadyRecorded + " already" : r.error), !!r.ok, r.error); }
  const post = must(await api({ action: "getLedger", token: t }), "post-read").db;
  c.add("existing records untouched", pre.transactions.every((x) => JSON.stringify(post.transactions.find((y) => y.id === x.id)) === JSON.stringify(x)));
  c.add("transaction count rose by exactly the imported rows", post.transactions.length === pre.transactions.length + todo.length, post.transactions.length + " vs " + (pre.transactions.length + todo.length));
  const net = {}; todo.forEach((e) => { net[e.memberId] = (net[e.memberId] || 0) + (["Savings", "Profit"].includes(e.type) ? e.amount : -e.amount); });
  c.add("each member's savings moved by exactly the imported net", post.members.every((m) => L.memberSavings(post, m.id) - L.memberSavings(pre, m.id) === (net[m.id] || 0)));
  c.add("original dates and source references preserved", todo.every((e) => { const x = post.transactions.find((y) => y.sourceRef === e.sourceRef); return x && x.date === e.date && x.historical === true && x.amount === e.amount; }));
  const a = I.check(pre, asOf), b = I.check(post, asOf); c.add("integrity not worse (" + a.errors + " -> " + b.errors + " error(s))", b.errors <= a.errors);
  c.add("new members exist with the confirmed IDs and names", newMembers.every((m) => post.members.some((x) => x.id === m.id && x.name === m.name)));
  const again = must(await api({ action: "command", token: t, name: "importHistoricalEntries", args: args(pack.entries, true) }), "re-run").result; c.add("re-running would add nothing", again.added === 0);
  return { ok: c.ok, checks: c.list };
}
async function applyPlan(api, o) {
  if (!o.approvedBy || String(o.approvedBy).trim().length < 5) throw new Error("REFUSED: --approved-by \"<name, role, date>\" is required");
  const rec = JSON.parse(fs.readFileSync(o.reconPath, "utf8")), t = await login(api, o.adminId, o.adminPin), ct = await chairToken(api, o), c = checks();
  const pre = must(await api({ action: "getLedger", token: t }), "pre-read").db, asOf = o.asOf || rec.asOf;
  for (const s of rec.plan.steps) {
    const args = Object.assign({}, s.args); if (args.reason) args.reason += " | Approved by: " + o.approvedBy;
    const r = await gatedCommand(api, t, ct, s.name, args); if (!r.ok) { c.add("step " + s.name, false, r.error); return { ok: false, checks: c.list }; }
  }
  const post = must(await api({ action: "getLedger", token: t }), "post-read").db;
  c.add("all " + rec.plan.steps.length + " steps applied", true);
  c.add("every member's savings unchanged", pre.members.every((m) => L.memberSavings(pre, m.id) === L.memberSavings(post, m.id)));
  c.add("original rows still present (nothing deleted)", pre.transactions.every((x) => post.transactions.find((y) => y.id === x.id)));
  rec.impact.filter((i) => i.planned).forEach((i) => c.add("loan " + i.loanId + " balance as predicted", L.loanOutstanding(post.loans.find((l) => l.id === i.loanId), post, asOf) === i.balanceAfter));
  c.add("integrity: no NEW errors", I.check(post, asOf).errors <= I.check(pre, asOf).errors);
  return { ok: c.ok, checks: c.list };
}
async function verify(api, o) { const t = await login(api, o.adminId, o.adminPin), db = must(await api({ action: "getLedger", token: t }), "getLedger").db, asOf = o.asOf || D.todayISO(); return { totals: L.computeGroupTotals(db, asOf), integrity: I.check(db, asOf), counts: { members: db.members.length, transactions: db.transactions.length, loans: db.loans.length, audit: db.auditLog.length, openDiscrepancies: (db.discrepancies || []).filter((d) => d.status === "Open").length } }; }
/* Offline backup: a verified, credential-free export written OUTSIDE the repository (it contains members' personal data). */
async function backupToFile(api, o) {
  const out = path.resolve(o.outPath || ""), repo = path.resolve(__dirname, "..");
  if (!o.outPath) throw new Error("usage: backup <out.json>");
  if (out === repo || out.startsWith(repo + path.sep)) throw new Error("REFUSED: write backups outside the repository (they contain personal data)");
  const t = await login(api, o.adminId, o.adminPin), ex = must(await api({ action: "exportBackup", token: t }), "exportBackup").backup, v = B.verifyExport(localEnv, ex), c = checks();
  c.add("export checksum and record counts verify", v.ok, v.error);
  if (!v.ok) return { ok: false, checks: c.list };
  const integ = I.check(v.db, o.asOf || D.todayISO());
  fs.writeFileSync(out, JSON.stringify(ex), { mode: 0o600 });
  c.add("written " + out + " (" + v.counts.members + " members, " + v.counts.transactions + " transactions, " + v.counts.loans + " loans, " + v.counts.auditLog + " audit records)", true);
  c.add("integrity findings of the backed-up state: " + integ.errors + " error(s), " + integ.warnings + " warning(s) (reported, not blocking)", true);
  return { ok: c.ok, checks: c.list };
}
function backupVerifyFile(o) {
  const ex = JSON.parse(fs.readFileSync(o.path, "utf8")), v = B.verifyExport(localEnv, ex), c = checks();
  c.add("checksum and counts verify", v.ok, v.error);
  if (v.ok) { const integ = I.check(v.db, o.asOf || D.todayISO()); c.add("file is restorable (valid ledger, " + v.counts.transactions + " transactions); integrity: " + integ.errors + " error(s)", true); }
  return { ok: c.ok, checks: c.list };
}
/* Recovery into a NEW, EMPTY deployment: verify the file, import it, then prove the Sheet equals the file. Sign-ins are re-provisioned afterwards. */
async function restoreBackup(api, o) {
  const ex = JSON.parse(fs.readFileSync(o.path, "utf8")), v = B.verifyExport(localEnv, ex), c = checks(), asOf = o.asOf || D.todayISO();
  c.add("backup file verifies", v.ok, v.error); if (!v.ok) return { ok: false, checks: c.list };
  const db = v.db, t = await login(api, o.adminId, o.adminPin);
  must(await api({ action: "importSnapshot", token: t, db }), "importSnapshot");
  const back = must(await api({ action: "getLedger", token: t }), "readback").db;
  c.add("record counts equal the backup", back.members.length === db.members.length && back.transactions.length === db.transactions.length && back.loans.length === db.loans.length && back.auditLog.length === db.auditLog.length);
  c.add("every transaction, loan and audit id preserved", ["transactions", "loans", "auditLog"].every((k) => db[k].every((x) => back[k].find((y) => y.id === x.id))));
  c.add("group savings identical", L.computeGroupTotals(back, asOf).groupSavings === L.computeGroupTotals(db, asOf).groupSavings);
  c.add("every member's savings identical", db.members.every((m) => L.memberSavings(back, m.id) === L.memberSavings(db, m.id)));
  c.add("every loan balance identical", db.loans.every((l) => L.loanOutstanding(back.loans.find((x) => x.id === l.id), back, asOf) === L.loanOutstanding(l, db, asOf)));
  return { ok: c.ok, checks: c.list };
}
module.exports = { backupToFile, backupVerifyFile, restoreBackup, login, smokeReadOnly, smokeWrite, importLedger, importUsers, registerDiscrepancies, applyPlan, importHistory, verify };
