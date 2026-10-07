/* SOB deployment/verification library. Every function takes `api(body) -> parsed JSON` so the SAME code runs against a real deployed
   Apps Script URL (sobctl) and against the local test server (tests/ctl.test.js). Nothing here bypasses the server's own checks. */
const fs = require("fs");
const M = require("../src/core/migrate.js"), L = require("../src/core/ledger.js"), I = require("../src/core/integrity.js"), D = require("../src/core/dates.js");

const must = (r, what) => { if (!r || !r.ok) throw new Error(what + " failed: " + (r && r.error)); return r; };
const checks = () => { const list = []; return { list, add: (name, pass, detail) => { list.push({ name, pass: !!pass, detail: detail || "" }); return !!pass; }, get ok() { return list.every((c) => c.pass); } }; };

async function login(api, id, pin) { return must(await api({ action: "login", id, pin }), "login").token; }

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
    const mt = await login(api, o.memberId, o.memberPin), mv = must(await api({ action: "getLedger", token: mt }), "member getLedger").db;
    c.add("member sees only their own transactions", mv.transactions.every((x) => x.memberId === o.memberId));
    c.add("member gets no audit log, users or KPIs", !(mv.auditLog || []).length && !(mv.users || []).length && mv.kpis === undefined);
    c.add("member cannot write ledger entries", /FORBIDDEN/.test((await api({ action: "command", token: mt, name: "createEntry", args: { date: D.todayISO(), memberId: o.memberId, amount: 1, type: "Savings" } })).error || ""));
    c.add("member cannot import or create users", /FORBIDDEN/.test((await api({ action: "createUser", token: mt, user: { id: "X", role: "Admin", pin: "abcdefgh" } })).error || ""));
    await api({ action: "logout", token: mt }); c.add("logged-out member session is dead", (await api({ action: "getLedger", token: mt })).error === "UNAUTHENTICATED");
  }
  await api({ action: "logout", token: t }); c.add("logged-out admin session is dead", (await api({ action: "getLedger", token: t })).error === "UNAUTHENTICATED");
  return { ok: c.ok, checks: c.list };
}
/* Writes a test entry and voids it: ONLY for a scratch deployment (requires allowWrite). */
async function smokeWrite(api, o) {
  if (!o.allowWrite) throw new Error("REFUSED: write smoke test needs allowWrite (use a scratch copy, never production)");
  const c = checks(), t = await login(api, o.adminId, o.adminPin), led = must(await api({ action: "getLedger", token: t }), "getLedger").db, m = led.members[0];
  const before = L.memberSavings(led, m.id), r = must(await api({ action: "command", token: t, name: "createEntry", args: { date: D.todayISO(), memberId: m.id, amount: 1234, type: "Savings", purpose: "smoke test" } }), "createEntry");
  c.add("entry saved", L.memberSavings(r.db, m.id) === before + 1234);
  const back = must(await api({ action: "getLedger", token: t }), "re-read").db; c.add("entry persisted in the Sheet", L.memberSavings(back, m.id) === before + 1234);
  const v = must(await api({ action: "command", token: t, name: "voidEntry", args: { id: r.result.id, reason: "smoke test cleanup" } }), "voidEntry");
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
  const t = await login(api, o.adminId, o.adminPin), rec = JSON.parse(fs.readFileSync(o.reconPath, "utf8")), out = [];
  let last;
  for (const d of rec.discrepancies) { const r = await api({ action: "command", token: t, name: "openDiscrepancy", args: d }); out.push({ subject: d.subject, ok: !!r.ok, error: r.error }); if (r.ok) last = r.db; }
  /* Items SOB has already answered (with evidence) are closed straight away, through the same audited command. */
  for (const res of rec.resolutions || []) {
    const led = (last || must(await api({ action: "getLedger", token: t }), "read").db), item = (led.discrepancies || []).find((x) => x.subject === res.subject && x.status === "Open");
    if (!item) { out.push({ subject: res.subject, resolved: false, error: "no open item" }); continue; }
    const r = await api({ action: "command", token: t, name: "resolveDiscrepancy", args: { id: item.id, decision: res.decision, reason: res.reason, evidence: res.evidence } });
    out.push({ subject: res.subject, resolved: !!r.ok, error: r.error });
  }
  return out;
}
/* Applies SOB-approved correction steps through the normal audited commands. Refuses without a named approver. */
async function applyPlan(api, o) {
  if (!o.approvedBy || String(o.approvedBy).trim().length < 5) throw new Error("REFUSED: --approved-by \"<name, role, date>\" is required");
  const rec = JSON.parse(fs.readFileSync(o.reconPath, "utf8")), t = await login(api, o.adminId, o.adminPin), c = checks();
  const pre = must(await api({ action: "getLedger", token: t }), "pre-read").db, asOf = o.asOf || rec.asOf;
  for (const s of rec.plan.steps) {
    const args = Object.assign({}, s.args); if (args.reason) args.reason += " | Approved by: " + o.approvedBy;
    const r = await api({ action: "command", token: t, name: s.name, args }); if (!r.ok) { c.add("step " + s.name, false, r.error); return { ok: false, checks: c.list }; }
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
module.exports = { login, smokeReadOnly, smokeWrite, importLedger, importUsers, registerDiscrepancies, applyPlan, verify };
