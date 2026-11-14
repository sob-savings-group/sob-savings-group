/* A member creates their own password: SOB ID + the phone number on record, once, with the shared lock-out. */
const assert = require("assert"), crypto = require("crypto"), A = require("../src/backend/auth.js");
const store = {}; let n = 0;
const env = { hash: (s) => crypto.createHash("sha256").update(s).digest("hex"), randomToken: () => crypto.randomBytes(6).toString("hex") + (++n), cache: { get: (k) => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; }, remove: (k) => { delete store[k]; } } };
const mk = (id, pin, mc) => A.makeUser(env, { id, role: "Member", memberId: id, name: id, pin, mustChange: mc });
const db = { members: [{ id: "SOB-001", name: "Aaron", phone: "0772 123 456", status: "Active" }, { id: "SOB-002", name: "Grace", phone: "", status: "Active" }, { id: "SOB-003", name: "Peter", phone: "0701000333", status: "Inactive" }],
  users: [mk("SOB-001", "123456", true), mk("SOB-002", "222222", true), mk("SOB-003", "333333", true)] };
const code = (r) => String(r.error).split(":")[0]; let ok = 0; const t = (_, f) => { f(); ok++; };
t("wrong phone is refused with a generic message", () => assert.strictEqual(code(A.claim(env, db, "SOB-001", "0700000000", "mypass1")), "NOT_VERIFIED"));
t("member without a phone on record cannot self-set", () => assert.strictEqual(code(A.claim(env, db, "SOB-002", "", "mypass1")), "NOT_VERIFIED"));
t("inactive member is stopped", () => assert.strictEqual(code(A.claim(env, db, "SOB-003", "+256701000333", "mypass1")), "MEMBER_INACTIVE"));
t("short password refused and nothing changes", () => { assert.strictEqual(code(A.claim(env, db, "SOB-001", "0772123456", "abc")), "WEAK_PIN"); assert.strictEqual(A.login(env, db, "SOB-001", "123456").ok, true); });
t("right ID + phone (any format) sets the password and signs in", () => { const r = A.claim(env, db, "SOB-001", "+256 772-123-456", "mypass1"); assert.ok(r.ok && r.token && !r.user.mustChangePin); assert.strictEqual(A.login(env, db, "SOB-001", "mypass1").ok, true); assert.strictEqual(A.login(env, db, "SOB-001", "123456").ok, false); });
t("cannot be repeated once set (no takeover by someone who knows the phone)", () => assert.strictEqual(code(A.claim(env, db, "SOB-001", "0772123456", "hijack1")), "ALREADY_SET"));
t("repeated wrong guesses lock the account", () => { for (let i = 0; i < 5; i++) A.claim(env, db, "SOB-002", "0799999999", "xxxxxx"); assert.strictEqual(code(A.claim(env, db, "SOB-002", "0799999999", "xxxxxx")), "LOCKED"); });
console.log(ok + " self-service password tests passed");
