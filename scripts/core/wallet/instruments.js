// scripts/core/wallet/instruments.js
//
// Instruments: the save of their table, and which of them are sold out.

const Instruments = (() => {
  /**
   * Saves the rows of an instrument table: edits, moves and deletions. A moved
   * instrument starts at 0 in its new bucket, and the buckets that lost or gained
   * one are brought back to 100.
   * @param {object[]} rows  an instrument each: id, delete and the editable fields
   * @returns {string[]} the buckets whose targets were recalculated
   */
  function save(data, rows, on = null) {
    const date = Dates.parse(on) || Dates.today();
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
        // the category is the bucket's: an instrument is never in a bucket of another one
        name: r.name, ticker: r.ticker || "", category: data.buckets[r.bucket]?.category ?? r.category ?? a.category, bucket: r.bucket,
        currency: r.currency, unit: r.unit || "pcs", price,
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

  return { save, soldOut };
})();
