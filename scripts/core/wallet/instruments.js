// scripts/core/wallet/instruments.js
//
// Instruments: adding one, the save of their table, and which of them are sold out.

const Instruments = (() => {
  /** What the form and the table both give of an instrument; `row` names a row of the table. */
  function _checkFields(data, { name, bucket, currency }, row = "") {
    // text, or a number a file may hold: NaN and Infinity are no names
    const named = typeof name === "string" ? name.trim() !== "" : Number.isFinite(name);
    if(!named) throw new Rules.RuleError("warn_name_required");
    if(!Object.hasOwn(data.buckets, bucket)) throw new Rules.RuleError("warn_bucket_required");
    if(!Rates.currencies(data).includes(currency)) {
      const label = Texts.tr(data, "col_currency");
      throw new Rules.RuleError("err_value_choice", { field: row ? `${row} · ${label}` : label });
    }
  }

  /**
   * Adds an instrument: a name, a bucket (which gives the category), one of the wallet's
   * currencies, and an opening quantity and a price of 0 or more, empty ones 0. The
   * bucket's targets are brought back to 100 if needed. Throws Rules.RuleError and
   * leaves the data as it was.
   * @param {{name:string, ticker?:string, bucket:string, currency:string, opening_quantity?:any, price?:any,
   *   unit?:string}} fields
   * @returns {string[]} the buckets whose targets were recalculated
   */
  function add(data, { name, ticker = "", bucket, currency, opening_quantity = 0, price = 0, unit = "" }, on = null) {
    const date = Rules.date(data, on, "field_date") || Dates.today();
    _checkFields(data, { name, bucket, currency });
    const asset = WalletFile.instrument({
      name: String(name).trim(), ticker: String(ticker || ""), category: data.buckets[bucket].category, bucket, currency,
      opening_quantity: Rules.number(data, opening_quantity || 0, "field_opening_quantity", 0),
      price: Rules.number(data, price || 0, "field_unit_price", 0), unit: String(unit || "pcs"), price_updated: date,
    });
    data.assets.push(asset);
    return [bucket].filter(b => Buckets.rebalance(data, b));
  }

  /**
   * Saves the rows of an instrument table: edits, moves and deletions. A moved
   * instrument starts at 0 in its new bucket, and the buckets that lost or gained
   * one are brought back to 100. Every row is checked before any is saved: it names an
   * instrument and, unless it deletes it, passes the checks of `add`, its sell alert
   * empty or 0 or more. Throws Rules.RuleError and leaves the data as it was.
   * @param {object[]} rows  an instrument each: id, delete and the editable fields
   * @returns {string[]} the buckets whose targets were recalculated
   */
  function save(data, rows, on = null) {
    const date = Rules.date(data, on, "field_date") || Dates.today();
    const byId = Object.fromEntries(data.assets.map(a => [a.id, a]));
    const checked = rows.map(r => {
      if(!Object.hasOwn(byId, r.id)) throw new Rules.RuleError("err_value_choice", { field: Texts.tr(data, "field_instrument") });
      if(r.delete) return { r, a: byId[r.id] };
      const row = String(r.name ?? "").trim();
      _checkFields(data, r, row);
      const price = Rules.number(data, r.price || 0, "col_price", 0, Infinity, row);
      if(r.alert_price) Rules.number(data, r.alert_price, "col_alert", 0, Infinity, row);
      return { r, a: byId[r.id], price };
    });
    const gone = new Set(), changed = new Set();
    for(const { r, a, price } of checked) {
      if(r.delete) { gone.add(r.id); changed.add(a.bucket); continue; }
      const moved = r.bucket !== a.bucket;
      if(moved) changed.add(a.bucket).add(r.bucket);
      if(Math.abs(price - Number(a.price)) > 1e-9) a.price_updated = date;
      Object.assign(a, {
        // the category is the bucket's: an instrument is never in a bucket of another one
        name: r.name, ticker: String(r.ticker || ""), category: data.buckets[r.bucket].category, bucket: r.bucket,
        currency: r.currency, unit: String(r.unit || "pcs"), price,
        target_in_bucket: moved ? 0 : a.target_in_bucket, alert_price: r.alert_price || null,
      });
    }
    data.assets = data.assets.filter(a => !gone.has(a.id));
    data.transactions = data.transactions.filter(t => !gone.has(t.asset_id));
    return [...changed].filter(b => Buckets.rebalance(data, b));
  }

  /** Nothing is held any more, and no percentage points at it. */
  const soldOut = (data, asset) => !Number(asset.target_in_bucket || 0)
    && data.transactions.some(t => t.asset_id === asset.id) && Math.abs(Transactions.quantities(data)[asset.id]) < 1e-6;

  return { add, save, soldOut };
})();
