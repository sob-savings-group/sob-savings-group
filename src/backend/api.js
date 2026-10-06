/* SOB backend/api — request handling (auth, locking, optimistic concurrency, server-computed KPIs). Environment is injected
   (`env`: {ss, lock, secret, now, log}) so it runs unchanged in Apps Script and in tests. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./store.js") : root.SOB.store, isNode ? require("../core/kpis.js") : root.SOB.kpis, isNode ? require("../core/dates.js") : root.SOB.dates);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.api = api; }
})(typeof self !== "undefined" ? self : this, function (S, K, D) {
  function handle(env, body) {
    if (!body || !env.secret || body.key !== env.secret) return { ok: false, error: "UNAUTHORIZED" };
    try {
      if (body.action === "ping") return { ok: true, pong: true };
      if (body.action === "getLedger") {
        const db = S.readAll(env.ss);
        return { ok: true, db, kpis: K.dashboard(db, D.todayISO()), pipeline: K.pipeline(db) };
      }
      if (body.action === "syncAll") {
        if (!body.db) return { ok: false, error: "INVALID: db missing" };
        env.lock.waitLock(20000);
        try {
          const meta = S.readMeta(env.ss), rev = Number(meta.revision || 0);
          if (body.baseRevision !== undefined && Number(body.baseRevision) !== rev) return { ok: false, error: "CONFLICT", revision: rev };
          S.guardNoLoss(env.ss, body.db);
          S.writeAll(env.ss, body.db);
          S.writeMeta(env.ss, { revision: rev + 1, schemaVersion: body.db.schemaVersion || 2, seq: body.db.seq || 0, lastWrite: env.now() });
          return { ok: true, revision: rev + 1 };
        } finally { env.lock.releaseLock(); }
      }
      return { ok: false, error: "UNKNOWN_ACTION" };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }
  return { handle };
});
