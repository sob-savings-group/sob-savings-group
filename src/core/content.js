/* SOB core/content — everything members read that is not money: announcements, notices, the Spiritual Corner (verses by category), investment ideas, opportunities,
   Uganda economy notes, financial education and articles. It is DATA, not code: officers add, edit, publish, retire and schedule items inside the app, every change
   is audited, and nothing here needs a deployment. Items are plain text only (the app never treats them as HTML).
   An item: { id, kind, category, title, body, reference, translation, capital, link, startDate, endDate, pinned, status: Draft|Published|Retired, seedKey, by, at }. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./governance.js") : root.SOB.gov, isNode ? require("./dates.js") : root.SOB.dates);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.content = api; }
})(typeof self !== "undefined" ? self : this, function (G, D) {
  const KINDS = { announcement: "Announcement", notice: "Notice", verse: "Spiritual Corner", idea: "Investment idea", opportunity: "Opportunity", economy: "Uganda economy", education: "Financial education", article: "Article", message: "Spiritual message" };
  const VERSE_CATEGORIES = ["Saving", "Borrowing and Loans", "Investment", "Stewardship and Finance", "Giving and Generosity", "Discipline", "Wisdom", "Temptation", "Integrity", "Work and Diligence", "Contentment", "Wealth and Prosperity"];
  const CAPITAL = ["Under UGX 100,000", "UGX 100,000 to 500,000", "UGX 500,000 to 2,000,000", "Above UGX 2,000,000"];
  const OPP_CATEGORIES = ["Business", "Skills and training", "Grants and programmes", "Jobs", "Other"];
  const ECONOMY_CATEGORIES = ["Agriculture", "Trade", "Manufacturing", "Tourism", "ICT", "Real Estate", "Financial Services", "Energy", "Transport", "Emerging sectors"];
  const EDU_CATEGORIES = ["Saving", "Borrowing", "Budgeting", "Investing", "Safety and scams", "Record keeping"];
  const CATEGORIES = { verse: VERSE_CATEGORIES, idea: CAPITAL, opportunity: OPP_CATEGORIES, economy: ECONOMY_CATEGORIES, education: EDU_CATEGORIES };
  const LIMITS = { title: 120, body: 4000, reference: 60, translation: 20, link: 300, category: 60 };
  const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/g, "").trim().slice(0, max);
  const safeLink = (u) => { const s = clean(u, LIMITS.link); return /^https:\/\/[^\s]+$/i.test(s) ? s : ""; };

  function save(db, ctx, a) {
    G.require(ctx, "content.manage"); a = a || {}; db.contentItems = db.contentItems || [];
    const kind = String(a.kind || ""); if (!KINDS[kind]) throw new Error("INVALID: choose what kind of item this is");
    const title = G.need(clean(a.title, LIMITS.title), "title"), body = G.need(clean(a.body, LIMITS.body), "text");
    const category = clean(a.category, LIMITS.category); if (CATEGORIES[kind] && !category) throw new Error("REQUIRED: category");
    if (a.link && !safeLink(a.link)) throw new Error("INVALID: a link must start with https://");
    for (const k of ["startDate", "endDate"]) if (a[k] && !(D.isISO(a[k]) && D.isRealDate(a[k]))) throw new Error("INVALID: " + k + " must be a real date");
    if (a.startDate && a.endDate && a.endDate < a.startDate) throw new Error("INVALID: the end date is before the start date");
    const status = ["Draft", "Published", "Retired"].includes(a.status) ? a.status : "Draft";
    const rec = a.id ? db.contentItems.find((x) => x.id === a.id) : null; if (a.id && !rec) throw new Error("NOT_FOUND: " + a.id);
    const next = { kind, category, title, body, reference: clean(a.reference, LIMITS.reference), translation: clean(a.translation, LIMITS.translation), capital: "", link: safeLink(a.link), startDate: a.startDate || "", endDate: a.endDate || "", pinned: a.pinned === true || a.pinned === "true", status };
    if (rec) { const before = JSON.parse(JSON.stringify(rec)); Object.assign(rec, next, { updatedBy: ctx.by, updatedAt: ctx.now }); G.audit(db, ctx, "Content", rec.id, "Edited", { title: before.title, status: before.status }, { title, status }, a.reason || ""); return rec; }
    const item = Object.assign({ id: G.uid("CNT"), createdBy: ctx.by, createdAt: ctx.now }, next); db.contentItems.push(item); G.audit(db, ctx, "Content", item.id, status === "Published" ? "Published" : "Created", null, { kind, title, status }, a.reason || ""); return item;
  }
  function setStatus(db, ctx, a) {
    G.require(ctx, "content.manage"); const it = (db.contentItems || []).find((x) => x.id === (a || {}).id); if (!it) throw new Error("NOT_FOUND: content item");
    const status = a.status; if (!["Draft", "Published", "Retired"].includes(status)) throw new Error("INVALID: status"); const was = it.status;
    it.status = status; it.updatedBy = ctx.by; it.updatedAt = ctx.now; G.audit(db, ctx, "Content", it.id, status === "Published" ? "Published" : status === "Retired" ? "Retired" : "Unpublished", { status: was }, { status }, a.reason || ""); return it;
  }
  /* what members may read today: published, inside its dates */
  const live = (it, today) => it && it.status === "Published" && (!it.startDate || it.startDate <= today) && (!it.endDate || it.endDate >= today);
  const published = (db, today, o) => { o = o || {}; return (db.contentItems || []).filter((x) => live(x, today) && (!o.kind || x.kind === o.kind) && (!o.category || x.category === o.category)).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))); };
  const dayNo = (iso) => Math.floor(new Date(iso + "T00:00:00Z").getTime() / 86400000);
  /* one verse and one tip per day: the same for everyone on a given day, different tomorrow, never depends on a server */
  function daily(db, today, kind) { const list = published(db, today, { kind }).slice().sort((a, b) => String(a.id).localeCompare(String(b.id))); return list.length ? list[dayNo(today) % list.length] : null; }
  /* items published or changed since a date, so the app can show what is new */
  const since = (db, today, iso) => published(db, today).filter((x) => String(x.updatedAt || x.createdAt || "").slice(0, 10) > String(iso || "0000-00-00"));
  function loadStarter(db, ctx, pack) {
    G.require(ctx, "content.manage"); db.contentItems = db.contentItems || []; let added = 0;
    (pack || []).forEach((p) => { if (db.contentItems.some((x) => x.seedKey === p.seedKey)) return; db.contentItems.push(Object.assign({ id: G.uid("CNT"), status: "Published", pinned: false, startDate: "", endDate: "", link: "", reference: "", translation: "", createdBy: ctx.by, createdAt: ctx.now, seed: true }, p)); added++; });
    G.audit(db, ctx, "Content", "STARTER", "Starter content loaded", null, { added }, "Starter pack"); return { added, total: db.contentItems.length };
  }
  return { KINDS, CATEGORIES, VERSE_CATEGORIES, CAPITAL, OPP_CATEGORIES, ECONOMY_CATEGORIES, EDU_CATEGORIES, LIMITS, save, setStatus, published, daily, since, loadStarter, live };
});
