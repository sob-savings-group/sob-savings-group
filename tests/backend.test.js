const assert = require("assert"), fs = require("fs"), vm = require("vm"), path = require("path"), crypto = require("crypto");
const S = require("../src/backend/store.js"), A = require("../src/backend/auth.js"), API = require("../src/backend/api.js"), M = require("../src/core/migrate.js"), L = require("../src/core/ledger.js");
let failed = 0; const tests = []; const t = (n, f) => tests.push([n, f]);
const raw = require("./helpers/synth.js").legacyRaw();
const AS_OF = "2026-03-31";

function mockSS() {
  const sheets = {};
  const mk = (name) => { const data = []; return { name, data, getLastRow: () => data.length, getLastColumn: () => data.reduce((a, r) => Math.max(a, r.length), 0),
    getRange(r, c, nr, nc) { return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (data[r - 1 + i] && data[r - 1 + i][c - 1 + j] !== undefined ? data[r - 1 + i][c - 1 + j] : ""))),
      setValues: (v) => v.forEach((row, i) => row.forEach((x, j) => { data[r - 1 + i] = data[r - 1 + i] || []; data[r - 1 + i][c - 1 + j] = x; })),
      clearContent: () => { for (let i = 0; i < nr; i++) if (data[r - 1 + i]) for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = ""; } }; } }; };
  return { sheets, getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mk(n)) };
}
function newEnv() {
  const store = {}; let n = 0;
  return { ss: mockSS(), lock: { waitLock() {}, releaseLock() {} }, now: () => "T", hash: (s) => crypto.createHash("sha256").update(s).digest("hex"),
    randomToken: () => crypto.randomBytes(8).toString("hex") + (++n),
    cache: { get: (k) => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; }, remove: (k) => { delete store[k]; } } };
}
const db0 = M.migrateLegacy(raw, AS_OF);
const memberWith = db0.members.find((m) => L.memberSavings(db0, m.id) > 0), otherMember = db0.members.find((m) => m.id !== memberWith.id && L.memberSavings(db0, m.id) > 0);
function world() {
  const env = newEnv(), call = (b) => API.handle(env, b);
  S.writeCollection(env.ss, "users", [
    A.makeUser(env, { id: "ADMIN", role: "Admin", pin: "admin-pin-1" }), A.makeUser(env, { id: "COMM", role: "Committee", pin: "comm-pin-1" }),
    A.makeUser(env, { id: memberWith.id, role: "Member", memberId: memberWith.id, pin: "1234" }), A.makeUser(env, { id: otherMember.id, role: "Member", memberId: otherMember.id, pin: "4321" })]);
  const tok = (id, pin) => { const r = call({ action: "login", id, pin }); assert.ok(r.ok, "login " + id); return r.token; };
  const admin = tok("ADMIN", "admin-pin-1");
  assert.ok(call({ action: "importSnapshot", token: admin, db: db0 }).ok);
  return { env, call, tok, admin, comm: tok("COMM", "comm-pin-1"), member: tok(memberWith.id, "1234"), other: tok(otherMember.id, "4321") };
}
const cmd = (w, token, name, args) => w.call({ action: "command", token, name, args });

