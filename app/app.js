(function () {
  const { h, ugx, num, badge, Card, Table, State, Modal, Form, toast, friendly } = window.SOBUI;
  const S = window.SOB, CFG = window.SOB_CONFIG || {}, D = S.dates, L = S.ledger, G = S.gov, LN = S.loans, C = S.cycle, K = S.kpis, R = S.reports;
  const app = document.getElementById("app");
  const st = { store: null, db: null, user: null, view: null, live: !!CFG.ledgerUrl, memberView: null };
  const today = () => D.todayISO();
  const ctx = () => G.makeCtx(st.user);
  const isStaff = () => st.user && st.user.role !== "Member";
  const nameOf = (id) => ((st.db.members.find((m) => m.id === id)) || {}).name || id;

  /* Every write goes through commit(): in live mode it persists to the Sheet (rolled back on conflict), in demo mode it stays in memory. */
  async function commit(fn) {
    try {
      const res = st.live ? await st.store.mutate(fn) : fn(st.db);
      st.db = st.live ? st.store.db : st.db; render(); return res;
    } catch (e) { throw e; }
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
      const pin = h("input", { type: "password", id: "pin", placeholder: "PIN" }), mid = h("input", { id: "mid", placeholder: "Member ID (leave blank for staff)" });
      box.append(h("label", null, "Member ID"), mid, h("label", null, "PIN"), pin, h("div", { class: "row" }, h("button", { class: "primary", onclick: async () => {
        try {
          const staff = !mid.value.trim();
          const r = await (await fetch(CFG.authUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ key: CFG.authKey, action: staff ? "checkStaffPin" : "checkPin", pin: pin.value, memberId: mid.value.trim() }) })).json();
          if (!r.ok) throw new Error(r.error || "Sign-in failed");
          if (staff) st.user = { id: r.matchedRole, name: r.matchedRole, role: CFG.staffRoleMap[r.matchedRole] || "Committee" };
          else { const m = st.db.members.find((x) => x.id === mid.value.trim().toUpperCase()); if (!m) throw new Error("Unknown member"); st.user = { id: m.id, name: m.name, role: "Member", memberId: m.id }; }
          st.view = null; render();
        } catch (e) { toast(friendly(e), true); }
      } }, "Sign in")));
    }
    return box;
  }

  /* ---------- navigation ---------- */
  const NAV_STAFF = [["dash", "Dashboard"], ["members", "Members"], ["loans", "Loans"], ["ledger", "Ledger"], ["subs", "Subscriptions"], ["shareout", "Share-Out"], ["reports", "Reports"], ["audit", "Audit"]];
  const NAV_MEMBER = [["home", "Home"], ["savings", "Savings & Statement"], ["myloans", "Loan & Interest"]];
  function render() {
    app.replaceChildren();
    if (!st.user) { app.append(loginScreen()); return; }
    const nav = isStaff() ? NAV_STAFF : NAV_MEMBER; st.view = st.view || nav[0][0];
    app.append(h("header", null, h("h1", null, "SOB " + (isStaff() ? "Admin" : "Member")), h("span", { class: "pill" }, st.live ? "LIVE" : "DEMO · DEV"), h("span", { class: "pill" }, st.user.role + " · " + st.user.name),
      h("button", { id: "logout", onclick: () => { st.user = null; st.view = null; render(); } }, "Sign out")),
      h("nav", null, nav.map(([k, l]) => h("button", { class: st.view === k ? "active" : "", "data-nav": k, onclick: () => { st.view = k; st.memberView = null; render(); } }, l))));
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
      h("h2", { class: "sec" }, "Loans"), Table(loanCols, K.loanBook(st.db, today()).filter((v) => loans.some((l) => l.id === v.id)), (v) => openLoan(v.id)),
      h("h2", { class: "sec" }, "Lifetime history"), Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Type", key: "type" }, { label: "Amount", num: 1, render: (t) => num(t.amount) }, { label: "Savings after", num: 1, render: (t) => num(t.runningSavings) }], hist.slice(0, 50))));
  }
  function members() {
    return h("div", null, h("div", { class: "row" }, G.can(ctx(), "member.manage") ? h("button", { class: "primary", id: "add-member", onclick: () => Form("Add member", [{ name: "name", label: "Full name" }, { name: "phone", label: "Phone" }], act(async (v) => commit((db) => G.addMember(db, ctx(), { name: v.name, phone: v.phone })), "Member added")) }, "Add member") : null),
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
    add("Add guarantor", G.can(c, "guarantee.manage") && ["Pending", "Approved"].includes(loan.status), () => Form("Add guarantor", [{ name: "g", label: "Guarantor", options: st.db.members.filter((m) => m.id !== loan.memberId).map((m) => ({ value: m.id, label: m.name })) }, { name: "amount", label: "Amount (UGX)", type: "number" }], act(async (f) => { await commit((db) => LN.addGuarantee(db, ctx(), id, f.g, f.amount)); M().remove(); openLoan(id); }, "Guarantee added")));
    add("Approve", G.can(c, "loan.review") && loan.status === "Pending", act(async () => { await commit((db) => LN.approveLoan(db, ctx(), id)); M().remove(); openLoan(id); }, "Loan approved"), "primary");
    add("Decline", G.can(c, "loan.review") && ["Pending", "Approved"].includes(loan.status), () => Form("Decline loan", [{ name: "reason", label: "Reason" }], act(async (f) => { await commit((db) => LN.declineLoan(db, ctx(), id, f.reason)); M().remove(); }, "Loan declined")));
    add("Disburse", G.can(c, "loan.disburse") && loan.status === "Approved", () => Form("Disburse loan", [{ name: "rate", label: "Assigned monthly interest (UGX) — required", type: "number" }, { name: "grace", label: "Grace months", type: "number", value: 3 }, { name: "date", label: "Date (YYYY-MM-DD)", value: today() }], act(async (f) => { await commit((db) => LN.disburseLoan(db, ctx(), id, { assignedMonthlyInterest: f.rate, graceMonths: f.grace, date: f.date })); M().remove(); openLoan(id); }, "Loan disbursed")), "primary");
    add("Record repayment", G.can(c, "loan.repay") && loan.status === "Active", () => Form("Record repayment", [{ name: "amount", label: "Amount (UGX)", type: "number" }, { name: "date", label: "Date", value: today() }], act(async (f) => { await commit((db) => LN.repayLoan(db, ctx(), id, f.amount, f.date)); M().remove(); openLoan(id); }, "Repayment recorded")), "primary");
    add("Change interest", G.can(c, "loan.editInterest") && loan.status === "Active", () => Form("Change assigned interest", [{ name: "amt", label: "New monthly interest (UGX)", type: "number", value: v.assignedMonthlyInterest }, { name: "reason", label: "Reason (required)" }], act(async (f) => { await commit((db) => LN.editAssignedInterest(db, ctx(), id, f.amt, f.reason)); M().remove(); openLoan(id); }, "Interest updated and audited")));
    add(loan.voided ? "Restore loan" : "Void loan", G.can(c, loan.voided ? "loan.reverse" : "loan.reverse"), () => Form(loan.voided ? "Restore loan" : "Void loan", [{ name: "reason", label: "Reason (required)" }], act(async (f) => { await commit((db) => (loan.voided ? LN.restoreLoan : LN.voidLoan)(db, ctx(), id, f.reason)); M().remove(); }, "Done")), "danger");
    b.append(row); Modal("Loan " + id, b);
  }
  function loans() {
    return h("div", null, h("div", { class: "row" }, G.can(ctx(), "loan.apply") || isStaff() ? h("button", { class: "primary", id: "new-loan", onclick: () => Form("New loan application", [{ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) }, { name: "amt", label: "Amount (UGX)", type: "number" }], act(async (f) => commit((db) => LN.applyForLoan(db, ctx(), f.m, f.amt)), "Application recorded")) }, "New application") : null),
      Table(loanCols, K.loanBook(st.db, today()), (v) => openLoan(v.id)), h("p", { class: "mute" }, "Approval of any loan is blocked until SOB defines qualifying savings and guarantor sufficiency (Open Q2, Q3)."));
  }

  /* ---------- ledger ---------- */
  function ledger() {
    const rows = st.db.transactions.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 200);
    return h("div", null, h("div", { class: "row" }, G.can(ctx(), "ledger.create") ? h("button", { class: "primary", id: "add-entry", onclick: () => Form("New ledger entry", [{ name: "m", label: "Member", options: st.db.members.map((m) => ({ value: m.id, label: m.name })) }, { name: "type", label: "Type", options: ["Savings", "Withdraw", "Expense", "Income", "Profit", "Bank Charge"] }, { name: "amount", label: "Amount (UGX)", type: "number" }, { name: "date", label: "Date (YYYY-MM-DD)", value: today() }, { name: "purpose", label: "Purpose" }], act(async (f) => commit((db) => G.createEntry(db, ctx(), { memberId: f.m, type: f.type, amount: f.amount, date: f.date, purpose: f.purpose })), "Entry recorded")) }, "New entry") : null),
      Table([{ label: "Date", render: (t) => D.toDisplay(t.date) }, { label: "Member", render: (t) => nameOf(t.memberId) }, { label: "Type", key: "type" }, { label: "Amount", num: 1, render: (t) => num(t.amount) }, { label: "State", render: (t) => t.voided ? badge("Voided", "bad") : badge("Counted", "ok") }], rows, (t) => openEntry(t.id)));
  }
  function openEntry(id) {
    const t = st.db.transactions.find((x) => x.id === id), c = ctx(), row = h("div", { class: "row" });
    const fn = t.voided ? G.restoreEntry : G.voidEntry, perm = t.voided ? "ledger.restore" : "ledger.void";
    if (G.can(c, perm)) row.append(h("button", { class: "danger", "data-act": "void", onclick: () => Form(t.voided ? "Restore entry" : "Void entry", [{ name: "reason", label: "Reason (required)" }], act(async (f) => { await commit((db) => fn(db, ctx(), id, f.reason)); document.querySelector(".modal-bg").remove(); }, "Done")) }, t.voided ? "Restore" : "Void"));
    const aud = (st.db.auditLog || []).filter((a) => a.entityId === id);
    drill("Entry " + id, null, h("div", null, h("p", null, nameOf(t.memberId), " · ", t.type, " · ", ugx(t.amount), " · ", D.toDisplay(t.date)), t.voided ? h("p", { class: "err" }, "Voided: " + (t.voidReason || "")) : null, row, h("h2", { class: "sec" }, "Audit trail"), Table([{ label: "When", key: "date" }, { label: "Action", key: "action" }, { label: "By", key: "by" }, { label: "Reason", key: "reason" }], aud)));
  }

  /* ---------- subscriptions, share-out, reports, audit ---------- */
  function subs() {
    const y = today().slice(0, 4), c = C.subscriptionCompliance(st.db, y);
    return h("div", null, h("div", { class: "grid" }, Card("Collected", ugx(c.collected), "of " + ugx(c.expected)), Card("Paid", String(c.paid.length)), Card("Unpaid", String(c.unpaid.length))),
      Table([{ label: "Member", render: (m) => m.name }, { label: "Status", render: (m) => c.paid.includes(m.id) ? badge("Paid", "ok") : badge("Unpaid", "bad") }, { label: "", render: (m) => !c.paid.includes(m.id) && G.can(ctx(), "subscription.record") ? h("button", { "data-sub": m.id, onclick: (e) => { e.stopPropagation(); act(async () => commit((db) => C.recordSubscription(db, ctx(), m.id, y)), "Recorded UGX 5,000")(); } }, "Record UGX 5,000") : null }], st.db.members.filter((m) => m.status !== "Inactive")));
  }
  function shareout() {
    const y = Number(today().slice(0, 4)), p = C.previewShareOut(st.db, y, today());
    const done = (st.db.shareOutEvents || []).find((e) => e.year === y);
    return h("div", null, h("div", { class: "blocked" }, "Profit distribution is blocked until SOB approves the formula (Open Q1). Loan-holders' savings are held until SOB decides their treatment."),
      h("div", { class: "grid" }, Card("Savings to withdraw in full", ugx(p.totals.withdrawable)), Card("Held back (loan-holders)", ugx(p.totals.heldBack)), Card("Profit-eligible members", String(p.totals.eligibleMembers)), Card("Excluded (outstanding loan)", String(p.totals.excludedMembers))),
      Table([{ label: "Member", key: "name" }, { label: "Savings", num: 1, render: (r) => num(r.savings) }, { label: "Loan owed", num: 1, render: (r) => num(r.outstandingLoan) }, { label: "Savings action", key: "savingsAction" }, { label: "Profit", key: "profit" }], p.rows, (r) => openMember(r.memberId)),
      done ? h("p", { class: "mute" }, "Share-out for " + y + " executed on " + D.toDisplay(done.date) + ".") : G.can(ctx(), "shareout.execute") ? h("div", { class: "row" }, h("button", { class: "danger", id: "exec-shareout", onclick: act(async () => { if (!confirm("Execute the " + y + " share-out? This closes the year.")) return; await commit((db) => C.executeShareOut(db, ctx(), y, {})); }, "Share-out executed") }, "Execute share-out")) : null);
  }
  const REPORTS = { "Savings by member": () => R.savings(st.db), "Loan book": () => R.loans(st.db, today()), "Loan repayments": () => R.repayments(st.db, null), "Guarantor exposure": () => R.guarantors(st.db), "Subscriptions": () => R.subscriptions(st.db, today().slice(0, 4)), "Income & expenses": () => R.incomeExpenses(st.db, null), "December share-out": () => R.shareOut(st.db, today().slice(0, 4), today()), "Annual summary": () => R.annualSummary(st.db, today().slice(0, 4)), "Quarterly distribution": () => R.quarterlyDistribution(st.db, { year: Number(today().slice(0, 4)), quarter: 1 }) };
  function reports() {
    return h("div", { class: "grid" }, Object.keys(REPORTS).map((n) => Card(n, "Open", "", () => {
      const rep = REPORTS[n](); if (rep.blocked) { drill(n, null, h("div", { class: "blocked" }, "Blocked: " + rep.reason)); return; }
      const dl = (name, type, data) => { const a = h("a", { href: URL.createObjectURL(new Blob([data], { type })), download: name }); document.body.append(a); a.click(); a.remove(); };
      drill(rep.title, null, h("div", null, h("div", { class: "row" }, h("button", { "data-csv": 1, onclick: () => dl(n.replace(/\W+/g, "_") + ".csv", "text/csv", R.toCSV(rep)) }, "Download CSV"), h("button", { "data-print": 1, onclick: () => { const w = window.open("", "_blank"); w.document.write(R.toPrintHTML(rep, { generated: D.toDisplay(today()) })); w.document.close(); w.print(); } }, "Print / PDF")), tableFromReport(rep), h("pre", { class: "mute" }, JSON.stringify(rep.totals))));
    })));
  }
  function audit() { return Table([{ label: "When", key: "date" }, { label: "Entity", render: (a) => a.entityType + " " + a.entityId }, { label: "Action", key: "action" }, { label: "By", key: "by" }, { label: "Reason", key: "reason" }], (st.db.auditLog || []).slice().reverse().slice(0, 200)); }

  /* ---------- member portal ---------- */
  const me = () => st.user.memberId;
  function home() {
    const id = me(), sav = L.memberSavings(st.db, id), loans = K.loanBook(st.db, today()).filter((v) => st.db.loans.find((l) => l.id === v.id).memberId === id);
    const bal = loans.reduce((a, v) => a + Math.max(0, v.balance), 0);
    return h("div", null, h("h2", { class: "sec", style: "margin-top:0" }, "Welcome, " + st.user.name),
      h("div", { class: "grid" }, Card("My Savings", ugx(sav), "Tap for statement", () => { st.view = "savings"; render(); }), Card("My Loan Balance", ugx(bal), loans.length ? "Tap for details" : "No loan", () => { st.view = "myloans"; render(); }), Card("Guarantee committed", ugx(LN.committed(st.db, id)), "For other members' loans")));
  }
  function mySavings() {
    const rep = R.memberStatement(st.db, me());
    return h("div", null, h("div", { class: "grid" }, Card("Current savings", ugx(L.memberSavings(st.db, me())), "Lifetime balance — never reset at share-out")), h("h2", { class: "sec" }, "Statement"), tableFromReport(rep));
  }
  function myLoans() {
    const mine = K.loanBook(st.db, today()).filter((v) => st.db.loans.find((l) => l.id === v.id).memberId === me());
    return h("div", null, h("div", { class: "row" }, h("button", { class: "primary", id: "apply", onclick: () => Form("Apply for a loan", [{ name: "amt", label: "Amount (UGX)", type: "number" }], act(async (f) => commit((db) => LN.applyForLoan(db, ctx(), me(), f.amt)), "Application sent")) }, "Apply for a loan")),
      Table(loanCols.filter((c) => c.label !== "Member"), mine, (v) => openLoan(v.id)), h("p", { class: "mute" }, "Interest is assigned by the Admin for each loan and recalculated monthly until the loan is settled."));
  }
  const VIEWS = { dash: dashboard, members, loans, ledger, subs, shareout, reports, audit, home, savings: mySavings, myloans: myLoans };

  /* ---------- boot ---------- */
  async function boot() {
    app.append(State("loading"));
    try {
      if (st.live) { st.store = S.client.create({ url: CFG.ledgerUrl, key: CFG.ledgerKey, fetch: window.fetch.bind(window), storage: window.localStorage }); await st.store.load(); st.db = st.store.db; }
      else { const raw = await (await fetch("demo-seed.json")).json(); st.db = S.migrate.migrateLegacy(raw, today()); }
      window.__SOB = st; render();
    } catch (e) { app.replaceChildren(State("error", "Could not load data: " + friendly(e))); }
  }
  boot();
})();
