/* SOB backend/auth — server-side identity. PINs are stored only as salted, stretched SHA-256 hashes; sessions are random tokens held
   server-side (only a hash of the token is stored); failed logins lock an account. The role ALWAYS comes from the Users sheet at request
   time, never from the client, so a role change or deactivation takes effect immediately. env: {hash(str)->hex, randomToken(), cache, now(), rand()} */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory();
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.auth = api; }
})(typeof self !== "undefined" ? self : this, function () {
  const ROUNDS = 300, MAX_FAILS = 5, LOCK_SECONDS = 900, SESSION_SECONDS = 6 * 3600;
  const ROLES = ["Admin", "Chairperson", "Treasurer", "Committee", "Member"];  // Admin = Super Admin
  const MIN_PIN = { Admin: 6, Chairperson: 6, Treasurer: 6, Committee: 6, Member: 4 };
  function stretch(env, salt, pin) { let h = salt + ":" + pin; for (let i = 0; i < ROUNDS; i++) h = env.hash(h + salt); return h; }
  const safeEq = (a, b) => { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };
  const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role, memberId: u.memberId || null, mustChangePin: u.mustChange === true || u.mustChange === "true" });
  const findUser = (db, id) => (db.users || []).find((u) => String(u.id).toUpperCase() === String(id || "").trim().toUpperCase() && u.status !== "Disabled");

  function makeUser(env, o) {
    if (!ROLES.includes(o.role)) throw new Error("INVALID: role");
    if (o.role === "Member" && !o.memberId) throw new Error("INVALID: member users need a memberId");
    const pin = String(o.pin || ""); if (pin.length < MIN_PIN[o.role]) throw new Error("WEAK_PIN: PIN must be at least " + MIN_PIN[o.role] + " characters for " + o.role);
    const salt = env.randomToken();
    const u = { id: o.id, name: o.name || o.id, role: o.role, memberId: o.memberId || "", phone: o.phone || "", status: "Active", salt, pinHash: stretch(env, salt, pin) };
    if (o.mustChange) u.mustChange = true;
    return u;
  }
  const tokens = (n) => String(n || "").toLowerCase().split(/[^a-z\u00c0-\u024f]+/).filter((x) => x.length >= 3);
  function nameMatches(db, u, given) {
    const g = String(given || "").trim().toLowerCase(); if (g.length < 3 || !/[a-z]/.test(g)) return false;
    const m = (db.members || []).find((x) => x.id === u.memberId);
    return tokens(u.name).concat(tokens(m && m.name)).includes(g);
  }
  function login(env, db, id, pin) {
    const k = "fail:" + String(id || "").toUpperCase();
    const fails = Number(env.cache.get(k) || 0);
    if (fails >= MAX_FAILS) return { ok: false, error: "LOCKED: too many failed attempts, try again in 15 minutes" };
    const u = findUser(db, id);
    const good = u && u.pinHash && safeEq(stretch(env, u.salt, String(pin || "")), u.pinHash);
    /* Members may also sign in with their SOB ID + any ONE of their names (first or last). That is a VIEW-ONLY session (names are not secret):
       statements and balances yes; guarantee acceptance, airtime, PIN changes etc. need the PIN. Staff roles always need their PIN. */
    const viaName = !good && u && u.role === "Member" && nameMatches(db, u, pin);
    if (!good && !viaName) { env.cache.put(k, fails + 1, LOCK_SECONDS); return { ok: false, error: "BAD_CREDENTIALS" }; }
    env.cache.remove(k);
    const token = env.randomToken() + env.randomToken();
    env.cache.put("sess:" + env.hash(token), u.id, SESSION_SECONDS);
    if (viaName) { env.cache.put("ro:" + env.hash(token), "1", SESSION_SECONDS); return { ok: true, token, user: Object.assign(publicUser(u), { mustChangePin: false, readOnly: true }) }; }
    return { ok: true, token, user: publicUser(u) };
  }
  function session(env, db, token) {
    if (!token || typeof token !== "string") return null;
    const id = env.cache.get("sess:" + env.hash(token)); if (!id) return null;
    const u = findUser(db, id); if (!u) return null;
    const ro = !!env.cache.get("ro:" + env.hash(token)); return ro ? Object.assign(publicUser(u), { mustChangePin: false, readOnly: true }) : publicUser(u);
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
    if (actor.id === t.id && oldPin !== undefined && String(newPin) === String(oldPin)) throw new Error("WEAK_PIN: choose a PIN different from the current one");
    t.salt = env.randomToken(); t.pinHash = stretch(env, t.salt, String(newPin));
    if (actor.id === t.id) delete t.mustChange; else t.mustChange = true;   // changed by its owner: private again; set by someone else: owner must change it
    return t;
  }
  return { ROLES, MIN_PIN, makeUser, login, session, logout, setPin, publicUser, findUser };
});
