// scripts/core/wallet/advice.js
//
// Recommendations: the hints the app gives, a rule a subject, warnings first, in the
// wallet's language.

const Advice = (() => {
  function bondMaturity(asset) {
    if(asset.maturity) return Dates.parse(asset.maturity);
    const m = `${asset.name || ""} ${asset.ticker || ""}`.match(/EDO(\d{2})(\d{2})/i);
    if(m) {
      const month = Number(m[1]), yy = Number(m[2]);
      if(month >= 1 && month <= 12) return Dates.iso(2000 + yy, month, 1);
    }
    return null;
  }

  /** A hint: its level, ok / info / warn, and its title and text in the wallet's language. */
  const _hint = (data, level, titleKey, textKey, vars = {}) =>
    ({ level, title: Texts.tr(data, titleKey, vars), text: Texts.tr(data, textKey, vars) });

  // ---------------------------------------------------------------- the rules
  // Each takes the wallet, its `Valuation.summary` and the day, and gives its hints.

  function _emergencyFund({ data, summary }) {
    const s = data.settings;
    const have = summary.cash.emergency || 0;
    const target = Number(s.emergency_target);
    const months = s.monthly_expenses ? have / Number(s.monthly_expenses) : 0;
    if(have >= target) {
      return [_hint(data, "ok", "rec_ef_full_t", "rec_ef_full_x", { have: Texts.money(data, have), months: Texts.num(data, months, 1) })];
    }
    return [_hint(data, have < target / 2 ? "warn" : "info", "rec_ef_t", "rec_ef_x", {
      have: Texts.money(data, have), target: Texts.money(data, target),
      pct: Texts.num(data, target ? have / target * 100 : 0), missing: Texts.money(data, target - have),
    })];
  }

  /** Each category's share against its target. */
  function _categoryTargets({ data, summary }) {
    const s = data.settings;
    const cats = summary.categories;
    const pct = Valuation.allocationPct(cats);
    const tsum = Object.values(data.categories).reduce((a, c) => a + Number(c.target_pct || 0), 0) || 1;
    return Object.entries(data.categories).flatMap(([c, cfg]) => {
      const tgt = Number(cfg.target_pct || 0) / tsum * 100;
      const diff = (pct[c] || 0) - tgt;
      const vars = { name: Texts.categoryLabel(data, c), current: Texts.num(data, pct[c] || 0, 1), target: Texts.num(data, tgt) };
      if(!cfg.buy && diff > Number(s.drift_alert_pp)) {
        const needed = tgt > 0 ? (cats[c] || 0) / (tgt / 100) : null;
        const extra = needed ? Texts.tr(data, "rec_frozen_extra", { needed: Texts.money(data, needed) }) : "";
        return [_hint(data, "info", "rec_frozen_t", "rec_frozen_x", { ...vars, extra })];
      }
      if(!(Math.abs(diff) > Number(s.drift_alert_pp))) return [];
      return [_hint(data, "info", diff > 0 ? "rec_drift_above_t" : "rec_drift_below_t", "rec_drift_x",
        { ...vars, diff: Texts.num(data, Math.abs(diff), 1) })];
    });
  }

  /** Limits of a bucket's share in its category (max_pct_in_category). */
  function _bucketLimits({ data, summary }) {
    const values = Valuation.bucketValues(data, summary.positions);
    return Object.entries(data.buckets).filter(([, cfg]) => cfg.max_pct_in_category).map(([b, cfg]) => {
      const lim = cfg.max_pct_in_category;
      const total = summary.categories[cfg.category] || 0;
      const share = total ? (values[b] || 0) / total * 100 : 0;
      const vars = { bucket: b, share: Texts.num(data, share, 1), limit: Texts.num(data, lim) };
      return share > Number(lim) ? _hint(data, "warn", "rec_limit_over_t", "rec_limit_over_x", vars)
        : _hint(data, "ok", "rec_limit_ok_t", "rec_limit_ok_x", vars);
    });
  }

  /** Drift inside the buckets that are being bought. */
  function _bucketDrift({ data, summary }) {
    return Object.entries(data.buckets).filter(([, cfg]) => data.categories[cfg.category]?.buy).flatMap(([b]) => {
      const members = summary.positions.filter(p => p.bucket === b && Number(p.target_in_bucket || 0) > 0);
      const total = members.reduce((a, p) => a + p.value_eur, 0);
      const tsum = members.reduce((a, p) => a + Number(p.target_in_bucket), 0);
      return members.flatMap(p => {
        const cur = total ? p.value_eur / total * 100 : 0;
        const tgt = Number(p.target_in_bucket) / tsum * 100;
        if(!(Math.abs(cur - tgt) > Number(data.settings.drift_alert_pp))) return [];
        return [_hint(data, "info", "rec_bucket_drift_t", "rec_bucket_drift_x",
          { name: p.name, bucket: b, current: Texts.num(data, cur, 1), target: Texts.num(data, tgt) })];
      });
    });
  }

  /** Sell thresholds (e.g. precious metals); equities are only bought. */
  function _sellThresholds({ data, summary }) {
    return summary.positions.filter(p => p.category !== "equities" && !Base.isBlank(p.alert_price)
      && Number(p.alert_price) !== 0 && Number(p.price) >= Number(p.alert_price))
      .map(p => _hint(data, "warn", "rec_alert_t", "rec_alert_x",
        { name: p.name, price: Texts.num(data, p.price, 2), currency: p.currency, alert: Texts.num(data, p.alert_price, 2) }));
  }

  /** Held instruments whose price is old, named together. */
  function _stalePrices({ data, summary, now }) {
    const stale = summary.positions.filter(p => {
      const d = Dates.parse(p.price_updated);
      return p.quantity > 0 && (!d || Dates.daysBetween(d, now) > Number(data.settings.stale_days));
    }).map(p => p.name);
    if(!stale.length) return [];
    return [{ level: "info", title: Texts.tr(data, "rec_stale_t", { count: stale.length }),
      text: stale.slice(0, 12).join(", ") + (stale.length > 12 ? "…" : "") }];
  }

  /** The payment against the income, what prepaying gives, a prepayment pot that is full enough. */
  function _mortgage({ data, summary }) {
    const s = data.settings, m = data.mortgage;
    if(!Number(m.amount)) return [];
    const out = [];
    const st = Mortgage.state(m);
    const ratio = s.net_income ? st.payment / Number(s.net_income) * 100 : 0;
    out.push(_hint(data, ratio <= 35 ? "ok" : ratio <= 40 ? "info" : "warn", "rec_dsti_t", "rec_dsti_x",
      { ratio: Texts.num(data, ratio), payment: Texts.money(data, st.payment, 2), income: Texts.money(data, Number(s.net_income)) }));
    const be = Mortgage.prepaymentBreakEvenMonths(m);
    const rate = Number(m.rate_pct), alt = Number(s.alt_safe_yield_pct);
    if(be !== null) {
      const verdict = Texts.tr(data, rate > alt ? "rec_prepay_wins" : "rec_prepay_loses");
      out.push(_hint(data, "info", "rec_prepay_t", "rec_prepay_x",
        { rate: Texts.num(data, rate, 2), months: Texts.num(data, be, 1), verdict, alt: Texts.num(data, alt, 1) }));
    }
    const pot = summary.cash.prepay || 0;
    if(pot >= Number(s.min_prepayment) && st.balance > 0) {
      out.push(_hint(data, "warn", "rec_pot_t", "rec_pot_x", { pot: Texts.money(data, pot) }));
    }
    return out;
  }

  /** Instruments in a bucket of another category (from a file made before the category followed the bucket). */
  function _categoryMismatch({ data, summary }) {
    return summary.positions.filter(p => data.buckets[p.bucket] && data.buckets[p.bucket].category !== p.category)
      .map(p => _hint(data, "warn", "rec_category_mismatch_t", "rec_category_mismatch_x", {
        name: p.name, bucket: p.bucket, category: Texts.categoryLabel(data, p.category),
        bucket_category: Texts.categoryLabel(data, data.buckets[p.bucket].category),
      }));
  }

  /** Bonds held which fall due within a year. */
  function _bondMaturities({ data, summary, now }) {
    return summary.positions.filter(p => p.category === "bonds" && !(p.quantity <= 0)).flatMap(p => {
      const maturity = bondMaturity(p);
      if(!maturity) return [];
      const days = Dates.daysBetween(now, maturity);
      if(!(days >= 0 && days <= 365)) return [];
      return [_hint(data, "warn", "rec_bond_t", "rec_bond_x", { name: p.name, date: Dates.monthYear(maturity) })];
    });
  }

  const RULES = [_emergencyFund, _categoryTargets, _bucketLimits, _bucketDrift, _sellThresholds, _stalePrices,
    _mortgage, _categoryMismatch, _bondMaturities];
  const ORDER = { warn: 0, info: 1, ok: 2 };

  /**
   * List of hints: level = ok / info / warn (texts already translated). Warnings come
   * first, then information, then what is in order; within a level, as the rules go.
   */
  function recommendations(data, on = null) {
    const now = Dates.parse(on) || Dates.today();
    const summary = Valuation.summary(data);
    return RULES.flatMap(rule => rule({ data, summary, now })).sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  }

  return { bondMaturity, recommendations };
})();
