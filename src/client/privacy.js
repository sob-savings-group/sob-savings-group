/* SOB client/privacy — a DISPLAY-ONLY switch that shows SOB IDs instead of member names in reports, previews, PDFs, prints and WhatsApp text.
   It only rewrites the text that is about to be shown; the member register, transactions, balances and audit trail are never touched.
   The officers' footer on the letterhead is left as it is (it is the group's signature, not a member listing). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.privacy = api; }
})(typeof self !== "undefined" ? self : this, function () {
  const HONORIFIC = /^(?:(?:mr|mrs|miss|ms|min|minister|elder|pastor|bishop|rev|dr|eng|hon|prof)\.?\s+)+/i;
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

  function build(members) {
    const byName = new Map();   // lower-case variant -> [ids]
    const add = (name, id) => { const n = norm(name); if (n.length < 5) return; const k = n.toLowerCase(); if (!byName.has(k)) byName.set(k, { text: n, ids: [] }); const e = byName.get(k); if (!e.ids.includes(id)) e.ids.push(id); };
    (members || []).forEach((m) => { [m.name, m.originalName].forEach((n) => { if (!n) return; add(n, m.id); const s = norm(n).replace(HONORIFIC, ""); if (s !== norm(n)) add(s, m.id); }); });
    const entries = Array.from(byName.values()).sort((a, b) => b.text.length - a.text.length);
    const idsOf = new Map(); entries.forEach((e) => idsOf.set(e.text.toLowerCase(), e.ids.slice().sort().join("/")));
    const pat = (list) => list.length ? new RegExp("(?<![A-Za-z0-9\\u00c0-\\u024f])(?:" + list.join("|") + ")(?![A-Za-z0-9\\u00c0-\\u024f])", "gi") : null;
    const plain = pat(entries.map((e) => escRe(e.text).replace(/ /g, "\\s+"))), html = pat(entries.map((e) => escRe(escHtml(e.text)).replace(/ /g, "\\s+")));
    const tidy = (s) => s.replace(/(SOB-\d+)\s*[(\[]\s*\1\s*[)\]]/g, "$1").replace(/(SOB-\d+)(\s*[·—–|:,-]\s*)\1(?!\d)/g, "$1");
    const lookup = (m) => idsOf.get(norm(m).toLowerCase().replace(/&amp;/g, "&").replace(/&#39;/g, "'")) || "";
    const hideText = (s) => (typeof s === "string" && plain ? tidy(s.replace(plain, (m) => lookup(m) || m)) : s);
    /* a whole printable page: letterhead + body are rewritten, the officers' footer (tfoot) and every HTML tag are left alone */
    const hideHTML = (h) => !html ? h : String(h).split(/(<tfoot>[\s\S]*?<\/tfoot>)/).map((part, i) => i % 2 ? part : part.split(/(<[^>]*>)/).map((p, j) => j % 2 ? p : tidy(p.replace(html, (m) => lookup(m) || m))).join("")).join("");
    const hideReport = (rep) => {
      const walk = (v) => Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.keys(v).reduce((o, k) => { o[k] = typeof v[k] === "function" ? v[k] : walk(v[k]); return o; }, {}) : hideText(v);
      const out = walk(rep); if (typeof rep.printHTML === "function") out.printHTML = (meta) => hideHTML(rep.printHTML(meta)); return out;
    };
    return { hideText, hideHTML, hideReport, active: !!plain };
  }
  return { build };
});
