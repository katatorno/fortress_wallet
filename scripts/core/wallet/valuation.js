// scripts/core/wallet/valuation.js
//
// What the wallet is worth in EUR: positions, categories, buckets, cash, the home and
// net worth.

const Valuation = (() => {
  function positions(data) {
    const q = Transactions.quantities(data);
    return data.assets.map(a => {
      const qty = q[a.id];
      const unitEur = Rates.toEur(data, Number(a.price || 0), a.currency);
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
    const out = Object.fromEntries(Cash.ROLES.map(r => [r, 0]));
    for(const c of data.cash) {
      const role = c.role || "other";
      out[role] = (out[role] || 0) + Rates.toEur(data, c.amount, c.currency || "EUR");
    }
    return out;
  }

  function houseState(data) {
    const h = data.house;
    if(Dates.parse(h.deed_date)) {
      const balance = Mortgage.state(data.mortgage).balance;
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
    positions, categoryValues, bucketValues, cashByRole, houseState, summary, allocationPct,
  };
})();
