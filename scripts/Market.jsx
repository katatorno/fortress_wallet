// scripts/Market.jsx
//
// Equities only: the buckets' shares vs the plan (edited there), each bucket with
// its targets, what to buy for an amount, the instruments and the exchange rates.

const MarketView = (app) => {
  const { data, T, money } = app;
  const s = data.settings;
  const pos = Core.positions(data).filter(p => p.category === "equities");
  // the same wallet as the calculator sees it, with equities as the only thing to buy
  const equitiesOnly = () => ({ ...data, categories: { equities: data.categories.equities || { buy: false } } });

  // ---------------------------------------------------------- shares vs targets
  const buckets = bucketsOf(data, "equities");
  const shares = [
    <BucketShares app={app} positions={pos} category="equities" title={T("bucket_shares_title")}
      footer={bucketEditor(app, "equities")} />,
    ...buckets.map(b => <BucketPanel app={app} positions={pos} bucket={b} footer={targetEditor(app, b)} />),
  ];

  // ---------------------------------------------------------- what to buy
  // the whole amount goes into purchases: no emergency fund, no prepayment pot
  const result = <stack gap="md"></stack>;
  let plan = null;
  const amount = <NumberInput value={500} min="0" step="100" onChange={() => update()} />;
  const date = <DatePicker format="%Y-%m-%d" value={Core.today()} />;
  const record = (
    <Button variant="primary" icon="check" onClick={() => {
      const spent = plan.lines.filter(l => l.kind === "buy").reduce((a, l) => a + l.eur, 0);
      Core.applyPlan(data, plan, date.value);
      app.commit(T("flash_purchases_recorded", { amount: money(spent, 2) }));
    }}>{T("btn_record_purchases")}</Button>
  );

  function update() {
    plan = Core.contributionPlan(equitiesOnly(), amount.value || 0, false, 0);
    record.disabled = !plan.lines.some(l => l.kind === "buy");
    result.replaceChildren(
      planTable(app, plan),
      ...plan.notes.map(n => <Note level="info">{n}</Note>),
    );
  }
  update();

  const buy = (
    <Panel title={T("calc_title")} icon="calculate">
      <stack gap="sm">
        <small tone="note">{T("market_buy_help")}</small>
        {formRow(T("calc_amount"), amount)}
        {result}
        <sep />
        <small tone="note">{T("market_record_help")}</small>
        <row gap="sm" align="center">{date}{record}</row>
      </stack>
    </Panel>
  );

  // ---------------------------------------------------------- exchange rates
  const fxInputs = Object.entries(s.fx).map(([cur, rate]) => [cur, <NumberInput value={rate} step="0.0001" min="0.0001" />]);
  const fxPanel = (
    <Panel title={T("fx_title")} icon="currency_exchange"
      actions={<Button size="sm" icon="cloud_download" title={T("btn_update_fx_help")} onClick={async (e) => {
        const btn = e.currentTarget;
        btn.loading = true;
        try {
          const res = await Online.fetchFx(data);
          app.commit(T("flash_fx_updated", { names: res.updated.join(", "), date: Core.dayMonthYear(res.date) }));
        }
        catch(err) { Alert.err(T("err_fx_update", { error: err.message })); }
        finally { btn.loading = false; }
      }}>{T("btn_update_fx")}</Button>}>
      <stack gap="sm">
        <row gap="md">
          {fxInputs.map(([cur, input]) => <inline gap="sm"><strong>EUR/{cur}</strong>{input}</inline>)}
        </row>
        <row><Button variant="primary" icon="save" onClick={() => {
          for(const [cur, input] of fxInputs) if(input.value > 0) s.fx[cur] = input.value;
          app.commit(T("flash_fx_saved"));
        }}>{T("btn_save_fx")}</Button></row>
      </stack>
    </Panel>
  );

  return <stack gap="md">{shares}{buy}{instrumentPanels(app, ["equities"])}{fxPanel}</stack>;
};
