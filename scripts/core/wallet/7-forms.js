// scripts/core/wallet/7-forms.js
//
// The saves of the settings, cash, mortgage and transaction forms: everything checked
// first, a refusal (RuleError) changing nothing.

Object.assign(Core, (() => {
  const {
    ROLES, MODES, TX_TYPES, tr, num, categoryLabel, isBlank, isNumeric, today, parseDate, RuleError,
    isWhole, typedPercent, planBuckets, applyBuckets, addCash, addTransaction,
  } = Core;

  // ---------------------------------------------------------------- the saves of the views
  // Each checks everything first and throws RuleError before changing anything.

  /** A number typed into a form, held between limits; `field` is the label's key. */
  function _value(data, v, key, min = -Infinity, max = Infinity) {
    const field = tr(data, key);
    if(!isNumeric(v)) throw new RuleError("err_value_number", { field });
    const x = Number(v);
    if(x < min || x > max) {
      throw max === Infinity ? new RuleError("err_value_min", { field, min: num(data, min, min % 1 ? 2 : 0) })
        : new RuleError("err_value_range", { field, min: num(data, min), max: num(data, max) });
    }
    return x;
  }

  const SETTING_LIMITS = {
    emergency_target: ["set_emergency_target", 0], monthly_expenses: ["set_monthly_expenses", 0],
    net_income: ["set_net_income", 0], prepay_share_pct: ["set_prepay_share", 0, 100],
    min_prepayment: ["set_min_prepayment", 0], alt_safe_yield_pct: ["set_alt_yield", -100, 100],
    drift_alert_pp: ["set_drift", 0, 100], stale_days: ["set_stale_days", 1],
  };

  /**
   * The settings view: budget values, category targets (adding up to 100) and,
   * when given, the bucket table.
   * @param {{settings?:object, categories?:Array<{category:string, target_pct:any, buy:boolean}>, buckets?:object[]}} form
   */
  function saveSettings(data, { settings = {}, categories = [], buckets = null }) {
    const values = {};
    for(const [k, v] of Object.entries(settings)) {
      if(!Object.hasOwn(SETTING_LIMITS, k)) continue;
      const [key, min, max] = SETTING_LIMITS[k];
      const x = _value(data, v, key, min, max);
      values[k] = k === "stale_days" ? Math.round(x) : x;
    }
    const targets = categories.map(r => {
      if(!Object.hasOwn(data.categories, r.category)) throw new RuleError("err_value_choice", { field: tr(data, "col_category") });
      const field = `${categoryLabel(data, r.category)} · ${tr(data, "col_target_pct")}`;
      return { category: r.category, buy: !!r.buy, target_pct: typedPercent(r.target_pct, field) ?? 0 };
    });
    if(targets.length) {
      const total = targets.reduce((a, r) => a + r.target_pct, 0);
      if(!isWhole(total)) throw new RuleError("err_category_sum", { sum: num(data, total, total % 1 ? 2 : 0) });
    }
    const plan = buckets ? planBuckets(data, buckets) : null;

    Object.assign(data.settings, values);
    for(const r of targets) Object.assign(data.categories[r.category], { target_pct: r.target_pct, buy: r.buy });
    if(plan) applyBuckets(data, plan);
  }

  /**
   * The cash table: names, roles, currencies and balances. A changed balance goes
   * to the cash log as a correction with `note`.
   * @param {Array<{id:string, name:string, role:string, currency:string, amount:any}>} rows
   */
  function saveCash(data, rows, note = "", on = null) {
    const currencies = ["EUR", ...Object.keys(data.settings.fx)];
    const next = rows.map(r => {
      const acc = data.cash.find(c => c.id === r.id);
      if(!acc) throw new Error(`No cash account ${r.id}`);
      const name = String(r.name ?? "").trim();
      const field = (key) => `${name || acc.id} · ${tr(data, key)}`;
      if(!ROLES.includes(r.role)) throw new RuleError("err_value_choice", { field: field("col_role") });
      if(!currencies.includes(r.currency)) throw new RuleError("err_value_choice", { field: field("col_currency") });
      if(!isNumeric(r.amount ?? 0)) throw new RuleError("err_value_number", { field: field("col_amount") });
      return { acc, name, role: r.role, currency: r.currency, amount: Number(r.amount ?? 0) };
    });
    for(const r of next) {
      const diff = r.amount - Number(r.acc.amount);
      Object.assign(r.acc, { name: r.name, role: r.role, currency: r.currency });
      if(Math.abs(diff) > 0.001) addCash(data, r.acc.id, diff, note, on);
    }
  }

  /**
   * The home and mortgage parameters.
   * @param {{purchase_price, value, deposit_paid, deed_date}} house
   * @param {{amount, rate_pct, term_months, first_payment_date, bank_payment, prepayment_fee_pct, default_mode}} loan
   */
  function saveMortgage(data, house, loan) {
    const date = (v, key) => {
      if(isBlank(v)) return null;
      try { return parseDate(v); }
      catch { throw new RuleError("err_value_choice", { field: tr(data, key) }); }
    };
    const h = {
      purchase_price: _value(data, house.purchase_price ?? 0, "field_purchase_price", 0),
      value: _value(data, house.value ?? 0, "field_house_value", 0),
      deposit_paid: _value(data, house.deposit_paid ?? 0, "field_deposit", 0),
      deed_date: date(house.deed_date, "field_deed_date"),
    };
    if(!MODES.includes(loan.default_mode)) throw new RuleError("err_value_choice", { field: tr(data, "field_default_mode") });
    const bank = isBlank(loan.bank_payment) ? 0 : _value(data, loan.bank_payment, "field_bank_payment", 0);
    const m = {
      amount: _value(data, loan.amount ?? 0, "field_loan_amount", 0),
      rate_pct: _value(data, loan.rate_pct ?? 0, "field_rate", 0, 100),
      term_months: Math.round(_value(data, loan.term_months, "field_term", 1, 1200)),
      first_payment_date: date(loan.first_payment_date, "field_first_payment"),
      bank_payment: bank || null,
      prepayment_fee_pct: _value(data, loan.prepayment_fee_pct ?? 0, "field_prepayment_fee", 0, 100),
      default_mode: loan.default_mode,
    };
    Object.assign(data.house, h);
    Object.assign(data.mortgage, m);
  }

  /** Units of an instrument held at the end of a day (all of them without a day). */
  function heldOn(data, assetId, date = null) {
    const a = data.assets.find(x => x.id === assetId);
    const sign = { buy: 1, sell: -1, adjust: 1 };
    return data.transactions.filter(t => t.asset_id === assetId && (!date || t.date <= date))
      .reduce((q, t) => q + (sign[t.type] || 0) * Number(t.quantity || 0), Number(a?.opening_quantity || 0));
  }

  /**
   * A new transaction from the form, checked: a known instrument, a quantity that
   * is not 0 (above 0 for a buy or a sale), a price and fee of 0 or more, and no sale
   * of more than is held that day or afterwards.
   */
  function recordTransaction(data, { assetId, type, quantity, price = 0, fee = 0, date = null, note = "", updatePrice = true }) {
    const a = data.assets.find(x => x.id === assetId);
    if(!a) throw new RuleError("warn_add_instrument_first");
    if(!TX_TYPES.includes(type)) throw new RuleError("err_value_choice", { field: tr(data, "field_type") });
    if(!isNumeric(quantity) || !Number(quantity)) throw new RuleError("warn_quantity_zero");
    const q = Number(quantity);
    if(type !== "adjust" && q < 0) throw new RuleError("warn_quantity_positive");
    const p = _value(data, price ?? 0, "field_unit_price", 0);
    const f = _value(data, fee ?? 0, "field_fee_eur", 0);
    const day = parseDate(date) || today();
    if(type === "sell") {
      const held = Math.min(heldOn(data, assetId, day), heldOn(data, assetId));
      if(q > held + 1e-9) throw new RuleError("warn_sell_more", { name: a.name, held: num(data, held, 4) });
    }
    addTransaction(data, assetId, type, q, p, f, day, note, updatePrice);
  }

  return {
    saveSettings, saveCash, saveMortgage, heldOn, recordTransaction,
  };
})());
