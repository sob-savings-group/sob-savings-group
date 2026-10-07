/* SOB backend/auth — server-side identity. PINs are stored only as salted, stretched SHA-256 hashes; sessions are random tokens held
   server-side (only a hash of the token is stored); failed logins lock an account. The role ALWAYS comes from the Users sheet at request
   time, never from the client, so a role change or deactivation takes effect immediately. env: {hash(str)->hex, randomToken(), cache, now(), rand()} */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory();
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.auth = api; }
})(typeof self !== "undefined" ? self : this, function () {
  const ROUNDS = 300, MAX_FAILS = 5, LOCK_SECONDS = 900, SESSION_SECONDS = 6 * 3600;
  const ROLES = ["Admin", "Committee", "Member"];
  const MIN_PIN = { Admin: 6, Committee: 6, Member: 4 };
  function stretch(env, salt, pin) { let h = salt + ":" + pin; for (let i = 0; i < ROUNDS; i++) h = env.hash(h + salt); return h; }
  const safeEq = (a, b) => { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };
  const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role, memberId: u.memberId || null });
  const findUser = (db, id) => (db.users || []).find((u) => String(u.id).toUpperCase() === String(id || "").trim().toUpperCase() && u.status !== "Disabled");

  function makeUser(env, o) {
    if (!ROLES.includes(o.role)) throw new Error("INVALID: role");
    if (o.role === "Member" && !o.memberId) throw new Error("INVALID: member users need a memberId");
    const pin = String(o.pin || ""); if (pin.length < MIN_PIN[o.role]) throw new Error("WEAK_PIN: PIN must be at least " + MIN_PIN[o.role] + " characters for " + o.role);
    const salt = env.randomToken();
    return { id: o.id, name: o.name || o.id, role: o.role, memberId: o.memberId || "", phone: o.phone || "", status: "Active", salt, pinHash: stretch(env, salt, pin) };
  }
  function login(env, db, id, pin) {
    const k = "fail:" + String(id || "").toUpperCase();
    const fails = Number(env.cache.get(k) || 0);
    if (fails >= MAX_FAILS) return { ok: false, error: "LOCKED: too many failed attempts, try again in 15 minutes" };
    const u = findUser(db, id);
    const good = u && u.pinHash && safeEq(stretch(env, u.salt, String(pin || "")), u.pinHash);
    if (!good) { env.cache.put(k, fails + 1, LOCK_SECONDS); return { ok: false, error: "BAD_CREDENTIALS" }; }
    env.cache.remove(k);
    const token = env.randomToken() + env.randomToken();
    env.cache.put("sess:" + env.hash(token), u.id, SESSION_SECONDS);
    return { ok: true, token, user: publicUser(u) };
  }
  function session(env, db, token) {
    if (!token || typeof token !== "string") return null;
    const id = env.cache.get("sess:" + env.hash(token)); if (!id) return null;
    const u = findUser(db, id); return u ? publicUser(u) : null;
  }
  function logout(env, token) { if (token) env.cache.remove("sess:" + env.hash(token)); }
  /* Returns the updated user record (caller persists). Admin may set anyone's PIN; everyone may change their own (old PIN required). */
  function setPin(env, db, actor, targetId, newPin, oldPin) {
    const t = findUser(db, targetId); if (!t) throw new Error("NOT_FOUND: user");
    if (actor.role !== "Admin") {
      if (actor.id !== t.id) throw new Error("FORBIDDEN: you may only change your own PIN");
      if (!safeEq(stretch(env, t.salt, String(oldPin || "")), t.pinHash)) throw new Error("BAD_CREDENTIALS: current PIN is wrong");
    }
    if (String(newPin || "").length < MIN_PIN[t.role]) throw new Error("WEAK_PIN: PIN must be at least " + MIN_PIN[t.role] + " characters for " + t.role);
    t.salt = env.randomToken(); t.pinHash = stretch(env, t.salt, String(newPin)); return t;
  }
  return { ROLES, MIN_PIN, makeUser, login, session, logout, setPin, publicUser, findUser };
});
