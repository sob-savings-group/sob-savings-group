/* Shared UI components. All text goes through textContent (no innerHTML with data) so ledger content can never inject markup. */
(function () {
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v); });
    kids.flat().forEach((c) => { if (c == null || c === false) return; e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  };
  const ugx = (n) => (n == null || n === "" ? "—" : "UGX " + Math.round(Number(n)).toLocaleString("en-US"));
  const num = (n) => Math.round(Number(n)).toLocaleString("en-US");
  const badge = (text, kind) => h("span", { class: "badge b-" + (kind || "mute") }, text);
  /* Card: clickable when onOpen is given (the drill-down pattern used on every screen). */
  const Card = (label, value, sub, onOpen) => h("div", Object.assign({ class: "card" + (onOpen ? " click" : ""), "data-card": label }, onOpen ? { tabindex: 0, role: "button", onclick: onOpen, onkeydown: (e) => { if (e.key === "Enter") onOpen(); } } : {}),
    h("div", { class: "lbl" }, label), h("div", { class: "val" }, value), sub ? h("div", { class: "sub" }, sub) : null);
  const Table = (cols, rows, onRow) => h("div", { class: "scroll" }, h("table", null,
    h("thead", null, h("tr", null, cols.map((c) => h("th", { class: c.num ? "n" : "" }, c.label)))),
    h("tbody", null, rows.length ? rows.map((r) => h("tr", Object.assign({ class: onRow ? "click" : "" }, onRow ? { onclick: () => onRow(r) } : {}),
      cols.map((c) => h("td", { class: c.num ? "n" : "" }, c.render ? c.render(r) : r[c.key])))) : [h("tr", null, h("td", { colspan: cols.length, class: "mute" }, "Nothing to show yet."))])));
  const State = (kind, msg) => h("div", { class: "state" + (kind === "error" ? " err" : "") }, kind === "loading" ? [h("span", { class: "spin" }), " Loading…"] : msg);
  function Modal(title, body) {
    const bg = h("div", { class: "modal-bg", role: "dialog", "aria-modal": "true", onclick: (e) => { if (e.target === bg) close(); } });
    const close = () => bg.remove();
    bg.append(h("div", { class: "modal" }, h("div", { class: "row", style: "justify-content:space-between;margin:0" }, h("h2", null, title), h("button", { "data-close": "1", onclick: close }, "Close")), body));
    document.body.append(bg); return { close };
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
  function toast(msg, bad) { const t = h("div", { class: "toast" + (bad ? " bad" : ""), role: "status" }, msg); document.body.append(t); setTimeout(() => t.remove(), bad ? 6000 : 3000); }
  /* Form modal: fields [{name,label,type,value,options,required}] -> onSubmit(values) may throw; the message is shown, nothing is half-saved. */
  function Form(title, fields, onSubmit, submitLabel) {
    const inputs = {};
    const body = h("div", null, fields.map((f) => {
      const el = f.options ? h("select", { name: f.name }, f.options.map((o) => h("option", { value: o.value ?? o }, o.label ?? o))) : h(f.type === "textarea" ? "textarea" : "input", { name: f.name, type: f.type || "text", value: f.value ?? "" });
      if (f.max) el.setAttribute("max", f.max); if (f.type === "date") el.required = true;
      if (f.value != null && f.options) el.value = f.value; inputs[f.name] = el; return h("div", null, h("label", null, f.label), el);
    }));
    const err = h("div", { class: "err", role: "alert" });
    const m = Modal(title, h("div", null, body, err, h("div", { class: "row" }, h("button", { class: "primary", "data-submit": "1", onclick: async () => {
      const v = {}; fields.forEach((f) => (v[f.name] = inputs[f.name].value));
      try { await onSubmit(v); m.close(); } catch (e) { err.textContent = friendly(e); }
    } }, submitLabel || "Save"))));
    return m;
  }
  const friendly = (e) => {
    const m = String((e && e.message) || e);
    if (/PENDING_SOB_DECISION/.test(m)) return "Blocked: SOB has not yet decided this rule. " + m.replace(/^.*?PENDING_SOB_DECISION:?\s*/, "");
    if (e && e.code === "CONFLICT") return "Someone else changed the ledger. Your change was not saved — reload and try again.";
    return m.replace(/^[A-Z_]+:\s*/, "");
  };
  window.SOBUI = { h, ugx, num, badge, Card, Table, State, Modal, Form, toast, friendly, Busy };
})();
