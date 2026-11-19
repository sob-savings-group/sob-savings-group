(function () {
  const { h, ugx, num, badge, Card, Table, State, Modal, Form, toast, friendly, Busy, Icon, Banner, Empty, Confirm, Chips } = window.SOBUI;
  const S = window.SOB, CFG = window.SOB_CONFIG || {}, RMD = S.reminders, D = S.dates, L = S.ledger, G = S.gov, LN = S.loans, N = S.notify, AT = S.airtime, C = S.cycle, K = S.kpis, R = S.reports, FYM = S.fy, RSV = S.reserve, PRC = S.profitrec, HLN = S.histloans, FRP = S.finreports;
  const app = document.getElementById("app");
  const st = { store: null, db: null, user: null, view: null, live: !!CFG.ledgerUrl, memberView: null };
  const today = () => D.todayISO();
  /* Every dated entry defaults to TODAY (East Africa Time) in a date picker; the Super Admin may pick an earlier real date (a genuine earlier transaction), never a future one. The chosen date is the one used for interest and guarantee release. */
  const dateF = (name, label) => ({ name: name || "date", label: label || "Date (today unless you change it)", type: "date", value: D.todayISO(), max: D.todayISO() });
  const ctx = () => G.makeCtx(st.user);
  const roleLabel = (r) => (r === "Admin" ? "Super Admin" : r);
  const isStaff = () => st.user && st.user.role !== "Member";
  const nameOf = (id) => ((st.db.members.find((m) => m.id === id)) || {}).name || id;

  /* Every write is a named command. Live: the SERVER runs it as the signed-in user (and may refuse). Demo: the same command table runs in memory. */
  async function commit(name, args) {
    const res = st.live ? await st.store.command(name, args) : S.commands.run(st.db, ctx(), name, args);
    if (st.live) st.db = st.store.db;
    const out = res; st.sentForApproval = !!(out && out.pendingApproval);
    render(); return res;
  }
  const M = () => ({ remove() { document.querySelectorAll(".modal-bg").forEach((m) => m.remove()); } });   /* the one place that closes an open form, usable from every screen */
  const act = (fn, okMsg) => async (...a) => { try { st.sentForApproval = false; await fn(...a); if (st.sentForApproval) toast("Sent to the Chairperson — nothing changes until a different person approves it (see Approvals)"); else if (okMsg) toast(okMsg); } catch (e) { toast(friendly(e), true); throw e; } };

  /* ---------- brand: the official eagle/globe logo and the shield-and-tree ALWAYS appear as a pair (one helper, so every screen, and any future module, stays identical) ---------- */
  const brandMark = (cls) => h("span", { class: "marks " + (cls || "") }, h("img", { class: "logo-shield", src: (window.SOB_BRAND || {}).shield || "", alt: "SOB Savings Group shield" }), h("img", { class: "logo-eagle", src: R.LOGO, alt: "BWOMI logo" }));
  const splash = (msg) => h("div", { class: "splash", role: "status" }, (window.SOB_BRAND || {}).lockup ? h("img", { class: "sp-lockup", src: window.SOB_BRAND.lockup, alt: "Sons of Bethel Savings Group" }) : [brandMark("lg"), h("div", { class: "sp-t" }, "Sons of Bethel Savings Group")], h("div", { class: "sp-s" }, msg || "Loading your records…"), h("div", { class: "sp-bar" }, h("i")));

  /* ---------- login ---------- */
  function loginScreen() {
    const box = h("div", { class: "card login" }, st.live ? null : h("div", { class: "lg-head" }, brandMark("lg"), h("h1", { class: "hero" }, "Sons of Bethel Savings Group"), h("div", { class: "tag" }, "DEV preview — demo data, nothing is saved or sent anywhere.")));
    if (!st.live) {
      const role = h("select", { id: "demo-role" }, ["Admin", "Chairperson", "Treasurer", "Secretary", "Committee", "Member"].map((r) => h("option", { value: r }, roleLabel(r))));
      const mem = h("select", { id: "demo-member" }, st.db.members.map((m) => h("option", { value: m.id }, m.id + " — " + m.name)));
      box.append(h("div", { class: "lg-body" }, h("label", null, "Role"), role, h("label", null, "Member (for Member role)"), mem,
        h("div", { class: "row" }, h("button", { class: "primary", id: "demo-go", onclick: () => { const r = role.value; const m = st.db.members.find((x) => x.id === mem.value);
          st.user = r === "Member" ? { id: m.id, name: m.name, role: "Member", memberId: m.id } : { id: "demo-" + r, name: "Demo " + r, role: r }; st.view = null; render(); } }, "Enter"))));
    } else {
      /* ONE sign-in for everybody: SOB ID, Staff ID or email + password. The server finds the role; render() then shows only what that role may use. */
      const mid = h("input", { id: "mid", placeholder: "SOB-014, email or phone", autocapitalize: "none", autocomplete: "username", autocorrect: "off", spellcheck: "false", enterkeyhint: "next" });
      const pin = h("input", { type: "password", id: "pin", placeholder: "Password", autocomplete: "current-password", enterkeyhint: "go" });
      const show = h("button", { type: "button", id: "pin-show", class: "ghost", "aria-label": "Show or hide password", onclick: () => { const on = pin.type === "password"; pin.type = on ? "text" : "password"; show.textContent = on ? "Hide" : "Show"; } }, "Show");
      let working = false; const problem = h("div", { id: "login-problem" }); if (st.conn && !st.conn.ok) connBanner(problem, st.conn.error);
      const MSG = { BAD_CREDENTIALS: "Incorrect ID or password. Please check and try again.", MEMBER_PENDING: "Your membership is pending approval. Please contact the Administrator.", MEMBER_INACTIVE: "Your account is currently inactive or restricted. Please contact the Administrator.", BAD_CODE: "That code is wrong or has expired. Request a new one.", WEAK_PIN: "Choose a password of at least 6 characters.", EMAIL_UNAVAILABLE: "We could not send the email. Please contact the Secretary.", SMS_UNAVAILABLE: "We could not send the text message. Please contact the Secretary." };
      const normId = (v) => { v = String(v || "").trim(); return v.indexOf("@") > 0 ? v : v.replace(/^sob[\s\-_.]*0*(\d{1,3})(?!\d)/i, (_, n) => "SOB-" + n.padStart(3, "0")); };
      const attempt = async (produce) => {
        if (working) return; working = true; problem.replaceChildren();
        try {
          const u = await produce(); st.user = u; st.view = null;
          if (!u.mustChangePin) { await st.store.load(); st.db = st.store.db; }
          render();
        } catch (e) {
          const conn = /^(ENDPOINT_|NETWORK|TIMEOUT|SERVER_ERROR|SIGNIN_CONTRACT)/.test(e.code || ""); problem.replaceChildren();
          if (conn) connBanner(problem, e);
          else if (MSG[e.code]) problem.append(h("div", { class: "err", id: "login-error", role: "alert" }, MSG[e.code]));
          else problem.append(h("div", { class: "err", id: "login-error", role: "alert" }, e.code === "LOCKED" ? "Too many attempts. Please try again in 15 minutes." : friendly(e)));
        } finally { working = false; }
      };
      const submit = () => attempt(async () => {
        const id = normId(mid.value), secret = pin.value.trim();
        if (!id) throw Object.assign(new Error("Enter your SOB ID, Staff ID or email"), { code: "FORMAT" });
        if (!secret) throw Object.assign(new Error("Enter your password"), { code: "FORMAT" });
        return st.store.login(id, secret);
      });
      /* two short steps: 1) who you are  2) your password. The password box is filled by a password manager too, so a filled password signs in at once. */
      let idStep, pwStep, who, toggleRef;
      const next = () => { problem.replaceChildren(); if (!mid.value.trim()) return problem.append(h("div", { class: "err", id: "login-error", role: "alert" }, "Enter your SOB ID, email or phone"));
        if (pin.value) return submit(); who.textContent = normId(mid.value); idStep.hidden = true; pwStep.hidden = false; if (toggleRef) toggleRef.hidden = true; setTimeout(() => pin.focus(), 0); };
      const back = () => { problem.replaceChildren(); pwStep.hidden = true; idStep.hidden = false; pin.value = ""; if (toggleRef) toggleRef.hidden = false; mid.focus(); };
      mid.addEventListener("keydown", (ev) => { if (ev.key === "Enter") next(); }); pin.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submit(); });
      /* Create or reset a password: a 6-digit code goes to the email on record (or by SMS when there is no email); the code proves who you are. */
      const rid = h("input", { id: "reg-id", placeholder: "SOB-014, email or phone", autocapitalize: "none", autocomplete: "username", autocorrect: "off", spellcheck: "false" });
      const rcode = h("input", { id: "reg-code", placeholder: "6-digit code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "6" });
      const rpw = h("input", { id: "reg-pw", type: "password", placeholder: "New password (6+ characters)", autocomplete: "new-password" });
      const rmsg = h("div", { id: "reg-msg", class: "ok-note", role: "status" });
      const step2 = h("div", { id: "reg-step2", hidden: true }, h("label", { for: "reg-code" }, "Verification code"), rcode, h("label", { for: "reg-pw" }, "Choose a password"), rpw,
        h("button", { class: "primary big", id: "reg-go", onclick: () => attempt(async () => {
          if (!/^\d{6}$/.test(rcode.value.trim())) throw Object.assign(new Error("Enter the 6-digit code"), { code: "FORMAT" });
          if (rpw.value.length < 6) throw Object.assign(new Error("Choose a password of at least 6 characters"), { code: "WEAK_PIN" });
          return st.store.login(normId(rid.value), null, { action: "otpVerify", code: rcode.value.trim(), password: rpw.value });
        }) }, "Create password and sign in"));
      const sendCode = async () => { if (working) return; problem.replaceChildren(); rmsg.textContent = ""; const id = normId(rid.value);
        if (!id) return problem.append(h("div", { class: "err", id: "login-error", role: "alert" }, "Enter your SOB ID, email or phone"));
        working = true; try { const j = await st.store.call({ action: "otpStart", id }); rmsg.textContent = j.message; step2.hidden = false; rcode.focus(); }
        catch (e) { problem.append(h("div", { class: "err", id: "login-error", role: "alert" }, MSG[e.code] || friendly(e))); } finally { working = false; } };
      const regBox = h("div", { id: "reg-box", hidden: true }, h("h2", { class: "sec-sm" }, "Get a code"), h("p", { class: "lg-help" }, "Type your SOB ID, email or phone. We send a 6-digit code to your email, or by SMS if you have none."), h("label", { for: "reg-id" }, "SOB ID, email or phone"), rid,
        h("button", { class: "secondary big", id: "reg-send", onclick: sendCode }, "Send verification code"), rmsg, step2);
      const signBox = h("div", { id: "sign-box" },
        (idStep = h("div", { id: "id-step" }, h("label", { for: "mid" }, "SOB ID, email or phone"), mid, h("button", { class: "primary big", id: "login-go", onclick: next }, "Continue"))),
        (pwStep = h("div", { id: "pw-step", hidden: true }, h("div", { class: "who-row" }, (who = h("b", { id: "pw-who" }, "")), h("button", { type: "button", class: "linkbtn", id: "pw-back", onclick: back }, "Change")), h("label", { for: "pin" }, "Password"), h("div", { class: "pinrow" }, pin, show),
          h("button", { class: "primary big", id: "login-submit", onclick: submit }, "Sign in"), h("button", { type: "button", class: "linkbtn", id: "pw-forgot", onclick: () => { rid.value = mid.value; regBox.hidden = false; signBox.hidden = true; toggleRef.hidden = false; toggleRef.textContent = "Back to sign in"; sendCode(); } }, "Forgot password? Send me a code"))));
      const toggle = h("button", { type: "button", id: "pin-toggle", class: "linkbtn", onclick: () => { const c = regBox.hidden; regBox.hidden = !c; signBox.hidden = c; problem.replaceChildren(); toggle.textContent = c ? "Back to sign in" : "First time? Get a code"; if (!c) back(); if (c) rid.value = mid.value; } }, "First time? Get a code");
      toggleRef = toggle;
      const help = R.OFFICERS.filter((o) => ["Treasurer", "Secretary"].includes(o[1]));
      box.className = "card login"; box.removeAttribute("style");
      box.replaceChildren(h("div", { class: "lg-head" }, brandMark("lg"), h("h1", { class: "hero" }, "Sons of Bethel Savings Group"), h("div", { class: "tag" }, "Sign in")),
        h("div", { class: "lg-body" }, signBox, regBox, toggle, problem, h("div", { id: "conn-status", class: "hint", role: "status" }, ""),
          h("div", { class: "help" }, h("div", { class: "help-t" }, "Need help?"), help.map((o) => h("a", { href: "tel:" + o[2].replace(/\s/g, "") }, o[0] + " — " + o[2])))));
    }
    if (st.conn) setTimeout(() => paintConn(st.conn), 0);
    return box;
  }

  /* A PIN printed on a slip (or set by an Admin) is known to someone else: its owner must replace it before anything else is possible (enforced by the server too). */
  function forcePinScreen() {
    const o = h("input", { type: "password", id: "fp-old", autocomplete: "current-password" }), n = h("input", { type: "password", id: "fp-new", autocomplete: "new-password" }), c = h("input", { type: "password", id: "fp-new2", autocomplete: "new-password" });
    return h("div", { class: "card login", id: "force-pin" }, brandMark("lg dark"), h("h1", { class: "hero", style: "font-size:28px" }, "Choose your own password"),
      h("p", { class: "tag" }, "Choose a private password: at least 4 characters (members) or 6 (staff)."),
      h("label", null, "Current password (from your slip)"), o, h("label", null, "New password"), n, h("label", null, "Repeat new password"), c,
      h("div", { class: "row" }, h("button", { class: "primary", id: "fp-go", onclick: async () => {
        if (n.value !== c.value) return toast("The two new PINs do not match", true);
        try { await st.store.setPin(n.value, o.value); st.user.mustChangePin = false; await st.store.load(); st.db = st.store.db; st.view = null; toast("Password changed"); render(); } catch (e) { toast(friendly(e), true); }
      } }, "Save password"), h("button", { onclick: async () => { await st.store.logout(); st.user = null; render(); } }, "Sign out")));
  }

  /* ---------- navigation ---------- */
  /* [key, label, onlyRole, icon, class]  — classes: sec = desktop sidebar only (phones reach it through More), mob = phones only */
  const NAV_STAFF = [["dash", "Overview", null, "home"], ["members", "Members", null, "users"], ["loans", "Loans", null, "loan"], ["ledger", "Ledger", null, "wallet"], ["subs", "Subscriptions", null, "receipt"], ["fyears", "Financial Years", null, "book"], ["profit", "Profit", null, "chart"], ["shareout", "Share-Out", null, "gift"], ["reserve", "General Reserve", null, "shield"], ["approvals", "Approvals", null, "check"], ["recon", "Reconciliation", null, "shield"], ["audit", "Audit", null, "clock"], ["reports", "Reports", null, "download"], ["airtime", "Airtime", null, "phone"], ["messages", "Messages", "Admin", "bell"], ["reminders", "Loan Reminders", "Admin", "bell"], ["system", "System", "Admin", "sliders"], ["menu", "More", null, "more", "only-mobile tab"]];
  /* the four tabs on a phone's bottom bar depend on the role: each role sees its own most-used screens first, everything else is under More or Search */
  const PHONE_TABS = { Admin: ["dash", "members", "loans", "ledger"], Chairperson: ["dash", "approvals", "loans", "reports"], Treasurer: ["dash", "ledger", "members", "loans"], Secretary: ["dash", "members", "reports", "ledger"], Committee: ["dash", "reports", "members", "loans"] };
  const phoneTab = (k) => (PHONE_TABS[st.user && st.user.role] || PHONE_TABS.Admin).indexOf(k);
  const NAV_MEMBER = [["home", "Home", null, "home"], ["savings", "Savings", null, "wallet"], ["myloans", "Loans", null, "loan"], ["myguar", "Guarantees", null, "shield"], ["more", "More", null, "more", "only-mobile"], ["mysubs", "Subscription", null, "receipt", "sec"], ["myshare", "Share-out", null, "gift", "sec"], ["airtime", "Airtime", null, "phone", "sec"]];
  const pendingAirtime = () => (st.db.airtimeRequests || []).filter((r) => r.status === "Pending").length;
  async function refresh(quiet) {
    if (!st.live || !st.user || st.user.mustChangePin || st.refreshing) return; st.refreshing = true;
    try { await st.store.load(); st.db = st.store.db; st.lastLoad = Date.now(); if (!document.querySelector(".modal-bg")) render(); if (!quiet) toast("Up to date"); } catch (e) { if (!quiet) toast(friendly(e), true); } finally { st.refreshing = false; }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && st.live && st.user && Date.now() - (st.lastLoad || 0) > 60000) refresh(true); });
  const go = (v, fromBack) => { document.querySelectorAll(".modal-bg").forEach((m) => m.remove()); if (v !== st.view) st.prevView = st.view; st.view = v; st.memberView = null; render(); window.scrollTo(0, 0); if (!fromBack && st.user) { try { history.pushState({ sobView: v }, ""); } catch (e) {} } };
  /* Back button / swipe-back: closes the open window first, then returns to the previous screen */
  window.addEventListener("popstate", (e) => {
    const U = window.SOBUI;
    if (U.ignorePop > 0) { U.ignorePop--; return; }                       // the Back we issued ourselves when a window was closed
    const m = document.querySelectorAll(".modal-bg"); if (m.length) { m[m.length - 1].remove(); return; }
    const state = e.state || {};
    if (st.user && state.sobModal) { try { history.back(); } catch (x) {} return; }   // a leftover window entry: step over it
    if (st.user && !state.sobView) { try { history.pushState({ sobView: st.view }, ""); } catch (x) {} toast("You are still signed in. Use the sign-out button (top right) to leave."); return; }   // Back never drops a signed-in user out of the app
    const sv = state.sobView; if (st.user && sv && sv !== st.view) go(sv, true);
  });
  /* safety net: any error nobody caught is logged for developers and shown to people only as a plain message (never the code) */
  let lastSafety = 0; const safety = (e) => { try { console.error("[SOB] uncaught:", e); const now = Date.now(); if (now - lastSafety > 4000) { lastSafety = now; toast(friendly(e && e.message ? e : new Error("internal")), true); } } catch (x) {} };
  window.addEventListener("error", (ev) => { if (ev && ev.error) safety(ev.error); });
  window.addEventListener("unhandledrejection", (ev) => safety(ev && ev.reason));
  window.addEventListener("beforeunload", (e) => { if (document.querySelector(".modal-bg form, .modal-bg input[name]")) { e.preventDefault(); e.returnValue = ""; } });
  const MORE_VIEWS = ["more", "mysubs", "myshare", "airtime"];
  const NAV_GROUP = { dash: "Overview", members: "Members and loans", loans: "Members and loans", ledger: "Accounts", subs: "Accounts", fyears: "Year-end", profit: "Year-end", shareout: "Year-end", reserve: "Year-end", approvals: "Governance", recon: "Governance", audit: "Governance", reports: "Reports", airtime: "Communication", messages: "Communication", reminders: "Communication", system: "System" };
  function navBadge(k) {
    if (isStaff()) return k === "airtime" ? pendingAirtime() : k === "approvals" ? K.awaiting(st.db) : 0;
    return k === "myguar" ? (st.db.guarantees || []).filter((g) => g.guarantorId === st.user.memberId && g.status === "Requested").length : 0;
  }
  function render() {
    app.replaceChildren();
    if (!st.user) { app.append(loginScreen()); return; }
    if (st.live && st.user.mustChangePin) { app.append(forcePinScreen()); return; }
    const staff = isStaff(), nav = (staff ? NAV_STAFF : NAV_MEMBER).filter((n) => !n[2] || n[2] === st.user.role); st.view = st.view || nav[0][0];
    const active = (k) => st.view === k || (staff && k === "menu" && st.view === "menu") || (!staff && k === "more" && MORE_VIEWS.includes(st.view));
    const shell = h("div", { class: "shell" });
    shell.append(h("header", { class: "top" }, h("div", { class: "brand" }, brandMark("sm"), h("div", { style: "min-width:0" }, h("div", { class: "bt1" }, staff ? "SOB " + roleLabel(st.user.role) : "Sons of Bethel"), h("div", { class: "bt2" }, st.user.name + (st.live ? "" : " · DEMO")))),
      h("button", { class: "searchbtn", id: "open-search", "aria-label": "Search", onclick: openSearch }, Icon("search", 18), h("span", null, staff ? "Search screens, members, loans" : "Search"), h("kbd", null, "/")),
      h("div", { class: "hdr-actions" },
      staff && !st.live ? h("span", { class: "pill" }, "DEMO · DEV") : null,
      st.live && !st.user.readOnly ? h("button", { class: "iconbtn", id: "my-pin", "aria-label": "Change my password", title: "Change my password", onclick: () => Form("Change my password", [{ name: "o", label: "Current PIN", type: "password" }, { name: "n", label: "New PIN (members 4+, staff 6+ characters)", type: "password" }], act(async (f) => { await st.store.setPin(f.n, f.o); }, "PIN changed"), "Save password") }, Icon("key")) : null,
      st.live ? h("button", { class: "iconbtn", id: "refresh", "aria-label": "Refresh", title: "Refresh", onclick: () => refresh(false) }, Icon("refresh")) : null,
      h("button", { class: "iconbtn", id: "logout", "aria-label": "Sign out", title: "Sign out", onclick: async () => { if (st.live) await st.store.logout(); st.user = null; st.view = null; render(); } }, Icon("logout")))));
    let lastGroup = ""; const items = [];
    nav.forEach(([k, l, , ic, cls]) => { const n = navBadge(k), g = staff ? NAV_GROUP[k] || "" : ""; if (g && g !== lastGroup) { items.push(h("div", { class: "nav-sec", "aria-hidden": "true" }, g)); lastGroup = g; }
      const pt = staff ? (k === "menu" ? 9 : phoneTab(k)) : -1; items.push(h("button", { class: (active(k) ? "active " : "") + (staff ? (pt >= 0 ? "tab " : "") + (k === "menu" ? "only-mobile" : "") : (cls || "")), style: staff && pt >= 0 ? "--o:" + pt : null, "data-nav": k, "aria-current": active(k) ? "page" : null, onclick: () => go(k) }, Icon(ic, 22), h("span", null, l), n ? h("span", { class: "badge-n" }, String(n)) : null)); });
    shell.append(h("nav", { class: "nav" + (staff ? " many" : ""), "aria-label": "Main" }, items));
    const main = h("main", { id: "main" }); shell.append(main); app.append(shell);
    if (!st.guarded) { st.guarded = true; try { history.replaceState({ sobBase: 1 }, ""); history.pushState({ sobView: st.view }, ""); } catch (e) {} }
    const backBtn = st.view !== nav[0][0] ? h("button", { class: "backbtn", id: "back-btn", "aria-label": "Back", onclick: () => go(st.prevView && st.prevView !== st.view && nav.some((n) => n[0] === st.prevView) ? st.prevView : nav[0][0]) }, Icon("chevron", 18), h("span", { class: "bl" }, " Back")) : null; let backPlaced = false;
    try { const nv = shell.querySelector("nav button.active"), nb = shell.querySelector("nav"); if (nv && nb && nb.scrollWidth > nb.clientWidth && getComputedStyle(nb).flexDirection === "row") nb.scrollLeft = Math.max(0, nv.offsetLeft - (nb.clientWidth - nv.offsetWidth) / 2); } catch (e) { /* cosmetic */ }
    if (staff) { const cur = nav.find((n) => n[0] === st.view); if (cur) { main.append(h("div", { class: "pagetitle" + (st.view === "dash" ? " hide-m" : "") }, backBtn, h("h1", null, cur[1]))); backPlaced = !!backBtn; } }
    if (backBtn && !backPlaced) main.prepend(backBtn);
    try { main.append(VIEWS[st.view]()); } catch (e) { console.error(e); main.append(State("error", "We could not show this screen. " + friendly(e), () => render())); }
  }

  /* ---------- drill-down helpers ---------- */
  const loanRows = (filter) => K.loanBook(st.db, today()).filter(filter || (() => true));
  const loanCols = [{ label: "Loan", key: "id" }, { label: "Member", render: (v) => nameOf(st.db.loans.find((l) => l.id === v.id).memberId) }, { label: "Principal", num: 1, render: (v) => num(v.principal) }, { label: "Interest", num: 1, render: (v) => num(v.accumulatedInterest) }, { label: "Repaid", num: 1, render: (v) => num(v.repaid) }, { label: "Balance", num: 1, render: (v) => num(v.balance) }, { label: "Status", render: (v) => badge(v.status, v.balance > 0 ? "loan" : "ok") }];
  function drill(title, definition, body) { const dm = Modal(title, h("div", null, privacyToggle(), definition ? h("p", { class: "mute" }, "How this is calculated: " + definition) : null, body)); dm.el.setAttribute("data-rep", "1"); }

  /* ---------- Admin: dashboard ---------- */
  /* What needs a human today — the first thing staff see. */
  function attention(aw, p) {
    const items = [], open = (st.db.discrepancies || []).filter((d) => d.status === "Open").length, role = st.user.role;
    if (st.live && CFG.build && st.store.serverBuild !== CFG.build && role === "Admin") items.push(["warn", "The Google backend is out of date (" + (st.store.serverBuild || "older") + ", needs " + CFG.build + "). Paste the latest Code.gs in Apps Script and deploy a New version.", "system", "Open"]);
    if (aw) items.push(["warn", aw + (aw === 1 ? " item is" : " items are") + " waiting for the Chairperson's approval" + (role === "Chairperson" ? " — your decision is needed." : "."), "approvals", "Open"]);
    if (p.Pending) items.push(["info", p.Pending + (p.Pending === 1 ? " loan application needs" : " loan applications need") + " review.", "loans", "Open"]);
    if (pendingAirtime() && (role === "Admin")) items.push(["info", pendingAirtime() + " airtime " + (pendingAirtime() === 1 ? "request is" : "requests are") + " waiting.", "airtime", "Open"]);
    if (isStaff() && G.can(ctx(), "loan.repay")) { const cov = LN.settlementReview(st.db, today()).filter((r) => r.coveredToday); if (cov.length) items.push(["info", cov.length + (cov.length === 1 ? " loan is" : " loans are"), "loans", "Open"]); }
    if (open) items.push(["warn", open + " reconciliation " + (open === 1 ? "difference is" : "differences are") + " still open.", "recon", "Open"]);
    return h("div", { id: "attention" }, items.length ? items.map(([kind, text, view, label]) => Banner(kind, text, { label, onclick: () => go(view) })) : Banner("ok", "Nothing needs attention right now."));
  }
  /* ---- the reporting period: ONE selector for the whole dashboard and the Reports page. Balances are read as at its last day; activity covers first to last day. ---- */
  const rebuildPeriod = (v) => { if (/^fy\d+$/.test(v.key || "")) { const c = FYM.table(st.db).find((x) => "fy" + x.year === v.key); return c ? fyPeriod(c) : null; } return v.key === "custom" ? D.customPeriod(v.from, v.to, today()) : D.presetPeriod(v.key, today(), FYM.table(st.db)); };
  const periodNow = () => { if (!st.period) { try { const v = JSON.parse(sessionStorage.getItem("sob.period") || "null"); if (v && v.key) st.period = rebuildPeriod(v); } catch (e) { /* fall through to the default */ } } if (!st.period || st.period.to > today()) st.period = D.presetPeriod("year", today(), FYM.table(st.db)); else if (st.period.key !== "custom") st.period = rebuildPeriod(st.period) || D.presetPeriod("year", today(), FYM.table(st.db)); return st.period; };
  const setPeriod = (p) => { st.period = p; st.customOpen = false; try { sessionStorage.setItem("sob.period", JSON.stringify({ key: p.key, from: p.from, to: p.to })); } catch (e) { /* optional */ } render(); };
  /* every registered financial year can be picked: this year and last year keep their presets, older ones are added as "Financial Year N" */
  const fyPeriod = (c) => { const t = today(), to = c.closedDate && c.closedDate < t ? c.closedDate : t, p = D.customPeriod(c.openedDate, to, t); p.key = "fy" + c.year; p.fy = c.year; p.fyLabel = "FY" + c.year; p.fyOpened = c.openedDate; p.fyClosed = c.closedDate || null; p.label = "Financial Year " + c.year; return p; };
  const periodOptions = () => { const base = D.presetOptions(today(), FYM.table(st.db)), have = {}; base.forEach(([k, l]) => { have[l] = 1; });
    const older = FYM.table(st.db).filter((c) => D.isISO(c.openedDate) && !have["Financial Year " + c.year]).sort((a, b) => b.year - a.year).map((c) => ["fy" + c.year, "Financial Year " + c.year]);
    const i = base.findIndex(([k]) => k === "lastYear"); return i < 0 ? base : base.slice(0, i + 1).concat(older, base.slice(i + 1)); };
  function periodBar() {
    const p = periodNow(), custom = p.key === "custom" || st.customOpen, opts = periodOptions();
    const fyKeys = opts.filter(([k]) => k === "year" || k === "lastYear" || /^fy\d+$/.test(k)), other = opts.filter(([k]) => !fyKeys.includes([k]) && !(k === "year" || k === "lastYear" || /^fy\d+$/.test(k)) && k !== "custom");
    const val = custom ? "custom" : p.key, mk = (arr) => arr.map(([k, l]) => h("option", { value: k, selected: k === val }, l));
    const sel = h("select", { class: "pselect", id: "period-select", "aria-label": "Financial year or period", onchange: (e) => { const k = e.target.value; if (k === "custom") { st.customOpen = true; render(); } else if (/^fy\d+$/.test(k)) { const c = FYM.table(st.db).find((x) => "fy" + x.year === k); if (c) setPeriod(fyPeriod(c)); } else setPeriod(D.presetPeriod(k, today(), FYM.table(st.db))); } },
      fyKeys.length ? h("optgroup", { label: "Financial years" }, mk(fyKeys)) : null, h("optgroup", { label: "Other periods" }, mk(other)), h("option", { value: "custom", selected: val === "custom" }, "Custom dates…"));
    const from = h("input", { type: "date", id: "p-from", value: p.from || "", max: today(), "aria-label": "From date" }), to = h("input", { type: "date", id: "p-to", value: p.to, max: today(), "aria-label": "To date" });
    return h("section", { class: "periodbar", id: "periodbar" },
      h("div", { class: "pb-note", id: "period-note" }, h("div", null, p.fy ? [h("b", null, p.fyLabel), " (share-out to share-out) · "] : null, "Balances as at ", h("b", null, D.longDate(p.to))), h("div", null, "Activity covers ", h("b", null, p.from ? D.longDate(p.from) + " – " + D.longDate(p.to) : "start of records – " + D.longDate(p.to)))), sel,
      custom ? h("div", { class: "pb-custom" }, h("label", null, "From", from), h("label", null, "To", to), h("button", { class: "primary", id: "p-apply", onclick: () => { try { setPeriod(D.customPeriod(from.value, to.value, today())); } catch (e) { toast(e.message, true); } } }, "Show")) : null);
  }
  const kpiShow = (d) => d.unit === "%" ? (d.value == null ? "—" : d.value + "%") : d.unit === "count" ? String(d.value) : ugx(d.value);
  const download = (name, type, data) => { const a = h("a", { href: URL.createObjectURL(new Blob([data], { type })), download: name }); document.body.append(a); a.click(); a.remove(); };
  const heading = (c) => String(c).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (x) => x.toUpperCase());
  /* a report on screen: friendly headings, numbers right-aligned with thousands separators, rows open the record behind them */
  const tableFromReport = (rep, onRow) => {
    const numCol = (c) => rep.rows.length > 0 && rep.rows.every((r) => r[c] === "" || r[c] == null || typeof r[c] === "number");
    const acct = (n) => (n < 0 ? "(" + num(-n) + ")" : num(n)), tot = rep.totals || {};
    const cols = rep.columns.map((c) => ({ label: (rep.labels && rep.labels[c]) || heading(c), num: numCol(c) ? 1 : 0, neg: (r) => typeof r[c] === "number" && r[c] < 0, render: (r) => (typeof r[c] === "number" ? acct(r[c]) : r[c] == null ? "" : String(r[c])) }));
    const hasTot = rep.rows.length > 0 && rep.columns.some((c) => typeof tot[c] === "number");
    const foot = hasTot ? rep.columns.map((c, i) => (typeof tot[c] === "number" ? { text: acct(tot[c]), neg: tot[c] < 0 } : i === 0 ? { text: "Total" } : null)) : null;
    const tbl = Table(cols, rep.rows, onRow, "Nothing recorded for this period", foot);
    tbl.setAttribute("data-rep", "1"); return tbl;
  };
  function openRow(o, asAt) { if (!o || !o.id) return; if (o.kind === "member") openMember(o.id, asAt); else if (o.kind === "loan") openLoan(o.id, asAt); else if (o.kind === "entry") openEntry(o.id); }
  /* KPI -> drill-down -> entries -> PDF: the table, the totals and the PDF are all the same K.report() for the chosen period. */
  function openKpi(key) {
    const p = periodNow(), rep = K.report(st.db, key, p, { open: true }), k = rep.kpi, shown = k.unit === "UGX" ? ugx(k.value) : k.unit === "%" ? (k.value == null ? "—" : k.value + "%") : String(k.value);
    const tie = k.tied ? h("p", { class: "ok", "data-tie": "ok" }, "✓ The entries below add up to the figure on the dashboard: " + shown) : h("div", { class: "blocked", "data-tie": "bad" }, "These entries do not add up to the dashboard figure. Tell the Super Admin.");
    const km = Modal(rep.title, h("div", null, privacyToggle(), h("p", { class: "mute" }, rep.definition),
      rep.summary.length ? h("div", { class: "grid two" }, rep.summary.map(([l, v]) => Card(l, typeof v === "number" ? (/%/.test(l) ? v + "%" : ugx(v)) : String(v)))) : null,
      h("div", { class: "row" }, printButton(rep, rep.period, key + ".csv")),
      tableFromReport(rep, (r) => openRow(r._open, p.to)), tie)); km.el.setAttribute("data-rep", "1");
  }
  const PIPE = { Pending: "Loans to review", AwaitingApproval: "Loans awaiting Chairperson", Approved: "Approved, not yet paid out", Active: "Active loans", Cleared: "Fully repaid loans", Declined: "Declined loans" };

  /* ---------- HOME (mobile first). A dynamic dashboard: what it shows is computed from the signed-in role, the financial year chosen and the category chosen.
     Nothing here is a fixed page: add a category, a figure or a role rule to the registries below and the screen follows. ---------- */
  const FIG = {   // figure registry: label and the one-line explanation shown under it
    totalSavings: ["Total Savings", () => "Members' savings"], availableCash: ["Available Cash", (o) => "Cash at the start of the period: " + num(o.availableCash.opening)],
    outstandingLoans: ["Outstanding Loans", (o) => pl(o.outstandingLoans.count, "loan") + " owed"], interestReceivable: ["Interest Receivable", (o) => pl(o.interestReceivable.loans, "loan") + " · unpaid interest"],
    loanExposure: ["Loan Exposure", (o) => "Guaranteed " + ugx(o.loanExposure.guaranteed)], members: ["Members", () => "Active"],
    savingsReceived: ["Savings Received", (o) => pl(o.savingsReceived.count, "deposit")], withdrawals: ["Withdrawals & Share-Out", (o) => pl(o.withdrawals.count, "payment")],
    loansDisbursed: ["Loans Paid Out", (o) => pl(o.loansDisbursed.count, "loan")], repaymentsReceived: ["Loan Repayments", (o) => pl(o.repaymentsReceived.count, "payment")],
    interestReceived: ["Interest Received", () => "Interest part of repayments"], subscriptions: ["Subscriptions", (o) => o.subscriptions.count + " received"],
    otherIncome: ["Other Income", (o) => o.otherIncome.count + " entries"], profit: ["Profit Recorded", () => "Profit entries in the period"], expenses: ["Expenses", (o) => o.expenses.count + " entries"] };
  const STANDS = ["totalSavings", "availableCash", "outstandingLoans", "interestReceivable", "loanExposure", "members"], HAPPENED = ["savingsReceived", "withdrawals", "loansDisbursed", "repaymentsReceived", "interestReceived", "subscriptions", "otherIncome", "profit", "expenses"];
  /* category registry: lead figure (the big number), the figures listed, the colour that carries its meaning, and who may see it */
  const DCATS = [
    { k: "overview", t: "Overview", lead: "totalSavings", tone: "#10b981" },
    { k: "savings", t: "Savings", lead: "totalSavings", keys: ["totalSavings", "savingsReceived", "subscriptions"], tone: "#10b981", recent: ["Savings"], recentT: "Recent savings" },
    { k: "loans", t: "Loans", lead: "outstandingLoans", keys: ["outstandingLoans", "loanExposure", "loansDisbursed", "repaymentsReceived"], tone: "#0ea5e9", recentT: "Largest loan balances" },
    { k: "income", t: "Income", lead: "interestReceived", keys: ["interestReceived", "interestReceivable", "otherIncome", "profit"], tone: "#22c55e", recent: ["Loan Repayment"], recentT: "Recent repayments" },
    { k: "cash", t: "Cash", lead: "availableCash", keys: ["availableCash", "withdrawals", "expenses"], tone: "#6366f1", recent: ["Withdraw", "Expense", "Bank Charge"], recentT: "Recent payments out" },
    { k: "members", t: "Members", lead: "members", keys: ["members"], tone: "#6366f1", recentT: "Subscriptions" },
    { k: "governance", t: "Governance", roles: ["Admin", "Chairperson"], lead: null, tone: "#64748b", recentT: "Latest audit entries" }];
  const dcatsFor = () => DCATS.filter((c) => !c.roles || c.roles.includes(st.user.role));
  const dcatNow = () => { const l = dcatsFor(); return l.find((c) => c.k === st.dcat) || l[0]; };
  const compact = (n) => { n = Math.round(Number(n) || 0); const a = Math.abs(n), f = (v, u) => (n < 0 ? "-" : "") + (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + u; return a >= 1e9 ? f(a / 1e9, "B") : a >= 1e6 ? f(a / 1e6, "M") : a >= 1e3 ? f(a / 1e3, "K") : String(n); };
  const kcompact = (d) => d.unit === "%" ? kpiShow(d) : d.unit === "count" ? String(d.value) : compact(d.value);
  let memo = { stamp: "", v: {} };
  const ovFor = (p) => { const stamp = [(st.db.transactions || []).length, (st.db.loans || []).length, (st.db.auditLog || []).length, (st.db.yearCycles || []).length, today()].join("."); if (memo.stamp !== stamp) memo = { stamp, v: {} }; const k = p.from + "|" + p.to; return memo.v[k] || (memo.v[k] = K.overview(st.db, p)); };
  const fyRows = () => FYM.table(st.db).filter((c) => D.isISO(c.openedDate));
  /* attention: only what THIS role can act on. pending = orange, a problem that needs fixing = red, information = blue-grey */
  function attnItems(o, pipe) {
    const role = st.user.role, rows = [], isAdm = role === "Admin", isCh = role === "Chairperson", open = (st.db.discrepancies || []).filter((d) => d.status === "Open").length;
    if (st.live && CFG.build && st.store.serverBuild !== CFG.build && isAdm) rows.push({ kind: "overdue", text: "The Google backend is out of date. Paste the latest Code.gs and redeploy.", go: "system" });
    if (o.awaitingApproval && (isAdm || isCh)) rows.push({ kind: "pending", text: isCh ? "Waiting for your decision" : "Waiting for the Chairperson", n: o.awaitingApproval, go: "approvals" });
    if (pipe.Pending && (isAdm || isCh)) rows.push({ kind: "pending", text: pipe.Pending === 1 ? "Loan application to review" : "Loan applications to review", n: pipe.Pending, go: "loans" });
    if (pendingAirtime() && isAdm) rows.push({ kind: "pending", text: "Airtime requests", n: pendingAirtime(), go: "airtime" });
    if (open && (isAdm || isCh)) rows.push({ kind: "overdue", text: "Open reconciliation differences", n: open, go: "recon" });
    if (G.can(ctx(), "loan.repay")) { const cov = LN.settlementReview(st.db, today()).filter((r) => r.coveredToday); if (cov.length) rows.push({ kind: "info", text: cov.length === 1 ? "Loan the member's savings can settle" : "Loans the members' savings can settle", n: cov.length, go: "loans" }); }
    return rows;
  }
  const attnPanel = (rows, max) => h("section", { class: "panel attn", id: "attention" }, h("h2", null, "Needs your attention"),
    rows.length ? h("div", null, rows.slice(0, max || 4).map((r) => h("button", { class: "arow", "data-go": r.go, onclick: () => go(r.go) }, h("span", { class: "dot " + r.kind }), h("span", { class: "at" }, r.text), r.n ? h("span", { class: "ac" }, String(r.n)) : null, Icon("chevron", 16))))
      : h("div", { class: "allclear" }, Icon("check", 20), "Nothing needs attention right now."));
  const FKIND = { totalSavings: ["save", "wallet"], savingsReceived: ["save", "up"], subscriptions: ["save", "receipt"], availableCash: ["cash", "wallet"], outstandingLoans: ["loan", "loan"], loanExposure: ["loan", "shield"], loansDisbursed: ["loan", "loan"], interestReceivable: ["loan", "chart"], repaymentsReceived: ["loan", "down"], interestReceived: ["income", "chart"], otherIncome: ["income", "plus"], profit: ["income", "up"], expenses: ["expense", "down"], withdrawals: ["expense", "up"], members: ["cash", "users"] };
  const figRow = (key, o, prev) => {
    const d = o[key], [label, subf] = FIG[key]; let dl = null;
    if (prev && prev[key] && d.unit !== "%" && Number(prev[key].value)) { const pc = (Number(d.value) - Number(prev[key].value)) / Math.abs(Number(prev[key].value)) * 100; if (isFinite(pc)) dl = h("span", { class: "delta", title: "Compared with the previous financial year" }, (pc >= 0 ? "▲ " : "▼ ") + Math.abs(Math.round(pc * 10) / 10) + "%"); }
    const fk = FKIND[key] || ["cash", "chart"];
    return h("button", { class: "fig", "data-card": label, onclick: () => openKpi(key) }, h("span", { class: "fi k-" + fk[0] }, Icon(fk[1], 18)), h("span", { class: "fm" }, h("span", { class: "fk" }, label), h("span", { class: "fd", style: "display:block" }, subf(o))), h("span", { class: "val" }, kpiShow(d)), dl, Icon("chevron", 16, "go"));
  };
  const figList = (id, title, keys, o, prev, note) => h("section", { class: "panel figs", id }, h("div", { class: "fh" }, h("h2", null, title), note ? h("span", null, note) : null), keys.map((k) => figRow(k, o, prev)));
  /* the same figure across the financial years: bars you can tap. Shows the latest six; every year stays reachable */
  function trendPanel(cat, p) {
    const yrs = fyRows(); if (!yrs.length || !cat.lead) return null;
    const all = !!st.allYears, shown = all ? yrs : yrs.slice(-6), vals = shown.map((c) => ({ c, d: ovFor(fyPeriod(c))[cat.lead] })), mx = Math.max.apply(null, vals.map((x) => Math.abs(Number(x.d.value) || 0)).concat([1]));
    return h("div", { class: "trend", id: "year-bars", style: "--tone:" + cat.tone }, h("div", { class: "th" }, h("span", null, "Year by year"), yrs.length > 6 ? h("button", { class: "tmore", id: "all-years", onclick: () => { st.allYears = !st.allYears; render(); } }, all ? "Show latest 6" : "Show all " + yrs.length) : null),
      h("div", { class: "bars", role: "group", "aria-label": FIG[cat.lead][0] + " by financial year" }, vals.map(({ c, d }) => h("button", { class: "bar1" + (p.fy === c.year ? " on" : ""), "data-year": c.year, "aria-label": "FY" + c.year + ": " + kpiShow(d.value == null ? d : d), onclick: () => { setPeriod(fyPeriod(c)); } },
        h("span", { class: "bv" }, kcompact(d)), h("span", { class: "bb", style: "height:" + Math.max(3, Math.round(Math.abs(Number(d.value) || 0) / mx * 100)) + "px;max-height:84px" }), h("span", { class: "bl" }, "FY" + String(c.year).slice(-2))))));
  }
  function focusPanel(cat, o, p) {
    const d = o[cat.lead], prevC = p.fy ? fyRows().filter((c) => c.year < p.fy).pop() : null, prev = prevC ? ovFor(fyPeriod(prevC)) : null; let dl = null;
    if (prev && d.unit !== "%" && Number(prev[cat.lead].value)) { const pc = (Number(d.value) - Number(prev[cat.lead].value)) / Math.abs(Number(prev[cat.lead].value)) * 100; if (isFinite(pc)) dl = h("span", { class: "delta" }, (pc >= 0 ? "▲ " : "▼ ") + Math.abs(Math.round(pc * 10) / 10) + "% vs FY" + prevC.year); }
    const t = trendPanel(cat, p);
    return { prev, node: h("section", { class: "panel focus", id: "hero", style: "--tone:" + cat.tone }, h("div", { class: "fl" }, FIG[cat.lead][0], dl), h("div", { class: "fv", role: "button", tabindex: "0", "data-card-open": cat.lead, onclick: () => openKpi(cat.lead), onkeydown: (e) => { if (e.key === "Enter") openKpi(cat.lead); } }, kpiShow(d)), h("div", { class: "fs" }, FIG[cat.lead][1](o) + " · as at " + D.longDate(p.to)),
      t ? h("details", { class: "trend-d", open: window.matchMedia("(min-width:700px)").matches }, h("summary", null, "Year by year"), t) : null) };
  }
  const recentTx = (types, n, p) => L.activeTransactions(st.db).filter((t) => types.includes(t.type) && (!p || L.inPeriod(t, p))).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.timestamp || "") < String(a.timestamp || "") ? -1 : 1)).slice(0, n);
  const txRow = (t) => h("button", { class: "rrow", onclick: () => openEntry(t.id) }, h("span", { class: "rm" }, h("div", { class: "rt" }, nameOf(t.memberId)), h("div", { class: "rs" }, t.type + " · " + D.toDisplay(t.date))), h("span", { class: "rv" + (Number(t.amount) < 0 || /Withdraw|Expense|Charge/.test(t.type) ? " out" : "") }, ugx(Math.abs(Number(t.amount)))));
  const sectionD = (title, id, body, count) => h("details", { class: "panel recent sect-d", id, open: window.matchMedia("(min-width:1000px)").matches }, h("summary", null, h("span", null, title), count != null ? h("em", null, String(count)) : null), body);
  function breakdown(cat, o, p) {
    if (cat.k === "loans") { const b = K.loanBook(asAtDb(p.to), p.to).filter((v) => v.status === "Active" && v.balance > 0).sort((a, c) => c.balance - a.balance); return sectionD(cat.recentT, "recent", h("div", null, b.slice(0, 5).map((v) => h("button", { class: "rrow", onclick: () => openLoan(v.id) }, h("span", { class: "rm" }, h("div", { class: "rt" }, nameOf(st.db.loans.find((l) => l.id === v.id).memberId)), h("div", { class: "rs" }, v.id)), h("span", { class: "rv" }, ugx(v.balance)))), h("div", { class: "rrow-more" }, h("button", { onclick: () => go("loans") }, "All " + b.length + " active loans"))), b.length); }
    if (cat.k === "members") { const cm = C.subscriptionCompliance(asAtDb(p.to), p.to.slice(0, 4)), pct = cm.expected ? Math.round(cm.collected / cm.expected * 100) : 0;
      return sectionD("Subscriptions " + p.to.slice(0, 4), "recent", h("div", { class: "rbody" }, h("div", { class: "rs" }, ugx(cm.collected) + " collected of " + ugx(cm.expected) + " · " + pct + "%"), h("div", { class: "progbar" }, h("i", { style: "width:" + Math.min(100, pct) + "%" })), h("div", { class: "rrow-more" }, h("button", { onclick: () => drill("Unpaid subscriptions", null, Table([{ label: "Member", render: (id) => nameOf(id) }], cm.unpaid, null)) }, cm.unpaid.length + " members unpaid"), h("button", { onclick: () => go("subs") }, "Open subscriptions"))), null); }
    if (cat.k === "governance") { const a = (st.db.auditLog || []).filter((e) => { const d = String(e.date || e.timestamp || "").slice(0, 10); return (!p.from || d >= p.from) && d <= p.to; }).slice(-6).reverse(); return sectionD(cat.recentT, "recent", h("div", null, a.map((e) => h("div", { class: "rrow" }, h("span", { class: "rm" }, h("div", { class: "rt" }, e.action || e.type || "Change"), h("div", { class: "rs" }, (e.by || e.actor || "") + " · " + D.toDisplay(String(e.date || e.timestamp || "").slice(0, 10)))))), h("div", { class: "rrow-more" }, h("button", { onclick: () => go("audit") }, "Open the audit trail"))), null); }
    const types = cat.recent || ["Savings", "Loan Repayment", "Withdraw", "Loan Disbursement"], rows = recentTx(types, cat.k === "overview" ? 6 : 5, p);
    return sectionD(cat.k === "overview" ? "Recent activity" : cat.recentT, "recent", rows.length ? h("div", null, rows.map(txRow), h("div", { class: "rrow-more" }, h("button", { onclick: () => go("ledger") }, "Open the ledger"))) : h("div", { class: "rbody mute" }, "Nothing recorded in " + (p.fyLabel || "this period") + "."), rows.length);
  }
  /* one-tap shortcuts inside the balance card, like a mobile banking app: each role gets its own most-used screens */
  const QA = { Admin: [["ledger", "New entry"], ["members", "Members"], ["loans", "Loans"], ["reports", "Reports"]], Treasurer: [["ledger", "New entry"], ["subs", "Subscriptions"], ["loans", "Loans"], ["reports", "Reports"]], Chairperson: [["approvals", "Approvals"], ["loans", "Loans"], ["members", "Members"], ["reports", "Reports"]], Secretary: [["members", "Members"], ["reports", "Reports"], ["ledger", "Ledger"], ["loans", "Loans"]], Committee: [["members", "Members"], ["loans", "Loans"], ["reports", "Reports"], ["ledger", "Ledger"]] };
  function quickActions() {
    const items = (QA[st.user.role] || QA.Admin).map(([k, label]) => { const n = NAV_STAFF.find((x) => x[0] === k); return n && (!n[2] || n[2] === st.user.role) ? h("button", { class: "qa", "data-qa": k, onclick: () => go(k) }, h("span", { class: "qi" }, Icon(n[3], 22)), h("span", { class: "ql" }, label)) : null; }).filter(Boolean);
    return h("div", { class: "qas" }, items);
  }
  function dashboard() {
    const p = periodNow(), o = ovFor(p), pipe = K.pipeline(st.db), cat = dcatNow(), fo = cat.lead ? focusPanel(cat, o, p) : { prev: null, node: null }, prev = fo.prev, wrap = h("div", { id: "dash" });
    wrap.append(periodBar(), h("div", { class: "cats", role: "tablist", id: "tiles" }, dcatsFor().map((c) => h("button", { class: "cat" + (c.k === cat.k ? " on" : ""), role: "tab", "aria-selected": String(c.k === cat.k), "data-tile": c.k, onclick: () => { st.dcat = c.k; render(); } }, c.t))), fo.node);
    const rows = attnItems(o, pipe), lists = h("div", { class: "dlists" });
    if (cat.lead && cat.k === "overview" && isStaff()) fo.node.append(quickActions());
    const ap = attnPanel(rows, cat.k === "governance" ? 8 : 4); if (st.user.role === "Chairperson" && rows.length) ap.classList.add("first");
    wrap.append(h("div", { class: "dgrid" + (cat.lead ? "" : " solo") }, cat.lead ? fo.node : null, ap), lists);
    if (cat.k === "overview") {
      lists.append(figList("kpis", "Where the group stands", STANDS, o, prev, "As at " + D.longDate(p.to)), figList("activity", "What happened", HAPPENED, o, prev, p.from ? D.toDisplay(p.from) + " – " + D.toDisplay(p.to) : "All records"));
      const hl = FRP.historicalLoans(st.db, p.to);
      lists.append(h("section", { class: "panel figs", id: "reserve-kpis" }, h("div", { class: "fh" }, h("h2", null, "Reserve and older loans")),
        h("button", { class: "fig", "data-card": "General Reserve Fund", onclick: () => go("reserve") }, h("span", { class: "fm" }, h("span", { class: "fk" }, "General Reserve Fund"), h("span", { class: "fd", style: "display:block" }, "Group reserve")), h("span", { class: "val" }, ugx(RSV.balance(st.db, p.to))), Icon("chevron", 16, "go")),
        h("button", { class: "fig", "data-card": "Historical loans unpaid", onclick: () => drill(hl.title, null, tableFromReport(hl)) }, h("span", { class: "fm" }, h("span", { class: "fk" }, "Historical loans unpaid"), h("span", { class: "fd", style: "display:block" }, "Kept apart from loans owed")), h("span", { class: "val" }, ugx(hl.totals.principalUnpaid + hl.totals.interestUnpaid)), Icon("chevron", 16, "go"))));
    } else if (cat.keys) lists.append(figList("cat-kpis", cat.t + " figures", cat.keys, o, prev, p.fy ? p.fyLabel : ""));
    lists.append(breakdown(cat, o, p));
    return wrap;
  }
  /* MORE: every other screen as one grouped list, the way banking apps do it */
  function menuScreen() {
    const nav = NAV_STAFF.filter((n) => (!n[2] || n[2] === st.user.role) && n[0] !== "menu" && phoneTab(n[0]) < 0), groups = [];
    nav.forEach((n) => { const g = NAV_GROUP[n[0]] || "Other"; let G2 = groups.find((x) => x.g === g); if (!G2) groups.push(G2 = { g, items: [] }); G2.items.push(n); });
    return h("div", { id: "menu-screen" }, h("section", { class: "panel acct" }, h("span", { class: "avatar" }, (st.user.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()), h("div", { class: "am" }, h("div", { class: "an" }, st.user.name), h("div", { class: "ar" }, roleLabel(st.user.role) + (st.live ? "" : " · demo")))), groups.map((g) => h("section", { class: "mgroup" }, h("h2", { class: "sec" }, g.g), h("div", { class: "mlist" }, g.items.map(([k, l, , ic]) => { const b = navBadge(k); return h("button", { class: "mrow", "data-menu": k, onclick: () => go(k) }, Icon(ic, 22), h("span", { class: "mt" }, l), b ? h("span", { class: "badge-n" }, String(b)) : null, Icon("chevron", 16, "go")); })))));
  }
  /* SEARCH: reach any screen, member or loan from anywhere (press / or Ctrl+K on a computer) */
  function openSearch() {
    if (document.querySelector(".pal-bg")) return;
    const staff = isStaff(), nav = (staff ? NAV_STAFF : NAV_MEMBER).filter((n) => (!n[2] || n[2] === st.user.role) && !["menu", "more"].includes(n[0]));
    const input = h("input", { type: "search", id: "pal-input", placeholder: staff ? "Search screens, members, loans…" : "Where do you want to go?", "aria-label": "Search", autocomplete: "off", inputmode: "search" }), list = h("div", { class: "pal-list", id: "pal-list", role: "listbox" });
    const bg = h("div", { class: "pal-bg", onclick: (e) => { if (e.target === bg) close(); } }, h("div", { class: "pal", role: "dialog", "aria-modal": "true", "aria-label": "Search" }, input, list, h("div", { class: "pal-foot" }, h("span", null, "↑↓ to move"), h("span", null, "Enter to open"), h("span", null, "Esc to close"))));
    let items = [], sel = 0; const close = () => { document.removeEventListener("keydown", key, true); bg.remove(); };
    const run = (it) => { close(); it.run(); };
    const draw = () => { list.replaceChildren(); if (!items.length) { list.append(h("div", { class: "pal-empty" }, "Nothing matches that. Try a name, an SOB ID or a screen.")); return; } let lastH = "";
      items.forEach((it, i) => { if (it.h !== lastH) { list.append(h("div", { class: "pal-h" }, it.h)); lastH = it.h; } list.append(h("button", { class: "pal-i" + (i === sel ? " sel" : ""), role: "option", "data-pal": it.id, onclick: () => run(it) }, Icon(it.ic, 20), h("span", null, it.t, it.s ? h("small", null, it.s) : null))); });
      const s = list.querySelector(".sel"); if (s && s.scrollIntoView) s.scrollIntoView({ block: "nearest" }); };
    const build = (q) => { q = q.trim().toLowerCase(); const out = [];
      nav.filter((n) => !q || n[1].toLowerCase().includes(q) || (NAV_GROUP[n[0]] || "").toLowerCase().includes(q)).slice(0, q ? 6 : 8).forEach((n) => out.push({ h: "Go to", id: n[0], ic: n[3], t: n[1], s: NAV_GROUP[n[0]] || "", run: () => go(n[0]) }));
      if (staff && q.length >= 2) { (st.db.members || []).filter((m) => (m.name || "").toLowerCase().includes(q) || (m.id || "").toLowerCase().includes(q) || String(m.phone || "").replace(/\s/g, "").includes(q.replace(/\s/g, ""))).slice(0, 6).forEach((m) => out.push({ h: "Members", id: m.id, ic: "user", t: m.name, s: m.id, run: () => { go("members"); openMember(m.id); } }));
        (st.db.loans || []).filter((l) => !l.voided && ((l.id || "").toLowerCase().includes(q) || nameOf(l.memberId).toLowerCase().includes(q))).slice(0, 5).forEach((l) => out.push({ h: "Loans", id: l.id, ic: "loan", t: nameOf(l.memberId), s: l.id + " · " + l.status, run: () => { go("loans"); openLoan(l.id); } })); }
      items = out; sel = 0; draw(); };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); } else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); } else if (e.key === "Enter" && items[sel]) { e.preventDefault(); run(items[sel]); } };
    document.addEventListener("keydown", key, true); input.addEventListener("input", () => build(input.value)); document.body.append(bg); build(""); input.focus();
  }
  document.addEventListener("keydown", (e) => { if (!st.user || document.querySelector(".pal-bg")) return; const t = e.target, typing = t && /INPUT|TEXTAREA|SELECT/.test(t.tagName); if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) { e.preventDefault(); openSearch(); } });
  /* ---------- the full member statement: one account object feeds this screen, the PDF and the WhatsApp text ---------- */
  const SX = S.statements;
  const accountRep = (a) => ({ title: (a.audience === "admin" ? "Administrative " + (a.mode === "loan" ? "loan statement " + a.loanId : "account statement") : (a.mode === "loan" ? "Loan statement " + a.loanId : "Member account statement")) + " — " + a.member.name + " (" + a.member.id + ")", period: a.period.text, printHTML: (meta) => SX.toPrintHTML(a, meta) });
  const printAccount = (memberId, period, internal, loanId, download) => { const a = SX.memberAccount(st.db, memberId, period || {}, { internal: !!internal, audience: internal && canAdminStatement() ? "admin" : "member", loanId: loanId || "" }); return (download ? downloadReport : printReport)(accountRep(a), a.period.text); };
  const statementText = (a) => ["*Sons of Bethel (SOB) Savings Group*", "Statement " + a.ref, a.member.name + " (" + a.member.id + ")", a.period.text, "", "Opening savings: " + ugx(a.savings.opening), "Deposits: " + ugx(a.savings.deposits), "Profit credited: " + ugx(a.savings.profit), "Withdrawals: " + ugx(a.savings.withdrawals), "Share-outs: " + ugx(a.savings.shareOuts), "*Closing savings: " + ugx(a.savings.closing) + "*"]
    .concat(a.loans.length ? ["", "Loans owed: " + ugx(a.loanTotals.owed) + " (loan " + ugx(a.loanTotals.principalLeft) + " + interest " + ugx(a.loanTotals.interestDue) + ")"] : []).concat(["", "CONFIDENTIAL: for the named member only. Full PDF statement available from the Treasurer."]).join("\n");
  /* ---------- privacy switch: show SOB IDs instead of member names in reports (display only; nothing stored is changed) ---------- */
  try { st.hideNames = sessionStorage.getItem("sob.hideNames") === "1"; } catch (e) { st.hideNames = false; }
  const PV = () => window.SOB.privacy.build(st.db.members);
  const shownRep = (rep) => (st.hideNames ? PV().hideReport(rep) : rep);
  const shownText = (t) => (st.hideNames ? PV().hideText(t) : t);
  const shownHTML = (h2) => (st.hideNames ? PV().hideHTML(h2) : h2);
  const originals = new WeakMap();
  /* report areas are marked data-rep; names in them are swapped for IDs (and back) in place, so every open preview follows the switch at once */
  function applyPrivacy() {
    const pv = st.hideNames ? PV() : null;
    document.querySelectorAll("[data-rep]").forEach((box) => { const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (pv) { if (!originals.has(n)) originals.set(n, n.data); const t = pv.hideText(originals.get(n)); if (n.data !== t) n.data = t; } else if (originals.has(n)) { n.data = originals.get(n); originals.delete(n); } } });
  }
  let pvTimer = null; new MutationObserver(() => { if (pvTimer) return; pvTimer = setTimeout(() => { pvTimer = null; applyPrivacy(); }, 0); }).observe(document.body, { childList: true, subtree: true });
  const setHideNames = (v) => { st.hideNames = !!v; try { sessionStorage.setItem("sob.hideNames", v ? "1" : "0"); } catch (e) {} document.querySelectorAll("[data-hide-names]").forEach((c) => { c.checked = !!v; }); applyPrivacy(); };
  const privacyToggle = () => (isStaff() ? h("label", { class: "pv-toggle" }, h("input", { type: "checkbox", "data-hide-names": 1, checked: st.hideNames, onchange: (e) => setHideNames(e.target.checked) }), " Hide member names (show SOB IDs only)") : null);
  /* WhatsApp: always opens WhatsApp itself (the app on a phone, WhatsApp Web on a computer) with the message ready; never the Windows/OS share list */
  const waSend = (text) => { const a = document.createElement("a"); a.href = "https://wa.me/?text=" + encodeURIComponent(shownText(text)); a.target = "_blank"; a.rel = "noopener"; a.style.display = "none"; document.body.append(a); a.click(); a.remove(); };
  /* Two statements: the MEMBER statement (own savings, loans, balances, history) and the ADMINISTRATIVE statement (references, corrections, reserve, audit notes). Only officers who may read the audit trail can open the second; a member can never receive its data (the server removes it). */
  /* the purposes offered in the entry form: the standard list plus whatever the Super Admin added (G.listOptions), always with Other (Specify) */
  /* a managed list (Administrator adds/retires options, audited) offered in a form, always with Other (Specify) */
  const listField = (name, label, key, extra) => Object.assign({ name, label, options: G.listOptions(st.db, key), other: true }, extra || {});
  const reasonField = (key, label) => listField("reason", label || "Reason", key);
  const purposeChoices = () => { const seen = {}; return Object.keys(G.LIST_DEFAULTS).filter((k) => k.indexOf("purpose.") === 0).reduce((o, k) => o.concat(G.listOptions(st.db, k)), []).filter((x) => !seen[x] && (seen[x] = 1)); };
  const pl = (n, w) => n + " " + w + (Number(n) === 1 ? "" : "s");   // 1 loan, 2 loans
  const canAdminStatement = () => st.user && st.user.role !== "Member" && G.can(ctx(), "audit.view");
  function statementView(memberId, internal, toDate) {
    const maxTo0 = () => toDate || today();
    let aud = "member";   // officers start on the Member statement: that is the one safe to print for a member
    const box = h("div", { id: "stmt-view", "data-rep": "1" }), PRE = D.presetOptions(maxTo0(), FYM.table(st.db)).filter((x) => ["all", "year", "lastYear", "month", "custom"].includes(x[0]));
    let key = "all", cust = null; const maxTo = toDate || today();
    const periodOf = () => (key === "custom" && cust ? cust : (() => { const p = D.presetPeriod(key, maxTo, FYM.table(st.db)); return p; })());
    const lines = (rows) => h("div", { class: "panel kvs" }, rows.map(([l, v, cls]) => h("div", { class: "kv" + (cls ? " " + cls : "") }, h("span", null, l), h("b", null, typeof v === "number" ? ugx(v) : v))));
    const paint = () => {
      const p = periodOf(), a = SX.memberAccount(st.db, memberId, { from: p.from, to: p.to > maxTo ? maxTo : p.to }, { internal: aud === "admin", audience: aud }), s = a.savings, adm = aud === "admin";
      const yrs = a.years.filter((y) => !p.from || !y.closed || y.closed > p.from);   // a year that closed on the day this period starts belongs to the previous period
      const byType = (label, test) => () => drill(label + " — " + a.period.text, null, Table([{ label: "Date", render: (x) => D.toDisplay(x.date) }, { label: "Ref", key: "ref" }, { label: "Transaction", key: "type" }, { label: "Amount", num: 1, render: (x) => num(x.amount) }], a.transactions.filter(test), adm ? (x) => openEntry(x.ref) : null, "Nothing in this period"));
      const cards = [["Opening savings", s.opening, null, null], ["Deposits", s.deposits, "avail", byType("Deposits", (x) => x.type === "Savings deposit")], ["Profit credited", s.profit, "profit", byType("Profit credited", (x) => x.type === "Profit share")], ["Withdrawals", s.withdrawals, "loan", byType("Withdrawals", (x) => /Withdrawal|Bank charge/.test(x.type))], ["Share-outs", s.shareOuts, "loan", byType("Share-outs", (x) => x.type === "Annual share-out")], ["Closing savings", s.closing, null, null]];
      box.replaceChildren(h("div", null,
        internal && canAdminStatement() ? Chips([["member", "Member statement"], ["admin", "Administrative statement (officers only)"]], aud, (k) => { aud = k; paint(); }) : null,
        adm ? Banner("warn", "ADMINISTRATIVE STATEMENT. Officers only. Do not send to the member.") : null,
        Chips(PRE, key, (k) => { key = k; if (k === "custom" && !cust) cust = D.customPeriod(maxTo.slice(0, 8) + "01", maxTo, maxTo); paint(); }),
        key === "custom" ? h("div", { class: "pb-custom" }, h("label", null, "From", h("input", { type: "date", id: "stm-from", value: (cust && cust.from) || "", max: maxTo })), h("label", null, "To", h("input", { type: "date", id: "stm-to", value: (cust && cust.to) || maxTo, max: maxTo })), h("button", { class: "primary", id: "stm-apply", onclick: () => { try { cust = D.customPeriod(document.getElementById("stm-from").value, document.getElementById("stm-to").value, maxTo); paint(); } catch (e) { toast(e.message, true); } } }, "Show")) : null,
        h("p", { class: "mute", id: "stm-period" }, h("b", null, a.member.name + " · " + a.member.id), " · " + a.period.text + (p.fy ? " · " + p.fyLabel + " (share-out to share-out)" : "")),
        h("div", { class: "grid two", id: "stm-summary" }, cards.map(([l, v, tone, open]) => Card(l, ugx(v), null, open, tone))),
        s.checks.movementsAddUp ? null : Banner("bad", "These figures do not add up to the ledger. Please tell the Treasurer before relying on this statement."),
        privacyToggle(), h("div", { class: "row" }, exportMenu({ id: "stm-export", rep: () => accountRep(a), period: a.period.text, wa: () => statementText(a), csv: { name: (adm ? "admin_statement_" : "statement_") + a.member.id + ".csv", get: () => R.toCSV({ columns: adm ? ["date", "ref", "type", "details", "amount", "effect", "balance"] : ["date", "type", "details", "amount", "effect", "balance"], rows: a.transactions, totals: {}, title: a.ref }) } })),
        yrs.length > 1 ? h("h2", { class: "sec" }, "By financial year") : null, yrs.length > 1 ? Table([{ label: "Year", render: (y) => y.label + (y.open ? " (open)" : "") }, { label: "Opening", num: 1, render: (y) => num(y.opening) }, { label: "Deposits", num: 1, render: (y) => num(y.deposits) }, { label: "Profit", num: 1, render: (y) => num(y.profit) }, { label: "Withdrawn", num: 1, render: (y) => num(y.withdrawals) }, { label: "Share-out", num: 1, render: (y) => num(y.shareOuts) }, { label: "Closing", num: 1, render: (y) => num(y.closing) }], yrs, null, "No financial year in this period") : null,
        adm ? h("p", { class: "mute rg-blurb" }, a.reserve.text) : null,
        h("h2", { class: "sec" }, "Loans"), a.loans.length || a.earlier.length ? null : h("p", { class: "mute" }, "No loans on record for this member."),
        a.loans.map((l) => h("div", { class: "panel loanp", "data-loan-ref": l.ref }, h("div", { class: "lh" }, h("b", null, "Loan " + l.ref), badge(l.status, l.totalOwed ? "loan" : "ok")),
          lines([["Loan paid out", l.principal], ["Date paid out", l.dateText]].concat(adm ? [["Payout entry", l.disbursementRef || "—"]] : []).concat([["Agreed interest per month", l.monthlyInterest], ["Interest charged to date", l.accruedInterest], ["Interest paid", l.interestPaid], ["Interest still due", l.interestDue], ["Loan repaid so far", l.principalPaid], ["Loan still owed", l.principalLeft], ["TOTAL OWED", l.totalOwed, "tot"]])),
          l.checks.partsAddUp ? null : Banner("bad", "This loan's parts do not add up to the ledger."),
          l.repayments.length ? Table([{ label: "Date", render: (r) => D.toDisplay(r.date) }].concat(adm ? [{ label: "Ref", key: "ref" }] : []).concat([{ label: "Paid", num: 1, render: (r) => num(r.amount) }, { label: "To interest", num: 1, render: (r) => num(r.interest) }, { label: "To loan", num: 1, render: (r) => num(r.principal) }, { label: "Loan left", num: 1, render: (r) => num(r.principalLeft) }]), l.repayments, null) : h("p", { class: "mute rg-blurb" }, "No repayments yet."))),
        a.earlier.filter((l) => !(p.from && D.isISO(l.date) && l.date < p.from && !l.totalOwed)).map((l) => h("div", { class: "panel loanp" }, h("div", { class: "lh" }, h("b", null, adm ? "Earlier loan " + l.ref : "Earlier loan" + (l.dateText ? " (" + l.dateText + ")" : "")), badge(l.status, l.totalOwed ? "loan" : "ok")), lines([["Paid out", l.disbursed], ["Interest charged", l.interestCharged], ["Interest received", l.interestReceived], ["Loan repaid", l.principalRepaid], ["Still owed", l.totalOwed, "tot"]]), Table([{ label: "Date", render: (r) => r.date }, { label: "Event", render: (r) => adm ? r.event : String(r.event || "").replace(/\s*\(decision #\d+\)/i, "") }, { label: "Amount", num: 1, render: (r) => num(r.amount) }, { label: "Owed after", num: 1, render: (r) => num(r.owedAfter) }], l.rows, null))),
        h("h2", { class: "sec" }, adm ? "Every transaction · tap one to review it" : "Every transaction"), Table([{ label: "Date", render: (x) => D.toDisplay(x.date) }].concat(adm ? [{ label: "Ref", key: "ref" }] : []).concat([{ label: "Transaction", key: "type" }], adm || a.transactions.some((x) => x.details) ? [{ label: "Details", key: "details" }] : [], [{ label: "Amount", num: 1, render: (x) => num(x.amount) }, { label: "Effect", num: 1, render: (x) => num(x.effect) }, { label: "Balance", num: 1, render: (x) => num(x.balance) }]), a.transactions.slice().reverse().slice(0, 150), adm ? (x) => openEntry(x.ref) : null, "No transactions in this period"),
        a.transactions.length > 150 ? h("p", { class: "mute" }, "Showing the latest 150 of " + a.transactions.length + " — the PDF has all of them.") : null,
        adm && a.notes.length ? h("div", null, h("h2", { class: "sec" }, "Corrections and audit notes"), Table([{ label: "Date", render: (n) => D.toDisplay(n.date) }, { label: "Ref", key: "ref" }, { label: "Note", key: "note" }], a.notes.slice(0, 60), null)) : null,
        adm && (a.pending.length || a.review.length) ? h("div", null, h("h2", { class: "sec" }, "For the officers: awaiting decision"), a.pending.length ? Table([{ label: "Request", key: "ref" }, { label: "Action", key: "label" }, { label: "Detail", key: "summary" }], a.pending, null) : null, a.review.length ? Table([{ label: "Register item", key: "ref" }, { label: "Kind", key: "kind" }, { label: "Detail", key: "summary" }], a.review, null) : null) : null));
    };
    paint(); return box;
  }
  function openStatement(memberId, internal) { Modal("Statement", statementView(memberId, internal)); }
  /* the ledger as it stood on a past day (entries after it removed) */
  const asAtDb = (asOf) => Object.assign({}, st.db, { transactions: (st.db.transactions || []).filter((t) => t.date <= asOf) });
  /* Every PDF/print goes through here -> R.toPrintHTML -> mandatory SOB header + footer (repeats on every page). Printed from a hidden frame (no pop-up blocking). */
  function printReport(rep, period) {
    return Busy.run("Preparing your PDF…", () => new Promise((res) => {
      const meta = { generated: D.toDisplay(today()), period: period || rep.period || "As at " + D.toDisplay(today()) };
      /* Opens the branded statement in its own tab: desktop prints straight away; on a phone use "Print / Save as PDF" there (then share the PDF on WhatsApp). */
      const render = (m) => shownHTML(rep.printHTML ? rep.printHTML(m) : R.toPrintHTML(rep, m));
      const w = window.open(URL.createObjectURL(new Blob([render(Object.assign({ toolbar: true }, meta))], { type: "text/html" })), "_blank");
      if (w) { setTimeout(res, 300); return; }
      toast("Please allow pop-ups for this page to open the PDF.", "warn");
      const f = document.createElement("iframe"); f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"; document.body.append(f);
      const d = f.contentWindow.document; d.open(); d.write(render(meta)); d.close();
      setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast("Could not open the print dialog", true); } setTimeout(() => f.remove(), 60000); res(); }, 400);
    }));
  }
  /* Download PDF: builds the same branded document as a real PDF file and saves it straight to the device (no print dialog). */
  function downloadReport(rep, period) {
    return Busy.run("Building your PDF…", () => new Promise((res) => setTimeout(() => {
      try {
        const meta = { generated: D.toDisplay(today()), period: period || rep.period || "As at " + D.toDisplay(today()) };
        const html = shownHTML(rep.printHTML ? rep.printHTML(meta) : R.toPrintHTML(rep, meta));
        const bytes = window.SOB.pdf.fromHTML(html);
        window.SOB.pdf.save(bytes, window.SOB.pdf.fileName(rep.title || "SOB_report", today()));
        toast("PDF saved to your device.");
      } catch (e) { toast("Could not build the PDF: " + (e && e.message || e), true); }
      res();
    }, 30)));
  }
  /* ONE "Export / Share" button for authorised officers (Super Admin, Chairperson, Treasurer): PDF, print, WhatsApp and CSV live inside it. Members and view-only roles never see it; the permission is report.export. */
  const canExport = () => !!st.user && isStaff() && G.can(ctx(), "report.export");
  function exportMenu(o) {
    if (!canExport()) return null;
    const get = () => (typeof o.rep === "function" ? o.rep() : o.rep);
    const item = (id, ic, title, sub, attr, fn) => h("button", Object.assign({ class: "xm-item", id }, attr, { onclick: () => { m.close(); setTimeout(fn, 60); } }), Icon(ic, 22), h("span", null, h("b", null, title), h("small", null, sub)));
    let m;
    return h("button", { class: "primary", id: o.id || "export-menu", "data-export": 1, onclick: () => {
      m = Modal("Export / Share", h("div", { class: "xmenu" }, privacyToggle(),
        item("xm-dl", "download", "Download PDF", "Save a PDF to this device", { "data-dlpdf": 1 }, () => downloadReport(get(), o.period)),
        item("xm-print", "print", "Print / Save as PDF", "Opens the print page", { "data-print": 1 }, () => printReport(get(), o.period)),
        o.wa ? item("xm-wa", "share", "Share on WhatsApp", "Opens WhatsApp with the message ready", { "data-wa": 1 }, () => waSend(o.wa())) : null,
        o.xlsx ? item("xm-xlsx", "download", "Download Excel", "An Excel workbook (.xlsx)", { "data-xlsx": 1 }, () => { const r = shownRep(get()); download(window.SOB.pdf.fileName(r.title || "SOB_report", today()).replace(/\.pdf$/i, ".xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", window.SOB.xlsx.build(r, { generated: D.toDisplay(today()) })); toast("Excel file saved to your device."); }) : null,
        o.csv ? item("xm-csv", "download", "Download CSV", "A plain text file that opens in any spreadsheet", { "data-csv": 1 }, () => download(o.csv.name, "text/csv", o.csv.get ? o.csv.get() : R.toCSV(shownRep(get())))) : null));
    } }, Icon("share", 18), " Export / Share");
  }
  const printButton = (rep, period, csvName) => exportMenu({ rep, period, csv: csvName ? { name: csvName } : null });

  /* ---------- members ---------- */
  function openMember(id, asAt0) {
    const m = st.db.members.find((x) => x.id === id); if (!m) return;
    const asAt = asAt0 || today(), hist = asAt < today(), dd = asAtDb(asAt), pos = L.memberPositionAsAt(st.db, id, asAt);
    const loans = L.activeLoansAsAt(dd, asAt).filter((l) => l.memberId === id), owed = loans.reduce((a, l) => a + Math.max(0, L.loanOutstanding(l, dd, asAt)), 0);
    drill(m.id + " — " + m.name, null, h("div", null, hist ? Banner("info", "Showing this member as at " + D.longDate(asAt) + ". Open them from the Members page for today's position.") : null,
      h("div", { class: "grid" }, Card("Savings" + (hist ? " (as at " + D.longDate(asAt) + ")" : ""), ugx(pos.savings), "From the ledger"), Card("Guarantee committed", ugx(pos.committed)), Card("Available", ugx(pos.available)), Card("Outstanding loan", ugx(owed))),
      h("p", { class: "mute", id: "member-contact" }, "WhatsApp / phone: " + (m.phone || "not recorded") + "  ·  E-mail: " + (m.email || "not recorded") + "  ·  Location: " + (m.location || "not recorded")),
      st.live && st.user.role === "Admin" && !hist ? h("div", { class: "row" }, h("button", { "data-act": "edit-contact", onclick: () => Form("Edit contact details — " + m.name + " (" + m.id + ")", [
          { name: "phone", label: "WhatsApp / phone number (Uganda, e.g. 0772 123 456 or +256 772 123 456)", value: m.phone || "", type: "tel", inputmode: "tel" },
          { name: "email", label: "E-mail address (optional)", value: m.email || "", type: "email" },
          listField("location", "Location / area (optional)", "member.Location", { value: m.location || "", optional: true }),
          { name: "allowShared", label: "If another member already has this number", options: [{ value: "", label: "Refuse (recommended)" }, { value: "yes", label: "Allow: these members really share one number" }] },
          { name: "reason", label: "Reason (optional) — e.g. member gave a new number", value: "" },
          { name: "note", type: "note", text: "Only contact details change. Every change is recorded in the audit trail." }],
          act(async (f) => { await commit("updateMemberContact", { memberId: m.id, phone: f.phone, email: f.email, location: f.location, allowShared: f.allowShared === "yes", reason: f.reason }); document.querySelectorAll(".modal-bg").forEach((e) => e.remove()); openMember(m.id); }, "Contact details saved")) }, "Edit contact details"), (st.db.users || []).some((u) => u.id === m.id)
        ? h("button", { "data-act": "reset-pin", onclick: () => Form("Reset password for " + m.name, [{ name: "n", label: "New password (4+ characters)", type: "password" }], act(async (f) => { await st.store.setPin(f.n, undefined, m.id); }, "PIN reset")) }, "Reset PIN")
        : h("button", { "data-act": "create-signin", onclick: () => Form("Create sign-in for " + m.name, [{ name: "n", label: "Initial password (4+ characters)", type: "password" }], act(async (f) => { await st.store.createUser({ id: m.id, name: m.name, role: "Member", memberId: m.id, pin: f.n }); await st.store.load(); st.db = st.store.db; }, "Sign-in created")) }, "Create sign-in")) : null,
      h("h2", { class: "sec" }, "Loans"), Table(loanCols, K.loanBook(dd, asAt).filter((v) => loans.some((l) => l.id === v.id)), (v) => openLoan(v.id, asAt)),
      h("h2", { class: "sec" }, "Statement"), statementView(id, true, asAt)));
  }
  /* live search: only the result area is redrawn, so typing never loses focus */
  const Searchable = (placeholder, build) => { let q = ""; const box = h("div"); const paint = () => box.replaceChildren(build(q.trim().toLowerCase())); const inp = h("input", { type: "search", class: "search", placeholder, "aria-label": placeholder, oninput: (e) => { q = e.target.value; paint(); } }); paint(); return h("div", null, inp, box); };
  function members() {
    return h("div", null, h("div", { class: "row" }, G.can(ctx(), "member.manage") ? h("button", { class: "primary", id: "add-member", onclick: () => Form("Add member", [{ name: "name", label: "Full name" }, { name: "phone", label: "Phone" }], act(async (v) => commit("addMember", { name: v.name, phone: v.phone }), "Member added")) }, "Add member") : null),
      Searchable("Search members by name, ID or phone", (q) => Table([{ label: "ID", key: "id", m: "s" }, { label: "Name", key: "name", m: "t" }, { label: "Savings", num: 1, m: "v", render: (m) => num(L.memberSavings(st.db, m.id)) }], st.db.members.filter((m) => !q || (m.id + " " + m.name + " " + (m.phone || "")).toLowerCase().includes(q)), (m) => openMember(m.id))));
  }

  /* ---------- loans ---------- */
  /* A loan looked at on a past date (from a dashboard figure): its position that day, read-only. Actions belong to today's view. */
  function openLoanAsAt(loan, asAt) {
    const dd = asAtDb(asAt), paid = loan.date <= asAt, v = LN.loanView(dd, loan, asAt), w = L.loanInterestPosition(loan, dd, asAt);
    drill("Loan " + loan.id + " — as at " + D.longDate(asAt), null, h("div", null, Banner("info", "Showing this loan as it stood on " + D.longDate(asAt) + ". Open it from the Loans page for today's position and actions."),
      h("p", null, "Member: ", nameOf(loan.memberId), " · paid out ", loan.dateUnknown ? "on a date that is not established (the system placeholder " + D.toDisplay(loan.date) + " is not a verified date; interest shown is indicative)" : D.toDisplay(loan.date), paid ? "" : " (after this date, so nothing was owed yet)"),
      paid ? h("div", null, h("div", { class: "grid" }, Card("Loan amount", ugx(v.principal)), Card("Monthly interest", ugx(v.assignedMonthlyInterest)), Card("Interest charged to date", ugx(v.accumulatedInterest)), Card("Repaid to date", ugx(v.repaid)), Card("Unpaid interest", ugx(w.unpaidInterest)), Card("Loan (principal) left", ugx(w.principalOutstanding)), Card("Still owed", ugx(v.balance))),
        h("h2", { class: "sec" }, "Repayments up to this date"), Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Amount", num: 1, render: (t) => num(t.amount) }], L.activeTransactions(dd).filter((t) => t.loanId === loan.id && t.type === "Loan Repayment"), (t) => openEntry(t.id)),
        h("h2", { class: "sec" }, "Guarantors on this date"), Table([{ label: "Guarantor", render: (g) => nameOf(g.guarantorId) }, { label: "Guaranteed", num: 1, render: (g) => num(g.amount) }, { label: "Still committed", num: 1, render: (g) => num(L.guaranteeRemainingAsOf(g, asAt)) }], (st.db.guarantees || []).filter((g) => g.loanId === loan.id && (g.status === "Active" || g.status === "Released") && !(g.dateCommitted && g.dateCommitted > asAt)))) : null));
  }
  /* LOCK / UNLOCK INTEREST: show the loan's own history first (what was lent, repaid, how many months are charged, what is owed) and a live preview of the chosen date. */
  function lockForm(loan, v) {
    const unlock = v.interestLocked, id = loan.id, T = today();
    const reps = (L.activeTransactions(st.db) || []).filter((t) => t.loanId === id && t.type === "Loan Repayment").sort((a, b) => (a.date < b.date ? -1 : 1));
    const locks = loan.interestLocks || [];
    const owedWith = (lk) => { const c2 = Object.assign({}, loan, { interestLocks: (loan.interestLocks || []).concat(lk ? [lk] : []) }); return { months: L.loanMonthsAfterGrace(c2, T), owed: L.loanOutstanding(c2, st.db, T) }; };
    const now = owedWith(null), preview = h("p", { class: "mute", id: "lock-preview" });
    const box = h("div", { id: "lock-context" },
      h("p", null, h("b", null, nameOf(loan.memberId)), " · loan paid out ", D.toDisplay(loan.date), " · ", Number(loan.loanAmount).toLocaleString(), " UGX"),
      h("div", { class: "grid" }, Card("Monthly interest", ugx(v.assignedMonthlyInterest)), Card("Months charged", String(v.unpaidMonths), "from payout to " + D.toDisplay(T)), Card("Interest so far", ugx(v.accumulatedInterest)), Card("Repaid so far", ugx(v.repaid)), Card("Owed today", ugx(v.balance))),
      h("p", { class: "mute" }, reps.length ? "Repayments:" : "No repayments recorded yet."),
      reps.length ? Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Amount", num: 1, render: (t) => num(t.amount) }], reps) : null,
      locks.length ? h("div", null, h("p", { class: "mute" }, "Earlier lock periods:"), Table([{ label: "From", render: (l) => D.toDisplay(l.from) }, { label: "To", render: (l) => D.isISO(l.to) ? D.toDisplay(l.to) : "still locked" }, { label: "Reason", key: "reason" }], locks)) : null,
      h("p", { class: "mute" }, unlock ? "Unlocking makes interest grow again from the date you choose. Months inside the locked period stay free." : "Locking stops NEW interest from the date you choose. Months before it stay charged; nothing recorded is changed. The Chairperson must approve."), preview);
    const m = Form(unlock ? "Unlock interest on this loan" : "Lock interest on this loan", [{ type: "note", node: box }, dateF("date", unlock ? "Unlock date" : "Lock from"), { name: "reason", label: "Reason (required)" }],
      act(async (f) => { await commit(unlock ? "unlockInterest" : "lockInterest", { loanId: id, date: f.date, reason: f.reason }); M().remove(); openLoan(id); }, unlock ? "Interest unlocked" : "Interest locked"));
    const di = m.el.querySelector('input[name="date"]');
    const upd = () => { const d = di && di.value; if (!D.isISO(d)) { preview.textContent = ""; return; }
      if (unlock) { const open = locks.find((l) => !D.isISO(l.to)); preview.textContent = open && d >= open.from ? "Locked since " + D.toDisplay(open.from) + ". If unlocked on " + D.toDisplay(d) + ", interest grows again from then." : "";
      } else if (loan.date && d < loan.date) preview.textContent = "That date is before the loan was paid out (" + D.toDisplay(loan.date) + ").";
      else { const w = owedWith({ from: d, to: "" }); preview.textContent = "If locked from " + D.toDisplay(d) + ": months charged " + now.months + " → " + w.months + " (today). Owed today " + ugx(now.owed) + " → " + ugx(w.owed) + ". Interest stops growing from that date."; } };
    if (di) { di.addEventListener("input", upd); di.addEventListener("change", upd); upd(); }
  }
  /* a small live-preview panel for a form: compute() returns {rows:[[label,value,cls]], error, note}; the Save button is off while there is an error */
  function livePanel(m, names, compute) {
    const box = h("div", { class: "preview" }), go = m.el.querySelector("[data-submit]"); m.el.querySelector(".err").before(box);
    const q = (n) => m.el.querySelector('[name="' + n + '"]'), row = (r) => h("div", { class: "pv-row " + (r[2] || "") }, h("span", null, r[0]), h("b", null, r[1]));
    const upd = () => { let r; try { r = compute((n) => (q(n) ? q(n).value : "")); } catch (e) { console.error("[SOB] preview:", e); r = { error: "Cannot show the result for these values." }; }
      box.replaceChildren(...(r.rows || []).map(row), r.error ? Banner("bad", r.error) : null, r.note ? h("p", { class: "mute" }, r.note) : null); if (go) go.disabled = !!r.error; };
    names.forEach((n) => { const e = q(n); if (e) { e.addEventListener("input", upd); e.addEventListener("change", upd); } }); upd();
  }
  function repayForm(loan, id) {
    const m = Form("Record repayment", [{ name: "amount", label: "Amount (UGX)", type: "number" }, dateF("date", "Payment date (today unless you change it)")], act(async (f) => { await commit("repayLoan", { loanId: id, amount: f.amount, date: f.date }); M().remove(); openLoan(id); }, "Repayment recorded"));
    livePanel(m, ["amount", "date"], (g) => { const a = Number(g("amount")), d = g("date");
      if (!D.isISO(d)) return { error: "Pick a date." }; if (loan.date && d < loan.date) return { error: "That date is before the loan was paid out (" + D.toDisplay(loan.date) + ")." };
      const owed = L.loanOutstanding(loan, st.db, d); if (!(a > 0)) return { rows: [["Owed on " + D.toDisplay(d), ugx(owed)]], note: "Type the amount to see the result." };
      if (a > owed) return { rows: [["Owed on " + D.toDisplay(d), ugx(owed)]], error: "This is more than is owed (" + ugx(owed) + ")." };
      return { rows: [["Owed on " + D.toDisplay(d), ugx(owed)], ["This payment", ugx(a)], ["Owed after", ugx(owed - a), "good"], ["Loan after", owed - a === 0 ? "Cleared · interest stops" : "Still running", owed - a === 0 ? "good" : ""]] }; });
  }
  function payoutForm(loan, id) {
    const m = Form("Add a further payout to this loan", [{ name: "amount", label: "Amount paid out now (UGX)", type: "number" }, dateF("date", "Date paid out"), { name: "reason", label: "Reason (e.g. second instalment of the approved loan)" }], act(async (f) => { await commit("addDisbursement", { loanId: id, amount: Number(f.amount), date: f.date, reason: f.reason }); M().remove(); openLoan(id); }, "Sent to the Chairperson for approval"));
    livePanel(m, ["amount", "date"], (g) => { const a = Number(g("amount")), d = g("date"); if (!(a > 0)) return { rows: [["Loan now", ugx(loan.loanAmount)]], note: "Type the amount to see the result." };
      if (D.isISO(d) && loan.date && d < loan.date) return { error: "A further payout cannot be before the first payout (" + D.toDisplay(loan.date) + ")." };
      return { rows: [["Loan now", ugx(loan.loanAmount)], ["Further payout", ugx(a)], ["Loan after", ugx(Number(loan.loanAmount) + a), "good"]], note: "The Chairperson approves before it counts." }; });
  }
  /* ONE business action: pay the loan from the member's savings, ALL or ANY PART of it (amount freely adjustable). Interest is paid first, then the loan. No cash moves.
     Paying everything owed clears the loan and stops its interest, so there is no separate lock step. Part-paying leaves the loan open at the lower balance. The impact is shown LIVE before anything is saved. */
  function settleForm(loan, id) {
    const T = today(), first = (LN.settlementReview(st.db, T).find((r) => r.loanId === id) || {}).firstCovered, box = h("div", { id: "settle-preview", class: "preview" });
    const m = Form("Pay from savings", [{ type: "note", node: h("div", null, h("p", null, h("b", null, nameOf(loan.memberId)), " · loan ", ugx(loan.loanAmount)), box) },
      Object.assign(dateF("date", "Pay on"), { value: (first && first.date) || T, min: loan.date || undefined }),
      { name: "amount", label: "Amount from savings (UGX) · change it to pay part", type: "number" }],
      act(async (f) => { await commit("settleLoanFromSavings", { loanId: id, date: f.date, amount: Number(f.amount) }); M().remove(); openLoan(id); }, "Sent to the Chairperson for approval"), "Pay from savings");
    const di = m.el.querySelector('input[name="date"]'), ai = m.el.querySelector('input[name="amount"]'), go = m.el.querySelector("[data-submit]");
    let touched = false;
    const row = (k, v, cls) => h("div", { class: "pv-row " + (cls || "") }, h("span", null, k), h("b", null, v));
    const upd = () => { const d = di && di.value, say = (kids, ok) => { box.replaceChildren(...kids); if (go) go.disabled = !ok; };
      if (!D.isISO(d)) return say([h("p", { class: "mute" }, "Pick a date.")], false);
      if (d > T) return say([Banner("bad", "The date cannot be in the future.")], false);
      if (loan.date && d < loan.date) return say([Banner("bad", "That date is before the loan was paid out (" + D.toDisplay(loan.date) + ").")], false);
      const owed = L.loanOutstanding(loan, st.db, d), sav = L.memberVerifiedSavingsAsOf(st.db, loan.memberId, d), w = L.loanInterestPosition(loan, st.db, d), due = (w.unpaidInterest || 0) + (w.unpaidPenalties || 0);
      if (!(owed > 0)) return say([Banner("warn", "Nothing is owed on " + D.toDisplay(d) + ".")], false);
      if (ai && !touched) ai.value = Math.min(owed, sav) > 0 ? Math.min(owed, sav) : "";
      const take = Number(ai && ai.value);
      const head = [row("Owed on " + D.toDisplay(d), ugx(owed)), row("Member's savings", ugx(sav))];
      if (!(take > 0)) return say(head.concat([h("p", { class: "mute" }, "Type the amount to take from savings.")]), false);
      if (take > owed) return say(head.concat([Banner("bad", "That is more than is owed (" + ugx(owed) + ").")]), false);
      if (take > sav) return say(head.concat([Banner("bad", "Savings are short by " + ugx(take - sav) + ". Lower the amount to " + ugx(sav) + " or less.")]), false);
      const intr = Math.min(take, due), left = owed - take;
      say(head.concat([row("Interest paid first", ugx(intr)), row("Loan paid", ugx(take - intr)), row("Total from savings", ugx(take)), row("Savings after", ugx(sav - take), "good"),
        row("Still owed after", left === 0 ? "UGX 0 · loan cleared · interest stops" : ugx(left) + " · loan stays open", "good"),
        h("p", { class: "mute" }, "No cash moves. The Chairperson approves once; nothing changes until then.")]), true); };
    if (di) { di.addEventListener("input", upd); di.addEventListener("change", upd); } if (ai) ai.addEventListener("input", () => { touched = true; upd(); }); upd();
  }
  /* ONE correction for a loan: restore it, set its monthly interest and lock the interest, all in a single request. The Chairperson approves once and the system does the parts in that order. */
  function correctForm(loan, v) {
    const id = loan.id, T = today(), voided = !!loan.voided, canRestore = voided && L.withinRestoreWindow(loan, Date.now());
    const preview = h("p", { class: "mute", id: "correct-preview" });
    const note = h("div", { id: "correct-context" },
      h("p", null, h("b", null, nameOf(loan.memberId)), " · loan paid out ", loan.date ? D.toDisplay(loan.date) : "(date not set)", " · ", Number(loan.loanAmount).toLocaleString(), " UGX", voided ? " · VOIDED" : ""),
      h("p", { class: "mute" }, "Fill only the parts you need. The Chairperson approves this ONE request and the system then does them in order: restore, then monthly interest, then lock. Nothing is changed until approved."),
      voided && !canRestore ? Banner("warn", "This loan was voided more than 48 hours ago, so it can no longer be restored. Use 'Record existing loan' with the original date instead.") : null, preview);
    const fields = [{ type: "note", node: note }];
    if (voided) fields.push({ name: "restore", label: "1. Restore the loan", options: canRestore ? [{ value: "yes", label: "Yes, restore it" }, { value: "no", label: "No, leave it voided" }] : [{ value: "no", label: "Not possible (48-hour window closed)" }] });
    fields.push({ name: "amount", label: "2. Monthly interest (UGX). Now " + ugx(v.assignedMonthlyInterest) + "; change it only if it is wrong", type: "number", value: v.assignedMonthlyInterest },
      { name: "lockFrom", label: "3. Stop interest from this date (optional, leave empty for no lock)", type: "date", value: "", max: T, min: loan.date || undefined },
      { name: "reason", label: "Reason (required)" });
    const m = Form("Correct this loan", fields, act(async (f) => { await commit("correctLoan", { loanId: id, restore: f.restore === "yes", amount: f.amount, lockFrom: f.lockFrom, reason: f.reason }); M().remove(); openLoan(id); }, "Correction sent to the Chairperson for one approval"), "Send for approval");
    const q = (n) => m.el.querySelector('[name="' + n + '"]');
    const upd = () => { const a = q("amount") && q("amount").value, lk = q("lockFrom") && q("lockFrom").value, amt = a === "" || a == null ? Number(v.assignedMonthlyInterest) || 0 : Number(a);
      if (lk && !D.isISO(lk)) { preview.textContent = ""; return; }
      if (lk && loan.date && lk < loan.date) { preview.textContent = "That date is before the loan was paid out (" + D.toDisplay(loan.date) + ")."; return; }
      const c2 = Object.assign({}, loan, { voided: false, assignedMonthlyInterest: amt, interestLocks: (loan.interestLocks || []).concat(lk ? [{ from: lk, to: "" }] : []) });
      preview.textContent = "Result: " + L.loanMonthsAfterGrace(c2, T) + " month(s) charged at " + ugx(amt) + " = interest " + ugx(L.loanAccumulatedInterest(c2, T)) + (lk ? ", locked from " + D.toDisplay(lk) + "." : ", no lock."); };
    ["amount", "lockFrom"].forEach((n) => { const e = q(n); if (e) { e.addEventListener("input", upd); e.addEventListener("change", upd); } }); upd();
  }
  function openLoan(id, asAt0) {
    const loan0 = st.db.loans.find((l) => l.id === id); if (loan0 && asAt0 && asAt0 < today()) return openLoanAsAt(loan0, asAt0);
    const loan = st.db.loans.find((l) => l.id === id), v = LN.loanView(st.db, loan, today()), c = ctx();
    /* every action sits at the TOP of the loan, next to the statement buttons, so nothing is hidden below a long page */
    const loanAcct = () => SX.memberAccount(st.db, loan.memberId, {}, { internal: true, loanId: id });
    const row = h("div", { class: "row", id: "loan-actions" }, exportMenu({ id: "loan-export", rep: () => accountRep(loanAcct()), period: loanAcct().period.text, wa: () => statementText(loanAcct()) }));
    const b = h("div", null, row, privacyToggle(),
      h("div", { class: "grid" }, Card("Principal", ugx(v.principal)), Card("Assigned monthly interest", ugx(v.assignedMonthlyInterest), "Set by Admin per loan"), Card("Interest accrued", ugx(v.accumulatedInterest), v.unpaidMonths + " month" + (v.unpaidMonths === 1 ? "" : "s") + " × " + ugx(v.assignedMonthlyInterest)), Card("Balance", ugx(v.balance), "Payable " + ugx(v.payable) + " − repaid " + ugx(v.repaid))),
      v.interestLocked ? Banner("warn", "Interest is locked from " + D.toDisplay(v.interestLockedFrom) + ". No new interest is added until it is unlocked.") : null,
      h("p", null, "Member: ", nameOf(loan.memberId), " · Status: ", badge(loan.status, loan.voided ? "bad" : "mute"), loan.voided ? badge("VOIDED", "bad") : null),
      loan.components && loan.components.length ? h("div", { id: "loan-components" }, h("p", { class: "mute" }, "One loan account, paid out in " + loan.components.length + " parts:"), Table([{ label: "Date", render: (c) => D.toDisplay(c.date) }, { label: "Amount", num: 1, render: (c) => num(c.amount) }, { label: "Source", key: "ref" }], loan.components)) : null,
      loanBacking(loan),
      h("h2", { class: "sec" }, "Guarantors (savings-backed)"), Table([{ label: "Guarantor", render: (g) => nameOf(g.guarantorId) }, { label: "Guaranteed", num: 1, render: (g) => num(g.amount) }, { label: "Released", num: 1, render: (g) => num(g.releasedAmount || 0) }, { label: "Still committed", num: 1, render: (g) => num(g.status === "Active" ? L.guaranteeRemaining(g) : 0) }, { label: "Status", render: (g) => badge(g.status, g.status === "Active" ? "ok" : g.status === "Requested" ? "warn" : "mute") },
        { label: "", render: (g) => g.status === "Requested" && G.can(c, "guarantee.manage") ? h("button", { "data-accept-guarantee": g.id, onclick: (ev) => { ev.stopPropagation(); Form("Record the guarantor's acceptance", [{ name: "evidence", label: "How did they accept? (signed form, call, message) - required" }], act(async (f) => { await commit("acceptGuarantee", { id: g.id, evidence: f.evidence }); document.querySelector(".modal-bg").remove(); openLoan(id); }, "Guarantee accepted and committed")); } }, "Record acceptance") : "" }], (st.db.guarantees || []).filter((g) => g.loanId === id && g.status !== "Declined"), null, "No guarantors on this loan"),
      h("h2", { class: "sec" }, "Other security (exceptional)"), Table([{ label: "Kind", key: "kind" }, { label: "Description", key: "description" }, { label: "Valuation", num: 1, render: (x) => x.valuation == null ? "—" : num(x.valuation) }, { label: "Accepted cover", num: 1, render: (x) => num(x.acceptedCover || 0) }, { label: "Docs", num: 1, render: (x) => (x.documents || []).length }, { label: "Status", render: (x) => badge(x.status, x.status === "Approved" ? "ok" : x.status === "Proposed" ? "warn" : "mute") },
        { label: "", render: (x) => x.status === "Proposed" && G.can(c, "security.approve") ? h("span", { class: "row", style: "margin:0" }, h("button", { class: "primary", "data-approve-security": x.id, onclick: (ev) => { ev.stopPropagation(); Form("Approve exceptional security", [{ name: "reason", label: "Why SOB exceptionally accepts security (required)" }, { name: "cover", label: "Part of the loan this security backs (UGX)", type: "number" }], act(async (f) => { await commit("decideSecurity", { id: x.id, decision: "approve", reason: f.reason, acceptedCover: Number(f.cover) }); document.querySelector(".modal-bg").remove(); openLoan(id); }, "Security approved")); } }, "Approve"),
          h("button", { class: "danger", "data-reject-security": x.id, onclick: (ev) => { ev.stopPropagation(); Form("Reject security", [reasonField("reason.Reject")], act(async (f) => { await commit("decideSecurity", { id: x.id, decision: "reject", reason: f.reason }); document.querySelector(".modal-bg").remove(); openLoan(id); }, "Rejected")); } }, "Reject")) : "" }], (st.db.securities || []).filter((x) => x.loanId === id), null, "No other security — the loan rests on savings and guarantors"),
      ["Active", "Cleared"].includes(loan.status) && (st.db.guarantees || []).some((g) => g.loanId === id) ? h("div", null, h("h2", { class: "sec" }, "Linked ledger: borrower and guarantors"), (() => { const lr = R.loanStatement(st.db, id, today()); return h("div", null, printButton(lr), tableFromReport(lr)); })()) : null,
      h("h2", { class: "sec" }, "Interest history"), Table([{ label: "Date", key: "date" }, { label: "From", num: 1, render: (x) => x.previousAmount == null ? "—" : num(x.previousAmount) }, { label: "To", num: 1, render: (x) => num(x.newAmount) }, { label: "Reason", key: "reason" }], v.interestHistory),
      h("h2", { class: "sec" }, "Repayments"), Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Amount", num: 1, render: (t) => num(t.amount) }], L.activeTransactions(st.db).filter((t) => t.loanId === id && t.type === "Loan Repayment")));
    const add = (label, cond, fn, cls) => cond && row.append(h("button", { class: cls || "", "data-act": label, onclick: fn }, label));
    const preDisb = ["Pending", "AwaitingApproval", "Approved"].includes(loan.status);
add("Pay from savings", G.can(c, "loan.repay") && loan.status === "Active" && !loan.dateUnknown, () => settleForm(loan, id));
    add("Request guarantee", G.can(c, "guarantee.manage") && preDisb, () => Form("Request a guarantee (more than one guarantor may back a loan)", [{ name: "g", label: "Guarantor", options: st.db.members.filter((m) => m.id !== loan.memberId).map((m) => ({ value: m.id, label: m.name + " — available " + num(L.memberAvailable(st.db, m.id)) })) }, { name: "amt", label: "Amount guaranteed (UGX)", type: "number" }], act(async (f) => { await commit("addGuarantee", { loanId: id, guarantorId: f.g, amount: Number(f.amt) }); M().remove(); openLoan(id); }, "Requested - it binds only when the guarantor accepts")));
    add("Propose other security", G.can(c, "security.manage") && preDisb, () => Form("Propose exceptional security (not the normal route)", [{ name: "kind", label: "Kind", options: S.security.KINDS }, { name: "description", label: "Description (what, where, who owns it)" }, { name: "owner", label: "Owner of the security" }, { name: "valuation", label: "Valuation (UGX)", type: "number" }, dateF("valuationDate", "Valuation date"), { name: "valuedBy", label: "Valued by" }, { name: "doc", label: "Document / evidence title" }, { name: "ref", label: "Document reference" }], act(async (f) => { await commit("proposeSecurity", { loanId: id, kind: f.kind, description: f.description, owner: f.owner, valuation: f.valuation ? Number(f.valuation) : undefined, valuationDate: f.valuationDate, valuedBy: f.valuedBy, documents: [{ name: f.doc, reference: f.ref }] }); M().remove(); openLoan(id); }, "Proposed - the Chairperson must approve it")));
    add("Release guarantors", G.can(c, "guarantee.manage") && preDisb && (st.db.guarantees || []).some((g) => g.loanId === id && ["Active", "Requested"].includes(g.status)), () => Form("Release guarantors (before disbursement only)", [{ name: "reason", label: "Reason (required)" }], act(async (f) => { await commit("releaseGuarantor", { loanId: id, reason: f.reason }); M().remove(); openLoan(id); }, "Guarantors released")));
    add(loan.status === "AwaitingApproval" ? "Approve (second approval)" : "Approve", (G.can(c, "loan.review") && loan.status === "Pending") || (G.can(c, "loan.secondApprove") && loan.status === "AwaitingApproval"), act(async () => { await commit("approveLoan", { loanId: id }); M().remove(); openLoan(id); }, "Done"), "primary");
    add("Decline", (G.can(c, "loan.review") || G.can(c, "loan.secondApprove")) && preDisb, () => Form("Decline loan", [reasonField("reason.Decline")], act(async (f) => { await commit("declineLoan", { loanId: id, reason: f.reason }); M().remove(); }, "Loan declined")));
    add("Disburse", G.can(c, "loan.disburse") && loan.status === "Approved", () => Form("Disburse loan", [{ name: "rate", label: "Assigned monthly interest (UGX) — required", type: "number" }, dateF("date")], act(async (f) => { await commit("disburseLoan", { loanId: id, assignedMonthlyInterest: f.rate, date: f.date }); M().remove(); openLoan(id); }, "Loan disbursed")), "primary");
    add("Add a further payout", G.can(c, "loan.disburse") && loan.status === "Active", () => payoutForm(loan, id));
    add("Record repayment", G.can(c, "loan.repay") && loan.status === "Active", () => repayForm(loan, id), "primary");
    add("Correct loan", G.can(c, "loan.editInterest") && loan.status === "Active", () => correctForm(loan, v), "primary");
    add("Change interest", G.can(c, "loan.editInterest") && loan.status === "Active", () => { const m = Form("Change assigned interest", [{ name: "amt", label: "New monthly interest (UGX)", type: "number", value: v.assignedMonthlyInterest }, { name: "reason", label: "Reason (required)" }], act(async (f) => { await commit("editAssignedInterest", { loanId: id, amount: f.amt, reason: f.reason }); M().remove(); openLoan(id); }, "Interest updated and audited"));
      livePanel(m, ["amt"], (g) => { const a = Number(g("amt")); if (g("amt") === "" || !(a >= 0)) return { rows: [["Owed today", ugx(v.balance)]], note: "Type the new monthly interest to see the result." };
        const c2 = Object.assign({}, loan, { assignedMonthlyInterest: a }); return { rows: [["Owed today now", ugx(v.balance)], ["Owed today after", ugx(L.loanOutstanding(c2, st.db, today())), "good"], ["Interest so far after", ugx(L.loanAccumulatedInterest(c2, today()))]] }; }); });
    add(v.interestLocked ? "Unlock interest" : "Lock interest", G.can(c, "loan.editInterest") && loan.status === "Active", () => lockForm(loan, v));
    add(loan.voided ? "Restore loan" : "Void loan", G.can(c, loan.voided ? "loan.reverse" : "loan.reverse"), () => Form(loan.voided ? "Restore loan" : "Void loan", [reasonField("reason.Void")], act(async (f) => { await commit(loan.voided ? "restoreLoan" : "voidLoan", { loanId: id, reason: f.reason }); M().remove(); }, "Done")), "danger");
    Modal("Loan " + id, b);
  }
  /* Why a loan can or cannot proceed: 3x guideline, the shortfall and exactly what backs it. */
  function loanBacking(loan) {
    if (!["Pending", "AwaitingApproval", "Approved"].includes(loan.status)) return null;
    const a = LN.assessLoan(st.db, loan.memberId, loan.loanAmount, loan.id);
    return h("div", { id: "backing" }, h("h2", { class: "sec" }, "Qualification"),
      h("div", { class: "grid" }, Card("Member savings", ugx(a.savings)), Card(a.multiple + "× guideline", ugx(a.guideline), a.withinGuideline ? "Loan is within the guideline" : "Loan exceeds the guideline by " + ugx(a.shortfall)),
        Card("Backing needed", ugx(a.required), a.guarantorsApply ? "Only the part beyond the guideline" : "Guarantor policy starts " + D.longDate(a.guarantorPolicyStart) + "; none required yet"), Card("Backing accepted", ugx(a.backing), "Guarantees " + num(a.guaranteeCover) + " · security " + num(a.securityCover))),
      a.canApprove ? h("p", { class: "ok" }, !a.guarantorsApply && !a.withinGuideline ? "Guarantors are not required before " + D.longDate(a.guarantorPolicyStart) + " (SOB policy)." : a.withinGuideline && !a.required ? "Qualifies on the member's own savings." : "Backing is sufficient.") : h("div", { class: "blocked" }, a.reasons.join(" ")), a.securityBacked ? h("p", { class: "mute" }, "Exceptional route: relies on approved security, not only on guarantors.") : null);
  }
  /* Tell borrowers their interest was reduced (interest stopped after fewer months). The officer picks who; each text is shown first; it is sent once per loan. */
  function reliefForm(list) {
    const picked = new Set(list.map((r) => r.loanId)), go = h("button", { class: "primary", id: "relief-go" }, "Send"), err = h("div", { class: "err", id: "relief-err", role: "alert" });
    const sync = () => { go.textContent = "Send to " + picked.size; go.disabled = !picked.size; };
    const m = Modal("Tell borrowers their interest was reduced", h("div", null, h("p", { class: "mute" }, "Each member gets this text from the figures in their loan. Untick anyone who should not get it. Nothing is sent until you press Send."),
      h("div", { class: "preview" }, list.map((r) => h("label", { class: "pickrow", style: "display:block;margin:8px 0" }, h("input", { type: "checkbox", checked: true, "data-loan": r.loanId, onchange: (e) => { e.target.checked ? picked.add(r.loanId) : picked.delete(r.loanId); sync(); } }), " ", h("b", null, r.name), " · ", r.monthsNow + " instead of " + r.monthsBefore + " months · " + ugx(r.cut) + " off", h("div", { class: "mute", style: "font-size:13px;margin-left:24px" }, r.text)))),
      err, h("div", { class: "row" }, go, h("button", { onclick: () => m.close() }, "Cancel"))));
    go.onclick = async () => { go.disabled = true; err.textContent = "";
      try { const r = await commit("sendInterestRelief", { loanIds: [...picked] }), q = r.queued || [], ok = q.filter((x) => x.status !== "SKIPPED").length, no = q.filter((x) => x.status === "SKIPPED").length, sk = (r.skipped || []).length;
        m.close(); toast(ok + " text" + (ok === 1 ? "" : "s") + " prepared for sending" + (no ? ". " + no + " member(s) have no valid phone number" : "") + (sk ? ". " + sk + " skipped (already told)" : "") + ". If the SMS service is not live, they are cancelled, not sent later.", no || sk ? "warn" : false); render();
      } catch (e) { err.textContent = friendly(e); go.disabled = false; } };
    sync();
  }
  function loans() {
    const relief = G.can(ctx(), "loan.editInterest") ? RMD.interestRelief(st.db, today()).filter((r) => r.eligible && !r.told) : [];
    return h("div", null, h("div", { class: "row" }, relief.length ? h("button", { id: "tell-borrowers", onclick: () => reliefForm(relief) }, "Tell borrowers (" + relief.length + ")") : null, G.can(ctx(), "loan.apply") ? h("button", { class: "primary", id: "new-loan", onclick: () => Form("New loan application", [{ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) }, { name: "amt", label: "Amount (UGX)", type: "number" }, listField("purpose", "What is the loan for?", "loan.Purpose")], act(async (f) => commit("applyForLoan", { memberId: f.m, amount: f.amt, purpose: f.purpose }), "Application recorded")) }, "New application") : null,
      G.can(ctx(), "loan.disburse") ? h("button", { id: "record-existing-loan", onclick: () => Form("Record a loan that was already paid out", [{ type: "note", text: "Use this for a loan paid out earlier (backdated). It starts on the date you choose and interest runs from that date. If the member's loan is only voided, open it and use Restore loan instead, so its history is kept." }, { name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) }, { name: "amt", label: "Amount paid out (UGX)", type: "number" }, dateF("date", "Date it was paid out"), { name: "rate", label: "Monthly interest (UGX) — required", type: "number" }, { name: "remarks", label: "Reason / note (required)" }], act(async (f) => { if (!String(f.remarks || "").trim()) throw new Error("REQUIRED: reason / note"); await commit("recordExistingLoan", { memberId: f.m, amount: Number(f.amt), date: f.date, assignedMonthlyInterest: f.rate, remarks: f.remarks }); }, "Loan recorded")) }, "Record existing loan") : null),
      loanTotals(),
      Table(loanCols, K.loanBook(st.db, today()), (v) => openLoan(v.id)), null);
  }
  /* Totals across all active loans. Tap a card for the loan-by-loan breakdown; tap a row to open that loan. */
  function loanTotals() {
    const act = K.loanBook(st.db, today()).filter((v) => v.status === "Active"), sum = (k) => act.reduce((a, v) => a + (Number(v[k]) || 0), 0);
    const P = sum("principal"), I = sum("accumulatedInterest"), R = sum("repaid"), B = sum("balance");
    const detail = (title) => () => { const cols = [{ label: "Loan", key: "id" }, { label: "Member", render: (v) => nameOf(st.db.loans.find((l) => l.id === v.id).memberId) }, { label: "Loan amount", num: 1, render: (v) => num(v.principal) }, { label: "Interest", num: 1, render: (v) => num(v.accumulatedInterest) }, { label: "Repaid", num: 1, render: (v) => num(v.repaid) }, { label: "Balance", num: 1, render: (v) => num(v.balance) }, { label: "", render: (v) => v.interestLocked ? badge("Interest locked", "mute") : "" }];
      const m = Modal(title, h("div", null, Table(cols, act, (v) => { const bg = document.querySelector(".modal-bg"); if (bg) bg.remove(); openLoan(v.id); }), h("div", { class: "grid" }, Card("Total loan amount", ugx(P)), Card("Total interest", ugx(I)), Card("Repaid so far", ugx(R)), Card("Total balance", ugx(B))))); return m; };
    return h("div", { id: "loan-totals", class: "grid" }, Card("Total loan amount", ugx(P), act.length + " active loan" + (act.length === 1 ? "" : "s") + " · tap for details", detail("Active loans: loan amount")),
      Card("Total interest", ugx(I), act.filter((v) => v.interestLocked).length ? act.filter((v) => v.interestLocked).length + " locked · tap for details" : "Tap for details", detail("Active loans: interest")));
  }

  /* ---------- ledger ---------- */
  function ledger() {
    const all = st.db.transactions.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    return h("div", null, h("div", { class: "row" }, G.can(ctx(), "ledger.create") ? h("button", { class: "primary", id: "add-entry", onclick: () => Form("New ledger entry", [{ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) }, { name: "type", label: "Type", options: ["Savings", "Withdraw", "Expense", "Income", "Profit", "Bank Charge"] }, { name: "amount", label: "Amount (UGX)", type: "number" }, dateF("date"), { name: "purpose", label: "Purpose", other: true, options: purposeChoices() }], act(async (f) => commit("createEntry", { memberId: f.m, type: f.type, amount: f.amount, date: f.date, purpose: f.purpose }), "Entry recorded")) }, "New entry") : null),
      Searchable("Search ledger", (q) => { const hit = all.filter((t) => !q || (nameOf(t.memberId) + " " + t.memberId + " " + t.type + " " + (t.purpose || "") + " " + t.amount + " " + D.toDisplay(t.date)).toLowerCase().includes(q)), rows = hit.slice(0, 200);
      return h("div", null, h("p", { class: "mute", style: "font-size:13px" }, hit.length > rows.length ? "Showing the latest " + rows.length + " of " + hit.length + " — type in the search box to narrow." : hit.length + " entries"), Table([{ label: "Date", m: "s2", render: (t) => D.toDisplay(t.date) }, { label: "Member", m: "t", render: (t) => nameOf(t.memberId) }, { label: "Type", m: "s", key: "type" }, { label: "Amount", num: 1, m: "v", render: (t) => num(t.amount) }, { label: "State", m: "b", render: (t) => t.voided ? badge("Voided", "bad") : t.approvalStatus === "PendingApproval" ? badge("Awaiting Chairperson", "warn") : t.approvalStatus === "Rejected" ? badge("Rejected", "bad") : badge("Counted", "ok") }], rows, (t) => openEntry(t.id))); }));
  }
  /* Correct the date of an entry that was recorded on the wrong day (e.g. paid in November, recorded in December). Nothing else changes. A savings offset and the loan repayment it belongs to move together. The Chairperson approves. */
  function changeDateForm(t) {
    const pair = (st.db.transactions || []).find((x) => x.id !== t.id && !x.voided && x.memberId === t.memberId && x.date === t.date && Number(x.amount) === Number(t.amount) && ((t.type === "Savings Offset" && x.type === "Historical Loan Repayment") || (t.type === "Historical Loan Repayment" && x.type === "Savings Offset")));
    const m = Form("Change date", [{ type: "note", node: h("div", null, h("p", null, nameOf(t.memberId), " · ", t.type, " · ", ugx(t.amount), " · now dated ", D.toDisplay(t.date)), pair ? h("p", { class: "mute" }, "Its linked entry (" + pair.type + ", " + ugx(pair.amount) + ") moves to the same date.") : null, h("p", { class: "mute" }, "Only the date changes. The Chairperson approves; nothing changes until then.")) },
      dateF("date", "Correct date"), { name: "evidence", label: "What shows the right date (bank slip, your own record)" }, { name: "reason", label: "Reason" }],
      act(async (f) => { if (!D.isISO(f.date) || f.date === t.date) throw new Error("Pick a different date."); if (f.date > today()) throw new Error("The date cannot be in the future.");
        for (const id of [t.id].concat(pair ? [pair.id] : [])) await commit("correctEntryDate", { id, date: f.date, reason: f.reason, evidence: f.evidence }); M().remove(); }, "Sent to the Chairperson for approval"), "Send for approval");
    return m;
  }
  function openEntry(id) {
    const t = st.db.transactions.find((x) => x.id === id), c = ctx(), row = h("div", { class: "row" });
    const perm = t.voided ? "ledger.restore" : "ledger.void";
    if (G.can(c, perm)) row.append(h("button", { class: "danger", "data-act": "void", onclick: () => Form(t.voided ? "Restore entry" : "Void entry", [reasonField("reason.Void")], act(async (f) => { await commit(t.voided ? "restoreEntry" : "voidEntry", { id, reason: f.reason }); document.querySelector(".modal-bg").remove(); }, "Done")) }, t.voided ? "Restore" : "Void"));
    if (G.can(c, "reconcile.manage") && !t.voided) row.append(h("button", { "data-act": "change-date", onclick: () => changeDateForm(t) }, "Change date"));
    if (t.approvalStatus === "PendingApproval" && G.can(c, "ledger.approve")) row.append(h("button", { class: "primary", "data-act": "approve-entry", onclick: act(async () => { await commit("approveEntry", { id, decision: "approve" }); document.querySelector(".modal-bg").remove(); }, "Approved") }, "Approve (second approval)"),
      h("button", { class: "danger", "data-act": "reject-entry", onclick: () => Form("Reject entry", [reasonField("reason.Reject")], act(async (f) => { await commit("approveEntry", { id, decision: "reject", reason: f.reason }); document.querySelector(".modal-bg").remove(); }, "Rejected")) }, "Reject"));
    const aud = (st.db.auditLog || []).filter((a) => a.entityId === id);
    drill("Entry " + id, null, h("div", null, h("p", null, nameOf(t.memberId), " · ", t.type, " · ", ugx(t.amount), " · ", D.toDisplay(t.date)), t.voided ? h("p", { class: "err" }, "Voided: " + (t.voidReason || "")) : null, row, h("h2", { class: "sec" }, "Audit trail"), Table([{ label: "When", key: "date" }, { label: "Action", key: "action" }, { label: "By", key: "by" }, { label: "Reason", key: "reason" }], aud)));
  }

  /* ---------- subscriptions, share-out, reports, audit ---------- */
  function subs() {
    const y = today().slice(0, 4), c = C.subscriptionCompliance(st.db, y);
    return h("div", null, h("div", { class: "grid" }, Card("Collected", ugx(c.collected), "of " + ugx(c.expected)), Card("Paid", String(c.paid.length)), Card("Unpaid", String(c.unpaid.length))),
      Table([{ label: "Member", m: "t", render: (m) => m.name }, { label: "Status", m: "b", render: (m) => c.paid.includes(m.id) ? badge("Paid", "ok") : badge("Unpaid", "bad") }, { label: "", m: "v", render: (m) => !c.paid.includes(m.id) && G.can(ctx(), "subscription.record") ? h("button", { "data-sub": m.id, onclick: (e) => { e.stopPropagation(); Form("Subscription — " + m.name, [{ name: "year", label: "Subscription year", type: "number", value: y }, dateF("date", "Date paid (today unless you change it)")], act(async (f) => commit("recordSubscription", { memberId: m.id, year: Number(f.year), date: f.date }), "Subscription recorded"), "Record UGX 5,000"); } }, "Record UGX 5,000") : null }], st.db.members.filter((m) => m.status !== "Inactive")));
  }
  function shareout() {
    const cur = FYM.current(st.db), y = cur ? cur.year : Number(today().slice(0, 4)), p = C.previewShareOut(st.db, y, today());
    const done = (st.db.shareOutEvents || []).find((e) => e.year === y);
    return h("div", null, null,
      h("div", { class: "grid" }, Card("To withdraw now", ugx(p.totals.withdrawable), "After guarantee commitments"), Card("Of which loan-holders", ugx(p.totals.withdrawableByLoanHolders), "Loans stay payable"), Card("Committed, stays in account", ugx(p.totals.committedRetained), p.totals.guaranteesAtRisk + " guarantor(s)"), Card("Profit-eligible members", String(p.totals.eligibleMembers)), Card("Excluded (outstanding loan)", String(p.totals.excludedMembers))),
      Table([{ label: "Member", key: "name" }, { label: "Actual savings", num: 1, render: (r) => num(r.savings) }, { label: "Committed", num: 1, render: (r) => num(r.committed) }, { label: "Available", num: 1, render: (r) => num(r.available) }, { label: "Withdraws", num: 1, render: (r) => num(r.withdraw) }, { label: "Stays", num: 1, render: (r) => num(r.retained) }, { label: "Loan owed", num: 1, render: (r) => num(r.outstandingLoan) }, { label: "Action", key: "savingsAction" }], p.rows, (r) => openMember(r.memberId)),
      done ? h("p", { class: "mute" }, "Share-out for " + y + " executed on " + D.toDisplay(done.date) + ".") : G.can(ctx(), "shareout.execute") ? h("div", { class: "row" }, h("button", { class: "danger", id: "exec-shareout", onclick: act(async () => { if (!confirm("Execute the " + y + " share-out? This closes the year.")) return; await commit("executeShareOut", { year: y }); }, "Share-out executed") }, "Execute share-out " + y)) : null);
  }
  /* ---------- financial years: independent periods; only a recorded Balance Brought Forward opens a member's new year ---------- */
  function fyearsView() {
    const tb = FYM.table(st.db), canW = G.can(ctx(), "reconcile.manage"), sel = st.fySel && tb.some((c) => c.year === st.fySel) ? st.fySel : (tb.length ? tb[tb.length - 1].year : null);
    if (!tb.length) return Empty({ icon: "book", title: "No financial years yet" });
    const pos = FYM.position(st.db, sel), nm = (id) => (st.db.members.find((m) => m.id === id) || {}).name || id, hasPrev = tb.some((c) => c.year < sel);
    const recs = FYM.openings(st.db).slice().sort((a, b) => (a.year - b.year) || (a.memberId < b.memberId ? -1 : 1));
    const record = () => Form("Record a Balance Brought Forward", [{ name: "year", label: "Into financial year", options: tb.filter((c) => tb.some((x) => x.year < c.year)).map((c) => ({ value: c.year, label: c.label })), value: sel }, { name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name + " (" + m.id + ")" })) }, { name: "amount", label: "Amount to bring forward (UGX, whole shillings)", type: "number" }, { name: "evidence", label: "Evidence (the minute or decision approving it)" }, { name: "reason", label: "Reason" }, { type: "note", text: "Changes no ledger entry or live savings. Needs the Chairperson's approval." }],
      act(async (f) => commit("recordBroughtForward", { year: Number(f.year), memberId: f.m, amount: Number(f.amount), evidence: f.evidence, reason: f.reason }), "Sent for approval"));
    return h("div", null,
      null,
      Chips(tb.map((c) => [String(c.year), c.label.replace("FY", "Financial Year ")]), String(sel), (k) => { st.fySel = Number(k); render(); }),
      h("p", { class: "mute", id: "fy-span" }, "Financial Year " + pos.year + ": " + D.longDate(pos.openedDate) + " – " + (pos.closedDate ? D.longDate(pos.closedDate) + " (closed by the approved share-out)" : "open")),
      h("div", { class: "grid fy4" }, hasPrev ? Card("Previous year closing position", ugx(pos.totals.previousClosing), "For information") : null, hasPrev ? Card("Held in the club consolidated position", ugx(pos.totals.notBroughtForward), "Not brought forward") : null, Card("Authorised Balance Brought Forward", ugx(pos.totals.opening), "Recorded by officers"), Card("New-year transactions", ugx(pos.totals.deposits + pos.totals.profit - pos.totals.withdrawals - pos.totals.shareOuts + pos.totals.other), "Deposits, profit, withdrawals")),
      Table([{ label: "Member", render: (r) => r.name }, { label: "Previous closing", num: 1, render: (r) => num(r.previousClosing) }, { label: "Brought forward", num: 1, render: (r) => num(r.opening) }, { label: "Deposits", num: 1, render: (r) => num(r.deposits) }, { label: "Profit", num: 1, render: (r) => num(r.profit) }, { label: "Withdrawn", num: 1, render: (r) => num(r.withdrawals) }, { label: "Share-out", num: 1, render: (r) => num(r.shareOuts) }, { label: "Closing", num: 1, render: (r) => num(r.closing) }], pos.rows),
      h("h2", { class: "sec" }, "Recorded Balance Brought Forward"),
      canW ? h("div", { class: "row" }, h("button", { class: "primary", id: "bbf-add", onclick: record }, "Record a Balance Brought Forward")) : null,
      recs.length ? Table([{ label: "Year", render: (o) => "Financial Year " + o.year }, { label: "Member", render: (o) => nm(o.memberId) }, { label: "Amount", num: 1, render: (o) => num(o.amount) }, { label: "Evidence", key: "evidence" }, { label: "Recorded by", render: (o) => o.recordedBy + (o.authorisedBy ? " · approved by " + o.authorisedBy : "") }, { label: "", render: (o) => canW ? h("button", { "data-bbf-void": o.id, onclick: () => Form("Void this Balance Brought Forward", [{ name: "reason", label: "Reason" }], act(async (f) => commit("voidBroughtForward", { id: o.id, reason: f.reason }), "Sent for approval")) }, "Void") : null }], recs) : null);
  }
  /* ---------- profit: proportional to eligible savings, Chairperson-approved posting ---------- */
  function profitRows(rows) {
    return Table([{ label: "Member", key: "name" }, { label: "Savings used", num: 1, render: (r) => num(r.savings) }, { label: "Eligible", render: (r) => r.eligible ? badge("Yes", "ok") : badge("No", "bad") }, { label: "Share %", num: 1, render: (r) => r.sharePct + "%" }, { label: "Entitlement", num: 1, render: (r) => h("strong", null, num(r.entitlement)) }, { label: "Why not", key: "excludedBecause" }], rows, (r) => drill("How " + r.name + "'s figure arose", null, h("div", null,
      h("p", null, "Savings at the distribution date: ", ugx(r.savings), " · weight ", num(r.weight), " · share ", r.sharePct + "%", " · entitlement ", ugx(r.entitlement)),
      h("p", { class: "mute" }, r.eligible ? "Member Profit = (this member's eligible savings ÷ total eligible savings) × approved pool." : r.excludedBecause))));
  }
  function profit() {
    const posted = (st.db.profitDistributions || []).filter((d) => d.status === "Posted"), pol = null;
    const cycles = (st.db.policy || []).filter((x) => /^cycle:/.test(x.id));
    const setCycle = (c) => Form(c ? "Change inputs for " + c.period : "Set the inputs for a distribution cycle", [{ name: "period", label: "Period (e.g. 2026-Q2)", value: c ? c.period : "" }, { name: "pool", label: "Profit pool to distribute (UGX)", type: "number", value: c ? c.pool : "" }, { name: "date", label: "Savings measured at", type: "date", value: c ? c.measurementDate : "" }, { name: "source", label: "Where this profit came from", value: c ? c.sourceNote : "" }, { name: "reason", label: "Reason / SOB reference for these inputs (required)" }],
      act(async (f) => commit("setProfitCycle", { period: f.period, pool: Number(f.pool), measurementDate: f.date, sourceNote: f.source, reason: f.reason }), "Cycle inputs saved and audited"));
    const run = (preview) => Form(preview ? "Preview profit distribution" : "Submit final profit distribution for Chairperson approval", [{ name: "period", label: "Period (its inputs must already be set)", options: cycles.filter((c) => !posted.some((d) => d.period === c.period)).map((c) => c.period) }],
      act(async (f) => { const args = { period: f.period };
        if (preview) { const pv = st.live ? await st.store.command("previewProfit", args) : S.commands.run(st.db, ctx(), "previewProfit", args); drill("Profit distribution preview — nothing posted", pv.formula, h("div", null, h("div", { class: "grid" }, Card("Pool", ugx(pv.pool)), Card("Distributed", ugx(pv.distributed)), Card("Undistributed (rounding)", ugx(pv.undistributed)), Card("Eligible members", String(pv.eligibleMembers))), h("p", { class: "mute" }, pv.basis), profitRows(pv.rows))); }
        else { await commit("distributeProfit", args); } }, preview ? "Preview ready" : "Profit posted to members' savings"));
    return h("div", null, null,
      h("h2", { class: "sec" }, "Cycle inputs (pool and measurement date)"), null,
      Table([{ label: "Period", key: "period" }, { label: "Pool", num: 1, render: (c) => num(c.pool) }, { label: "Measured at", render: (c) => D.toDisplay(c.measurementDate) }, { label: "Source", key: "sourceNote" }, { label: "Status", render: (c) => posted.some((d) => d.period === c.period) ? badge("Posted - locked", "mute") : badge("Ready", "ok") }, { label: "Changes", num: 1, render: (c) => String((c.history || []).length) }], cycles,
        (c) => drill("History of inputs for " + c.period, null, Table([{ label: "When", key: "date" }, { label: "By", key: "by" }, { label: "Pool", render: (x) => num(x.new.pool) }, { label: "Measured at", render: (x) => x.new.measurementDate }, { label: "Was", render: (x) => x.previous ? num(x.previous.pool) + " @ " + x.previous.measurementDate : "—" }, { label: "Reason", key: "reason" }], c.history || []))),
      G.can(ctx(), "profit.distribute") ? h("div", { class: "row" }, h("button", { id: "profit-cycle", onclick: () => setCycle(null) }, "Set cycle inputs"), h("button", { id: "profit-preview", onclick: () => run(true) }, "Preview a distribution"), h("button", { class: "primary", id: "profit-post", onclick: () => run(false) }, "Submit final distribution for approval")) : null,
      h("h2", { class: "sec" }, "Posted distributions"), Table([{ label: "Period", key: "period" }, { label: "Date", render: (d) => D.toDisplay(d.date) }, { label: "Pool", num: 1, render: (d) => num(d.pool) }, { label: "Distributed", num: 1, render: (d) => num(d.distributed) }, { label: "Undistributed", num: 1, render: (d) => num(d.undistributed) }, { label: "Source", key: "sourceNote" }], posted, (d) => drill("Profit distribution " + d.period, d.formula, h("div", null, h("p", { class: "mute" }, d.basis), profitRows(d.rows)))));
  }
  /* ---------- approvals: Chairperson second approval queue + SOB policy ---------- */
  function approvals() {
    const ap = R.approvals(st.db), c = ctx(), can = G.can(c, "ledger.approve");
    const pol = L.getPolicy(st.db, "approval"), rows = ap.rows.map((r) => Object.assign({}, r)), reqOf = (id) => (st.db.approvalRequests || []).find((x) => x.id === id);
    const decided = (st.db.approvalRequests || []).filter((x) => x.status !== "Pending").slice().reverse().slice(0, 25);
    /* WHAT the Chairperson is being asked to approve, in plain figures, worked out from the request itself (so older requests show it too) */
    const reqRows = (q) => { const a = q.args || {}, rows = [], loan = a.loanId ? (st.db.loans || []).find((l) => l.id === a.loanId) : null, T = today(), yes = (x) => x === true || x === "true" || x === "yes";
      const money = (n) => ugx(Number(n) || 0);
      if (loan) { rows.push(["Member", nameOf(loan.memberId) + " (" + loan.memberId + ")"], ["Loan", loan.id + " · " + money(loan.loanAmount) + (loan.date ? " · paid out " + D.toDisplay(loan.date) : "")]);
        const owed = (lk, amt) => { const c2 = Object.assign({}, loan, { voided: false }); if (amt !== undefined && amt !== null && String(amt).trim() !== "") c2.assignedMonthlyInterest = Number(amt); if (lk) c2.interestLocks = (loan.interestLocks || []).concat([{ from: lk, to: "" }]); return { owed: L.loanOutstanding(c2, st.db, T), months: L.loanMonthsAfterGrace(c2, T) }; };
        const now = owed(null);
        if (q.command === "lockInterest") { const w = owed(a.date); rows.push(["Action", "Stop new interest from " + D.toDisplay(a.date)], ["Months charged", now.months + " → " + w.months], ["Owed today", money(now.owed) + " → " + money(w.owed)]); }
        else if (q.command === "unlockInterest") rows.push(["Action", "Let interest grow again from " + D.toDisplay(a.date)]);
        else if (q.command === "editAssignedInterest") { const w = owed(null, a.amount); rows.push(["Monthly interest", money(loan.assignedMonthlyInterest) + " → " + money(a.amount)], ["Owed today", money(now.owed) + " → " + money(w.owed)]); }
        else if (q.command === "correctLoan") { if (yes(a.restore)) rows.push(["1. Restore", "Yes, restore the voided loan"]); if (a.amount !== undefined && String(a.amount).trim() !== "") rows.push(["2. Monthly interest", money(loan.assignedMonthlyInterest) + " → " + money(a.amount)]); if (a.lockFrom) rows.push(["3. Lock", "Stop interest from " + D.toDisplay(a.lockFrom)]); const w = owed(a.lockFrom || null, a.amount); rows.push(["Owed after", money(now.owed) + " → " + money(w.owed)]); }
        else if (q.command === "settleLoanFromSavings") { const d = a.date || T, ow = L.loanOutstanding(loan, st.db, d), sv = L.memberVerifiedSavingsAsOf(st.db, loan.memberId, d), tk = a.amount > 0 ? Number(a.amount) : ow; rows.push(["Action", "Pay from savings on " + D.toDisplay(d)], ["Owed", money(ow)], ["From savings", money(tk)], ["Savings now → after", money(sv) + " → " + money(sv - tk)], ["Result", tk >= ow ? "Loan cleared, interest stops" : "Still owed " + money(ow - tk) + ", loan stays open"]); }
        else if (q.command === "voidLoan" || q.command === "restoreLoan") rows.push(["Action", q.command === "voidLoan" ? "Void (cancel) this loan" : "Restore this voided loan"]);
        else if (q.command === "addDisbursement") rows.push(["Further payout", money(a.amount) + " on " + D.toDisplay(a.date)], ["Loan after", money(Number(loan.loanAmount) + Number(a.amount))]);
        else rows.push(["Action", q.label]);
      } else { rows.push(["Action", q.label], ["Detail", q.summary]); }
      rows.push(["Reason", q.reason || "(none given)"], ["Requested by", q.requestedBy + " (" + (q.requestedByRole || "") + ") on " + D.toDisplay(q.requestedDate)]); return rows; };
    const reqLine = (q) => reqRows(q).filter((x) => !["Reason", "Requested by", "Member", "Loan"].includes(x[0])).map((x) => (x[0] === "Action" ? "" : x[0] + ": ") + x[1]).join(" · ") + (q.reason ? " · Reason: " + q.reason : "");
    rows.forEach((r) => { const q = reqOf(r.ref); if (q && q.args && q.args.loanId) { const l = (st.db.loans || []).find((x) => x.id === q.args.loanId); if (l) { r.member = nameOf(l.memberId); r.detail = reqLine(q); } } });
    const picked = new Set();
    const showRequest = (r) => { const q = reqOf(r.ref); drill(q.label, null, h("div", null, h("div", { class: "preview" }, reqRows(q).map((x) => h("div", { class: "pv-row" }, h("span", null, x[0]), h("b", null, x[1])))),
      q.schedule ? h("div", null, h("div", { class: "grid" }, Card("Approved profit pool", ugx(q.schedule.pool)), Card("Measured at", D.toDisplay(q.schedule.date)), Card("Distributed", ugx(q.schedule.distributed)), Card("Undistributed (rounding)", ugx(q.schedule.undistributed))), h("p", { class: "mute" }, q.schedule.basis), profitRows(q.schedule.rows)) : null)); };
    const btn = (r) => !can ? "" : r.kind === "Ledger entry" ? h("button", { class: "primary", "data-approve": r.ref, onclick: (e) => { e.stopPropagation(); act(async () => commit("approveEntry", { id: r.ref, decision: "approve" }), "Approved")(); } }, "Approve")
      : r.kind === "Loan" ? h("button", { class: "primary", "data-approve": r.ref, onclick: (e) => { e.stopPropagation(); act(async () => commit("approveLoan", { loanId: r.ref }), "Loan approved")(); } }, "Approve")
      : reqOf(r.ref) ? h("span", { class: "row" }, h("button", { class: "primary", "data-approve": r.ref, onclick: (e) => { e.stopPropagation(); act(async () => commit("approveRequest", { id: r.ref }), "Approved and posted")(); } }, "Approve"),
        h("button", { class: "danger", "data-reject": r.ref, onclick: (e) => { e.stopPropagation(); Form("Reject request", [reasonField("reason.Reject")], act(async (f) => commit("rejectRequest", { id: r.ref, reason: f.reason }), "Rejected")); } }, "Reject")) : "";
    const bulkBtn = h("button", { class: "primary", id: "bulk-approve", hidden: true, onclick: () => bulkApprove([...picked].map(reqOf).filter(Boolean)) }, "Approve selected");
    const refreshBulk = () => { bulkBtn.hidden = !picked.size; bulkBtn.textContent = "Approve selected (" + picked.size + ")"; };
    const tick = (r) => !can || !reqOf(r.ref) ? "" : h("input", { type: "checkbox", "aria-label": "Select " + r.ref, "data-pick": r.ref, onclick: (e) => e.stopPropagation(), onchange: (e) => { if (e.target.checked) picked.add(r.ref); else picked.delete(r.ref); refreshBulk(); } });
    const allBtn = !can ? null : h("button", { id: "select-all", onclick: () => { const boxes = [...document.querySelectorAll("[data-pick]")], all = boxes.every((b) => b.checked); boxes.forEach((b) => { b.checked = !all; if (b.checked) picked.add(b.getAttribute("data-pick")); else picked.delete(b.getAttribute("data-pick")); }); refreshBulk(); } }, "Select all requests");
    /* ONE confirmation for many requests of the same kind. Each request is still approved, executed and audited on its own, in your name. */
    const bulkApprove = (list) => { if (!list.length) return;
      const m = Modal("Approve " + list.length + " request" + (list.length === 1 ? "" : "s"), h("div", null, h("p", { class: "mute" }, "Check each line. Each is approved and recorded separately in your name."),
        h("div", { class: "preview" }, list.map((q) => h("div", { class: "pv-row" }, h("span", null, (q.args && q.args.loanId ? nameOf(((st.db.loans || []).find((l) => l.id === q.args.loanId) || {}).memberId) + " · " : "") + q.label), h("b", null, reqLine(q).slice(0, 140))))),
        h("div", { class: "err", id: "bulk-err", role: "alert" }), h("div", { class: "row" }, h("button", { class: "primary", id: "bulk-go", onclick: async (ev) => { const go = ev.currentTarget; go.disabled = true; let okN = 0; const bad = [];
          for (const q of list) { try { await commit("approveRequest", { id: q.id }); okN++; } catch (e) { bad.push(q.id + ": " + friendly(e)); } }
          m.close(); picked.clear(); toast(okN + " of " + list.length + " approved" + (bad.length ? ". Not approved: " + bad.join("; ") : "."), bad.length ? "warn" : false); render(); } }, "Approve all " + list.length), h("button", { onclick: () => m.close() }, "Cancel"))));
    };
    return h("div", null, null,
      h("div", { class: "grid" }, Card("Waiting for the Chairperson", String(ap.totals.waiting))),
      can ? h("div", { class: "row" }, allBtn, bulkBtn) : null,
      Table([{ label: "Kind", key: "kind", m: "s" }, { label: "Member", m: "t", render: (r) => h("span", null, h("span", { class: "pickrow" }, tick(r), r.member), reqOf(r.ref) ? h("span", { class: "reqdet" }, r.detail) : null) }, { label: "Detail", key: "detail", m: "x" }, { label: "Entered by", key: "enteredBy", m: "x" }, { label: "", render: btn, m: "v" }], rows, (r) => { if (r.kind === "Ledger entry") openEntry(r.ref); else if (reqOf(r.ref)) showRequest(r); else { const sec = (st.db.securities || []).find((x) => x.id === r.ref); openLoan(r.kind === "Loan" ? r.ref : sec.loanId); } }),
      h("h2", { class: "sec" }, "Recently decided requests"), Table([{ label: "Action", key: "label" }, { label: "Detail", key: "summary" }, { label: "Requested by", key: "requestedBy" }, { label: "Decision", key: "status" }, { label: "Decided by", key: "decidedBy" }, { label: "Date", render: (x) => D.toDisplay(x.decidedDate || x.requestedDate) }], decided),
      h("h2", { class: "sec" }, "SOB rules in force"), Table([{ label: "Rule", key: "k" }, { label: "Now", key: "v" }], [
        { k: "Needs the Chairperson's second approval", v: "Loan approvals · exceptional security · voids and reversals · manual adjustments · final profit distribution · share-out posting" },
        { k: "Does not need it (fully audited)", v: "Savings deposits and normal loan repayments" }, { k: "Extra entry types needing the Chairperson", v: pol.requiredTypes.length ? pol.requiredTypes.join(", ") : "none beyond the list above" },
        { k: "Backing for a loan beyond the 3× guideline", v: "Only the shortfall beyond the borrower's own qualification" }, { k: "Repayments are applied", v: "Unpaid interest first, then principal; a guarantee is released only as principal is repaid" }]));
  }
  const withPeriod = (rep) => Object.assign(rep, { period: rep.period || periodNow().text || D.describePeriod(periodNow()) });
  const REPORTS = { "Interest Receivable": () => R.interestReceivable(st.db, today()), "Awaiting approval": () => R.approvals(st.db), "Exceptional security": () => R.securities(st.db), "Profit distribution": () => R.quarterlyDistribution(st.db), "Savings by member": () => R.savings(st.db), "Loan book": () => R.loans(st.db, today()), "Loan repayments": () => withPeriod(R.repayments(st.db, { from: periodNow().from, to: periodNow().to })), "Guarantor exposure": () => R.guarantors(st.db), "Subscriptions": () => R.subscriptions(st.db, today().slice(0, 4)), "Income & expenses": () => withPeriod(R.incomeExpenses(st.db, { from: periodNow().from, to: periodNow().to })), "December share-out": () => R.shareOut(st.db, (FYM.current(st.db) || { year: Number(today().slice(0, 4)) }).year, today()), "Financial years": () => FRP.financialYears(st.db), "Financial year (current)": () => FRP.financialYear(st.db, (FYM.current(st.db) || { year: 0 }).year), "Profit reconciliation": () => FRP.profitReconciliation(st.db, today()), "Historical loans": () => FRP.historicalLoans(st.db, today()), "General Reserve Fund": () => FRP.generalReserve(st.db), "Reserve movements": () => FRP.reserveMovements(st.db), "Airtime requests": () => R.airtime(st.db), "Notification log": () => R.notificationLog(st.db), "Reconciliation register": () => R.reconciliationRegister(st.db), "Annual summary": () => R.annualSummary(st.db, FYM.yearOfDate(st.db, periodNow().to) || periodNow().to.slice(0, 4)), "Interest vs principal received": () => R.repaymentAllocation(st.db), "Quarterly distribution": () => R.quarterlyDistribution(st.db, { year: Number(today().slice(0, 4)), quarter: 1 }) };
  const PERIOD_AWARE = ["Loan repayments", "Income & expenses", "Annual summary"];
  /* The reports page is a catalogue: every statement is grouped by what it tells you, says whether it follows the chosen period, and opens as a table with PDF and CSV. */
  const REPORT_GROUPS = [
    ["Financial statements", "Statements that follow the approved financial years, from share-out to share-out.", ["Financial year (current)", "Financial years", "Annual summary", "Income & expenses", "Profit reconciliation"]],
    ["Savings, profit and share-out", "What members hold, what was earned for them, and what was paid out.", ["Savings by member", "Subscriptions", "Profit distribution", "Quarterly distribution", "December share-out"]],
    ["Loans and interest", "Money lent, repaid and still owed, with interest shown separately from principal.", ["Loan book", "Loan repayments", "Interest vs principal received", "Interest Receivable", "Guarantor exposure", "Exceptional security", "Historical loans"]],
    ["General Reserve Fund", "The group's collective reserve and every movement into or out of it.", ["General Reserve Fund", "Reserve movements"]],
    ["Governance and records", "Approvals, reconciliation and the notices that were sent.", ["Awaiting approval", "Reconciliation register", "Notification log", "Airtime requests"]]];
  function openReport(n) {
    const rep = REPORTS[n](); if (rep.blocked) { drill(n, null, h("div", { class: "blocked" }, "Blocked: " + rep.reason)); return; }
    drill(rep.title, null, h("div", null, h("div", { class: "row" }, printButton(rep, rep.period, n.replace(/\W+/g, "_") + ".csv")), tableFromReport(rep), h("pre", { class: "mute" }, JSON.stringify(rep.totals))));
  }
  /* REPORT CENTRE: one place for every report. Pick the report, narrow it by financial year, dates, member and status, then read it here or download it as PDF or Excel.
     Every figure comes from the same ledger calculations as the dashboard (core/reportcentre). */
  const LEGACY_SKIP = ["Loan book", "Savings by member", "Loan repayments", "Income & expenses", "Annual summary", "Financial year (current)", "Interest Receivable", "Subscriptions", "Profit distribution", "December share-out", "Financial years"];
  function reports() {
    const RCm = S.reportcentre, cat = RCm.catalogue(), tb = FYM.table(st.db);
    const legacy = Object.keys(REPORTS).filter((n) => !LEGACY_SKIP.includes(n)).concat(tb.map((c) => { const n = "Year-end reconciliation " + c.label; REPORTS[n] = () => SX.yearEnd(st.db, c.year); return n; }));
    const f = st.rc = Object.assign({ id: "savings", year: "", from: "", to: "", memberId: "", status: "" }, st.rc || {});
    const entryOf = () => cat.find((c) => c.id === f.id), has = (k) => { const e = entryOf(); return !!e && e.filters.includes(k); };
    const sel = (id, label, opts, val, on) => { const el = h("select", { id, "aria-label": label, onchange: (e) => on(e.target.value) }, opts.map(([v, t]) => h("option", Object.assign({ value: v }, String(v) === String(val) ? { selected: "" } : {}), t))); return h("label", { class: "fld" }, h("span", null, label), el); };
    const date = (id, label, val, on) => h("label", { class: "fld" }, h("span", null, label), h("input", { type: "date", id, value: val, max: today(), onchange: (e) => on(e.target.value) }));
    const set = (k, v) => { f[k] = v; if (k === "id") { f.status = ""; } paint(); };
    const statusList = () => f.id === "balances" ? ["Active", "Inactive", "Pending"] : ["Active", "Cleared", "Pending", "AwaitingApproval", "Approved", "Declined"];
    const result = h("div", { id: "rc-result" });
    let rep = null;
    const run = () => { const isLegacy = !entryOf() && legacy.includes(f.id); if (isLegacy) { const r = REPORTS[f.id](); return Object.assign({}, r, { notes: r.notes || [], period: r.period || "As at " + D.longDate(today()) }); } return RCm.run(st.db, f.id, { year: f.year, from: f.from, to: f.to, memberId: f.memberId, status: f.status }, today()); };
    const shownTotals = (r) => Object.keys(r.totals || {}).filter((k) => typeof r.totals[k] === "number" && r.columns.concat(Object.keys(r.labels || {})).length >= 0).slice(0, 6);
    function paint() {
      bar.replaceChildren(...barItems());
      result.replaceChildren();
      try { rep = run(); } catch (e) { result.append(Banner("bad", e.message.replace(/^[A-Z_]+: /, ""))); return; }
      if (rep.blocked) { result.append(Banner("warn", rep.reason || "This report cannot be produced yet.")); return; }
      const tot = shownTotals(rep), lab = (k) => (rep.labels && rep.labels[k]) || heading(k).replace(/ \(UGX\)$/, "");
      result.append(h("div", { class: "rc-head" }, h("div", null, h("h2", { class: "rc-title" }, rep.title), h("div", { class: "rc-period" }, rep.period || "")), h("div", { class: "rc-count" }, pl(rep.rows.length, "line"))),
        tot.length ? h("div", { class: "rc-totals" }, tot.map((k) => h("div", { class: "rc-total" }, h("span", null, lab(k)), h("b", { class: rep.totals[k] < 0 ? "neg" : "" }, /^(rows|entries|loans|count)$/i.test(k) ? String(rep.totals[k]) : rep.totals[k] < 0 ? "UGX (" + num(-rep.totals[k]) + ")" : ugx(rep.totals[k]))))) : null,
        tableFromReport(rep, null), (rep.notes || []).length ? h("div", { class: "rc-notes" }, rep.notes.map((n) => h("p", null, n))) : null);
      applyPrivacy();
    }
    const barItems = () => {
      const opts = [h("label", { class: "fld wide" }, h("span", null, "Report"), h("select", { id: "rc-report", "aria-label": "Report", onchange: (e) => set("id", e.target.value) },
        RCm.GROUPS.map((g) => h("optgroup", { label: g }, cat.filter((c) => c.group === g).map((c) => h("option", Object.assign({ value: c.id }, c.id === f.id ? { selected: "" } : {}), c.title)))),
        h("optgroup", { label: "More statements" }, legacy.map((n) => h("option", Object.assign({ value: n }, n === f.id ? { selected: "" } : {}), n)))))];
      if (has("period") || has("year")) opts.push(sel("rc-year", "Financial year", [["", "All records"]].concat(tb.map((c) => [String(c.year), c.label.replace("FY", "Financial Year ")])), f.year, (v) => { f.year = v; if (v) { f.from = ""; f.to = ""; } paint(); }));
      if (has("period")) opts.push(date("rc-from", "From", f.from, (v) => { f.from = v; f.year = ""; paint(); }), date("rc-to", "To", f.to, (v) => { f.to = v; paint(); }));
      if (has("member")) opts.push(sel("rc-member", "Member", [["", "All members"]].concat(st.db.members.slice().sort((a, b) => a.name.localeCompare(b.name)).map((m) => [m.id, m.name + " (" + m.id + ")"])), f.memberId, (v) => set("memberId", v)));
      if (has("category")) opts.push(sel("rc-category", "Category (purpose)", [["", "All categories"]].concat(Object.keys(G.LIST_DEFAULTS).filter((k) => k.indexOf("purpose.") === 0).reduce((o, k) => o.concat(G.listOptions(st.db, k)), []).filter((x, i, a) => a.indexOf(x) === i).sort().map((x) => [x, x])), f.category || "", (v) => set("category", v)));
      if (has("status")) opts.push(sel("rc-status", "Status", [["", "All"]].concat(statusList().map((x) => [x, x === "AwaitingApproval" ? "Awaiting approval" : x])), f.status, (v) => set("status", v)));
      return opts.concat([h("div", { class: "rc-actions" }, canExport() ? exportMenu({ id: "rc-export", rep: () => rep, period: undefined, xlsx: true, csv: { name: "SOB_report.csv", get: () => R.toCSV(shownRep(rep)) } }) : null)]);
    };
    const bar = h("section", { class: "rc-bar card", id: "rc-bar" });
    paint(); return h("div", { id: "report-centre" }, privacyToggle(), bar, result);
  }
  function recon() {
    const list = (st.db.discrepancies || []).slice().sort((a, b) => (a.status === b.status ? 0 : a.status === "Open" ? -1 : 1)), integ = S.integrity.check(st.db, today()), un = S.integrity.unaccounted(st.db, today());
    return h("div", null, h("div", { class: "grid" }, Card("Open items", String(list.filter((d) => d.status === "Open").length), "Need a decision with evidence"), Card("Resolved", String(list.filter((d) => d.status === "Resolved").length)),
      Card("Data errors not in the register", String(un.length), un.length ? "Click to see" : "All accounted for", () => drill("Unaccounted data errors", "Errors the integrity check finds that no register item covers.", Table([{ label: "Code", key: "code" }, { label: "Detail", key: "detail" }], un))),
      Card("Integrity warnings", String(integ.warnings))),
      null,
      Table([{ label: "Kind", key: "kind", m: "s" }, { label: "Subject", key: "subject", m: "t" }, { label: "Summary", key: "summary", m: "x" }, { label: "Status", m: "b", render: (d) => badge(d.status, d.status === "Open" ? "warn" : "ok") }], list, (d) => openDiscrepancy(d.id)));
  }
  function openDiscrepancy(id) {
    const d = st.db.discrepancies.find((x) => x.id === id), body = h("div", null, h("p", null, d.summary), h("p", { class: "mute" }, "Platform: " + (d.platformValue ?? "—") + " · Source: " + (d.sourceValue ?? "—") + " · " + (d.source || "")),
      d.status === "Resolved" ? h("p", null, "Resolved (" + d.decision + "): " + d.resolutionReason + " — evidence: " + d.evidence) : null);
    if (d.status === "Open" && G.can(ctx(), "reconcile.manage")) body.append(h("button", { class: "primary", "data-act": "resolve", onclick: () => Form("Resolve " + d.subject, [
      { name: "decision", label: "Decision", options: [{ value: "ACCEPT_PLATFORM", label: "Platform is right (source is stale/explained)" }, { value: "NO_ACTION_EXPLAINED", label: "Explained, no change needed" }, { value: "ACCEPT_SOURCE_WITH_ENTRY", label: "Source is right: post a correcting entry" }] },
      { name: "reason", label: "Reason (required)" }, { name: "evidence", label: "Evidence, e.g. receipt no. / paper record (required)" },
      { name: "etype", label: "Correcting entry type (only for 'post a correcting entry')", options: ["Savings", "Withdraw", "Loan Repayment", "Expense", "Income"] }, { name: "eamt", label: "Entry amount", type: "number" }, dateF("edate", "Entry date"), { name: "emember", label: "Entry member ID", value: /^SOB-\d+/.test(d.subject) ? d.subject : "" }],
      act(async (f) => { await commit("resolveDiscrepancy", { id, decision: f.decision, reason: f.reason, evidence: f.evidence, entry: f.decision === "ACCEPT_SOURCE_WITH_ENTRY" ? { type: f.etype, amount: f.eamt, date: f.edate, memberId: f.emember } : undefined }); document.querySelector(".modal-bg") && document.querySelector(".modal-bg").remove(); }, "Resolved")) }, "Resolve"));
    drill("Discrepancy " + d.subject, null, body);
  }
  function audit() { const all = (st.db.auditLog || []).slice().reverse(); return Searchable("Search audit trail", (q) => { const hit = all.filter((a) => !q || ((a.entityType || "") + " " + (a.entityId || "") + " " + (a.action || "") + " " + (a.by || "") + " " + (a.reason || "")).toLowerCase().includes(q)); return h("div", null, h("p", { class: "mute", style: "font-size:13px" }, hit.length > 200 ? "Showing the latest 200 of " + hit.length + " — search to narrow." : (hit.length === 1 ? "1 entry" : hit.length + " entries")), Table([{ label: "When", render: (a) => D.toDisplay(a.date) }, { label: "Entity", render: (a) => a.entityType + " " + a.entityId }, { label: "Action", key: "action" }, { label: "By", key: "by" }, { label: "Reason", key: "reason" }], hit.slice(0, 200), null, "No audit entries match")); }); }

  /* ---------- member portal ---------- */
  const me = () => st.user.memberId;
  const MV = window.SOBMember({ st, act, commit, render, today, printReport, downloadReport, go, printAccount, openStatement, statementView });

  /* ---------- airtime (members request; Admin fulfils) ---------- */
  const airtimeCols = (staff) => [{ label: "Date", render: (r) => D.toDisplay(r.date) }].concat(staff ? [{ label: "Member", render: (r) => r.memberName + " (" + r.memberId + ")" }] : [], [{ label: "Phone", key: "phone" }, { label: "Airtime", num: 1, render: (r) => num(r.airtimeAmount) }, { label: "Fee", num: 1, render: (r) => num(r.fee) }, { label: "Total", num: 1, render: (r) => num(r.total) },
    { label: "Status", render: (r) => badge(r.status, r.status === "Pending" ? "warn" : r.status === "Fulfilled" ? "ok" : "bad") }]);
  const elig = (id) => (st.live && !isStaff() ? st.db.airtime : AT.eligibility(st.db, id, today()));
  function airtimeForm(memberId) {
    const e = elig(memberId); if (!e) return toast("Airtime information is not available", true);
    if (e.blockedByLoan) return toast("Airtime is not available while you have an unpaid loan.", true);
    const fields = [{ name: "amount", label: "Airtime amount (UGX) — up to " + num(e.remaining) + " left in " + D.monthYear(today()), type: "number" }, { name: "phone", label: "Phone to receive airtime (e.g. 0772123456)", value: ((st.db.members.find((m) => m.id === memberId) || {}).phone) || "" }];
    if (isStaff()) fields.unshift({ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) });
    Form("Request airtime", fields, act(async (f) => commit("requestAirtime", { memberId: f.m || memberId, amount: Number(f.amount), phone: f.phone }), "Request sent (total with UGX " + AT.SMS_FEE + " SMS fee will be deducted from savings when fulfilled)"), "Submit request");
  }
  function airtime() {
    const staff = isStaff(), id = staff ? null : me(), list = (st.db.airtimeRequests || []).filter((r) => staff || r.memberId === id).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const top = [];
    if (!staff) {
      const e = elig(id) || { used: 0, remaining: 0, monthlyCap: AT.MONTHLY_CAP, fee: AT.SMS_FEE, blockedByLoan: false, availableSavings: 0 };
      top.push(h("div", { class: "grid" }, Card("Used in " + D.monthYear(today()), ugx(e.used), "of " + ugx(e.monthlyCap)), Card("Remaining", ugx(e.remaining)), Card("SMS fee per request", ugx(e.fee), "Added to each request"), Card("Available savings", ugx(Math.max(0, e.availableSavings)))));
      top.push(e.blockedByLoan ? h("div", { class: "blocked", id: "airtime-blocked" }, "Airtime is not available while you have an unpaid loan. Please clear your loan balance first.") : h("p", { class: "mute" }, "For emergencies. Limit UGX " + num(e.monthlyCap) + " per calendar month. The airtime amount plus the UGX " + e.fee + " fee is deducted from your savings only when the Admin fulfils the request."));
      top.push(h("div", { class: "row" }, h("button", { class: "primary", id: "request-airtime", onclick: () => airtimeForm(id) }, "Request airtime")));
    } else if (G.can(ctx(), "airtime.manage")) top.push(h("div", { class: "row" }, h("button", { id: "request-airtime", onclick: () => airtimeForm(null) }, "Record a request for a member")));
    const cols = airtimeCols(staff).concat([{ label: "", render: (r) => r.status !== "Pending" ? "" : h("span", { class: "row", style: "margin:0" },
      G.can(ctx(), "airtime.manage") ? [h("button", { class: "primary", "data-fulfil": r.id, onclick: (ev) => { ev.stopPropagation(); act(async () => commit("fulfilAirtime", { id: r.id }), "Marked fulfilled — savings debited")(); } }, "Fulfil"),
        h("button", { class: "danger", "data-reject": r.id, onclick: (ev) => { ev.stopPropagation(); Form("Reject airtime request", [reasonField("reason.Reject")], act(async (f) => commit("rejectAirtime", { id: r.id, reason: f.reason }), "Rejected")); } }, "Reject")] : null,
      !staff ? h("button", { "data-cancel": r.id, onclick: (ev) => { ev.stopPropagation(); act(async () => commit("cancelAirtime", { id: r.id }), "Cancelled")(); } }, "Cancel") : null) }]);
    return h("div", null, top, h("h2", { class: "sec" }, staff ? "Airtime requests" : "My airtime requests"), Table(cols, list));
  }


  /* ---------- loan reminders: WhatsApp, officer-sent (Super Admin) ----------
     Every figure comes from the live ledger through the engine's own loan functions (core/reminders.js -> core/ledger.js); nothing is typed or stored in a template.
     The server prepares and records each message at the moment you press the button; this screen only displays. Opening WhatsApp is NOT recorded as delivery. */
  function remindersView() {
    const RM = RMD, asOf = today(), rem = st.rem = st.rem || { level: "AUTO" };
    if (st.live && rem.fresh !== true) {
      if (!rem.loading) { rem.loading = true; st.store.load().then(() => { st.db = st.store.db; rem.fresh = true; rem.loading = false; rem.at = new Date().toISOString(); render(); }).catch((e) => { rem.loading = false; rem.err = friendly(e); rem.fresh = "failed"; render(); }); }
      if (rem.fresh !== "failed") return State("loading");
    }
    if (st.live && rem.fresh === "failed") return h("div", null, h("div", { class: "blocked", id: "rem-unverified" }, "The live ledger could not be loaded (" + (rem.err || "no connection") + "), so no reminder can be prepared: figures that cannot be verified are never shown. "), h("button", { class: "primary", id: "rem-retry", onclick: () => { rem.fresh = false; render(); } }, "Try again"));
    const cfg = RM.getConfig(st.db), cand = RM.candidates(st.db, asOf), rows = cand.rows, ready = rows.filter((r) => !r.problem), hist = (st.db.reminders || []).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const lvlOpt = [{ value: "AUTO", label: "Automatic (recommended for each member)" }].concat(RM.LEVELS.map((l) => ({ value: l, label: RM.LEVEL_LABEL[l] })));
    const lvl = () => rem.level || "AUTO";
    const reload = async () => { await st.store.load(); st.db = st.store.db; rem.at = new Date().toISOString(); render(); };
    const memberOf = (id) => st.db.members.find((m) => m.id === id) || {};
    const whenTxt = (iso) => (iso ? D.toDisplay(String(iso).slice(0, 10)) + " " + RM.eatTime(iso) : "");
    const tone = { PREPARED: "warn", OPENED: "warn", SMS_ACCEPTED: "ok", SENT_CONFIRMED: "ok", CANCELLED: "mute" };
    const sentLike = (d) => d === "SENT_CONFIRMED" || d === "SMS_ACCEPTED";
    /* Send ONE reminder by SMS through the gateway: queue (re-checked against the ledger) -> targeted send -> record what the gateway answered */
    const smsSend = (rec, phone, m) => Form("Send by SMS", [{ type: "note", text: "Send this reminder as an SMS to " + rec.memberName + " (" + phone + ") now? It cannot be unsent." }], act(async () => {
      const q = await commit("queueReminderSms", { id: rec.id }); const out = q && q.outboxId ? q : { outboxId: ((st.db.reminders.find((x) => x.id === rec.id) || {}).smsOutboxId) };
      const r = await st.store.call({ action: "dispatchOutbox", ids: [out.outboxId] }); const s = await commit("syncReminderSms", { id: rec.id });
      if (s && s.outboxStatus === "SENT") { m && m.close(); } else if (s && s.outboxStatus === "FAILED") throw new Error("The SMS was not sent: " + (s.reason || "gateway error")); else throw new Error("The SMS gateway is not switched on, so nothing was sent."); }, "SMS accepted by the gateway. This does not prove the member received it."));
    /* the message window: text + the private-chat link. The link is a real <a>, so the browser opens it from the officer's own tap. */
    function messageModal(rec, text, phone, calcAt) {
      const link = RM.waLink(phone, text);
      const m = Modal((RM.LEVEL_LABEL[rec ? rec.level : lvl()] || "Reminder") + " — " + (rec ? rec.memberName : ""), h("div", null,
        h("p", { class: "mute", id: "rem-calc" }, "Calculated from the live ledger on " + D.longDate(calcAt.slice(0, 10)) + " at " + RM.eatTime(calcAt) + ". Every figure was re-checked when this message was prepared."),
        h("pre", { class: "wa-preview", id: "rem-text", style: "white-space:pre-wrap;word-break:break-word;background:var(--surface2,#f6f6f6);border:1px solid var(--line2,#ddd);border-radius:12px;padding:12px;font:inherit;max-height:50vh;overflow:auto" }, text),
        link ? h("div", { class: "row" },
          h("a", { class: "btn primary", id: "rem-open-wa", href: link, target: "_blank", rel: "noopener", style: "text-decoration:none;display:inline-block;padding:10px 16px", onclick: () => { if (rec && st.live) { commit("markReminderOpened", { id: rec.id }).then(() => toast("WhatsApp opened — delivery is NOT confirmed yet. Tap “I sent it” after you press Send in WhatsApp.", "warn")).catch((e) => toast(friendly(e), true)); } } }, "Open WhatsApp chat (private)"),
          rec && st.live ? h("button", { id: "rem-send-sms", onclick: () => smsSend(rec, phone, m) }, "Send by SMS") : null,
          rec ? h("button", { id: "rem-confirm-sent", onclick: () => act(async () => { await commit("confirmReminderSent", { id: rec.id, note: "" }); m.close(); }, "Recorded: sent (your confirmation)")().catch(() => {}) }, "I sent it") : null)
          : h("div", { class: "blocked" }, "This member has no valid Uganda WhatsApp number on record."),
        null));
      return m;
    }
    const doPreview = (r) => act(async () => {
      if (st.live) await reload();
      const cur = RM.candidates(st.db, today()).rows.find((x) => x.loan.id === r.loan.id); if (!cur) throw new Error("This loan no longer has a balance to remind.");
      if (cur.problem) throw new Error(cur.problem.replace(/^[A-Z_]+:\s*/, ""));
      const level = lvl() === "AUTO" ? cur.schedule.recommended : lvl(), nowISO = new Date().toISOString(), msg = RM.compose(st.db, cur.loan, level, today(), nowISO);
      const m = Modal("Preview — " + RM.LEVEL_LABEL[level] + " — " + msg.member.name, h("div", null, h("p", { class: "mute", id: "rem-calc" }, "Preview only: nothing is saved or sent. Calculated from the live ledger on " + D.longDate(today()) + " at " + RM.eatTime(nowISO) + ". It is recalculated again when you prepare it."),
        h("pre", { id: "rem-text", style: "white-space:pre-wrap;word-break:break-word;background:var(--surface2,#f6f6f6);border:1px solid var(--line2,#ddd);border-radius:12px;padding:12px;font:inherit;max-height:55vh;overflow:auto" }, msg.text)));
      void m;
    })().catch(() => {});
    const doPrepare = (r) => act(async () => {
      if (!st.live) throw new Error("This is demo data, not the live ledger. Reminders are only prepared against the live ledger.");
      const rec = await commit("prepareReminder", { loanId: r.loan.id, level: lvl() });
      const mem = memberOf(rec.memberId); messageModal(rec, rec.body, mem.phone, rec.calcAt);
    })().catch(() => {});
    const doBulk = () => act(async () => {
      if (!st.live) throw new Error("This is demo data, not the live ledger. Reminders are only prepared against the live ledger.");
      const res = await commit("prepareReminders", { level: lvl() });
      const ok = res.results.filter((x) => x.ok), skip = res.results.filter((x) => !x.ok);
      Modal("Reminders prepared — " + ok.length + " ready, " + skip.length + " skipped", h("div", null,
        h("p", { class: "mute", id: "rem-bulk-note" }, "Calculated from the live ledger on " + D.longDate(res.asOf) + " at " + RM.eatTime(res.calcAt) + ". Nothing has been sent. Open each message, press Send in WhatsApp, then tap “I sent it”."),
        Table([{ label: "Member", render: (x) => nameOf(x.memberId) + " (" + x.memberId + ")" }, { label: "Result", render: (x) => x.ok ? badge(RM.LEVEL_LABEL[x.level], "ok") : h("span", { class: "mute" }, String(x.reason).replace(/^[A-Z_]+:\s*/, "")) },
          { label: "", render: (x) => x.ok ? h("button", { class: "primary", "data-open-rem": x.reminderId, onclick: () => openStored(x.reminderId) }, "Open") : "" }], res.results, null, "Nothing to prepare")));
    })().catch(() => {});
    const openStored = (id) => act(async () => {
      const v = await commit("revalidateReminder", { id }), rec = (st.db.reminders || []).find((x) => x.id === id);
      messageModal(rec, v.text, v.phone, v.calcAt);
    })().catch(() => {});
    const followForm = (x) => Form("Follow-up — " + x.memberName, [{ name: "f", label: "Status", options: RM.FOLLOW.filter((k) => k !== "NONE").map((k) => ({ value: k, label: RM.FOLLOW_LABEL[k] })), value: x.followUp === "NONE" ? "AWAITING_REPLY" : x.followUp }, { name: "d", label: "Date promised (only for “Promised to pay”)", type: "date" }, { name: "n", label: "Note", value: x.followUpNote || "" },
      { type: "note", text: "A promise to pay is only a note. It changes no balance." }],
      act(async (f) => commit("setReminderFollowUp", { id: x.id, followUp: f.f, promiseDate: f.d, note: f.n }), "Follow-up recorded"));
    const datesForm = () => Form("Share-out date and approved repayment deadline", [
      { type: "note", text: "These dates drive the reminders. Changes need the Chairperson's approval." },
      { name: "so", label: "Official share-out date (December)", type: "date", value: cfg.shareOutDate || "" }, { name: "dl", label: "Approved repayment deadline (on or before the share-out date)", type: "date", value: cfg.deadline || "" }, { name: "reason", label: "Reason / authority (e.g. committee decision and date)" }],
      act(async (f) => commit("setReminderDates", { shareOutDate: f.so, deadline: f.dl, loanDeadlines: cfg.loanDeadlines, reason: f.reason })), "Send to the Chairperson");
    const loanDeadlineForm = (r) => Form("Approved deadline for " + nameOf(r.loan.memberId), [{ type: "note", text: "Replaces the general deadline for this loan. Needs approval; leave blank to keep the general one." },
      { name: "dl", label: "Deadline for this loan", type: "date", value: cfg.loanDeadlines[r.loan.id] || "" }, { name: "reason", label: "Reason / authority" }],
      act(async (f) => commit("setReminderDates", { shareOutDate: cfg.shareOutDate, deadline: cfg.deadline, loanDeadlines: Object.assign({}, cfg.loanDeadlines, { [r.loan.id]: f.dl }), reason: f.reason })), "Send to the Chairperson");
    const autoForm = () => { const a = RM.getAuto(st.db); return Form("Automatic reminders (SMS)", [
      { type: "note", text: "When ON, members who still owe get short SMS messages each day this schedule applies. Nothing is sent unless the SMS gateway is live. Changes need the Chairperson's approval and are recorded." },
      { name: "enabled", label: "Automatic reminders", options: [{ value: "true", label: "ON" }, { value: "false", label: "OFF" }], value: String(a.enabled) },
      { name: "r", label: "Regular reminder every (days) before the deadline", type: "number", value: a.regularEveryDays, inputmode: "numeric" },
      { name: "a", label: "Tell the member their name goes to Church Administration after (days with no payment)", type: "number", value: a.adminAfterDays, inputmode: "numeric" },
      { name: "b", label: "Serious reminder about the Bishop when this many days (or fewer) remain before the deadline", type: "number", value: a.bishopDaysBefore, inputmode: "numeric" },
      { name: "reason", label: "Reason / authority (e.g. committee decision and date)" }],
      act(async (f) => commit("setAutoReminders", { enabled: f.enabled === "true", regularEveryDays: Number(f.r), adminAfterDays: Number(f.a), bishopDaysBefore: Number(f.b), reason: f.reason })), "Send to the Chairperson"); };
    const receiptForm = () => Form("Automatic SMS receipts to members", [
      { type: "note", text: "When ON, every successful transaction sends the member one short SMS: the amount, the new savings balance and, if they have an active loan, the loan balance. Withdrawals are sent only after the Chairperson has approved them. Imported or historical entries never send a receipt. Nothing is sent unless the SMS gateway is live. Changes need the Chairperson's approval and are recorded." },
      { name: "enabled", label: "Automatic SMS receipts", options: [{ value: "true", label: "ON" }, { value: "false", label: "OFF" }], value: String(RM.getReceipts(st.db).enabled) },
      { name: "reason", label: "Reason / authority (e.g. committee decision and date)" }],
      act(async (f) => commit("setReceiptSms", { enabled: f.enabled === "true", reason: f.reason })), "Send to the Chairperson");
    const timingForm = () => Form("Reminder timing", [{ name: "u", label: "“Urgent” starts when this many days or fewer remain to the deadline", type: "number", value: cfg.urgentDays, inputmode: "numeric" }, { name: "f", label: "“Final Notice” starts when this many days or fewer remain (or the deadline has passed)", type: "number", value: cfg.finalDays, inputmode: "numeric" },
      { name: "mi", label: "Minimum days between two reminders at the same level for one loan", type: "number", value: cfg.minIntervalDays, inputmode: "numeric" }, { name: "reason", label: "Reason" }],
      act(async (f) => commit("setReminderSettings", { urgentDays: f.u, finalDays: f.f, minIntervalDays: f.mi, reason: f.reason }), "Saved"));
    const wordingForm = () => Form("Edit message wording — choose the level", [{ name: "lv", label: "Level", options: RM.LEVELS.map((l) => ({ value: l, label: RM.LEVEL_LABEL[l] })) }], async (f) => {
      const T = cfg.templates[f.lv], nm = { intro: "Opening paragraph", request: "Request paragraph", stewardship: "Stewardship paragraph", scripture: "Scripture line", thanks: "Thank-you line", signature: "Signature" };
      setTimeout(() => Form("Wording — " + RM.LEVEL_LABEL[f.lv], [{ type: "note", text: "Words only; amounts and dates fill in automatically. You may use " + RM.PLACEHOLDERS.map((x) => "{" + x + "}").join(" ") + "." }]
        .concat(RM.FIELDS.map((k) => ({ name: k, label: nm[k], type: "textarea", value: T[k] }))).concat([{ name: "reason", label: "Reason" }]),
        act(async (g) => { const t = {}; RM.FIELDS.forEach((k) => { if (g[k] !== T[k]) t[k] = g[k]; }); await commit("setReminderSettings", { templates: { [f.lv]: t }, reason: g.reason }); }, "Wording saved"), "Save wording"), 50);
    }, "Next");
    /* ESCALATION: overdue loans reported to the church administrator, then the Bishop. The officer previews, then sends; the list is rebuilt from the ledger on the server. */
    const esc = RM.getEscalation(st.db);
    const escForm = () => Form("Who is told about overdue loans", [{ type: "note", text: "Church administrator first, then the Bishop as the highest escalation. Days are counted after the approved repayment deadline. Needs the Chairperson's approval. Numbers are kept only in the Sheet." }]
      .concat(esc.reduce((a, x) => a.concat([{ name: x.id + "_name", label: x.label + " — name", value: x.name || "" }, { name: x.id + "_phone", label: x.label + " — phone", value: x.phone || "", inputmode: "tel" }, { name: x.id + "_days", label: x.label + " — told this many days after the deadline", type: "number", value: x.afterDays, inputmode: "numeric" }]), [])).concat([{ name: "reason", label: "Reason / authority" }]),
      act(async (f) => commit("setEscalation", { steps: { ADMIN: { name: f.ADMIN_name, phone: f.ADMIN_phone, afterDays: Number(f.ADMIN_days) }, BISHOP: { name: f.BISHOP_name, phone: f.BISHOP_phone, afterDays: Number(f.BISHOP_days) } }, reason: f.reason })), "Send to the Chairperson");
    const escSend = (x) => { let plan; try { plan = RM.escalationPlan(st.db, { step: x.id, asOf: asOf }); } catch (e) { return toast(friendly(e), "warn"); }
      if (!plan.ready) return toast(plan.note, "warn");
      Form("Tell the " + x.label + "?", [{ type: "note", text: plan.rows.length + " member(s), total " + num(plan.total) + ". The message is built again from the ledger when you press Send, goes to " + x.label + " only, and cannot be unsent." }, { type: "note", text: plan.texts.join("\n\n") }],
        act(async () => { const q = await commit("queueEscalation", { step: x.id }); const r = await st.store.call({ action: "dispatchOutbox", ids: q.outboxIds }); const bad = r.result.failed + r.result.dryRun; if (bad) throw new Error(r.result.dryRun ? "The SMS gateway is not switched on, so nothing was sent." : "The SMS was not sent: gateway error."); await reload(); }, "Sent to the " + x.label), "Send SMS"); };
    const escPanel = () => h("div", { id: "esc-panel" }, h("h2", { class: "sec" }, "Overdue loans: tell the church administrator, then the Bishop"),
      h("p", { class: "mute" }, "After the approved deadline, the church administrator is told first and the Bishop later if members are still unpaid. Nothing is sent unless an officer presses Send. Members are not messaged here."),
      Table([{ label: "Step", render: (x) => x.label }, { label: "Name", key: "name" }, { label: "Phone", render: (x) => x.phone ? "set" : badge("Not set", "bad") }, { label: "After deadline (days)", num: 1, key: "afterDays" }, { label: "Overdue now", num: 1, render: (x) => { try { return String(RM.escalationPlan(st.db, { step: x.id, asOf: asOf }).rows.length); } catch (e) { return "-"; } } },
        { label: "", render: (x) => st.live ? h("button", { "data-esc-send": x.id, onclick: () => escSend(x) }, "Preview and send") : "" }], esc),
      h("div", { class: "row" }, h("button", { id: "esc-set", onclick: escForm }, "Set contacts and days")));
    const notSet = !cfg.shareOutDate || !cfg.deadline;
    const oldBackend = st.live && CFG.build && st.store.serverBuild && st.store.serverBuild !== CFG.build;
    return h("div", null,
      oldBackend ? h("div", { class: "blocked", id: "rem-backend-old" }, "The Google backend is out of date (" + st.store.serverBuild + ", needs " + CFG.build + "). Reminder actions are refused until the latest Code.gs is deployed as a New version.") : null,
      !st.live ? h("div", { class: "blocked", id: "rem-demo" }, "Demo data. Reminders work only on the live ledger.") : null,
      h("p", { class: "mute", id: "rem-asof" }, "Figures calculated from the " + (st.live ? "live ledger" : "demo data") + " for " + D.longDate(asOf) + (rem.at ? ", loaded at " + RM.eatTime(rem.at) : "") + ". Each reminder is recalculated again, on the server, at the moment it is prepared."),
      notSet ? h("div", { class: "blocked", id: "rem-notset" }, "Set the share-out date and repayment deadline first.") : null,
      h("div", { class: "grid" }, Card("Share-out date", cfg.shareOutDate ? D.longDate(cfg.shareOutDate) : "Not set", cfg.shareOutDate ? RM.daysBetween(asOf, cfg.shareOutDate) + " days to go" : ""), Card("Approved deadline", cfg.deadline ? D.longDate(cfg.deadline) : "Not set", cfg.deadline ? RM.daysBetween(asOf, cfg.deadline) + " days to go" : ""),
        Card("Loans with a balance", String(rows.length), cand.excluded.settled + " settled loans are left out automatically"), Card("Total still owed", ugx(rows.filter((r) => r.figures).reduce((a, r) => a + r.figures.totalOutstanding, 0)), "as at " + D.longDate(asOf))),
      h("div", { class: "row" }, h("button", { class: "primary", id: "rem-dates", onclick: datesForm }, "Set share-out date & deadline"), h("button", { id: "rem-timing", onclick: timingForm }, "Timing"), h("button", { id: "rem-auto", onclick: autoForm }, "Automatic reminders: " + (RM.getAuto(st.db).enabled ? "ON" : "OFF")), h("button", { id: "rem-receipts", onclick: receiptForm }, "SMS receipts: " + (RM.getReceipts(st.db).enabled ? "ON" : "OFF")), h("button", { id: "rem-wording", onclick: wordingForm }, "Message wording"),
        st.live ? h("button", { id: "rem-recalc", onclick: () => act(reload, "Recalculated from the live ledger")().catch(() => {}) }, "Recalculate now") : null),
      escPanel(),
      h("h2", { class: "sec" }, "Members with an outstanding loan"),
      h("div", { class: "row" }, h("div", null, h("label", null, "Reminder level"), h("select", { id: "rem-level", onchange: (e) => { rem.level = e.target.value; } }, lvlOpt.map((o) => h("option", Object.assign({ value: o.value }, lvl() === o.value ? { selected: "selected" } : {}), o.label)))),
        h("button", { class: "primary", id: "rem-bulk", disabled: !ready.length || notSet, onclick: doBulk }, "Prepare reminders for all " + ready.length + " (private chats)")),
      Table([{ label: "Member", render: (r) => h("span", null, nameOf(r.loan.memberId), h("br"), h("span", { class: "mute" }, r.loan.memberId + " · " + r.loan.id)) }, { label: "Total owed", num: 1, render: (r) => r.figures ? ugx(r.figures.totalOutstanding) : "—" },
        { label: "Deadline", render: (r) => r.schedule ? D.toDisplay(r.schedule.deadline) + " (" + (r.schedule.daysToDeadline >= 0 ? r.schedule.daysToDeadline + " d" : Math.abs(r.schedule.daysToDeadline) + " d overdue") + ")" : "—" },
        { label: "Recommended", render: (r) => r.schedule ? badge(RM.LEVEL_LABEL[r.schedule.recommended], r.schedule.recommended === "FINAL" ? "bad" : r.schedule.recommended === "URGENT" ? "warn" : "ok") : "—" },
        { label: "Last reminder", render: (r) => r.last ? RM.LEVEL_LABEL[r.last.level] + " · " + D.toDisplay(r.last.asOf) + " · " + RM.DELIVERY_LABEL[r.last.delivery] : "None yet" },
        { label: "", render: (r) => r.problem ? h("span", { class: "mute", "data-problem": r.loan.id }, r.problem.replace(/^[A-Z_]+:\s*/, "")) : h("div", { class: "row", style: "margin:0" }, h("button", { "data-preview": r.loan.id, onclick: () => doPreview(r) }, "Preview"), h("button", { class: "primary", "data-prepare": r.loan.id, onclick: () => doPrepare(r) }, "WhatsApp"), h("button", { "data-loan-deadline": r.loan.id, onclick: () => loanDeadlineForm(r) }, "Deadline")) }], rows, null, "No loans with a balance"),
      h("h2", { class: "sec" }, "Reminder history and follow-up"),
      Table([{ label: "Prepared", render: (x) => whenTxt(x.createdAt) }, { label: "Member", render: (x) => x.memberName + " (" + x.memberId + ")" }, { label: "Level", render: (x) => RM.LEVEL_LABEL[x.level] }, { label: "Owed then", num: 1, render: (x) => ugx(x.figures.totalOutstanding) },
        { label: "Delivery", render: (x) => badge(RM.DELIVERY_LABEL[x.delivery], tone[x.delivery]) }, { label: "Follow-up", render: (x) => RM.FOLLOW_LABEL[x.followUp] + (x.promiseDate ? " (by " + D.toDisplay(x.promiseDate) + ")" : "") },
        { label: "", render: (x) => x.delivery === "CANCELLED" ? "" : h("div", { class: "row", style: "margin:0" }, !sentLike(x.delivery) ? h("button", { "data-hist-open": x.id, onclick: () => openStored(x.id) }, "Open WhatsApp") : null,
          x.delivery === "OPENED" ? h("button", { "data-hist-sent": x.id, onclick: () => act(async () => commit("confirmReminderSent", { id: x.id, note: "" }), "Recorded: sent (your confirmation)")().catch(() => {}) }, "I sent it") : null,
          x.delivery !== "PREPARED" ? h("button", { "data-hist-follow": x.id, onclick: () => followForm(x) }, "Follow-up") : null,
          !sentLike(x.delivery) ? h("button", { "data-hist-cancel": x.id, onclick: () => Form("Cancel reminder", [{ name: "reason", label: "Reason (required)" }], act(async (f) => commit("cancelReminder", { id: x.id, reason: f.reason }), "Cancelled")) }, "Cancel") : null) }], hist, null, "No reminders prepared yet"),
      h("p", { class: "mute" }, "Live-book loans only. Reminders never change a balance."));
  }

  /* ---------- messages / outbox (Admin) ---------- */
  function messages() {
    if (st.live && !st.gw) { st.gw = { SMS: false, WHATSAPP: false, loading: true }; st.store.call({ action: "gatewayStatus" }).then((r) => { st.gw = r.live; render(); }).catch(() => { st.gw = { SMS: false, WHATSAPP: false }; render(); }); }
    const gw = st.live ? (st.gw || {}) : { SMS: false, WHATSAPP: false }, sum = N.summary(st.db), ob = (st.db.outbox || []).slice().reverse().slice(0, 200);
    const anyLive = !!(gw.SMS || gw.WHATSAPP);
    const proc = async () => {
      if (st.live) { const r = await st.store.call({ action: "dispatchOutbox" }); await st.store.load(); st.db = st.store.db; st.gw = r.live; toast("Processed: " + r.result.sent + " sent, " + r.result.dryRun + " dry-run, " + r.result.failed + " failed, " + r.result.skipped + " skipped"); }
      else { const r = N.dispatch(st.db, ctx(), {}, {}); toast("Dry-run: " + r.dryRun + " rendered, nothing sent"); }
      render();
    };
    return h("div", null,
      anyLive ? h("p", { class: "mute", id: "gw-live" }, "A gateway is configured as live. Messages marked SENT were confirmed by it.")
        : h("div", { class: "blocked", id: "dryrun-banner" }, "Dry run: nothing is sent to any phone."),
      h("div", { class: "grid" }, ["QUEUED", "DRY_RUN", "SENT", "FAILED", "SKIPPED"].map((k) => Card(k.replace("_", "-"), String(sum[k] || 0)))),
      h("div", { class: "row" }, h("button", { class: "primary", id: "process-outbox", onclick: act(proc) }, "Process outbox"),
        h("button", { id: "send-message", onclick: () => Form("Message a member", [{ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) }, { name: "channel", label: "Channel", options: ["SMS", "WHATSAPP"] }, { name: "text", label: "Message (max 320 characters)", type: "textarea" }], act(async (f) => commit("sendMessage", { memberId: f.m, channel: f.channel, text: f.text }), "Queued in the outbox")) }, "New message")),
      Table([{ label: "Created", render: (m) => D.toDisplay(String(m.createdAt).slice(0, 10)) }, { label: "To", render: (m) => m.to === "ADMIN" ? "Admin phone" : (m.memberId ? nameOf(m.memberId) + " " : "") + m.to }, { label: "Channel", key: "channel" }, { label: "Message", key: "body" },
        { label: "Status", render: (m) => badge(m.status, m.status === "SENT" ? "ok" : m.status === "FAILED" ? "bad" : m.status === "QUEUED" || m.status === "DRY_RUN" ? "warn" : "mute") }, { label: "Note", key: "reason" },
        { label: "", render: (m) => ["SENT", "CANCELLED"].includes(m.status) ? "" : h("button", { "data-cancel-msg": m.id, onclick: () => Form("Cancel message", [{ name: "reason", label: "Reason (required)" }], act(async (f) => commit("cancelMessage", { id: m.id, reason: f.reason }), "Cancelled")) }, "Cancel") }], ob),
      null);
  }


  /* ---------- load the verified SOB records (Admin, live deployment) ---------- */
  const randPin = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(a[0] % 1000000).padStart(6, "0"); };
  const randPin8 = () => { const a = new Uint32Array(2); crypto.getRandomValues(a); return String(10000000 + ((a[0] * 4294967296 + a[1]) % 90000000)); };
  function recordsPanel() {
    const rc = st.rec = st.rec || {}, LD = S.loader;
    const refresh = async () => { await st.store.load(); st.db = st.store.db; rc.state = rc.pack ? LD.inspect(st.db, rc.pack) : null; render(); };
    const say = (m) => { rc.msg = m; const el = document.getElementById("records-progress"); if (el) el.textContent = m; };
    const approver = () => (document.getElementById("records-approver") || {}).value || "";
    const run = (dry) => act(async () => {
      if (!rc.pack) throw new Error("Choose the SOB records file first.");
      try { rc.res = await LD.load((b) => st.store.call(b), rc.pack, { approvedBy: approver(), asOf: today(), dryRun: dry, say }); } finally { await refresh(); }
    }, dry ? "Check finished" : "Finished — read the result below");
    const purge = () => { if (!rc.pack) return toast("Choose the SOB records file first.", "warn"); if (!confirm("Remove all demo records? A backup is taken first. Real records are never removed.")) return;
      act(async () => { const r = await st.store.call({ action: "purgeDemoLedger", confirm: "REMOVE DEMO DATA", demoNames: window.SOB_DEMO_NAMES || [], realNames: LD.realNames(rc.pack) }); rc.purged = r; await refresh(); }, "Demo records removed (backup kept)")(); };
    const file = h("input", { type: "file", id: "records-file", accept: ".json,application/json", onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const p = JSON.parse(await f.text()), bad = LD.validatePack(p); if (bad.length) throw new Error(bad.join(" ")); rc.pack = p; rc.name = f.name; rc.res = null; rc.state = LD.inspect(st.db, p); toast("Records file read"); }
      catch (err) { rc.pack = null; rc.state = null; toast("That file cannot be used: " + friendly(err), "warn"); } render(); } });
    const stateText = { empty: "The Google Sheet is empty: ready to load.", loaded: "SOB records are already in the Sheet. Loading again adds nothing twice.", foreign: "The Sheet holds demo/sample records, not SOB members. Remove them first.", mixed: "The Sheet mixes SOB members with unknown records. Nothing will be changed; ask for help." };
    const rep = rc.pack && rc.state && ["loaded", "mixed"].includes(rc.state.state) ? LD.build(st.db, rc.pack, today()) : null, reps = rep ? LD.asReports(rep) : [];
    const sign = () => {
      const have = new Set((st.db.users || []).map((u) => u.id)), need = st.db.members.filter((m) => m.status !== "Inactive" && !have.has(m.id));
      return h("div", null, h("h2", { class: "sec" }, "Sign-ins"), h("p", { class: "mute" }, need.length + " member(s) have no sign-in yet. Each gets a one-time password and chooses their own at first sign-in. Download the slips once, print, then delete the file."),
        h("div", { class: "row" }, h("button", { id: "make-signins", disabled: !need.length, onclick: act(async () => {
          const slips = []; for (const m of need) { const pin = randPin(); await st.store.createUser({ id: m.id, name: m.name, role: "Member", memberId: m.id, pin }); slips.push([m.id, m.name, pin]); }
          download("SOB-PIN-slips-" + today() + ".csv", "text/csv", "id,name,pin\n" + slips.map((x) => [x[0], '"' + x[1].replace(/"/g, '""') + '"', x[2]].join(",")).join("\n")); await refresh();
        }, "Sign-ins created; PIN slips downloaded") }, "Create member sign-ins + download PIN slips"),
        h("button", { id: "make-staff", onclick: () => Form("Staff sign-in", [{ name: "id", label: "Sign-in ID (e.g. CHAIR)" }, { name: "name", label: "Name" }, { name: "role", label: "Role", options: ["Chairperson", "Treasurer", "Secretary", "Committee"] }],
          act(async (f) => { const pin = randPin8(); await st.store.createUser({ id: f.id.trim().toUpperCase(), name: f.name, role: f.role, pin }); download("SOB-staff-PIN-" + f.id.trim().toUpperCase() + ".csv", "text/csv", "id,name,role,pin\n" + [f.id.trim().toUpperCase(), '"' + f.name + '"', f.role, pin].join(",")); await refresh(); }, "Sign-in created; PIN downloaded")) }, "Add staff sign-in")));
    };
    return h("div", { id: "records-panel" }, h("h2", { class: "sec", style: "margin-top:0" }, "Load SOB records"),
      null,
      h("div", { class: "row" }, file), rc.pack ? h("p", { class: "mute" }, "File: " + rc.name + " — " + rc.pack.controls.members + " members, " + rc.pack.controls.legacyTransactions + " current entries, " + rc.pack.controls.historyEntries + " historical entries.") : null,
      rc.state ? h("div", { class: rc.state.state === "foreign" || rc.state.state === "mixed" ? "blocked" : "hint", id: "records-state" }, stateText[rc.state.state] + " (" + rc.state.members + " members, " + rc.state.transactions + " transactions, " + rc.state.loans + " loans in the Sheet now)") : null,
      h("div", { class: "field" }, h("label", { for: "records-approver" }, "Approved by (name, role, date)"), h("input", { id: "records-approver", type: "text", placeholder: "e.g. Name, Role, 8 Oct 2026", value: rc.approver || "", oninput: (e) => { rc.approver = e.target.value; } })),
      h("div", { class: "row" }, h("button", { id: "records-check", disabled: !rc.pack, onclick: run(true) }, "Check only"), h("button", { class: "primary", id: "records-load", disabled: !rc.pack || (rc.state && ["foreign", "mixed"].includes(rc.state.state)), onclick: run(false) }, "Load records"),
        rc.state && rc.state.state === "foreign" ? h("button", { class: "danger", id: "records-purge", onclick: purge }, "Remove demo records") : null),
      h("p", { class: "mute", id: "records-progress" }, rc.msg || ""),
      rc.res ? h("div", { id: "records-result" }, Banner(rc.res.ok ? "ok" : "bad", rc.res.ok ? "All checks passed." : "Some checks did not pass. Nothing was forced; read the lines marked FAIL."),
        h("ul", { class: "checks" }, rc.res.checks.map((c) => h("li", { class: c.pass ? "ok" : "bad" }, (c.pass ? "PASS " : "FAIL ") + c.name + (c.detail ? " — " + c.detail : "")))),
        rc.res.pending && rc.res.pending.length ? h("div", { class: "hint", id: "records-pending" }, "Waiting for the Chairperson in Approvals (" + rc.res.pending.length + "): " + rc.res.pending.join("; ") + ". When they have approved, press Load records once more to finish the repayments.") : null) : null,
      rep ? h("div", { id: "records-report" }, h("h2", { class: "sec" }, "Reconciliation report"),
        h("div", { class: "grid" }, Card("Actual savings", ugx(rep.totals.savings), "After withdrawals and share-outs"), Card("Available savings", ugx(rep.totals.available)), Card("Loan principal outstanding", ugx(rep.totals.loanPrincipal)), Card("Unpaid interest", ugx(rep.totals.unpaidInterest)), Card("Profit credited", ugx(rep.totals.profitCredited)), Card("Open register items", String(rep.register.filter((x) => x.status === "Open").length))),
        null,
        reps.map((r) => h("div", null, h("h3", null, r.title), h("div", { class: "row" }, printButton(r, "As at " + D.toDisplay(rep.asOf), r.title.replace(/\W+/g, "_") + ".csv")), tableFromReport(r))),
        rep.missing.length ? h("div", null, h("h3", null, "Information genuinely missing"), h("ul", null, rep.missing.map((x) => h("li", null, x)))) : null,
        rep.decisions.length ? h("div", null, h("h3", null, "SOB decisions still needed"), h("ul", null, rep.decisions.map((x) => h("li", null, x)))) : null) : null,
      sign());
  }
  /* ---------- system: backups + sign-ins (Admin, live deployment) ---------- */
  /* configurable lists: the Super Admin extends the choices offered in forms without any redevelopment */
  function listsPanel() {
    const add = (key) => Form("Add an option: " + G.LIST_TITLES[key], [{ name: "label", label: "New option (max 60 characters)" }, { name: "reason", label: "Reason" }], act(async (f) => commit("addListItem", { list: key, label: f.label, reason: f.reason }), "Option added"));
    const retire = (key, label) => Form("Retire \"" + label + "\" from " + G.LIST_TITLES[key], [{ type: "note", text: "Entries already recorded keep their wording. The option simply stops being offered." }, { name: "reason", label: "Reason" }], act(async (f) => commit("retireListItem", { list: key, label, reason: f.reason }), "Option retired"));
    return h("div", { id: "lists-panel" }, h("h2", { class: "sec" }, "Lists and options"), null,
      Object.keys(G.LIST_DEFAULTS).map((key) => h("div", { class: "panel" }, h("b", null, G.LIST_TITLES[key]), h("div", { class: "chips" }, G.listOptions(st.db, key).map((label) => h("span", { class: "chip" }, label, " ", h("button", { class: "linkbtn", "aria-label": "Retire " + label, onclick: () => retire(key, label) }, "×")))), h("button", { "data-add-list": key, onclick: () => add(key) }, "Add an option"))));
  }
  /* outstanding entries: confirmed transactions that were not yet entered, supplied as a private file; posted only through the ledger's own rules */
  function outstandingPanel() {
    const oc = st.out = st.out || {};
    const approver = () => (document.getElementById("out-approver") || {}).value || "";
    const go = (dry) => act(async () => {
      if (!oc.pack) throw new Error("Choose the outstanding-entries file first.");
      if (!approver().trim()) throw new Error("Type who confirmed these entries (name, role, date).");
      oc.res = (await st.store.call({ action: "command", name: "processOutstandingEntries", args: { batchId: oc.pack.batchId, approvedBy: approver(), entries: oc.pack.entries, dryRun: dry } })).result;
      if (!dry) { await st.store.load(); st.db = st.store.db; } render();
    }, dry ? "Check finished — nothing was posted" : "Finished — read the result below");
    const file = h("input", { type: "file", id: "out-file", accept: ".json,application/json", onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const p = JSON.parse(await f.text()); if (!p || p.kind !== "SOB_ENTRIES_PACK" || !Array.isArray(p.entries) || !p.batchId) throw new Error("This is not an outstanding-entries file."); if (p.controls && p.controls.count !== p.entries.length) throw new Error("The entry count does not match the file's control total."); oc.pack = p; oc.name = f.name; oc.res = null; toast("Entries file read"); }
      catch (err) { oc.pack = null; toast("That file cannot be used: " + friendly(err), "warn"); } render(); } });
    return h("div", { id: "outstanding-panel" }, h("h2", { class: "sec" }, "Enter outstanding transactions"),
      h("p", { class: "mute" }, "For transactions the Chairperson has confirmed but that are not yet in the ledger. Each keeps its original date. Repayments are checked against the loan, its owner and what is still owed. Withdrawals go to the Chairperson for approval. Pressing the button twice adds nothing twice."),
      h("div", { class: "row" }, file), oc.pack ? h("p", { class: "mute" }, "File: " + oc.name + " — " + oc.pack.entries.length + " entries, batch " + oc.pack.batchId + ".") : null,
      h("div", { class: "field" }, h("label", { for: "out-approver" }, "Confirmed by (name, role, date)"), h("input", { id: "out-approver", type: "text", placeholder: "e.g. Name, Role, 18 Nov 2026", value: oc.approver || "", oninput: (e) => { oc.approver = e.target.value; } })),
      h("div", { class: "row" }, h("button", { id: "out-check", disabled: !oc.pack, onclick: go(true) }, "Check only"), h("button", { class: "primary", id: "out-post", disabled: !oc.pack, onclick: go(false) }, "Enter transactions")),
      oc.res ? h("div", { id: "out-result" }, Banner("ok", (oc.res.dryRun ? "Check passed. Nothing was posted. " : "") + oc.res.posted + " to post or posted, " + oc.res.awaitingApproval + " waiting for the Chairperson, " + oc.res.alreadyProcessed + " already done."),
        Table([{ label: "Date", render: (r) => D.toDisplay(r.date) }, { label: "Member", key: "memberId" }, { label: "Type", key: "type" }, { label: "Loan", key: "loanId" }, { label: "Amount (UGX)", num: 1, render: (r) => num(r.amount) }, { label: "Result", key: "result" }], oc.res.rows)) : null);
  }
  function system() {
    if (!st.live) return h("div", { class: "blocked" }, "Available on the live deployment only.");
    if (!st.sys) { st.sys = { loading: true, backups: [] }; st.store.call({ action: "listBackups" }).then((r) => { st.sys = { backups: r.backups }; render(); }).catch((e) => { st.sys = { backups: [], error: friendly(e) }; render(); }); }
    const reload = async () => { st.sys = null; render(); };
    const download = async () => {
      const r = await st.store.call({ action: "exportBackup" }), a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(r.backup)], { type: "application/json" })), download: "SOB-backup-" + today() + ".json" }); document.body.append(a); a.click(); a.remove(); toast("Backup downloaded — it contains members' personal data; keep it private");
    };
    return h("div", null, recordsPanel(), outstandingPanel(), listsPanel(), h("h2", { class: "sec" }, "Backups"),
      null,
      h("div", { class: "row" }, h("button", { class: "primary", id: "backup-now", onclick: act(async () => { const r = await st.store.call({ action: "backupNow", force: true }); toast("Snapshot " + r.id + " saved"); await reload(); }) }, "Back up now"), h("button", { id: "backup-download", onclick: act(download) }, "Download offline backup")),
      st.sys && st.sys.error ? h("div", { class: "err" }, st.sys.error) : null,
      Table([{ label: "Snapshot", key: "id" }, { label: "When", key: "createdAt" }, { label: "Label", key: "label" }, { label: "Ledger revision", num: 1, key: "revision" }, { label: "", render: (b) => h("button", { "data-verify-backup": b.id, onclick: act(async () => { const r = await st.store.call({ action: "verifyBackup", id: b.id }); toast("Verified: " + r.counts.transactions + " transactions, checksum OK"); }) }, "Verify") }], (st.sys && st.sys.backups) || []),
      null,
      h("h2", { class: "sec" }, "Sign-ins"),
      Table([{ label: "ID", key: "id" }, { label: "Name", key: "name" }, { label: "Role", key: "role" }, { label: "Status", render: (u) => badge(u.status, u.status === "Active" ? "ok" : "bad") }, { label: "", render: (u) => u.id === st.user.id || u.status === "Disabled" ? "" : h("button", { class: "danger", "data-disable": u.id, onclick: () => { if (confirm("Disable sign-in for " + u.id + "?")) act(async () => { await st.store.disableUser(u.id); await st.store.load(); st.db = st.store.db; render(); }, "Sign-in disabled")(); } }, "Disable") }], st.db.users || []));
  }
  /* ---------- General Reserve Fund: SOB's collective reserve, fed only by verified unallocated profit, every movement evidenced and Chairperson-approved ---------- */
  function reserveView() {
    const stmt = RSV.statement(st.db), yrs = FYM.table(st.db), canW = G.can(ctx(), "reserve.manage");
    const rows = yrs.map((y) => { const a = RSV.available(st.db, y.year), p = PRC.year(st.db, y.year, today()); return { label: y.label, earned: p.earnedRecorded, credited: a.credited, verified: a.verified, moved: a.transferred, available: a.available }; });
    const yearOpts = yrs.map((y) => ({ value: y.year, label: y.label })), histOpts = (st.db.historicalLoans || []).filter((l) => !l.voided).map((l) => ({ value: l.id, label: ((st.db.members.find((m) => m.id === l.memberId) || {}).name || l.memberId) + " · " + D.toDisplay(l.date) + " · owed " + num(HLN.position(st.db, l.id).outstanding) }));
    return h("div", null, null,
      h("div", { class: "grid" }, Card("Reserve balance", ugx(stmt.balance), "Closing balance today"), Card("Movements", String(stmt.entries.length), stmt.entries.length ? "Each with evidence" : "No reserve balance exists in the records yet"), Card("Years with verified profit", String(rows.filter((r) => r.verified !== null).length), "of " + rows.length)),
      h("h2", { class: "sec" }, "Profit available for the reserve, by financial year"),
      Table([{ label: "Year", key: "label" }, { label: "Profit earned (recorded)", num: 1, render: (r) => num(r.earned) }, { label: "Credited to members", num: 1, render: (r) => num(r.credited) }, { label: "Verified by Chairperson", num: 1, render: (r) => r.verified === null ? badge("Not verified", "bad") : num(r.verified) }, { label: "Already in reserve", num: 1, render: (r) => num(r.moved) }, { label: "Can be moved now", num: 1, render: (r) => h("strong", null, num(r.available)) }], rows),
      canW ? h("div", { class: "row" },
        h("button", { id: "res-verify", onclick: () => Form("Verify a year's group profit", [{ name: "year", label: "Financial year", type: "select", options: yearOpts }, { name: "amount", label: "Group profit earned (UGX)", type: "number" }, { name: "evidence", label: "Evidence (document, minute or statement reference)" }, { name: "reason", label: "Reason" }], act(async (f) => commit("confirmFYProfit", { year: Number(f.year), amount: Number(f.amount), evidence: f.evidence, reason: f.reason }))) }, "Verify a year's profit"),
        h("button", { id: "res-transfer", onclick: () => Form("Move unallocated profit to the reserve", [{ name: "year", label: "Financial year", type: "select", options: yearOpts }, dateF("date", "Date"), { name: "amount", label: "Amount (UGX)", type: "number" }, { name: "evidence", label: "Evidence" }, { name: "reason", label: "Reason" }], act(async (f) => commit("transferToReserve", { year: Number(f.year), date: f.date, amount: Number(f.amount), evidence: f.evidence, reason: f.reason }))) }, "Move profit to reserve"),
        h("button", { id: "res-settle", onclick: () => Form("Settle a completed year into the reserve (gain moves in, loss is reflected)", [{ name: "year", label: "Financial year", type: "select", options: yearOpts.filter((o) => (FYM.byYear(st.db, o.value) || {}).status === "Closed") }, { name: "evidence", label: "Evidence (statement or minute reference)" }, { name: "reason", label: "Reason" }], act(async (f) => commit("settleFinancialYear", { year: Number(f.year), evidence: f.evidence, reason: f.reason }))) }, "Settle a year"),
        h("button", { id: "res-open", onclick: () => Form("Record the reserve opening balance", [dateF("date", "Date"), { name: "amount", label: "Amount (UGX)", type: "number" }, { name: "evidence", label: "Evidence" }, { name: "reason", label: "Reason" }], act(async (f) => commit("openReserve", { date: f.date, amount: Number(f.amount), evidence: f.evidence, reason: f.reason }))) }, "Record opening balance"),
        h("button", { id: "res-use", onclick: () => Form("Use money from the reserve", [dateF("date", "Date"), { name: "amount", label: "Amount (UGX)", type: "number" }, { name: "purpose", label: "Purpose" }, { name: "evidence", label: "Evidence" }, { name: "reason", label: "Reason" }], act(async (f) => commit("utilizeReserve", { date: f.date, amount: Number(f.amount), purpose: f.purpose, evidence: f.evidence, reason: f.reason }))) }, "Use reserve")) : null,
      h("h2", { class: "sec" }, "Historical loans (before 21 Dec 2025): receivables, offsets and write-offs"),
      null,
      Table([{ label: "Member", render: (x) => (st.db.members.find((m) => m.id === x.loan.memberId) || {}).name || x.loan.memberId }, { label: "Loan paid out", num: 1, render: (x) => num(x.disbursed) }, { label: "Principal unpaid", num: 1, render: (x) => num(x.principalOutstanding) }, { label: "Interest unpaid", num: 1, render: (x) => num(x.interestOutstanding) }, { label: "Written off", num: 1, render: (x) => num(x.writtenOffPrincipal + x.writtenOffInterest) }, { label: "Status", render: (x) => badge(x.status, x.status === "Open" ? "bad" : "ok") }], (st.db.historicalLoans || []).filter((l) => !l.voided).map((l) => HLN.position(st.db, l.id))),
      canW && (st.db.historicalLoans || []).length ? h("div", { class: "row" },
        h("button", { id: "res-offset", onclick: () => Form("Offset a member's savings against a historical loan", [{ name: "loanId", label: "Historical loan", type: "select", options: histOpts }, dateF("date", "Date"), { name: "amount", label: "Amount (UGX)", type: "number" }, { name: "evidence", label: "Evidence (member's written consent, minute)" }, { name: "reason", label: "Reason" }], act(async (f) => commit("offsetHistoricalLoan", { loanId: f.loanId, date: f.date, amount: Number(f.amount), evidence: f.evidence, reason: f.reason }))) }, "Offset savings against a loan"),
        h("button", { id: "res-writeoff", onclick: () => Form("Write off an uncollectible historical loan balance (needs Chairperson approval)", [{ name: "loanId", label: "Historical loan", type: "select", options: histOpts }, { name: "lossYear", label: "Closed financial year that bears the loss", type: "select", options: yearOpts.filter((o) => (FYM.byYear(st.db, o.value) || {}).status === "Closed") }, { name: "principal", label: "Loan principal written off (UGX)", type: "number" }, { name: "interest", label: "Interest written off (UGX)", type: "number" }, { name: "evidence", label: "Evidence (why it cannot be collected)" }, { name: "reason", label: "Reason" }], act(async (f) => commit("writeOffHistoricalLoan", { loanId: f.loanId, lossYear: Number(f.lossYear), principal: Number(f.principal) || 0, interest: Number(f.interest) || 0, evidence: f.evidence, reason: f.reason }))) }, "Write off a loan balance")) : null,
      h("h2", { class: "sec" }, "Reserve by financial year"),
      Table([{ label: "Year", key: "label" }, { label: "Opening", num: 1, render: (r) => num(r.opening) }, { label: "Opening recorded", num: 1, render: (r) => num(r.openingBalanceIntroduced) }, { label: "Verified profit in", num: 1, render: (r) => num(r.transfers) }, { label: "Verified loss", num: 1, render: (r) => num(r.losses) }, { label: "Used", num: 1, render: (r) => num(r.utilization) }, { label: "Closing", num: 1, render: (r) => h("strong", null, num(r.closing)) }], stmt.rows),
      h("h2", { class: "sec" }, "Every movement"),
      Table([{ label: "Date", render: (e) => D.toDisplay(e.date) }, { label: "Movement", key: "kind" }, { label: "Amount", num: 1, render: (e) => num(e.amount) }, { label: "Approved by", render: (e) => e.authorisedBy || "" }, { label: "Evidence", key: "evidence" }, { label: "Reason", key: "reason" }], stmt.entries));
  }
  const VIEWS = { menu: menuScreen, fyears: fyearsView, reminders: remindersView, reserve: reserveView, profit, approvals, airtime, messages, system, dash: dashboard, members, loans, ledger, subs, shareout, reports, recon, audit, home: MV.home, savings: MV.savings, myloans: MV.loans, myguar: MV.guarantees, more: MV.more, mysubs: MV.subs, myshare: MV.share };

  /* ---------- boot ---------- */
  const paintConn = (r) => { const cs = document.getElementById("conn-status"); if (!cs || !r) return; cs.className = "hint"; if (!r.ok) cs.textContent = "Not connected to the SOB records."; else if (CFG.build && r.build && r.build !== CFG.build) { cs.textContent = "Connected, but the Google script is an older version (" + r.build + "; this app expects " + CFG.build + "). Redeploy the latest Code_Ledger.gs as a New version of the SAME deployment."; cs.className = "hint warn"; } else cs.textContent = "✓ Connected to the SOB records" + (r.build ? " (app " + String(CFG.build || "").slice(0, 6) + " · server " + String(r.build).slice(0, 6) + ")" : "") + "."; };
  const connBanner = (host, err) => { host.replaceChildren(Banner("bad", "SOB could not reach its records. This is not a problem with your ID or password."), h("div", { class: "hint", id: "login-problem-detail" }, friendly(err)), h("div", { class: "hint" }, "Please tell " + R.OFFICERS.filter((o) => ["Treasurer", "Secretary"].includes(o[1])).map((o) => o[0] + " (" + o[2] + ")").join(" or ") + ".")); };
  async function boot() {
    if (CFG.notConfigured || (!CFG.ledgerUrl && !CFG.demo)) { app.append(State("error", "SOB is not switched on yet. Please contact " + R.OFFICERS.filter((o) => ["Treasurer", "Secretary"].includes(o[1])).map((o) => o[0] + " on " + o[2]).join(" or ") + ".")); return; }
    app.append(splash());
    try {
      if (st.live) {
        st.store = S.client.create({ url: CFG.ledgerUrl, fetch: window.fetch.bind(window), session: window.sessionStorage });
        st.store.onChange((e) => { Busy.set(e.busy ? e.busyLabel : null); if (e.status === "synced") st.lastLoad = Date.now(); if (e.status === "signed-out" && st.user) { st.user = null; st.view = null; render(); toast("Your session ended. Please sign in again.", "warn"); } });
        st.db = { members: [], transactions: [], loans: [] };
        st.store.check().then((r) => { st.conn = r; const host = document.getElementById("login-problem"); if (host && !r.ok && !host.children.length) connBanner(host, r.error); paintConn(r); });   // tell people BEFORE they type if the endpoint is unreachable/misconfigured
        if (await st.store.resume()) { st.user = st.store.user; if (!st.user.mustChangePin) { await st.store.load(); st.db = st.store.db; } }
      }
      else { const raw = await (await fetch("demo-seed.json")).json(); st.db = S.migrate.migrateLegacy(raw, today()); }
      window.__SOB = st; render();
    } catch (e) { app.replaceChildren(State("error", "We could not load SOB. " + friendly(e), () => { app.replaceChildren(State("loading")); boot(); })); }
  }
  /* a phone left unlocked must not stay signed in: 20 minutes without a touch signs out (the server session also expires) */
  let idleT = null; const IDLE_MS = 20 * 60 * 1000;
  const touch = () => { clearTimeout(idleT); if (!st.user) return; idleT = setTimeout(async () => { if (!st.user) return; try { if (st.live) await st.store.logout(); } catch (e) { /* ignore */ } st.user = null; st.view = null; render(); toast("You were signed out after 20 minutes of inactivity.", "warn"); }, window.SOB_IDLE_MS || IDLE_MS); };
  ["click", "keydown", "touchstart", "scroll"].forEach((ev) => document.addEventListener(ev, touch, { passive: true })); window.__SOB_IDLE = { touch, ms: IDLE_MS };
  /* connection awareness: say so plainly instead of letting buttons look dead */
  const offline = () => { if (!document.getElementById("offline")) document.body.append(h("div", { id: "offline", role: "alert" }, "You are offline. Changes cannot be saved until the connection returns.")); };
  window.addEventListener("offline", offline); window.addEventListener("online", () => { const o = document.getElementById("offline"); if (o) o.remove(); toast("Back online"); });
  if (navigator.onLine === false) offline();
  boot();
})();
