/* SOB client/store — talks to the server only through login + getLedger + command. The browser holds a session token (in memory, and
   sessionStorage so a refresh keeps you signed in until the tab closes) and a role-filtered copy of the ledger. Nothing here grants
   access: the server decides who can see or change what. The ledger is deliberately NOT cached in localStorage (shared phones). */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory();
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.client = api; }
})(typeof self !== "undefined" ? self : this, function () {
  function create(opts) {
    const o = Object.assign({ url: "", fetch: null, session: null, tokenKey: "sob.session" }, opts);
    let token = null, user = null, db = null, status = "idle"; const listeners = [];
    const emit = () => listeners.forEach((f) => f({ status, user }));
    const keep = { get() { try { return o.session && o.session.getItem(o.tokenKey); } catch (e) { return null; } }, set(v) { try { if (o.session) v ? o.session.setItem(o.tokenKey, v) : o.session.removeItem(o.tokenKey); } catch (e) { /* optional */ } } };
    async function call(body) {
      if (!o.url) throw new Error("OFFLINE_MODE");
      const r = await o.fetch(o.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ token }, body)) });
      const j = await r.json();
      if (!j.ok) { if (j.error === "UNAUTHENTICATED") { token = null; user = null; keep.set(null); status = "signed-out"; emit(); } const e = new Error(j.error || "REQUEST_FAILED"); e.code = String(j.error || "").split(":")[0]; throw e; }
      return j;
    }
    return {
      onChange(f) { listeners.push(f); },
      get db() { return db; }, get user() { return user; }, get status() { return status; }, get signedIn() { return !!token; },
      async login(id, pin) { const j = await call({ action: "login", id, pin }); token = j.token; user = j.user; keep.set(token); status = "signed-in"; emit(); return user; },
      async resume() { const t = keep.get(); if (!t) return null; token = t; try { const j = await call({ action: "whoami" }); user = j.user; status = "signed-in"; emit(); return user; } catch (e) { token = null; return null; } },
      async logout() { try { await call({ action: "logout" }); } catch (e) { /* already gone */ } token = null; user = null; db = null; keep.set(null); status = "signed-out"; emit(); },
      async load() { status = "syncing"; emit(); const j = await call({ action: "getLedger" }); db = j.db; status = "synced"; emit(); return db; },
      /* Ask the server to run a ledger command as the signed-in user. The returned ledger view replaces the local copy. */
      async command(name, args) { status = "saving"; emit(); try { const j = await call({ action: "command", name, args }); db = j.db; status = "synced"; emit(); return j.result; } catch (e) { status = "error"; emit(); throw e; } },
      setPin: (newPin, oldPin, userId) => call({ action: "setPin", newPin, oldPin, userId }),
      createUser: (u) => call({ action: "createUser", user: u }),
      disableUser: (userId) => call({ action: "disableUser", userId })
    };
  }
  return { create };
});
