/* SOB app/smartsearch — the search overlay: opens from the magnifier on every screen (or "/" or Ctrl+K), shows results while you type, grouped, highlighted, with filters,
   recent searches, "did you mean" help, keyboard and touch use. The matching itself is core/search (pure, tested); this file only draws it and takes you to the result. */
window.SOBSmartSearch = function (E) {
  const { st, go, isStaff, screens, reports, nameOf, openMember, openLoan, today } = E, { h, Icon, Modal } = window.SOBUI, SR = window.SOB.search, D = window.SOB.dates;
  const RKEY = "sob.recentSearches", getRecent = () => { try { return JSON.parse(localStorage.getItem(RKEY) || "[]").slice(0, 6); } catch (e) { return []; } };
  const addRecent = (q) => { q = String(q || "").trim(); if (q.length < 2) return; try { localStorage.setItem(RKEY, JSON.stringify([q].concat(getRecent().filter((x) => x !== q)).slice(0, 6))); } catch (e) {} };
  const clearRecent = () => { try { localStorage.removeItem(RKEY); } catch (e) {} };
  const env = () => ({ staff: isStaff(), memberId: st.user.memberId, today: today(), nameOf, screens: screens(), reports: reports() });
  const mk = (parts) => parts.map((p) => (p.hit ? h("mark", null, p.t) : p.t));
  function txnCard(id) { const t = (st.db.transactions || []).find((x) => x.id === id); if (!t) return; Modal(t.type + " · " + D.longDate(t.date), h("div", { class: "kvs" }, [["Amount", "UGX " + Number(t.amount).toLocaleString("en-US")], ["Member", nameOf(t.memberId) + " (" + t.memberId + ")"], ["Date", D.longDate(t.date)], ["Reference", t.reference || "—"], ["Receipt", t.receipt || "—"], ["Purpose", t.purpose || "—"], ["Entry", t.id]].map((r) => h("div", { class: "kv" }, h("span", null, r[0]), h("b", null, r[1]))))); }
  function contentCard(id) { const c = (st.db.contentItems || []).find((x) => x.id === id); if (!c) return; Modal(c.title, h("div", null, String(c.body || "").split(/\n{2,}/).map((p) => h("p", { style: "white-space:pre-wrap" }, p)), c.reference ? h("p", { class: "mute" }, c.reference) : null)); }
  function openTarget(it) {
    const t = it.target || {};
    if (t.open === "member") { go("members"); openMember(t.id); } else if (t.open === "loan") { go(t.view); openLoan(t.id); } else if (t.open === "txn") { go(t.view); txnCard(t.id); }
    else if (t.open === "report") { st.rc = Object.assign({}, st.rc || {}, { id: t.id }); go("reports"); } else if (t.open === "content") { go(t.view); contentCard(t.id); } else if (t.view) go(t.view);
  }
  function open() {
    if (document.querySelector(".pal-bg")) return;
    const f = { cats: [], year: "", from: "", to: "" }; let items = [], sel = 0, last = "", more = null, showF = false, tm = 0;
    const input = h("input", { type: "search", id: "pal-input", placeholder: isStaff() ? "Search members, amounts, phones, loans, reports…" : "Search your savings, loans, help, verses…", "aria-label": "Search", autocomplete: "off", autocapitalize: "off", spellcheck: "false", inputmode: "search" });
    const list = h("div", { class: "pal-list", id: "pal-list", role: "listbox" }), fbar = h("div", { class: "pal-f", id: "pal-filters" });
    const bg = h("div", { class: "pal-bg", onclick: (e) => { if (e.target === bg) close(); } }, h("div", { class: "pal", role: "dialog", "aria-modal": "true", "aria-label": "Search" },
      h("div", { class: "pal-top" }, Icon("search", 20), input, h("button", { class: "pal-fb", id: "pal-ftoggle", "aria-label": "Filters", onclick: () => { showF = !showF; paintF(); } }, Icon("sliders", 18)), h("button", { class: "pal-x", "aria-label": "Close search", onclick: () => close() }, "✕")), fbar, list, h("div", { class: "pal-foot" }, h("span", null, "↑↓ move"), h("span", null, "Enter open"), h("span", null, "Esc close"))));
    const close = () => { document.removeEventListener("keydown", key, true); bg.remove(); };
    const years = () => { const s = new Set(); (st.db.yearCycles || []).forEach((c) => s.add(String(c.year))); (st.db.transactions || []).forEach((t) => s.add(String(t.date || "").slice(0, 4))); s.delete(""); return Array.from(s).sort().reverse(); };
    function paintF() {
      fbar.replaceChildren(); fbar.hidden = !showF; if (!showF) return;
      const cats = SR.CATS.filter((c) => !(!isStaff() && ["Members", "Approvals", "Financial years", "Settings"].includes(c)));
      fbar.append(h("div", { class: "pal-chips" }, cats.map((c) => h("button", { class: "chip" + (f.cats.includes(c) ? " on" : ""), "data-fcat": c, onclick: () => { f.cats = f.cats.includes(c) ? f.cats.filter((x) => x !== c) : f.cats.concat(c); paintF(); run(true); input.focus(); } }, c))),
        h("div", { class: "pal-dates" }, h("label", null, "Year", h("select", { id: "pal-year", onchange: (e) => { f.year = e.target.value; run(true); } }, [h("option", { value: "" }, "Any year")].concat(years().map((y) => h("option", { value: y, selected: y === f.year }, y))))),
          h("label", null, "From", h("input", { type: "date", id: "pal-from", value: f.from, onchange: (e) => { f.from = e.target.value; run(true); } })), h("label", null, "To", h("input", { type: "date", id: "pal-to", value: f.to, onchange: (e) => { f.to = e.target.value; run(true); } })), h("button", { onclick: () => { f.cats = []; f.year = f.from = f.to = ""; paintF(); run(true); } }, "Clear")));
    }
    const draw = (res) => {
      list.replaceChildren(); items = [];
      const q = input.value.trim();
      if (!q) {
        const rec = getRecent();
        if (rec.length) { list.append(h("div", { class: "pal-h" }, "Recent searches", h("button", { class: "pal-clear", onclick: () => { clearRecent(); draw(); } }, "Clear"))); rec.forEach((r) => list.append(h("button", { class: "pal-i", "data-recent": r, onclick: () => { input.value = r; run(true); input.focus(); } }, Icon("clock", 18), h("span", null, r)))); }
        list.append(h("div", { class: "pal-h" }, "Go to")); SR.quick(st.db, env()).forEach((it) => { items.push(it); list.append(row(it, items.length - 1)); });
        list.append(h("div", { class: "pal-tip" }, isStaff() ? "Try: a name, SOB-004, 0772…, 150,000, a receipt number, “nov 2026”, or “backup”." : "Try: “withdraw”, “loan”, “share-out”, “proverbs”, or an amount."));
        sel = 0; return;
      }
      if (!res || !res.total) {
        list.append(h("div", { class: "pal-empty" }, h("b", null, "Nothing found for “" + q + "”"), h("div", null, "Check the spelling, remove a word, or clear the filters.")));
        (res && res.didYouMean || []).forEach((w) => list.append(h("button", { class: "pal-i", "data-suggest": w, onclick: () => { input.value = w; run(true); } }, Icon("search", 18), h("span", null, "Did you mean ", h("b", null, w), "?"))));
        list.append(h("div", { class: "pal-h" }, "Or go to")); SR.quick(st.db, env()).slice(0, 5).forEach((it) => { items.push(it); list.append(row(it, items.length - 1)); }); sel = 0; return;
      }
      res.groups.forEach((g) => { list.append(h("div", { class: "pal-h", "data-group": g.cat }, g.cat, h("span", { class: "pal-n" }, String(g.count)))); g.items.forEach((it) => { items.push(it); list.append(row(it, items.length - 1)); });
        if (g.count > g.items.length) list.append(h("button", { class: "pal-more", "data-more": g.cat, onclick: () => { more = g.cat; run(true); } }, "Show all " + g.count + " in " + g.cat)); });
      if (sel >= items.length) sel = 0; mark();
    };
    const IC = { Members: "user", Loans: "loan", Savings: "wallet", Withdrawals: "wallet", "Loan repayments": "loan", "Share-outs": "gift", "Other entries": "receipt", Approvals: "check", "Financial years": "book", Reports: "download", Screens: "home", Settings: "sliders", Help: "bell", Announcements: "bell", "Spiritual Corner": "book", "Ideas and opportunities": "chart", Learn: "book" };
    const row = (it, i) => h("button", { class: "pal-i" + (i === sel ? " sel" : ""), role: "option", "data-pal": it.id, "data-cat": it.cat, onclick: () => pick(it) }, Icon(it.ic || IC[it.cat] || "search", 20), h("span", null, h("span", { class: "pal-t" }, mk(it.marks)), it.sub ? h("small", null, mk(it.subMarks || [{ t: it.sub, hit: false }])) : null));
    const mark = () => { list.querySelectorAll(".pal-i[data-pal]").forEach((b, i) => { b.classList.toggle("sel", i === sel); if (i === sel && b.scrollIntoView) b.scrollIntoView({ block: "nearest" }); }); };
    const pick = (it) => { addRecent(input.value); close(); openTarget(it); };
    function run(now) { clearTimeout(tm); const go2 = () => { const q = input.value; last = q; const o = { cats: f.cats, year: f.year, from: f.from, to: f.to, expandCat: more }; if (more && !q) more = null; draw(q.trim() ? SR.search(st.db, env(), q, o) : null); }; if (now) go2(); else tm = setTimeout(go2, 40); }
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); } else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); } else if (e.key === "Enter" && items[sel] && document.activeElement === input) { e.preventDefault(); pick(items[sel]); } };
    document.addEventListener("keydown", key, true); input.addEventListener("input", () => { more = null; sel = 0; run(false); }); document.body.append(bg); paintF(); run(true); input.focus();
  }
  return { open };
};
