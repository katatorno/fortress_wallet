// scripts/core/dates.js
//
// Dates are ISO strings "YYYY-MM-DD" everywhere (they sort and compare as text): today,
// reading a value as a date, months and days between, and how a date is shown.

const Dates = (() => {
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  function today() {
    const now = new Date();
    return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  function parse(v) {
    if(Base.isBlank(v)) return null;
    if(v instanceof Date) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
    const s = String(v).slice(0, 10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Invalid date: ${v}`);
    return s;
  }

  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  /** Same day n months later (clamped to the month's last day), as Python's add_months. */
  function addMonths(date, n) {
    const [y0, m0, d] = date.split("-").map(Number);
    const total = (m0 - 1) + n;
    const y = y0 + Math.floor(total / 12);
    const m = ((total % 12) + 12) % 12 + 1;
    return iso(y, m, Math.min(d, daysInMonth(y, m)));
  }

  function daysBetween(a, b) {
    const ms = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((ms(b) - ms(a)) / 86400000);
  }

  const monthYear = (date) => date ? `${date.slice(5, 7)}.${date.slice(0, 4)}` : "–";
  const dayMonthYear = (date) => date ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : "–";

  return { iso, today, parse, addMonths, daysBetween, monthYear, dayMonthYear };
})();
