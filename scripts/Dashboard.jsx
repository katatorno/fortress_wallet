// scripts/Dashboard.jsx
//
// Net worth at a glance: headline numbers, allocation vs target, what the
// portfolio is made of, net worth history and each bought bucket vs its targets.

const DashboardView = (app) => {
  const { data, T, money } = app;
  const s = data.settings;
  const summ = Valuation.summary(data);
  const house = summ.house;
  const cats = Object.keys(data.categories);
  const cur = Valuation.allocationPct(summ.categories);
  const tsum = cats.reduce((a, c) => a + Number(data.categories[c].target_pct || 0), 0) || 1;

  const metrics = (
    <div class="metrics">
      <Metric label={T("net_worth")} value={money(summ.net_worth)} />
      <Metric label={T("investments")} value={money(summ.investments)} />
      <Metric label={Texts.roleLabel(data, "emergency")} value={money(summ.cash.emergency || 0)}
        help={T("target_value", { value: money(Number(s.emergency_target)) })} />
      {house.status === "owned"
        ? [<Metric label={T("home_equity")} value={money(house.equity)} />,
          <Metric label={T("mortgage_balance")} value={money(house.mortgage)} />]
        : [<Metric label={T("house_deposit")} value={money(house.equity)} />,
          <Metric label={T("other_cash")} value={money(summ.cash_total - (summ.cash.emergency || 0))} />]}
    </div>
  );

  const allocation = (
    <Panel title={T("chart_allocation")} icon="donut_large" flex="1">
      <TargetBars lang={app.L} currentName={T("legend_current")} targetName={T("legend_target")}
        total={summ.investments} rows={cats.map(c => ({
          label: Texts.categoryLabel(data, c) + (data.categories[c].buy ? "" : " 🔒"),
          value: cur[c] || 0,
          target: Number(data.categories[c].target_pct || 0) / tsum * 100,
          cls: catCls(c),
        }))} />
    </Panel>
  );

  const composition = (
    <Panel title={T("chart_composition")} icon="grid_view" flex="1">
      <Treemap lang={app.L} groups={cats.map(c => ({
        label: Texts.categoryLabel(data, c), cls: catCls(c),
        items: summ.positions.filter(p => p.category === c).map(p => ({ label: p.name, value: p.value_eur })),
      }))} />
    </Panel>
  );

  // a day whose value could not be worked out (null) is left out of the lines
  const line = (key) => data.history.filter(h => h[key] != null).map(h => [h.date, h[key]]);
  const hist = data.history;
  const history = (
    <Panel title={T("chart_history")} icon="show_chart">
      {hist.length >= 2
        ? <RangeChart app={app} id="worth" series={[
          { name: T("net_worth"), cls: "c1", points: line("net_worth") },
          { name: T("investments"), cls: "c2", points: line("investments") },
          { name: T("cash"), cls: "c3", points: line("cash") },
          ...(hist.some(h => h.cat_metals) ? [{ name: Texts.categoryLabel(data, "metals"), cls: "c4", points: line("cat_metals") }] : []),
        ]} />
        : <Empty icon="show_chart" description={T("history_empty")} />}
    </Panel>
  );

  // buckets being bought that have targets and hold something
  const buckets = Object.entries(data.buckets)
    .filter(([b, cfg]) => data.categories[cfg.category]?.buy && summ.positions.some(p =>
      p.bucket === b && Number(p.target_in_bucket || 0) > 0 && p.value_eur > 0))
    .map(([b]) => <BucketPanel app={app} positions={summ.positions} bucket={b} />);

  return (
    <stack gap="md">
      {metrics}
      <row gap="md" align="stretch">{allocation}{composition}</row>
      {history}
      {buckets}
    </stack>
  );
};
