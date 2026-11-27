// scripts/core/wallet/wallet-history.js
//
// The wallet's history: net-worth snapshots, stored prices, the history rebuilt from
// them, and what was put in against what it is worth.

const WalletHistory = (() => {
  /** The numbers of one day's snapshot, as the wallet `data` stands. */
  function _snapshot(data, date) {
    const s = Valuation.summary(data);
    const snap = {
      date,
      investments: Base.round2(s.investments),
      cash: Base.round2(s.cash_total),
      house_equity: Base.round2(s.house.equity),
      mortgage: Base.round2(s.house.mortgage),
      net_worth: Base.round2(s.net_worth),
    };
    for(const [c, v] of Object.entries(s.categories)) snap[`cat_${c}`] = Base.round2(v);
    return snap;
  }

  /** Puts snapshots into the history, each replacing the one of its day; the history stays by date. */
  function _putSnapshots(data, snaps) {
    const days = new Set(snaps.map(s => s.date));
    data.history = [...data.history.filter(h => !days.has(h.date)), ...snaps].sort((a, b) => a.date.localeCompare(b.date));
  }

  function upsertSnapshot(data, on = null) {
    _putSnapshots(data, [_snapshot(data, Dates.parse(on) || Dates.today())]);
  }

  /**
   * Keeps one day's price of an instrument, in its own currency. A price with an
   * opening is never replaced by one without; `fill` writes only where there is none.
   */
  function addPrice(data, assetId, date, open, close, fill = false) {
    if(Base.isReserved(assetId) || Base.isReserved(date)) throw new Error(`Not a usable name: ${assetId} ${date}`);
    const days = Base.setDefault(data.prices, assetId, {});
    const old = days[date];
    if(old && (fill || (old[0] != null && open == null))) return;
    days[date] = [open ?? null, close];
  }

  /**
   * The entry of a date-keyed record on that day or the last one before it; else the
   * first after. `dates` are the record's keys, sorted: halved at each step, so years
   * of daily prices cost a dozen comparisons a day, not thousands.
   */
  function _asOf(record, dates, date) {
    let lo = 0, hi = dates.length; // the first index after `date`
    while(lo < hi) {
      const mid = (lo + hi) >> 1;
      if(dates[mid] <= date) lo = mid + 1; else hi = mid;
    }
    return record[dates[Math.max(lo - 1, 0)]];
  }

  /**
   * Writes a snapshot for every day from `from` that has a stored price: quantities
   * and cash as they were then (by the transactions and the cash log), prices and
   * rates of that day or the last one known. What has no history (a home deposit,
   * an account without a log, a price never stored) counts as it is today.
   * @returns {number} days written
   */
  function rebuild(data, from, to = Dates.today()) {
    const known = Object.fromEntries(Object.entries(data.prices).map(([id, p]) => [id, Object.keys(p).sort()]));
    const fxDates = Object.keys(data.fx_history).sort();
    const dates = [...new Set(Object.values(known).flat())].filter(d => d >= from && d <= to).sort();
    const snaps = dates.map(date => _snapshot({
      ...data,
      settings: { ...data.settings, fx: { ...data.settings.fx, ...(fxDates.length ? _asOf(data.fx_history, fxDates, date) : {}) } },
      transactions: data.transactions.filter(t => t.date <= date),
      assets: data.assets.map(a => {
        if(!known[a.id]?.length) return a;
        const [open, close] = _asOf(data.prices[a.id], known[a.id], date);
        return { ...a, price: close ?? open };
      }),
      cash: data.cash.map(c => ({ ...c, amount: Base.round2(Number(c.amount)
        - data.cash_log.filter(l => l.account_id === c.id && l.date > date).reduce((s, l) => s + Number(l.amount), 0)) })),
    }, date));
    _putSnapshots(data, snaps); // sorted once, not once a day
    return dates.length;
  }

  /**
   * What a category's instruments cost and what they are worth, day by day, in EUR.
   * `invested` is the purchase cost (with fees, at the day's rate) of what is still
   * held: a sale takes its share of the cost out, so realised gains are not in it.
   * Opening quantities, whose cost is unknown, count at their first known price.
   * @returns {Array<{date:string, invested:number, value:number}>} from the first
   *   transaction to `to`; the last day uses the current prices and rates
   */
  function portfolio(data, category, to = Dates.today()) {
    const assets = data.assets.filter(a => a.category === category);
    const byId = Object.fromEntries(assets.map(a => [a.id, a]));
    const moves = data.transactions.filter(t => t.asset_id in byId && t.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.type === "sell" ? 1 : 0) - (b.type === "sell" ? 1 : 0));
    if(!moves.length) return [];
    const start = moves[0].date;
    const known = Object.fromEntries(assets.map(a => [a.id, Object.keys(data.prices[a.id] || {}).sort()]));
    const fxDates = Object.keys(data.fx_history).sort();
    const dates = [...new Set([...Object.values(known).flat(), ...moves.map(t => t.date), to])]
      .filter(d => d >= start && d <= to).sort();

    const rate = (currency, date) => {
      if(currency === "EUR") return 1;
      const day = date < to && fxDates.length ? _asOf(data.fx_history, fxDates, date) : null;
      return Number(day?.[currency]) || Rates.of(data, currency);
    };
    const price = (a, date) => {
      if(date >= to || !known[a.id].length) return Number(a.price || 0);
      const [open, close] = _asOf(data.prices[a.id], known[a.id], date);
      return close ?? open;
    };

    const held = Object.fromEntries(assets.map(a => {
      const quantity = Number(a.opening_quantity || 0);
      return [a.id, { quantity, cost: quantity ? quantity * price(a, start) / rate(a.currency, start) : 0 }];
    }));
    let next = 0;
    return dates.map(date => {
      for(; next < moves.length && moves[next].date <= date; next++) {
        const t = moves[next], a = byId[t.asset_id], h = held[t.asset_id];
        const q = (t.type === "sell" ? -1 : 1) * Number(t.quantity || 0);
        if(q < 0) h.cost -= h.cost * (h.quantity > 0 ? Math.min(-q / h.quantity, 1) : 1);
        else if(t.type === "buy") h.cost += q * Number(t.price || 0) / rate(a.currency, t.date) + Number(t.fee || 0);
        h.quantity += q;
        if(Math.abs(h.quantity) < 1e-6) { h.quantity = 0; h.cost = 0; }
      }
      let invested = 0, value = 0;
      for(const a of assets) {
        const h = held[a.id];
        if(!h.quantity) continue;
        invested += h.cost;
        value += h.quantity * price(a, date) / rate(a.currency, date);
      }
      return { date, invested: Base.round2(invested), value: Base.round2(value) };
    });
  }

  return { upsertSnapshot, addPrice, rebuild, portfolio };
})();
