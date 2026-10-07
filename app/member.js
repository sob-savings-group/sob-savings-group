/* SOB member experience — phone-first. Everything a member sees is derived from the member's own slice of the ledger (the server never sends more).
   Colours always mean the same thing: green = available, amber = held for guarantees, coral = loan owed, blue = interest, teal = profit. */
window.SOBMember = function (E) {
  const { h, ugx, num, badge, Table, Modal, Form, toast, Icon, fdate, pct, Hero, StackBar, Progress, Section, Row, List, Empty, Banner, Chips, Confirm, Field } = window.SOBUI;
  const { st, act, commit, render, today, printReport, go } = E, S = window.SOB, L = S.ledger, LN = S.loans, R = S.reports, D = S.dates;
  const me = () => st.user.memberId, myName = () => (st.db.members.find((m) => m.id === me()) || {}).name || st.user.name;
  const help = () => S.reports.OFFICERS.filter((o) => ["Treasurer", "Secretary"].includes(o[1]));

  const TYPE = { Savings: ["Savings deposit", "up", "avail"], Withdraw: ["Withdrawal", "down", "loan"], Profit: ["Profit share", "gift", "profit"], "Loan Disbursement": ["Loan paid out", "loan", "loan"], "Loan Repayment": ["Loan repayment", "loan", "interest"], Subscription: ["Annual subscription", "receipt", ""], "Share-Out": ["December share-out", "gift", "commit"], "Bank Charge": ["Bank charge", "down", "loan"], Penalty: ["Penalty", "alert", "loan"] };
  const typeInfo = (t) => TYPE[t] || [t, "book", ""];
  const LOAN_STATUS = { Pending: ["Under review", "warn"], AwaitingApproval: ["Awaiting Chairperson approval", "warn"], Approved: ["Approved — awaiting payout", "ok"], Active: ["Active", "ok"], Cleared: ["Fully repaid", "mute"], Declined: ["Declined", "bad"] };
  const myLoans = () => (st.db.loans || []).filter((l) => l.memberId === me() && !l.voided).sort((a, b) => ((a.applicationDate || a.date || "") < (b.applicationDate || b.date || "") ? 1 : -1));
  const history = () => L.memberLifetimeHistory(st.db, me()).slice().reverse();
  const first = () => String(myName() || "").split(/\s+/)[0];
  const viewOnly = () => !!st.user.readOnly;

  /* ---------- shared pieces ---------- */
  function txnRow(t, onOpen) {
    const [label, icon, tone] = typeInfo(t.type), eff = L.classifyTransaction(t).savings;
    return Row({ icon, tone, title: label, sub: fdate(t.date) + (t.purpose && t.purpose !== t.type ? " · " + t.purpose : ""),
      right: eff ? (eff > 0 ? "+" : "−") + num(Math.abs(eff)) : num(t.amount), rtone: eff > 0 ? "pos" : eff < 0 ? "neg" : "", rightSub: eff ? "Balance " + num(t.runningSavings) : "Not part of savings", onOpen: () => onOpen(t) });
  }
  function txnDetail(t) {
    const [label] = typeInfo(t.type), eff = L.classifyTransaction(t).savings;
    Modal(label, h("div", null, Field("Date", fdate(t.date)), Field("Amount", ugx(t.amount)), t.purpose && t.purpose !== t.type ? Field("Details", t.purpose) : null, t.receipt ? Field("Receipt", t.receipt) : null,
      Field("Effect on your savings", eff ? (eff > 0 ? "+ " : "− ") + ugx(Math.abs(eff)) : "None"), t.runningSavings != null ? Field("Savings after this", ugx(t.runningSavings)) : null,
      t.createdAt ? Field("Recorded", fdate(String(t.createdAt).slice(0, 10)) + (t.createdBy ? " by " + t.createdBy : "")) : null,
      t.approvalStatus && t.approvalStatus !== "Approved" ? h("p", { class: "mute" }, "Status: " + t.approvalStatus) : null,
      h("p", { class: "mute" }, "Something not right? Please contact " + help().map((o) => o[0] + " " + o[2]).join(" or ") + ".")));
  }
  const grouped = (rows) => { const out = []; let cur = ""; rows.forEach((t) => { const m = t.date.slice(0, 7); if (m !== cur) { cur = m; out.push(h("div", { class: "month" }, fdate(m + "-01").replace(/^1 /, ""))); } out.push(txnRow(t, txnDetail)); }); return out; };
  const waShare = (text) => { if (navigator.share) { navigator.share({ title: "SOB statement", text }).catch(() => {}); } else window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener"); };
  function statementText() {
    const p = L.memberPosition(st.db, me()), last = history().slice(0, 5);
    return ["*Sons of Bethel (SOB) Savings Group*", "Statement for " + myName() + " (" + me() + ")", "As at " + fdate(today()), "", "Total savings: " + ugx(p.savings), "Held for guarantees: " + ugx(p.committed), "Available: " + ugx(p.available), "", "Latest activity:"]
      .concat(last.map((t) => "• " + fdate(t.date) + " " + typeInfo(t.type)[0] + " " + num(t.amount))).concat(["", "Issued from the SOB platform."]).join("\n");
  }
  const statementButtons = () => h("div", { class: "row" }, h("button", { class: "primary", id: "print-statement", "data-print": 1, onclick: () => printReport(R.memberStatementPrint(st.db, me(), { year: null }), "Lifetime statement to " + fdate(today())) }, Icon("download", 18), " Statement (PDF)"), h("button", { id: "share-statement", onclick: () => waShare(statementText()) }, Icon("share", 18), " Share on WhatsApp"));
  const loanSummary = (loan) => { const v = LN.loanView(st.db, loan, today()), w = L.loanInterestPosition(loan, st.db, today()); return { v, w, paid: pct(w.principalPaid, v.principal) }; };
  const signInfo = () => (viewOnly() ? Banner("info", "You signed in with your name, so you can view your balances and statements. To request a loan, accept a guarantee or change your PIN, sign in with your PIN.", { label: "Sign in with PIN", onclick: async () => { await st.store.logout(); st.user = null; st.view = null; render(); } }) : null);

  /* ---------- HOME ---------- */
  function home() {
    const id = me(), pos = L.memberPosition(st.db, id), loans = myLoans(), active = loans.find((l) => l.status === "Active"), pend = loans.find((l) => ["Pending", "AwaitingApproval", "Approved"].includes(l.status));
    const reqs = (st.db.guarantees || []).filter((g) => g.guarantorId === id && g.status === "Requested");
    const year = today().slice(0, 4), paidSub = (st.db.transactions || []).some((t) => t.memberId === id && t.type === "Subscription" && !t.voided && (Number(t.forYear) === Number(year) || (!t.forYear && t.date.slice(0, 4) === year)));
    const el = h("div", null, signInfo());
    if (reqs.length) el.append(Banner("warn", reqs.length === 1 ? "Someone has asked you to guarantee a loan." : reqs.length + " people have asked you to guarantee a loan.", { label: "Review", onclick: () => go("myguar") }));
    if (!paidSub) el.append(Banner("info", "Your " + year + " annual subscription is not recorded yet. Please see the Treasurer.", { label: "Details", onclick: () => go("mysubs") }));
    el.append(Hero({ hook: "My Savings", label: "Hello " + first() + " — your total savings", value: ugx(pos.savings), sub: "Your lifetime savings with SOB", children: h("div", null, StackBar([{ label: "Available to you", value: pos.available, cls: "c-avail" }, { label: "Held for loans you guarantee", value: pos.committed, cls: "c-commit" }]),
      h("div", { class: "mini-grid" }, h("div", { class: "mini" }, h("div", { class: "ml" }, "You can withdraw"), h("div", { class: "mv t-avail" }, ugx(pos.withdrawable))), h("div", { class: "mini" }, h("div", { class: "ml" }, "Held for guarantees"), h("div", { class: "mv t-commit" }, ugx(pos.committed))))) }));
    /* My loan */
    if (active) {
      const { v, w, paid } = loanSummary(active);
      el.append(Section("My loan"), h("div", { class: "card click", "data-card": "My Loan Balance", role: "button", tabindex: 0, onclick: () => go("myloans") }, h("div", { class: "lbl" }, "You owe"), h("div", { class: "val t-loan" }, ugx(v.balance)),
        Progress(paid, "c-avail", "Principal repaid"), h("div", { class: "sub" }, paid + "% of the loan repaid · principal left " + ugx(w.principalOutstanding)),
        h("div", { class: "mini-grid" }, h("div", { class: "mini" }, h("div", { class: "ml" }, "Interest due now"), h("div", { class: "mv t-interest" }, ugx(w.unpaidInterest))), h("div", { class: "mini" }, h("div", { class: "ml" }, "Monthly interest"), h("div", { class: "mv" }, ugx(v.assignedMonthlyInterest))))));
    } else if (pend) {
      const [lbl, kind] = LOAN_STATUS[pend.status];
      el.append(Section("My loan"), h("div", { class: "card click", "data-card": "My Loan Balance", role: "button", tabindex: 0, onclick: () => go("myloans") }, h("div", { class: "lbl" }, "Loan application · " + ugx(pend.loanAmount)), h("div", { style: "margin-top:8px" }, badge(lbl, kind)), h("div", { class: "sub" }, "Tap to follow its progress")));
    } else {
      const max = L.loanEligibility(st.db, id).maxLoan;
      el.append(Section("My loan"), h("div", { class: "card click", "data-card": "My Loan Balance", role: "button", tabindex: 0, onclick: () => go("myloans") }, h("div", { class: "lbl" }, "No loan right now"), h("div", { class: "sub" }, max > 0 ? "You can normally borrow up to " + ugx(max) + " (3 × your savings)." : "Save regularly to qualify for a loan."), viewOnly() ? null : h("div", { class: "row" }, h("button", { class: "primary", id: "home-apply", onclick: (e) => { e.stopPropagation(); go("myloans"); applyForm(); } }, "Apply for a loan"))));
    }
    /* Guarantees summary */
    const given = (st.db.guarantees || []).filter((g) => g.guarantorId === id && g.status === "Active");
    if (given.length) el.append(Section("Loans I guarantee"), List([Row({ icon: "shield", tone: "commit", title: given.length + (given.length === 1 ? " active guarantee" : " active guarantees"), sub: "Held until the borrowers repay", right: ugx(pos.committed), onOpen: () => go("myguar") })]));
    /* Shortcuts */
    el.append(Section("Quick actions"), h("div", { class: "grid" }, quick("print", "Statement (PDF)", "Print or save", () => printReport(R.memberStatementPrint(st.db, me(), {}), "Lifetime statement to " + fdate(today()))), quick("share", "Share on WhatsApp", "Send your balance", () => waShare(statementText())), quick("phone", "Airtime", "Request airtime", () => go("airtime")), quick("gift", "Share-out & profit", "What December pays", () => go("myshare"))));
    /* Recent activity */
    const recent = history().slice(0, 5);
    el.append(Section("Recent activity", h("button", { class: "iconbtn", "aria-label": "See all", onclick: () => go("savings") }, Icon("chevron"))), recent.length ? List(recent.map((t) => txnRow(t, txnDetail))) : Empty({ icon: "wallet", title: "No activity yet", text: "Your savings and payments will appear here as they are recorded." }));
    el.append(h("p", { class: "mute", style: "font-size:13px;margin-top:20px" }, "Need help? " + help().map((o) => o[0] + " " + o[2]).join(" · ")));
    return el;
  }
  const quick = (icon, title, sub, fn) => h("div", { class: "card click", role: "button", tabindex: 0, onclick: fn, onkeydown: (e) => { if (e.key === "Enter") fn(); } }, h("div", { class: "lic", style: "margin-bottom:8px" }, Icon(icon)), h("div", { style: "font-weight:700" }, title), h("div", { class: "sub" }, sub));

  /* ---------- SAVINGS ---------- */
  function savings() {
    const pos = L.memberPosition(st.db, me()), all = history();
    const f = st.savFilter || "all", sets = { all: () => true, dep: (t) => t.type === "Savings", wd: (t) => ["Withdraw", "Share-Out", "Bank Charge"].includes(t.type), loan: (t) => ["Loan Repayment", "Loan Disbursement"].includes(t.type), sub: (t) => t.type === "Subscription", profit: (t) => t.type === "Profit" };
    const rows = all.filter(sets[f] || sets.all), box = h("div", { id: "stmt-list" });
    const paint = () => { box.replaceChildren(rows.length ? List(grouped(rows)) : Empty({ icon: "book", title: "Nothing here yet", text: f === "all" ? "Your transactions will appear as they are recorded." : "No transactions of this kind." })); };
    paint();
    return h("div", null, signInfo(), Hero({ hook: "My Savings", label: "Total savings", value: ugx(pos.savings), sub: "Lifetime balance — never reset at share-out", children: StackBar([{ label: "Available", value: pos.available, cls: "c-avail" }, { label: "Held for guarantees", value: pos.committed, cls: "c-commit" }]) }), statementButtons(),
      Section("Statement"), Chips([["all", "All"], ["dep", "Savings"], ["wd", "Withdrawals"], ["loan", "Loan"], ["sub", "Subscription"], ["profit", "Profit"]], f, (k) => { st.savFilter = k; render(); }), box);
  }

  /* ---------- LOANS ---------- */
  function applyForm() {
    const p = L.memberPosition(st.db, me()), el = L.loanEligibility(st.db, me());
    Form("Apply for a loan", [{ type: "note", text: "Your savings are " + ugx(p.savings) + ". You can normally borrow up to " + ugx(el.maxLoan) + " (3 × your savings). If you ask for more, guarantors who have savings can back the difference — the Admin will arrange this with you." }, { name: "amt", label: "How much do you need? (UGX)", type: "number", inputmode: "numeric", min: 1 }],
      act(async (f) => { if (!(Number(f.amt) > 0)) throw new Error("Enter the amount you need"); await commit("applyForLoan", { memberId: me(), amount: Number(f.amt) }); }, "Application sent. We will update you here."), "Send application");
  }
  function loans() {
    const list = myLoans(), el = h("div", null, signInfo());
    el.append(viewOnly() ? null : h("div", { class: "row" }, h("button", { class: "primary", id: "apply", onclick: applyForm }, Icon("plus", 18), " Apply for a loan")));
    if (!list.length) { el.append(Empty({ icon: "loan", title: "No loans yet", text: "When you apply for a loan, you can follow every step here — approval, payout, repayments and interest." })); return el; }
    list.forEach((l) => {
      const [lbl, kind] = LOAN_STATUS[l.status] || [l.status, "mute"], live = ["Active", "Cleared"].includes(l.status), s = live ? loanSummary(l) : null;
      el.append(h("div", { class: "card click", style: "margin-bottom:12px", "data-loan": l.id, role: "button", tabindex: 0, onclick: () => loanDetail(l.id), onkeydown: (e) => { if (e.key === "Enter") loanDetail(l.id); } },
        h("div", { class: "row", style: "justify-content:space-between;align-items:center;margin:0" }, h("div", { class: "lbl" }, ugx(l.loanAmount) + " loan"), badge(lbl, kind)),
        live ? h("div", null, h("div", { class: "val t-loan" }, ugx(s.v.balance)), h("div", { class: "sub" }, l.status === "Cleared" ? "Fully repaid" : "You owe"), Progress(s.paid, "c-avail", "Principal repaid"), h("div", { class: "sub" }, s.paid + "% of the loan repaid")) : h("div", { class: "sub", style: "margin-top:8px" }, nextStep(l))));
    });
    el.append(h("p", { class: "mute", style: "font-size:13px" }, "Interest is set per loan by the Admin and grows monthly until the loan is repaid. Each repayment first clears interest owed, then reduces the loan."));
    return el;
  }
  const nextStep = (l) => ({ Pending: "The Admin is reviewing your application and any guarantors.", AwaitingApproval: "Reviewed. Waiting for the Chairperson's approval.", Approved: "Approved. The payout will be recorded by the Admin.", Declined: "This application was declined." + (l.declineReason ? " Reason: " + l.declineReason : "") }[l.status] || "");
  function loanDetail(id) {
    const loan = st.db.loans.find((l) => l.id === id), [lbl, kind] = LOAN_STATUS[loan.status] || [loan.status, "mute"], live = ["Active", "Cleared"].includes(loan.status), gs = (st.db.guarantees || []).filter((g) => g.loanId === id && g.status !== "Declined");
    const b = h("div", null, h("div", { class: "row", style: "margin:0 0 8px" }, badge(lbl, kind)));
    if (live) {
      const { v, w, paid } = loanSummary(loan);
      b.append(h("div", { class: "card" }, h("div", { class: "lbl" }, loan.status === "Cleared" ? "Fully repaid" : "You owe today"), h("div", { class: "val t-loan" }, ugx(v.balance)), Progress(paid, "c-avail", "Principal repaid"),
        Field("Loan amount", ugx(v.principal)), Field("Principal paid", ugx(w.principalPaid)), Field("Principal left", ugx(w.principalOutstanding)), Field("Interest charged so far", ugx(w.accruedInterest)), Field("Interest paid", ugx(w.interestPaid)), Field("Interest due now", ugx(w.unpaidInterest)), Field("Monthly interest", ugx(v.assignedMonthlyInterest)), Field("Paid out on", fdate(loan.date))));
      const steps = w.steps.slice().reverse();
      b.append(Section("Repayments"), steps.length ? List(steps.map((x) => Row({ icon: "loan", tone: "interest", title: ugx(x.amount), sub: fdate(x.date) + " · " + (x.interest ? ugx(x.interest) + " interest" : "no interest") + (x.principal ? " · " + ugx(x.principal) + " off the loan" : ""), right: x.principal ? "−" + num(x.principal) : "", rightSub: x.principal ? "off the loan" : "" }))) : Empty({ icon: "loan", title: "No repayments yet", text: "Repayments you make will show here, split into interest and loan." }));
    } else b.append(h("div", { class: "card" }, Field("Amount requested", ugx(loan.loanAmount)), Field("Applied on", fdate(loan.applicationDate)), h("p", { class: "mute" }, nextStep(loan))));
    if (gs.length) b.append(Section("Guarantors"), List(gs.map((g) => Row({ icon: "shield", tone: g.status === "Active" ? "commit" : "", title: (st.db.members.find((m) => m.id === g.guarantorId) || {}).name || g.guarantorId, sub: g.status === "Requested" ? "Asked — waiting for their answer" : g.status === "Active" ? "Backing " + ugx(L.guaranteeRemaining(g)) + " now" : "Released", right: ugx(g.amount), rightSub: g.releasedAmount ? "released " + num(g.releasedAmount) : "" }))));
    if (live) b.append(h("div", { class: "row" }, h("button", { class: "primary", "data-print": 1, onclick: () => printReport(R.loanMemberStatement(st.db, id, today()), "As at " + fdate(today())) }, Icon("download", 18), " Loan statement (PDF)")));
    Modal("Loan " + ugx(loan.loanAmount), b);
  }

  /* ---------- GUARANTEES ---------- */
  function guarantees() {
    const id = me(), all = (st.db.guarantees || []), reqs = all.filter((g) => g.guarantorId === id && g.status === "Requested"), given = all.filter((g) => g.guarantorId === id && !["Requested", "Declined"].includes(g.status)), pos = L.memberPosition(st.db, id);
    const loanOf = (g) => (st.db.loans || []).find((l) => l.id === g.loanId) || {}, who = (m) => (st.db.members.find((x) => x.id === m) || {}).name || m;
    const el = h("div", null, signInfo());
    if (reqs.length) {
      el.append(h("div", { id: "guarantee-requests" }, Section("Waiting for your answer"), h("p", { class: "mute" }, "If you accept, the amount is set aside from your savings straight away and cannot be withdrawn while the loan is unpaid. It comes back as the borrower repays the loan itself.")));
      reqs.forEach((g) => el.lastChild.append(h("div", { class: "card", style: "margin-bottom:12px" }, h("div", { class: "lbl" }, who(loanOf(g).memberId) + " asks you to guarantee"), h("div", { class: "val t-commit" }, ugx(g.amount)), h("div", { class: "sub" }, "On a loan of " + ugx(loanOf(g).loanAmount || 0) + " · you have " + ugx(pos.available) + " available"),
        viewOnly() ? h("p", { class: "mute" }, "Sign in with your PIN to answer.") : h("div", { class: "row" }, h("button", { class: "primary", "data-accept-guarantee": g.id, onclick: () => Confirm("Accept this guarantee?", ugx(g.amount) + " of your savings will be set aside until the loan is repaid.", "Yes, accept", act(async () => commit("acceptGuarantee", { id: g.id, evidence: "Accepted by the guarantor in the member portal" }), "Accepted — " + ugx(g.amount) + " is now set aside")) }, "Accept"),
          h("button", { class: "danger", "data-decline-guarantee": g.id, onclick: () => Form("Decline guarantee", [{ name: "reason", label: "Reason (optional)" }], act(async (f) => commit("declineGuarantee", { id: g.id, reason: f.reason }), "Declined"), "Decline") }, "Decline")))));
    }
    el.append(Hero({ label: "Held for loans you guarantee", value: ugx(pos.committed), sub: "Part of your savings, set aside until borrowers repay", cls: "", children: StackBar([{ label: "Available", value: pos.available, cls: "c-avail" }, { label: "Held", value: pos.committed, cls: "c-commit" }]) }));
    el.append(Section("Guarantees I have given"));
    el.append(given.length ? List(given.map((g) => Row({ icon: "shield", tone: g.status === "Active" ? "commit" : "", title: who(loanOf(g).memberId), sub: (g.status === "Active" ? "Still held " + ugx(L.guaranteeRemaining(g)) : "Fully released") + (g.releasedAmount ? " · released so far " + num(g.releasedAmount) : ""), right: ugx(g.amount), rightSub: "guaranteed", onOpen: () => Modal("Guarantee for " + who(loanOf(g).memberId), h("div", null, Field("You guaranteed", ugx(g.amount)), Field("Released back to you", ugx(g.releasedAmount || 0)), Field("Still held", ugx(g.status === "Active" ? L.guaranteeRemaining(g) : 0)), Field("Status", g.status), g.dateCommitted ? Field("Accepted on", fdate(g.dateCommitted)) : null, h("p", { class: "mute" }, "Your money is released as the borrower repays the loan itself — interest payments do not release it.")))}))) : Empty({ icon: "shield", title: "No guarantees", text: "When a member asks you to guarantee a loan, it will appear here for you to accept or decline." }));
    return el;
  }

  /* ---------- MORE / SUBSCRIPTIONS / SHARE-OUT ---------- */
  function more() {
    const m = st.db.members.find((x) => x.id === me()) || {}, off = !!m.notifyOptOut;
    return h("div", null, signInfo(), List([
      Row({ icon: "receipt", title: "Annual subscription", sub: "UGX 5,000 a year", onOpen: () => go("mysubs") }), Row({ icon: "gift", tone: "profit", title: "Share-out & profit", sub: "What December pays you", onOpen: () => go("myshare") }), Row({ icon: "phone", title: "Airtime", sub: "Request airtime from your savings", onOpen: () => go("airtime") }),
      viewOnly() ? null : Row({ icon: "bell", title: "SMS / WhatsApp notices", sub: off ? "Off — tap to switch on" : "On — tap to switch off", onOpen: act(async () => commit("setNotifyOptOut", { memberId: me(), optOut: !off }), off ? "Notices switched on" : "Notices switched off") }),
      viewOnly() || !st.live ? null : Row({ icon: "key", title: "Change my PIN", sub: "Keep it private", onOpen: () => document.getElementById("my-pin").click() })].filter(Boolean)),
      Section("Need help?"), List(help().map((o) => h("a", { class: "li click", href: "tel:" + o[2].replace(/\s/g, ""), style: "text-decoration:none;color:inherit" }, h("div", { class: "lic" }, Icon("phone")), h("div", { class: "lm" }, h("div", { class: "lt" }, o[0]), h("div", { class: "ls" }, o[1])), h("div", { class: "lr" }, h("b", null, o[2]))))));
  }
  function subs() {
    const year = today().slice(0, 4), mine = (st.db.transactions || []).filter((t) => t.memberId === me() && t.type === "Subscription" && !t.voided).sort((a, b) => (a.date < b.date ? 1 : -1));
    const paid = mine.some((t) => Number(t.forYear) === Number(year) || (!t.forYear && t.date.slice(0, 4) === year));
    return h("div", null, h("div", { class: "card" }, h("div", { class: "lbl" }, "Annual subscription " + year), h("div", { class: "val " + (paid ? "t-avail" : "t-commit") }, paid ? "Paid" : "Not yet paid"), h("div", { class: "sub" }, "UGX 5,000 a year. It is group income and is kept separate from your savings.")),
      paid ? null : Banner("info", "Please pay your subscription to the Treasurer: " + help()[0].join(" · ")), Section("Payment history"),
      mine.length ? List(mine.map((t) => Row({ icon: "receipt", title: "Subscription " + (t.forYear || t.date.slice(0, 4)), sub: "Paid " + fdate(t.date), right: ugx(t.amount) }))) : Empty({ icon: "receipt", title: "No subscription payments yet", text: "Your payments will show here once recorded." }));
  }
  function share() {
    const pos = L.memberPosition(st.db, me()), profits = history().filter((t) => t.type === "Profit"), outs = history().filter((t) => t.type === "Share-Out");
    return h("div", null, Hero({ label: "If the share-out were today", value: ugx(pos.available), sub: "This is what you would receive", children: h("div", null, StackBar([{ label: "You receive", value: pos.available, cls: "c-avail" }, { label: "Stays held for guarantees", value: pos.committed, cls: "c-commit" }]), h("div", { class: "mini-grid" }, h("div", { class: "mini" }, h("div", { class: "ml" }, "Total savings"), h("div", { class: "mv" }, ugx(pos.savings))), h("div", { class: "mini" }, h("div", { class: "ml" }, "Held"), h("div", { class: "mv t-commit" }, ugx(pos.committed))))) }),
      Banner("info", "Every member withdraws their savings in December, including members with a loan. Only the available part is paid; money held for guarantees stays until it is released."),
      Section("Profit I received"), profits.length ? List(profits.map((t) => txnRow(t, txnDetail))) : Empty({ icon: "gift", title: "No profit shared yet", text: "Profit is shared according to each member's eligible savings, once approved by the Chairperson." }),
      outs.length ? [Section("Past share-outs"), List(outs.map((t) => txnRow(t, txnDetail)))] : null);
  }
  return { home, savings, loans, guarantees, more, subs, share, applyForm };
};
