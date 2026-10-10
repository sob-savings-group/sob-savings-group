/* SOB client/pdf — turns the branded statement/report page (the same HTML that is printed) into a real, text-based A4 PDF FILE, in the browser,
   with no print dialog and no library: works the same on a phone and on a computer. The letterhead (logo, group name, title, period) and the officers' footer
   with "Page x of y" are drawn on EVERY page; long tables continue on the next page with their column headings repeated.
   It reads the DOM of the page produced by reports.brandedPage(), so the printed copy and the downloaded copy always say the same thing. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.pdf = api; }
})(typeof self !== "undefined" ? self : this, function () {
  const PW = 595.28, PH = 841.89, ML = 34, MR = 34, CW = PW - ML - MR, FOOT_TOP = PH - 70, HDR1 = 98, HDR2 = 56;
  const NAVY = "#14213d", DEEP = "#0f2a56", GOLD = "#b8892b", GREY = "#41506b", HAIR = "#e1e7f2", HEADBG = "#eef2fa", ZEBRA = "#f7f9fd";
  /* Helvetica / Helvetica-Bold advance widths (1/1000 em) for the printable ASCII range, the rest of WinAnsi uses the table below. */
  const REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  /* characters outside ASCII that the standard fonts can show (WinAnsi code, regular width, bold width) */
  const SPECIAL = { "–": [150, 556, 556], "—": [151, 1000, 1000], "·": [183, 278, 278], "×": [215, 584, 584], "•": [149, 350, 350], "’": [146, 222, 278], "‘": [145, 222, 278], "“": [147, 333, 500], "”": [148, 333, 500], "…": [133, 1000, 1000], " ": [32, 278, 278], "é": [233, 556, 556], "è": [232, 556, 556], "à": [224, 556, 556], "ñ": [241, 556, 556], "ü": [252, 556, 556] };
  const ASCII_FOR = { "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "−": "-", "✓": "ok", "✔": "ok", "✕": "x", "«": "<<", "»": ">>", " ": " ", " ": " ", "​": "" };
  const clean = (s) => String(s == null ? "" : s).replace(/[→←≥≤−✓✔✕«»  ​]/g, (c) => ASCII_FOR[c]).replace(/[\r\n\t]+/g, " ");
  const codeOf = (ch) => { const c = ch.charCodeAt(0); if (c >= 32 && c < 127) return c; if (SPECIAL[ch]) return SPECIAL[ch][0]; return 63; };   // unknown -> "?"
  const adv = (ch, bold) => { const c = ch.charCodeAt(0); if (c >= 32 && c < 127) return (bold ? BOLD : REG)[c - 32]; const s = SPECIAL[ch]; return s ? s[bold ? 2 : 1] : 556; };
  const widthOf = (t, bold, size) => { let w = 0; for (const ch of t) w += adv(ch, bold); return (w * size) / 1000; };
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return ((n >> 16) & 255) / 255 + " " + ((n >> 8) & 255) / 255 + " " + (n & 255) / 255; };
  const esc = (t) => { let o = ""; for (const ch of t) { const c = codeOf(ch); const s = String.fromCharCode(c); o += s === "(" || s === ")" || s === "\\" ? "\\" + s : s; } return o; };
  const num = (n) => (Math.round(n * 100) / 100).toString();

  /* ---------- inline text -> runs ([{t, b, c}]) ---------- */
  function runsOf(node, bold, color) {
    const out = [];
    (function walk(n, b, c) {
      n.childNodes.forEach((k) => {
        if (k.nodeType === 3) { const t = clean(k.nodeValue); if (t) out.push({ t, b, c }); }
        else if (k.nodeType === 1) {
          const tag = k.tagName.toLowerCase(); if (tag === "style" || tag === "script" || tag === "img") return;
          if (tag === "br") { out.push({ t: "\n", b, c }); return; }
          const cl = k.className || "";
          if (/\bpill\b/.test(cl)) walk(k, true, /\bw\b/.test(cl) ? "#8f5a08" : "#0a6e4c");
          else walk(k, b || tag === "b" || tag === "strong" || tag === "th", c);
        }
      });
    })(node, !!bold, color || null);
    return out;
  }
  const textOf = (node) => runsOf(node, false).map((r) => r.t).join("").replace(/\s+/g, " ").trim();
  /* greedy line breaking of runs into lines of words */
  function wrap(runs, maxW, size) {
    const words = [];
    runs.forEach((r) => { if (r.t === "\n") { words.push({ br: true }); return; } r.t.split(/(\s+)/).forEach((p) => { if (!p) return; if (/^\s+$/.test(p)) { words.push({ sp: true, b: r.b }); } else words.push({ t: p, b: r.b, c: r.c }); }); });
    const lines = []; let cur = { items: [], w: 0 }, pendingSpace = false;
    const push = () => { lines.push(cur); cur = { items: [], w: 0 }; pendingSpace = false; };
    words.forEach((w) => {
      if (w.br) { push(); return; }
      if (w.sp) { pendingSpace = cur.items.length > 0; return; }
      const sw = pendingSpace ? widthOf(" ", w.b, size) : 0, ww = widthOf(w.t, w.b, size);
      if (cur.items.length && cur.w + sw + ww > maxW) push();
      if (ww > maxW) {                                               // one very long token: break it by characters
        let piece = "", pw = 0;
        for (const ch of w.t) { const cw = widthOf(ch, w.b, size); if (pw + cw > maxW && piece) { cur.items.push({ t: piece, b: w.b, c: w.c, gap: 0 }); cur.w += pw; push(); piece = ""; pw = 0; } piece += ch; pw += cw; }
        if (piece) { cur.items.push({ t: piece, b: w.b, c: w.c, gap: 0 }); cur.w += pw; }
        pendingSpace = false; return;
      }
      const gap = cur.items.length ? sw : 0; cur.items.push({ t: w.t, b: w.b, c: w.c, gap }); cur.w += gap + ww; pendingSpace = false;
    });
    if (cur.items.length || !lines.length) lines.push(cur);
    return lines;
  }
  const maxWordW = (runs, size) => { let m = 0; runs.forEach((r) => r.t.split(/\s+/).forEach((w) => { if (w) m = Math.max(m, widthOf(w, r.b, size)); })); return m; };
  const oneLineW = (runs, size) => runs.reduce((a, r) => a + (r.t === "\n" ? 0 : widthOf(r.t, r.b, size)), 0);

  /* ---------- the document builder ---------- */
  function build(doc, opts) {
    opts = opts || {};
    const title = textOf(doc.querySelector(".hd .r") || doc.querySelector("title") || doc.body) || "SOB document";
    const groupName = textOf(doc.querySelector(".hd .g") || { childNodes: [] }) || "Sons of Bethel (SOB) Savings Group";
    const subtitle = doc.querySelector(".hd .p") ? textOf(doc.querySelector(".hd .p")) : "";
    const logoSrc = doc.querySelector(".hd img") ? doc.querySelector(".hd img").getAttribute("src") : "";
    const officers = Array.from(doc.querySelectorAll(".ft .o > div")).map((d) => { const b = d.querySelector("b"), n = b ? textOf(b) : "", rest = textOf(d).slice(n.length).trim(); return [n, rest]; });
    const logo = parseJpeg(logoSrc);
    const pages = []; let page = null, y = 0;
    const newPage = () => { page = { ops: [] }; pages.push(page); y = pages.length === 1 ? HDR1 : HDR2; };
    const bottom = () => FOOT_TOP - 6;
    const ensure = (h) => { if (!page) newPage(); if (y + h > bottom()) newPage(); };
    const text = (x, base, t, bold, size, color) => { if (t === "") return; page.ops.push("BT /" + (bold ? "F2" : "F1") + " " + num(size) + " Tf " + hex(color || NAVY) + " rg " + num(x) + " " + num(PH - base) + " Td (" + esc(clean(t)) + ") Tj ET"); };
    const rect = (x, top, w, h, fill, stroke) => { page.ops.push((fill ? hex(fill) + " rg " : "") + (stroke ? hex(stroke) + " RG 0.6 w " : "") + num(x) + " " + num(PH - top - h) + " " + num(w) + " " + num(h) + " re " + (fill && stroke ? "B" : fill ? "f" : "S")); };
    const line = (x1, y1, x2, y2, w, color) => { page.ops.push(hex(color) + " RG " + num(w) + " w " + num(x1) + " " + num(PH - y1) + " m " + num(x2) + " " + num(PH - y2) + " l S"); };
    const drawLine = (ln, x, base, size, w, align, defColor) => {
      let cx = align === "right" ? x + w - ln.w : align === "center" ? x + (w - ln.w) / 2 : x;
      ln.items.forEach((it) => { cx += it.gap; text(cx, base, it.t, it.b, size, it.c || defColor); cx += widthOf(it.t, it.b, size); });
    };
    /* a paragraph of runs in a box of width w */
    function para(runs, size, opt) {
      opt = opt || {}; const x = opt.x == null ? ML : opt.x, w = opt.w == null ? CW : opt.w, pad = opt.pad || 0, lh = size * 1.32, lines = wrap(runs, w - 2 * pad, size), h = lines.length * lh + 2 * pad;
      if (opt.keepNext) ensure(h + 60); else ensure(Math.min(h, lh * 2 + 2 * pad));
      let i = 0;
      while (i < lines.length) {
        const room = Math.max(1, Math.floor((bottom() - y - 2 * pad) / lh)), take = lines.slice(i, i + room), hh = take.length * lh + 2 * pad;
        if (take.length < lines.length - i && room < 2) { newPage(); continue; }
        if (opt.fill || opt.stroke) rect(x, y, w, hh, opt.fill, opt.stroke);
        take.forEach((ln, k) => drawLine(ln, x + pad, y + pad + lh * k + size * 0.95, size, w - 2 * pad, opt.align, opt.color));
        y += hh; i += take.length;
        if (i < lines.length) newPage();
      }
      y += opt.after == null ? 3 : opt.after;
    }
    /* heading with the gold rule */
    function heading(t, size) { size = size || 11.5; ensure(size * 2 + 70 > 120 ? 120 : size * 2 + 70); y += 8; text(ML, y + size, clean(t), true, size, DEEP); y += size + 3; line(ML, y, ML + CW, y, 1.4, GOLD); y += 5; }

    /* ---- tables ---- */
    function readTable(t) {
      const rows = [];
      t.querySelectorAll("tr").forEach((tr) => {
        if (tr.closest("table") !== t) return;
        const head = !!tr.closest("thead") || (tr.children.length && Array.from(tr.children).every((c) => c.tagName === "TH") && t.classList.contains("d")), cells = [];
        Array.from(tr.children).forEach((c) => { const cl = c.className || ""; cells.push({ runs: runsOf(c, c.tagName === "TH" || head), num: /\bn\b/.test(cl), span: Number(c.getAttribute("colspan")) || 1, th: c.tagName === "TH" }); });
        if (cells.length) rows.push({ head, cells, cls: tr.className || "" });
      });
      return rows;
    }
    function drawData(t) {
      const rows = readTable(t); if (!rows.length) return;
      const size = 8.4, pad = 4, ncol = Math.max.apply(null, rows.map((r) => r.cells.reduce((a, c) => a + c.span, 0)));
      const nat = new Array(ncol).fill(0), min = new Array(ncol).fill(0), isNum = new Array(ncol).fill(false);
      rows.forEach((r) => { let ci = 0; r.cells.forEach((c) => { if (c.span === 1) { nat[ci] = Math.max(nat[ci], oneLineW(c.runs, size) + 2 * pad + 2); min[ci] = Math.max(min[ci], Math.min(maxWordW(c.runs, size), 90) + 2 * pad + 2); if (c.num) isNum[ci] = true; } ci += c.span; }); });
      const cap = CW * 0.55; for (let i = 0; i < ncol; i++) { nat[i] = Math.min(Math.max(nat[i], min[i]), Math.max(cap, min[i])); }
      let wd; const sumN = nat.reduce((a, b) => a + b, 0), sumM = min.reduce((a, b) => a + b, 0);
      if (sumN <= CW) { const extra = CW - sumN; wd = nat.map((n) => n + (extra * n) / sumN); }
      else if (sumM >= CW) wd = min.map((m) => (m * CW) / sumM);
      else { const rem = CW - sumM, want = nat.map((n, i) => n - min[i]), sw = want.reduce((a, b) => a + b, 0) || 1; wd = min.map((m, i) => m + (rem * want[i]) / sw); }
      if (typeof window !== "undefined" && window.PDFDBG) console.log("W", JSON.stringify({nat,min,wd,CW}));
      const xs = [ML]; wd.forEach((w) => xs.push(xs[xs.length - 1] + w));
      const lay = rows.map((r) => { let ci = 0; const cs = r.cells.map((c) => { const w = xs[ci + c.span] - xs[ci] - 2 * pad, lines = wrap(c.runs, w, size); const o = { c, ci, lines, x: xs[ci], w: xs[ci + c.span] - xs[ci] }; ci += c.span; return o; }); return { r, cs, h: Math.max.apply(null, cs.map((o) => o.lines.length)) * size * 1.3 + 2 * 2.6 }; });
      const headRows = lay.filter((l) => l.r.head);
      const drawRow = (l, idx) => {
        if (l.r.head) rect(ML, y, CW, l.h, HEADBG); else if (idx % 2 === 1) rect(ML, y, CW, l.h, ZEBRA);
        l.cs.forEach((o) => o.lines.forEach((ln, k) => drawLine(ln, o.x + pad, y + 2.6 + size * 0.98 + k * size * 1.3, size, o.w - 2 * pad, o.c.num || (o.c.th && o.c.num) ? "right" : "left", NAVY)));
        line(ML, y + l.h, ML + CW, y + l.h, l.r.head ? 0.9 : 0.4, l.r.head ? "#9fb0cf" : HAIR); y += l.h;
      };
      let body = 0; ensure((headRows[0] ? headRows[0].h : 0) + (lay.find((l) => !l.r.head) || { h: 0 }).h + 4); y += 2;
      lay.forEach((l) => {
        if (y + l.h > bottom()) { newPage(); y += 2; headRows.forEach((hr) => drawRow(hr, 0)); }
        if (l.r.head) { if (headRows.indexOf(l) >= 0 && y === (pages.length === 1 ? HDR1 : HDR2) + 2 && false) return; drawRow(l, 0); } else drawRow(l, body++);
      });
      y += 5;
    }
    function drawSum(t) {
      const rows = readTable(t); if (!rows.length) return; const size = 9.2;
      rows.forEach((r) => {
        const lab = r.cells[0], val = r.cells[r.cells.length - 1], tot = /\btot\b/.test(r.cls), sub = /\bsub\b/.test(r.cls), ind = sub ? 14 : 0, valW = Math.min(CW * 0.4, Math.max(60, oneLineW(val.runs, size) + 8)), labW = CW - valW - ind - 10;
        const ll = wrap(lab.runs.map((x) => Object.assign({}, x, { b: tot || x.b })), labW, size), vl = wrap(val.runs.map((x) => Object.assign({}, x, { b: tot || x.b })), valW, size), n = Math.max(ll.length, vl.length), h = n * size * 1.3 + 5;
        ensure(h); if (tot) line(ML, y, ML + CW, y, 1.2, DEEP);
        ll.forEach((ln, k) => drawLine(ln, ML + ind, y + 2.5 + size * 0.98 + k * size * 1.3, size, labW, "left", tot ? DEEP : NAVY));
        vl.forEach((ln, k) => drawLine(ln, ML + CW - valW, y + 2.5 + size * 0.98 + k * size * 1.3, size, valW, "right", tot ? DEEP : NAVY));
        line(ML, y + h, ML + CW, y + h, 0.4, HAIR); y += h;
      });
      y += 5;
    }
    function drawIdb(d) {
      const items = Array.from(d.children).map((c) => { const b = c.querySelector("b"), v = c.querySelector("span"); return [b ? textOf(b) : "", v ? textOf(v) : textOf(c)]; });
      const size = 9, colW = (CW - 20) / 2, lab = 66, rowsN = Math.ceil(items.length / 2), lineH = size * 1.35;
      const heights = []; for (let r = 0; r < rowsN; r++) { let m = 1; [0, 1].forEach((k) => { const it = items[r * 2 + k]; if (it) m = Math.max(m, wrap([{ t: it[1], b: false }], colW - lab - 6, size).length); }); heights.push(m * lineH); }
      const h = heights.reduce((a, b) => a + b, 0) + 12; ensure(h + 8); rect(ML, y, CW, h, "#f9fbfe", "#d5ddec"); let yy = y + 6;
      for (let r = 0; r < rowsN; r++) { [0, 1].forEach((k) => { const it = items[r * 2 + k]; if (!it) return; const x = ML + 8 + k * (colW + 4); text(x, yy + size * 0.95, it[0], true, size, GREY); wrap([{ t: it[1], b: false }], colW - lab - 6, size).forEach((ln, j) => drawLine(ln, x + lab, yy + size * 0.95 + j * lineH, size, colW - lab - 6, "left", NAVY)); }); yy += heights[r]; }
      y += h + 6;
    }
    /* ---- the block walker ---- */
    function block(node) {
      node.childNodes.forEach((k) => {
        if (k.nodeType === 3) { const t = clean(k.nodeValue).trim(); if (t) para([{ t, b: false }], 9.5); return; }
        if (k.nodeType !== 1) return;
        const tag = k.tagName.toLowerCase(), cl = k.className || ""; if (tag === "style" || tag === "script" || tag === "img") return;
        if (tag === "table") { if (/\bsum\b/.test(cl)) drawSum(k); else drawData(k); return; }
        if (/\bidb\b/.test(cl)) { drawIdb(k); return; }
        if (tag === "h1" || tag === "h2") { heading(textOf(k), 13); return; }
        if (tag === "h3" || tag === "h4" || /\bsec\b/.test(cl)) { heading(textOf(k), 11.5); return; }
        if (/\blh\b/.test(cl)) { const b = k.querySelector("b"), p = k.querySelector(".pill"); ensure(70); y += 8; text(ML, y + 11, textOf(b || k), true, 11, DEEP); if (p) { const t = textOf(p), w = widthOf(t, true, 8.5); text(ML + CW - w, y + 10.5, t, true, 8.5, /\bw\b/.test(p.className || "") ? "#8f5a08" : "#0a6e4c"); } y += 17; return; }
        if (/\bconf\b/.test(cl)) { para(runsOf(k), 8.4, { fill: "#fdf8ea", stroke: "#d9b96a", pad: 5, color: "#5d430a", after: 6 }); return; }
        if (/\bcf\b/.test(cl)) { para(runsOf(k), 8.8, { color: GREY }); return; }
        if (/\bfine\b/.test(cl)) { para(runsOf(k), 7.8, { color: "#666666", after: 4 }); return; }
        if (tag === "p" || tag === "li") { para(runsOf(k), 9.5); return; }
        const hasBlock = Array.from(k.children).some((c) => /^(div|table|h[1-6]|p|ul|ol|section)$/i.test(c.tagName));
        if (hasBlock) block(k); else { const rs = runsOf(k); if (rs.length) para(rs, 9.5); }
      });
    }
    const bodyCell = doc.querySelector("table.page > tbody > tr > td") || doc.body;
    newPage(); block(bodyCell);

    /* ---- page chrome: letterhead on every page, officers + page numbers ---- */
    const total = pages.length;
    pages.forEach((pg, i) => {
      page = pg; const first = i === 0, ops = pg.ops; pg.ops = [];
      const logoH = first ? 52 : 26, lx = ML, ly = first ? 20 : 14;
      if (logo) { const w = (logo.w / logo.h) * logoH; pg.ops.push("q " + num(w) + " 0 0 " + num(logoH) + " " + num(lx) + " " + num(PH - ly - logoH) + " cm /Im1 Do Q"); }
      const tx = ML + (logo ? (logo.w / logo.h) * logoH + 12 : 0), tw = PW - MR - tx;
      if (first) {
        text(tx, ly + 15, groupName, true, 15, "#0b1f3a");
        const tl = wrap([{ t: title, b: true }], tw, 12); tl.slice(0, 2).forEach((ln, k) => drawLine(ln, tx, ly + 31 + k * 14, 12, tw, "left", NAVY));
        if (subtitle) text(tx, ly + 31 + Math.min(2, tl.length) * 14 + 1, subtitle, false, 8.4, "#444444");
        line(ML, 84, ML + CW, 84, 2.6, GOLD);
      } else {
        text(tx, ly + 11, groupName, true, 9.5, "#0b1f3a");
        const t1 = wrap([{ t: title, b: false }], tw, 8.2)[0]; if (t1) drawLine(t1, tx, ly + 22, 8.2, tw, "left", GREY);
        line(ML, 46, ML + CW, 46, 1.6, GOLD);
      }
      pg.ops = pg.ops.concat(ops);
      line(ML, FOOT_TOP + 4, ML + CW, FOOT_TOP + 4, 1.6, GOLD);
      const colW = CW / 3; officers.slice(0, 6).forEach((o, k) => { const cx = ML + (k % 3) * colW, cy = FOOT_TOP + 14 + Math.floor(k / 3) * 20; text(cx, cy, o[0], true, 7.8, "#222222"); text(cx, cy + 9, o[1], false, 7.6, "#333333"); });
      text(ML, PH - 14, groupName, false, 7.4, "#666666");
      const pn = "Page " + (i + 1) + " of " + total; text(ML + CW - widthOf(pn, false, 8), PH - 14, pn, false, 8, "#666666");
    });
    return assemble(pages, logo, title);
  }

  /* ---------- JPEG logo (embedded as-is, no re-encoding) ---------- */
  function parseJpeg(src) {
    const m = /^data:image\/jpe?g;base64,(.+)$/i.exec(src || ""); if (!m) return null;
    const bin = typeof atob === "function" ? atob(m[1]) : Buffer.from(m[1], "base64").toString("binary"), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    let i = 2; while (i < b.length) { if (b[i] !== 0xff) { i++; continue; } const mk = b[i + 1]; if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { bytes: b, h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], n: b[i + 9] }; i += 2 + ((b[i + 2] << 8) | b[i + 3]); }
    return null;
  }
  /* ---------- the PDF file ---------- */
  function assemble(pages, logo, title) {
    const parts = [], offs = []; let len = 0;
    const put = (x) => { const u = typeof x === "string" ? Uint8Array.from(x, (c) => c.charCodeAt(0) & 255) : x; parts.push(u); len += u.length; };
    const obj = (id, body) => { offs[id] = len; put(id + " 0 obj\n"); put(body); put("\nendobj\n"); };
    const nPages = pages.length, firstPageObj = 7, kids = []; for (let i = 0; i < nPages; i++) kids.push(firstPageObj + 2 * i + 1 + " 0 R");
    put("%PDF-1.4\n%âãÏÓ\n");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Count " + nPages + " /Kids [" + kids.join(" ") + "] >>");
    obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    if (logo) { offs[5] = len; put("5 0 obj\n<< /Type /XObject /Subtype /Image /Width " + logo.w + " /Height " + logo.h + " /ColorSpace " + (logo.n === 1 ? "/DeviceGray" : "/DeviceRGB") + " /BitsPerComponent 8 /Filter /DCTDecode /Length " + logo.bytes.length + " >>\nstream\n"); put(logo.bytes); put("\nendstream\nendobj\n"); } else obj(5, "<< >>");
    const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
    obj(6, "<< /Title (" + esc(title) + ") /Author (Sons of Bethel Savings Group) /Producer (SOB platform) /CreationDate (D:" + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + "Z) >>");
    pages.forEach((pg, i) => {
      const cid = firstPageObj + 2 * i, pid = cid + 1, stream = pg.ops.join("\n");
      offs[cid] = len; put(cid + " 0 obj\n<< /Length " + stream.length + " >>\nstream\n"); put(stream); put("\nendstream\nendobj\n");
      obj(pid, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PW + " " + PH + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>" + (logo ? " /XObject << /Im1 5 0 R >>" : "") + " >> /Contents " + cid + " 0 R >>");
    });
    const count = firstPageObj + 2 * nPages, xref = len; put("xref\n0 " + count + "\n0000000000 65535 f \n");
    for (let i = 1; i < count; i++) put(String(offs[i]).padStart(10, "0") + " 00000 n \n");
    put("trailer\n<< /Size " + count + " /Root 1 0 R /Info 6 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
    const out = new Uint8Array(len); let p = 0; parts.forEach((u) => { out.set(u, p); p += u.length; }); return out;
  }

  /* public: HTML text (the branded page) -> Uint8Array PDF */
  function fromHTML(html) { const doc = new DOMParser().parseFromString(String(html), "text/html"); return build(doc); }
  const fileName = (title, date) => String(title || "SOB").replace(/[–—]/g, "-").replace(/[^A-Za-z0-9()\- ]+/g, " ").replace(/\s+/g, " ").trim().replace(/ /g, "_").slice(0, 90) + (date && !/\d{4}/.test(String(title)) ? "_" + date : "") + ".pdf";
  /* save the file to the device: a normal download, no print dialog (works from a file, a web page, a phone browser) */
  function save(bytes, name) {
    const blob = new Blob([bytes], { type: "application/pdf" }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noopener"; a.style.display = "none"; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 30000); return name;
  }
  return { fromHTML, build, save, fileName, widthOf };
});
