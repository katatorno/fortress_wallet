// scripts/Holdings.jsx
//
// Exchange rates, the instrument table (prices are edited here, quantities through
// transactions), adding an instrument and the cash accounts.

const HoldingsView = (app) => {
  const { data, T, money } = app;
  const s = data.settings;
  const pos = Core.positions(data);
  const currencies = ["EUR", ...Object.keys(s.fx)];

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

  // ---------------------------------------------------------- instruments
  const catOptions = Object.keys(data.categories).map(c => [c, Core.categoryLabel(data, c)]);
  const bucketOptions = Object.keys(data.buckets).map(b => [b, b]);
  const grid = (
    <EditGrid rows={pos.map(p => ({ ...p, delete: false }))} columns={[
      { key: "name", label: T("col_name"), width: "11rem" },
      { key: "ticker", label: T("col_ticker"), width: "7rem" },
      { key: "category", label: T("col_category"), type: "select", options: catOptions },
      { key: "bucket", label: T("col_bucket"), type: "select", options: bucketOptions },
      { key: "currency", label: T("col_currency"), type: "select", options: currencies.map(c => [c, c]) },
      { key: "quantity", label: T("col_quantity"), type: "readonly", align: "right", fmt: (v) => I18N.number(app.L, v, 4) },
      { key: "unit", label: T("col_unit"), width: "3.5rem" },
      { key: "price", label: T("col_price"), type: "number", step: "0.0001", width: "6.5rem" },
      { key: "value_eur", label: T("col_value_eur"), type: "readonly", align: "right", fmt: (v) => money(v, 2) },
      { key: "target_in_bucket", label: T("col_target_in_bucket"), type: "number", width: "4.5rem" },
      { key: "fractional", label: T("col_fractional"), type: "check", help: T("col_fractional_help") },
      { key: "alert_price", label: T("col_alert"), type: "number", width: "6rem" },
      { key: "price_updated", label: T("col_price_date"), type: "readonly", fmt: (v) => v ? Core.dayMonthYear(v) : "–" },
      { key: "delete", label: T("col_delete"), type: "check" },
    ]} />
  );
  const confirm = <Checkbox label={T("confirm_delete_instruments")} />;
  const instruments = (
    <Panel title={T("instruments_title")} icon="table_rows">
      <stack gap="sm">
        <small tone="note">{T("instruments_help")}</small>
        {grid}
        {confirm}
        <row><Button variant="primary" icon="save" onClick={() => {
          const byId = Object.fromEntries(data.assets.map(a => [a.id, a]));
          const toDelete = grid.rows.filter(r => r.delete).map(r => r.id);
          if(toDelete.length && !confirm.checked) { Alert.wrn(T("warn_confirm_delete")); return; }
          const today = Core.today();
          for(const r of grid.rows) {
            if(r.delete) continue;
            const a = byId[r.id];
            const price = Number(r.price || 0);
            if(Math.abs(price - Number(a.price)) > 1e-9) a.price_updated = today;
            Object.assign(a, {
              name: r.name, ticker: r.ticker || "", category: r.category, bucket: r.bucket,
              currency: r.currency, unit: r.unit || "pcs", price,
              target_in_bucket: Number(r.target_in_bucket || 0), fractional: !!r.fractional,
              alert_price: r.alert_price || null,
            });
          }
          data.assets = data.assets.filter(a => !toDelete.includes(a.id));
          data.transactions = data.transactions.filter(t => !toDelete.includes(t.asset_id));
          app.commit(T("flash_instruments_saved"));
        }}>{T("btn_save_instruments")}</Button></row>
      </stack>
    </Panel>
  );

  // ---------------------------------------------------------- add instrument
  const f = {
    name: <Input />, ticker: <Input />,
    category: <Select>{options(catOptions)}</Select>,
    bucket: <Select>{options(bucketOptions)}</Select>,
    currency: <Select>{options(currencies.map(c => [c, c]))}</Select>,
    qty: <NumberInput value={0} min="0" step="any" />,
    price: <NumberInput value={0} min="0" step="any" />,
    target: <NumberInput value={0} min="0" step="any" />,
    fractional: <Checkbox checked label={T("col_fractional")} />,
    unit: <Input value="pcs" />,
  };
  const add = (
    <Expander title={T("add_instrument_title")} icon="add_circle">
      <stack gap="sm">
        {formRow(T("col_name"), f.name)}
        {formRow(T("field_ticker_descr"), f.ticker)}
        {formRow(T("col_category"), f.category, f.bucket, f.currency)}
        {formRow(T("field_opening_quantity"), f.qty, f.unit)}
        {formRow(T("field_unit_price"), f.price)}
        {formRow(T("col_target_in_bucket"), f.target, f.fractional)}
        <row><Button variant="primary" icon="add" onClick={() => {
          const name = f.name.value.trim();
          if(!name) { Alert.wrn(T("warn_name_required")); return; }
          data.assets.push(Core.normalize({ assets: [{
            id: Core.newId(), name, ticker: f.ticker.value, category: f.category.value, bucket: f.bucket.value,
            currency: f.currency.value, opening_quantity: f.qty.value || 0, price: f.price.value || 0,
            target_in_bucket: f.target.value || 0, fractional: f.fractional.checked, unit: f.unit.value || "pcs",
            price_updated: Core.today(),
          }] }).assets[0]);
          app.commit(T("flash_instrument_added", { name }));
        }}>{T("btn_add")}</Button></row>
      </stack>
    </Expander>
  );

  // ---------------------------------------------------------- cash
  const cashGrid = (
    <EditGrid rows={data.cash} columns={[
      { key: "name", label: T("col_account"), width: "14rem" },
      { key: "role", label: T("col_role"), type: "select", options: Core.ROLES.map(r => [r, Core.roleLabel(data, r)]) },
      { key: "currency", label: T("col_currency"), type: "select", options: currencies.map(c => [c, c]) },
      { key: "amount", label: T("col_amount"), type: "number", step: "0.01", width: "8rem" },
    ]} />
  );
  const cash = (
    <Panel title={T("cash_title")} icon="savings">
      <stack gap="sm">
        {cashGrid}
        <row><Button variant="primary" icon="save" onClick={() => {
          const byId = Object.fromEntries(data.cash.map(c => [c.id, c]));
          for(const r of cashGrid.rows) {
            const c = byId[r.id];
            const diff = Number(r.amount || 0) - Number(c.amount);
            Object.assign(c, { name: r.name, role: r.role, currency: r.currency });
            if(Math.abs(diff) > 0.001) Core.addCash(data, c.id, diff, T("note_manual_correction"));
          }
          app.commit(T("flash_cash_saved"));
        }}>{T("btn_save_cash")}</Button></row>
      </stack>
    </Panel>
  );

  return <stack gap="md">{fxPanel}{instruments}{add}{cash}</stack>;
};