t("no token / garbage token / missing action are all refused", () => {
  const w = world();
  for (const tk of [undefined, "", "abc", "ADMIN", 123, {}]) assert.equal(w.call({ action: "getLedger", token: tk }).error, "UNAUTHENTICATED");
  assert.equal(w.call({ action: "command", name: "createEntry", args: {} }).error, "UNAUTHENTICATED");
  assert.equal(w.call(null).error, "INVALID_REQUEST");
  assert.equal(w.call({ action: "nope", token: w.admin }).error, "UNKNOWN_ACTION");
});
t("login: wrong PIN refused, 5 failures lock the account even for the right PIN", () => {
  const w = world();
  for (let i = 0; i < 5; i++) assert.equal(w.call({ action: "login", id: "COMM", pin: "bad" + i }).error, "BAD_CREDENTIALS");
  assert.match(w.call({ action: "login", id: "COMM", pin: "comm-pin-1" }).error, /LOCKED/);
  assert.equal(w.call({ action: "login", id: "NOBODY", pin: "x" }).error, "BAD_CREDENTIALS");
});
t("PINs are stored hashed+salted, never in plain text, and never sent to any client", () => {
  const w = world(), users = S.readCollection(w.env.ss, "users");
  users.forEach((u) => { assert.ok(u.pinHash && u.salt); assert.ok(!JSON.stringify(u).includes("admin-pin-1") && !JSON.stringify(u).includes("1234")); });
  const blob = JSON.stringify(w.call({ action: "getLedger", token: w.admin }));
  assert.ok(!blob.includes("pinHash") && !blob.includes(users[0].pinHash) && !blob.includes("salt"));
});
t("MEMBER cannot run any staff command (server enforces roles, not the browser)", () => {
  const w = world();
  const attempts = [["createEntry", { date: "2026-02-01", memberId: memberWith.id, amount: 1000, type: "Savings" }], ["voidEntry", { id: db0.transactions[0].id, reason: "x" }],
    ["approveLoan", { loanId: "x" }], ["disburseLoan", { loanId: "x", assignedMonthlyInterest: 0 }], ["repayLoan", { loanId: db0.loans[0].id, amount: 1 }],
    ["editAssignedInterest", { loanId: db0.loans[0].id, amount: 0, reason: "x" }], ["voidLoan", { loanId: db0.loans[0].id, reason: "x" }], ["addMember", { name: "X" }],
    ["recordSubscription", { memberId: memberWith.id, year: 2026 }], ["executeShareOut", { year: 2026, date: "2026-12-10" }], ["recordExistingLoan", { memberId: memberWith.id, amount: 5, date: "2026-01-01", assignedMonthlyInterest: 0 }]];
  attempts.forEach(([n, a]) => assert.match(cmd(w, w.member, n, a).error, /FORBIDDEN/, n));
  assert.equal(S.readAll(w.env.ss).transactions.length, db0.transactions.length, "nothing changed");
});
t("MEMBER may apply only for themselves", () => {
  const w = world();
  assert.match(cmd(w, w.member, "applyForLoan", { memberId: otherMember.id, amount: 1000 }).error, /FORBIDDEN/);
  const loanHolder = db0.loans.some((l) => l.memberId === memberWith.id);
  const r = cmd(w, w.member, "applyForLoan", { memberId: memberWith.id, amount: 1000 });
  assert.ok(loanHolder ? /HAS_OUTSTANDING_LOAN/.test(r.error) : r.ok);
});
t("COMMITTEE defaults to read-only: all write commands refused, reads work", () => {
  const w = world();
  assert.match(cmd(w, w.comm, "createEntry", { date: "2026-02-01", memberId: memberWith.id, amount: 1000, type: "Savings" }).error, /FORBIDDEN/);
  assert.match(cmd(w, w.comm, "repayLoan", { loanId: db0.loans[0].id, amount: 1 }).error, /FORBIDDEN/);
  const v = w.call({ action: "getLedger", token: w.comm });
  assert.ok(v.ok && v.db.transactions.length === db0.transactions.length && v.db.users.length === 0 && v.db.auditLog.length === 0);
});
t("client cannot choose its identity or role: smuggled ctx/role/by fields are ignored", () => {
  const w = world();
  const r = w.call({ action: "command", token: w.member, role: "Admin", user: { role: "Admin" }, name: "createEntry", args: { date: "2026-02-01", memberId: memberWith.id, amount: 1000, type: "Savings", ctx: { role: "Admin" }, role: "Admin", by: "ADMIN", createdBy: "ADMIN" } });
  assert.match(r.error, /FORBIDDEN/);
  const a = cmd(w, w.admin, "createEntry", { date: "2026-02-01", memberId: memberWith.id, amount: 1000, type: "Savings", by: "SOMEONE ELSE", createdBy: "SOMEONE ELSE" });
  assert.ok(a.ok); const e = S.readAll(w.env.ss).transactions.find((x) => x.id === a.result.id); assert.equal(e.createdBy, "ADMIN", "creator comes from the session");
});
t("command whitelist: unknown names, prototype tricks and bad args are rejected", () => {
  const w = world();
  for (const n of ["constructor", "__proto__", "toString", "hasOwnProperty", "run", "syncAll", "", undefined, 5]) assert.ok(/UNKNOWN_COMMAND|INVALID/.test(cmd(w, w.admin, n, {}).error), String(n));
  assert.match(cmd(w, w.admin, "createEntry", "oops").error, /INVALID/);
  assert.match(cmd(w, w.admin, "createEntry", [1]).error, /INVALID/);
});
t("MEMBER sees only their own records: no other members' transactions, loans, audit, users or KPIs", () => {
  const w = world(), v = w.call({ action: "getLedger", token: w.member }).db;
  assert.ok(v.transactions.length > 0 && v.transactions.every((x) => x.memberId === memberWith.id));
  assert.ok(v.loans.every((l) => l.memberId === memberWith.id));
  assert.equal(v.auditLog.length + v.users.length + v.legacyAdministration.length + v.shareOutEvents.length, 0); assert.equal(v.kpis, undefined);
  const other = v.members.find((m) => m.id === otherMember.id); assert.deepEqual(Object.keys(other).sort(), ["id", "name", "status"], "other members: id/name only (no phone/email)");
  assert.equal(L.memberSavings(v, memberWith.id), L.memberSavings(db0, memberWith.id), "own figures still correct");
  assert.ok(!JSON.stringify(v).includes(otherMember.phone || "\u0000never"));
});
t("MEMBER view includes a loan they guarantee, but nothing else of the borrower's", () => {
  const w = world(), borrower = db0.members.find((m) => m.id !== memberWith.id && !db0.loans.some((l) => l.memberId === m.id));
  const raw2 = S.readAll(w.env.ss); raw2.loans.push({ id: "LOAN-G", memberId: borrower.id, loanAmount: 5000, status: "Pending" }); raw2.guarantees.push({ id: "G1", loanId: "LOAN-G", guarantorId: memberWith.id, amount: 5000, status: "Active" });
  const v = API.viewFor(Object.assign(raw2, { users: [] }), { role: "Member", memberId: memberWith.id }, AS_OF);
  assert.ok(v.loans.some((l) => l.id === "LOAN-G")); assert.ok(!v.transactions.some((x) => x.memberId === borrower.id));
});
t("a disabled user's EXISTING session stops working immediately; role changes apply at once", () => {
  const w = world();
  assert.ok(w.call({ action: "getLedger", token: w.member }).ok);
  assert.ok(w.call({ action: "disableUser", token: w.admin, userId: memberWith.id }).ok);
  assert.equal(w.call({ action: "getLedger", token: w.member }).error, "UNAUTHENTICATED");
  assert.equal(w.call({ action: "login", id: memberWith.id, pin: "1234" }).error, "BAD_CREDENTIALS");
  const users = S.readCollection(w.env.ss, "users"); users.find((u) => u.id === "COMM").role = "Admin"; S.writeCollection(w.env.ss, "users", users);
  assert.ok(cmd(w, w.comm, "createEntry", { date: "2026-02-01", memberId: otherMember.id, amount: 1, type: "Savings" }).ok, "promotion takes effect without re-login");
});
t("logout kills the session; Admin cannot disable themselves", () => {
  const w = world(); assert.ok(w.call({ action: "logout", token: w.member }).ok); assert.equal(w.call({ action: "getLedger", token: w.member }).error, "UNAUTHENTICATED");
  assert.match(w.call({ action: "disableUser", token: w.admin, userId: "ADMIN" }).error, /INVALID/);
  assert.match(w.call({ action: "disableUser", token: w.comm, userId: "COMM" }).error, /FORBIDDEN/);
});
t("user management is Admin-only; weak PINs refused; members may change only their own PIN with the old PIN", () => {
  const w = world();
  assert.match(w.call({ action: "createUser", token: w.comm, user: { id: "X", role: "Admin", pin: "abcdefgh" } }).error, /FORBIDDEN/);
  assert.match(w.call({ action: "createUser", token: w.admin, user: { id: "X", role: "Admin", pin: "123" } }).error, /WEAK_PIN/);
  assert.match(w.call({ action: "setPin", token: w.member, userId: otherMember.id, newPin: "9999", oldPin: "1234" }).error, /FORBIDDEN/);
  assert.match(w.call({ action: "setPin", token: w.member, newPin: "5678", oldPin: "wrong" }).error, /BAD_CREDENTIALS/);
  assert.ok(w.call({ action: "setPin", token: w.member, newPin: "5678", oldPin: "1234" }).ok);
  assert.ok(w.call({ action: "login", id: memberWith.id, pin: "5678" }).ok); assert.equal(w.call({ action: "login", id: memberWith.id, pin: "1234" }).error, "BAD_CREDENTIALS");
});
t("importSnapshot: Admin only and only into an EMPTY ledger; there is no general snapshot-write", () => {
  const w = world();
  assert.match(w.call({ action: "importSnapshot", token: w.admin, db: db0 }).error, /NOT_EMPTY/);
  assert.match(w.call({ action: "importSnapshot", token: w.comm, db: db0 }).error, /FORBIDDEN|NOT_EMPTY/);
  assert.equal(w.call({ action: "syncAll", token: w.admin, db: db0 }).error, "UNKNOWN_ACTION");
});
t("Admin commands persist, audit with the real identity, and totals reconcile through the Sheet", () => {
  const w = world();
  const r = cmd(w, w.admin, "createEntry", { date: "2026-02-01", memberId: memberWith.id, amount: 2500, type: "Savings", purpose: "t" });
  assert.ok(r.ok && r.changed);
  const back = w.call({ action: "getLedger", token: w.admin }).db;
  assert.equal(L.memberSavings(back, memberWith.id), L.memberSavings(db0, memberWith.id) + 2500);
  assert.ok(cmd(w, w.admin, "voidEntry", { id: r.result.id, reason: "test void" }).ok);
  const again = w.call({ action: "getLedger", token: w.admin }).db;
  assert.equal(L.memberSavings(again, memberWith.id), L.memberSavings(db0, memberWith.id));
  assert.ok(again.auditLog.some((a) => a.entityId === r.result.id && a.by === "ADMIN" && a.role === "Admin"));
  assert.equal(again.transactions.length, db0.transactions.length + 1, "voided, never deleted");
});
t("business rules hold server-side: blocked decisions stay blocked for Admin too", () => {
  const w = world(), id = db0.members.find((m) => !db0.loans.some((l) => l.memberId === m.id) && L.memberSavings(db0, m.id) > 0).id;
  const ap = cmd(w, w.admin, "applyForLoan", { memberId: id, amount: 10000 }); assert.ok(ap.ok);
  assert.match(cmd(w, w.admin, "approveLoan", { loanId: ap.result.id }).error, /PENDING_SOB_DECISION/);
  assert.match(cmd(w, w.admin, "createEntry", { date: "bad", memberId: id, amount: 5, type: "Savings" }).error, /INVALID/);
});
t("unknown future fields and nested values survive the Sheet round trip", () => {
  const env = newEnv(); const d = JSON.parse(JSON.stringify(db0)); d.transactions[0].futureField = { a: [1, 2] }; d.loans[0].interestHistory = [{ x: 1 }];
  S.writeAll(env.ss, d); const back = S.readAll(env.ss);
  assert.deepEqual(back.transactions[0].futureField, { a: [1, 2] }); assert.deepEqual(back.loans[0].interestHistory, [{ x: 1 }]);
  assert.equal(L.computeGroupTotals(back, AS_OF).groupSavings, L.computeGroupTotals(db0, AS_OF).groupSavings);
});
t("a write path can never delete ledger/audit records", () => {
  const env = newEnv(); S.writeAll(env.ss, db0);
  const bad = JSON.parse(JSON.stringify(db0)); bad.transactions.pop();
  assert.throws(() => S.guardNoLoss(S.readAll(env.ss), bad), /REJECTED/);
  const bad2 = JSON.parse(JSON.stringify(db0)); bad2.auditLog = []; assert.throws(() => S.guardNoLoss(S.readAll(env.ss), bad2), /REJECTED/);
});
t("bundled Code_Ledger.gs enforces the same rules in an Apps Script-like sandbox", () => {
  require("child_process").execSync("node " + path.join(__dirname, "../build/build-gs.js"));
  const ss = mockSS(), cache = {};
  const sandbox = { SpreadsheetApp: { getActiveSpreadsheet: () => ss }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) },
    Utilities: { DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 }, computeDigest: (a, s) => Array.from(crypto.createHash("sha256").update(s).digest()).map((b) => (b > 127 ? b - 256 : b)), getUuid: () => crypto.randomUUID() },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) }, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../dist/Code_Ledger.gs"), "utf8") + "\nthis.doPost=doPost;this.doGet=doGet;this.initAdmin=initAdmin;", sandbox);
  const call = (b) => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(b) } }).s);
  assert.equal(call({ action: "getLedger" }).error, "UNAUTHENTICATED");
  assert.equal(sandbox.initAdmin("ADMIN", "longpin-1"), "Admin created"); assert.throws(() => sandbox.initAdmin("ADMIN2", "longpin-2"), /already exists/);
  assert.equal(call({ action: "login", id: "ADMIN", pin: "nope" }).error, "BAD_CREDENTIALS");
  const tk = call({ action: "login", id: "ADMIN", pin: "longpin-1" }).token; assert.ok(tk);
  assert.ok(call({ action: "importSnapshot", token: tk, db: db0 }).ok);
  assert.ok(call({ action: "createUser", token: tk, user: { id: memberWith.id, role: "Member", memberId: memberWith.id, pin: "2468" } }).ok);
  const mt = call({ action: "login", id: memberWith.id, pin: "2468" }).token;
  assert.match(call({ action: "command", token: mt, name: "createEntry", args: { date: "2026-02-01", memberId: memberWith.id, amount: 1, type: "Savings" } }).error, /FORBIDDEN/);
  assert.ok(call({ action: "command", token: tk, name: "createEntry", args: { date: "2026-02-01", memberId: memberWith.id, amount: 1, type: "Savings" } }).ok);
  assert.equal(JSON.parse(sandbox.doPost({ postData: { contents: "not json" } }).s).error, "INVALID_REQUEST");
  assert.equal(JSON.parse(sandbox.doGet().s).ok, true);
});
(async () => { for (const [n, f] of tests) { try { await f(); console.log("  ok  " + n); } catch (e) { failed++; console.log("FAIL  " + n + "\n      " + (e.stack || e.message).split("\n").slice(0, 3).join("\n      ")); } } console.log(failed ? failed + " FAILED" : tests.length + " backend tests passed"); if (failed) process.exitCode = 1; })();
