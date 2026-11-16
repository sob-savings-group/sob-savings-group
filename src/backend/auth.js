/* SOB backend/auth — server-side identity. PINs are stored only as salted, stretched SHA-256 hashes; sessions are random tokens held
   server-side (only a hash of the token is stored); failed logins lock an account. The role ALWAYS comes from the Users sheet at request
   time, never from the client, so a role change or deactivation takes effect immediately. env: {hash(str)->hex, randomToken(), cache, now(), rand()} */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory();
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.auth = api; }
})(typeof self !== "undefined" ? self : this, function () {
  const ROUNDS = 300, MAX_FAILS = 5, LOCK_SECONDS = 900, SESSION_SECONDS = 6 * 3600;
  const ROLES = ["Admin", "Chairperson", "Treasurer", "Secretary", "Committee", "Member"];  // Admin = Super Admin
  const MIN_PIN = { Admin: 6, Chairperson: 6, Treasurer: 6, Secretary: 6, Committee: 6, Member: 4 };
  const MIN_OWN = 6;   // a password a member creates for themselves
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
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/g, " ").trim();
  /* A registered FULL name that belongs to exactly one active member identifies that member (view-only, same as ID + name). */
  function memberByFullName(db, text) {
    const q = norm(text); if (q.length < 5) return null;
    const hits = (db.users || []).filter((u) => u.role === "Member" && u.status !== "Disabled" && (norm(u.name) === q || norm(((db.members || []).find((m) => m.id === u.memberId) || {}).name) === q));
    return hits.length === 1 ? hits[0] : null;
  }
  /* A member's recorded status decides whether they may enter AFTER their identity is verified (never before, so nothing is revealed to a stranger). */
  const statusKind = (st) => { const x = String(st || "").trim(); return /^pending/i.test(x) ? "pending" : /^(inactive|restricted|suspended|closed|blocked|disabled)/i.test(x) ? "inactive" : null; };
  const memberNameMatches = (m, given) => { const g = String(given || "").trim().toLowerCase(); return !!m && g.length >= 3 && /[a-z]/.test(g) && tokens(m.name).includes(g); };
  const blockedError = (kind) => ({ ok: false, error: kind === "pending" ? "MEMBER_PENDING: membership pending approval" : "MEMBER_INACTIVE: account inactive or restricted" });
  /* Officer sign-in by role name: "ADMIN", "CHAIR", "TREASURER", "SECRETARY" (and the short forms) reach the officer holding that role even if the stored Staff ID is spelled differently.
     Only when exactly ONE active user holds the role. The PIN is still required, so this opens nothing by itself. */
  const ALIAS = { ADMIN: "Admin", ADMINISTRATOR: "Admin", SUPERADMIN: "Admin", CHAIR: "Chairperson", CHAIRPERSON: "Chairperson", CHAIRMAN: "Chairperson", TREAS: "Treasurer", TREASURER: "Treasurer", SEC: "Secretary", SECR: "Secretary", SECRETARY: "Secretary" };
  function roleAlias(db, id) {
    const role = ALIAS[String(id || "").toUpperCase().replace(/[^A-Z]/g, "")]; if (!role) return null;
    const hits = (db.users || []).filter((u) => u.role === role && u.status !== "Disabled"); return hits.length === 1 ? hits[0] : null;
  }
  function login(env, db, id, pin) {
    const k = "fail:" + String(id || "").toUpperCase();
    const fails = Number(env.cache.get(k) || 0);
    if (fails >= MAX_FAILS) return { ok: false, error: "LOCKED: too many failed attempts, try again in 15 minutes" };
    let u = findUser(db, id) || roleAlias(db, id), byName = false;
    if (!u) { u = memberByFullName(db, id); byName = !!u; }
    /* identity is verified here: PIN, or the SOB ID + one of the member's own names (the same trust as the view-only sign-in) */
    if (!u) {
      const mm = (db.members || []).find((x) => String(x.id).toUpperCase() === String(id || "").trim().toUpperCase()), kind = mm && statusKind(mm.status);
      if (kind && memberNameMatches(mm, pin)) { env.cache.remove(k); return blockedError(kind); }
      const any = (db.users || []).find((x) => String(x.id).toUpperCase() === String(id || "").trim().toUpperCase() && x.role === "Member" && x.status === "Disabled");
      if (any && any.pinHash && safeEq(stretch(env, any.salt, String(pin || "")), any.pinHash)) { env.cache.remove(k); return blockedError("inactive"); }
      env.cache.put(k, fails + 1, LOCK_SECONDS); return { ok: false, error: "BAD_CREDENTIALS" };
    }
    const good = u && u.pinHash && safeEq(stretch(env, u.salt, String(pin || "")), u.pinHash);
    /* Members may also sign in with their SOB ID + any ONE of their names (first or last). That is a VIEW-ONLY session (names are not secret):
       statements and balances yes; guarantee acceptance, airtime, PIN changes etc. need the PIN. Staff roles always need their PIN. */
    const viaName = !good && u && u.role === "Member" && (byName ? norm(pin) === norm(id) : nameMatches(db, u, pin));
    if (!good && !viaName) { env.cache.put(k, fails + 1, LOCK_SECONDS); return { ok: false, error: "BAD_CREDENTIALS" }; }
    env.cache.remove(k);
    if (u.role === "Member") { const kind = statusKind(((db.members || []).find((x) => x.id === u.memberId) || {}).status); if (kind) return blockedError(kind); }
    const token = env.randomToken() + env.randomToken();
    env.cache.put("sess:" + env.hash(token), u.id, SESSION_SECONDS);
    if (viaName) { env.cache.put("ro:" + env.hash(token), "1", SESSION_SECONDS); return { ok: true, token, user: Object.assign(publicUser(u), { mustChangePin: false, readOnly: true }) }; }
    return { ok: true, token, user: publicUser(u) };
  }
  /* SELF-SERVICE PASSWORD. A member whose account still has an officer-issued temporary PIN proves who they are with the SOB ID + the phone number
     on record, then chooses their own password. Refused once the member has made their own (an officer's reset re-opens it). Shares the sign-in lock-out. */
  const digits = (x) => String(x || "").replace(/\D+/g, "");
  const samePhone = (a, b) => { a = digits(a); b = digits(b); return a.length >= 9 && b.length >= 9 && a.slice(-9) === b.slice(-9); };
  function claim(env, db, id, phone, newPassword) {
    const k = "fail:" + String(id || "").toUpperCase(), fails = Number(env.cache.get(k) || 0);
    if (fails >= MAX_FAILS) return { ok: false, error: "LOCKED: too many failed attempts, try again in 15 minutes" };
    const u = findUser(db, id), m = u && u.role === "Member" && (db.members || []).find((x) => x.id === u.memberId);
    const phones = u ? [u.phone, m && m.phone, m && m.contact].filter(Boolean) : [];
    if (!u || u.role !== "Member" || !phones.some((p) => samePhone(p, phone))) { env.cache.put(k, fails + 1, LOCK_SECONDS); return { ok: false, error: "NOT_VERIFIED: we could not match that SOB ID and phone number" }; }
    const kind = statusKind(m && m.status); if (kind) return blockedError(kind);
    if (!(u.mustChange === true || u.mustChange === "true")) return { ok: false, error: "ALREADY_SET: you already created a password. Sign in, or ask an officer to reset it" };
    if (String(newPassword || "").length < MIN_OWN) return { ok: false, error: "WEAK_PIN: use at least " + MIN_OWN + " characters" };
    u.salt = env.randomToken(); u.pinHash = stretch(env, u.salt, String(newPassword)); delete u.mustChange;
    env.cache.remove(k);
    const token = env.randomToken() + env.randomToken(); env.cache.put("sess:" + env.hash(token), u.id, SESSION_SECONDS);
    return { ok: true, token, user: publicUser(u), updated: u };
  }
  /* ADMIN PIN recovery. Pure rule, called only from the Apps Script editor (never from the web app). It can change ONE thing: the PIN of the single Super Admin.
     It has no user-id parameter, so it cannot be pointed at the Chairperson, Treasurer, a member or anyone else. Returns the updated users list; the caller audits and saves. */
  function recoverAdminPin(env, users, pin) {
    pin = String(pin || "");
    if (pin.length < MIN_PIN.Admin) throw new Error("WEAK_PIN: the new PIN must be at least " + MIN_PIN.Admin + " characters");
    const admins = (users || []).filter((u) => u.role === "Admin");
    if (admins.length !== 1) throw new Error("REFUSED: recovery works only when there is exactly one Super Admin (found " + admins.length + ")");
    const u = admins[0], fresh = makeUser(env, { id: u.id, name: u.name, role: "Admin", pin });
    const out = (users || []).map((x) => (x === u ? Object.assign({}, x, { salt: fresh.salt, pinHash: fresh.pinHash, mustChange: false, status: "Active" }) : x));
    if (env.cache && env.cache.remove) env.cache.remove("fail:" + String(u.id).toUpperCase());      // lift any lock-out
    return { users: out, adminId: u.id };
  }
  function session(env, db, token) {
    if (!token || typeof token !== "string") return null;
    const id = env.cache.get("sess:" + env.hash(token)); if (!id) return null;
    const u = findUser(db, id); if (!u) return null;
    if (u.role === "Member" && statusKind(((db.members || []).find((x) => x.id === u.memberId) || {}).status)) return null;   // a member made inactive/restricted after sign-in is cut off at once
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
  return { roleAlias, ROLES, MIN_PIN, makeUser, login, session, logout, setPin, claim, publicUser, findUser, recoverAdminPin };
});
