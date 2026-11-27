// scripts/core/wallet/5-buckets.js
//
// Buckets and their percentages: instrument targets that add up to 100 or are all 0,
// bucket shares that add up to 100, and the saves of the bucket tables.

Object.assign(Core, (() => {
  const {
    tr, num, categoryLabel, round2, isReserved, isBlank, isNumeric, today, parseDate,
  } = Core;

  // ---------------------------------------------------------------- buckets

  /** A save refused by a rule: `key` and `vars` are the message, and the data stays as it was. */
  class RuleError extends Error {
    constructor(key, vars = {}) { super(key); this.key = key; this.vars = vars; }
  }
  const BucketError = RuleError;

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
        // the category is the bucket's: an instrument is never in a bucket of another one
        name: r.name, ticker: r.ticker || "", category: data.buckets[r.bucket]?.category ?? r.category ?? a.category, bucket: r.bucket,
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
      else if(name && isReserved(name)) throw new BucketError("err_name_reserved", { name });
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

  /** A percentage typed into a table: empty, or a number from 0 to 100. */
  const typedPercent = (v, field) => {
    if(isBlank(v)) return null;
    if(!isNumeric(v) || Number(v) < 0 || Number(v) > 100) throw new RuleError("err_value_range", { field, min: 0, max: 100 });
    return Number(v);
  };

  /**
   * Checks the buckets as the settings table edits them, every category at once.
   * A bucket may be renamed (its instruments follow), added, or removed when empty;
   * one holding instruments keeps its category, since they belong to it.
   * @param {Array<{old:string|null, name:string, category:string, share:any, limit:any, delete?:boolean}>} rows
   *   buckets not among the rows stay as they are
   * @returns {{buckets:object, renamed:Map<string,string>}} what saving would make; throws RuleError
   */
  function planBuckets(data, rows) {
    const label = (b, key) => `${b} · ${tr(data, key)}`;
    const listed = new Set(rows.filter(r => r.old).map(r => r.old));
    const all = [...rows, ...Object.entries(data.buckets).filter(([b]) => !listed.has(b)).map(([b, cfg]) => ({
      old: b, name: b, category: cfg.category, share: cfg.target_pct_in_category, limit: cfg.max_pct_in_category,
    }))];
    const keep = [], gone = [];
    for(const r of all) {
      const name = String(r.name ?? "").trim();
      if(r.delete) { if(r.old) gone.push(r.old); continue; }
      if(!name) { if(r.old) throw new RuleError("err_bucket_name"); continue; } // an empty new row is no bucket
      if(isReserved(name)) throw new RuleError("err_name_reserved", { name });
      if(!Object.hasOwn(data.categories, r.category)) throw new RuleError("err_value_choice", { field: label(name, "col_category") });
      keep.push({ ...r, name, share: typedPercent(r.share, label(name, "col_target_in_category")),
        limit: typedPercent(r.limit, label(name, "col_limit_in_category")) });
    }
    const names = keep.map(r => r.name);
    const twice = names.find((n, i) => names.indexOf(n) !== i);
    if(twice) throw new RuleError("err_bucket_duplicate", { bucket: twice });
    const holds = (b) => data.assets.some(a => a.bucket === b);
    const used = gone.filter(holds);
    if(used.length) throw new RuleError("err_bucket_in_use", { buckets: used.sort().join(", ") });
    const moved = keep.filter(r => r.old && data.buckets[r.old] && r.category !== data.buckets[r.old].category && holds(r.old));
    if(moved.length) throw new RuleError("err_bucket_category_used", { buckets: moved.map(r => r.old).sort().join(", ") });

    const buckets = Object.fromEntries(keep.map(r => {
      const cfg = { ...(r.old ? data.buckets[r.old] : {}), category: r.category };
      delete cfg.target_pct_in_category;
      delete cfg.max_pct_in_category;
      if(r.share !== null) cfg.target_pct_in_category = r.share;
      if(r.limit !== null) cfg.max_pct_in_category = r.limit;
      return [r.name, cfg];
    }));
    const bad = badShares(buckets);
    if(bad.length) {
      throw new RuleError("err_share_sum", { categories: sumList(data, bad.map(x => ({ name: categoryLabel(data, x.name), sum: x.sum }))) });
    }
    return { buckets, renamed: new Map(keep.filter(r => r.old && r.old !== r.name).map(r => [r.old, r.name])) };
  }

  function applyBuckets(data, plan) {
    for(const a of data.assets) if(plan.renamed.has(a.bucket)) a.bucket = plan.renamed.get(a.bucket);
    data.buckets = plan.buckets;
  }

  /** Saves the buckets of the settings table (see `planBuckets`). Throws RuleError and leaves the data as it was. */
  function saveBucketSettings(data, rows) {
    applyBuckets(data, planBuckets(data, rows));
  }

  return {
    RuleError, BucketError, isWhole, targetSum, badTargets, badShares, rebalance, saveTargets,
    saveInstruments, sumList, saveBuckets, typedPercent, planBuckets, applyBuckets,
    saveBucketSettings,
  };
})());
