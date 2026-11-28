/* SOB app/grow — the non-money side of the app. Members: Spiritual Corner (a verse a day, every category), Investment ideas by starting capital, Opportunities,
   Uganda economy notes, Financial education, Notices. Super Admin: one Content screen to add, edit, publish, schedule and retire any item, or load the starter pack.
   Everything is DATA in the Content sheet (core/content): no deployment is needed to change a word. All text is shown as plain text. */
window.SOBGrow = function (E) {
  const { st, act, commit, render, today, go } = E, { h, toast, Form, Modal, Chips, Section, Row, List, Empty, Icon, Confirm } = window.SOBUI, CT = window.SOB.content;
  const items = (kind) => (st.db.contentItems || []).filter((x) => !kind || x.kind === kind);
  const live = (kind, cat) => CT.published({ contentItems: st.db.contentItems || [] }, today(), { kind, category: cat });
  const para = (t) => String(t || "").split(/\n{2,}/).map((x) => h("p", { class: "gr-p" }, x));
  const verseCard = (v, big) => h("div", { class: "card gr-verse" + (big ? " big" : ""), "data-verse": v.id }, h("div", { class: "gr-q" }, "“" + v.body + "”"), h("div", { class: "gr-ref" }, "— " + v.reference + (v.translation ? " (" + v.translation + ")" : "") + (v.category ? " · " + v.category : "")));
  const open = (it) => Modal(it.title, h("div", null, it.kind === "verse" ? verseCard(it, true) : para(it.body), it.link ? h("p", null, h("a", { href: it.link, target: "_blank", rel: "noopener noreferrer" }, "Read more")) : null, it.endDate ? h("p", { class: "mute" }, "Open until " + it.endDate) : null));
  const SECTIONS = [["verse", "Spiritual Corner"], ["idea", "Ideas"], ["opportunity", "Opportunities"], ["economy", "Uganda"], ["education", "Learn"], ["notice", "Notices"]];
  const NEWDAYS = 7, isNew = (it) => it && String(it.updatedAt || it.createdAt || "").slice(0, 10) >= require_addDays(today(), -NEWDAYS) && !it.seed;
  const require_addDays = (d, n) => window.SOB.dates.addDays(d, n);
  /* the Home page cards: today's verse, today's tip, and the notices that are live now */
  function homeCards(part) {
    const db = { contentItems: st.db.contentItems || [] }, out = [], v = CT.daily(db, today(), "verse"), t = CT.daily(db, today(), "education"), ann = live("announcement").concat(live("notice")).slice(0, 3);
    if (part === "top") { ann.forEach((a) => out.push(h("div", { class: "card gr-note click", role: "button", tabindex: 0, "data-notice": a.id, onclick: () => open(a) }, h("b", null, a.title), h("div", { class: "mute" }, a.body.slice(0, 110) + (a.body.length > 110 ? "…" : ""))))); return out; }
    if (v) out.push(Section("Verse for today", h("button", { class: "iconbtn", "aria-label": "Spiritual Corner", onclick: () => { st.growTab = "verse"; go("grow"); } }, Icon("chevron"))), verseCard(v));
    if (t) out.push(Section("Money tip of the day"), h("div", { class: "card click", role: "button", tabindex: 0, "data-tip": t.id, onclick: () => open(t) }, h("b", null, t.title), h("div", { class: "mute" }, t.body.slice(0, 140) + (t.body.length > 140 ? "…" : ""))));
    return out;
  }
  function memberView() {
    const tab = st.growTab || "verse", cats = CT.CATEGORIES[tab], cat = st.growCat || "";
    const all = tab === "notice" ? live("announcement").concat(live("notice")) : live(tab, cat), n = SECTIONS.map(([k]) => (k === "notice" ? live("announcement").concat(live("notice")) : live(k)).filter(isNew).length);
    const el = h("div", { id: "grow" }, Chips(SECTIONS.map(([k, l], i) => [k, l + (n[i] ? " ●" : "")]), tab, (k) => { st.growTab = k; st.growCat = ""; render(); }));
    if (cats) el.append(h("div", { class: "gr-cat" }, h("select", { id: "gr-cat", "aria-label": "Category", onchange: (e) => { st.growCat = e.target.value; render(); } }, [h("option", { value: "" }, "All categories")].concat(cats.map((c) => h("option", { value: c, selected: c === cat }, c))))));
    if (!all.length) { el.append(Empty({ icon: "book", title: "Nothing here yet", sub: "Your officers add new items often. Please check again soon." })); return el; }
    if (tab === "verse") { all.forEach((v) => el.append(verseCard(v))); return el; }
    el.append(List(all.map((it) => Row({ icon: tab === "idea" ? "chart" : tab === "opportunity" ? "gift" : tab === "economy" ? "book" : "bell", title: it.title + (isNew(it) ? "  ● new" : ""), sub: (it.category ? it.category + " · " : "") + it.body.slice(0, 90) + "…", onOpen: () => open(it) }))));
    return el;
  }
  /* ---------- officer's Content screen ---------- */
  const CATSEL = (kind) => (CT.CATEGORIES[kind] || []);
  function itemForm(it, kind) {
    it = it || {}; kind = it.kind || kind || "verse";
    const f = [{ name: "kind", label: "Type", options: Object.keys(CT.KINDS).map((k) => ({ value: k, label: CT.KINDS[k] })), value: kind }, { name: "category", label: "Category (verses, ideas, opportunities, Uganda, learn)", options: [""].concat([].concat(...Object.values(CT.CATEGORIES))), value: it.category || "" },
      { name: "title", label: "Title", value: it.title || "" }, { name: "body", label: "Text", type: "textarea", value: it.body || "" }, { name: "reference", label: "Verse reference (e.g. Proverbs 21:20)", value: it.reference || "" }, { name: "translation", label: "Bible translation", value: it.translation || "KJV" },
      { name: "link", label: "Link (https://, optional)", value: it.link || "" }, { name: "startDate", label: "Show from (optional)", type: "date", value: it.startDate || "" }, { name: "endDate", label: "Show until (optional)", type: "date", value: it.endDate || "" },
      { name: "status", label: "Status", options: ["Draft", "Published", "Retired"], value: it.status || "Published" }];
    Form(it.id ? "Edit item" : "New item", f, act(async (v) => { await commit("saveContent", Object.assign({}, v, { id: it.id })); }, "Saved"), "Save");
  }
  function staffView() {
    const k = st.contentKind || "all", all = items().slice().sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))), shown = k === "all" ? all : all.filter((x) => x.kind === k);
    return h("div", { id: "content-manager" },
      h("p", { class: "mute" }, "Everything members read here is yours to change. Published items show to members at once; drafts and retired items stay hidden. Texts are shown as plain text."),
      h("div", { class: "row" }, h("button", { class: "primary", id: "content-new", onclick: () => itemForm(null, k === "all" ? "" : k) }, "Add an item"), all.length ? null : h("button", { id: "content-starter", onclick: act(async () => { const r = await commit("loadStarterContent", {}); toast("Starter content loaded"); }) }, "Load starter content"), all.length && !all.some((x) => x.seed) ? h("button", { id: "content-starter", onclick: act(async () => { await commit("loadStarterContent", {}); toast("Starter content loaded"); }) }, "Load starter content") : null),
      Chips([["all", "All (" + all.length + ")"]].concat(Object.keys(CT.KINDS).map((x) => [x, CT.KINDS[x]])), k, (x) => { st.contentKind = x; render(); }),
      shown.length ? List(shown.map((it) => Row({ icon: "book", title: it.title, sub: CT.KINDS[it.kind] + (it.category ? " · " + it.category : "") + " · " + it.status + (it.endDate ? " · until " + it.endDate : ""), onOpen: () => Modal(it.title, h("div", null, para(it.body), h("div", { class: "row" },
        h("button", { "data-act": "edit-content", onclick: () => itemForm(it) }, "Edit"),
        it.status !== "Published" ? h("button", { class: "primary", "data-act": "publish-content", onclick: act(async () => { await commit("setContentStatus", { id: it.id, status: "Published" }); }, "Published") }, "Publish") : null,
        it.status === "Published" ? h("button", { "data-act": "unpublish-content", onclick: act(async () => { await commit("setContentStatus", { id: it.id, status: "Draft" }); }, "Hidden from members") }, "Hide") : null,
        it.status !== "Retired" ? h("button", { class: "danger", "data-act": "retire-content", onclick: act(async () => { await commit("setContentStatus", { id: it.id, status: "Retired" }); }, "Retired") }, "Retire") : null))) }))) : Empty({ icon: "book", title: "No items yet", sub: "Add one, or load the starter content." }));
  }
  return { memberView, staffView, homeCards, isNew };
};
