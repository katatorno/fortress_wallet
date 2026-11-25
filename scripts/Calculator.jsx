// scripts/Calculator.jsx
//
// "I have X € – what should I do with it?": emergency fund first, then the
// prepayment pot, then purchases by target, without selling anything.

const CalculatorView = (app) => {
  const { data, T, money } = app;
  const s = data.settings;
  const result = <stack gap="md"></stack>;
  let plan = null;

  const amount = <NumberInput value={1000} min="0" step="100" onChange={() => update()} />;
  const fill = <Checkbox checked label={T("calc_fill_emergency")} onChange={() => update()} />;
  const share = <Slider value={Number(s.prepay_share_pct)} suffix="%" onChange={() => update()} />;

  function update() {
    plan = Core.contributionPlan(data, amount.value || 0, fill.checked, share.value);
    const kind = { cash: "plan_kind_cash", buy: "plan_kind_buy", unassigned: "plan_kind_unassigned", rest: "plan_kind_rest" };
    const rows = plan.lines.map(ln => [
      T(kind[ln.kind]), ln.label, ln.ticker || "", money(ln.eur, 2),
      ln.kind === "buy" ? I18N.number(app.L, ln.units, 4) : "",
      ln.kind === "buy" ? `${I18N.number(app.L, ln.price, 4)} ${ln.currency}` : "",
    ]);
    const cats = Object.keys(data.categories);
    const tsum = cats.reduce((a, c) => a + Number(data.categories[c].target_pct || 0), 0) || 1;
    result.replaceChildren(
      rows.length ? <Table columns={[T("col_action"), T("col_where"), T("col_ticker"), T("col_amount_eur"), T("col_quantity"), T("col_price")]} rows={rows} /> : <Empty icon="calculate" />,
      ...plan.notes.map(n => <Note level="info">{n}</Note>),
      <Panel title={T("chart_before_after")} icon="bar_chart">
        <GroupedBars lang={app.L} cats={cats.map(c => Core.categoryLabel(data, c))} targetName={T("legend_target")}
          targets={cats.map(c => Number(data.categories[c].target_pct || 0) / tsum * 100)}
          series={[
            { name: T("legend_before"), cls: "c1", values: cats.map(c => plan.before_pct[c] || 0) },
            { name: T("legend_after"), cls: "c2", values: cats.map(c => plan.after_pct[c] || 0) },
          ]} />
      </Panel>,
    );
  }
  update();

  const applyDate = <DatePicker format="%Y-%m-%d" value={Core.today()} />;
  return (
    <stack gap="md">
      <Panel title={T("calc_title")} icon="calculate">
        <stack gap="sm">
          {formRow(T("calc_amount"), amount)}
          {formRow("", fill)}
          {formRow(T("calc_prepay_share"), share)}
          {formNote(<small tone="note">{T("calc_prepay_share_help")}</small>)}
        </stack>
      </Panel>
      {result}
      <Panel icon="task_alt" title={T("calc_record_title")}>
        <stack gap="sm">
          <small tone="note">{T("calc_apply_help")}</small>
          <row gap="sm" align="center">
            {applyDate}
            <Button variant="primary" icon="check" onClick={() => {
              if(!plan?.lines.length) return;
              Core.applyPlan(data, plan, applyDate.value);
              app.commit(T("flash_plan_applied", { amount: money(plan.amount) }));
            }}>{T("btn_apply_plan")}</Button>
          </row>
        </stack>
      </Panel>
    </stack>
  );
};
