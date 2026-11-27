// scripts/Settings.jsx
//
// Budget and emergency fund, allocation targets, buckets and language. The rules
// of a save are in Settings.save: everything is checked first, and a refused
// save changes nothing.

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
      category: c, label: Texts.categoryLabel(data, c), target_pct: Number(cfg.target_pct), buy: !!cfg.buy,
    }))} columns={[
      { key: "label", label: T("col_category"), type: "readonly" },
      { key: "target_pct", label: T("col_target_pct"), type: "number", min: 0, max: 100, width: "5rem" },
      { key: "buy", label: T("col_buy"), type: "check" },
    ]} />
  );

  // a bucket is renamed here (its instruments follow), added, or removed when empty;
  // one that holds instruments keeps its category
  const buckets = (
    <EditGrid addLabel={T("btn_add_bucket")}
      newRow={() => ({ old: null, bucket: "", category: Object.keys(data.categories)[0], target: null, limit: null, delete: false })}
      rows={Object.entries(data.buckets).map(([b, cfg]) => ({
        old: b, bucket: b, category: cfg.category,
        target: cfg.target_pct_in_category ?? null, limit: cfg.max_pct_in_category ?? null, delete: false,
      }))} columns={[
        { key: "bucket", label: T("col_bucket"), width: "9rem" },
        { key: "category", label: T("col_category"), type: "select", options: Object.keys(data.categories).map(c => [c, Texts.categoryLabel(data, c)]) },
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

  function save() {
    const value = (input, fallback) => input.value ?? fallback;
    try {
      Settings.save(data, {
        settings: {
          emergency_target: value(f.emergency, s.emergency_target), monthly_expenses: value(f.expenses, s.monthly_expenses),
          net_income: value(f.income, s.net_income), prepay_share_pct: value(f.share, s.prepay_share_pct),
          min_prepayment: value(f.minPrepay, s.min_prepayment), alt_safe_yield_pct: value(f.alt, s.alt_safe_yield_pct),
          drift_alert_pp: value(f.drift, s.drift_alert_pp), stale_days: value(f.stale, s.stale_days),
        },
        categories: targets.rows,
        buckets: buckets.rows.map(r => ({ old: r.old, name: r.bucket, category: r.category, share: r.target, limit: r.limit, delete: r.delete })),
      });
    }
    catch(e) {
      if(!(e instanceof Rules.RuleError)) throw e;
      Alert.err(T(e.key, e.vars));
      return;
    }
    app.commit(T("flash_settings_saved"));
  }

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
          <small tone="note">{T("settings_buckets_rename_help")}</small>
        </stack>
      </Panel>
      <row><Button variant="primary" icon="save" onClick={() => save()}>{T("btn_save_settings")}</Button></row>
    </stack>
  );
};
