(function () {
  const { h, ugx, num, badge, Card, Table, State, Modal, Form, toast, friendly } = window.SOBUI;
  const S = window.SOB, CFG = window.SOB_CONFIG || {}, D = S.dates, L = S.ledger, G = S.gov, LN = S.loans, N = S.notify, AT = S.airtime, C = S.cycle, K = S.kpis, R = S.reports;
  const app = document.getElementById("app");
  const st = { store: null, db: null, user: null, view: null, live: !!CFG.ledgerUrl, memberView: null };
  const today = () => D.todayISO();
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
      const pin = h("input", { type: "password", id: "pin", placeholder: "PIN", autocomplete: "current-password" }), mid = h("input", { id: "mid", placeholder: "Member ID or staff ID", autocapitalize: "characters" });
      box.append(h("label", null, "ID"), mid, h("label", null, "PIN"), pin, h("div", { class: "row" }, h("button", { class: "primary", id: "login-go", onclick: async () => {
        try { await st.store.login(mid.value.trim(), pin.value); st.user = st.store.user; st.view = null; if (!st.user.mustChangePin) { await st.store.load(); st.db = st.store.db; } render(); }
        catch (e) { toast(e.code === "BAD_CREDENTIALS" ? "Wrong ID or PIN" : e.code === "LOCKED" ? "Too many attempts. Try again in 15 minutes." : friendly(e), true); }
      } }, "Sign in")));
    }
    return box;
  }

  /* A PIN printed on a slip (or set by an Admin) is known to someone else: its owner must replace it before anything else is possible (enforced by the server too). */
  function forcePinScreen() {
    const o = h("input", { type: "password", id: "fp-old", autocomplete: "current-password" }), n = h("input", { type: "password", id: "fp-new", autocomplete: "new-password" }), c = h("input", { type: "password", id: "fp-new2", autocomplete: "new-password" });
    return h("div", { class: "card", style: "max-width:420px;margin:40px auto", id: "force-pin" }, h("h2", { class: "sec", style: "margin-top:0" }, "Choose your own PIN"),
      h("p", { class: "mute" }, "Your first PIN was given to you on paper. For your security, set a private PIN now (members: at least 4 characters; staff: at least 6)."),
      h("label", null, "Current (slip) PIN"), o, h("label", null, "New PIN"), n, h("label", null, "Repeat new PIN"), c,
      h("div", { class: "row" }, h("button", { class: "primary", id: "fp-go", onclick: async () => {
        if (n.value !== c.value) return toast("The two new PINs do not match", true);
        try { await st.store.setPin(n.value, o.value); st.user.mustChangePin = false; await st.store.load(); st.db = st.store.db; st.view = null; toast("PIN changed"); render(); } catch (e) { toast(friendly(e), true); }
      } }, "Save PIN"), h("button", { onclick: async () => { await st.store.logout(); st.user = null; render(); } }, "Sign out")));
  }

  /* ---------- navigation ---------- */
  const NAV_STAFF = [["dash", "Dashboard"], ["members", "Members"], ["loans", "Loans"], ["ledger", "Ledger"], ["subs", "Subscriptions"], ["airtime", "Airtime"], ["shareout", "Share-Out"], ["profit", "Profit"], ["approvals", "Approvals"], ["reports", "Reports"], ["recon", "Reconciliation"], ["audit", "Audit"], ["messages", "Messages", "Admin"], ["system", "System", "Admin"]];
  const NAV_MEMBER = [["home", "Home"], ["savings", "Savings & Statement"], ["myloans", "Loan & Interest"], ["airtime", "Airtime"]];
  const pendingAirtime = () => (st.db.airtimeRequests || []).filter((r) => r.status === "Pending").length;
  function render() {
    app.replaceChildren();
    if (!st.user) { app.append(loginScreen()); return; }
    if (st.live && st.user.mustChangePin) { app.append(forcePinScreen()); return; }
    const nav = (isStaff() ? NAV_STAFF : NAV_MEMBER).filter((n) => !n[2] || n[2] === st.user.role); st.view = st.view || nav[0][0];
    app.append(h("header", null, h("h1", null, "SOB " + (isStaff() ? "Admin" : "Member")), h("span", { class: "pill" }, st.live ? "LIVE" : "DEMO · DEV"), h("span", { class: "pill" }, roleLabel(st.user.role) + " · " + st.user.name),
      st.live ? h("button", { id: "my-pin", onclick: () => Form("Change my PIN", [{ name: "o", label: "Current PIN", type: "password" }, { name: "n", label: "New PIN (members 4+, staff 6+ characters)", type: "password" }], act(async (f) => { await st.store.setPin(f.n, f.o); }, "PIN changed")) }, "My PIN") : null,
      h("button", { id: "logout", onclick: async () => { if (st.live) await st.store.logout(); st.user = null; st.view = null; render(); } }, "Sign out")),
      h("nav", null, nav.map(([k, l]) => h("button", { class: st.view === k ? "active" : "", "data-nav": k, onclick: () => { st.view = k; st.memberView = null; render(); } }, l, k === "airtime" && isStaff() && pendingAirtime() ? " (" + pendingAirtime() + ")" : "", k === "approvals" && isStaff() && K.dashboard(st.db, today()).awaitingApproval.value ? " (" + K.dashboard(st.db, today()).awaitingApproval.value + ")" : ""))));
    const main = h("main", { id: "main" }); app.append(main);
    try { main.append(VIEWS[st.view]()); } catch (e) { main.append(State("error", "Could not show this screen: " + friendly(e))); }
  }

  /* ---------- drill-down helpers ---------- */
  const loanRows = (filter) => K.loanBook(st.db, today()).filter(filter || (() => true));
  const loanCols = [{ label: "Loan", key: "id" }, { label: "Member", render: (v) => nameOf(st.db.loans.find((l) => l.id === v.id).memberId) }, { label: "Principal", num: 1, render: (v) => num(v.principal) }, { label: "Interest", num: 1, render: (v) => num(v.accumulatedInterest) }, { label: "Repaid", num: 1, render: (v) => num(v.repaid) }, { label: "Balance", num: 1, render: (v) => num(v.balance) }, { label: "Status", render: (v) => badge(v.status, v.balance > 0 ? "warn" : "ok") }];
  function drill(title, definition, body) { Modal(title, h("div", null, definition ? h("p", { class: "mute" }, "How this is calculated: " + definition) : null, body)); }

  /* ---------- Interest Receivable: every outstanding loan, how the interest arose, what is unpaid ---------- */
  function openInterestReceivable() {
    const d = K.interestReceivable(st.db, today());
    const cols = [{ label: "Member", key: "member" }, { label: "Loan", key: "loanId" }, { label: "Principal", num: 1, render: (r) => num(r.principal) }, { label: "Monthly interest", num: 1, render: (r) => num(r.assignedMonthlyInterest) },
      { label: "Disbursed", render: (r) => D.toDisplay(r.disbursed) }, { label: "Interest from", render: (r) => D.toDisplay(r.interestStartsAfter) }, { label: "Months elapsed", num: 1, key: "monthsElapsed" }, { label: "Months charged", num: 1, key: "monthsCharged" },
      { label: "Accumulated interest", num: 1, render: (r) => num(r.accumulatedInterest) }, { label: "Payments made", num: 1, render: (r) => num(r.paymentsMade) }, { label: "Unpaid interest", num: 1, render: (r) => h("strong", null, num(r.unpaidInterest)) }, { label: "Outstanding loan", num: 1, render: (r) => num(r.outstanding) }];
    drill("Interest Receivable", K.dashboard(st.db, today()).interestReceivable.definition, h("div", null,
      h("div", { class: "grid" }, Card("Unpaid interest (total)", ugx(d.total), "accrued less paid, interest first"), Card("Accumulated interest", ugx(d.accumulated)), Card("Payments made", ugx(d.paymentsMade)), Card("Outstanding loans", ugx(d.outstanding))),
      Table(cols, d.rows, (r) => openLoan(r.loanId)), h("p", { class: "mute" }, "Tap a loan for its full history: interest changes, every payment, guarantors and the linked ledger.")));
  }

  /* ---------- Admin: dashboard ---------- */
  function dashboard() {
    const k = K.dashboard(st.db, today(), { year: Number(today().slice(0, 4)) }), p = K.pipeline(st.db);
    const savingsRows = () => Table([{ label: "Member", render: (r) => r.name }, { label: "Savings", num: 1, render: (r) => num(r.savings) }], R.savings(st.db).rows.filter((r) => r.savings !== 0), (r) => openMember(r.memberId));
    const wrap = h("div", null,
      h("div", { class: "grid", id: "kpis" },
        Card("Total Savings", ugx(k.totalSavings.value), "Group, lifetime", () => drill("Total Savings", k.totalSavings.definition, savingsRows())),
        Card("Available Cash", ugx(k.availableCash.value), "Net cash movement", () => drill("Available Cash", k.availableCash.definition, Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Type", key: "type" }, { label: "Amount", num: 1, render: (t) => num(t.amount) }], L.activeTransactions(st.db).slice(-25).reverse()))),
        Card("Outstanding Loans", ugx(k.outstandingLoans.value), k.outstandingLoans.count + " active loans", () => drill("Outstanding Loans", k.outstandingLoans.definition, Table(loanCols, loanRows((v) => v.balance > 0), (v) => openLoan(v.id)))),
        Card("Interest Receivable", ugx(k.interestReceivable.value), k.interestReceivable.loans + " loans · unpaid interest", () => openInterestReceivable()),
        Card("Profit (this year)", ugx(k.profit.value), "Recorded profit entries", () => drill("Profit", k.profit.definition, h("div", null, h("p", { class: "mute" }, "Profit is shared in proportion to eligible savings; members with an outstanding loan are not eligible. Open Profit to see every member's calculation."), h("button", { onclick: () => { const m = document.querySelector(".modal-bg"); if (m) m.remove(); st.view = "profit"; render(); } }, "Open Profit")))),
        Card("Expenses (this year)", ugx(k.expenses.value), "", () => drill("Expenses", k.expenses.definition, tableFromReport(R.incomeExpenses(st.db, { year: Number(today().slice(0, 4)) })))),
        Card("Members", String(k.members.value), "Active", () => { st.view = "members"; render(); }),
        Card("Awaiting approval", String(k.awaitingApproval.value), "Chairperson second approval", () => { st.view = "approvals"; render(); }),
        Card("Loan Exposure", k.loanExposure.pct == null ? "—" : k.loanExposure.pct + "%", "Guaranteed " + ugx(k.loanExposure.guaranteed), () => drill("Loan Exposure", k.loanExposure.definition, tableFromReport(R.guarantors(st.db))))),
      h("h2", { class: "sec" }, "Loan pipeline"),
      h("div", { class: "grid", id: "pipeline" }, Object.keys(p).map((s) => Card(s, String(p[s]), "", () => drill(s + " loans", null, Table(loanCols, loanRows((v) => v.status === s), (v) => openLoan(v.id)))))),
      h("h2", { class: "sec" }, "Guarantor exposure"), Table([{ label: "Guarantor", render: (r) => r.name }, { label: "Committed", num: 1, render: (r) => num(r.committed) }, { label: "Loans", num: 1, key: "guarantees" }], LN.exposureReport(st.db), (r) => openMember(r.memberId)),
      h("h2", { class: "sec" }, "Subscription compliance " + today().slice(0, 4)));
    const c = C.subscriptionCompliance(st.db, today().slice(0, 4));
    wrap.append(h("div", { class: "grid" }, Card("Collected", ugx(c.collected), "of " + ugx(c.expected), () => { st.view = "subs"; render(); }), Card("Unpaid members", String(c.unpaid.length), "", () => drill("Unpaid subscriptions", null, Table([{ label: "Member", render: (id) => nameOf(id) }], c.unpaid, null)))));
    return wrap;
  }
  const tableFromReport = (rep) => Table(rep.columns.map((c) => ({ label: c, render: (r) => r[c] })), rep.rows);

  /* ---------- members ---------- */
  function openMember(id) {
    const m = st.db.members.find((x) => x.id === id); if (!m) return;
    const hist = L.memberLifetimeHistory(st.db, id).slice().reverse(), loans = st.db.loans.filter((l) => l.memberId === id && !l.voided);
    drill(m.id + " — " + m.name, null, h("div", null,
      h("div", { class: "grid" }, Card("Savings", ugx(L.memberSavings(st.db, id)), "Lifetime ledger"), Card("Guarantee committed", ugx(LN.committed(st.db, id))), Card("Outstanding loan", ugx(loans.reduce((a, l) => a + Math.max(0, L.loanOutstanding(l, st.db, today())), 0)))),
      st.live && st.user.role === "Admin" ? h("div", { class: "row" }, (st.db.users || []).some((u) => u.id === m.id)
        ? h("button", { "data-act": "reset-pin", onclick: () => Form("Reset PIN for " + m.name, [{ name: "n", label: "New PIN (4+ characters)", type: "password" }], act(async (f) => { await st.store.setPin(f.n, undefined, m.id); }, "PIN reset")) }, "Reset PIN")
        : h("button", { "data-act": "create-signin", onclick: () => Form("Create sign-in for " + m.name, [{ name: "n", label: "Initial PIN (4+ characters)", type: "password" }], act(async (f) => { await st.store.createUser({ id: m.id, name: m.name, role: "Member", memberId: m.id, pin: f.n }); await st.store.load(); st.db = st.store.db; }, "Sign-in created")) }, "Create sign-in")) : null,
      h("h2", { class: "sec" }, "Loans"), Table(loanCols, K.loanBook(st.db, today()).filter((v) => loans.some((l) => l.id === v.id)), (v) => openLoan(v.id)),
      h("h2", { class: "sec" }, "Lifetime history"), Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Type", key: "type" }, { label: "Amount", num: 1, render: (t) => num(t.amount) }, { label: "Savings after", num: 1, render: (t) => num(t.runningSavings) }], hist.slice(0, 50))));
  }
  function members() {
    return h("div", null, h("div", { class: "row" }, G.can(ctx(), "member.manage") ? h("button", { class: "primary", id: "add-member", onclick: () => Form("Add member", [{ name: "name", label: "Full name" }, { name: "phone", label: "Phone" }], act(async (v) => commit("addMember", { name: v.name, phone: v.phone }), "Member added")) }, "Add member") : null),
      Table([{ label: "ID", key: "id" }, { label: "Name", key: "name" }, { label: "Savings", num: 1, render: (m) => num(L.memberSavings(st.db, m.id)) }], st.db.members, (m) => openMember(m.id)));
  }

  /* ---------- loans ---------- */
  function openLoan(id) {
    const loan = st.db.loans.find((l) => l.id === id), v = LN.loanView(st.db, loan, today()), c = ctx();
    const b = h("div", null,
      h("div", { class: "grid" }, Card("Principal", ugx(v.principal)), Card("Assigned monthly interest", ugx(v.assignedMonthlyInterest), "Set by Admin per loan"), Card("Interest accrued", ugx(v.accumulatedInterest), v.unpaidMonths + " months after grace"), Card("Balance", ugx(v.balance), "Payable " + ugx(v.payable) + " − repaid " + ugx(v.repaid))),
      h("p", null, "Member: ", nameOf(loan.memberId), " · Status: ", badge(loan.status, loan.voided ? "bad" : "mute"), loan.voided ? badge("VOIDED", "bad") : null),
      loanBacking(loan),
      h("h2", { class: "sec" }, "Guarantors (savings-backed)"), Table([{ label: "Guarantor", render: (g) => nameOf(g.guarantorId) }, { label: "Guaranteed", num: 1, render: (g) => num(g.amount) }, { label: "Released", num: 1, render: (g) => num(g.releasedAmount || 0) }, { label: "Still committed", num: 1, render: (g) => num(g.status === "Active" ? L.guaranteeRemaining(g) : 0) }, { label: "Status", render: (g) => badge(g.status, g.status === "Active" ? "ok" : g.status === "Requested" ? "warn" : "mute") },
        { label: "", render: (g) => g.status === "Requested" && G.can(c, "guarantee.manage") ? h("button", { "data-accept-guarantee": g.id, onclick: (ev) => { ev.stopPropagation(); Form("Record the guarantor's acceptance", [{ name: "evidence", label: "How did they accept? (signed form, call, message) - required" }], act(async (f) => { await commit("acceptGuarantee", { id: g.id, evidence: f.evidence }); document.querySelector(".modal-bg").remove(); openLoan(id); }, "Guarantee accepted and committed")); } }, "Record acceptance") : "" }], (st.db.guarantees || []).filter((g) => g.loanId === id && g.status !== "Declined")),
      h("h2", { class: "sec" }, "Other security (exceptional)"), Table([{ label: "Kind", key: "kind" }, { label: "Description", key: "description" }, { label: "Valuation", num: 1, render: (x) => x.valuation == null ? "—" : num(x.valuation) }, { label: "Accepted cover", num: 1, render: (x) => num(x.acceptedCover || 0) }, { label: "Docs", num: 1, render: (x) => (x.documents || []).length }, { label: "Status", render: (x) => badge(x.status, x.status === "Approved" ? "ok" : x.status === "Proposed" ? "warn" : "mute") },
        { label: "", render: (x) => x.status === "Proposed" && G.can(c, "security.approve") ? h("span", { class: "row", style: "margin:0" }, h("button", { class: "primary", "data-approve-security": x.id, onclick: (ev) => { ev.stopPropagation(); Form("Approve exceptional security", [{ name: "reason", label: "Why SOB exceptionally accepts security (required)" }, { name: "cover", label: "Part of the loan this security backs (UGX)", type: "number" }], act(async (f) => { await commit("decideSecurity", { id: x.id, decision: "approve", reason: f.reason, acceptedCover: Number(f.cover) }); document.querySelector(".modal-bg").remove(); openLoan(id); }, "Security approved")); } }, "Approve"),
          h("button", { class: "danger", "data-reject-security": x.id, onclick: (ev) => { ev.stopPropagation(); Form("Reject security", [{ name: "reason", label: "Reason (required)" }], act(async (f) => { await commit("decideSecurity", { id: x.id, decision: "reject", reason: f.reason }); document.querySelector(".modal-bg").remove(); openLoan(id); }, "Rejected")); } }, "Reject")) : "" }], (st.db.securities || []).filter((x) => x.loanId === id)),
      ["Active", "Cleared"].includes(loan.status) && (st.db.guarantees || []).some((g) => g.loanId === id) ? h("div", null, h("h2", { class: "sec" }, "Linked ledger: borrower and guarantors"), tableFromReport(R.loanStatement(st.db, id, today()))) : null,
      h("h2", { class: "sec" }, "Interest history"), Table([{ label: "Date", key: "date" }, { label: "From", num: 1, render: (x) => x.previousAmount == null ? "—" : num(x.previousAmount) }, { label: "To", num: 1, render: (x) => num(x.newAmount) }, { label: "Reason", key: "reason" }], v.interestHistory),
      h("h2", { class: "sec" }, "Repayments"), Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Amount", num: 1, render: (t) => num(t.amount) }], L.activeTransactions(st.db).filter((t) => t.loanId === id && t.type === "Loan Repayment")));
    const row = h("div", { class: "row" }); const M = () => document.querySelector(".modal-bg");
    const add = (label, cond, fn, cls) => cond && row.append(h("button", { class: cls || "", "data-act": label, onclick: fn }, label));
    const preDisb = ["Pending", "AwaitingApproval", "Approved"].includes(loan.status);
    add("Request guarantee", G.can(c, "guarantee.manage") && preDisb, () => Form("Request a guarantee (more than one guarantor may back a loan)", [{ name: "g", label: "Guarantor", options: st.db.members.filter((m) => m.id !== loan.memberId).map((m) => ({ value: m.id, label: m.name + " — available " + num(L.memberAvailable(st.db, m.id)) })) }, { name: "amt", label: "Amount guaranteed (UGX)", type: "number" }], act(async (f) => { await commit("addGuarantee", { loanId: id, guarantorId: f.g, amount: Number(f.amt) }); M().remove(); openLoan(id); }, "Requested - it binds only when the guarantor accepts")));
    add("Propose other security", G.can(c, "security.manage") && preDisb, () => Form("Propose exceptional security (not the normal route)", [{ name: "kind", label: "Kind", options: S.security.KINDS }, { name: "description", label: "Description (what, where, who owns it)" }, { name: "owner", label: "Owner of the security" }, { name: "valuation", label: "Valuation (UGX)", type: "number" }, { name: "valuationDate", label: "Valuation date (YYYY-MM-DD)", value: today() }, { name: "valuedBy", label: "Valued by" }, { name: "doc", label: "Document / evidence title" }, { name: "ref", label: "Document reference" }], act(async (f) => { await commit("proposeSecurity", { loanId: id, kind: f.kind, description: f.description, owner: f.owner, valuation: f.valuation ? Number(f.valuation) : undefined, valuationDate: f.valuationDate, valuedBy: f.valuedBy, documents: [{ name: f.doc, reference: f.ref }] }); M().remove(); openLoan(id); }, "Proposed - the Chairperson must approve it")));
    add("Release guarantors", G.can(c, "guarantee.manage") && preDisb && (st.db.guarantees || []).some((g) => g.loanId === id && ["Active", "Requested"].includes(g.status)), () => Form("Release guarantors (before disbursement only)", [{ name: "reason", label: "Reason (required)" }], act(async (f) => { await commit("releaseGuarantor", { loanId: id, reason: f.reason }); M().remove(); openLoan(id); }, "Guarantors released")));
    add(loan.status === "AwaitingApproval" ? "Approve (second approval)" : "Approve", (G.can(c, "loan.review") && loan.status === "Pending") || (G.can(c, "loan.secondApprove") && loan.status === "AwaitingApproval"), act(async () => { await commit("approveLoan", { loanId: id }); M().remove(); openLoan(id); }, "Done"), "primary");
    add("Decline", (G.can(c, "loan.review") || G.can(c, "loan.secondApprove")) && preDisb, () => Form("Decline loan", [{ name: "reason", label: "Reason" }], act(async (f) => { await commit("declineLoan", { loanId: id, reason: f.reason }); M().remove(); }, "Loan declined")));
    add("Disburse", G.can(c, "loan.disburse") && loan.status === "Approved", () => Form("Disburse loan", [{ name: "rate", label: "Assigned monthly interest (UGX) — required", type: "number" }, { name: "grace", label: "Grace months", type: "number", value: 3 }, { name: "date", label: "Date (YYYY-MM-DD)", value: today() }], act(async (f) => { await commit("disburseLoan", { loanId: id, assignedMonthlyInterest: f.rate, graceMonths: f.grace, date: f.date }); M().remove(); openLoan(id); }, "Loan disbursed")), "primary");
    add("Record repayment", G.can(c, "loan.repay") && loan.status === "Active", () => Form("Record repayment", [{ name: "amount", label: "Amount (UGX)", type: "number" }, { name: "date", label: "Date", value: today() }], act(async (f) => { await commit("repayLoan", { loanId: id, amount: f.amount, date: f.date }); M().remove(); openLoan(id); }, "Repayment recorded")), "primary");
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
        Card("Backing needed", ugx(a.required), "Only the part beyond the guideline"), Card("Backing accepted", ugx(a.backing), "Guarantees " + num(a.guaranteeCover) + " · security " + num(a.securityCover))),
      a.canApprove ? h("p", { class: "ok" }, a.withinGuideline && !a.required ? "Qualifies on the member's own savings." : "Backing is sufficient.") : h("div", { class: "blocked" }, a.reasons.join(" ")), a.securityBacked ? h("p", { class: "mute" }, "Exceptional route: relies on approved security, not only on guarantors.") : null);
  }
  function loans() {
    return h("div", null, h("div", { class: "row" }, G.can(ctx(), "loan.apply") ? h("button", { class: "primary", id: "new-loan", onclick: () => Form("New loan application", [{ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) }, { name: "amt", label: "Amount (UGX)", type: "number" }], act(async (f) => commit("applyForLoan", { memberId: f.m, amount: f.amt }), "Application recorded")) }, "New application") : null),
      Table(loanCols, K.loanBook(st.db, today()), (v) => openLoan(v.id)), h("p", { class: "mute" }, "A member normally qualifies for up to 3× their savings. A loan beyond that can still proceed when guarantors (their combined available savings) or, exceptionally, approved security back the shortfall. A guaranteed amount leaves the guarantor's available balance when accepted and returns as the borrower repays."));
  }

  /* ---------- ledger ---------- */
  function ledger() {
    const rows = st.db.transactions.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 200);
    return h("div", null, h("div", { class: "row" }, G.can(ctx(), "ledger.create") ? h("button", { class: "primary", id: "add-entry", onclick: () => Form("New ledger entry", [{ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) }, { name: "type", label: "Type", options: ["Savings", "Withdraw", "Expense", "Income", "Profit", "Bank Charge"] }, { name: "amount", label: "Amount (UGX)", type: "number" }, { name: "date", label: "Date (YYYY-MM-DD)", value: today() }, { name: "purpose", label: "Purpose" }], act(async (f) => commit("createEntry", { memberId: f.m, type: f.type, amount: f.amount, date: f.date, purpose: f.purpose }), "Entry recorded")) }, "New entry") : null),
      Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Member", render: (t) => nameOf(t.memberId) }, { label: "Type", key: "type" }, { label: "Amount", num: 1, render: (t) => num(t.amount) }, { label: "State", render: (t) => t.voided ? badge("Voided", "bad") : t.approvalStatus === "PendingApproval" ? badge("Awaiting Chairperson", "warn") : t.approvalStatus === "Rejected" ? badge("Rejected", "bad") : badge("Counted", "ok") }], rows, (t) => openEntry(t.id)));
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
      Table([{ label: "Member", render: (m) => m.name }, { label: "Status", render: (m) => c.paid.includes(m.id) ? badge("Paid", "ok") : badge("Unpaid", "bad") }, { label: "", render: (m) => !c.paid.includes(m.id) && G.can(ctx(), "subscription.record") ? h("button", { "data-sub": m.id, onclick: (e) => { e.stopPropagation(); act(async () => commit("recordSubscription", { memberId: m.id, year: y }), "Recorded UGX 5,000")(); } }, "Record UGX 5,000") : null }], st.db.members.filter((m) => m.status !== "Inactive")));
  }
  function shareout() {
    const y = Number(today().slice(0, 4)), p = C.previewShareOut(st.db, y, today());
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
    const setCycle = (c) => Form(c ? "Change inputs for " + c.period : "Set the inputs for a distribution cycle", [{ name: "period", label: "Period (e.g. 2026-Q2)", value: c ? c.period : "" }, { name: "pool", label: "Profit pool to distribute (UGX)", type: "number", value: c ? c.pool : "" }, { name: "date", label: "Savings measured at (YYYY-MM-DD)", value: c ? c.measurementDate : "" }, { name: "source", label: "Where this profit came from", value: c ? c.sourceNote : "" }, { name: "reason", label: "Reason / SOB reference for these inputs (required)" }],
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
  const REPORTS = { "Interest Receivable": () => R.interestReceivable(st.db, today()), "Awaiting approval": () => R.approvals(st.db), "Exceptional security": () => R.securities(st.db), "Profit distribution": () => R.quarterlyDistribution(st.db), "Savings by member": () => R.savings(st.db), "Loan book": () => R.loans(st.db, today()), "Loan repayments": () => R.repayments(st.db, null), "Guarantor exposure": () => R.guarantors(st.db), "Subscriptions": () => R.subscriptions(st.db, today().slice(0, 4)), "Income & expenses": () => R.incomeExpenses(st.db, null), "December share-out": () => R.shareOut(st.db, today().slice(0, 4), today()), "Airtime requests": () => R.airtime(st.db), "Notification log": () => R.notificationLog(st.db), "Reconciliation register": () => R.reconciliationRegister(st.db), "Annual summary": () => R.annualSummary(st.db, today().slice(0, 4)), "Interest vs principal received": () => R.repaymentAllocation(st.db), "Quarterly distribution": () => R.quarterlyDistribution(st.db, { year: Number(today().slice(0, 4)), quarter: 1 }) };
  function reports() {
    return h("div", { class: "grid" }, Object.keys(REPORTS).map((n) => Card(n, "Open", "", () => {
      const rep = REPORTS[n](); if (rep.blocked) { drill(n, null, h("div", { class: "blocked" }, "Blocked: " + rep.reason)); return; }
      const dl = (name, type, data) => { const a = h("a", { href: URL.createObjectURL(new Blob([data], { type })), download: name }); document.body.append(a); a.click(); a.remove(); };
      drill(rep.title, null, h("div", null, h("div", { class: "row" }, h("button", { "data-csv": 1, onclick: () => dl(n.replace(/\W+/g, "_") + ".csv", "text/csv", R.toCSV(rep)) }, "Download CSV"), h("button", { "data-print": 1, onclick: () => { const w = window.open("", "_blank"); w.document.write(R.toPrintHTML(rep, { generated: D.toDisplay(today()) })); w.document.close(); w.print(); } }, "Print / PDF")), tableFromReport(rep), h("pre", { class: "mute" }, JSON.stringify(rep.totals))));
    })));
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
      { name: "etype", label: "Correcting entry type (only for 'post a correcting entry')", options: ["Savings", "Withdraw", "Loan Repayment", "Expense", "Income"] }, { name: "eamt", label: "Entry amount", type: "number" }, { name: "edate", label: "Entry date", value: today() }, { name: "emember", label: "Entry member ID", value: /^SOB-\d+/.test(d.subject) ? d.subject : "" }],
      act(async (f) => { await commit("resolveDiscrepancy", { id, decision: f.decision, reason: f.reason, evidence: f.evidence, entry: f.decision === "ACCEPT_SOURCE_WITH_ENTRY" ? { type: f.etype, amount: f.eamt, date: f.edate, memberId: f.emember } : undefined }); document.querySelector(".modal-bg") && document.querySelector(".modal-bg").remove(); }, "Resolved")) }, "Resolve"));
    drill("Discrepancy " + d.subject, null, body);
  }
  function audit() { return Table([{ label: "When", key: "date" }, { label: "Entity", render: (a) => a.entityType + " " + a.entityId }, { label: "Action", key: "action" }, { label: "By", key: "by" }, { label: "Reason", key: "reason" }], (st.db.auditLog || []).slice().reverse().slice(0, 200)); }

  /* ---------- member portal ---------- */
  const me = () => st.user.memberId;
  function home() {
    const id = me(), sav = L.memberSavings(st.db, id), loans = K.loanBook(st.db, today()).filter((v) => st.db.loans.find((l) => l.id === v.id).memberId === id);
    const bal = loans.reduce((a, v) => a + Math.max(0, v.balance), 0);
    return h("div", null, h("h2", { class: "sec", style: "margin-top:0" }, "Welcome, " + st.user.name),
      h("div", { class: "grid" }, Card("My Savings", ugx(sav), "Tap for statement", () => { st.view = "savings"; render(); }), Card("My Loan Balance", ugx(bal), loans.length ? "Tap for details" : "No loan", () => { st.view = "myloans"; render(); }), Card("Committed to guarantees", ugx(LN.committed(st.db, id)), "Cannot be withdrawn until released"), Card("Available to withdraw", ugx(L.memberPosition(st.db, id).withdrawable), "Savings minus commitments"),
      Card("SMS/WhatsApp notices", (st.db.members.find((m) => m.id === id) || {}).notifyOptOut ? "Off" : "On", "Tap to switch", () => { const off = !!(st.db.members.find((m) => m.id === id) || {}).notifyOptOut; act(async () => commit("setNotifyOptOut", { memberId: id, optOut: !off }), off ? "Notices switched on" : "Notices switched off")(); })), myGuaranteeRequests());
  }
  function myGuaranteeRequests() {
    const id = me(), reqs = (st.db.guarantees || []).filter((g) => g.guarantorId === id && g.status === "Requested");
    if (!reqs.length) return null;
    const loanOf = (g) => (st.db.loans || []).find((l) => l.id === g.loanId) || {};
    return h("div", { id: "guarantee-requests" }, h("h2", { class: "sec" }, "Guarantee requests for you"),
      h("p", { class: "mute" }, "If you accept, the amount is set aside from your savings straight away and cannot be withdrawn while the loan is unpaid. It is released back as the borrower repays."),
      Table([{ label: "Borrower", render: (g) => nameOf(loanOf(g).memberId) || "—" }, { label: "Loan", render: (g) => num(loanOf(g).amount || 0) }, { label: "You would guarantee", num: 1, render: (g) => num(g.amount) },
        { label: "Your available now", num: 1, render: () => num(L.memberPosition(st.db, id).available) },
        { label: "", render: (g) => h("span", { class: "row", style: "margin:0" },
          h("button", { class: "primary", "data-accept-guarantee": g.id, onclick: act(async () => commit("acceptGuarantee", { id: g.id, evidence: "Accepted by the guarantor in the member portal" }), "Guarantee accepted: amount set aside") }, "Accept"),
          h("button", { class: "danger", "data-decline-guarantee": g.id, onclick: () => Form("Decline guarantee", [{ name: "reason", label: "Reason (optional)" }], act(async (f) => commit("declineGuarantee", { id: g.id, reason: f.reason }), "Declined")) }, "Decline")) }], reqs));
  }
  function myGuarantees() {
    const id = me(), list = (st.db.guarantees || []).filter((g) => g.guarantorId === id && g.status !== "Requested" && g.status !== "Declined");
    if (!list.length) return null;
    return h("div", null, h("h2", { class: "sec" }, "Guarantees I have given"), Table([{ label: "Borrower", render: (g) => nameOf(((st.db.loans || []).find((l) => l.id === g.loanId) || {}).memberId) || "—" }, { label: "Guaranteed", num: 1, render: (g) => num(g.amount) }, { label: "Released back", num: 1, render: (g) => num(g.releasedAmount || 0) }, { label: "Still committed", num: 1, render: (g) => num(g.status === "Active" ? L.guaranteeRemaining(g) : 0) }, { label: "Status", render: (g) => badge(g.status, g.status === "Active" ? "ok" : "mute") }], list));
  }
  function mySavings() {
    const rep = R.memberStatement(st.db, me());
    const pos = L.memberPosition(st.db, me());
    return h("div", null, h("div", { class: "grid" }, Card("Actual savings", ugx(pos.savings), "Lifetime balance, never reset at share-out"), Card("Committed to guarantees", ugx(pos.committed), "Held while the loan is unpaid"), Card("Available balance", ugx(pos.available), "Savings minus commitments")), myGuarantees(), h("h2", { class: "sec" }, "Statement"), tableFromReport(rep));
  }
  function myLoans() {
    const mine = K.loanBook(st.db, today()).filter((v) => st.db.loans.find((l) => l.id === v.id).memberId === me());
    return h("div", null, h("div", { class: "row" }, h("button", { class: "primary", id: "apply", onclick: () => Form("Apply for a loan", [{ name: "amt", label: "Amount (UGX)", type: "number" }], act(async (f) => commit("applyForLoan", { memberId: me(), amount: f.amt }), "Application sent")) }, "Apply for a loan")),
      Table(loanCols.filter((c) => c.label !== "Member"), mine, (v) => openLoan(v.id)), myGuaranteeRequests(), h("p", { class: "mute" }, "Interest is assigned by the Admin for each loan and recalculated monthly until the loan is settled."));
  }

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

  /* ---------- system: backups + sign-ins (Admin, live deployment) ---------- */
  function system() {
    if (!st.live) return h("div", { class: "blocked" }, "Backups and sign-in management are available on the live deployment. This preview uses demo data that is never saved.");
    if (!st.sys) { st.sys = { loading: true, backups: [] }; st.store.call({ action: "listBackups" }).then((r) => { st.sys = { backups: r.backups }; render(); }).catch((e) => { st.sys = { backups: [], error: friendly(e) }; render(); }); }
    const reload = async () => { st.sys = null; render(); };
    const download = async () => {
      const r = await st.store.call({ action: "exportBackup" }), a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(r.backup)], { type: "application/json" })), download: "SOB-backup-" + today() + ".json" }); document.body.append(a); a.click(); a.remove(); toast("Backup downloaded — it contains members' personal data; keep it private");
    };
    return h("div", null, h("h2", { class: "sec", style: "margin-top:0" }, "Backups"),
      h("p", { class: "mute" }, "A snapshot is taken automatically every night once the daily trigger is installed (see the deployment guide). Snapshots are checksummed. Backups never contain PINs."),
      h("div", { class: "row" }, h("button", { class: "primary", id: "backup-now", onclick: act(async () => { const r = await st.store.call({ action: "backupNow", force: true }); toast("Snapshot " + r.id + " saved"); await reload(); }) }, "Back up now"), h("button", { id: "backup-download", onclick: act(download) }, "Download offline backup")),
      st.sys && st.sys.error ? h("div", { class: "err" }, st.sys.error) : null,
      Table([{ label: "Snapshot", key: "id" }, { label: "When", key: "createdAt" }, { label: "Label", key: "label" }, { label: "Ledger revision", num: 1, key: "revision" }, { label: "", render: (b) => h("button", { "data-verify-backup": b.id, onclick: act(async () => { const r = await st.store.call({ action: "verifyBackup", id: b.id }); toast("Verified: " + r.counts.transactions + " transactions, checksum OK"); }) }, "Verify") }], (st.sys && st.sys.backups) || []),
      h("p", { class: "mute" }, "Restoring is deliberately not available from this screen. It is a recovery step run by the spreadsheet owner (deployment guide, section E)."),
      h("h2", { class: "sec" }, "Sign-ins"),
      Table([{ label: "ID", key: "id" }, { label: "Name", key: "name" }, { label: "Role", key: "role" }, { label: "Status", render: (u) => badge(u.status, u.status === "Active" ? "ok" : "bad") }, { label: "", render: (u) => u.id === st.user.id || u.status === "Disabled" ? "" : h("button", { class: "danger", "data-disable": u.id, onclick: () => { if (confirm("Disable sign-in for " + u.id + "?")) act(async () => { await st.store.disableUser(u.id); await st.store.load(); st.db = st.store.db; render(); }, "Sign-in disabled")(); } }, "Disable") }], st.db.users || []));
  }
  const VIEWS = { profit, approvals, airtime, messages, system, dash: dashboard, members, loans, ledger, subs, shareout, reports, recon, audit, home, savings: mySavings, myloans: myLoans };

  /* ---------- boot ---------- */
  async function boot() {
    app.append(State("loading"));
    try {
      if (st.live) {
        st.store = S.client.create({ url: CFG.ledgerUrl, fetch: window.fetch.bind(window), session: window.sessionStorage });
        st.db = { members: [], transactions: [], loans: [] };
        if (await st.store.resume()) { st.user = st.store.user; if (!st.user.mustChangePin) { await st.store.load(); st.db = st.store.db; } }
      }
      else { const raw = await (await fetch("demo-seed.json")).json(); st.db = S.migrate.migrateLegacy(raw, today()); }
      window.__SOB = st; render();
    } catch (e) { app.replaceChildren(State("error", "Could not load data: " + friendly(e))); }
  }
  boot();
})();
