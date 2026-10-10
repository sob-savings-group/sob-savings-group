/* SOB client/store — talks to the server only through login + getLedger + command. The browser holds a session token (in memory, and
   sessionStorage so a refresh keeps you signed in until the tab closes) and a role-filtered copy of the ledger. Nothing here grants
   access: the server decides who can see or change what. The ledger is deliberately NOT cached in localStorage (shared phones). */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory();
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.client = api; }
})(typeof self !== "undefined" ? self : this, function () {
  /* Google answers with an HTML page (not JSON) when the web app is not published to "Anyone", needs permissions, throws, or the address is wrong.
     Say which one it is, in words an officer can act on, instead of a raw "Unexpected token <" parse error. */
  function endpointProblem(text, status, url, forced) {
    const t = String(text || ""), low = t.toLowerCase(), plain = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
    const mk = (code, msg) => Object.assign(new Error(code + ": " + msg), { code, detail: plain, status: status || 0 });
    if (forced === "NOT_SOB") return mk("ENDPOINT_NOT_SOB", "This address answered, but it is not the SOB ledger. Check the web-app address.");
    if (/\/dev(\?|$)/.test(String(url || ""))) return mk("ENDPOINT_TEST_URL", "The web-app address ends in /dev (the test address). Use the address ending in /exec.");
    if (/accounts\.google\.com|servicelogin|sign in to continue|choose an account/.test(low)) return mk("ENDPOINT_NOT_PUBLIC", "Google asked for a sign-in, so the web app is not open to everyone. In Apps Script: Deploy > Manage deployments > Edit > Who has access: Anyone > New version > Deploy.");
    if (/authorization is required|authorisation is required|requires authorization|needs authorization|permission to access/.test(low)) return mk("ENDPOINT_NEEDS_PERMISSION", "Google needs the script owner to grant permissions. In Apps Script run authorizeSOB once (accept the permissions), then Deploy > Manage deployments > Edit > New version.");
    if (/function not found|doget|dopost/.test(low) && /not found|missing/.test(low)) return mk("ENDPOINT_OLD_CODE", "The deployed Code.gs is missing or older than this app. Paste the latest Code.gs, then Deploy > Manage deployments > Edit > New version.");
    if (status === 404 || /unable to open the file|page not found|sorry, the file|requested url was not found/.test(low)) return mk("ENDPOINT_NOT_FOUND", "Google could not find that web app (wrong or deleted deployment address).");
    if (/typeerror|referenceerror|syntaxerror|exception|error:/.test(low)) return mk("ENDPOINT_SCRIPT_ERROR", "The Google script stopped with an error: " + plain);
    return mk("ENDPOINT_HTML", "Google returned a web page instead of data" + (plain ? " (\"" + plain.slice(0, 120) + "\")" : "") + ". Check the deployment: Execute as Me, Who has access Anyone, latest version.");
  }
  function create(opts) {
    const o = Object.assign({ url: "", fetch: null, session: null, tokenKey: "sob.session" }, opts);
    let token = null, user = null, db = null, status = "idle", busy = 0, busyLabel = "", serverBuild = null; const listeners = [];
    const emit = () => listeners.forEach((f) => f({ status, user, busy, busyLabel }));
    const keep = { get() { try { return o.session && o.session.getItem(o.tokenKey); } catch (e) { return null; } }, set(v) { try { if (o.session) v ? o.session.setItem(o.tokenKey, v) : o.session.removeItem(o.tokenKey); } catch (e) { /* optional */ } } };
    async function call(body) {
      if (!o.url) throw new Error("OFFLINE_MODE");
      busy++; busyLabel = { login: "Signing in…", getLedger: "Loading the ledger…", command: "Saving…", whoami: "Checking your session…" }[body.action] || "Working…"; emit();
      let j;
      try {
        const TIMEOUT = o.timeoutMs || 120000; let timer, r;
        try {
          r = await Promise.race([o.fetch(o.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ token }, body)), redirect: "follow", credentials: "omit", cache: "no-store" }),
            new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("TIMEOUT: Google did not answer in " + Math.round(TIMEOUT / 1000) + " seconds. Please try again."), { code: "TIMEOUT" })), TIMEOUT); })]);
        } catch (e) { clearTimeout(timer); if (e && e.code === "TIMEOUT") throw e; throw Object.assign(new Error("NETWORK: the app could not reach Google (offline, blocked, or the web-app address is wrong)."), { code: "NETWORK", cause: String(e && e.message || e) }); }
        clearTimeout(timer);
        const text = await r.text();
        try { j = JSON.parse(text); } catch (e) { throw endpointProblem(text, r.status, o.url); }
        if (!j || typeof j !== "object") throw endpointProblem(text, r.status, o.url);
      } finally { busy--; emit(); }
      if (j.build) serverBuild = String(j.build);
      if (!j.ok) { if (j.error === "UNAUTHENTICATED") { token = null; user = null; keep.set(null); status = "signed-out"; emit(); } const e = new Error(j.error || "REQUEST_FAILED"); e.code = String(j.error || "").split(":")[0]; throw e; }
      return j;
    }
    const validUser = (u) => !!u && typeof u === "object" && typeof u.role === "string" && !!u.role && u.id != null;
    return {
      onChange(f) { listeners.push(f); },
      get db() { return db; }, get user() { return user; }, get status() { return status; }, get signedIn() { return !!token; }, get serverBuild() { return serverBuild; },
      /* Plain GET of the web-app address (no sign-in): tells the app whether the endpoint is reachable, is the SOB ledger, and which build is deployed. */
      async check() { try { const r = await o.fetch(o.url, { method: "GET", redirect: "follow", credentials: "omit", cache: "no-store" }), t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { return { ok: false, error: endpointProblem(t, r.status, o.url) }; } if (j && j.ok && j.service === "SOB Ledger") { serverBuild = j.build || null; return { ok: true, build: j.build || null }; } return { ok: false, error: endpointProblem(t, r.status, o.url, "NOT_SOB") }; } catch (e) { return { ok: false, error: Object.assign(new Error("NETWORK: the app could not reach Google."), { code: "NETWORK" }) }; } },
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
  return { create, endpointProblem };
});
