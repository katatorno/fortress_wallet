// scripts/core/wallet/plan.js
//
// The contribution calculator: an amount split without selling (emergency fund,
// prepayment pot, purchases by target), and recording it.

const Plan = (() => {
  /**
   * Splits an amount without selling: tops up the most underweight positions first
   * until they reach a common level; once everything is on target, splits by targets.
   */
  function waterfill(current, targets, amount) {
    const keys = Object.keys(targets).filter(k => (targets[k] || 0) > 0);
    const result = Object.fromEntries(Object.keys(targets).map(k => [k, 0]));
    if(amount <= 0 || !keys.length) return result;
    const tw = keys.reduce((s, k) => s + targets[k], 0);
    const w = Object.fromEntries(keys.map(k => [k, targets[k] / tw]));
    const cur = Object.fromEntries(keys.map(k => [k, Math.max(Number(current[k] || 0), 0)]));
    const need = (level) => keys.reduce((s, k) => s + Math.max(0, w[k] * level - cur[k]), 0);
    let lo = 0, hi = keys.reduce((s, k) => s + cur[k], 0) + amount;
    while(need(hi) < amount) hi *= 2;
    for(let it = 0; it < 200; it++) {
      const mid = (lo + hi) / 2;
      if(need(mid) < amount) lo = mid; else hi = mid;
    }
    const alloc = Object.fromEntries(keys.map(k => [k, Math.max(0, w[k] * hi - cur[k])]));
    const s = keys.reduce((acc, k) => acc + alloc[k], 0);
    for(const k of keys) result[k] = s ? alloc[k] * amount / s : 0;
    return result;
  }

  /** Why a bucket gets nothing of `eur`, and from which amount it would. */
  function _bucketWaits(data, values, shares, bucket, eur) {
    const keys = Object.keys(shares);
    const weight = keys.reduce((s, k) => s + shares[k], 0);
    const total = keys.reduce((s, k) => s + (values[k] || 0), 0);
    // waterfill reaches the bucket once the common level passes what it holds per share
    const level = (values[bucket] || 0) / (shares[bucket] / weight);
    const from = keys.reduce((s, k) => s + Math.max(0, shares[k] / weight * level - (values[k] || 0)), 0);
    return Texts.tr(data, "note_bucket_waits", {
      bucket, current: Texts.num(data, total ? (values[bucket] || 0) / total * 100 : 0, 1),
      target: Texts.num(data, shares[bucket] / weight * 100), amount: Texts.money(data, eur), from: Texts.money(data, from),
    });
  }

  /** What to do with an amount: emergency fund → prepayment pot → purchases by target. */
  function contribution(data, amount, fillEmergency = true, prepaySharePct = null) {
    const s = data.settings;
    const lines = [], notes = [];
    let left = Number(amount);
    const cash = Valuation.cashByRole(data);

    if(fillEmergency) {
      const deficit = Math.max(0, Number(s.emergency_target) - (cash.emergency || 0));
      const e = Math.min(deficit, left);
      if(e > 0.005) {
        const acc = Cash.account(data, "emergency");
        lines.push({ kind: "cash", account_id: acc ? acc.id : null, label: Texts.roleLabel(data, "emergency"), eur: e });
        left -= e;
      }
      if(deficit > e) {
        notes.push(Texts.tr(data, "note_emergency_short", { missing: Texts.money(data, deficit - e) }));
        left = Math.max(left, 0);
      }
    }

    const share = Number(prepaySharePct ?? s.prepay_share_pct);
    if(left > 0.005 && share > 0 && Number(data.mortgage.amount)) {
      const p = left * share / 100;
      const acc = Cash.account(data, "prepay");
      lines.push({ kind: "cash", account_id: acc ? acc.id : null, label: Texts.roleLabel(data, "prepay"), eur: p });
      left -= p;
    }

    const pos = Valuation.positions(data);
    const byId = Object.fromEntries(pos.map(p => [p.id, p]));
    const cats = Valuation.categoryValues(data, pos);
    const buckets = Valuation.bucketValues(data, pos);
    const buyTargets = Object.fromEntries(Object.entries(data.categories)
      .filter(([, cfg]) => cfg.buy).map(([c, cfg]) => [c, Number(cfg.target_pct || 0)]));
    if(left > 0.005 && !Object.keys(buyTargets).length) notes.push(Texts.tr(data, "note_no_buy_categories"));
    const catAlloc = left > 0.005 ? waterfill(cats, buyTargets, left) : {};

    for(const [cat, eur] of Object.entries(catAlloc)) {
      if(eur <= 0.005) continue;
      const shares = Object.fromEntries(Object.entries(data.buckets)
        .filter(([, cfg]) => cfg.category === cat && Number(cfg.target_pct_in_category || 0) > 0)
        .map(([b, cfg]) => [b, Number(cfg.target_pct_in_category)]));
      if(!Object.keys(shares).length) {
        lines.push({ kind: "unassigned", label: Texts.tr(data, "plan_choose_instrument", { category: Texts.categoryLabel(data, cat) }), eur });
        continue;
      }
      for(const [b, beur] of Object.entries(waterfill(buckets, shares, eur))) {
        const waits = beur <= 0.005; // the whole amount is catching up in other buckets
        if(waits) notes.push(_bucketWaits(data, buckets, shares, b, eur));
        const members = pos.filter(p => p.bucket === b && Number(p.target_in_bucket || 0) > 0);
        if(!members.length) {
          if(beur > 0.005) {
            lines.push({ kind: "unassigned", bucket: b, label: Texts.tr(data, "plan_no_targets", { bucket: b }), eur: beur });
          }
          continue;
        }
        const aAlloc = waterfill(
          Object.fromEntries(members.map(p => [p.id, p.value_eur])),
          Object.fromEntries(members.map(p => [p.id, Number(p.target_in_bucket)])), beur);
        // every instrument with a percentage gets a line: a purchase (units may be
        // fractional), or why there is none
        for(const p of members) {
          const aeur = aAlloc[p.id] || 0;
          const unit = p.unit_eur;
          if(aeur > 0.005 && unit > 0) {
            lines.push({ kind: "buy", asset_id: p.id, label: p.name, ticker: p.ticker || "",
              eur: aeur, units: aeur / unit, price: Number(p.price), currency: p.currency });
          }
          else {
            const why = unit <= 0 ? "plan_skip_price" : waits ? "plan_skip_bucket" : "plan_skip_target";
            lines.push({ kind: "skip", asset_id: p.id, ticker: p.ticker || "", eur: aeur,
              label: Texts.tr(data, why, { name: p.name, bucket: b }) });
          }
        }
      }
    }

    const catsAfter = { ...cats };
    for(const ln of lines) {
      if(ln.kind === "buy") {
        const c = byId[ln.asset_id].category;
        catsAfter[c] = (catsAfter[c] || 0) + ln.eur;
      }
    }
    for(const [b, cfg] of Object.entries(data.buckets)) {
      if(cfg.max_pct_in_category) {
        const catTotal = catsAfter[cfg.category] || 0;
        const room = Math.max(0, Number(cfg.max_pct_in_category) / 100 * catTotal - (buckets[b] || 0));
        notes.push(Texts.tr(data, "note_bucket_room", { bucket: b, room: Texts.money(data, room), limit: Texts.num(data, cfg.max_pct_in_category) }));
      }
    }
    return { amount: Number(amount), lines, notes, before_pct: Valuation.allocationPct(cats), after_pct: Valuation.allocationPct(catsAfter) };
  }

  /**
   * Records a plan: its cash into the accounts, its purchases as transactions. A date
   * that is none is refused (Rules.RuleError) before anything changes.
   * @param {string} [on]  an empty date is today
   */
  function apply(data, plan, on = null) {
    const date = Rules.date(data, on, "field_date") || Dates.today();
    const note = Texts.tr(data, "note_from_calculator");
    for(const ln of plan.lines) {
      if(ln.kind === "cash" && ln.account_id) Cash.add(data, ln.account_id, ln.eur, note, date);
      else if(ln.kind === "buy") {
        data.transactions.push({ id: Base.newId(), date, asset_id: ln.asset_id, type: "buy",
          quantity: Math.round(ln.units * 1e6) / 1e6, price: ln.price, fee: 0, note });
      }
    }
  }

  return { waterfill, contribution, apply };
})();
