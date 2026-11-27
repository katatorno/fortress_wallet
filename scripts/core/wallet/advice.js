// scripts/core/wallet/advice.js
//
// Recommendations: the hints the app gives, warnings first, in the wallet's language.

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

  /** List of hints: level = ok / info / warn (texts already translated). */
  function recommendations(data, on = null) {
    const now = Dates.parse(on) || Dates.today();
    const s = data.settings;
    const out = [];
    const summ = Valuation.summary(data);
    const pos = summ.positions;
    const add = (level, titleKey, textKey, vars = {}) =>
      out.push({ level, title: Texts.tr(data, titleKey, vars), text: Texts.tr(data, textKey, vars) });

    // 1. Emergency fund
    const have = summ.cash.emergency || 0;
    const target = Number(s.emergency_target);
    const months = s.monthly_expenses ? have / Number(s.monthly_expenses) : 0;
    if(have >= target) add("ok", "rec_ef_full_t", "rec_ef_full_x", { have: Texts.money(data, have), months: Texts.num(data, months, 1) });
    else {
      add(have < target / 2 ? "warn" : "info", "rec_ef_t", "rec_ef_x", {
        have: Texts.money(data, have), target: Texts.money(data, target),
        pct: Texts.num(data, target ? have / target * 100 : 0), missing: Texts.money(data, target - have),
      });
    }

    // 2. Categories vs targets
    const cats = summ.categories;
    const pct = Valuation.allocationPct(cats);
    const tsum = Object.values(data.categories).reduce((a, c) => a + Number(c.target_pct || 0), 0) || 1;
    for(const [c, cfg] of Object.entries(data.categories)) {
      const tgt = Number(cfg.target_pct || 0) / tsum * 100;
      const diff = (pct[c] || 0) - tgt;
      const vars = { name: Texts.categoryLabel(data, c), current: Texts.num(data, pct[c] || 0, 1), target: Texts.num(data, tgt) };
      if(!cfg.buy && diff > Number(s.drift_alert_pp)) {
        const needed = tgt > 0 ? (cats[c] || 0) / (tgt / 100) : null;
        const extra = needed ? Texts.tr(data, "rec_frozen_extra", { needed: Texts.money(data, needed) }) : "";
        add("info", "rec_frozen_t", "rec_frozen_x", { ...vars, extra });
      }
      else if(Math.abs(diff) > Number(s.drift_alert_pp)) {
        add("info", diff > 0 ? "rec_drift_above_t" : "rec_drift_below_t", "rec_drift_x",
          { ...vars, diff: Texts.num(data, Math.abs(diff), 1) });
      }
    }

    // 3. Limits of a bucket's share in its category (max_pct_in_category)
    const bvals = Valuation.bucketValues(data, pos);
    for(const [b, cfg] of Object.entries(data.buckets)) {
      const lim = cfg.max_pct_in_category;
      if(lim) {
        const total = cats[cfg.category] || 0;
        const share = total ? (bvals[b] || 0) / total * 100 : 0;
        const vars = { bucket: b, share: Texts.num(data, share, 1), limit: Texts.num(data, lim) };
        if(share > Number(lim)) add("warn", "rec_limit_over_t", "rec_limit_over_x", vars);
        else add("ok", "rec_limit_ok_t", "rec_limit_ok_x", vars);
      }
    }

    // 4. Drift inside the buckets that are being bought
    for(const [b, cfg] of Object.entries(data.buckets)) {
      if(!data.categories[cfg.category]?.buy) continue;
      const members = pos.filter(p => p.bucket === b && Number(p.target_in_bucket || 0) > 0);
      const total = members.reduce((a, p) => a + p.value_eur, 0);
      const tsumB = members.reduce((a, p) => a + Number(p.target_in_bucket), 0);
      for(const p of members) {
        const cur = total ? p.value_eur / total * 100 : 0;
        const tgt = Number(p.target_in_bucket) / tsumB * 100;
        if(Math.abs(cur - tgt) > Number(s.drift_alert_pp)) {
          add("info", "rec_bucket_drift_t", "rec_bucket_drift_x",
            { name: p.name, bucket: b, current: Texts.num(data, cur, 1), target: Texts.num(data, tgt) });
        }
      }
    }

    // 5. Sell thresholds (e.g. precious metals); equities are only bought
    for(const p of pos) {
      if(p.category === "equities") continue;
      const alert = p.alert_price;
      if(!Base.isBlank(alert) && Number(alert) !== 0 && Number(p.price) >= Number(alert)) {
        add("warn", "rec_alert_t", "rec_alert_x",
          { name: p.name, price: Texts.num(data, p.price, 2), currency: p.currency, alert: Texts.num(data, alert, 2) });
      }
    }

    // 6. Stale prices
    const stale = pos.filter(p => {
      const d = Dates.parse(p.price_updated);
      return p.quantity > 0 && (!d || Dates.daysBetween(d, now) > Number(s.stale_days));
    }).map(p => p.name);
    if(stale.length) {
      out.push({ level: "info", title: Texts.tr(data, "rec_stale_t", { count: stale.length }),
        text: stale.slice(0, 12).join(", ") + (stale.length > 12 ? "…" : "") });
    }

    // 7. Mortgage and prepayments
    const m = data.mortgage;
    if(Number(m.amount)) {
      const st = Mortgage.state(m);
      const ratio = s.net_income ? st.payment / Number(s.net_income) * 100 : 0;
      add(ratio <= 35 ? "ok" : ratio <= 40 ? "info" : "warn", "rec_dsti_t", "rec_dsti_x",
        { ratio: Texts.num(data, ratio), payment: Texts.money(data, st.payment, 2), income: Texts.money(data, Number(s.net_income)) });
      const be = Mortgage.prepaymentBreakEvenMonths(m);
      const rate = Number(m.rate_pct), alt = Number(s.alt_safe_yield_pct);
      if(be !== null) {
        const verdict = Texts.tr(data, rate > alt ? "rec_prepay_wins" : "rec_prepay_loses");
        add("info", "rec_prepay_t", "rec_prepay_x",
          { rate: Texts.num(data, rate, 2), months: Texts.num(data, be, 1), verdict, alt: Texts.num(data, alt, 1) });
      }
      const pot = summ.cash.prepay || 0;
      if(pot >= Number(s.min_prepayment) && st.balance > 0) add("warn", "rec_pot_t", "rec_pot_x", { pot: Texts.money(data, pot) });
    }

    // 8. Instruments in a bucket of another category (from a file made before the category followed the bucket)
    for(const p of pos) {
      const b = data.buckets[p.bucket];
      if(b && b.category !== p.category) {
        add("warn", "rec_category_mismatch_t", "rec_category_mismatch_x", {
          name: p.name, bucket: p.bucket, category: Texts.categoryLabel(data, p.category), bucket_category: Texts.categoryLabel(data, b.category),
        });
      }
    }

    // 9. Bond maturities
    for(const p of pos) {
      if(p.category !== "bonds" || p.quantity <= 0) continue;
      const mat = bondMaturity(p);
      if(mat) {
        const days = Dates.daysBetween(now, mat);
        if(days >= 0 && days <= 365) add("warn", "rec_bond_t", "rec_bond_x", { name: p.name, date: Dates.monthYear(mat) });
      }
    }
    return out;
  }

  return { bondMaturity, recommendations };
})();
