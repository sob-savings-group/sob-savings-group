/* SOB core/templates — the wording of every automatic text message is a SETTING, not code.
   Each template has a safe default (below), a list of the placeholders it may use, and sample values for the live preview. An officer edits the words in the app;
   the change is validated (known placeholders only, the required ones kept, length checked), approved by the Chairperson, audited, and takes effect at once.
   Clearing a template returns it to the default. If a saved template is ever unusable, the default is used, so a message is never lost.
   Texts are plain text for SMS and WhatsApp. "Quick messages" are the officer's own saved wordings for Send a message. */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./governance.js") : root.SOB.gov, isNode ? require("./dates.js") : root.SOB.dates);
  if (isNode) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.templates = api; }
})(typeof self !== "undefined" ? self : this, function (G, D) {
  const KEY = "message-templates", MAX = 480, SMS_ONE = 160;
  const money = (n) => "UGX " + Math.round(Number(n) || 0).toLocaleString("en-US");
  const P = {
    amount: ["The amount, e.g. UGX 50,000", "UGX 50,000"], date: ["The date, e.g. 28/11/2026", "28/11/2026"], ref: ["The reference or loan number", "LOAN-0001"], type: ["What was recorded, e.g. Savings", "Savings"], year: ["The year", "2026"],
    fee: ["The fee, e.g. UGX 1,000", "UGX 1,000"], reasonLine: ["The reason, with its lead-in; empty when none is given", " Reason: not enough savings."], paid: ["Amount paid since the last reminder, digits only", "50,000"],
    amt: ["Amount still owed, digits only", "150,000"], dl: ["The repayment deadline, e.g. 24 Nov", "24 Nov"], tel: ["The Chairperson's phone number (from Automatic reminders)", "0700123456"]
  };
  const SIGN = "Elder Pr. Kironde";
  /* key: [group, label, default text, placeholders it may use, placeholders that must stay in] */
  const REG = {
    receipt: ["Receipts and confirmations", "Money received (receipt)", "SOB: we received {amount} ({type}) on {date}. Ref {ref}.", ["amount", "type", "date", "ref"], ["amount"]],
    repaymentReceived: ["Receipts and confirmations", "Loan repayment received", "SOB: loan repayment of {amount} received on {date}. Loan {ref}.", ["amount", "date", "ref"], ["amount"]],
    loanApproved: ["Loans", "Loan approved", "SOB: your loan application of {amount} has been approved. Ref {ref}.", ["amount", "ref"], ["amount"]],
    loanDeclined: ["Loans", "Loan not approved", "SOB: your loan application of {amount} was not approved.{reasonLine} Ref {ref}.", ["amount", "ref", "reasonLine"], ["amount"]],
    loanDisbursed: ["Loans", "Loan paid out", "SOB: loan {ref} of {amount} has been disbursed.", ["ref", "amount"], ["amount"]],
    repaymentReminder: ["Loans", "Balance reminder (single member)", "SOB: reminder - loan {ref} balance is {amount} as of {date}.", ["ref", "amount", "date"], ["amount"]],
    shareOut: ["Year end", "Share-out recorded", "SOB: December {year} share-out recorded. Your savings withdrawn: {amount}.", ["year", "amount"], ["amount"]],
    airtimeRequested: ["Airtime", "Airtime request received", "SOB: airtime request {ref} of {amount} received (fee {fee}). Awaiting approval.", ["ref", "amount", "fee"], ["amount"]],
    airtimeFulfilled: ["Airtime", "Airtime sent", "SOB: your airtime request of {amount} has been fulfilled. Thank you.", ["amount"], ["amount"]],
    airtimeRejected: ["Airtime", "Airtime not approved", "SOB: your airtime request {ref} was not approved.{reasonLine}", ["ref", "reasonLine"], []],
    reminderThanks: ["Automatic loan reminders (Bishop stage)", "Loan fully paid: thank you", "Thank you. Your loan is fully paid. Forget the pressure you went through; we value your faithfulness. God bless you. " + SIGN, [], []],
    reminderPart: ["Automatic loan reminders (Bishop stage)", "Part-paid: thank you and balance", "Thank you for paying UGX {paid}. Balance UGX {amt}. Pay by {dl} or call Chairperson {tel}. If unpaid, Bishop acts. " + SIGN, ["paid", "amt", "dl", "tel"], ["amt"]],
    reminderNone: ["Automatic loan reminders (Bishop stage)", "Nothing paid: serious notice", "UGX {amt} unpaid. Please don't keep quiet: pay or call Chairperson {tel}. If unpaid by {dl}, you go to the Bishop for action.", ["amt", "dl", "tel"], ["amt"]]
  };
  const KEYS = Object.keys(REG);
  const info = (key) => { const r = REG[key]; if (!r) throw new Error("UNKNOWN_TEMPLATE: " + key); return { key, group: r[0], label: r[1], text: r[2], placeholders: r[3].map((p) => ({ name: p, about: P[p][0], sample: P[p][1] })), required: r[4] }; };
  const rec = (db) => ((db && db.policy) || []).find((p) => p.id === KEY) || {};
  const custom = (db, key) => { const t = (rec(db).texts || {})[key]; return typeof t === "string" && t.trim() ? t : ""; };
  const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] === undefined ? "" : v[k]));
  /* the text in use: the officer's wording when it is valid, otherwise the default */
  function text(db, key) { const r = REG[key]; if (!r) throw new Error("UNKNOWN_TEMPLATE: " + key); const c = custom(db, key); return c && !check(key, c).length ? c : r[2]; }
  /* what a text is made of, for the counter: GSM characters fit 160 to a text (153 each when it takes several); other characters (some accents, emoji) drop that to 70 (67) */
  const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-.\/:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\\[~\]|€]*$/;
  function smsInfo(t) { t = String(t || ""); const uni = !GSM.test(t), one = uni ? 70 : 160, many = uni ? 67 : 153, len = t.length; return { length: len, unicode: uni, segments: len === 0 ? 0 : len <= one ? 1 : Math.ceil(len / many), perSegment: len <= one ? one : many }; }
  /* problems with a proposed wording; empty list = fine */
  function check(key, t) {
    const r = REG[key], bad = []; if (!r) return ["Unknown message"]; t = String(t == null ? "" : t);
    if (!t.trim()) return ["The message cannot be empty"]; if (t.length > MAX) bad.push("Too long: " + t.length + " characters (the limit is " + MAX + ")"); if (/[<>]/.test(t)) bad.push("Do not use < or >");
    const used = (t.match(/\{(\w+)\}/g) || []).map((x) => x.slice(1, -1)); used.filter((u) => !r[3].includes(u)).forEach((u) => bad.push("{" + u + "} is not available here. You can use: " + (r[3].map((p) => "{" + p + "}").join(" ") || "no placeholders")));
    r[4].filter((q) => !used.includes(q)).forEach((q) => bad.push("It must keep {" + q + "} so the member sees the amount"));
    if (/\{[^}]*$/.test(t.replace(/\{\w+\}/g, ""))) bad.push("A { is not closed"); return bad;
  }
  const preview = (key, t) => { const r = REG[key], v = {}; r[3].forEach((p) => { v[p] = P[p][1]; }); return fill(t == null ? r[2] : t, v); };
  /* ---------- used by the senders ---------- */
  const render = (db, key, vars) => fill(text(db, key), vars || {});
  const has = (key) => !!REG[key];
  /* ---------- officers ---------- */
  function set(db, ctx, a) {
    G.require(ctx, "notify.manage"); a = a || {}; info(a.key); const t = String(a.text == null ? "" : a.text).replace(/\r\n/g, "\n").trim();
    const policy = (db.policy = db.policy || []); let p = policy.find((x) => x.id === KEY); if (!p) policy.push((p = { id: KEY, texts: {}, quick: [] })); p.texts = p.texts || {}; p.quick = p.quick || [];
    const before = p.texts[a.key] || "";
    if (!t || t === REG[a.key][2]) { delete p.texts[a.key]; } else { const bad = check(a.key, t); if (bad.length) throw new Error("INVALID: " + bad[0]); p.texts[a.key] = t; }
    p.updatedBy = ctx.by; p.updatedDate = ctx.today; G.audit(db, ctx, "MessageTemplate", a.key, p.texts[a.key] ? "Wording changed" : "Reset to default", { text: before || "(default)" }, { text: p.texts[a.key] || "(default)" }, a.reason || ""); return { key: a.key, custom: !!p.texts[a.key] };
  }
  const quick = (db) => ((rec(db).quick) || []).slice();
  function saveQuick(db, ctx, a) {
    G.require(ctx, "notify.manage"); a = a || {}; const name = String(a.name || "").trim().slice(0, 40), t = String(a.text || "").trim();
    if (!name) throw new Error("REQUIRED: a name for the message"); if (!t) throw new Error("REQUIRED: the message"); if (t.length > MAX) throw new Error("INVALID: too long (limit " + MAX + ")"); if (/[<>]/.test(t)) throw new Error("INVALID: do not use < or >");
    const bad = (t.match(/\{(\w+)\}/g) || []).map((x) => x.slice(1, -1)).filter((u) => !["name", "id"].includes(u)); if (bad.length) throw new Error("INVALID: only {name} and {id} can be used in a quick message");
    const policy = (db.policy = db.policy || []); let p = policy.find((x) => x.id === KEY); if (!p) policy.push((p = { id: KEY, texts: {}, quick: [] })); p.quick = p.quick || [];
    let q = a.id ? p.quick.find((x) => x.id === a.id) : null; if (a.id && !q) throw new Error("NOT_FOUND: quick message"); if (!q) { q = { id: G.uid("QM") }; p.quick.push(q); }
    if (p.quick.length > 30) throw new Error("INVALID: at most 30 quick messages"); const was = q.text || ""; Object.assign(q, { name, text: t }); G.audit(db, ctx, "MessageTemplate", q.id, a.id ? "Quick message edited" : "Quick message added", { text: was }, { name, text: t }, a.reason || ""); return q;
  }
  function removeQuick(db, ctx, a) { G.require(ctx, "notify.manage"); const p = rec(db), i = (p.quick || []).findIndex((x) => x.id === (a || {}).id); if (i < 0) throw new Error("NOT_FOUND: quick message"); const q = p.quick.splice(i, 1)[0]; G.audit(db, ctx, "MessageTemplate", q.id, "Quick message removed", { name: q.name }, null, (a && a.reason) || ""); return { removed: q.id }; }
  const list = (db) => KEYS.map((k) => { const i = info(k), c = custom(db, k), valid = !c || !check(k, c).length; return Object.assign(i, { current: valid && c ? c : i.text, isCustom: !!c && valid, broken: !!c && !valid }); });
  return { KEYS, MAX, SMS_ONE, info, list, text, render, has, check, preview, smsInfo, set, saveQuick, removeQuick, quick, fill, money };
});
