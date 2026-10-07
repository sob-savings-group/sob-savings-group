/* SOB backend/api — the ONLY entry to the ledger. Every action except login needs a valid server-side session; the role comes from the
   Users sheet; changes happen only through the closed command whitelist (core/commands) run with a server-built ctx; reads are filtered
   by role. There is no "write a whole snapshot" path for ordinary users. env: {ss, lock, now, hash, randomToken, cache} */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./store.js") : root.SOB.store, isNode ? require("./auth.js") : root.SOB.auth, isNode ? require("../core/commands.js") : root.SOB.commands,
    isNode ? require("../core/kpis.js") : root.SOB.kpis, isNode ? require("../core/dates.js") : root.SOB.dates, isNode ? require("../core/governance.js") : root.SOB.gov);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.api = api; }
})(typeof self !== "undefined" ? self : this, function (S, A, CMD, K, D, G) {
  const fail = (error) => ({ ok: false, error });
  const strip = (o, keys) => { const c = Object.assign({}, o); keys.forEach((k) => delete c[k]); return c; };

  /* What a signed-in user is allowed to SEE. Staff: the ledger (never credentials). Member: only their own records. */
  function viewFor(db, user, asOf) {
    const base = { schemaVersion: db.schemaVersion, revision: db.revision };
    if (user.role === "Admin" || user.role === "Committee") {
      const full = Object.assign({}, base, db, { users: user.role === "Admin" ? (db.users || []).map(A.publicUser) : [] });
      if (user.role !== "Admin") full.auditLog = G.can({ role: user.role }, "audit.view") ? db.auditLog : [];
      full.kpis = K.dashboard(db, asOf); full.pipeline = K.pipeline(db); return full;
    }
    const me = user.memberId;
    const mine = (db.loans || []).filter((l) => l.memberId === me);
    const guaranteed = (db.guarantees || []).filter((g) => g.guarantorId === me);
    const guaranteedLoans = (db.loans || []).filter((l) => guaranteed.some((g) => g.loanId === l.id) && l.memberId !== me);
    const loans = mine.concat(guaranteedLoans);
    return Object.assign({}, base, {
      members: (db.members || []).map((m) => (m.id === me ? m : { id: m.id, name: m.name, status: m.status })),
      transactions: (db.transactions || []).filter((t) => t.memberId === me || mine.some((l) => l.id === t.loanId)),
      loans, guarantees: (db.guarantees || []).filter((g) => g.guarantorId === me || mine.some((l) => l.id === g.loanId)),
      yearCycles: db.yearCycles || [], shareOutEvents: [], profitDistributions: [], auditLog: [], users: [], requests: [], airtimeRequests: [], reconciliations: [], smsFailures: [], legacyAdministration: []
    });
  }

  function handle(env, body) {
    if (!body || typeof body !== "object") return fail("INVALID_REQUEST");
    try {
      if (body.action === "ping") return { ok: true, pong: true };
      if (body.action === "login") return A.login(env, { users: S.readCollection(env.ss, "users") }, body.id, body.pin);
      const usersDb = { users: S.readCollection(env.ss, "users") };
      const user = A.session(env, usersDb, body.token);
      if (!user) return fail("UNAUTHENTICATED");
      const asOf = D.todayISO();

      if (body.action === "logout") { A.logout(env, body.token); return { ok: true }; }
      if (body.action === "whoami") return { ok: true, user };
      if (body.action === "getLedger") { const db = S.readAll(env.ss); return { ok: true, user, db: viewFor(db, user, asOf) }; }

      if (body.action === "command") {
        env.lock.waitLock(20000);
        try {
          const db = S.readAll(env.ss);
          const ctx = G.makeCtx({ id: user.id, name: user.name, role: user.role, memberId: user.memberId });  // identity from the SESSION only
          const before = JSON.stringify([db.transactions.length, db.loans.length, db.members.length, db.auditLog.length]);
          const result = CMD.run(db, ctx, body.name, body.args);
          S.guardNoLoss(env.ss, db);
          S.writeAll(env.ss, db);
          const rev = Number(S.readMeta(env.ss).revision || 0) + 1;
          S.writeMeta(env.ss, { revision: rev, schemaVersion: db.schemaVersion || 2, seq: db.seq || 0, lastWrite: env.now() });
          db.revision = rev;
          return { ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result)), db: viewFor(db, user, asOf), changed: before !== JSON.stringify([db.transactions.length, db.loans.length, db.members.length, db.auditLog.length]) };
        } finally { env.lock.releaseLock(); }
      }

      if (body.action === "setPin") {   // self-service (old PIN needed) or Admin for anyone
        env.lock.waitLock(20000);
        try {
          const users = S.readCollection(env.ss, "users");
          const t = A.setPin(env, { users }, user, body.userId || user.id, body.newPin, body.oldPin);
          S.writeCollection(env.ss, "users", users); return { ok: true, id: t.id };
        } finally { env.lock.releaseLock(); }
      }
      if (body.action === "createUser") {   // Admin only
        if (user.role !== "Admin") return fail("FORBIDDEN: only Admin may create users");
        env.lock.waitLock(20000);
        try {
          const users = S.readCollection(env.ss, "users"); const o = body.user || {};
          if (A.findUser({ users }, o.id)) return fail("EXISTS: user id already used");
          if (o.role === "Member" && !S.readCollection(env.ss, "members").some((m) => m.id === o.memberId)) return fail("UNKNOWN_MEMBER");
          users.push(A.makeUser(env, o)); S.writeCollection(env.ss, "users", users); return { ok: true };
        } finally { env.lock.releaseLock(); }
      }
      if (body.action === "disableUser") {
        if (user.role !== "Admin") return fail("FORBIDDEN: only Admin may disable users");
        env.lock.waitLock(20000);
        try { const users = S.readCollection(env.ss, "users"); const t = users.find((u) => u.id === body.userId); if (!t) return fail("NOT_FOUND");
          if (t.id === user.id) return fail("INVALID: you cannot disable yourself"); t.status = "Disabled"; S.writeCollection(env.ss, "users", users); return { ok: true }; }
        finally { env.lock.releaseLock(); }
      }
      /* One-time migration: Admin only, and only into an EMPTY ledger. Never available once data exists. */
      if (body.action === "importSnapshot") {
        if (user.role !== "Admin") return fail("FORBIDDEN: only Admin may import");
        env.lock.waitLock(20000);
        try {
          const cur = S.readAll(env.ss);
          if (cur.transactions.length || cur.loans.length || cur.members.length) return fail("NOT_EMPTY: import is only allowed into an empty ledger");
          if (!body.db) return fail("INVALID: db missing");
          S.writeAll(env.ss, body.db); S.writeMeta(env.ss, { revision: 1, schemaVersion: body.db.schemaVersion || 2, seq: body.db.seq || 0, lastWrite: env.now() });
          return { ok: true, revision: 1 };
        } finally { env.lock.releaseLock(); }
      }
      return fail("UNKNOWN_ACTION");
    } catch (e) { return fail(String((e && e.message) || e)); }
  }
  return { handle, viewFor };
});
