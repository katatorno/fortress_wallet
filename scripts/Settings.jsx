// scripts/Settings.jsx
//
// Budget and emergency fund, allocation targets, buckets and language.

const SettingsView = (app) => {
  const { data, T } = app;
  const s = data.settings;

  const f = {
    emergency: <NumberInput value={Number(s.emergency_target)} min="0" step="500" />,
    expenses: <NumberInput value={Number(s.monthly_expenses)} min="0" step="50" />,
    income: <NumberInput value={Number(s.net_income)} min="0" step="50" />,
    share: <NumberInput value={Number(s.prepay_share_pct)} min="0" max="100" step="5" />,
    minPrepay: <NumberInput value={Number(s.min_prepayment)} min="0" step="100" />,
    alt: <NumberInput value={Number(s.alt_safe_yield_pct)} min="0" step="0.1" title={T("set_alt_yield_help")} />,
    drift: <NumberInput value={Number(s.drift_alert_pp)} min="0" step="0.5" />,
    stale: <NumberInput value={Number(s.stale_days)} min="1" step="1" />,
  };

  const targets = (
    <EditGrid rows={Object.entries(data.categories).map(([c, cfg]) => ({
      category: c, label: Core.categoryLabel(data, c), target_pct: Number(cfg.target_pct), buy: !!cfg.buy,
    }))} columns={[
      { key: "label", label: T("col_category"), type: "readonly" },
      { key: "target_pct", label: T("col_target_pct"), type: "number", min: 0, max: 100, width: "5rem" },
      { key: "buy", label: T("col_buy"), type: "check" },
    ]} />
  );

  const buckets = (
    <EditGrid addLabel={T("btn_add_bucket")} newRow={() => ({ bucket: "", category: Object.keys(data.categories)[0], delete: false })}
      rows={Object.entries(data.buckets).map(([b, cfg]) => ({
        bucket: b, category: cfg.category,
        target: cfg.target_pct_in_category ?? null, limit: cfg.max_pct_in_category ?? null, delete: false,
      }))} columns={[
        { key: "bucket", label: T("col_bucket"), width: "9rem" },
        { key: "category", label: T("col_category"), type: "select", options: Object.keys(data.categories).map(c => [c, Core.categoryLabel(data, c)]) },
        { key: "target", label: T("col_target_in_category"), type: "number", min: 0, max: 100, width: "5rem" },
        { key: "limit", label: T("col_limit_in_category"), type: "number", min: 0, max: 100, width: "5rem" },
        { key: "delete", label: T("col_delete"), type: "check" },
      ]} />
  );

  const langs = I18N.languages();
  const language = (
    <Select value={app.L} onChange={(v) => { s.language = v; app.commit(I18N.t(v, "flash_settings_saved"), { rebuild: true }); }}>
      {options(Object.entries(langs))}
    </Select>
  );

  return (
    <stack gap="md">
      <Panel title={T("settings_general_title")} icon="language">
        <stack gap="sm">
          {formRow(T("set_language"), language)}
        </stack>
      </Panel>
      <Panel title={T("settings_budget_title")} icon="account_balance">
        <stack gap="sm">
          {formRow(T("set_emergency_target"), f.emergency)}
          {formRow(T("set_monthly_expenses"), f.expenses)}
          {formRow(T("set_net_income"), f.income)}
          {formRow(T("set_prepay_share"), f.share)}
          {formRow(T("set_min_prepayment"), f.minPrepay)}
          {formRow(T("set_alt_yield"), f.alt)}
          {formNote(<small tone="note">{T("set_alt_yield_help")}</small>)}
          {formRow(T("set_drift"), f.drift)}
          {formRow(T("set_stale_days"), f.stale)}
        </stack>
      </Panel>
      <Panel title={T("settings_targets_title")} icon="pie_chart">
        <stack gap="sm">
          {targets}
          <small tone="note">{T("settings_targets_help")}</small>
        </stack>
      </Panel>
      <Panel title={T("settings_buckets_title")} icon="category">
        <stack gap="sm">
          {buckets}
          <small tone="note">{T("settings_buckets_help")}</small>
        </stack>
      </Panel>
      <row><Button variant="primary" icon="save" onClick={() => {
        const num = (input, fallback) => input.value ?? fallback;
        // everything is checked first: a refused save changes nothing
        const next = {};
        for(const r of buckets.rows) {
          const name = String(r.bucket || "").trim();
          if(!name || r.delete) continue;
          const cfg = { category: r.category };
          if(r.target != null && r.target !== "") cfg.target_pct_in_category = Number(r.target);
          if(r.limit != null && r.limit !== "") cfg.max_pct_in_category = Number(r.limit);
          next[name] = cfg;
        }
        const missing = [...new Set(data.assets.map(a => a.bucket))].filter(b => !(b in next));
        if(missing.length) { Alert.err(T("err_bucket_in_use", { buckets: missing.sort().join(", ") })); return; }
        const total = targets.rows.reduce((a, r) => a + Number(r.target_pct || 0), 0);
        if(Math.abs(total - 100) > 0.001 || targets.rows.some(r => Number(r.target_pct || 0) < 0)) {
          Alert.err(T("err_category_sum", { sum: I18N.number(app.L, total, total % 1 ? 2 : 0) }));
          return;
        }
        const shares = Core.badShares(next);
        if(shares.length) {
          Alert.err(T("err_share_sum", { categories: Core.sumList(data,
            shares.map(x => ({ name: Core.categoryLabel(data, x.name), sum: x.sum }))) }));
          return;
        }
        Object.assign(s, {
          emergency_target: num(f.emergency, s.emergency_target), monthly_expenses: num(f.expenses, s.monthly_expenses),
          net_income: num(f.income, s.net_income),
          prepay_share_pct: num(f.share, s.prepay_share_pct), min_prepayment: num(f.minPrepay, s.min_prepayment),
          alt_safe_yield_pct: num(f.alt, s.alt_safe_yield_pct), drift_alert_pp: num(f.drift, s.drift_alert_pp),
          stale_days: Math.round(num(f.stale, s.stale_days)),
        });
        for(const r of targets.rows) Object.assign(data.categories[r.category], { target_pct: Number(r.target_pct || 0), buy: !!r.buy });
        data.buckets = next;
        app.commit(T("flash_settings_saved"));
      }}>{T("btn_save_settings")}</Button></row>
    </stack>
  );
};
