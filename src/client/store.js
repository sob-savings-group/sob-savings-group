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
    let token = null, user = null, db = null, status = "idle", busy = 0, busyLabel = ""; const listeners = [];
    const emit = () => listeners.forEach((f) => f({ status, user, busy, busyLabel }));
    const keep = { get() { try { return o.session && o.session.getItem(o.tokenKey); } catch (e) { return null; } }, set(v) { try { if (o.session) v ? o.session.setItem(o.tokenKey, v) : o.session.removeItem(o.tokenKey); } catch (e) { /* optional */ } } };
    async function call(body) {
      if (!o.url) throw new Error("OFFLINE_MODE");
      busy++; busyLabel = { login: "Signing in…", getLedger: "Loading the ledger…", command: "Saving…", whoami: "Checking your session…" }[body.action] || "Working…"; emit();
      let j;
      try {
        const TIMEOUT = o.timeoutMs || 120000; let timer;
        const r = await Promise.race([o.fetch(o.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ token }, body)) }), new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("TIMEOUT: Google did not answer in 2 minutes. Check your internet and try again."), { code: "TIMEOUT" })), TIMEOUT); })]);
        clearTimeout(timer); j = await r.json();
      } finally { busy--; emit(); }
      if (!j.ok) { if (j.error === "UNAUTHENTICATED") { token = null; user = null; keep.set(null); status = "signed-out"; emit(); } const e = new Error(j.error || "REQUEST_FAILED"); e.code = String(j.error || "").split(":")[0]; throw e; }
      return j;
    }
    const validUser = (u) => !!u && typeof u === "object" && typeof u.role === "string" && !!u.role && u.id != null;
    return {
      onChange(f) { listeners.push(f); },
      get db() { return db; }, get user() { return user; }, get status() { return status; }, get signedIn() { return !!token; },
      /* Contract: a successful login answers {ok:true, token:string, user:{id,name,role,mustChangePin}}. Anything else is checked here, once, so the UI can trust the result. */
      async login(id, pin) {
        const j = await call({ action: "login", id, pin });
        if (!j || typeof j.token !== "string" || !j.token) throw Object.assign(new Error("SIGNIN_CONTRACT: the server did not return a session (fields received: " + Object.keys(j || {}).join(", ") + "). Redeploy the latest Code.gs as a New version."), { code: "SIGNIN_CONTRACT" });
        token = j.token; let u = j.user;
        if (!validUser(u)) { try { const w = await call({ action: "whoami" }); u = w.user; } catch (e) { token = null; throw e; } }   // the session exists: ask the server who it belongs to
        if (!validUser(u)) { token = null; throw Object.assign(new Error("SIGNIN_CONTRACT: the server signed you in but did not say who you are (fields received: " + Object.keys(j).join(", ") + "). Redeploy the latest Code.gs as a New version."), { code: "SIGNIN_CONTRACT" }); }
        user = Object.assign({ mustChangePin: false }, u); user.mustChangePin = user.mustChangePin === true; keep.set(token); status = "signed-in"; emit(); return user;
      },
      async resume() { const t = keep.get(); if (!t) return null; token = t; try { const j = await call({ action: "whoami" }); if (!validUser(j.user)) throw new Error("no user"); user = Object.assign({ mustChangePin: false }, j.user); status = "signed-in"; emit(); return user; } catch (e) { token = null; return null; } },
      async logout() { try { await call({ action: "logout" }); } catch (e) { /* already gone */ } token = null; user = null; db = null; keep.set(null); status = "signed-out"; emit(); },
      async load() { status = "syncing"; emit(); const j = await call({ action: "getLedger" }); db = j.db; status = "synced"; emit(); return db; },
      /* Ask the server to run a ledger command as the signed-in user. The returned ledger view replaces the local copy. */
      async command(name, args) { status = "saving"; emit(); try { const j = await call({ action: "command", name, args }); db = j.db; status = "synced"; emit(); return j.result; } catch (e) { status = "error"; emit(); throw e; } },
      setPin: (newPin, oldPin, userId) => call({ action: "setPin", newPin, oldPin, userId }),
      createUser: (u) => call({ action: "createUser", user: u }),
      disableUser: (userId) => call({ action: "disableUser", userId }),
      /* Generic server action for Admin screens (gatewayStatus, dispatchOutbox, backups). The server still decides who may do what. */
      call: (body) => call(body)
    };
  }
  return { create };
});
