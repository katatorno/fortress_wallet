// scripts/core/wallet/3-valuation.js
//
// What the wallet is worth in EUR: quantities, positions, categories, buckets, cash,
// the home and net worth.

Object.assign(Core, (() => {
  const {
    ROLES, tr, parseDate, mortgageState,
  } = Core;

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

  return {
    fx, toEur, quantities, positions, categoryValues, bucketValues, cashByRole, cashAccount,
    houseState, summary, allocationPct,
  };
})());
