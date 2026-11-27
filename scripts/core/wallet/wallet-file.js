// scripts/core/wallet/wallet-file.js
//
// The wallet file: its format version and the migrations of older files, the keys
// filled in (those of a new instrument too), the checks of its values, and reading and
// writing it as JSON.

const WalletFile = (() => {
  const CATEGORY_RENAME = { akcje: "equities", kruszce: "metals", obligacje: "bonds" };

  // ---------------------------------------------------------------- data file

  /**
   * The version of the data file's format, kept in the file as `version`.
   * Whenever the format changes: raise it, add the step to MIGRATIONS and update
   * .tests/format.test.cjs. A file without a version is version 1.
   */
  const FORMAT = 6;

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
      Base.setDefault(Base.setDefault(data, "settings", {}), "price_api_key", "");
    },
    // 4: price and exchange rate history, and each instrument's symbol at the price service
    3(data) {
      Base.setDefault(data, "prices", {});
      Base.setDefault(data, "fx_history", {});
      for(const a of data.assets || []) Base.setDefault(a, "price_symbol", "");
    },
    // 5: the chosen theme travels with the wallet, like the language
    4(data) {
      Base.setDefault(Base.setDefault(data, "settings", {}), "theme", "system");
    },
    // 6: what nothing reads any more goes: Yahoo symbols (prices now come through
    // price_symbol) and the number of salaries a year (no calculation used it)
    5(data) {
      const s = data.settings || {};
      delete s.fx_yahoo;
      delete s.salaries_per_year;
      for(const a of data.assets || []) delete a.yahoo;
    },
  };

  /** The version a wallet is of, without one 1; throws for one the app does not know. */
  function _version(data) {
    const from = Number(data.version ?? 1);
    if(!Number.isInteger(from) || from < 1 || from > FORMAT) {
      throw new Error(Texts.tr(data, "err_file_version", { version: String(data.version), supported: FORMAT }));
    }
    return from;
  }

  function migrate(data) {
    for(let v = _version(data); v < FORMAT; v++) MIGRATIONS[v](data);
    data.version = FORMAT;
  }

  /** Fills in what an instrument lacks, an id too; its name, category and bucket have no default. */
  function _completeAsset(a) {
    Base.setDefault(a, "id", Base.newId());
    Base.setDefault(a, "ticker", "");
    Base.setDefault(a, "price_symbol", "");
    Base.setDefault(a, "opening_quantity", 0);
    Base.setDefault(a, "price", 0);
    Base.setDefault(a, "currency", "EUR");
    Base.setDefault(a, "target_in_bucket", 0);
    Base.setDefault(a, "alert_price", null);
    Base.setDefault(a, "price_updated", null);
    Base.setDefault(a, "unit", "pcs");
    return a;
  }

  /**
   * A complete instrument made of the fields given, with a new id unless they bring one.
   * It checks nothing: see `Instruments.add` and `problems`.
   * @returns {object} a new object, the id its first key
   */
  const instrument = (fields) => _completeAsset({ id: Base.newId(), ...fields });

  /** Migrate an older file (see MIGRATIONS, old Polish category ids) and fill in missing keys. */
  function normalize(data) {
    data = data || {};
    const shape = _shapeProblems(data);
    if(shape.length) throw new Error(_fileError(data, shape));
    migrate(data);
    const s = Base.setDefault(data, "settings", {});
    Base.setDefault(s, "language", I18N.DEFAULT);
    Base.setDefault(s, "theme", "system"); // "system", "light" or "dark"
    Base.setDefault(s, "price_api_key", ""); // private: it lives in your file, never in the repository
    Base.setDefault(s, "fx", { USD: 1.09, PLN: 4.3 });
    Base.setDefault(s, "emergency_target", 10000);
    Base.setDefault(s, "monthly_expenses", 1650);
    Base.setDefault(s, "net_income", 2600);
    Base.setDefault(s, "prepay_share_pct", 30);
    Base.setDefault(s, "min_prepayment", 1000);
    Base.setDefault(s, "alt_safe_yield_pct", 2.5);
    Base.setDefault(s, "drift_alert_pp", 2);
    Base.setDefault(s, "stale_days", 14);
    Base.setDefault(data, "categories", {
      equities: { target_pct: 75, buy: true },
      metals: { target_pct: 15, buy: false },
      bonds: { target_pct: 10, buy: false },
    });
    Base.setDefault(data, "buckets", {});
    Base.setDefault(data, "assets", []);
    Base.setDefault(data, "transactions", []);
    Base.setDefault(data, "cash", []);
    Base.setDefault(data, "cash_log", []);
    const h = Base.setDefault(data, "house", {});
    Base.setDefault(h, "purchase_price", 0);
    Base.setDefault(h, "value", h.purchase_price);
    Base.setDefault(h, "deposit_paid", 0);
    Base.setDefault(h, "deed_date", null);
    const m = Base.setDefault(data, "mortgage", {});
    Base.setDefault(m, "amount", 0);
    Base.setDefault(m, "rate_pct", 0);
    Base.setDefault(m, "term_months", 360);
    Base.setDefault(m, "first_payment_date", null);
    Base.setDefault(m, "bank_payment", null);
    Base.setDefault(m, "prepayment_fee_pct", 1);
    Base.setDefault(m, "default_mode", "reduce_term");
    Base.setDefault(m, "events", []);
    Base.setDefault(data, "history", []);
    Base.setDefault(data, "prices", {});     // asset id → date → [open or null, close]
    Base.setDefault(data, "fx_history", {}); // date → units per 1 EUR, like settings.fx
    Base.setDefault(data, "strategy_notes", "");
    for(const a of data.assets) _completeAsset(a);
    for(const c of data.cash) {
      Base.setDefault(c, "role", "other");
      Base.setDefault(c, "currency", "EUR");
      Base.setDefault(c, "amount", 0);
    }
    for(const t of data.transactions) Base.setDefault(t, "id", Base.newId());
    // deleting goes by id: without one, an event could not be told from the others
    for(const x of [...m.events, ...data.cash_log]) if(Base.isBlank(x.id)) x.id = Base.newId();
    _migrateCategories(data);
    return data;
  }

  function _migrateCategories(data) {
    const old = (k) => Object.hasOwn(CATEGORY_RENAME, k);
    if(!Object.keys(data.categories).some(old)) return;
    const ren = (k) => old(k) ? CATEGORY_RENAME[k] : k;
    data.categories = Object.fromEntries(Object.entries(data.categories).map(([k, v]) => [ren(k), v]));
    for(const b of Object.values(data.buckets)) b.category = ren(b.category);
    for(const a of data.assets) a.category = ren(a.category);
    for(const snap of data.history) {
      for(const [oldId, newKey] of Object.entries(CATEGORY_RENAME)) {
        if(`cat_${oldId}` in snap) { snap[`cat_${newKey}`] = snap[`cat_${oldId}`]; delete snap[`cat_${oldId}`]; }
      }
    }
  }

  // ---------------------------------------------------------------- checking a wallet

  const _isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

  /** The places to correct as one text: the first ten of them. */
  const problemList = (found) => found.slice(0, 10).join("; ")
    + (found.length > 10 ? ` … (+${found.length - 10})` : "");

  /** The refusal of a file, naming the places to correct. */
  function _fileError(data, found) {
    return Texts.tr(data, "err_file_invalid", { problems: problemList(found) });
  }

  /**
   * The checks of one value each: `kind(where, value)` notes a problem in `out`
   * and answers whether the value is fine. `maybe(kind)` lets an empty value pass.
   */
  function _checker(data, out) {
    const bad = (where, what) => { out.push(`${where}: ${Texts.tr(data, "val_" + what)}`); return false; };
    const c = {
      object: (w, v) => _isObj(v) || bad(w, "object"),
      list: (w, v) => Array.isArray(v) || bad(w, "list"),
      text: (w, v) => typeof v === "string" || bad(w, "text"),
      // NaN and Infinity are no labels: a file would hold them as null
      label: (w, v) => typeof v === "string" || Number.isFinite(v) || bad(w, "text"),
      name: (w, v) => (typeof v === "string" && v.trim() !== "" && !Base.isReserved(v)) || bad(w, "name"),
      number: (w, v) => Base.isNumeric(v) || bad(w, "number"),
      positive: (w, v) => (Base.isNumeric(v) && Number(v) >= 0) || bad(w, "positive"),
      rate: (w, v) => (Base.isNumeric(v) && Number(v) > 0) || bad(w, "rate"),
      date: (w, v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10))) || bad(w, "date"),
      choice: (list) => (w, v) => list.includes(v) || bad(w, "choice"),
      maybe: (kind) => (w, v) => Base.isBlank(v) || kind(w, v),
      /** A map's keys: none reserved. */
      keys: (w, v) => Object.keys(v).every(k => !Base.isReserved(k) || bad(`${w}.${k}`, "name")),
    };
    return c;
  }

  /** Where the parts of a file are of the wrong kind: an object, a list, items that are objects. */
  function _shapeProblems(data) {
    if(!_isObj(data)) return [`(file): ${Texts.tr(null, "val_object")}`];
    const out = [];
    const c = _checker(data, out);
    const part = (name, kind, items) => {
      const v = data[name];
      if(v === undefined || !c[kind](name, v) || !items) return;
      // a list is walked with its holes, which a file would hold as null
      if(kind === "list") for(const [i, item] of v.entries()) c.object(`${name}[${i}]`, item);
      else for(const [k, item] of Object.entries(v)) c.object(`${name}.${k}`, item);
    };
    part("settings", "object");
    part("categories", "object", true);
    part("buckets", "object", true);
    part("assets", "list", true);
    part("transactions", "list", true);
    part("cash", "list", true);
    part("cash_log", "list", true);
    part("house", "object");
    part("mortgage", "object");
    part("history", "list", true);
    part("prices", "object", true);
    part("fx_history", "object", true);
    if(_isObj(data.settings) && data.settings.fx !== undefined) c.object("settings.fx", data.settings.fx);
    if(_isObj(data.mortgage) && data.mortgage.events !== undefined && c.list("mortgage.events", data.mortgage.events)) {
      for(const [i, e] of data.mortgage.events.entries()) c.object(`mortgage.events[${i}]`, e);
    }
    return out;
  }

  /**
   * What is wrong with the values of a wallet after `normalize`, as "where: what was
   * expected". Nothing is repaired: a file with a wrong value is refused, so nothing
   * in it changes without you.
   * @returns {string[]}
   */
  function problems(data) {
    const out = [];
    const c = _checker(data, out);
    const each = (list, name, fn) => list.forEach((item, i) => fn(`${name}[${i}]`, item));
    const s = data.settings;
    c.text("settings.language", s.language);
    c.text("settings.theme", s.theme);
    c.text("settings.price_api_key", s.price_api_key);
    c.keys("settings.fx", s.fx);
    for(const [cur, rate] of Object.entries(s.fx)) c.rate(`settings.fx.${cur}`, rate);
    for(const k of ["emergency_target", "monthly_expenses", "net_income", "prepay_share_pct",
      "min_prepayment", "drift_alert_pp", "stale_days"]) c.maybe(c.positive)(`settings.${k}`, s[k]);
    c.maybe(c.number)("settings.alt_safe_yield_pct", s.alt_safe_yield_pct);
    c.text("strategy_notes", data.strategy_notes);

    c.keys("categories", data.categories);
    for(const [k, cat] of Object.entries(data.categories)) c.maybe(c.positive)(`categories.${k}.target_pct`, cat.target_pct);
    c.keys("buckets", data.buckets);
    for(const [k, b] of Object.entries(data.buckets)) {
      c.text(`buckets.${k}.category`, b.category);
      c.maybe(c.positive)(`buckets.${k}.target_pct_in_category`, b.target_pct_in_category);
      c.maybe(c.positive)(`buckets.${k}.max_pct_in_category`, b.max_pct_in_category);
    }

    const ids = new Set();
    each(data.assets, "assets", (w, a) => {
      if(c.name(`${w}.id`, a.id) && ids.has(a.id)) out.push(`${w}.id: ${Texts.tr(data, "val_unique")}`);
      ids.add(a.id);
      c.label(`${w}.name`, a.name ?? "");
      for(const k of ["ticker", "price_symbol", "currency", "unit"]) c.text(`${w}.${k}`, a[k]);
      for(const k of ["category", "bucket"]) c.label(`${w}.${k}`, a[k] ?? "");
      c.maybe(c.number)(`${w}.opening_quantity`, a.opening_quantity);
      c.maybe(c.positive)(`${w}.price`, a.price);
      c.maybe(c.positive)(`${w}.target_in_bucket`, a.target_in_bucket);
      c.maybe(c.number)(`${w}.alert_price`, a.alert_price);
      c.maybe(c.date)(`${w}.price_updated`, a.price_updated);
      c.maybe(c.date)(`${w}.maturity`, a.maturity);
    });
    each(data.transactions, "transactions", (w, t) => {
      c.label(`${w}.id`, t.id);
      c.label(`${w}.asset_id`, t.asset_id);
      c.date(`${w}.date`, t.date);
      c.choice(Transactions.TYPES)(`${w}.type`, t.type);
      c.number(`${w}.quantity`, t.quantity);
      c.maybe(c.positive)(`${w}.price`, t.price);
      c.maybe(c.number)(`${w}.fee`, t.fee);
    });
    each(data.cash, "cash", (w, a) => {
      c.label(`${w}.id`, a.id ?? "");
      c.label(`${w}.name`, a.name ?? "");
      c.choice(Cash.ROLES)(`${w}.role`, a.role);
      c.text(`${w}.currency`, a.currency);
      c.maybe(c.number)(`${w}.amount`, a.amount);
    });
    each(data.cash_log, "cash_log", (w, l) => {
      c.date(`${w}.date`, l.date);
      c.label(`${w}.account_id`, l.account_id ?? "");
      c.number(`${w}.amount`, l.amount);
    });

    const h = data.house, m = data.mortgage;
    for(const k of ["purchase_price", "value", "deposit_paid"]) c.maybe(c.positive)(`house.${k}`, h[k]);
    c.maybe(c.date)("house.deed_date", h.deed_date);
    for(const k of ["amount", "term_months", "prepayment_fee_pct"]) c.maybe(c.positive)(`mortgage.${k}`, m[k]);
    c.maybe(c.number)("mortgage.rate_pct", m.rate_pct);
    c.maybe(c.date)("mortgage.first_payment_date", m.first_payment_date);
    c.maybe(c.number)("mortgage.bank_payment", m.bank_payment);
    c.maybe(c.choice(Mortgage.MODES))("mortgage.default_mode", m.default_mode);
    each(m.events, "mortgage.events", (w, e) => {
      c.date(`${w}.date`, e.date);
      c.choice(["payment", "prepayment"])(`${w}.type`, e.type);
      c.number(`${w}.amount`, e.amount);
      for(const k of ["interest", "principal", "fee_pct"]) c.maybe(c.number)(`${w}.${k}`, e[k]);
      c.maybe(c.choice(Mortgage.MODES))(`${w}.mode`, e.mode);
    });

    each(data.history, "history", (w, snap) => {
      c.date(`${w}.date`, snap.date);
      for(const [k, v] of Object.entries(snap)) if(k !== "date") c.maybe(c.number)(`${w}.${k}`, v);
    });
    c.keys("prices", data.prices);
    for(const [id, days] of Object.entries(data.prices)) {
      for(const [day, p] of Object.entries(days)) {
        const w = `prices.${id}.${day}`;
        if(!c.date(w, day)) continue;
        if(!Array.isArray(p) || p.length !== 2) { out.push(`${w}: ${Texts.tr(data, "val_price_day")}`); continue; }
        c.maybe(c.positive)(`${w}[0]`, p[0]);
        c.positive(`${w}[1]`, p[1]);
      }
    }
    for(const [day, rates] of Object.entries(data.fx_history)) {
      c.date(`fx_history.${day}`, day);
      c.keys(`fx_history.${day}`, rates);
      for(const [cur, rate] of Object.entries(rates)) c.rate(`fx_history.${day}.${cur}`, rate);
    }
    return out;
  }

  /** The places `problems` names; a wallet with none has to add up too, or this throws. */
  function _inspect(data) {
    const found = problems(data);
    if(!found.length) Valuation.summary(data); // throws on what the values cannot give, e.g. a currency without a rate
    return found;
  }

  /**
   * Why a wallet, as it stands, would not open: its shape and version, which
   * `normalize` holds a file to, then the places of `problems`, else what
   * `Valuation.summary` cannot work out. Changes nothing. `Store.changed` holds a
   * change to this.
   * @returns {string[]} empty for a wallet that is fine
   */
  function check(data) {
    try {
      const shape = _shapeProblems(data);
      if(shape.length) return shape; // the values of a misshapen wallet are not looked into
      _version(data);
      return _inspect(data);
    }
    catch(e) { return [e.message]; }
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
    const found = _inspect(data);
    if(found.length) throw new Error(_fileError(data, found));
    return data;
  }

  return { FORMAT, instrument, normalize, problems, check, problemList, serialize, parse };
})();
