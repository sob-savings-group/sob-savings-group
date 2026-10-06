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

  return { EAT_OFFSET_MS, setClock, nowInEAT, todayISO, isISO, parse, addDays, addMonths, monthsBetween, toDisplay, yearOf, quarterOf };
});
