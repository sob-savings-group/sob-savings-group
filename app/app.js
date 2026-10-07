(function () {
  const { h, ugx, num, badge, Card, Table, State, Modal, Form, toast, friendly } = window.SOBUI;
  const S = window.SOB, CFG = window.SOB_CONFIG || {}, D = S.dates, L = S.ledger, G = S.gov, LN = S.loans, N = S.notify, AT = S.airtime, C = S.cycle, K = S.kpis, R = S.reports;
  const app = document.getElementById("app");
  const st = { store: null, db: null, user: null, view: null, live: !!CFG.ledgerUrl, memberView: null };
  const today = () => D.todayISO();
  const ctx = () => G.makeCtx(st.user);
  const isStaff = () => st.user && st.user.role !== "Member";
  const nameOf = (id) => ((st.db.members.find((m) => m.id === id)) || {}).name || id;

  /* Every write is a named command. Live: the SERVER runs it as the signed-in user (and may refuse). Demo: the same command table runs in memory. */
  async function commit(name, args) {
    const res = st.live ? await st.store.command(name, args) : S.commands.run(st.db, ctx(), name, args);
    if (st.live) st.db = st.store.db;
    render(); return res;
  }
  const act = (fn, okMsg) => async (...a) => { try { await fn(...a); if (okMsg) toast(okMsg); } catch (e) { toast(friendly(e), true); throw e; } };

  /* ---------- login ---------- */
  function loginScreen() {
    const box = h("div", { class: "card", style: "max-width:420px;margin:40px auto" }, h("h2", { class: "sec", style: "margin-top:0" }, "Sons of Bethel Savings Group"),
      h("div", { class: "mute" }, st.live ? "Sign in" : "DEV preview — demo data, nothing is saved or sent anywhere."));
    if (!st.live) {
      const role = h("select", { id: "demo-role" }, ["Admin", "Committee", "Member"].map((r) => h("option", { value: r }, r)));
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
  const NAV_STAFF = [["dash", "Dashboard"], ["members", "Members"], ["loans", "Loans"], ["ledger", "Ledger"], ["subs", "Subscriptions"], ["airtime", "Airtime"], ["shareout", "Share-Out"], ["reports", "Reports"], ["recon", "Reconciliation"], ["audit", "Audit"], ["messages", "Messages", "Admin"], ["system", "System", "Admin"]];
  const NAV_MEMBER = [["home", "Home"], ["savings", "Savings & Statement"], ["myloans", "Loan & Interest"], ["airtime", "Airtime"]];
  const pendingAirtime = () => (st.db.airtimeRequests || []).filter((r) => r.status === "Pending").length;
  function render() {
    app.replaceChildren();
    if (!st.user) { app.append(loginScreen()); return; }
    if (st.live && st.user.mustChangePin) { app.append(forcePinScreen()); return; }
    const nav = (isStaff() ? NAV_STAFF : NAV_MEMBER).filter((n) => !n[2] || n[2] === st.user.role); st.view = st.view || nav[0][0];
    app.append(h("header", null, h("h1", null, "SOB " + (isStaff() ? "Admin" : "Member")), h("span", { class: "pill" }, st.live ? "LIVE" : "DEMO · DEV"), h("span", { class: "pill" }, st.user.role + " · " + st.user.name),
      st.live ? h("button", { id: "my-pin", onclick: () => Form("Change my PIN", [{ name: "o", label: "Current PIN", type: "password" }, { name: "n", label: "New PIN (members 4+, staff 6+ characters)", type: "password" }], act(async (f) => { await st.store.setPin(f.n, f.o); }, "PIN changed")) }, "My PIN") : null,
      h("button", { id: "logout", onclick: async () => { if (st.live) await st.store.logout(); st.user = null; st.view = null; render(); } }, "Sign out")),
      h("nav", null, nav.map(([k, l]) => h("button", { class: st.view === k ? "active" : "", "data-nav": k, onclick: () => { st.view = k; st.memberView = null; render(); } }, l, k === "airtime" && isStaff() && pendingAirtime() ? " (" + pendingAirtime() + ")" : ""))));
    const main = h("main", { id: "main" }); app.append(main);
    try { main.append(VIEWS[st.view]()); } catch (e) { main.append(State("error", "Could not show this screen: " + friendly(e))); }
  }

  /* ---------- drill-down helpers ---------- */
  const loanRows = (filter) => K.loanBook(st.db, today()).filter(filter || (() => true));
  const loanCols = [{ label: "Loan", key: "id" }, { label: "Member", render: (v) => nameOf(st.db.loans.find((l) => l.id === v.id).memberId) }, { label: "Principal", num: 1, render: (v) => num(v.principal) }, { label: "Interest", num: 1, render: (v) => num(v.accumulatedInterest) }, { label: "Repaid", num: 1, render: (v) => num(v.repaid) }, { label: "Balance", num: 1, render: (v) => num(v.balance) }, { label: "Status", render: (v) => badge(v.status, v.balance > 0 ? "warn" : "ok") }];
  function drill(title, definition, body) { Modal(title, h("div", null, definition ? h("p", { class: "mute" }, "How this is calculated: " + definition) : null, body)); }

  /* ---------- Admin: dashboard ---------- */
  function dashboard() {
    const k = K.dashboard(st.db, today(), { year: Number(today().slice(0, 4)) }), p = K.pipeline(st.db);
    const savingsRows = () => Table([{ label: "Member", render: (r) => r.name }, { label: "Savings", num: 1, render: (r) => num(r.savings) }], R.savings(st.db).rows.filter((r) => r.savings !== 0), (r) => openMember(r.memberId));
    const wrap = h("div", null,
      h("div", { class: "grid", id: "kpis" },
        Card("Total Savings", ugx(k.totalSavings.value), "Group, lifetime", () => drill("Total Savings", k.totalSavings.definition, savingsRows())),
        Card("Available Cash", ugx(k.availableCash.value), "Net cash movement", () => drill("Available Cash", k.availableCash.definition, Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Type", key: "type" }, { label: "Amount", num: 1, render: (t) => num(t.amount) }], L.activeTransactions(st.db).slice(-25).reverse()))),
        Card("Outstanding Loans", ugx(k.outstandingLoans.value), k.outstandingLoans.count + " active loans", () => drill("Outstanding Loans", k.outstandingLoans.definition, Table(loanCols, loanRows((v) => v.balance > 0), (v) => openLoan(v.id)))),
        Card("Interest Receivable", ugx(k.interestReceivable.value), k.interestReceivable.provisional ? "Provisional · basis pending SOB (Q7)" : "", () => drill("Interest Receivable", k.interestReceivable.definition, Table(loanCols, loanRows((v) => v.accumulatedInterest > 0), (v) => openLoan(v.id)))),
        Card("Profit (this year)", ugx(k.profit.value), "Recorded profit entries", () => drill("Profit", k.profit.definition, h("div", { class: "blocked" }, "Distribution of profit is blocked until SOB approves the formula (Open Q1)."))),
        Card("Expenses (this year)", ugx(k.expenses.value), "", () => drill("Expenses", k.expenses.definition, tableFromReport(R.incomeExpenses(st.db, { year: Number(today().slice(0, 4)) })))),
        Card("Members", String(k.members.value), "Active", () => { st.view = "members"; render(); }),
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
      h("h2", { class: "sec" }, "Guarantors"), Table([{ label: "Guarantor", render: (g) => nameOf(g.guarantorId) }, { label: "Amount", num: 1, render: (g) => num(g.amount) }, { label: "Status", key: "status" }], (st.db.guarantees || []).filter((g) => g.loanId === id)),
      h("h2", { class: "sec" }, "Interest history"), Table([{ label: "Date", key: "date" }, { label: "From", num: 1, render: (x) => x.previousAmount == null ? "—" : num(x.previousAmount) }, { label: "To", num: 1, render: (x) => num(x.newAmount) }, { label: "Reason", key: "reason" }], v.interestHistory),
      h("h2", { class: "sec" }, "Repayments"), Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Amount", num: 1, render: (t) => num(t.amount) }], L.activeTransactions(st.db).filter((t) => t.loanId === id && t.type === "Loan Repayment")));
    const row = h("div", { class: "row" }); const M = () => document.querySelector(".modal-bg");
    const add = (label, cond, fn, cls) => cond && row.append(h("button", { class: cls || "", "data-act": label, onclick: fn }, label));
    add("Add guarantor", G.can(c, "guarantee.manage") && ["Pending", "Approved"].includes(loan.status) && !LN.loanCover(st.db, id), () => Form("Add guarantor (one per loan, covers the full " + ugx(loan.loanAmount) + ")", [{ name: "g", label: "Guarantor", options: st.db.members.filter((m) => m.id !== loan.memberId).map((m) => ({ value: m.id, label: m.name + " — available " + num(LN.guarantorAvailable(st.db, m.id)) })) }], act(async (f) => { await commit("addGuarantee", { loanId: id, guarantorId: f.g }); M().remove(); openLoan(id); }, "Guarantee added")));
    add("Replace guarantor", G.can(c, "guarantee.manage") && ["Pending", "Approved"].includes(loan.status) && LN.loanCover(st.db, id) > 0, () => Form("Release guarantor", [{ name: "reason", label: "Reason (required)" }], act(async (f) => { await commit("releaseGuarantor", { loanId: id, reason: f.reason }); M().remove(); openLoan(id); }, "Guarantor released")));
    add("Approve", G.can(c, "loan.review") && loan.status === "Pending", act(async () => { await commit("approveLoan", { loanId: id }); M().remove(); openLoan(id); }, "Loan approved"), "primary");
    add("Decline", G.can(c, "loan.review") && ["Pending", "Approved"].includes(loan.status), () => Form("Decline loan", [{ name: "reason", label: "Reason" }], act(async (f) => { await commit("declineLoan", { loanId: id, reason: f.reason }); M().remove(); }, "Loan declined")));
    add("Disburse", G.can(c, "loan.disburse") && loan.status === "Approved", () => Form("Disburse loan", [{ name: "rate", label: "Assigned monthly interest (UGX) — required", type: "number" }, { name: "grace", label: "Grace months", type: "number", value: 3 }, { name: "date", label: "Date (YYYY-MM-DD)", value: today() }], act(async (f) => { await commit("disburseLoan", { loanId: id, assignedMonthlyInterest: f.rate, graceMonths: f.grace, date: f.date }); M().remove(); openLoan(id); }, "Loan disbursed")), "primary");
    add("Record repayment", G.can(c, "loan.repay") && loan.status === "Active", () => Form("Record repayment", [{ name: "amount", label: "Amount (UGX)", type: "number" }, { name: "date", label: "Date", value: today() }], act(async (f) => { await commit("repayLoan", { loanId: id, amount: f.amount, date: f.date }); M().remove(); openLoan(id); }, "Repayment recorded")), "primary");
    add("Change interest", G.can(c, "loan.editInterest") && loan.status === "Active", () => Form("Change assigned interest", [{ name: "amt", label: "New monthly interest (UGX)", type: "number", value: v.assignedMonthlyInterest }, { name: "reason", label: "Reason (required)" }], act(async (f) => { await commit("editAssignedInterest", { loanId: id, amount: f.amt, reason: f.reason }); M().remove(); openLoan(id); }, "Interest updated and audited")));
    add(loan.voided ? "Restore loan" : "Void loan", G.can(c, loan.voided ? "loan.reverse" : "loan.reverse"), () => Form(loan.voided ? "Restore loan" : "Void loan", [{ name: "reason", label: "Reason (required)" }], act(async (f) => { await commit(loan.voided ? "restoreLoan" : "voidLoan", { loanId: id, reason: f.reason }); M().remove(); }, "Done")), "danger");
    b.append(row); Modal("Loan " + id, b);
  }
  function loans() {
    return h("div", null, h("div", { class: "row" }, G.can(ctx(), "loan.apply") || isStaff() ? h("button", { class: "primary", id: "new-loan", onclick: () => Form("New loan application", [{ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) }, { name: "amt", label: "Amount (UGX)", type: "number" }], act(async (f) => commit("applyForLoan", { memberId: f.m, amount: f.amt }), "Application recorded")) }, "New application") : null),
      Table(loanCols, K.loanBook(st.db, today()), (v) => openLoan(v.id)), h("p", { class: "mute" }, "Approval of any loan is blocked until SOB defines qualifying savings (the 3× limit basis). Each loan needs one guarantor with enough available savings."));
  }

  /* ---------- ledger ---------- */
  function ledger() {
    const rows = st.db.transactions.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 200);
    return h("div", null, h("div", { class: "row" }, G.can(ctx(), "ledger.create") ? h("button", { class: "primary", id: "add-entry", onclick: () => Form("New ledger entry", [{ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) }, { name: "type", label: "Type", options: ["Savings", "Withdraw", "Expense", "Income", "Profit", "Bank Charge"] }, { name: "amount", label: "Amount (UGX)", type: "number" }, { name: "date", label: "Date (YYYY-MM-DD)", value: today() }, { name: "purpose", label: "Purpose" }], act(async (f) => commit("createEntry", { memberId: f.m, type: f.type, amount: f.amount, date: f.date, purpose: f.purpose }), "Entry recorded")) }, "New entry") : null),
      Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Member", render: (t) => nameOf(t.memberId) }, { label: "Type", key: "type" }, { label: "Amount", num: 1, render: (t) => num(t.amount) }, { label: "State", render: (t) => t.voided ? badge("Voided", "bad") : badge("Counted", "ok") }], rows, (t) => openEntry(t.id)));
  }
  function openEntry(id) {
    const t = st.db.transactions.find((x) => x.id === id), c = ctx(), row = h("div", { class: "row" });
    const perm = t.voided ? "ledger.restore" : "ledger.void";
    if (G.can(c, perm)) row.append(h("button", { class: "danger", "data-act": "void", onclick: () => Form(t.voided ? "Restore entry" : "Void entry", [{ name: "reason", label: "Reason (required)" }], act(async (f) => { await commit(t.voided ? "restoreEntry" : "voidEntry", { id, reason: f.reason }); document.querySelector(".modal-bg").remove(); }, "Done")) }, t.voided ? "Restore" : "Void"));
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
    return h("div", null, h("div", { class: "blocked" }, "Profit distribution is blocked until SOB approves the formula. Every member withdraws their full savings, including members with a loan; members with an outstanding loan are not eligible for profit."),
      h("div", { class: "grid" }, Card("Savings to withdraw in full", ugx(p.totals.withdrawable)), Card("Of which loan-holders", ugx(p.totals.withdrawableByLoanHolders), "Loans stay payable"), Card("Guarantors withdrawing", String(p.totals.guaranteesAtRisk), "Live guarantees may lose cover"), Card("Profit-eligible members", String(p.totals.eligibleMembers)), Card("Excluded (outstanding loan)", String(p.totals.excludedMembers))),
      Table([{ label: "Member", key: "name" }, { label: "Savings", num: 1, render: (r) => num(r.savings) }, { label: "Loan owed", num: 1, render: (r) => num(r.outstandingLoan) }, { label: "Savings action", key: "savingsAction" }, { label: "Profit", key: "profit" }], p.rows, (r) => openMember(r.memberId)),
      done ? h("p", { class: "mute" }, "Share-out for " + y + " executed on " + D.toDisplay(done.date) + ".") : G.can(ctx(), "shareout.execute") ? h("div", { class: "row" }, h("button", { class: "danger", id: "exec-shareout", onclick: act(async () => { if (!confirm("Execute the " + y + " share-out? This closes the year.")) return; await commit("executeShareOut", { year: y }); }, "Share-out executed") }, "Execute share-out")) : null);
  }
  const REPORTS = { "Savings by member": () => R.savings(st.db), "Loan book": () => R.loans(st.db, today()), "Loan repayments": () => R.repayments(st.db, null), "Guarantor exposure": () => R.guarantors(st.db), "Subscriptions": () => R.subscriptions(st.db, today().slice(0, 4)), "Income & expenses": () => R.incomeExpenses(st.db, null), "December share-out": () => R.shareOut(st.db, today().slice(0, 4), today()), "Airtime requests": () => R.airtime(st.db), "Notification log": () => R.notificationLog(st.db), "Reconciliation register": () => R.reconciliationRegister(st.db), "Annual summary": () => R.annualSummary(st.db, today().slice(0, 4)), "Interest vs principal received": () => R.repaymentAllocation(st.db), "Quarterly distribution": () => R.quarterlyDistribution(st.db, { year: Number(today().slice(0, 4)), quarter: 1 }) };
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
      h("div", { class: "grid" }, Card("My Savings", ugx(sav), "Tap for statement", () => { st.view = "savings"; render(); }), Card("My Loan Balance", ugx(bal), loans.length ? "Tap for details" : "No loan", () => { st.view = "myloans"; render(); }), Card("Guarantee committed", ugx(LN.committed(st.db, id)), "For other members' loans"),
      Card("SMS/WhatsApp notices", (st.db.members.find((m) => m.id === id) || {}).notifyOptOut ? "Off" : "On", "Tap to switch", () => { const off = !!(st.db.members.find((m) => m.id === id) || {}).notifyOptOut; act(async () => commit("setNotifyOptOut", { memberId: id, optOut: !off }), off ? "Notices switched on" : "Notices switched off")(); })));
  }
  function mySavings() {
    const rep = R.memberStatement(st.db, me());
    return h("div", null, h("div", { class: "grid" }, Card("Current savings", ugx(L.memberSavings(st.db, me())), "Lifetime balance — never reset at share-out")), h("h2", { class: "sec" }, "Statement"), tableFromReport(rep));
  }
  function myLoans() {
    const mine = K.loanBook(st.db, today()).filter((v) => st.db.loans.find((l) => l.id === v.id).memberId === me());
    return h("div", null, h("div", { class: "row" }, h("button", { class: "primary", id: "apply", onclick: () => Form("Apply for a loan", [{ name: "amt", label: "Amount (UGX)", type: "number" }], act(async (f) => commit("applyForLoan", { memberId: me(), amount: f.amt }), "Application sent")) }, "Apply for a loan")),
      Table(loanCols.filter((c) => c.label !== "Member"), mine, (v) => openLoan(v.id)), h("p", { class: "mute" }, "Interest is assigned by the Admin for each loan and recalculated monthly until the loan is settled."));
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
  const VIEWS = { airtime, messages, system, dash: dashboard, members, loans, ledger, subs, shareout, reports, recon, audit, home, savings: mySavings, myloans: myLoans };

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
