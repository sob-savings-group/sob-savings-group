/* Browser version of `sobctl smoke` / `smoke-write` for people without Node: runs from dist/verify.html against the deployed /exec URL. */
(function () {
  const L = SOB.ledger, I = SOB.integrity, D = SOB.dates, $ = (id) => document.getElementById(id), out = $("out"), rows = [];
  const add = (name, pass, detail) => { rows.push({ name, pass: !!pass, detail: detail || "" }); render(); return !!pass; };
  const render = () => { out.textContent = rows.map((r) => (r.pass ? "PASS " : "FAIL ") + r.name + (r.detail && !r.pass ? "  -> " + r.detail : "")).join("\n") + (rows.length && done ? "\n\nRESULT: " + (rows.every((r) => r.pass) ? "PASS" : "FAIL") : ""); };
  let done = false;
  const url = () => $("url").value.trim();
  const api = async (body) => {
    const u = url(); if (!/^https:\/\/script\.google\.com\/.+\/exec(\?.*)?$/.test(u) && !/^http:\/\/localhost/.test(u)) throw new Error("The URL box contains: [" + u.slice(0, 40) + "..." + u.slice(-12) + "] (" + u.length + " characters). It must start with https://script.google.com/ and end with /exec. Copy it again from Deploy > Manage deployments.");
    const res = await fetch(url(), { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" });
    const text = await res.text(); try { return JSON.parse(text); } catch (e) { throw new Error("Not a JSON answer (HTTP " + res.status + "). Check the deployment is 'Anyone' access and the URL is the /exec one. " + text.slice(0, 120)); }
  };
  const must = (r, what) => { if (!r || !r.ok) throw new Error(what + " failed: " + (r && r.error)); return r; };
  const login = async (id, pin) => must(await api({ action: "login", id, pin }), "sign-in " + id);
  const start = () => { rows.length = 0; done = false; out.textContent = "Running..."; };
  const finish = (e) => { if (e) add("stopped", false, e.message); done = true; render(); };
  async function smoke() {
    start(); try {
      add("service responds", (await api({ action: "ping" })).pong === true);
      add("unknown id cannot sign in", (await api({ action: "login", id: "SMOKE-NOBODY", pin: "000000" })).error === "BAD_CREDENTIALS");
      const r = await login($("aid").value.trim(), $("apin").value), t = r.token;
      const led = must(await api({ action: "getLedger", token: t }), "getLedger");
      add("Admin can read the ledger", Array.isArray(led.db.transactions));
      add("snapshot-write endpoint does not exist", (await api({ action: "syncAll", token: t, db: {} })).error === "UNKNOWN_ACTION");
      add("unknown command is refused", /UNKNOWN_COMMAND/.test((await api({ action: "command", token: t, name: "constructor", args: {} })).error || ""));
      add("credentials never leave the server", !JSON.stringify(led).match(/pinHash|"salt"/));
      add("import is closed once data exists", led.db.transactions.length === 0 || /NOT_EMPTY/.test((await api({ action: "importSnapshot", token: t, db: {} })).error || ""));
      const un = I.unaccounted(led.db, D.todayISO()); add("ledger integrity: every error is accounted for", un.length === 0, un.map((f) => f.code + " " + f.detail).join("; "));
      await api({ action: "logout", token: t }); add("logged-out admin session is dead", (await api({ action: "getLedger", token: t })).error === "UNAUTHENTICATED");
      finish();
    } catch (e) { finish(e); }
  }
  async function makeChair() {
    start(); try {
      const t = (await login($("aid").value.trim(), $("apin").value)).token;
      must(await api({ action: "createUser", token: t, user: { id: $("cid").value.trim(), role: "Chairperson", pin: $("cslip").value } }), "create Chairperson");
      add("Chairperson sign-in created (they must choose their own PIN at first use; the write test does that with the 'own PIN' field)", true); finish();
    } catch (e) { finish(e); }
  }
  async function write() {
    start(); try {
      if (!$("scratch").checked) throw new Error("Tick the box: this writes a test entry, ONLY for a scratch deployment, never production");
      const t = (await login($("aid").value.trim(), $("apin").value)).token, led = must(await api({ action: "getLedger", token: t }), "getLedger").db;
      if (!led.members.length) { must(await api({ action: "command", token: t, name: "addMember", args: { id: "SOB-999", name: "Smoke Test Member", regDate: "" } }), "add test member"); add("empty scratch ledger: test member SOB-999 added", true); led.transactions = led.transactions || []; led.members.push({ id: "SOB-999" }); }
      const m = led.members[0], before = L.memberSavings(led, m.id);
      const r = must(await api({ action: "command", token: t, name: "createEntry", args: { date: D.todayISO(), memberId: m.id, amount: 1234, type: "Savings", purpose: "smoke test" } }), "createEntry");
      add("entry saved", L.memberSavings(r.db, m.id) === before + 1234);
      const back = must(await api({ action: "getLedger", token: t }), "re-read").db; add("entry persisted in the Sheet", L.memberSavings(back, m.id) === before + 1234);
      const rq = must(await api({ action: "command", token: t, name: "voidEntry", args: { id: r.result.id, reason: "smoke test cleanup" } }), "void request");
      add("Super Admin's void only creates a request; balance unchanged", !!(rq.result && rq.result.pendingApproval) && L.memberSavings(rq.db, m.id) === before + 1234);
      const self = await api({ action: "command", token: t, name: "approveRequest", args: { id: rq.result.requestId } }); add("Super Admin cannot approve their own request", !self.ok && /FORBIDDEN|SEPARATION/.test(self.error || ""));
      if (String($("cown").value).length < 6) throw new Error("The Chairperson's own PIN must be at least 6 characters");
      let ct, tryOwn = await api({ action: "login", id: $("cid").value.trim(), pin: $("cown").value });   // already changed on an earlier run?
      if (tryOwn.ok) ct = tryOwn.token; else { const lc = must(await api({ action: "login", id: $("cid").value.trim(), pin: $("cslip").value }), "Chairperson sign-in"); ct = lc.token; if (lc.user.mustChangePin) must(await api({ action: "setPin", token: ct, oldPin: $("cslip").value, newPin: $("cown").value }), "Chairperson set PIN"); }
      const v = must(await api({ action: "command", token: ct, name: "approveRequest", args: { id: rq.result.requestId } }), "Chairperson approve");
      add("Chairperson approval voids it; balance restored, record kept", L.memberSavings(v.db, m.id) === before && v.db.transactions.some((x) => x.id === r.result.id && x.voided));
      add("audit trail has the actions", v.db.auditLog.some((a) => a.entityId === r.result.id && /oid/.test(a.action)) && v.db.auditLog.some((a) => a.entityType === "ApprovalRequest"));
      finish();
    } catch (e) { finish(e); }
  }
  $("b-smoke").onclick = smoke; $("b-chair").onclick = makeChair; $("b-write").onclick = write;
  $("b-copy").onclick = () => { navigator.clipboard.writeText(out.textContent).then(() => { $("b-copy").textContent = "Copied"; }); };
})();
