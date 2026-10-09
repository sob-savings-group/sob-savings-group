(function () {
  const { h, ugx, num, badge, Card, Table, State, Modal, Form, toast, friendly, Busy, Icon, Banner, Empty, Confirm, Chips } = window.SOBUI;
  const S = window.SOB, CFG = window.SOB_CONFIG || {}, D = S.dates, L = S.ledger, G = S.gov, LN = S.loans, N = S.notify, AT = S.airtime, C = S.cycle, K = S.kpis, R = S.reports, FYM = S.fy, RSV = S.reserve, PRC = S.profitrec, HLN = S.histloans, FRP = S.finreports;
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
  const act = (fn, okMsg) => async (...a) => { try { st.sentForApproval = false; await fn(...a); if (st.sentForApproval) toast("Sent to the Chairperson — nothing changes until a different person approves it (see Approvals)"); else if (okMsg) toast(okMsg); } catch (e) { toast(friendly(e), true); throw e; } };

  /* ---------- login ---------- */
  function loginScreen() {
    const box = h("div", { class: "card", style: "max-width:420px;margin:40px auto" }, h("h2", { class: "sec", style: "margin-top:0" }, "Sons of Bethel Savings Group"),
      h("div", { class: "mute" }, st.live ? "Sign in" : "DEV preview — demo data, nothing is saved or sent anywhere."));
    if (!st.live) {
      const role = h("select", { id: "demo-role" }, ["Admin", "Chairperson", "Treasurer", "Committee", "Member"].map((r) => h("option", { value: r }, roleLabel(r))));
      const mem = h("select", { id: "demo-member" }, st.db.members.map((m) => h("option", { value: m.id }, m.id + " — " + m.name)));
      box.append(h("label", null, "Role"), role, h("label", null, "Member (for Member role)"), mem,
        h("div", { class: "row" }, h("button", { class: "primary", id: "demo-go", onclick: () => { const r = role.value; const m = st.db.members.find((x) => x.id === mem.value);
          st.user = r === "Member" ? { id: m.id, name: m.name, role: "Member", memberId: m.id } : { id: "demo-" + r, name: "Demo " + r, role: r }; st.view = null; render(); } }, "Enter")));
    } else {
      /* ONE sign-in for everybody. The server identifies the role; render() then shows only what that role may use. */
      const mid = h("input", { id: "mid", placeholder: "e.g. SOB-015", autocapitalize: "characters", autocomplete: "username", autocorrect: "off", spellcheck: "false", enterkeyhint: "next" });
      const pin = h("input", { type: "password", id: "pin", inputmode: "text", autocomplete: "current-password", enterkeyhint: "go" });
      let working = false; const problem = h("div", { id: "login-problem" }); if (st.conn && !st.conn.ok) connBanner(problem, st.conn.error);
      const go = async () => {
        if (working) return; working = true; problem.replaceChildren();
        try {
          /* "SOB-015 Aaron" = ID + name; "SOB-015" + PIN = full access; a full registered name alone is also accepted */
          const typed = mid.value.trim(), m = /^(\S+)[\s,;:]+(.+)$/.exec(typed);
          let id = typed, secret = pin.value.trim();
          if (m && /\d/.test(m[1])) { id = m[1]; if (!secret) secret = m[2].trim(); } else if (!secret) secret = typed;
          if (!typed) throw Object.assign(new Error("Enter your SOB ID"), { code: "FORMAT" });
          const u = await st.store.login(id, secret);
          st.user = u; st.view = null;
          if (!u.mustChangePin) { await st.store.load(); st.db = st.store.db; }
          render();
        } catch (e) {
          const conn = /^(ENDPOINT_|NETWORK|TIMEOUT|SERVER_ERROR|SIGNIN_CONTRACT)/.test(e.code || "");
          problem.replaceChildren();
          if (conn) connBanner(problem, e);   /* a connection/deployment problem is never hidden in a disappearing toast: it stays on screen with the exact cause and who to call */
          else toast(e.code === "BAD_CREDENTIALS" ? "We could not match that. Check your SOB ID, and your PIN or name." : e.code === "LOCKED" ? "Too many attempts. Try again in 15 minutes." : friendly(e), true);
        }
        finally { working = false; }
      };
      [mid, pin].forEach((i) => i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(); }));
      const help = R.OFFICERS.filter((o) => ["Treasurer", "Secretary"].includes(o[1]));
      box.className = "card login"; box.removeAttribute("style");
      box.replaceChildren(h("img", { class: "logo", src: R.LOGO, alt: "BWOMI logo" }), h("div", { class: "eyebrow" }, "SONS OF BETHEL"), h("h1", { class: "hero" }, "Savings Group"), h("div", { class: "tag" }, "Every shilling accounted for."),
        h("label", { for: "mid" }, "SOB ID / Name"), mid, h("div", { class: "hint" }, "Enter your SOB ID or registered name."),
        h("label", { for: "pin" }, "PIN"), pin, h("div", { class: "hint" }, "Enter your PIN where required."),
        h("button", { class: "primary big", id: "login-go", onclick: go }, "Sign In"), problem,
        h("div", { class: "help" }, h("div", { class: "help-t" }, "Need help?"), help.map((o) => h("a", { href: "tel:" + o[2].replace(/\s/g, "") }, o[0] + " — " + o[2]))));
    }
    return box;
  }

  /* A PIN printed on a slip (or set by an Admin) is known to someone else: its owner must replace it before anything else is possible (enforced by the server too). */
  function forcePinScreen() {
    const o = h("input", { type: "password", id: "fp-old", autocomplete: "current-password" }), n = h("input", { type: "password", id: "fp-new", autocomplete: "new-password" }), c = h("input", { type: "password", id: "fp-new2", autocomplete: "new-password" });
    return h("div", { class: "card login", id: "force-pin" }, h("img", { class: "logo", src: R.LOGO, alt: "" }), h("h1", { class: "hero", style: "font-size:28px" }, "Choose your own PIN"),
      h("p", { class: "tag" }, "Your first PIN was given to you on paper. Please choose a private PIN now: at least 4 characters for members, 6 for staff."),
      h("label", null, "Current PIN (from your slip)"), o, h("label", null, "New PIN"), n, h("label", null, "Repeat new PIN"), c,
      h("div", { class: "row" }, h("button", { class: "primary", id: "fp-go", onclick: async () => {
        if (n.value !== c.value) return toast("The two new PINs do not match", true);
        try { await st.store.setPin(n.value, o.value); st.user.mustChangePin = false; await st.store.load(); st.db = st.store.db; st.view = null; toast("PIN changed"); render(); } catch (e) { toast(friendly(e), true); }
      } }, "Save PIN"), h("button", { onclick: async () => { await st.store.logout(); st.user = null; render(); } }, "Sign out")));
  }

  /* ---------- navigation ---------- */
  /* [key, label, onlyRole, icon, class]  — classes: sec = desktop sidebar only (phones reach it through More), mob = phones only */
  const NAV_STAFF = [["dash", "Dashboard", null, "chart"], ["members", "Members", null, "users"], ["loans", "Loans", null, "loan"], ["ledger", "Ledger", null, "book"], ["subs", "Subscriptions", null, "receipt"], ["airtime", "Airtime", null, "phone"], ["shareout", "Share-Out", null, "gift"], ["profit", "Profit", null, "chart"], ["reserve", "General Reserve", null, "shield"], ["approvals", "Approvals", null, "check"], ["reports", "Reports", null, "download"], ["recon", "Reconciliation", null, "shield"], ["audit", "Audit", null, "clock"], ["messages", "Messages", "Admin", "bell"], ["system", "System", "Admin", "sliders"]];
  const NAV_MEMBER = [["home", "Home", null, "home"], ["savings", "Savings", null, "wallet"], ["myloans", "Loans", null, "loan"], ["myguar", "Guarantees", null, "shield"], ["more", "More", null, "more", "only-mobile"], ["mysubs", "Subscription", null, "receipt", "sec"], ["myshare", "Share-out", null, "gift", "sec"], ["airtime", "Airtime", null, "phone", "sec"]];
  const pendingAirtime = () => (st.db.airtimeRequests || []).filter((r) => r.status === "Pending").length;
  async function refresh(quiet) {
    if (!st.live || !st.user || st.user.mustChangePin || st.refreshing) return; st.refreshing = true;
    try { await st.store.load(); st.db = st.store.db; st.lastLoad = Date.now(); if (!document.querySelector(".modal-bg")) render(); if (!quiet) toast("Up to date"); } catch (e) { if (!quiet) toast(friendly(e), true); } finally { st.refreshing = false; }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && st.live && st.user && Date.now() - (st.lastLoad || 0) > 60000) refresh(true); });
  const go = (v) => { document.querySelectorAll(".modal-bg").forEach((m) => m.remove()); st.view = v; st.memberView = null; render(); window.scrollTo(0, 0); };
  const MORE_VIEWS = ["more", "mysubs", "myshare", "airtime"];
  function navBadge(k) {
    if (isStaff()) return k === "airtime" ? pendingAirtime() : k === "approvals" ? K.awaiting(st.db) : 0;
    return k === "myguar" ? (st.db.guarantees || []).filter((g) => g.guarantorId === st.user.memberId && g.status === "Requested").length : 0;
  }
  function render() {
    app.replaceChildren();
    if (!st.user) { app.append(loginScreen()); return; }
    if (st.live && st.user.mustChangePin) { app.append(forcePinScreen()); return; }
    const staff = isStaff(), nav = (staff ? NAV_STAFF : NAV_MEMBER).filter((n) => !n[2] || n[2] === st.user.role); st.view = st.view || nav[0][0];
    const active = (k) => st.view === k || (!staff && k === "more" && MORE_VIEWS.includes(st.view));
    const shell = h("div", { class: "shell" });
    shell.append(h("header", { class: "top" }, h("div", { class: "brand" }, h("img", { src: R.LOGO, alt: "BWOMI" }), h("div", { style: "min-width:0" }, h("div", { class: "bt1" }, staff ? "SOB " + roleLabel(st.user.role) : "Sons of Bethel"), h("div", { class: "bt2" }, st.user.name + (st.live ? "" : " · DEMO")))),
      staff && !st.live ? h("span", { class: "pill" }, "DEMO · DEV") : null,
      st.live && !st.user.readOnly ? h("button", { class: "iconbtn", id: "my-pin", "aria-label": "Change my PIN", title: "Change my PIN", onclick: () => Form("Change my PIN", [{ name: "o", label: "Current PIN", type: "password" }, { name: "n", label: "New PIN (members 4+, staff 6+ characters)", type: "password" }], act(async (f) => { await st.store.setPin(f.n, f.o); }, "PIN changed"), "Save PIN") }, Icon("key")) : null,
      st.live ? h("button", { class: "iconbtn", id: "refresh", "aria-label": "Refresh", title: "Refresh", onclick: () => refresh(false) }, Icon("refresh")) : null,
      h("button", { class: "iconbtn", id: "logout", "aria-label": "Sign out", title: "Sign out", onclick: async () => { if (st.live) await st.store.logout(); st.user = null; st.view = null; render(); } }, Icon("logout"))));
    shell.append(h("nav", { class: "nav" + (staff ? " many" : ""), "aria-label": "Main" }, nav.map(([k, l, , ic, cls]) => { const n = navBadge(k);
      return h("button", { class: (active(k) ? "active " : "") + (cls || ""), "data-nav": k, "aria-current": active(k) ? "page" : null, onclick: () => go(k) }, Icon(ic, 22), h("span", null, l), n ? h("span", { class: "badge-n" }, String(n)) : null); })));
    const main = h("main", { id: "main" }); shell.append(main); app.append(shell);
    try { main.append(VIEWS[st.view]()); } catch (e) { console.error(e); main.append(State("error", "We could not show this screen. " + friendly(e), () => render())); }
  }

  /* ---------- drill-down helpers ---------- */
  const loanRows = (filter) => K.loanBook(st.db, today()).filter(filter || (() => true));
  const loanCols = [{ label: "Loan", key: "id" }, { label: "Member", render: (v) => nameOf(st.db.loans.find((l) => l.id === v.id).memberId) }, { label: "Principal", num: 1, render: (v) => num(v.principal) }, { label: "Interest", num: 1, render: (v) => num(v.accumulatedInterest) }, { label: "Repaid", num: 1, render: (v) => num(v.repaid) }, { label: "Balance", num: 1, render: (v) => num(v.balance) }, { label: "Status", render: (v) => badge(v.status, v.balance > 0 ? "warn" : "ok") }];
  function drill(title, definition, body) { Modal(title, h("div", null, definition ? h("p", { class: "mute" }, "How this is calculated: " + definition) : null, body)); }

  /* ---------- Admin: dashboard ---------- */
  /* What needs a human today — the first thing staff see. */
  function attention(aw, p) {
    const items = [], open = (st.db.discrepancies || []).filter((d) => d.status === "Open").length, role = st.user.role;
    if (st.live && CFG.build && st.store.serverBuild !== CFG.build && role === "Admin") items.push(["warn", "The Google backend is " + (st.store.serverBuild ? "a different version (" + st.store.serverBuild + ")" : "an older version") + " than this app (" + CFG.build + "). In Apps Script paste the latest Code.gs, run authorizeSOB, then Deploy > Manage deployments > Edit > New version.", "system", "Open"]);
    if (aw) items.push(["warn", aw + (aw === 1 ? " item is" : " items are") + " waiting for the Chairperson's approval" + (role === "Chairperson" ? " — your decision is needed." : "."), "approvals", "Open"]);
    if (p.Pending) items.push(["info", p.Pending + (p.Pending === 1 ? " loan application needs" : " loan applications need") + " review.", "loans", "Open"]);
    if (pendingAirtime() && (role === "Admin")) items.push(["info", pendingAirtime() + " airtime " + (pendingAirtime() === 1 ? "request is" : "requests are") + " waiting.", "airtime", "Open"]);
    if (open) items.push(["warn", open + " reconciliation " + (open === 1 ? "difference is" : "differences are") + " still open.", "recon", "Open"]);
    return h("div", { id: "attention" }, items.length ? items.map(([kind, text, view, label]) => Banner(kind, text, { label, onclick: () => go(view) })) : Banner("ok", "Nothing needs attention right now."));
  }
  /* ---- the reporting period: ONE selector for the whole dashboard and the Reports page. Balances are read as at its last day; activity covers first to last day. ---- */
  const periodNow = () => { if (!st.period) { try { const v = JSON.parse(sessionStorage.getItem("sob.period") || "null"); if (v && v.key) st.period = v.key === "custom" ? D.customPeriod(v.from, v.to, today()) : D.presetPeriod(v.key, today()); } catch (e) { /* fall through to the default */ } } if (!st.period || st.period.to > today()) st.period = D.presetPeriod("year", today()); else if (st.period.key !== "custom") st.period = D.presetPeriod(st.period.key, today()); return st.period; };
  const setPeriod = (p) => { st.period = p; st.customOpen = false; try { sessionStorage.setItem("sob.period", JSON.stringify({ key: p.key, from: p.from, to: p.to })); } catch (e) { /* optional */ } render(); };
  function periodBar() {
    const p = periodNow(), custom = p.key === "custom" || st.customOpen;
    const from = h("input", { type: "date", id: "p-from", value: p.from || "", max: today(), "aria-label": "From date" }), to = h("input", { type: "date", id: "p-to", value: p.to, max: today(), "aria-label": "To date" });
    return h("section", { class: "periodbar", id: "periodbar" }, h("div", { class: "pb-t" }, "Reporting period"),
      Chips(D.PERIOD_PRESETS, custom ? "custom" : p.key, (k) => { if (k === "custom") { st.customOpen = true; render(); } else setPeriod(D.presetPeriod(k, today())); }),
      custom ? h("div", { class: "pb-custom" }, h("label", null, "From", from), h("label", null, "To", to), h("button", { class: "primary", id: "p-apply", onclick: () => { try { setPeriod(D.customPeriod(from.value, to.value, today())); } catch (e) { toast(e.message, true); } } }, "Show")) : null,
      h("div", { class: "pb-note", id: "period-note" }, h("span", null, "Balances are as at ", h("b", null, D.longDate(p.to))), h("span", null, " · Activity covers ", h("b", null, p.from ? D.longDate(p.from) + " – " + D.longDate(p.to) : "start of records – " + D.longDate(p.to)))));
  }
  const kpiShow = (d) => d.unit === "%" ? (d.value == null ? "—" : d.value + "%") : d.unit === "count" ? String(d.value) : ugx(d.value);
  const download = (name, type, data) => { const a = h("a", { href: URL.createObjectURL(new Blob([data], { type })), download: name }); document.body.append(a); a.click(); a.remove(); };
  const heading = (c) => String(c).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (x) => x.toUpperCase());
  /* a report on screen: friendly headings, numbers right-aligned with thousands separators, rows open the record behind them */
  const tableFromReport = (rep, onRow) => {
    const numCol = (c) => rep.rows.length > 0 && rep.rows.every((r) => r[c] === "" || r[c] == null || typeof r[c] === "number");
    return Table(rep.columns.map((c) => ({ label: (rep.labels && rep.labels[c]) || heading(c), num: numCol(c) ? 1 : 0, render: (r) => (typeof r[c] === "number" ? num(r[c]) : r[c] == null ? "" : String(r[c])) })), rep.rows, onRow, "Nothing recorded for this period");
  };
  function openRow(o, asAt) { if (!o || !o.id) return; if (o.kind === "member") openMember(o.id, asAt); else if (o.kind === "loan") openLoan(o.id, asAt); else if (o.kind === "entry") openEntry(o.id); }
  /* KPI -> drill-down -> entries -> PDF: the table, the totals and the PDF are all the same K.report() for the chosen period. */
  function openKpi(key) {
    const p = periodNow(), rep = K.report(st.db, key, p, { open: true }), k = rep.kpi, shown = k.unit === "UGX" ? ugx(k.value) : k.unit === "%" ? (k.value == null ? "—" : k.value + "%") : String(k.value);
    const tie = k.tied ? h("p", { class: "ok", "data-tie": "ok" }, "✓ The entries below add up to the figure on the dashboard: " + shown) : h("div", { class: "blocked", "data-tie": "bad" }, "The entries below do not add up to the dashboard figure. Please tell the Super Admin before relying on it.");
    Modal(rep.title, h("div", null, h("p", { class: "mute" }, rep.definition),
      rep.summary.length ? h("div", { class: "grid two" }, rep.summary.map(([l, v]) => Card(l, typeof v === "number" ? (/%/.test(l) ? v + "%" : ugx(v)) : String(v)))) : null,
      h("div", { class: "row" }, printButton(rep, rep.period), h("button", { "data-csv": 1, onclick: () => download(key + ".csv", "text/csv", R.toCSV(rep)) }, "Download CSV")),
      tableFromReport(rep, (r) => openRow(r._open, p.to)), tie));
  }
  const PIPE = { Pending: "Loans to review", AwaitingApproval: "Loans awaiting Chairperson", Approved: "Approved, not yet paid out", Active: "Active loans", Cleared: "Fully repaid loans", Declined: "Declined loans" };
  function dashboard() {
    const p = periodNow(), o = K.overview(st.db, p), pipe = K.pipeline(st.db);
    const c = (key, label, tone, sub) => Card(label, kpiShow(o[key]), sub || o[key].period, () => openKpi(key), tone);
    const wrap = h("div", null, periodBar(),
      h("h2", { class: "sec" }, "Where the group stands · as at " + D.longDate(p.to)),
      h("div", { class: "grid", id: "kpis" },
        c("totalSavings", "Total Savings", "avail", "Members' savings"), c("availableCash", "Available Cash", null, "Opening " + num(o.availableCash.opening) + " → closing"),
        c("outstandingLoans", "Outstanding Loans", "loan", o.outstandingLoans.count + " loans owed"), c("interestReceivable", "Interest Receivable", "interest", o.interestReceivable.loans + " loans · unpaid interest"),
        c("loanExposure", "Loan Exposure", null, "Guaranteed " + ugx(o.loanExposure.guaranteed)), c("members", "Members", null, "Active")),
      h("h2", { class: "sec" }, "What happened · " + (p.from ? D.longDate(p.from) + " – " + D.longDate(p.to) : "start of records – " + D.longDate(p.to))),
      h("div", { class: "grid", id: "activity" },
        c("savingsReceived", "Savings Received", "avail", o.savingsReceived.count + " deposits"), c("withdrawals", "Withdrawals & Share-Out", null, o.withdrawals.count + " payments"), c("loansDisbursed", "Loans Paid Out", "loan", o.loansDisbursed.count + " loans"),
        c("repaymentsReceived", "Loan Repayments", "loan", o.repaymentsReceived.count + " payments"), c("interestReceived", "Interest Received", "interest", "Interest part of repayments"), c("subscriptions", "Subscriptions", null, o.subscriptions.count + " received"),
        c("otherIncome", "Other Income", null, o.otherIncome.count + " entries"), c("profit", "Profit Recorded", "profit", "Profit entries in the period"), c("expenses", "Expenses", null, o.expenses.count + " entries")),
      h("h2", { class: "sec" }, "Needs attention · right now"), attention(o.awaitingApproval, pipe),
      h("div", { class: "grid", id: "pipeline" }, Card("Awaiting approval", String(o.awaitingApproval), "Chairperson second approval", () => { st.view = "approvals"; render(); }), Object.keys(pipe).map((s) => Card(PIPE[s] || s, String(pipe[s]), "Loans · right now", () => drill((PIPE[s] || s) + " — loans", null, Table(loanCols, loanRows((v) => v.status === s), (v) => openLoan(v.id)))))),
      h("h2", { class: "sec" }, "Subscription compliance " + p.to.slice(0, 4)));
    const cm = C.subscriptionCompliance(asAtDb(p.to), p.to.slice(0, 4));
    wrap.append(h("div", { class: "grid" }, Card("Collected", ugx(cm.collected), "of " + ugx(cm.expected) + " · as at " + D.longDate(p.to), () => { st.view = "subs"; render(); }), Card("Unpaid members", String(cm.unpaid.length), "as at " + D.longDate(p.to), () => drill("Unpaid subscriptions", null, Table([{ label: "Member", render: (id) => nameOf(id) }], cm.unpaid, null)))));
    return wrap;
  }
  /* the ledger as it stood on a past day (entries after it removed) */
  const asAtDb = (asOf) => Object.assign({}, st.db, { transactions: (st.db.transactions || []).filter((t) => t.date <= asOf) });
  /* Every PDF/print goes through here -> R.toPrintHTML -> mandatory SOB header + footer (repeats on every page). Printed from a hidden frame (no pop-up blocking). */
  function printReport(rep, period) {
    return Busy.run("Preparing your PDF…", () => new Promise((res) => {
      const meta = { generated: D.toDisplay(today()), period: period || rep.period || "As at " + D.toDisplay(today()) };
      /* Opens the branded statement in its own tab: desktop prints straight away; on a phone use "Print / Save as PDF" there (then share the PDF on WhatsApp). */
      const w = window.open(URL.createObjectURL(new Blob([R.toPrintHTML(rep, Object.assign({ toolbar: true }, meta))], { type: "text/html" })), "_blank");
      if (w) { setTimeout(res, 300); return; }
      toast("Please allow pop-ups for this page to open the PDF.", "warn");
      const f = document.createElement("iframe"); f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"; document.body.append(f);
      const d = f.contentWindow.document; d.open(); d.write(R.toPrintHTML(rep, meta)); d.close();
      setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast("Could not open the print dialog", true); } setTimeout(() => f.remove(), 60000); res(); }, 400);
    }));
  }
  const printButton = (rep, period) => h("button", { "data-print": 1, onclick: () => printReport(rep, period) }, "Print / PDF");

  /* ---------- members ---------- */
  function openMember(id, asAt0) {
    const m = st.db.members.find((x) => x.id === id); if (!m) return;
    const asAt = asAt0 || today(), hist = asAt < today(), dd = asAtDb(asAt), pos = L.memberPositionAsAt(st.db, id, asAt), stmt = R.memberStatementPrint(st.db, id, { to: asAt });
    const loans = L.activeLoansAsAt(dd, asAt).filter((l) => l.memberId === id), owed = loans.reduce((a, l) => a + Math.max(0, L.loanOutstanding(l, dd, asAt)), 0);
    drill(m.id + " — " + m.name, null, h("div", null, hist ? Banner("info", "Showing this member as at " + D.longDate(asAt) + ". Open them from the Members page for today's position.") : null,
      h("div", { class: "grid" }, Card("Savings" + (hist ? " (as at " + D.longDate(asAt) + ")" : ""), ugx(pos.savings), "From the ledger"), Card("Guarantee committed", ugx(pos.committed)), Card("Available", ugx(pos.available)), Card("Outstanding loan", ugx(owed))),
      st.live && st.user.role === "Admin" && !hist ? h("div", { class: "row" }, (st.db.users || []).some((u) => u.id === m.id)
        ? h("button", { "data-act": "reset-pin", onclick: () => Form("Reset PIN for " + m.name, [{ name: "n", label: "New PIN (4+ characters)", type: "password" }], act(async (f) => { await st.store.setPin(f.n, undefined, m.id); }, "PIN reset")) }, "Reset PIN")
        : h("button", { "data-act": "create-signin", onclick: () => Form("Create sign-in for " + m.name, [{ name: "n", label: "Initial PIN (4+ characters)", type: "password" }], act(async (f) => { await st.store.createUser({ id: m.id, name: m.name, role: "Member", memberId: m.id, pin: f.n }); await st.store.load(); st.db = st.store.db; }, "Sign-in created")) }, "Create sign-in")) : null,
      h("h2", { class: "sec" }, "Loans"), Table(loanCols, K.loanBook(dd, asAt).filter((v) => loans.some((l) => l.id === v.id)), (v) => openLoan(v.id, asAt)),
      h("h2", { class: "sec" }, "Savings statement"), h("div", { class: "row" }, printButton(stmt, stmt.period)), tableFromReport({ columns: stmt.columns, rows: stmt.rows.slice().reverse().slice(0, 100) }, (r) => openEntry(r._open.id)), stmt.rows.length > 100 ? h("p", { class: "mute" }, "Showing the latest 100 of " + stmt.rows.length + " entries — the PDF has all of them.") : null));
  }
  /* live search: only the result area is redrawn, so typing never loses focus */
  const Searchable = (placeholder, build) => { let q = ""; const box = h("div"); const paint = () => box.replaceChildren(build(q.trim().toLowerCase())); const inp = h("input", { type: "search", class: "search", placeholder, "aria-label": placeholder, oninput: (e) => { q = e.target.value; paint(); } }); paint(); return h("div", null, inp, box); };
  function members() {
    return h("div", null, h("div", { class: "row" }, G.can(ctx(), "member.manage") ? h("button", { class: "primary", id: "add-member", onclick: () => Form("Add member", [{ name: "name", label: "Full name" }, { name: "phone", label: "Phone" }], act(async (v) => commit("addMember", { name: v.name, phone: v.phone }), "Member added")) }, "Add member") : null),
      Searchable("Search members by name, ID or phone", (q) => Table([{ label: "ID", key: "id" }, { label: "Name", key: "name" }, { label: "Savings", num: 1, render: (m) => num(L.memberSavings(st.db, m.id)) }], st.db.members.filter((m) => !q || (m.id + " " + m.name + " " + (m.phone || "")).toLowerCase().includes(q)), (m) => openMember(m.id))));
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
  function openLoan(id, asAt0) {
    const loan0 = st.db.loans.find((l) => l.id === id); if (loan0 && asAt0 && asAt0 < today()) return openLoanAsAt(loan0, asAt0);
    const loan = st.db.loans.find((l) => l.id === id), v = LN.loanView(st.db, loan, today()), c = ctx();
    const b = h("div", null,
      h("div", { class: "grid" }, Card("Principal", ugx(v.principal)), Card("Assigned monthly interest", ugx(v.assignedMonthlyInterest), "Set by Admin per loan"), Card("Interest accrued", ugx(v.accumulatedInterest), v.unpaidMonths + " months after grace"), Card("Balance", ugx(v.balance), "Payable " + ugx(v.payable) + " − repaid " + ugx(v.repaid))),
      h("p", null, "Member: ", nameOf(loan.memberId), " · Status: ", badge(loan.status, loan.voided ? "bad" : "mute"), loan.voided ? badge("VOIDED", "bad") : null),
      loan.components && loan.components.length ? h("div", { id: "loan-components" }, h("p", { class: "mute" }, "One loan account, paid out in " + loan.components.length + " parts:"), Table([{ label: "Date", render: (c) => D.toDisplay(c.date) }, { label: "Amount", num: 1, render: (c) => num(c.amount) }, { label: "Source", key: "ref" }], loan.components)) : null,
      loanBacking(loan),
      h("h2", { class: "sec" }, "Guarantors (savings-backed)"), Table([{ label: "Guarantor", render: (g) => nameOf(g.guarantorId) }, { label: "Guaranteed", num: 1, render: (g) => num(g.amount) }, { label: "Released", num: 1, render: (g) => num(g.releasedAmount || 0) }, { label: "Still committed", num: 1, render: (g) => num(g.status === "Active" ? L.guaranteeRemaining(g) : 0) }, { label: "Status", render: (g) => badge(g.status, g.status === "Active" ? "ok" : g.status === "Requested" ? "warn" : "mute") },
        { label: "", render: (g) => g.status === "Requested" && G.can(c, "guarantee.manage") ? h("button", { "data-accept-guarantee": g.id, onclick: (ev) => { ev.stopPropagation(); Form("Record the guarantor's acceptance", [{ name: "evidence", label: "How did they accept? (signed form, call, message) - required" }], act(async (f) => { await commit("acceptGuarantee", { id: g.id, evidence: f.evidence }); document.querySelector(".modal-bg").remove(); openLoan(id); }, "Guarantee accepted and committed")); } }, "Record acceptance") : "" }], (st.db.guarantees || []).filter((g) => g.loanId === id && g.status !== "Declined"), null, "No guarantors on this loan"),
      h("h2", { class: "sec" }, "Other security (exceptional)"), Table([{ label: "Kind", key: "kind" }, { label: "Description", key: "description" }, { label: "Valuation", num: 1, render: (x) => x.valuation == null ? "—" : num(x.valuation) }, { label: "Accepted cover", num: 1, render: (x) => num(x.acceptedCover || 0) }, { label: "Docs", num: 1, render: (x) => (x.documents || []).length }, { label: "Status", render: (x) => badge(x.status, x.status === "Approved" ? "ok" : x.status === "Proposed" ? "warn" : "mute") },
        { label: "", render: (x) => x.status === "Proposed" && G.can(c, "security.approve") ? h("span", { class: "row", style: "margin:0" }, h("button", { class: "primary", "data-approve-security": x.id, onclick: (ev) => { ev.stopPropagation(); Form("Approve exceptional security", [{ name: "reason", label: "Why SOB exceptionally accepts security (required)" }, { name: "cover", label: "Part of the loan this security backs (UGX)", type: "number" }], act(async (f) => { await commit("decideSecurity", { id: x.id, decision: "approve", reason: f.reason, acceptedCover: Number(f.cover) }); document.querySelector(".modal-bg").remove(); openLoan(id); }, "Security approved")); } }, "Approve"),
          h("button", { class: "danger", "data-reject-security": x.id, onclick: (ev) => { ev.stopPropagation(); Form("Reject security", [{ name: "reason", label: "Reason (required)" }], act(async (f) => { await commit("decideSecurity", { id: x.id, decision: "reject", reason: f.reason }); document.querySelector(".modal-bg").remove(); openLoan(id); }, "Rejected")); } }, "Reject")) : "" }], (st.db.securities || []).filter((x) => x.loanId === id), null, "No other security — the loan rests on savings and guarantors"),
      ["Active", "Cleared"].includes(loan.status) && (st.db.guarantees || []).some((g) => g.loanId === id) ? h("div", null, h("h2", { class: "sec" }, "Linked ledger: borrower and guarantors"), (() => { const lr = R.loanStatement(st.db, id, today()); return h("div", null, printButton(lr), tableFromReport(lr)); })()) : null,
      h("h2", { class: "sec" }, "Interest history"), Table([{ label: "Date", key: "date" }, { label: "From", num: 1, render: (x) => x.previousAmount == null ? "—" : num(x.previousAmount) }, { label: "To", num: 1, render: (x) => num(x.newAmount) }, { label: "Reason", key: "reason" }], v.interestHistory),
      h("h2", { class: "sec" }, "Repayments"), Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Amount", num: 1, render: (t) => num(t.amount) }], L.activeTransactions(st.db).filter((t) => t.loanId === id && t.type === "Loan Repayment")));
    const row = h("div", { class: "row" }); const M = () => document.querySelector(".modal-bg");
    const add = (label, cond, fn, cls) => cond && row.append(h("button", { class: cls || "", "data-act": label, onclick: fn }, label));
    const preDisb = ["Pending", "AwaitingApproval", "Approved"].includes(loan.status);
    add("Request guarantee", G.can(c, "guarantee.manage") && preDisb, () => Form("Request a guarantee (more than one guarantor may back a loan)", [{ name: "g", label: "Guarantor", options: st.db.members.filter((m) => m.id !== loan.memberId).map((m) => ({ value: m.id, label: m.name + " — available " + num(L.memberAvailable(st.db, m.id)) })) }, { name: "amt", label: "Amount guaranteed (UGX)", type: "number" }], act(async (f) => { await commit("addGuarantee", { loanId: id, guarantorId: f.g, amount: Number(f.amt) }); M().remove(); openLoan(id); }, "Requested - it binds only when the guarantor accepts")));
    add("Propose other security", G.can(c, "security.manage") && preDisb, () => Form("Propose exceptional security (not the normal route)", [{ name: "kind", label: "Kind", options: S.security.KINDS }, { name: "description", label: "Description (what, where, who owns it)" }, { name: "owner", label: "Owner of the security" }, { name: "valuation", label: "Valuation (UGX)", type: "number" }, dateF("valuationDate", "Valuation date"), { name: "valuedBy", label: "Valued by" }, { name: "doc", label: "Document / evidence title" }, { name: "ref", label: "Document reference" }], act(async (f) => { await commit("proposeSecurity", { loanId: id, kind: f.kind, description: f.description, owner: f.owner, valuation: f.valuation ? Number(f.valuation) : undefined, valuationDate: f.valuationDate, valuedBy: f.valuedBy, documents: [{ name: f.doc, reference: f.ref }] }); M().remove(); openLoan(id); }, "Proposed - the Chairperson must approve it")));
    add("Release guarantors", G.can(c, "guarantee.manage") && preDisb && (st.db.guarantees || []).some((g) => g.loanId === id && ["Active", "Requested"].includes(g.status)), () => Form("Release guarantors (before disbursement only)", [{ name: "reason", label: "Reason (required)" }], act(async (f) => { await commit("releaseGuarantor", { loanId: id, reason: f.reason }); M().remove(); openLoan(id); }, "Guarantors released")));
    add(loan.status === "AwaitingApproval" ? "Approve (second approval)" : "Approve", (G.can(c, "loan.review") && loan.status === "Pending") || (G.can(c, "loan.secondApprove") && loan.status === "AwaitingApproval"), act(async () => { await commit("approveLoan", { loanId: id }); M().remove(); openLoan(id); }, "Done"), "primary");
    add("Decline", (G.can(c, "loan.review") || G.can(c, "loan.secondApprove")) && preDisb, () => Form("Decline loan", [{ name: "reason", label: "Reason" }], act(async (f) => { await commit("declineLoan", { loanId: id, reason: f.reason }); M().remove(); }, "Loan declined")));
    add("Disburse", G.can(c, "loan.disburse") && loan.status === "Approved", () => Form("Disburse loan", [{ name: "rate", label: "Assigned monthly interest (UGX) — required", type: "number" }, { name: "grace", label: "Grace months", type: "number", value: 3 }, dateF("date")], act(async (f) => { await commit("disburseLoan", { loanId: id, assignedMonthlyInterest: f.rate, graceMonths: f.grace, date: f.date }); M().remove(); openLoan(id); }, "Loan disbursed")), "primary");
    add("Record repayment", G.can(c, "loan.repay") && loan.status === "Active", () => Form("Record repayment", [{ name: "amount", label: "Amount (UGX)", type: "number" }, dateF("date", "Payment date (today unless you change it)")], act(async (f) => { await commit("repayLoan", { loanId: id, amount: f.amount, date: f.date }); M().remove(); openLoan(id); }, "Repayment recorded")), "primary");
    add("Change interest", G.can(c, "loan.editInterest") && loan.status === "Active", () => Form("Change assigned interest", [{ name: "amt", label: "New monthly interest (UGX)", type: "number", value: v.assignedMonthlyInterest }, { name: "reason", label: "Reason (required)" }], act(async (f) => { await commit("editAssignedInterest", { loanId: id, amount: f.amt, reason: f.reason }); M().remove(); openLoan(id); }, "Interest updated and audited")));
    add(loan.voided ? "Restore loan" : "Void loan", G.can(c, loan.voided ? "loan.reverse" : "loan.reverse"), () => Form(loan.voided ? "Restore loan" : "Void loan", [{ name: "reason", label: "Reason (required)" }], act(async (f) => { await commit(loan.voided ? "restoreLoan" : "voidLoan", { loanId: id, reason: f.reason }); M().remove(); }, "Done")), "danger");
    b.append(row); Modal("Loan " + id, b);
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
  function loans() {
    return h("div", null, h("div", { class: "row" }, G.can(ctx(), "loan.apply") ? h("button", { class: "primary", id: "new-loan", onclick: () => Form("New loan application", [{ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) }, { name: "amt", label: "Amount (UGX)", type: "number" }], act(async (f) => commit("applyForLoan", { memberId: f.m, amount: f.amt }), "Application recorded")) }, "New application") : null),
      Table(loanCols, K.loanBook(st.db, today()), (v) => openLoan(v.id)), h("p", { class: "mute" }, "A member normally qualifies for up to 3× their savings. A loan beyond that can still proceed when guarantors (their combined available savings) or, exceptionally, approved security back the shortfall. A guaranteed amount leaves the guarantor's available balance when accepted and returns as the borrower repays."));
  }

  /* ---------- ledger ---------- */
  function ledger() {
    const all = st.db.transactions.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    return h("div", null, h("div", { class: "row" }, G.can(ctx(), "ledger.create") ? h("button", { class: "primary", id: "add-entry", onclick: () => Form("New ledger entry", [{ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) }, { name: "type", label: "Type", options: ["Savings", "Withdraw", "Expense", "Income", "Profit", "Bank Charge"] }, { name: "amount", label: "Amount (UGX)", type: "number" }, dateF("date"), { name: "purpose", label: "Purpose" }], act(async (f) => commit("createEntry", { memberId: f.m, type: f.type, amount: f.amount, date: f.date, purpose: f.purpose }), "Entry recorded")) }, "New entry") : null),
      Searchable("Search the ledger by member, type, purpose or amount", (q) => { const hit = all.filter((t) => !q || (nameOf(t.memberId) + " " + t.memberId + " " + t.type + " " + (t.purpose || "") + " " + t.amount + " " + D.toDisplay(t.date)).toLowerCase().includes(q)), rows = hit.slice(0, 200);
      return h("div", null, h("p", { class: "mute", style: "font-size:13px" }, hit.length > rows.length ? "Showing the latest " + rows.length + " of " + hit.length + " — type in the search box to narrow." : hit.length + " entries"), Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Member", render: (t) => nameOf(t.memberId) }, { label: "Type", key: "type" }, { label: "Amount", num: 1, render: (t) => num(t.amount) }, { label: "State", render: (t) => t.voided ? badge("Voided", "bad") : t.approvalStatus === "PendingApproval" ? badge("Awaiting Chairperson", "warn") : t.approvalStatus === "Rejected" ? badge("Rejected", "bad") : badge("Counted", "ok") }], rows, (t) => openEntry(t.id))); }));
  }
  function openEntry(id) {
    const t = st.db.transactions.find((x) => x.id === id), c = ctx(), row = h("div", { class: "row" });
    const perm = t.voided ? "ledger.restore" : "ledger.void";
    if (G.can(c, perm)) row.append(h("button", { class: "danger", "data-act": "void", onclick: () => Form(t.voided ? "Restore entry" : "Void entry", [{ name: "reason", label: "Reason (required)" }], act(async (f) => { await commit(t.voided ? "restoreEntry" : "voidEntry", { id, reason: f.reason }); document.querySelector(".modal-bg").remove(); }, "Done")) }, t.voided ? "Restore" : "Void"));
    if (t.approvalStatus === "PendingApproval" && G.can(c, "ledger.approve")) row.append(h("button", { class: "primary", "data-act": "approve-entry", onclick: act(async () => { await commit("approveEntry", { id, decision: "approve" }); document.querySelector(".modal-bg").remove(); }, "Approved") }, "Approve (second approval)"),
      h("button", { class: "danger", "data-act": "reject-entry", onclick: () => Form("Reject entry", [{ name: "reason", label: "Reason (required)" }], act(async (f) => { await commit("approveEntry", { id, decision: "reject", reason: f.reason }); document.querySelector(".modal-bg").remove(); }, "Rejected")) }, "Reject"));
    const aud = (st.db.auditLog || []).filter((a) => a.entityId === id);
    drill("Entry " + id, null, h("div", null, h("p", null, nameOf(t.memberId), " · ", t.type, " · ", ugx(t.amount), " · ", D.toDisplay(t.date)), t.voided ? h("p", { class: "err" }, "Voided: " + (t.voidReason || "")) : null, row, h("h2", { class: "sec" }, "Audit trail"), Table([{ label: "When", key: "date" }, { label: "Action", key: "action" }, { label: "By", key: "by" }, { label: "Reason", key: "reason" }], aud)));
  }

  /* ---------- subscriptions, share-out, reports, audit ---------- */
  function subs() {
    const y = today().slice(0, 4), c = C.subscriptionCompliance(st.db, y);
    return h("div", null, h("div", { class: "grid" }, Card("Collected", ugx(c.collected), "of " + ugx(c.expected)), Card("Paid", String(c.paid.length)), Card("Unpaid", String(c.unpaid.length))),
      Table([{ label: "Member", render: (m) => m.name }, { label: "Status", render: (m) => c.paid.includes(m.id) ? badge("Paid", "ok") : badge("Unpaid", "bad") }, { label: "", render: (m) => !c.paid.includes(m.id) && G.can(ctx(), "subscription.record") ? h("button", { "data-sub": m.id, onclick: (e) => { e.stopPropagation(); Form("Subscription — " + m.name, [{ name: "year", label: "Subscription year", type: "number", value: y }, dateF("date", "Date paid (today unless you change it)")], act(async (f) => commit("recordSubscription", { memberId: m.id, year: Number(f.year), date: f.date }), "Subscription recorded"), "Record UGX 5,000"); } }, "Record UGX 5,000") : null }], st.db.members.filter((m) => m.status !== "Inactive")));
  }
  function shareout() {
    const cur = FYM.current(st.db), y = cur ? cur.year : Number(today().slice(0, 4)), p = C.previewShareOut(st.db, y, today());
    const done = (st.db.shareOutEvents || []).find((e) => e.year === y);
    return h("div", null, h("div", { class: "blocked" }, "Every member withdraws their savings in December, including members with a loan. Actual Savings − Committed Guarantees = Available Savings: only the Available part is paid out; the committed part stays in the account until the secured principal is repaid. Posting the share-out needs the Chairperson's approval. Members with an outstanding loan are not eligible for profit."),
      h("div", { class: "grid" }, Card("To withdraw now", ugx(p.totals.withdrawable), "After guarantee commitments"), Card("Of which loan-holders", ugx(p.totals.withdrawableByLoanHolders), "Loans stay payable"), Card("Committed, stays in account", ugx(p.totals.committedRetained), p.totals.guaranteesAtRisk + " guarantor(s)"), Card("Profit-eligible members", String(p.totals.eligibleMembers)), Card("Excluded (outstanding loan)", String(p.totals.excludedMembers))),
      Table([{ label: "Member", key: "name" }, { label: "Actual savings", num: 1, render: (r) => num(r.savings) }, { label: "Committed", num: 1, render: (r) => num(r.committed) }, { label: "Available", num: 1, render: (r) => num(r.available) }, { label: "Withdraws", num: 1, render: (r) => num(r.withdraw) }, { label: "Stays", num: 1, render: (r) => num(r.retained) }, { label: "Loan owed", num: 1, render: (r) => num(r.outstandingLoan) }, { label: "Action", key: "savingsAction" }], p.rows, (r) => openMember(r.memberId)),
      done ? h("p", { class: "mute" }, "Share-out for " + y + " executed on " + D.toDisplay(done.date) + ".") : G.can(ctx(), "shareout.execute") ? h("div", { class: "row" }, h("button", { class: "danger", id: "exec-shareout", onclick: act(async () => { if (!confirm("Execute the " + y + " share-out? This closes the year.")) return; await commit("executeShareOut", { year: y }); }, "Share-out executed") }, "Execute share-out " + y)) : null);
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
    return h("div", null, h("p", { class: "mute" }, "Member Profit = (Member Eligible Savings ÷ Total Eligible Savings) × Approved Profit Pool. Members with an outstanding loan at the distribution date are not eligible. The Super Admin enters the pool and date, previews the complete schedule and submits it; only the Chairperson's approval posts it. Every member's figure can be opened; rounding differences stay visible as 'undistributed'."),
      h("h2", { class: "sec" }, "Cycle inputs (pool and measurement date)"), h("p", { class: "mute" }, "Neither is assumed: the Super Admin enters them for each cycle with a reason. Every change is kept in the cycle's history and the audit log, and a posted cycle is locked."),
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
    const showRequest = (r) => { const q = reqOf(r.ref); drill(q.label, null, h("div", null, h("p", null, q.summary), h("p", { class: "mute" }, "Requested by " + q.requestedBy + " on " + D.toDisplay(q.requestedDate) + (q.reason ? " — " + q.reason : "")),
      q.schedule ? h("div", null, h("div", { class: "grid" }, Card("Approved profit pool", ugx(q.schedule.pool)), Card("Measured at", D.toDisplay(q.schedule.date)), Card("Distributed", ugx(q.schedule.distributed)), Card("Undistributed (rounding)", ugx(q.schedule.undistributed))), h("p", { class: "mute" }, q.schedule.basis), profitRows(q.schedule.rows)) : null)); };
    const btn = (r) => !can ? "" : r.kind === "Ledger entry" ? h("button", { class: "primary", "data-approve": r.ref, onclick: (e) => { e.stopPropagation(); act(async () => commit("approveEntry", { id: r.ref, decision: "approve" }), "Approved")(); } }, "Approve")
      : r.kind === "Loan" ? h("button", { class: "primary", "data-approve": r.ref, onclick: (e) => { e.stopPropagation(); act(async () => commit("approveLoan", { loanId: r.ref }), "Loan approved")(); } }, "Approve")
      : reqOf(r.ref) ? h("span", { class: "row" }, h("button", { class: "primary", "data-approve": r.ref, onclick: (e) => { e.stopPropagation(); act(async () => commit("approveRequest", { id: r.ref }), "Approved and posted")(); } }, "Approve"),
        h("button", { class: "danger", "data-reject": r.ref, onclick: (e) => { e.stopPropagation(); Form("Reject request", [{ name: "reason", label: "Reason (required)" }], act(async (f) => commit("rejectRequest", { id: r.ref, reason: f.reason }), "Rejected")); } }, "Reject")) : "";
    return h("div", null, h("p", { class: "mute" }, "The Super Admin enters and requests; the Chairperson is the second approver and a different person must approve. Items below do not count toward any figure until the Chairperson approves them. The Treasurer reviews only. Routine savings deposits and loan repayments need no second approval but are fully audited."),
      h("div", { class: "grid" }, Card("Waiting for the Chairperson", String(ap.totals.waiting))),
      Table([{ label: "Kind", key: "kind" }, { label: "Member", key: "member" }, { label: "Detail", key: "detail" }, { label: "Entered by", key: "enteredBy" }, { label: "", render: btn }], rows, (r) => { if (r.kind === "Ledger entry") openEntry(r.ref); else if (reqOf(r.ref)) showRequest(r); else { const sec = (st.db.securities || []).find((x) => x.id === r.ref); openLoan(r.kind === "Loan" ? r.ref : sec.loanId); } }),
      h("h2", { class: "sec" }, "Recently decided requests"), Table([{ label: "Action", key: "label" }, { label: "Detail", key: "summary" }, { label: "Requested by", key: "requestedBy" }, { label: "Decision", key: "status" }, { label: "Decided by", key: "decidedBy" }, { label: "Date", render: (x) => D.toDisplay(x.decidedDate || x.requestedDate) }], decided),
      h("h2", { class: "sec" }, "SOB rules in force"), Table([{ label: "Rule", key: "k" }, { label: "Now", key: "v" }], [
        { k: "Needs the Chairperson's second approval", v: "New loan approval · exceptional/property security · voiding or reversing a financial transaction · manual financial adjustments and corrections · final profit distribution · December share-out posting" },
        { k: "Does not need it (fully audited)", v: "Savings deposits and normal loan repayments" }, { k: "Extra entry types needing the Chairperson", v: pol.requiredTypes.length ? pol.requiredTypes.join(", ") : "none beyond the list above" },
        { k: "Backing for a loan beyond the 3× guideline", v: "Only the shortfall beyond the borrower's own qualification" }, { k: "Repayments are applied", v: "Accumulated unpaid interest first, the remainder reduces principal; guarantee is released only by principal actually reduced" }]));
  }
  const withPeriod = (rep) => Object.assign(rep, { period: rep.period || periodNow().text || D.describePeriod(periodNow()) });
  const REPORTS = { "Interest Receivable": () => R.interestReceivable(st.db, today()), "Awaiting approval": () => R.approvals(st.db), "Exceptional security": () => R.securities(st.db), "Profit distribution": () => R.quarterlyDistribution(st.db), "Savings by member": () => R.savings(st.db), "Loan book": () => R.loans(st.db, today()), "Loan repayments": () => withPeriod(R.repayments(st.db, { from: periodNow().from, to: periodNow().to })), "Guarantor exposure": () => R.guarantors(st.db), "Subscriptions": () => R.subscriptions(st.db, today().slice(0, 4)), "Income & expenses": () => withPeriod(R.incomeExpenses(st.db, { from: periodNow().from, to: periodNow().to })), "December share-out": () => R.shareOut(st.db, (FYM.current(st.db) || { year: Number(today().slice(0, 4)) }).year, today()), "Financial years": () => FRP.financialYears(st.db), "Financial year (current)": () => FRP.financialYear(st.db, (FYM.current(st.db) || { year: 0 }).year), "Profit reconciliation": () => FRP.profitReconciliation(st.db, today()), "Historical loans": () => FRP.historicalLoans(st.db, today()), "General Reserve Fund": () => FRP.generalReserve(st.db), "Reserve movements": () => FRP.reserveMovements(st.db), "Airtime requests": () => R.airtime(st.db), "Notification log": () => R.notificationLog(st.db), "Reconciliation register": () => R.reconciliationRegister(st.db), "Annual summary": () => R.annualSummary(st.db, FYM.yearOfDate(st.db, periodNow().to) || periodNow().to.slice(0, 4)), "Interest vs principal received": () => R.repaymentAllocation(st.db), "Quarterly distribution": () => R.quarterlyDistribution(st.db, { year: Number(today().slice(0, 4)), quarter: 1 }) };
  const PERIOD_AWARE = ["Loan repayments", "Income & expenses", "Annual summary"];
  function reports() {
    const p = periodNow();
    return h("div", null, periodBar(),
      h("h2", { class: "sec" }, "Dashboard figures · follow the period above"), h("div", { class: "grid", id: "kpi-reports" }, K.KEYS.map((k) => { const d = K.detail(st.db, k, p); return Card(d.title, "Open", d.period, () => openKpi(k)); })),
      h("h2", { class: "sec" }, "Registers, statements and schedules"), h("p", { class: "mute" }, "These show today's position, except " + PERIOD_AWARE.join(", ") + ", which follow the period above."),
      h("div", { class: "grid" }, Object.keys(REPORTS).map((n) => Card(n, "Open", PERIOD_AWARE.includes(n) ? "Follows the period" : "Today", () => {
        const rep = REPORTS[n](); if (rep.blocked) { drill(n, null, h("div", { class: "blocked" }, "Blocked: " + rep.reason)); return; }
        drill(rep.title, null, h("div", null, h("div", { class: "row" }, h("button", { "data-csv": 1, onclick: () => download(n.replace(/\W+/g, "_") + ".csv", "text/csv", R.toCSV(rep)) }, "Download CSV"), printButton(rep, rep.period)), tableFromReport(rep), h("pre", { class: "mute" }, JSON.stringify(rep.totals))));
      }))));
  }
  function recon() {
    const list = (st.db.discrepancies || []).slice().sort((a, b) => (a.status === b.status ? 0 : a.status === "Open" ? -1 : 1)), integ = S.integrity.check(st.db, today()), un = S.integrity.unaccounted(st.db, today());
    return h("div", null, h("div", { class: "grid" }, Card("Open items", String(list.filter((d) => d.status === "Open").length), "Need a decision with evidence"), Card("Resolved", String(list.filter((d) => d.status === "Resolved").length)),
      Card("Data errors not in the register", String(un.length), un.length ? "Click to see" : "All accounted for", () => drill("Unaccounted data errors", "Errors the integrity check finds that no register item covers.", Table([{ label: "Code", key: "code" }, { label: "Detail", key: "detail" }], un))),
      Card("Integrity warnings", String(integ.warnings))),
      h("p", { class: "mute" }, "History is never edited to make figures balance. A difference is closed only by a decision, a reason and evidence; any correction is a new dated, audited entry."),
      Table([{ label: "Kind", key: "kind" }, { label: "Subject", key: "subject" }, { label: "Summary", key: "summary" }, { label: "Status", render: (d) => badge(d.status, d.status === "Open" ? "warn" : "ok") }], list, (d) => openDiscrepancy(d.id)));
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
  function audit() { const all = (st.db.auditLog || []).slice().reverse(); return Searchable("Search the audit trail by action, person, record or reason", (q) => { const hit = all.filter((a) => !q || ((a.entityType || "") + " " + (a.entityId || "") + " " + (a.action || "") + " " + (a.by || "") + " " + (a.reason || "")).toLowerCase().includes(q)); return h("div", null, h("p", { class: "mute", style: "font-size:13px" }, hit.length > 200 ? "Showing the latest 200 of " + hit.length + " — search to narrow." : hit.length + " entries"), Table([{ label: "When", key: "date" }, { label: "Entity", render: (a) => a.entityType + " " + a.entityId }, { label: "Action", key: "action" }, { label: "By", key: "by" }, { label: "Reason", key: "reason" }], hit.slice(0, 200), null, "No audit entries match")); }); }

  /* ---------- member portal ---------- */
  const me = () => st.user.memberId;
  const MV = window.SOBMember({ st, act, commit, render, today, printReport, go });

  /* ---------- airtime (members request; Admin fulfils) ---------- */
  const airtimeCols = (staff) => [{ label: "Date", render: (r) => D.toDisplay(r.date) }].concat(staff ? [{ label: "Member", render: (r) => r.memberName + " (" + r.memberId + ")" }] : [], [{ label: "Phone", key: "phone" }, { label: "Airtime", num: 1, render: (r) => num(r.airtimeAmount) }, { label: "Fee", num: 1, render: (r) => num(r.fee) }, { label: "Total", num: 1, render: (r) => num(r.total) },
    { label: "Status", render: (r) => badge(r.status, r.status === "Pending" ? "warn" : r.status === "Fulfilled" ? "ok" : "bad") }]);
  const elig = (id) => (st.live && !isStaff() ? st.db.airtime : AT.eligibility(st.db, id, today()));
  function airtimeForm(memberId) {
    const e = elig(memberId); if (!e) return toast("Airtime information is not available", true);
    if (e.blockedByLoan) return toast("Airtime is not available while you have an unpaid loan.", true);
    const fields = [{ name: "amount", label: "Airtime amount (UGX) — up to " + num(e.remaining) + " left this month", type: "number" }, { name: "phone", label: "Phone to receive airtime (e.g. 0772123456)", value: ((st.db.members.find((m) => m.id === memberId) || {}).phone) || "" }];
    if (isStaff()) fields.unshift({ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) });
    Form("Request airtime", fields, act(async (f) => commit("requestAirtime", { memberId: f.m || memberId, amount: Number(f.amount), phone: f.phone }), "Request sent (total with UGX " + AT.SMS_FEE + " SMS fee will be deducted from savings when fulfilled)"), "Submit request");
  }
  function airtime() {
    const staff = isStaff(), id = staff ? null : me(), list = (st.db.airtimeRequests || []).filter((r) => staff || r.memberId === id).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const top = [];
    if (!staff) {
      const e = elig(id) || { used: 0, remaining: 0, monthlyCap: AT.MONTHLY_CAP, fee: AT.SMS_FEE, blockedByLoan: false, availableSavings: 0 };
      top.push(h("div", { class: "grid" }, Card("Used this month", ugx(e.used), "of " + ugx(e.monthlyCap)), Card("Remaining", ugx(e.remaining)), Card("SMS fee per request", ugx(e.fee), "Added to each request"), Card("Available savings", ugx(Math.max(0, e.availableSavings)))));
      top.push(e.blockedByLoan ? h("div", { class: "blocked", id: "airtime-blocked" }, "Airtime is not available while you have an unpaid loan. Please clear your loan balance first.") : h("p", { class: "mute" }, "For emergencies. Limit UGX " + num(e.monthlyCap) + " per calendar month. The airtime amount plus the UGX " + e.fee + " fee is deducted from your savings only when the Admin fulfils the request."));
      top.push(h("div", { class: "row" }, h("button", { class: "primary", id: "request-airtime", onclick: () => airtimeForm(id) }, "Request airtime")));
    } else if (G.can(ctx(), "airtime.manage")) top.push(h("div", { class: "row" }, h("button", { id: "request-airtime", onclick: () => airtimeForm(null) }, "Record a request for a member")));
    const cols = airtimeCols(staff).concat([{ label: "", render: (r) => r.status !== "Pending" ? "" : h("span", { class: "row", style: "margin:0" },
      G.can(ctx(), "airtime.manage") ? [h("button", { class: "primary", "data-fulfil": r.id, onclick: (ev) => { ev.stopPropagation(); act(async () => commit("fulfilAirtime", { id: r.id }), "Marked fulfilled — savings debited")(); } }, "Fulfil"),
        h("button", { class: "danger", "data-reject": r.id, onclick: (ev) => { ev.stopPropagation(); Form("Reject airtime request", [{ name: "reason", label: "Reason (required)" }], act(async (f) => commit("rejectAirtime", { id: r.id, reason: f.reason }), "Rejected")); } }, "Reject")] : null,
      !staff ? h("button", { "data-cancel": r.id, onclick: (ev) => { ev.stopPropagation(); act(async () => commit("cancelAirtime", { id: r.id }), "Cancelled")(); } }, "Cancel") : null) }]);
    return h("div", null, top, h("h2", { class: "sec" }, staff ? "Airtime requests" : "My airtime requests"), Table(cols, list));
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
        : h("div", { class: "blocked", id: "dryrun-banner" }, "DRY-RUN MODE: messages are written here and rendered, but NOTHING is sent to any phone. Real SMS/WhatsApp sending stays off until gateway credentials are added in Script Properties and a live test has passed."),
      h("div", { class: "grid" }, ["QUEUED", "DRY_RUN", "SENT", "FAILED", "SKIPPED"].map((k) => Card(k.replace("_", "-"), String(sum[k] || 0)))),
      h("div", { class: "row" }, h("button", { class: "primary", id: "process-outbox", onclick: act(proc) }, "Process outbox"),
        h("button", { id: "send-message", onclick: () => Form("Message a member", [{ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) }, { name: "channel", label: "Channel", options: ["SMS", "WHATSAPP"] }, { name: "text", label: "Message (max 320 characters)", type: "textarea" }], act(async (f) => commit("sendMessage", { memberId: f.m, channel: f.channel, text: f.text }), "Queued in the outbox")) }, "New message")),
      Table([{ label: "Created", render: (m) => D.toDisplay(String(m.createdAt).slice(0, 10)) }, { label: "To", render: (m) => m.to === "ADMIN" ? "Admin phone" : (m.memberId ? nameOf(m.memberId) + " " : "") + m.to }, { label: "Channel", key: "channel" }, { label: "Message", key: "body" },
        { label: "Status", render: (m) => badge(m.status, m.status === "SENT" ? "ok" : m.status === "FAILED" ? "bad" : m.status === "QUEUED" || m.status === "DRY_RUN" ? "warn" : "mute") }, { label: "Note", key: "reason" },
        { label: "", render: (m) => ["SENT", "CANCELLED"].includes(m.status) ? "" : h("button", { "data-cancel-msg": m.id, onclick: () => Form("Cancel message", [{ name: "reason", label: "Reason (required)" }], act(async (f) => commit("cancelMessage", { id: m.id, reason: f.reason }), "Cancelled")) }, "Cancel") }], ob),
      h("p", { class: "mute" }, "Members can switch notifications off from their Home screen; those members are skipped, not messaged."));
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
    const purge = () => { if (!rc.pack) return toast("Choose the SOB records file first.", "warn"); if (!confirm("Remove ALL demo/sample records from the Google Sheet? A backup is taken first. Real SOB records are never removed.")) return;
      act(async () => { const r = await st.store.call({ action: "purgeDemoLedger", confirm: "REMOVE DEMO DATA", demoNames: window.SOB_DEMO_NAMES || [], realNames: LD.realNames(rc.pack) }); rc.purged = r; await refresh(); }, "Demo records removed (backup kept)")(); };
    const file = h("input", { type: "file", id: "records-file", accept: ".json,application/json", onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const p = JSON.parse(await f.text()), bad = LD.validatePack(p); if (bad.length) throw new Error(bad.join(" ")); rc.pack = p; rc.name = f.name; rc.res = null; rc.state = LD.inspect(st.db, p); toast("Records file read"); }
      catch (err) { rc.pack = null; rc.state = null; toast("That file cannot be used: " + friendly(err), "warn"); } render(); } });
    const stateText = { empty: "The Google Sheet is empty: ready to load.", loaded: "SOB records are already in the Sheet. Loading again adds nothing twice.", foreign: "The Sheet holds demo/sample records, not SOB members. Remove them first.", mixed: "The Sheet mixes SOB members with unknown records. Nothing will be changed; ask for help." };
    const rep = rc.pack && rc.state && ["loaded", "mixed"].includes(rc.state.state) ? LD.build(st.db, rc.pack, today()) : null, reps = rep ? LD.asReports(rep) : [];
    const sign = () => {
      const have = new Set((st.db.users || []).map((u) => u.id)), need = st.db.members.filter((m) => m.status !== "Inactive" && !have.has(m.id));
      return h("div", null, h("h2", { class: "sec" }, "Sign-ins"), h("p", { class: "mute" }, need.length + " member(s) have no sign-in yet. Each gets a random one-time PIN and must choose their own at first sign-in. The PIN slips download once; print them, hand them out, then delete the file."),
        h("div", { class: "row" }, h("button", { id: "make-signins", disabled: !need.length, onclick: act(async () => {
          const slips = []; for (const m of need) { const pin = randPin(); await st.store.createUser({ id: m.id, name: m.name, role: "Member", memberId: m.id, pin }); slips.push([m.id, m.name, pin]); }
          download("SOB-PIN-slips-" + today() + ".csv", "text/csv", "id,name,pin\n" + slips.map((x) => [x[0], '"' + x[1].replace(/"/g, '""') + '"', x[2]].join(",")).join("\n")); await refresh();
        }, "Sign-ins created; PIN slips downloaded") }, "Create member sign-ins + download PIN slips"),
        h("button", { id: "make-staff", onclick: () => Form("Staff sign-in", [{ name: "id", label: "Sign-in ID (e.g. CHAIR)" }, { name: "name", label: "Name" }, { name: "role", label: "Role", options: ["Chairperson", "Treasurer", "Committee"] }],
          act(async (f) => { const pin = randPin8(); await st.store.createUser({ id: f.id.trim().toUpperCase(), name: f.name, role: f.role, pin }); download("SOB-staff-PIN-" + f.id.trim().toUpperCase() + ".csv", "text/csv", "id,name,role,pin\n" + [f.id.trim().toUpperCase(), '"' + f.name + '"', f.role, pin].join(",")); await refresh(); }, "Sign-in created; PIN downloaded")) }, "Add staff sign-in")));
    };
    return h("div", { id: "records-panel" }, h("h2", { class: "sec", style: "margin-top:0" }, "Load SOB records"),
      h("p", { class: "mute" }, "Loads the verified SOB records (members, savings, withdrawals, loans, repayments, interest, profits and history) into the Google Sheet. Nothing is invented or changed to force a balance; uncertain rows go to the reconciliation register. Safe to run again: duplicates are skipped."),
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
        h("p", { class: "mute" }, "Actual savings = deposits + profit − withdrawals − share-outs. Loans never reduce savings. Available savings = actual savings less guarantee commitments (guarantors begin 2027). The last column of the member table is a memo only."),
        reps.map((r) => h("div", null, h("h3", null, r.title), h("div", { class: "row" }, printButton(r, "As at " + D.toDisplay(rep.asOf)), h("button", { onclick: () => download(r.title.replace(/\W+/g, "_") + ".csv", "text/csv", R.toCSV(r)) }, "Download CSV")), tableFromReport(r))),
        rep.missing.length ? h("div", null, h("h3", null, "Information genuinely missing"), h("ul", null, rep.missing.map((x) => h("li", null, x)))) : null,
        rep.decisions.length ? h("div", null, h("h3", null, "SOB decisions still needed"), h("ul", null, rep.decisions.map((x) => h("li", null, x)))) : null) : null,
      sign());
  }
  /* ---------- system: backups + sign-ins (Admin, live deployment) ---------- */
  function system() {
    if (!st.live) return h("div", { class: "blocked" }, "Backups and sign-in management are available on the live deployment. This preview uses demo data that is never saved.");
    if (!st.sys) { st.sys = { loading: true, backups: [] }; st.store.call({ action: "listBackups" }).then((r) => { st.sys = { backups: r.backups }; render(); }).catch((e) => { st.sys = { backups: [], error: friendly(e) }; render(); }); }
    const reload = async () => { st.sys = null; render(); };
    const download = async () => {
      const r = await st.store.call({ action: "exportBackup" }), a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(r.backup)], { type: "application/json" })), download: "SOB-backup-" + today() + ".json" }); document.body.append(a); a.click(); a.remove(); toast("Backup downloaded — it contains members' personal data; keep it private");
    };
    return h("div", null, recordsPanel(), h("h2", { class: "sec" }, "Backups"),
      h("p", { class: "mute" }, "A snapshot is taken automatically every night once the daily trigger is installed (see the deployment guide). Snapshots are checksummed. Backups never contain PINs."),
      h("div", { class: "row" }, h("button", { class: "primary", id: "backup-now", onclick: act(async () => { const r = await st.store.call({ action: "backupNow", force: true }); toast("Snapshot " + r.id + " saved"); await reload(); }) }, "Back up now"), h("button", { id: "backup-download", onclick: act(download) }, "Download offline backup")),
      st.sys && st.sys.error ? h("div", { class: "err" }, st.sys.error) : null,
      Table([{ label: "Snapshot", key: "id" }, { label: "When", key: "createdAt" }, { label: "Label", key: "label" }, { label: "Ledger revision", num: 1, key: "revision" }, { label: "", render: (b) => h("button", { "data-verify-backup": b.id, onclick: act(async () => { const r = await st.store.call({ action: "verifyBackup", id: b.id }); toast("Verified: " + r.counts.transactions + " transactions, checksum OK"); }) }, "Verify") }], (st.sys && st.sys.backups) || []),
      h("p", { class: "mute" }, "Restoring is deliberately not available from this screen. It is a recovery step run by the spreadsheet owner (deployment guide, section E)."),
      h("h2", { class: "sec" }, "Sign-ins"),
      Table([{ label: "ID", key: "id" }, { label: "Name", key: "name" }, { label: "Role", key: "role" }, { label: "Status", render: (u) => badge(u.status, u.status === "Active" ? "ok" : "bad") }, { label: "", render: (u) => u.id === st.user.id || u.status === "Disabled" ? "" : h("button", { class: "danger", "data-disable": u.id, onclick: () => { if (confirm("Disable sign-in for " + u.id + "?")) act(async () => { await st.store.disableUser(u.id); await st.store.load(); st.db = st.store.db; render(); }, "Sign-in disabled")(); } }, "Disable") }], st.db.users || []));
  }
  /* ---------- General Reserve Fund: SOB's collective reserve, fed only by verified unallocated profit, every movement evidenced and Chairperson-approved ---------- */
  function reserveView() {
    const stmt = RSV.statement(st.db), yrs = FYM.table(st.db), canW = G.can(ctx(), "reserve.manage");
    const rows = yrs.map((y) => { const a = RSV.available(st.db, y.year), p = PRC.year(st.db, y.year, today()); return { label: y.label, earned: p.earnedRecorded, credited: a.credited, verified: a.verified, moved: a.transferred, available: a.available }; });
    const yearOpts = yrs.map((y) => ({ value: y.year, label: y.label })), histOpts = (st.db.historicalLoans || []).filter((l) => !l.voided).map((l) => ({ value: l.id, label: ((st.db.members.find((m) => m.id === l.memberId) || {}).name || l.memberId) + " · " + D.toDisplay(l.date) + " · owed " + num(HLN.position(st.db, l.id).outstanding) }));
    return h("div", null, h("div", { class: "blocked" }, "The General Reserve Fund belongs to SOB collectively, not to individual members. It receives only group profit that has been verified by the Chairperson and is still unallocated after the approved distributions. Members' savings and profit already approved for members are never moved into it. Every movement needs supporting evidence and the Chairperson's approval, and is kept in the audit trail."),
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
      h("p", { class: "mute" }, "A balance still owed stays a receivable. It is NOT charged to the reserve unless the Chairperson approves a write-off, with evidence, for a closed financial year. A member's savings are used to repay it only by an approved offset."),
      Table([{ label: "Member", render: (x) => (st.db.members.find((m) => m.id === x.loan.memberId) || {}).name || x.loan.memberId }, { label: "Loan paid out", num: 1, render: (x) => num(x.disbursed) }, { label: "Principal unpaid", num: 1, render: (x) => num(x.principalOutstanding) }, { label: "Interest unpaid", num: 1, render: (x) => num(x.interestOutstanding) }, { label: "Written off", num: 1, render: (x) => num(x.writtenOffPrincipal + x.writtenOffInterest) }, { label: "Status", render: (x) => badge(x.status, x.status === "Open" ? "bad" : "ok") }], (st.db.historicalLoans || []).filter((l) => !l.voided).map((l) => HLN.position(st.db, l.id))),
      canW && (st.db.historicalLoans || []).length ? h("div", { class: "row" },
        h("button", { id: "res-offset", onclick: () => Form("Offset a member's savings against a historical loan", [{ name: "loanId", label: "Historical loan", type: "select", options: histOpts }, dateF("date", "Date"), { name: "amount", label: "Amount (UGX)", type: "number" }, { name: "evidence", label: "Evidence (member's written consent, minute)" }, { name: "reason", label: "Reason" }], act(async (f) => commit("offsetHistoricalLoan", { loanId: f.loanId, date: f.date, amount: Number(f.amount), evidence: f.evidence, reason: f.reason }))) }, "Offset savings against a loan"),
        h("button", { id: "res-writeoff", onclick: () => Form("Write off an uncollectible historical loan balance (needs Chairperson approval)", [{ name: "loanId", label: "Historical loan", type: "select", options: histOpts }, { name: "lossYear", label: "Closed financial year that bears the loss", type: "select", options: yearOpts.filter((o) => (FYM.byYear(st.db, o.value) || {}).status === "Closed") }, { name: "principal", label: "Loan principal written off (UGX)", type: "number" }, { name: "interest", label: "Interest written off (UGX)", type: "number" }, { name: "evidence", label: "Evidence (why it cannot be collected)" }, { name: "reason", label: "Reason" }], act(async (f) => commit("writeOffHistoricalLoan", { loanId: f.loanId, lossYear: Number(f.lossYear), principal: Number(f.principal) || 0, interest: Number(f.interest) || 0, evidence: f.evidence, reason: f.reason }))) }, "Write off a loan balance")) : null,
      h("h2", { class: "sec" }, "Reserve by financial year"),
      Table([{ label: "Year", key: "label" }, { label: "Opening", num: 1, render: (r) => num(r.opening) }, { label: "Opening recorded", num: 1, render: (r) => num(r.openingBalanceIntroduced) }, { label: "Verified profit in", num: 1, render: (r) => num(r.transfers) }, { label: "Verified loss", num: 1, render: (r) => num(r.losses) }, { label: "Used", num: 1, render: (r) => num(r.utilization) }, { label: "Closing", num: 1, render: (r) => h("strong", null, num(r.closing)) }], stmt.rows),
      h("h2", { class: "sec" }, "Every movement"),
      Table([{ label: "Date", render: (e) => D.toDisplay(e.date) }, { label: "Movement", key: "kind" }, { label: "Amount", num: 1, render: (e) => num(e.amount) }, { label: "Approved by", render: (e) => e.authorisedBy || "" }, { label: "Evidence", key: "evidence" }, { label: "Reason", key: "reason" }], stmt.entries));
  }
  const VIEWS = { reserve: reserveView, profit, approvals, airtime, messages, system, dash: dashboard, members, loans, ledger, subs, shareout, reports, recon, audit, home: MV.home, savings: MV.savings, myloans: MV.loans, myguar: MV.guarantees, more: MV.more, mysubs: MV.subs, myshare: MV.share };

  /* ---------- boot ---------- */
  const connBanner = (host, err) => { host.replaceChildren(Banner("bad", "SOB could not reach its records. This is not a problem with your ID or PIN."), h("div", { class: "hint", id: "login-problem-detail" }, friendly(err)), h("div", { class: "hint" }, "Please tell " + R.OFFICERS.filter((o) => ["Treasurer", "Secretary"].includes(o[1])).map((o) => o[0] + " (" + o[2] + ")").join(" or ") + ".")); };
  async function boot() {
    if (CFG.notConfigured || (!CFG.ledgerUrl && !CFG.demo)) { app.append(State("error", "SOB is not switched on yet. Please contact " + R.OFFICERS.filter((o) => ["Treasurer", "Secretary"].includes(o[1])).map((o) => o[0] + " on " + o[2]).join(" or ") + ".")); return; }
    app.append(State("loading"));
    try {
      if (st.live) {
        st.store = S.client.create({ url: CFG.ledgerUrl, fetch: window.fetch.bind(window), session: window.sessionStorage });
        st.store.onChange((e) => { Busy.set(e.busy ? e.busyLabel : null); if (e.status === "synced") st.lastLoad = Date.now(); if (e.status === "signed-out" && st.user) { st.user = null; st.view = null; render(); toast("Your session ended. Please sign in again.", "warn"); } });
        st.db = { members: [], transactions: [], loans: [] };
        st.store.check().then((r) => { st.conn = r; const host = document.getElementById("login-problem"); if (host && !r.ok && !host.children.length) connBanner(host, r.error); });   // tell people BEFORE they type if the endpoint is unreachable/misconfigured
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
