/* Shared UI components. All text goes through textContent (no innerHTML with data) so ledger content can never inject markup. */
(function () {
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v); });
    kids.flat().forEach((c) => { if (c == null || c === false) return; e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  };
  const LABELS = { AwaitingApproval: "Awaiting approval" };
  const ugx = (n) => (n == null || n === "" ? "—" : "UGX " + Math.round(Number(n)).toLocaleString("en-US"));
  const num = (n) => Math.round(Number(n)).toLocaleString("en-US");
  const badge = (text, kind) => h("span", { class: "badge b-" + (kind || "mute") }, LABELS[text] || text);
  /* Card: clickable when onOpen is given (the drill-down pattern used on every screen). */
  const Card = (label, value, sub, onOpen, tone) => h("div", Object.assign({ class: "card" + (onOpen ? " click" : ""), "data-card": label }, onOpen ? { tabindex: 0, role: "button", onclick: onOpen, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(e); } } } : {}),
    h("div", { class: "lbl" }, LABELS[label] || label), h("div", { class: "val" + (tone ? " t-" + tone : "") }, value), sub ? h("div", { class: "sub" }, sub) : null);
  /* Table: on a computer a real table; on a phone each row becomes ONE compact tappable line (title, small sub-line, value on the right).
     A column may say which part it plays with m: "t" title, "s" sub-line, "v" value, "b" badge, "x" hide on phones. Without hints the roles are worked out from the column names and types
     (only for tables whose rows open a record when tapped; other tables keep every field, stacked and compact). */
  const DATEY = /^(date|when|created|prepared|from|paid out)$/i, VALUEY = /amount|balance|savings|owed|total|paid|principal|pool|available/i, TITLEY = /member|name|loan|borrower|guarantor|subject/i;
  const roles = (cols, onRow) => {
    if (cols.some((c) => c.m)) return cols.map((c) => c.m || "x");
    if (!onRow || cols.length < 4) return null;
    const r = cols.map(() => "x"), idx = (f) => cols.findIndex(f);
    let v = -1; cols.forEach((c, i) => { if (c.num && VALUEY.test(c.label)) v = i; }); if (v < 0) cols.forEach((c, i) => { if (c.num) v = i; });
    let t = idx((c, i) => !c.num && i !== v && TITLEY.test(c.label)); if (t < 0) t = idx((c, i) => !c.num && i !== v && !DATEY.test(c.label)); if (t < 0) t = 0;
    let sb = idx((c, i) => i !== t && i !== v && DATEY.test(c.label)); if (sb < 0) sb = idx((c, i) => i !== t && i !== v && !c.num && c.label);
    r[t] = "t"; if (v >= 0) r[v] = "v"; if (sb >= 0) r[sb] = "s"; return r;
  };
  const Table = (cols, rows, onRow, emptyText, foot) => { const rl = roles(cols, onRow);
    return h("div", { class: "scroll" + (rl ? " hinted" : "") }, h("table", { class: foot ? "acct" : "" },
    h("thead", null, h("tr", null, cols.map((c) => h("th", { class: c.num ? "n" : "" }, c.label)))),
    h("tbody", null, rows.length ? rows.map((r) => h("tr", Object.assign({ class: onRow ? "click" : "" }, onRow ? { onclick: () => onRow(r) } : {}),
      cols.map((c, i) => (() => { let v = c.render ? c.render(r) : r[c.key], ng = !!(c.num && c.neg && c.neg(r)); if (c.num && !c.neg && typeof v === "string" && /^[-\u2212]\s*(UGX\s*)?[\d,]+(\.\d+)?$/.test(v.trim())) { ng = true; v = "(" + v.trim().replace(/^[-\u2212]\s*/, "") + ")"; } else if (c.num && !c.neg && typeof v === "number" && v < 0) { ng = true; v = "(" + Math.abs(v).toLocaleString("en-US") + ")"; }
        let m = rl ? rl[i] : ""; if (rl && v && v.nodeType && /\bbadge\b/.test(v.className || "") && m !== "t") m = "b";
        return h("td", { class: (c.num ? "n" : "") + (ng ? " neg" : "") + (rl ? " m-" + m : ""), "data-label": c.label || "" }, v); })()))) : [h("tr", { class: "empty-row" }, h("td", { colspan: cols.length, class: "wrap" }, Empty({ icon: "book", title: emptyText || "Nothing to show yet", text: emptyText ? "" : "Entries will appear here as they are recorded." })))]),
    foot && rows.length ? h("tfoot", null, h("tr", { class: "tot" }, cols.map((c, i) => h("td", { class: (c.num ? "n" : "") + (c.num && foot[i] != null && foot[i].neg ? " neg" : ""), "data-label": c.label || "" }, foot[i] ? foot[i].text : "")))) : null)); };
  const State = (kind, msg, retry) => kind === "loading" ? Skeleton() : h("div", { class: "state err" }, Icon("alert", 28), h("div", null, msg), retry ? h("button", { class: "primary", onclick: retry }, "Try again") : null);
  function Modal(title, body, opts) {
    const bg = h("div", { class: "modal-bg", role: "dialog", "aria-modal": "true", "aria-label": title, onclick: (e) => { if (e.target === bg && !(opts && opts.sticky)) close(); } });   // a form is never dismissed by a stray tap outside it
    const onKey = (e) => { if (e.key === "Escape") close(); };
    /* the phone/browser Back button closes the top window instead of leaving the app */
    let pushed = false; try { history.pushState({ sobModal: 1 }, ""); pushed = true; } catch (e) {}
    const close = () => { document.removeEventListener("keydown", onKey); const was = bg.isConnected; bg.remove(); if (was && pushed && history.state && history.state.sobModal) { try { window.SOBUI.ignorePop = (window.SOBUI.ignorePop || 0) + 1; history.back(); } catch (e) { window.SOBUI.ignorePop = Math.max(0, (window.SOBUI.ignorePop || 1) - 1); } } };
    document.addEventListener("keydown", onKey);
    bg.append(h("div", { class: "modal" }, h("div", { class: "grab" }), h("div", { class: "mhead" }, h("h2", null, title), h("button", { class: "closebtn", "data-close": "1", "aria-label": "Close", onclick: close }, Icon("x", 18), " Close")), body));
    document.body.append(bg); return { close, el: bg };
  }
  /* Busy: one global "working" indicator (spinner + message + progress bar) used for sign-in, loading, saving and report generation. */
  const Busy = (() => { let el = null, n = 0, tick = null, t0 = 0, base = ""; const msgEl = h("span", { id: "busy-msg" }, "");
    const ensure = () => { if (!el) { el = h("div", { id: "busy", class: "busy", role: "status", "aria-live": "polite" }, h("div", { class: "busy-bar" }), h("div", { class: "busy-box" }, h("span", { class: "spin" }), msgEl)); } if (!el.isConnected) document.body.append(el); };
    /* After 4 s the message says how long it has been and why (Google's servers can need up to a minute on a cold start) so it never looks frozen. */
    const paint = () => { const s = Math.round((Date.now() - t0) / 1000); msgEl.textContent = base + (s >= 4 ? " " + s + "s — Google is still working, please wait" : ""); };
    const show = (m) => { ensure(); base = m || "Working…"; if (!tick) { t0 = Date.now(); tick = setInterval(paint, 1000); } paint(); el.style.display = "flex"; document.body.setAttribute("aria-busy", "true"); };
    const hide = () => { if (tick) { clearInterval(tick); tick = null; } if (el) el.style.display = "none"; document.body.removeAttribute("aria-busy"); };
    return { set(m) { if (m) show(m); else hide(); },
      async run(m, fn) { n++; show(m); await new Promise((r) => setTimeout(r, 30)); try { return await fn(); } finally { if (--n <= 0) { n = 0; hide(); } } } }; })();
  /* kind: true/"bad" = error, "warn" = needs attention, anything else = success */
  function toast(msg, kind) { const k = kind === true || kind === "bad" ? "bad" : kind === "warn" ? "warn" : "ok"; const old = document.querySelector(".toast"); if (old) old.remove();
    const t = h("div", { class: "toast " + k, role: k === "bad" ? "alert" : "status" }, Icon(k === "ok" ? "check" : "alert"), h("span", null, msg)); document.body.append(t); setTimeout(() => t.remove(), k === "bad" ? 7000 : 3500); }
  /* Form modal: fields [{name,label,type,value,options,required}] -> onSubmit(values) may throw; the message is shown, nothing is half-saved. */
  function Form(title, fields, onSubmit, submitLabel) {
    const inputs = {};
    const body = h("div", null, fields.map((f) => {
      if (f.type === "note") return f.node || h("p", { class: "mute" }, f.text);
      if (f.other && f.options) {   // a list with an "Other (Specify)" facility: choosing it reveals a text box and the typed text is what is recorded
        const OTHER = "__other__", sel = h("select", { name: f.name + "__sel" }, f.options.map((o) => h("option", { value: o.value ?? o }, o.label ?? o)).concat([h("option", { value: OTHER }, "Other (Specify)")]));
        const txt = h("input", { type: "text", name: f.name + "__other", placeholder: "Please specify", maxlength: "60", "aria-label": f.label + " (specify)" }); txt.hidden = true;
        sel.addEventListener("change", () => { txt.hidden = sel.value !== OTHER; if (!txt.hidden) txt.focus(); });
        const el0 = { get value() { return sel.value === OTHER ? txt.value.trim() : sel.value; }, set value(v) { sel.value = v; }, setAttribute() {} };
        if (f.value != null && f.value !== "") { const known = f.options.some((o) => String(o.value ?? o) === String(f.value)); if (known) sel.value = f.value; else { sel.value = OTHER; txt.hidden = false; txt.value = f.value; } }   /* a value recorded earlier that is no longer in the list is kept, shown under Other (Specify) */
        if (f.optional) { const blank = h("option", { value: "" }, "Not stated"); sel.insertBefore(blank, sel.firstChild); if (f.value == null || f.value === "") sel.value = ""; }
        inputs[f.name] = el0; return h("div", null, h("label", null, f.label), sel, txt);
      }
      if (f.type === "chips") {   // tap to choose; "other" reveals a box only when the member needs something not on the list
        const OTHER = "__other__", box = h("div", { class: "chips wrap", role: "group", "aria-label": f.label }), txt = h("input", { type: f.otherType || "text", name: f.name + "__other", placeholder: f.otherPlaceholder || "Type here", "aria-label": f.label + " (other)" }); if (f.inputmode) txt.setAttribute("inputmode", f.inputmode); txt.hidden = true;
        let val = f.value != null ? f.value : ""; const all = f.choices.concat(f.other ? [{ value: OTHER, label: f.other }] : []);
        const paint = () => { box.replaceChildren(...all.map((c) => h("button", { type: "button", class: "chip" + (String(c.value) === String(val) ? " on" : ""), "data-choice": c.value, "aria-pressed": String(String(c.value) === String(val)), onclick: () => { val = c.value; txt.hidden = val !== OTHER; paint(); if (!txt.hidden) txt.focus(); } }, c.label))); };
        paint(); inputs[f.name] = { get value() { return val === OTHER ? txt.value.trim() : val; }, set value(v) { val = v; paint(); }, setAttribute() {} };
        return h("div", null, h("label", null, f.label), box, txt);
      }
      const el = f.options ? h("select", { name: f.name }, f.options.map((o) => h("option", { value: o.value ?? o }, o.label ?? o))) : h(f.type === "textarea" ? "textarea" : "input", { name: f.name, type: f.type || "text", value: f.value ?? "" });
      if (f.max) el.setAttribute("max", f.max); if (f.min != null) el.setAttribute("min", f.min); if (f.inputmode) el.setAttribute("inputmode", f.inputmode); if (f.type === "number" && !f.inputmode) el.setAttribute("inputmode", "decimal"); if (f.type === "date") el.required = true;
      if (f.value != null && f.options) el.value = f.value; inputs[f.name] = el; return h("div", null, h("label", null, f.label), el);
    }));
    const err = h("div", { class: "err", role: "alert" });
    const m = Modal(title, h("div", null, body, err, h("div", { class: "row" }, h("button", { class: "primary", "data-submit": "1", onclick: async () => {
      const v = {}; fields.forEach((f) => { if (f.type !== "note") v[f.name] = inputs[f.name].value; });
      const btn = m.el.querySelector("[data-submit]"); if (btn.disabled) return; btn.disabled = true; err.textContent = "";
      try { await onSubmit(v); m.close(); } catch (e) { err.textContent = friendly(e); btn.disabled = false; }
    } }, submitLabel || "Save"), h("button", { "data-cancel": "1", onclick: () => m.close() }, "Cancel"))), { sticky: true });
    return m;
  }
  const RAW_JS = /\b(is not defined|is not a function|is not iterable|Cannot read propert|Cannot set propert|undefined|null is not|Unexpected token|SyntaxError|ReferenceError|TypeError|RangeError|at \w+ \()/;
  const friendly = (e) => {
    const m = String((e && e.message) || e);
    if (RAW_JS.test(m) && !/^[A-Z][A-Z_]+:/.test(m.trim())) { try { console.error("[SOB] internal error:", e); } catch (x) {} return "Something went wrong on our side. Nothing was lost. Please try again. If it happens again, tell the Treasurer or Secretary."; }
    if (/PENDING_SOB_DECISION/.test(m)) return "Blocked: SOB has not yet decided this rule. " + m.replace(/^.*?PENDING_SOB_DECISION:?\s*/, "");
    if (e && e.code === "CONFLICT") return "Someone else changed the ledger. Your change was not saved — reload and try again.";
    if ((e && e.code === "NETWORK") || /^NETWORK:/.test(m) || /Failed to fetch|NetworkError|Load failed/i.test(m)) return "No internet connection. Check your data or Wi-Fi and try again.";
    if ((e && e.code === "TIMEOUT") || /^TIMEOUT/.test(m)) return "This is taking too long. Check your connection and try again.";
    if (/^ENDPOINT_/.test((e && e.code) || m)) return "The SOB records are not available right now. Please try again in a few minutes. If it continues, tell the Treasurer or Secretary.";
    if (e && e.code === "UNAUTHENTICATED") return "Your session has ended. Please sign in again.";
    if (/^\s*UNKNOWN_COMMAND:/.test(m)) return "The Google backend is out of date. Paste the latest Code.gs in Apps Script, deploy a New version and reload. (Action: " + m.replace(/^\s*UNKNOWN_COMMAND:\s*/, "") + ")";
    const PLAIN = { ALREADY_APPLIED: "You already have a loan application in progress. Please wait until it is decided.", ALREADY_VOIDED: "This record has already been cancelled.", NOT_VOIDED: "This record is not cancelled.", RESTORE_WINDOW_CLOSED: "The time allowed to restore this record has passed. Please enter a new correcting entry instead.", OFFLINE_MODE: "This copy is not connected to the SOB server.", FORBIDDEN: "You do not have permission to do this.", NOT_FOUND: "We could not find that record. Please refresh and try again.", UNKNOWN_MEMBER: "That member was not found.", UNKNOWN_ACTION: "Something went wrong. Please refresh and try again.", INVALID_REQUEST: "Something went wrong. Please refresh and try again.", UNAUTHENTICATED: "Your session has ended. Please sign in again.", BAD_CREDENTIALS: "That did not match. Please check and try again." };
    const code = (/^([A-Z][A-Z_]+)(?::\s*(.*))?$/s.exec(m.trim()) || [])[1];
    if (code && PLAIN[code] && !/\S/.test((/^[A-Z_]+:\s*(.*)$/s.exec(m.trim()) || [, ""])[1])) return PLAIN[code];
    return m.replace(/^[A-Z][A-Z_]+:\s*/, "");
  };

  /* ---------- premium kit: icons + financial components (static SVG constants only; no data ever reaches innerHTML) ---------- */
  const ICONS = { search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3", mail: "M3 6h18v12H3zM3 7l9 7 9-7", home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10", wallet: "M3 7h15a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3V7zm0 0V6a2 2 0 012-2h11M16 14h2", loan: "M3 6h18v12H3zM12 9a3 3 0 100 6 3 3 0 000-6zM6 9v.01M18 15v.01", shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4", receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6", gift: "M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9C9 9 8 6 9.5 5S12 7 12 9zm0 0c3 0 4-3 2.5-4S12 7 12 9z", phone: "M7 2h10a1 1 0 011 1v18a1 1 0 01-1 1H7a1 1 0 01-1-1V3a1 1 0 011-1zM11 18h2", user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0", logout: "M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M20 12H9", key: "M15 9a4 4 0 10-.01 0M12 12l-8 8M7 17l2 2", chart: "M4 20V10M10 20V4M16 20v-8M22 20H2", check: "M5 12l5 5 9-10", alert: "M12 3l10 18H2L12 3zM12 10v5M12 18v.01", info: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5v.01", download: "M12 4v11M7 11l5 5 5-5M5 20h14", print: "M7 8V3h10v5M7 17H4v-7h16v7h-3M7 14h10v7H7z", chevron: "M9 6l6 6-6 6", lock: "M6 11h12v10H6zM8 11V8a4 4 0 018 0v3", users: "M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 11a3 3 0 000-6M21 20a6 6 0 00-4-5.6", book: "M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4zM5 17a3 3 0 013-3h11", clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2", more: "M5 12h.01M12 12h.01M19 12h.01", plus: "M12 5v14M5 12h14", share: "M4 12v7h16v-7M12 3v12M8 7l4-4 4 4", up: "M12 19V5M6 11l6-6 6 6", down: "M12 5v14M6 13l6 6 6-6", bell: "M6 17v-6a6 6 0 0112 0v6l2 2H4l2-2zM10 21h4", x: "M6 6l12 12M18 6L6 18", wifi: "M2 9a15 15 0 0120 0M5 13a10 10 0 0114 0M8.5 16.5a5 5 0 017 0M12 20v.01", sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4", refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" };
  const Icon = (n, size, cls) => { const sp = document.createElement("span"); sp.className = "ic" + (cls ? " " + cls : ""); sp.setAttribute("aria-hidden", "true"); const z = size || 20;
    sp.innerHTML = '<svg viewBox="0 0 24 24" width="' + z + '" height="' + z + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + (ICONS[n] || ICONS.info) + '"/></svg>'; return sp; };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fdate = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || "") ? Number(iso.slice(8, 10)) + " " + MON[Number(iso.slice(5, 7)) - 1] + " " + iso.slice(0, 4) : "");
  const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);
  /* Meaning-bearing colours, used the same way on every screen: available / committed / loan / interest / profit */
  const Hero = (o) => h("section", { class: "hero-card" + (o.cls ? " " + o.cls : ""), "data-card": o.hook || o.label }, h("div", { class: "hl" }, o.label), h("div", { class: "hv" }, o.value), o.sub ? h("div", { class: "hs" }, o.sub) : null, o.children || null);
  const StackBar = (parts) => { const tot = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
    return h("div", { class: "stack" }, h("div", { class: "bar", role: "img", "aria-label": parts.map((p) => p.label + " " + ugx(p.value)).join(", ") }, tot > 0 ? parts.filter((p) => p.value > 0).map((p) => h("i", { class: p.cls, style: "width:" + Math.max(2, (p.value / tot) * 100) + "%" })) : h("i", { class: "none", style: "width:100%" })),
      h("div", { class: "legend" }, parts.map((p) => h("div", { class: "lg" }, h("span", { class: "dot " + p.cls }), h("span", { class: "ll" }, p.label), h("b", null, ugx(p.value))))));
  };
  const Progress = (value, cls, label) => h("div", { class: "prog", role: "progressbar", "aria-valuenow": String(value), "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": label || "" }, h("i", { class: cls || "c-avail", style: "width:" + value + "%" }));
  const Section = (title, right) => h("div", { class: "sect" }, h("h2", null, title), right || null);
  const Row = (o) => h("div", Object.assign({ class: "li" + (o.onOpen ? " click" : "") + (o.cls ? " " + o.cls : "") }, o.onOpen ? { role: "button", tabindex: 0, onclick: o.onOpen, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.onOpen(); } } } : {}),
    o.icon ? h("div", { class: "lic " + (o.tone || "") }, Icon(o.icon)) : null, h("div", { class: "lm" }, h("div", { class: "lt" }, o.title), o.sub ? h("div", { class: "ls" }, o.sub) : null),
    h("div", { class: "lr" }, o.right != null ? h("div", { class: "lv " + (o.rtone || "") }, o.right) : null, o.rightSub ? h("div", { class: "ls" }, o.rightSub) : null), o.onOpen ? Icon("chevron", 16) : null);
  const List = (rows) => h("div", { class: "list" }, rows);
  const Empty = (o) => h("div", { class: "empty" }, h("div", { class: "eic" }, Icon(o.icon || "info", 28)), h("div", { class: "et" }, o.title), o.text ? h("div", { class: "etx" }, o.text) : null, o.action ? h("button", { class: "primary", onclick: o.action.onclick }, o.action.label) : null);
  const Skeleton = () => h("div", { class: "skel-wrap", "aria-busy": "true", "aria-label": "Loading" }, h("div", { class: "skel big" }), h("div", { class: "skel" }), h("div", { class: "skel" }), h("div", { class: "skel" }));
  const Banner = (kind, text, action) => h("div", { class: "banner " + kind, role: kind === "bad" ? "alert" : "status" }, Icon(kind === "ok" ? "check" : kind === "info" ? "info" : "alert"), h("div", { class: "bt" }, text), action ? h("button", { onclick: action.onclick }, action.label) : null);
  const Chips = (opts, val, onChange) => h("div", { class: "chips", role: "tablist" }, opts.map(([k, l]) => h("button", { class: "chip" + (k === val ? " on" : ""), role: "tab", "aria-selected": String(k === val), "data-chip": k, onclick: () => onChange(k) }, l)));
  function Confirm(title, text, label, onYes, danger) {
    const m = Modal(title, h("div", null, h("p", null, text), h("div", { class: "row" }, h("button", { class: danger ? "danger" : "primary", "data-confirm": "1", onclick: async () => { m.close(); await onYes(); } }, label), h("button", { onclick: () => m.close() }, "Cancel")))); return m;
  }
  const Field = (label, value) => h("div", { class: "kv" }, h("span", null, label), h("b", null, value));
  const Avatar = (name) => h("span", { class: "avatar", "aria-hidden": "true" }, String(name || "?").split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase());
  window.SOBUI = { h, ugx, num, badge, Card, Table, State, Modal, Form, toast, friendly, Busy, Icon, fdate, pct, Hero, StackBar, Progress, Section, Row, List, Empty, Skeleton, Banner, Chips, Confirm, Field, Avatar };
})();
