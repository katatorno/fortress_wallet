// scripts/core/wallet/1-base.js
//
// The base the other files of the wallet logic build on: the names of roles, modes and
// transaction types, texts in the wallet's language, small helpers and dates.
//
// The wallet logic, in the files of this folder. No DOM, no JSX: it runs the same in
// the browser and in Node (the tests and tools/ load it), and needs only I18N
// (scripts/core/i18n.js) for its texts.
//
// The files load in the order of their numbers, the way a linker takes a list:
// TonkaJSX loads a folder's files sorted by name, deeper folders first, and so do
// the tests. This one makes the global `Core`; each after it adds its part, and takes
// from `Core` only what the files before it put there.
//
// Dates are ISO strings "YYYY-MM-DD" everywhere (they sort and compare as text).
// Exchange rates are "units of currency per 1 EUR" (USD: 1.0943, PLN: 4.48).

const Core = (() => {
  const ROLES = ["emergency", "prepay", "home", "other"];
  const MODES = ["reduce_term", "reduce_payment"];
  const TX_TYPES = ["buy", "sell", "adjust"];
  const CATEGORY_RENAME = { akcje: "equities", kruszce: "metals", obligacje: "bonds" };

  // ---------------------------------------------------------------- language

  const lang = (data) => data?.settings?.language || I18N.DEFAULT;
  const tr = (data, key, vars) => I18N.t(lang(data), key, vars);
  const money = (data, x, dec = 0) => I18N.money(lang(data), x, dec);
  const num = (data, x, dec = 0) => I18N.number(lang(data), x, dec);

  function categoryLabel(data, cat) {
    const text = tr(data, "cat_" + cat);
    return text === "cat_" + cat ? cat : text;
  }
  const roleLabel = (data, role) => tr(data, "role_" + role);
  const modeLabel = (data, mode) => tr(data, "mode_" + mode);
  const txLabel = (data, tx) => tr(data, "tx_" + tx);

  // ---------------------------------------------------------------- helpers

  const round2 = (x) => Math.round((x + Math.sign(x) * 1e-9) * 100) / 100;
  const newId = () => Math.random().toString(16).slice(2, 10).padEnd(8, "0");
  const setDefault = (obj, key, value) => {
    if(!Object.hasOwn(obj, key) || obj[key] === undefined) obj[key] = value;
    return obj[key];
  };
  /** Names a key or an id may not have: they reach the objects' own machinery. */
  const RESERVED = ["__proto__", "constructor", "prototype"];
  const isReserved = (name) => RESERVED.includes(String(name));
  const isBlank = (v) => v === null || v === undefined || v === "";
  /** A number, or text that reads as one. */
  const isNumeric = (v) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) && Number.isFinite(Number(v));
  /** `x` held between the limits that are given. */
  const clamp = (x, min = -Infinity, max = Infinity) => Math.min(max, Math.max(min, x));

  // ---------------------------------------------------------------- dates

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  function today() {
    const now = new Date();
    return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  function parseDate(v) {
    if(isBlank(v)) return null;
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

  return {
    ROLES, MODES, TX_TYPES, CATEGORY_RENAME, lang, tr, money, num, categoryLabel, roleLabel,
    modeLabel, txLabel, round2, newId, setDefault, isReserved, isBlank, isNumeric, clamp, iso, today,
    parseDate, addMonths, daysBetween, monthYear, dayMonthYear,
  };
})();
