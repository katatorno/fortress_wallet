// scripts/core/core.js
//
// Fortress Wallet logic: EUR valuation, contribution calculator, mortgage with
// prepayments, recommendations. No DOM, no JSX: it runs the same in the browser
// and in Node (tests), and could move to any other framework untouched.
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
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const setDefault = (obj, key, value) => { if(obj[key] === undefined) obj[key] = value; return obj[key]; };
  const isBlank = (v) => v === null || v === undefined || v === "";
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

  // ---------------------------------------------------------------- data file

  /**
   * The version of the data file's format, kept in the file as `version`.
   * Whenever the format changes: raise it, add the step to MIGRATIONS and update
   * .tests/format.test.cjs. A file without a version is version 1.
   */
  const FORMAT = 3;

  /** MIGRATIONS[n] turns a file of version n into version n + 1. */
  const MIGRATIONS = {
    // 2: instruments are always bought fractionally, buckets are no longer automatic or manual
    1(data) {
      for(const b of Object.values(data.buckets || {})) {
        if(b.auto === false) delete b.target_pct_in_category; // never counted for a manual bucket
        delete b.auto;
      }
      for(const a of data.assets || []) delete a.fractional;
    },
    // 3: the wallet carries the key of the price service (Alpha Vantage)
    2(data) {
      setDefault(setDefault(data, "settings", {}), "price_api_key", "");
    },
  };

  function migrate(data) {
    const from = Number(data.version ?? 1);
    if(!Number.isInteger(from) || from < 1 || from > FORMAT) {
      throw new Error(tr(data, "err_file_version", { version: String(data.version), supported: FORMAT }));
    }
    for(let v = from; v < FORMAT; v++) MIGRATIONS[v](data);
    data.version = FORMAT;
  }

  /** Migrate an older file (see MIGRATIONS, old Polish category ids) and fill in missing keys. */
  function normalize(data) {
    data = data || {};
    migrate(data);
    const s = setDefault(data, "settings", {});
    setDefault(s, "language", I18N.DEFAULT);
    setDefault(s, "price_api_key", ""); // private: it lives in your file, never in the repository
    setDefault(s, "fx", { USD: 1.09, PLN: 4.3 });
    setDefault(s, "emergency_target", 10000);
    setDefault(s, "monthly_expenses", 1650);
    setDefault(s, "net_income", 2600);
    setDefault(s, "salaries_per_year", 14);
    setDefault(s, "prepay_share_pct", 30);
    setDefault(s, "min_prepayment", 1000);
    setDefault(s, "alt_safe_yield_pct", 2.5);
    setDefault(s, "drift_alert_pp", 2);
    setDefault(s, "stale_days", 14);
    setDefault(data, "categories", {
      equities: { target_pct: 75, buy: true },
      metals: { target_pct: 15, buy: false },
      bonds: { target_pct: 10, buy: false },
    });
    setDefault(data, "buckets", {});
    setDefault(data, "assets", []);
    setDefault(data, "transactions", []);
    setDefault(data, "cash", []);
    setDefault(data, "cash_log", []);
    const h = setDefault(data, "house", {});
    setDefault(h, "purchase_price", 0);
    setDefault(h, "value", h.purchase_price);
    setDefault(h, "deposit_paid", 0);
    setDefault(h, "deed_date", null);
    const m = setDefault(data, "mortgage", {});
    setDefault(m, "amount", 0);
    setDefault(m, "rate_pct", 0);
    setDefault(m, "term_months", 360);
    setDefault(m, "first_payment_date", null);
    setDefault(m, "bank_payment", null);
    setDefault(m, "prepayment_fee_pct", 1);
    setDefault(m, "default_mode", "reduce_term");
    setDefault(m, "events", []);
    setDefault(data, "history", []);
    setDefault(data, "strategy_notes", "");
    for(const a of data.assets) {
      setDefault(a, "id", newId());
      setDefault(a, "ticker", "");
      setDefault(a, "yahoo", "");
      setDefault(a, "opening_quantity", 0);
      setDefault(a, "price", 0);
      setDefault(a, "currency", "EUR");
      setDefault(a, "target_in_bucket", 0);
      setDefault(a, "alert_price", null);
      setDefault(a, "price_updated", null);
      setDefault(a, "unit", "pcs");
    }
    for(const c of data.cash) {
      setDefault(c, "role", "other");
      setDefault(c, "currency", "EUR");
      setDefault(c, "amount", 0);
    }
    _migrateCategories(data);
    return data;
  }

  function _migrateCategories(data) {
    if(!Object.keys(data.categories).some(k => k in CATEGORY_RENAME)) return;
    const ren = (k) => CATEGORY_RENAME[k] || k;
    data.categories = Object.fromEntries(Object.entries(data.categories).map(([k, v]) => [ren(k), v]));
    for(const b of Object.values(data.buckets)) b.category = ren(b.category);
    for(const a of data.assets) a.category = ren(a.category);
    for(const snap of data.history) {
      for(const [oldId, newKey] of Object.entries(CATEGORY_RENAME)) {
        if(`cat_${oldId}` in snap) { snap[`cat_${newKey}`] = snap[`cat_${oldId}`]; delete snap[`cat_${oldId}`]; }
      }
    }
  }

  /** The text written to a data file: pretty JSON, stable order, the version first. */
  const serialize = ({ version = FORMAT, ...rest }) => JSON.stringify({ version, ...rest }, null, 2) + "\n";

  /** Parses a data file (JSON). */
  function parse(text) {
    let raw;
    try { raw = JSON.parse(text); }
    catch(e) { throw new Error(`Not a valid wallet file (JSON): ${e.message}`); }
    if(!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Not a valid wallet file");
    const data = normalize(raw);
    summary(data); // validation: throws on a broken file
    return data;
  }

  // ---------------------------------------------------------------- valuation

  function fx(data, currency) {
    if(currency === "EUR") return 1;
    const rate = data.settings.fx[currency];
    if(!rate) throw new Error(tr(data, "err_fx_missing", { currency }));
    return Number(rate);
  }

  const toEur = (data, amount, currency) => Number(amount) / fx(data, currency);

  /** Quantity = opening quantity + transactions, so deleting a transaction undoes it. */
  function quantities(data) {
    const q = {};
    for(const a of data.assets) q[a.id] = Number(a.opening_quantity || 0);
    const sign = { buy: 1, sell: -1, adjust: 1 };
    for(const t of data.transactions) {
      if(t.asset_id in q) q[t.asset_id] += (sign[t.type] || 0) * Number(t.quantity || 0);
    }
    return q;
  }

  function positions(data) {
    const q = quantities(data);
    return data.assets.map(a => {
      const qty = q[a.id];
      const unitEur = toEur(data, Number(a.price || 0), a.currency);
      return { ...a, quantity: qty, unit_eur: unitEur, value_eur: qty * unitEur };
    });
  }

  function categoryValues(data, pos = positions(data)) {
    const vals = Object.fromEntries(Object.keys(data.categories).map(c => [c, 0]));
    for(const p of pos) vals[p.category] = (vals[p.category] || 0) + p.value_eur;
    return vals;
  }

  function bucketValues(data, pos = positions(data)) {
    const vals = Object.fromEntries(Object.keys(data.buckets).map(b => [b, 0]));
    for(const p of pos) vals[p.bucket] = (vals[p.bucket] || 0) + p.value_eur;
    return vals;
  }

  function cashByRole(data) {
    const out = Object.fromEntries(ROLES.map(r => [r, 0]));
    for(const c of data.cash) {
      const role = c.role || "other";
      out[role] = (out[role] || 0) + toEur(data, c.amount, c.currency || "EUR");
    }
    return out;
  }

  const cashAccount = (data, role) => data.cash.find(c => c.role === role) || null;

  function houseState(data) {
    const h = data.house;
    if(parseDate(h.deed_date)) {
      const balance = mortgageState(data.mortgage).balance;
      const value = Number(h.value || h.purchase_price || 0);
      return { status: "owned", asset: value, mortgage: balance, equity: value - balance };
    }
    const deposit = Number(h.deposit_paid || 0);
    return { status: "deposit", asset: deposit, mortgage: 0, equity: deposit };
  }

  function summary(data) {
    const pos = positions(data);
    const cats = categoryValues(data, pos);
    const investments = Object.values(cats).reduce((a, b) => a + b, 0);
    const cash = cashByRole(data);
    const cashTotal = Object.values(cash).reduce((a, b) => a + b, 0);
    const house = houseState(data);
    return {
      positions: pos, categories: cats, investments, cash, cash_total: cashTotal, house,
      liquid: investments + cashTotal,
      net_worth: investments + cashTotal + house.equity,
    };
  }

  function allocationPct(values) {
    const total = Object.values(values).reduce((a, b) => a + b, 0);
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, total ? v / total * 100 : 0]));
  }

  // ---------------------------------------------------------------- mortgage

  class MortgageError extends Error {
    constructor(key) { super(key); this.key = key; }
  }

  function annuity(balance, annualRatePct, months) {
    if(months <= 0) return balance;
    const i = annualRatePct / 1200;
    if(Math.abs(i) < 1e-12) return balance / months;
    return balance * i / (1 - Math.pow(1 + i, -months));
  }

  /** Annual rate (%) implied by loan amount, monthly payment and number of payments. */
  function impliedRate(amount, payment, months) {
    if(months <= 0 || payment * months <= amount) return 0;
    let lo = 0, hi = 30;
    for(let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2;
      if(annuity(amount, mid, months) < payment) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function firstPaymentDate(m) {
    const d = parseDate(m.first_payment_date);
    if(d) return d;
    return addMonths(today().slice(0, 8) + "01", 2);
  }

  function initialPayment(m) {
    if(!isBlank(m.bank_payment) && Number(m.bank_payment) !== 0) return Number(m.bank_payment);
    return annuity(Number(m.amount), Number(m.rate_pct), Number(m.term_months));
  }

  const _row = (date, kind, payment, interest, principal, prepayment, fee, balance, actual, n) => ({
    date, kind, n, payment: round2(payment), interest: round2(interest), principal: round2(principal),
    prepayment: round2(prepayment), fee: round2(fee), balance: round2(balance), actual,
  });

  /**
   * Books the recorded events (payments and prepayments), then projects to the end.
   * extraEvents: hypothetical prepayments ({date, amount, mode, fee_pct}) for simulations.
   * Row kinds: payment, prepayment, payment_plan, prepayment_plan.
   * @returns {{rows: object[], info: object}}
   */
  function runMortgage(m, extraEvents = [], project = true) {
    const rate = Number(m.rate_pct || 0);
    const i = rate / 1200;
    const term = Number(m.term_months || 0);
    const first = firstPaymentDate(m);
    const defaultFee = Number(m.prepayment_fee_pct || 0);
    const defaultMode = m.default_mode || "reduce_term";

    let bal = Number(m.amount || 0);
    let pay = initialPayment(m);
    let k = 0;
    let interestPaid = 0, feesPaid = 0, prepaid = 0;
    const rows = [];

    function prepay(amount, feePct, mode, nDone) {
      const amt = Math.min(Number(amount), bal);
      const fee = amt * Number(feePct) / 100;
      bal = round2(bal - amt);
      if(mode === "reduce_payment" && bal > 0) pay = annuity(bal, rate, Math.max(term - nDone, 1));
      return [amt, fee];
    }

    const events = [...(m.events || [])].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) || (a.type === "payment" ? 0 : 1) - (b.type === "payment" ? 0 : 1));
    for(const e of events) {
      const d = parseDate(e.date);
      if(e.type === "payment") {
        const interest = isBlank(e.interest) ? round2(bal * i) : Number(e.interest);
        let principal = isBlank(e.principal) ? Number(e.amount) - interest : Number(e.principal);
        principal = Math.min(principal, bal);
        bal = round2(bal - principal);
        k += 1;
        interestPaid += interest;
        rows.push(_row(d, "payment", Number(e.amount), interest, principal, 0, 0, bal, true, k));
      }
      else if(e.type === "prepayment") {
        const [amt, fee] = prepay(e.amount, e.fee_pct ?? defaultFee, e.mode || defaultMode, k);
        feesPaid += fee;
        prepaid += amt;
        rows.push(_row(d, "prepayment", 0, 0, 0, amt, fee, bal, true, k));
      }
    }

    const info = {
      balance: bal, payment: pay, paid_count: k, interest_paid: interestPaid,
      fees_paid: feesPaid, prepaid, next_due: addMonths(first, k), rate_pct: rate,
    };
    if(!project) return { rows, info };

    const extra = [...extraEvents].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let ei = 0, n = k, projInterest = 0, projFees = 0, projPrepaid = 0, guard = 0;
    while(bal > 0.005 && guard < term + 1200) {
      guard += 1;
      n += 1;
      const due = addMonths(first, n - 1);
      while(ei < extra.length && parseDate(extra[ei].date) < due) {
        const e = extra[ei++];
        if(bal <= 0.005) break;
        const [amt, fee] = prepay(e.amount, e.fee_pct ?? defaultFee, e.mode || defaultMode, n - 1);
        projFees += fee;
        projPrepaid += amt;
        rows.push(_row(parseDate(e.date), "prepayment_plan", 0, 0, 0, amt, fee, bal, false, n - 1));
      }
      if(bal <= 0.005) break;
      const interest = round2(bal * i);
      let principal = pay - interest;
      if(principal <= 0) throw new MortgageError("err_payment_too_low");
      if(n >= term || principal > bal) principal = bal;
      bal = round2(bal - principal);
      projInterest += interest;
      rows.push(_row(due, "payment_plan", interest + principal, interest, principal, 0, 0, bal, false, n));
    }

    const last = [...rows].reverse().find(r => r.kind.startsWith("payment"));
    Object.assign(info, {
      end_date: last ? last.date : null,
      remaining_payments: bal <= 0.005 ? n - k : null,
      total_interest: interestPaid + projInterest,
      future_interest: projInterest,
      total_fees: feesPaid + projFees,
      total_prepaid: prepaid + projPrepaid,
    });
    return { rows, info };
  }

  function mortgageState(m) {
    if(!Number(m.amount)) return { balance: 0, payment: 0, paid_count: 0 };
    return runMortgage(m, [], false).info;
  }

  /** Schedule + comparison with a variant without any prepayments. */
  function mortgageReport(m, extraEvents = []) {
    const { rows, info } = runMortgage(m, extraEvents);
    const base = runMortgage({ ...m, events: [] });
    Object.assign(info, {
      baseline_interest: base.info.total_interest,
      baseline_end: base.info.end_date,
      interest_saved: base.info.total_interest - info.total_interest,
    });
    info.net_saved = info.interest_saved - info.total_fees;
    return { rows, info, baseRows: base.rows };
  }

  function yearlyPrepayments(start, amount, mode, feePct, years = 60) {
    return Array.from({ length: years }, (_, y) => ({
      date: addMonths(start, 12 * y), amount, mode, fee_pct: feePct,
    }));
  }

  function prepaymentBreakEvenMonths(m) {
    const rate = Number(m.rate_pct || 0);
    if(rate <= 0) return null;
    return Number(m.prepayment_fee_pct || 0) / (rate / 12);
  }

  /** Next payment to book, split into interest and principal according to the schedule. */
  function nextPaymentEvent(m) {
    const { info } = runMortgage(m, [], false);
    const interest = round2(info.balance * Number(m.rate_pct) / 1200);
    const amount = round2(Math.min(info.payment, info.balance + interest));
    return {
      id: newId(), date: info.next_due, type: "payment", amount,
      interest, principal: round2(amount - interest), note: "",
    };
  }

  // ---------------------------------------------------------------- buckets

  class BucketError extends Error {
    constructor(key, vars = {}) { super(key); this.key = key; this.vars = vars; }
  }

  const isWhole = (sum) => Math.abs(sum - 100) < 0.001;
  const percentText = (data, x) => num(data, x, Math.abs(x - Math.round(x)) < 0.001 ? 0 : 2) + "%";

  /** The instrument targets of a bucket, added up. */
  const targetSum = (assets, bucket) => assets.filter(a => a.bucket === bucket)
    .reduce((s, a) => s + Number(a.target_in_bucket || 0), 0);

  /**
   * Buckets whose instrument targets neither add up to 100 nor are all 0 (a bucket
   * where the instrument is picked by hand).
   * @returns {Array<{name:string, sum:number}>}
   */
  function badTargets(buckets, assets, names = Object.keys(buckets)) {
    return names.flatMap(name => {
      const targets = assets.filter(a => a.bucket === name).map(a => Number(a.target_in_bucket || 0));
      const sum = targetSum(assets, name);
      const none = targets.every(x => x === 0);
      const whole = isWhole(sum) && targets.every(x => x >= 0);
      return none || whole ? [] : [{ name, sum }];
    });
  }

  /**
   * Categories whose bucket shares do not add up to 100. A category with a single
   * bucket may have no share at all.
   * @returns {Array<{name:string, sum:number}>}
   */
  function badShares(buckets) {
    const categories = [...new Set(Object.values(buckets).map(b => b.category))];
    return categories.flatMap(name => {
      const own = Object.values(buckets).filter(b => b.category === name);
      const shares = own.map(b => Number(b.target_pct_in_category || 0));
      const sum = shares.reduce((a, b) => a + b, 0);
      const none = own.length === 1 && !shares[0];
      const whole = isWhole(sum) && shares.every(x => x >= 0);
      return none || whole ? [] : [{ name, sum }];
    });
  }

  /**
   * Brings a bucket's targets back to 100 after its instruments changed, scaled in
   * proportion. A bucket that adds up, or has no targets at all, stays as it is.
   * @returns {boolean} whether any target changed
   */
  function rebalance(data, bucket) {
    if(!data.buckets[bucket] || !badTargets(data.buckets, data.assets, [bucket]).length) return false;
    const members = data.assets.filter(a => a.bucket === bucket);
    const given = members.map(a => Math.max(0, Number(a.target_in_bucket || 0)));
    const sum = given.reduce((a, b) => a + b, 0);
    const next = given.map(x => sum > 0 ? round2(x / sum * 100) : 0);
    if(sum > 0) { // the rounding leftover goes to the largest
      const top = next.indexOf(Math.max(...next));
      next[top] = round2(next[top] + 100 - next.reduce((a, b) => a + b, 0));
    }
    members.forEach((a, i) => { a.target_in_bucket = next[i]; });
    return true;
  }

  /**
   * Saves the targets of one bucket, only when they add up to 100 or are all 0.
   * @param {Object<string, number>} targets  instrument id → percentage, every instrument of the bucket
   * @returns {boolean} saved; false leaves the data as it was
   */
  function saveTargets(data, bucket, targets) {
    const next = data.assets.map(a => a.bucket === bucket && a.id in targets
      ? { ...a, target_in_bucket: Number(targets[a.id] || 0) } : a);
    if(badTargets(data.buckets, next, [bucket]).length) return false;
    for(const a of data.assets) if(a.bucket === bucket && a.id in targets) a.target_in_bucket = Number(targets[a.id] || 0);
    return true;
  }

  /**
   * Saves the rows of an instrument table: edits, moves and deletions. A moved
   * instrument starts at 0 in its new bucket, and the buckets that lost or gained
   * one are brought back to 100.
   * @param {object[]} rows  an instrument each: id, delete and the editable fields
   * @returns {string[]} the buckets whose targets were recalculated
   */
  function saveInstruments(data, rows, on = null) {
    const date = parseDate(on) || today();
    const byId = Object.fromEntries(data.assets.map(a => [a.id, a]));
    const gone = new Set(), changed = new Set();
    for(const r of rows) {
      const a = byId[r.id];
      if(r.delete) { gone.add(r.id); changed.add(a.bucket); continue; }
      const moved = r.bucket !== a.bucket;
      if(moved) changed.add(a.bucket).add(r.bucket);
      const price = Number(r.price || 0);
      if(Math.abs(price - Number(a.price)) > 1e-9) a.price_updated = date;
      Object.assign(a, {
        name: r.name, ticker: r.ticker || "", category: r.category, bucket: r.bucket,
        currency: r.currency, unit: r.unit || "pcs", price,
        target_in_bucket: moved ? 0 : a.target_in_bucket, alert_price: r.alert_price || null,
      });
    }
    data.assets = data.assets.filter(a => !gone.has(a.id));
    data.transactions = data.transactions.filter(t => !gone.has(t.asset_id));
    return [...changed].filter(b => rebalance(data, b));
  }

  /** "fortress 95%, sandbox 5%" for the messages and the running totals. */
  const sumList = (data, items) => items.map(i => `${i.name} ${percentText(data, i.sum)}`).join(", ");

  /**
   * Replaces one category's buckets with the edited rows. A changed name takes its
   * instruments along. Throws BucketError and leaves the data as it was.
   * @param {Array<{old:string|null, name:string, share:number, delete?:boolean}>} rows
   *   `old` is the current name, null for a new bucket; the shares must add up to 100
   */
  function saveBuckets(data, category, rows) {
    const keep = [], gone = [];
    for(const r of rows) {
      const name = String(r.name || "").trim();
      if(r.delete) { if(r.old) gone.push(r.old); }
      else if(name) keep.push({ ...r, name });
      else if(r.old) throw new BucketError("err_bucket_name");
    }
    const others = Object.keys(data.buckets).filter(b => data.buckets[b].category !== category);
    const names = keep.map(r => r.name);
    const twice = names.find((n, i) => names.indexOf(n) !== i || others.includes(n));
    if(twice) throw new BucketError("err_bucket_duplicate", { bucket: twice });
    const used = gone.filter(b => data.assets.some(a => a.bucket === b));
    if(used.length) throw new BucketError("err_bucket_in_use", { buckets: used.sort().join(", ") });
    const sum = keep.reduce((a, r) => a + Number(r.share || 0), 0);
    if(keep.length && (Math.abs(sum - 100) > 0.001 || keep.some(r => Number(r.share || 0) < 0))) {
      throw new BucketError("err_bucket_sum", { sum: num(data, sum, sum % 1 ? 1 : 0) });
    }

    const config = (r) => ({ ...(r.old ? data.buckets[r.old] : {}), category,
      target_pct_in_category: Number(r.share || 0) });
    const next = [];
    for(const [b, cfg] of Object.entries(data.buckets)) {
      if(cfg.category !== category) { next.push([b, cfg]); continue; }
      const r = keep.find(x => x.old === b);
      if(r) next.push([r.name, config(r)]);
    }
    for(const r of keep) if(!r.old) next.push([r.name, config(r)]);
    const renamed = new Map(keep.filter(r => r.old).map(r => [r.old, r.name]));
    for(const a of data.assets) if(renamed.has(a.bucket)) a.bucket = renamed.get(a.bucket);
    data.buckets = Object.fromEntries(next);
  }

  // ---------------------------------------------------------------- calculator

  /**
   * Splits an amount without selling: tops up the most underweight positions first
   * until they reach a common level; once everything is on target, splits by targets.
   */
  function waterfill(current, targets, amount) {
    const keys = Object.keys(targets).filter(k => (targets[k] || 0) > 0);
    const result = Object.fromEntries(Object.keys(targets).map(k => [k, 0]));
    if(amount <= 0 || !keys.length) return result;
    const tw = keys.reduce((s, k) => s + targets[k], 0);
    const w = Object.fromEntries(keys.map(k => [k, targets[k] / tw]));
    const cur = Object.fromEntries(keys.map(k => [k, Math.max(Number(current[k] || 0), 0)]));
    const need = (level) => keys.reduce((s, k) => s + Math.max(0, w[k] * level - cur[k]), 0);
    let lo = 0, hi = keys.reduce((s, k) => s + cur[k], 0) + amount;
    while(need(hi) < amount) hi *= 2;
    for(let it = 0; it < 200; it++) {
      const mid = (lo + hi) / 2;
      if(need(mid) < amount) lo = mid; else hi = mid;
    }
    const alloc = Object.fromEntries(keys.map(k => [k, Math.max(0, w[k] * hi - cur[k])]));
    const s = keys.reduce((acc, k) => acc + alloc[k], 0);
    for(const k of keys) result[k] = s ? alloc[k] * amount / s : 0;
    return result;
  }

  /** Why a bucket gets nothing of `eur`, and from which amount it would. */
  function _bucketWaits(data, values, shares, bucket, eur) {
    const keys = Object.keys(shares);
    const weight = keys.reduce((s, k) => s + shares[k], 0);
    const total = keys.reduce((s, k) => s + (values[k] || 0), 0);
    // waterfill reaches the bucket once the common level passes what it holds per share
    const level = (values[bucket] || 0) / (shares[bucket] / weight);
    const from = keys.reduce((s, k) => s + Math.max(0, shares[k] / weight * level - (values[k] || 0)), 0);
    return tr(data, "note_bucket_waits", {
      bucket, current: num(data, total ? (values[bucket] || 0) / total * 100 : 0, 1),
      target: num(data, shares[bucket] / weight * 100), amount: money(data, eur), from: money(data, from),
    });
  }

  /** What to do with an amount: emergency fund → prepayment pot → purchases by target. */
  function contributionPlan(data, amount, fillEmergency = true, prepaySharePct = null) {
    const s = data.settings;
    const lines = [], notes = [];
    let left = Number(amount);
    const cash = cashByRole(data);

    if(fillEmergency) {
      const deficit = Math.max(0, Number(s.emergency_target) - (cash.emergency || 0));
      const e = Math.min(deficit, left);
      if(e > 0.005) {
        const acc = cashAccount(data, "emergency");
        lines.push({ kind: "cash", account_id: acc ? acc.id : null, label: roleLabel(data, "emergency"), eur: e });
        left -= e;
      }
      if(deficit > e) {
        notes.push(tr(data, "note_emergency_short", { missing: money(data, deficit - e) }));
        left = Math.max(left, 0);
      }
    }

    const share = Number(prepaySharePct ?? s.prepay_share_pct);
    if(left > 0.005 && share > 0 && Number(data.mortgage.amount)) {
      const p = left * share / 100;
      const acc = cashAccount(data, "prepay");
      lines.push({ kind: "cash", account_id: acc ? acc.id : null, label: roleLabel(data, "prepay"), eur: p });
      left -= p;
    }

    const pos = positions(data);
    const byId = Object.fromEntries(pos.map(p => [p.id, p]));
    const cats = categoryValues(data, pos);
    const buckets = bucketValues(data, pos);
    const buyTargets = Object.fromEntries(Object.entries(data.categories)
      .filter(([, cfg]) => cfg.buy).map(([c, cfg]) => [c, Number(cfg.target_pct || 0)]));
    if(left > 0.005 && !Object.keys(buyTargets).length) notes.push(tr(data, "note_no_buy_categories"));
    const catAlloc = left > 0.005 ? waterfill(cats, buyTargets, left) : {};

    for(const [cat, eur] of Object.entries(catAlloc)) {
      if(eur <= 0.005) continue;
      const shares = Object.fromEntries(Object.entries(data.buckets)
        .filter(([, cfg]) => cfg.category === cat && Number(cfg.target_pct_in_category || 0) > 0)
        .map(([b, cfg]) => [b, Number(cfg.target_pct_in_category)]));
      if(!Object.keys(shares).length) {
        lines.push({ kind: "unassigned", label: tr(data, "plan_choose_instrument", { category: categoryLabel(data, cat) }), eur });
        continue;
      }
      for(const [b, beur] of Object.entries(waterfill(buckets, shares, eur))) {
        const waits = beur <= 0.005; // the whole amount is catching up in other buckets
        if(waits) notes.push(_bucketWaits(data, buckets, shares, b, eur));
        const members = pos.filter(p => p.bucket === b && Number(p.target_in_bucket || 0) > 0);
        if(!members.length) {
          if(beur > 0.005) {
            lines.push({ kind: "unassigned", bucket: b, label: tr(data, "plan_no_targets", { bucket: b }), eur: beur });
          }
          continue;
        }
        const aAlloc = waterfill(
          Object.fromEntries(members.map(p => [p.id, p.value_eur])),
          Object.fromEntries(members.map(p => [p.id, Number(p.target_in_bucket)])), beur);
        // every instrument with a percentage gets a line: a purchase (units may be
        // fractional), or why there is none
        for(const p of members) {
          const aeur = aAlloc[p.id] || 0;
          const unit = p.unit_eur;
          if(aeur > 0.005 && unit > 0) {
            lines.push({ kind: "buy", asset_id: p.id, label: p.name, ticker: p.ticker || "",
              eur: aeur, units: aeur / unit, price: Number(p.price), currency: p.currency });
          }
          else {
            const why = unit <= 0 ? "plan_skip_price" : waits ? "plan_skip_bucket" : "plan_skip_target";
            lines.push({ kind: "skip", asset_id: p.id, ticker: p.ticker || "", eur: aeur,
              label: tr(data, why, { name: p.name, bucket: b }) });
          }
        }
      }
    }

    const catsAfter = { ...cats };
    for(const ln of lines) {
      if(ln.kind === "buy") {
        const c = byId[ln.asset_id].category;
        catsAfter[c] = (catsAfter[c] || 0) + ln.eur;
      }
    }
    for(const [b, cfg] of Object.entries(data.buckets)) {
      if(cfg.max_pct_in_category) {
        const catTotal = catsAfter[cfg.category] || 0;
        const room = Math.max(0, Number(cfg.max_pct_in_category) / 100 * catTotal - (buckets[b] || 0));
        notes.push(tr(data, "note_bucket_room", { bucket: b, room: money(data, room), limit: num(data, cfg.max_pct_in_category) }));
      }
    }
    return { amount: Number(amount), lines, notes, before_pct: allocationPct(cats), after_pct: allocationPct(catsAfter) };
  }

  function addCash(data, accountId, amount, note = "", on = null) {
    const acc = data.cash.find(c => c.id === accountId);
    if(!acc) throw new Error(`No cash account ${accountId}`);
    acc.amount = round2(Number(acc.amount) + Number(amount));
    data.cash_log.push({ id: newId(), date: parseDate(on) || today(), account_id: accountId, amount: round2(Number(amount)), note });
  }

  function applyPlan(data, plan, on = null) {
    const date = parseDate(on) || today();
    const note = tr(data, "note_from_calculator");
    for(const ln of plan.lines) {
      if(ln.kind === "cash" && ln.account_id) addCash(data, ln.account_id, ln.eur, note, date);
      else if(ln.kind === "buy") {
        data.transactions.push({ id: newId(), date, asset_id: ln.asset_id, type: "buy",
          quantity: Math.round(ln.units * 1e6) / 1e6, price: ln.price, fee: 0, note });
      }
    }
  }

  function addTransaction(data, assetId, type, quantity, price, fee = 0, on = null, note = "", updatePrice = true) {
    const date = parseDate(on) || today();
    data.transactions.push({ id: newId(), date, asset_id: assetId, type,
      quantity: Number(quantity), price: Number(price), fee: Number(fee), note });
    if(updatePrice && price && (type === "buy" || type === "sell")) {
      const a = data.assets.find(x => x.id === assetId);
      const last = parseDate(a.price_updated);
      if(!last || date >= last) { a.price = Number(price); a.price_updated = date; }
    }
  }

  // ---------------------------------------------------------------- history

  function upsertSnapshot(data, on = null) {
    const s = summary(data);
    const d = parseDate(on) || today();
    const snap = {
      date: d,
      investments: round2(s.investments),
      cash: round2(s.cash_total),
      house_equity: round2(s.house.equity),
      mortgage: round2(s.house.mortgage),
      net_worth: round2(s.net_worth),
    };
    for(const [c, v] of Object.entries(s.categories)) snap[`cat_${c}`] = round2(v);
    data.history = [...data.history.filter(h => h.date !== d), snap].sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---------------------------------------------------------------- recommendations

  function bondMaturity(asset) {
    if(asset.maturity) return parseDate(asset.maturity);
    const m = `${asset.name || ""} ${asset.ticker || ""}`.match(/EDO(\d{2})(\d{2})/i);
    if(m) {
      const month = Number(m[1]), yy = Number(m[2]);
      if(month >= 1 && month <= 12) return iso(2000 + yy, month, 1);
    }
    return null;
  }

  /** List of hints: level = ok / info / warn (texts already translated). */
  function recommendations(data, on = null) {
    const now = parseDate(on) || today();
    const s = data.settings;
    const out = [];
    const summ = summary(data);
    const pos = summ.positions;
    const add = (level, titleKey, textKey, vars = {}) =>
      out.push({ level, title: tr(data, titleKey, vars), text: tr(data, textKey, vars) });

    // 1. Emergency fund
    const have = summ.cash.emergency || 0;
    const target = Number(s.emergency_target);
    const months = s.monthly_expenses ? have / Number(s.monthly_expenses) : 0;
    if(have >= target) add("ok", "rec_ef_full_t", "rec_ef_full_x", { have: money(data, have), months: num(data, months, 1) });
    else {
      add(have < target / 2 ? "warn" : "info", "rec_ef_t", "rec_ef_x", {
        have: money(data, have), target: money(data, target),
        pct: num(data, target ? have / target * 100 : 0), missing: money(data, target - have),
      });
    }

    // 2. Categories vs targets
    const cats = summ.categories;
    const pct = allocationPct(cats);
    const tsum = Object.values(data.categories).reduce((a, c) => a + Number(c.target_pct || 0), 0) || 1;
    for(const [c, cfg] of Object.entries(data.categories)) {
      const tgt = Number(cfg.target_pct || 0) / tsum * 100;
      const diff = (pct[c] || 0) - tgt;
      const vars = { name: categoryLabel(data, c), current: num(data, pct[c] || 0, 1), target: num(data, tgt) };
      if(!cfg.buy && diff > Number(s.drift_alert_pp)) {
        const needed = tgt > 0 ? (cats[c] || 0) / (tgt / 100) : null;
        const extra = needed ? tr(data, "rec_frozen_extra", { needed: money(data, needed) }) : "";
        add("info", "rec_frozen_t", "rec_frozen_x", { ...vars, extra });
      }
      else if(Math.abs(diff) > Number(s.drift_alert_pp)) {
        add("info", diff > 0 ? "rec_drift_above_t" : "rec_drift_below_t", "rec_drift_x",
          { ...vars, diff: num(data, Math.abs(diff), 1) });
      }
    }

    // 3. Manual bucket limits (sandbox)
    const bvals = bucketValues(data, pos);
    for(const [b, cfg] of Object.entries(data.buckets)) {
      const lim = cfg.max_pct_in_category;
      if(lim) {
        const total = cats[cfg.category] || 0;
        const share = total ? (bvals[b] || 0) / total * 100 : 0;
        const vars = { bucket: b, share: num(data, share, 1), limit: num(data, lim) };
        if(share > Number(lim)) add("warn", "rec_limit_over_t", "rec_limit_over_x", vars);
        else add("ok", "rec_limit_ok_t", "rec_limit_ok_x", vars);
      }
    }

    // 4. Drift inside the buckets that are being bought
    for(const [b, cfg] of Object.entries(data.buckets)) {
      if(!data.categories[cfg.category]?.buy) continue;
      const members = pos.filter(p => p.bucket === b && Number(p.target_in_bucket || 0) > 0);
      const total = members.reduce((a, p) => a + p.value_eur, 0);
      const tsumB = members.reduce((a, p) => a + Number(p.target_in_bucket), 0);
      for(const p of members) {
        const cur = total ? p.value_eur / total * 100 : 0;
        const tgt = Number(p.target_in_bucket) / tsumB * 100;
        if(Math.abs(cur - tgt) > Number(s.drift_alert_pp)) {
          add("info", "rec_bucket_drift_t", "rec_bucket_drift_x",
            { name: p.name, bucket: b, current: num(data, cur, 1), target: num(data, tgt) });
        }
      }
    }

    // 5. Sell thresholds (e.g. precious metals); equities are only bought
    for(const p of pos) {
      if(p.category === "equities") continue;
      const alert = p.alert_price;
      if(!isBlank(alert) && Number(alert) !== 0 && Number(p.price) >= Number(alert)) {
        add("warn", "rec_alert_t", "rec_alert_x",
          { name: p.name, price: num(data, p.price, 2), currency: p.currency, alert: num(data, alert, 2) });
      }
    }

    // 6. Stale prices
    const stale = pos.filter(p => {
      const d = parseDate(p.price_updated);
      return p.quantity > 0 && (!d || daysBetween(d, now) > Number(s.stale_days));
    }).map(p => p.name);
    if(stale.length) {
      out.push({ level: "info", title: tr(data, "rec_stale_t", { count: stale.length }),
        text: stale.slice(0, 12).join(", ") + (stale.length > 12 ? "…" : "") });
    }

    // 7. Mortgage and prepayments
    const m = data.mortgage;
    if(Number(m.amount)) {
      const st = mortgageState(m);
      const ratio = s.net_income ? st.payment / Number(s.net_income) * 100 : 0;
      add(ratio <= 35 ? "ok" : ratio <= 40 ? "info" : "warn", "rec_dsti_t", "rec_dsti_x",
        { ratio: num(data, ratio), payment: money(data, st.payment, 2), income: money(data, Number(s.net_income)) });
      const be = prepaymentBreakEvenMonths(m);
      const rate = Number(m.rate_pct), alt = Number(s.alt_safe_yield_pct);
      if(be !== null) {
        const verdict = tr(data, rate > alt ? "rec_prepay_wins" : "rec_prepay_loses");
        add("info", "rec_prepay_t", "rec_prepay_x",
          { rate: num(data, rate, 2), months: num(data, be, 1), verdict, alt: num(data, alt, 1) });
      }
      const pot = summ.cash.prepay || 0;
      if(pot >= Number(s.min_prepayment) && st.balance > 0) add("warn", "rec_pot_t", "rec_pot_x", { pot: money(data, pot) });
    }

    // 8. Bond maturities
    for(const p of pos) {
      if(p.category !== "bonds" || p.quantity <= 0) continue;
      const mat = bondMaturity(p);
      if(mat) {
        const days = daysBetween(now, mat);
        if(days >= 0 && days <= 365) add("warn", "rec_bond_t", "rec_bond_x", { name: p.name, date: monthYear(mat) });
      }
    }
    return out;
  }

  return {
    ROLES, MODES, TX_TYPES, MortgageError, BucketError, saveBuckets,
    targetSum, badTargets, badShares, rebalance, saveTargets, saveInstruments, sumList, clamp,
    lang, tr, money, num, categoryLabel, roleLabel, modeLabel, txLabel,
    round2, newId, clone, today, parseDate, addMonths, daysBetween, monthYear, dayMonthYear,
    FORMAT, normalize, serialize, parse,
    fx, toEur, quantities, positions, categoryValues, bucketValues, cashByRole, cashAccount,
    houseState, summary, allocationPct,
    annuity, impliedRate, firstPaymentDate, initialPayment, runMortgage, mortgageState,
    mortgageReport, yearlyPrepayments, prepaymentBreakEvenMonths, nextPaymentEvent,
    waterfill, contributionPlan, applyPlan, addCash, addTransaction,
    upsertSnapshot, bondMaturity, recommendations,
  };
})();
