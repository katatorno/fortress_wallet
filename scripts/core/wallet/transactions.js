// scripts/core/wallet/transactions.js
//
// Transactions: their types, the quantities they give, and recording one, as it comes
// or checked as the form sends it.

const Transactions = (() => {
  const TYPES = ["buy", "sell", "adjust"];
  const SIGN = { buy: 1, sell: -1, adjust: 1 };

  /**
   * What a transaction does to the quantity held: a purchase adds to it, a sale takes
   * from it, an adjustment adds its quantity, which may be below 0.
   */
  const change = (t) => (SIGN[t.type] || 0) * Number(t.quantity || 0);

  /** Quantity = opening quantity + transactions, so deleting a transaction undoes it. */
  function quantities(data) {
    const q = {};
    for(const a of data.assets) q[a.id] = Number(a.opening_quantity || 0);
    for(const t of data.transactions) {
      if(t.asset_id in q) q[t.asset_id] += change(t);
    }
    return q;
  }

  /** Units of an instrument held at the end of a day (all of them without a day). */
  function heldOn(data, assetId, date = null) {
    const a = data.assets.find(x => x.id === assetId);
    return data.transactions.filter(t => t.asset_id === assetId && (!date || t.date <= date))
      .reduce((q, t) => q + change(t), Number(a?.opening_quantity || 0));
  }

  /** A transaction as it comes: only the instrument and the date are checked. */
  function add(data, assetId, type, quantity, price, fee = 0, on = null, note = "", updatePrice = true) {
    const a = data.assets.find(x => x.id === assetId);
    if(!a) throw new Rules.RuleError("warn_add_instrument_first");
    const date = Rules.date(data, on, "field_date") || Dates.today();
    data.transactions.push({ id: Base.newId(), date, asset_id: assetId, type,
      quantity: Number(quantity), price: Number(price), fee: Number(fee), note });
    if(updatePrice && price && (type === "buy" || type === "sell")) {
      const last = Dates.parse(a.price_updated);
      if(!last || date >= last) { a.price = Number(price); a.price_updated = date; }
    }
  }

  /**
   * A new transaction from the form, checked: a known instrument, a quantity that
   * is not 0 (above 0 for a buy or a sale), a price and fee of 0 or more, and no sale
   * of more than is held that day or afterwards.
   */
  function record(data, { assetId, type, quantity, price = 0, fee = 0, date = null, note = "", updatePrice = true }) {
    const a = data.assets.find(x => x.id === assetId);
    if(!a) throw new Rules.RuleError("warn_add_instrument_first");
    if(!TYPES.includes(type)) throw new Rules.RuleError("err_value_choice", { field: Texts.tr(data, "field_type") });
    if(!Base.isNumeric(quantity) || !Number(quantity)) throw new Rules.RuleError("warn_quantity_zero");
    const q = Number(quantity);
    if(type !== "adjust" && q < 0) throw new Rules.RuleError("warn_quantity_positive");
    const p = Rules.number(data, price ?? 0, "field_unit_price", 0);
    const f = Rules.number(data, fee ?? 0, "field_fee_eur", 0);
    const day = Rules.date(data, date, "field_date") || Dates.today();
    if(type === "sell") {
      const held = Math.min(heldOn(data, assetId, day), heldOn(data, assetId));
      if(q > held + 1e-9) throw new Rules.RuleError("warn_sell_more", { name: a.name, held: Texts.num(data, held, 4) });
    }
    add(data, assetId, type, q, p, f, day, note, updatePrice);
  }

  return { TYPES, change, quantities, heldOn, add, record };
})();
