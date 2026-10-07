/* SOB core/dates — EAT (UTC+3, no DST). Internal format YYYY-MM-DD; display DD/MM/YYYY.
   Works as a browser global (window.SOB.dates) and as a Node module. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.SOB = root.SOB || {}; root.SOB.dates = api; }
})(typeof self !== "undefined" ? self : this, function () {
  const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
  let clockOverride = null; // tests only
  const setClock = (ms) => { clockOverride = ms; };
  const nowInEAT = () => new Date((clockOverride ?? Date.now()) + EAT_OFFSET_MS);
  const todayISO = () => nowInEAT().toISOString().slice(0, 10);
  const isISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);

  // Invalid input throws: a financial system must never silently substitute "today".
  function parse(s) {
    if (!isISO(s)) throw new RangeError("Invalid ISO date: " + s);
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (isNaN(dt.getTime())) throw new RangeError("Invalid ISO date: " + s);
    return dt;
  }
  const fmt = (dt) => dt.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
  const addMonths = (s, n) => { const d = parse(s); d.setUTCMonth(d.getUTCMonth() + n); return fmt(d); };
  function monthsBetween(a, b) {
    const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
    return (yb - ya) * 12 + (mb - ma);
  }
  const toDisplay = (s) => (isISO(s) ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : "");
  const yearOf = (s) => Number(s.slice(0, 4));
  const quarterOf = (s) => Math.floor((Number(s.slice(5, 7)) - 1) / 3) + 1;

  /* A real calendar day written YYYY-MM-DD (2026-02-30 and 2026-13-01 are refused). */
  const isRealDate = (s) => { if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const [y, m, d] = s.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

  /* ---- Reporting periods. Balances are "as at" the period's last day; activity is what happened from the first day to the last. A period never ends in the future. ---- */
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const longDate = (s) => (isISO(s) ? Number(s.slice(8, 10)) + " " + MONTHS[Number(s.slice(5, 7)) - 1] + " " + s.slice(0, 4) : "");
  const lastDayOfMonth = (y, m) => fmt(new Date(Date.UTC(y, m, 0)));
  const PERIOD_PRESETS = [["month", "This month"], ["lastMonth", "Last month"], ["quarter", "This quarter"], ["year", "This year"], ["lastYear", "Last year"], ["all", "All time"], ["custom", "Custom"]];
  function describePeriod(p) {
    if (p.key === "all" || !p.from) return "Start of records – " + longDate(p.to);
    return p.from === p.to ? longDate(p.to) : longDate(p.from) + " – " + longDate(p.to);
  }
  function makePeriod(key, from, to, today) {
    const p = { key, from, to }; p.label = (PERIOD_PRESETS.find((x) => x[0] === key) || [0, "Custom"])[1]; p.text = describePeriod(p); p.toDate = to >= today; return p;
  }
  function presetPeriod(key, today) {
    today = today || todayISO(); const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), pad = (n) => String(n).padStart(2, "0");
    if (key === "month") return makePeriod(key, y + "-" + pad(m) + "-01", today, today);
    if (key === "lastMonth") { const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1; return makePeriod(key, ly + "-" + pad(lm) + "-01", lastDayOfMonth(ly, lm), today); }
    if (key === "quarter") { const qm = Math.floor((m - 1) / 3) * 3 + 1; return makePeriod(key, y + "-" + pad(qm) + "-01", today, today); }
    if (key === "year") return makePeriod(key, y + "-01-01", today, today);
    if (key === "lastYear") return makePeriod(key, (y - 1) + "-01-01", (y - 1) + "-12-31", today);
    if (key === "all") return makePeriod(key, "", today, today);
    throw new RangeError("Unknown period: " + key);
  }
  /* A custom period must be two real days, in order, and not in the future. */
  function customPeriod(from, to, today) {
    today = today || todayISO();
    if (!isRealDate(from) || !isRealDate(to)) throw new RangeError("Choose two real dates");
    if (from > to) throw new RangeError("The start date must not be after the end date");
    if (to > today) throw new RangeError("The end date cannot be in the future");
    return makePeriod("custom", from, to, today);
  }
  return { longDate, presetPeriod, customPeriod, describePeriod, PERIOD_PRESETS, EAT_OFFSET_MS, isRealDate, setClock, nowInEAT, todayISO, isISO, parse, addDays, addMonths, monthsBetween, toDisplay, yearOf, quarterOf };
});
