// scripts/core/wallet/buckets.js
//
// Buckets and their percentages: instrument targets that add up to 100 or are all 0,
// bucket shares that add up to 100, and the saves of the bucket tables.

const Buckets = (() => {
  const isWhole = (sum) => Math.abs(sum - 100) < 0.001;
  const percentText = (data, x) => Texts.num(data, x, Math.abs(x - Math.round(x)) < 0.001 ? 0 : 2) + "%";

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
    const next = given.map(x => sum > 0 ? Base.round2(x / sum * 100) : 0);
    if(sum > 0) { // the rounding leftover goes to the largest
      const top = next.indexOf(Math.max(...next));
      next[top] = Base.round2(next[top] + 100 - next.reduce((a, b) => a + b, 0));
    }
    members.forEach((a, i) => { a.target_in_bucket = next[i]; });
    return true;
  }

  /**
   * Saves the targets of one bucket, only when they add up to 100 or are all 0.
   * Throws Rules.RuleError and leaves the data as it was.
   * @param {Object<string, number>} targets  instrument id → percentage, every instrument of the bucket
   */
  function saveTargets(data, bucket, targets) {
    const next = data.assets.map(a => a.bucket === bucket && a.id in targets
      ? { ...a, target_in_bucket: Number(targets[a.id] || 0) } : a);
    const [bad] = badTargets(data.buckets, next, [bucket]);
    if(bad) throw new Rules.RuleError("targets_wrong", { sum: percentText(data, bad.sum) });
    for(const a of data.assets) if(a.bucket === bucket && a.id in targets) a.target_in_bucket = Number(targets[a.id] || 0);
  }

  /** "fortress 95%, sandbox 5%" for the messages and the running totals. */
  const sumList = (data, items) => items.map(i => `${i.name} ${percentText(data, i.sum)}`).join(", ");

  /**
   * Checks the buckets as a table edits them: the settings view those of every
   * category, `save` those of one. A bucket may be renamed (its instruments follow),
   * added, or removed when empty; one holding instruments keeps its category, since
   * they belong to it. The shares of each category the rows touch must be in order
   * (see `badShares`). Buckets keep their order, new ones come last.
   * @param {Array<{old:string|null, name:string, category:string, share:any, limit:any, delete?:boolean}>} rows
   *   `old` is the current name, null for a new bucket; buckets not among the rows stay as they are
   * @returns {{buckets:object, renamed:Map<string,string>}} what saving would make; throws Rules.RuleError
   */
  function plan(data, rows) {
    const label = (b, key) => `${b} · ${Texts.tr(data, key)}`;
    const listed = new Set(rows.filter(r => r.old).map(r => r.old));
    const others = Object.entries(data.buckets).filter(([b]) => !listed.has(b));
    const keep = [], gone = [];
    for(const r of rows) {
      const name = String(r.name ?? "").trim();
      if(r.delete) { if(r.old) gone.push(r.old); continue; }
      if(!name) { if(r.old) throw new Rules.RuleError("err_bucket_name"); continue; } // an empty new row is no bucket
      if(Base.isReserved(name)) throw new Rules.RuleError("err_name_reserved", { name });
      if(!Object.hasOwn(data.categories, r.category)) throw new Rules.RuleError("err_value_choice", { field: label(name, "col_category") });
      keep.push({ ...r, name, share: Rules.percent(r.share, label(name, "col_target_in_category")),
        limit: Rules.percent(r.limit, label(name, "col_limit_in_category")) });
    }
    const names = [...keep.map(r => r.name), ...others.map(([b]) => b)];
    const twice = names.find((n, i) => names.indexOf(n) !== i);
    if(twice) throw new Rules.RuleError("err_bucket_duplicate", { bucket: twice });
    const holds = (b) => data.assets.some(a => a.bucket === b);
    const used = gone.filter(holds);
    if(used.length) throw new Rules.RuleError("err_bucket_in_use", { buckets: used.sort().join(", ") });
    const moved = keep.filter(r => r.old && data.buckets[r.old] && r.category !== data.buckets[r.old].category && holds(r.old));
    if(moved.length) throw new Rules.RuleError("err_bucket_category_used", { buckets: moved.map(r => r.old).sort().join(", ") });

    const edited = keep.map(r => {
      const cfg = { ...(r.old ? data.buckets[r.old] : {}), category: r.category };
      delete cfg.target_pct_in_category;
      delete cfg.max_pct_in_category;
      if(r.share !== null) cfg.target_pct_in_category = r.share;
      if(r.limit !== null) cfg.max_pct_in_category = r.limit;
      return { old: r.old, name: r.name, cfg };
    });
    // a bucket keeps its place, under a new name too; new ones go to the end, as they came
    const order = Object.keys(data.buckets);
    const place = ({ old }) => order.includes(old) ? order.indexOf(old) : order.length;
    const all = [...edited, ...others.map(([b, cfg]) => ({ old: b, name: b, cfg }))].sort((a, b) => place(a) - place(b));
    const buckets = Object.fromEntries(all.map(b => [b.name, b.cfg]));

    const touched = new Set([...keep.map(r => r.category), ...[...listed].map(b => data.buckets[b]?.category)]);
    const bad = badShares(buckets).filter(x => touched.has(x.name));
    if(bad.length) {
      throw new Rules.RuleError("err_share_sum", { categories: sumList(data, bad.map(x => ({ name: Texts.categoryLabel(data, x.name), sum: x.sum }))) });
    }
    return { buckets, renamed: new Map(keep.filter(r => r.old && r.old !== r.name).map(r => [r.old, r.name])) };
  }

  function apply(data, plan) {
    for(const a of data.assets) if(plan.renamed.has(a.bucket)) a.bucket = plan.renamed.get(a.bucket);
    data.buckets = plan.buckets;
  }

  /**
   * Saves one category's buckets as the market view edits them, names and shares, by
   * the rules of `plan`. A bucket keeps the limit it has, which that editor does not
   * show. Throws Rules.RuleError and leaves the data as it was.
   * @param {Array<{old:string|null, name:string, share:any, delete?:boolean}>} rows
   */
  function save(data, category, rows) {
    const limit = (old) => old ? data.buckets[old]?.max_pct_in_category : null;
    apply(data, plan(data, rows.map(r => ({ ...r, category, limit: limit(r.old) }))));
  }

  return {
    isWhole, targetSum, badTargets, badShares, rebalance, saveTargets, sumList, save, plan,
    apply,
  };
})();
