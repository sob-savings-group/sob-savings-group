/* SOB client/store — cache-then-sync data access. fetch/storage are injected (browser: window.fetch/localStorage; tests: fakes).
   The local copy is only a cache: the Sheet is the source of truth, and writes carry baseRevision so concurrent edits are detected. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory();
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.client = api; }
})(typeof self !== "undefined" ? self : this, function () {
  function create(opts) {
    const o = Object.assign({ url: "", key: "", cacheKey: "sob.ledger.v2", fetch: null, storage: null }, opts);
    let db = null, revision = 0, status = "idle", listeners = [];
    const emit = () => listeners.forEach((f) => f({ status, revision }));
    const cache = { get() { try { return o.storage && JSON.parse(o.storage.getItem(o.cacheKey)); } catch (e) { return null; } },
      set(v) { try { o.storage && o.storage.setItem(o.cacheKey, JSON.stringify(v)); } catch (e) { /* quota/private mode: cache is optional */ } } };
    async function call(body) {
      if (!o.url) throw new Error("OFFLINE_MODE");
      const r = await o.fetch(o.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ key: o.key }, body)) });
      const j = await r.json(); if (!j.ok) { const e = new Error(j.error || "REQUEST_FAILED"); e.code = j.error; e.payload = j; throw e; } return j;
    }
    return {
      onChange(f) { listeners.push(f); },
      get db() { return db; }, get revision() { return revision; }, get status() { return status; },
      /* Show the cached ledger immediately, then replace it with the server copy. */
      async load() {
        const c = cache.get(); if (c && c.db) { db = c.db; revision = c.revision || 0; status = "cached"; emit(); }
        try { status = "syncing"; emit(); const j = await call({ action: "getLedger" }); db = j.db; revision = j.db.revision || 0; cache.set({ db, revision }); status = "synced"; emit(); return { source: "server" }; }
        catch (e) { status = db ? "offline-cache" : "error"; emit(); if (!db) throw e; return { source: "cache", error: e.code || e.message }; }
      },
      /* Persist after a mutation. CONFLICT => caller must reload and retry; nothing is overwritten. */
      async save() {
        cache.set({ db, revision });
        try { status = "saving"; emit(); const j = await call({ action: "syncAll", db, baseRevision: revision }); revision = j.revision; db.revision = revision; cache.set({ db, revision }); status = "synced"; emit(); return { ok: true }; }
        catch (e) { status = e.code === "CONFLICT" ? "conflict" : "unsaved"; emit(); throw e; }
      },
      setDb(next) { db = next; cache.set({ db, revision }); },
      /* Run a ledger mutation, then persist; roll the in-memory copy back if the save is rejected. */
      async mutate(fn) {
        const before = JSON.stringify(db); const res = fn(db);
        try { await this.save(); return res; } catch (e) { if (e.code === "CONFLICT" || e.code) { db = JSON.parse(before); cache.set({ db, revision }); } throw e; }
      }
    };
  }
  return { create };
});
