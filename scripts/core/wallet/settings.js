// scripts/core/wallet/settings.js
//
// The save of the settings view: budget values, category targets and the bucket table.

const Settings = (() => {
  const SETTING_LIMITS = {
    emergency_target: ["set_emergency_target", 0], monthly_expenses: ["set_monthly_expenses", 0],
    net_income: ["set_net_income", 0], prepay_share_pct: ["set_prepay_share", 0, 100],
    min_prepayment: ["set_min_prepayment", 0], alt_safe_yield_pct: ["set_alt_yield", -100, 100],
    drift_alert_pp: ["set_drift", 0, 100], stale_days: ["set_stale_days", 1],
  };

  /**
   * The settings view: budget values, category targets (adding up to 100) and,
   * when given, the bucket table.
   * @param {{settings?:object, categories?:Array<{category:string, target_pct:any, buy:boolean}>, buckets?:object[]}} form
   */
  function save(data, { settings = {}, categories = [], buckets = null }) {
    const values = {};
    for(const [k, v] of Object.entries(settings)) {
      if(!Object.hasOwn(SETTING_LIMITS, k)) continue;
      const [key, min, max] = SETTING_LIMITS[k];
      const x = Rules.number(data, v, key, min, max);
      values[k] = k === "stale_days" ? Math.round(x) : x;
    }
    const targets = categories.map(r => {
      if(!Object.hasOwn(data.categories, r.category)) throw new Rules.RuleError("err_value_choice", { field: Texts.tr(data, "col_category") });
      const field = `${Texts.categoryLabel(data, r.category)} · ${Texts.tr(data, "col_target_pct")}`;
      return { category: r.category, buy: !!r.buy, target_pct: Rules.percent(r.target_pct, field) ?? 0 };
    });
    if(targets.length) {
      const total = targets.reduce((a, r) => a + r.target_pct, 0);
      if(!Buckets.isWhole(total)) throw new Rules.RuleError("err_category_sum", { sum: Texts.num(data, total, total % 1 ? 2 : 0) });
    }
    const plan = buckets ? Buckets.plan(data, buckets) : null;

    Object.assign(data.settings, values);
    for(const r of targets) Object.assign(data.categories[r.category], { target_pct: r.target_pct, buy: r.buy });
    if(plan) Buckets.apply(data, plan);
  }

  return { save };
})();
