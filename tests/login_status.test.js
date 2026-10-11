/* Member sign-in: a verified member's recorded status decides access, with the exact wording; a stranger learns nothing. */
const assert = require("assert"), crypto = require("crypto"), A = require("../src/backend/auth.js");
const store = {}; let n = 0;
const env = { hash: (s) => crypto.createHash("sha256").update(s).digest("hex"), randomToken: () => crypto.randomBytes(6).toString("hex") + (++n), cache: { get: (k) => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; }, remove: (k) => { delete store[k]; } } };
const mk = (id, memberId, pin, extra) => Object.assign(A.makeUser(env, { id, role: "Member", memberId, name: id, pin }), extra || {});
const db = { members: [{ id: "SOB-001", name: "Aaron Mukasa", status: "Active" }, { id: "SOB-002", name: "Grace Namutebi", status: "Inactive" }, { id: "SOB-003", name: "Peter Ssemwogerere", status: "Pending" }, { id: "SOB-004", name: "Ruth Nakato", status: "Restricted" }, { id: "SOB-005", name: "Moses Okello", status: "Active" }],
  users: [mk("SOB-001", "SOB-001", "1111"), mk("SOB-002", "SOB-002", "2222"), mk("SOB-004", "SOB-004", "4444"), mk("SOB-005", "SOB-005", "5555", { status: "Disabled" }), A.makeUser(env, { id: "CHAIR", role: "Chairperson", name: "Chair", pin: "chair-pin-1" })] };
const err = (r) => String(r.error).split(":")[0];
let ok = 0; const t = (name, f) => { f(); ok++; };
t("active member with the right PIN signs in", () => assert.strictEqual(A.login(env, db, "SOB-001", "1111").ok, true));
t("active member with ID + own first name signs in (view only)", () => { const r = A.login(env, db, "SOB-001", "Aaron"); assert.ok(r.ok && r.user.readOnly); });
t("wrong PIN, unknown ID, wrong name: all the same generic failure", () => { ["SOB-001|9999", "SOB-777|1111", "SOB-003|Nobody", "SOB-002|2223"].forEach((x) => { const [i, p] = x.split("|"); assert.strictEqual(err(A.login(env, db, i, p)), "BAD_CREDENTIALS"); }); });
t("verified INACTIVE member (PIN) is told so; the PIN is not accepted into a session", () => { const r = A.login(env, db, "SOB-002", "2222"); assert.strictEqual(err(r), "MEMBER_INACTIVE"); assert.ok(!r.token); });
t("verified INACTIVE member (ID + name) is told so", () => assert.strictEqual(err(A.login(env, db, "SOB-002", "Grace")), "MEMBER_INACTIVE"));
t("verified RESTRICTED member is told so", () => assert.strictEqual(err(A.login(env, db, "SOB-004", "4444")), "MEMBER_INACTIVE"));
t("verified PENDING member (no sign-in yet) is told so, only after ID + own name match", () => { assert.strictEqual(err(A.login(env, db, "SOB-003", "Peter")), "MEMBER_PENDING"); assert.strictEqual(err(A.login(env, db, "SOB-003", "Wrong")), "BAD_CREDENTIALS"); });
t("a disabled sign-in with the right PIN is told it is inactive; with the wrong PIN it learns nothing", () => { assert.strictEqual(err(A.login(env, db, "SOB-005", "5555")), "MEMBER_INACTIVE"); assert.strictEqual(err(A.login(env, db, "SOB-005", "0000")), "BAD_CREDENTIALS"); });
t("staff sign-in is unchanged", () => { assert.strictEqual(A.login(env, db, "CHAIR", "chair-pin-1").ok, true); assert.strictEqual(err(A.login(env, db, "CHAIR", "nope")), "BAD_CREDENTIALS"); });
t("a member made inactive after signing in loses the session immediately", () => { const r = A.login(env, db, "SOB-001", "1111"); assert.ok(A.session(env, db, r.token)); db.members[0].status = "Inactive"; assert.strictEqual(A.session(env, db, r.token), null); db.members[0].status = "Active"; });
console.log(ok + " login status tests passed");
