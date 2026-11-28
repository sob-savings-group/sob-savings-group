/* SOB core/search — one smart search over everything the signed-in person is allowed to see.
   It is a pure function of the data the app already holds (a member's data is already limited by the server), so it can never reveal more than the screens do.
   search(db, env, query, opts) -> { groups:[{cat, items:[{id, cat, title, sub, marks, target, score}]}], total, didYouMean, tokens }
   - partial words, amounts (10,000 / 10000), phone numbers (0772…, +256772…), SOB IDs, references, receipts, dates ("nov 2026", 2026-11-28)
   - typo tolerance (one or two letters, only when needed), ranking by match quality, recency and category, filters by category / year / dates
   - a per-database index is built once and reused for every keystroke; each category is capped, so a large ledger stays fast.
   env: { staff, memberId, today, screens:[{id,title,group,ic}], reports:[{id,title,about,group}], help:[{id,title,text,view}], nameOf(id) } */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./dates.js") : root.SOB.dates);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.search = api; }
})(typeof self !== "undefined" ? self : this, function (D) {
  const CATS = ["Members", "Loans", "Savings", "Withdrawals", "Loan repayments", "Share-outs", "Other entries", "Approvals", "Financial years", "Reports", "Screens", "Settings", "Help", "Announcements", "Spiritual Corner", "Ideas and opportunities", "Learn"];
  const HELP = [
    { id: "h-loan", title: "How do I apply for a loan?", text: "loan apply borrow application guarantor eligibility how much can i borrow", view: "myloans", staffView: "loans" },
    { id: "h-pin", title: "I forgot my password or PIN", text: "forgot password pin reset change secret login code email", view: "more", staffView: "members" },
    { id: "h-statement", title: "Where is my statement?", text: "statement download pdf savings history account print", view: "savings", staffView: "reports" },
    { id: "h-withdraw", title: "How do I withdraw savings?", text: "withdraw withdrawal take money cash out savings treasurer", view: "savings", staffView: "ledger" },
    { id: "h-airtime", title: "How do I request airtime?", text: "airtime phone credit request buy", view: "airtime", staffView: "airtime" },
    { id: "h-share", title: "When is the share-out and profit paid?", text: "share-out shareout profit december dividend interest paid year end", view: "myshare", staffView: "shareout" },
    { id: "h-sub", title: "Annual subscription", text: "subscription annual fee pay yearly membership", view: "mysubs", staffView: "subs" },
    { id: "h-notice", title: "Stop or restart text messages", text: "sms whatsapp notices opt out stop messages notifications", view: "more", staffView: "messages" },
    { id: "h-charge", title: "Bank charges on withdrawals and payouts", text: "bank charge fee withdrawal disbursement member group expense", view: "savings", staffView: "ledger" }
  ];
  const SETTINGS = [
    { id: "s-reminders", title: "Automatic loan reminders", text: "reminder deadline chairperson contact switch auto on off schedule", view: "reminders" },
    { id: "s-lists", title: "Lists and options (purposes, categories)", text: "lists options purposes categories dropdown settings", view: "system" },
    { id: "s-backup", title: "Backups", text: "backup restore download snapshot export data", view: "system" },
    { id: "s-status", title: "System Status Centre", text: "status health check diagnostics system sms quota triggers", view: "status" },
    { id: "s-content", title: "Manage content (verses, notices, ideas)", text: "content announcements spiritual verses ideas opportunities articles notices manage", view: "content" },
    { id: "s-messages", title: "Message templates and sending", text: "message templates sms whatsapp email wording placeholders send notice", view: "messages" }
  ];
  const norm = (s) => String(s == null ? "" : s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const digits = (s) => String(s || "").replace(/\D/g, "");
  const phoneKeys = (p) => { const d = digits(p); if (!d) return ""; const local = d.startsWith("256") ? "0" + d.slice(3) : d; return local + " " + d; };
  const wordsOf = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
  function lev(a, b, max) {   // edit distance with an early stop
    if (Math.abs(a.length - b.length) > max) return max + 1; let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) { const cur = [i]; let rowMin = i; for (let j = 1; j <= b.length; j++) { const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); cur.push(v); if (v < rowMin) rowMin = v; } if (rowMin > max) return max + 1; prev = cur; }
    return prev[b.length];
  }
  const allowed = (len) => (len < 4 ? 0 : len < 8 ? 1 : 2);
  const dateText = (iso) => (D.isISO(iso) ? iso + " " + D.longDate(iso) + " " + D.toDisplay(iso) : "");
  const catOfTx = (t) => /^Withdraw/.test(t.type) ? "Withdrawals" : /^Savings|^Subscription|^Balance/.test(t.type) && !/Loan/.test(t.type) ? "Savings" : /Loan Repayment/.test(t.type) ? "Loan repayments" : /^Share-?Out/i.test(t.type) ? "Share-outs" : "Other entries";
  const KIND_CAT = { announcement: "Announcements", notice: "Announcements", message: "Spiritual Corner", verse: "Spiritual Corner", idea: "Ideas and opportunities", opportunity: "Ideas and opportunities", economy: "Learn", education: "Learn", article: "Learn" };

  /* ---------- the index: built once per data set, reused for every keystroke ---------- */
  const cache = new WeakMap();
  const sig = (db) => [(db.transactions || []).length, (db.members || []).length, (db.loans || []).length, (db.contentItems || []).length, db.revision || 0, (db.approvalRequests || []).length].join("|");
  function build(db, env) {
    const R = [], nm = (id) => (env.nameOf ? env.nameOf(id) : id) || id, staff = !!env.staff;
    const add = (r) => { r.hay = r.fields.map((f) => [norm(f[0]), f[1]]); r.words = {}; R.push(r); };
    if (staff) (db.members || []).forEach((m) => add({ cat: "Members", id: m.id, title: m.name, sub: m.id + (m.phone ? " · " + m.phone : "") + (m.status && m.status !== "Active" ? " · " + m.status : ""), fields: [[m.name, 100], [m.id, 95], [phoneKeys(m.phone), 90], [m.location || "", 40], [m.email || "", 50], [m.status || "", 15]], target: { view: "members", open: "member", id: m.id }, rec: 0 }));
    (db.loans || []).filter((l) => !l.voided).forEach((l) => add({ cat: "Loans", id: l.id, title: (staff ? nm(l.memberId) : "My loan") + " · " + l.id, sub: l.status + " · UGX " + Number(l.loanAmount || 0).toLocaleString("en-US") + (l.purpose ? " · " + l.purpose : ""), fields: [[l.id, 95], [staff ? nm(l.memberId) : "my loan", 80], [l.memberId || "", 70], [l.status || "", 30], [l.purpose || "", 40], [String(l.loanAmount || ""), 85], [dateText(l.date), 35]], nums: [Number(l.loanAmount || 0)], date: l.date, year: String((l.date || "").slice(0, 4)), target: { view: staff ? "loans" : "myloans", open: "loan", id: l.id }, rec: l.date || "" }));
    (db.transactions || []).filter((t) => !t.voided).forEach((t) => { const cat = catOfTx(t), who = staff ? nm(t.memberId) : "";
      add({ cat, id: t.id, title: (who ? who + " · " : "") + t.type + " · UGX " + Number(t.amount || 0).toLocaleString("en-US"), sub: D.longDate(t.date) + (t.reference ? " · ref " + t.reference : "") + (t.receipt ? " · receipt " + t.receipt : "") + (t.purpose && String(t.purpose).length < 50 ? " · " + t.purpose : ""),
        fields: [[who, 60], [t.memberId || "", 55], [t.type || "", 50], [String(t.amount || ""), 85], [t.reference || "", 90], [t.receipt || "", 90], [t.purpose || "", 40], [dateText(t.date), 35], [t.id || "", 80], [t.loanId || "", 60]], nums: [Number(t.amount || 0)], date: t.date, year: String(t.forYear || (t.date || "").slice(0, 4)), target: { view: staff ? "ledger" : "savings", open: "txn", id: t.id }, rec: t.date || "" }); });
    if (staff) {
      (db.shareOutEvents || []).forEach((e) => add({ cat: "Share-outs", id: e.id, title: "Share-out " + e.year, sub: D.longDate(e.date) + " · UGX " + Number(e.totalWithdrawn || 0).toLocaleString("en-US"), fields: [["share-out shareout " + e.year, 90], [dateText(e.date), 35], [String(e.totalWithdrawn || ""), 70]], nums: [Number(e.totalWithdrawn || 0)], date: e.date, year: String(e.year), target: { view: "shareout" }, rec: e.date || "" }));
      (db.approvalRequests || []).forEach((r) => add({ cat: "Approvals", id: r.id, title: (r.command || r.type || "Approval") + " · " + (r.status || ""), sub: (r.requestedBy || r.by || "") + " " + (r.at || r.createdAt || "").slice(0, 10), fields: [[r.command || r.type || "", 80], [r.status || "", 60], [r.requestedBy || r.by || "", 50], [r.reason || "", 40], [JSON.stringify(r.args || {}).slice(0, 200), 20]], date: (r.at || r.createdAt || "").slice(0, 10), year: (r.at || r.createdAt || "").slice(0, 4), target: { view: "approvals" }, rec: r.at || r.createdAt || "" }));
      (db.yearCycles || []).forEach((c) => add({ cat: "Financial years", id: "FY" + c.year, title: "Financial year " + c.year, sub: c.status || "", fields: [["financial year fy " + c.year, 95], [c.status || "", 30]], year: String(c.year), target: { view: "fyears", open: "fy", id: c.year }, rec: String(c.year) }));
      (env.reports || []).forEach((r) => add({ cat: "Reports", id: r.id, title: r.title, sub: r.group || r.about || "", fields: [[r.title, 100], [r.about || "", 40], [r.group || "", 30]], target: { view: "reports", open: "report", id: r.id }, rec: "" }));
    } else (env.reports || []).forEach((r) => add({ cat: "Reports", id: r.id, title: r.title, sub: r.about || "", fields: [[r.title, 100], [r.about || "", 40]], target: { view: "savings" }, rec: "" }));
    (env.screens || []).forEach((s) => add({ cat: "Screens", id: s.id, title: s.title, sub: s.group || "", fields: [[s.title, 100], [s.group || "", 30]], target: { view: s.id }, ic: s.ic, rec: "" }));
    if (staff) SETTINGS.filter((s) => !s.view || (env.screens || []).some((x) => x.id === s.view)).forEach((s) => add({ cat: "Settings", id: s.id, title: s.title, sub: "Settings", fields: [[s.title, 100], [s.text, 55]], target: { view: s.view }, rec: "" }));
    HELP.forEach((s) => add({ cat: "Help", id: s.id, title: s.title, sub: "Help", fields: [[s.title, 100], [s.text, 60]], target: { view: staff ? s.staffView : s.view }, rec: "" }));
    (db.contentItems || []).filter((c) => staff || c.status === "Published").forEach((c) => add({ cat: KIND_CAT[c.kind] || "Learn", id: c.id, title: c.title + (c.reference ? " (" + c.reference + ")" : ""), sub: (c.category || "") + (staff && c.status !== "Published" ? " · " + c.status : ""), fields: [[c.title, 100], [c.reference || "", 90], [c.category || "", 50], [c.body || "", 25]], target: { view: staff ? "content" : "grow", open: "content", id: c.id, kind: c.kind }, date: (c.updatedAt || c.createdAt || "").slice(0, 10), rec: c.updatedAt || c.createdAt || "" }));
    const vocab = new Set(); R.forEach((r) => { if (["Members", "Screens", "Reports", "Help", "Settings", "Loans"].includes(r.cat)) r.hay.forEach((f) => { if (f[1] >= 50) f[0].split(/[^a-z0-9]+/).forEach((w) => { if (w.length >= 4) vocab.add(w); }); }); });
    return { R, vocab: Array.from(vocab) };
  }
  const indexFor = (db, env) => { const k = sig(db) + "|" + (env.staff ? "s" : "m") + (env.screens || []).length + (env.reports || []).length; let e = cache.get(db); if (!e || e.k !== k) { e = { k, idx: build(db, env) }; cache.set(db, e); } return e.idx; };

  /* ---------- matching one word against a record: 0 = no match, else 1..100 ---------- */
  function matchToken(r, tok, fuzzy) {
    const numeric = /^\d[\d,]*$/.test(tok), tn = tok.replace(/,/g, ""); let best = 0;
    if (numeric && tn.length >= 3 && r.nums && r.nums.some((n) => String(n) === tn)) best = 100;
    for (const [text, w] of r.hay) {
      if (!text || w * 1 <= best * 0) continue;
      let s = 0; const q = numeric ? tn : tok;
      if (text === q) s = 100; else if (text.startsWith(q)) s = 85; else if (text.includes(" " + q) || text.includes("/" + q) || text.includes("-" + q)) s = 70; else if (q.length >= 2 && text.includes(q)) s = 50;
      else if (fuzzy && q.length >= 4 && /^[a-z]+$/.test(q)) { const a = allowed(q.length); const ws = (r.words[text] || (r.words[text] = text.split(/[^a-z0-9]+/).filter((x) => x.length >= 3))); for (const w2 of ws) { if (Math.abs(w2.length - q.length) <= a && lev(w2, q, a) <= a) { s = 28; break; } } }
      if (s) { const v = s * w / 100; if (v > best) best = v; }
    }
    return best;
  }
  const inRange = (r, o) => (!o.year || !r.year || r.year === String(o.year)) && (!o.from || !r.date || r.date >= o.from) && (!o.to || !r.date || r.date <= o.to);
  /* where in a text the words matched, so the screen can highlight them */
  function marks(text, tokens) {
    text = String(text == null ? "" : text); const low = norm(text), spans = [];
    tokens.forEach((t) => { const q = t.replace(/,/g, ""); if (!q) return;
      if (/^\d+$/.test(q)) { const re = new RegExp(q.split("").join(",?"), "g"); let m; while ((m = re.exec(low)) && spans.length < 12) { spans.push([m.index, m.index + m[0].length]); if (!m[0]) break; } return; }
      let i = low.indexOf(q); while (i >= 0 && spans.length < 12) { spans.push([i, i + q.length]); i = low.indexOf(q, i + q.length); } });
    if (!spans.length) return [{ t: text, hit: false }];
    spans.sort((a, b) => a[0] - b[0]); const merged = []; spans.forEach((s) => { const l = merged[merged.length - 1]; if (l && s[0] <= l[1]) l[1] = Math.max(l[1], s[1]); else merged.push(s.slice()); });
    const out = []; let p = 0; merged.forEach(([a, b]) => { if (a > p) out.push({ t: text.slice(p, a), hit: false }); out.push({ t: text.slice(a, b), hit: true }); p = b; }); if (p < text.length) out.push({ t: text.slice(p), hit: false }); return out;
  }
  function search(db, env, q, o) {
    o = o || {}; const per = o.perCategory || 5, idx = indexFor(db, env), raw = norm(q).trim();
    const tokens = raw.split(/\s+/).filter(Boolean).slice(0, 6), cats = o.cats && o.cats.length ? o.cats : null;
    if (!tokens.length) return { groups: [], total: 0, tokens, didYouMean: [] };
    const run = (fuzzy) => { const hits = [];
      for (const r of idx.R) { if (cats && !cats.includes(r.cat)) continue; if (!inRange(r, o)) continue; let sum = 0, ok = true;
        for (const t of tokens) { const m = matchToken(r, t, fuzzy); if (!m) { ok = false; break; } sum += m; }
        if (!ok) continue; let score = sum / tokens.length; if (r.rec && /^\d{4}/.test(r.rec)) score += Math.max(0, 4 - ((Date.parse(env.today || "2026-01-01") - Date.parse(String(r.rec).slice(0, 10))) / 86400000) / 90); if (r.cat === "Members" || r.cat === "Loans") score += 3; hits.push({ r, score }); }
      return hits; };
    let hits = run(false), fuzzy = false; if (hits.length < 3 && raw.length >= 4) { const more = run(true); if (more.length > hits.length) { hits = more; fuzzy = true; } }
    hits.sort((a, b) => b.score - a.score);
    const byCat = {}; hits.forEach((h) => { (byCat[h.r.cat] = byCat[h.r.cat] || []).push(h); });
    const limit = o.expand ? 40 : per, groups = CATS.filter((c) => byCat[c]).map((c) => ({ cat: c, count: byCat[c].length, top: byCat[c][0].score, items: byCat[c].slice(0, o.expandCat === c ? 40 : limit).map((h) => ({ id: h.r.id, cat: h.r.cat, title: h.r.title, sub: h.r.sub, marks: marks(h.r.title, tokens), subMarks: marks(h.r.sub, tokens), target: h.r.target, ic: h.r.ic, score: Math.round(h.score) })) }));
    groups.sort((a, b) => b.top - a.top || CATS.indexOf(a.cat) - CATS.indexOf(b.cat));
    let didYouMean = []; if (!hits.length) { const t = tokens.filter((x) => x.length >= 3 && !/^\d/.test(x)); const seen = new Set(); t.forEach((w) => { const a = Math.max(1, allowed(w.length)); idx.vocab.forEach((v) => { if (!seen.has(v) && (v.startsWith(w.slice(0, 3)) || lev(v, w, a) <= a) && lev(v, w, a + 1) <= a + 1) { seen.add(v); } }); }); didYouMean = Array.from(seen).slice(0, 5); }
    return { groups, total: hits.length, tokens, fuzzy, didYouMean };
  }
  /* what to show before anything is typed: the screens a person is likely to want */
  const quick = (db, env) => indexFor(db, env).R.filter((r) => r.cat === "Screens").slice(0, 8).map((r) => ({ id: r.id, cat: r.cat, title: r.title, sub: r.sub, marks: [{ t: r.title, hit: false }], subMarks: [{ t: r.sub, hit: false }], target: r.target, ic: r.ic }));
  return { search, quick, marks, CATS, HELP, SETTINGS, lev, norm, phoneKeys };
});
