// scripts/Instruments.jsx
//
// The instrument table and the add form, used by the market view for equities and
// by the view of everything else (metals, bonds). Prices are edited here, and an
// instrument is moved to another bucket here; quantities change through
// transactions. Targets are set in the bucket itself and recalculated to 100% when
// its instruments change.

/**
 * @param {object} app
 * @param {string[]} categories  whose instruments are listed and can be added
 * @returns {Element[]} the table panel and the add form
 */
function instrumentPanels(app, categories) {
  const { data, T, money } = app;
  const currencies = ["EUR", ...Object.keys(data.settings.fx)];
  const bucketNames = categories.flatMap(c => bucketsOf(data, c));
  // listed bucket by bucket, in the buckets' order
  const pos = Core.positions(data).filter(p => categories.includes(p.category))
    .sort((a, b) => bucketNames.indexOf(a.bucket) - bucketNames.indexOf(b.bucket));
  const catOptions = categories.map(c => [c, Core.categoryLabel(data, c)]);
  const bucketOptions = bucketNames.map(b => [b, b]);
  const choose = categories.length > 1; // a category is asked only when there is a choice
  const alerts = !categories.includes("equities"); // equities are only bought: no sell alerts

  /** Saves and says in which buckets the percentages were recalculated. */
  function commitWith(redone, message) {
    app.commit(redone.length ? `${message} ${T("flash_rebalanced", { buckets: redone.join(", ") })}` : message);
  }

  // ---------------------------------------------------------- instruments
  const grid = (
    <EditGrid rows={pos.map(p => ({ ...p, delete: false }))} columns={[
      { key: "name", label: T("col_name"), width: "11rem" },
      { key: "bucket", label: T("col_bucket"), type: "select", options: bucketOptions },
      ...(choose ? [{ key: "category", label: T("col_category"), type: "select", options: catOptions }] : []),
      { key: "ticker", label: T("col_ticker"), width: "7rem" },
      { key: "currency", label: T("col_currency"), type: "select", options: currencies.map(c => [c, c]) },
      { key: "quantity", label: T("col_quantity"), type: "readonly", align: "right", fmt: (v) => I18N.number(app.L, v, 4) },
      { key: "unit", label: T("col_unit"), width: "3.5rem" },
      { key: "price", label: T("col_price"), type: "number", step: "0.0001", min: 0, width: "6.5rem" },
      { key: "value_eur", label: T("col_value_eur"), type: "readonly", align: "right", fmt: (v) => money(v, 2) },
      ...(alerts ? [{ key: "alert_price", label: T("col_alert"), type: "number", width: "6rem" }] : []),
      { key: "price_updated", label: T("col_price_date"), type: "readonly", fmt: (v) => v ? Core.dayMonthYear(v) : "–" },
      { key: "delete", label: T("col_delete"), type: "check" },
    ]} />
  );
  const confirm = <Checkbox label={T("confirm_delete_instruments")} />;
  const instruments = (
    <Panel title={T("instruments_title")} icon="table_rows">
      <stack gap="sm">
        <small tone="note">{T("instruments_help")}</small>
        {alerts ? <small tone="note">{T("alert_help")}</small> : null}
        <small tone="note">{T("move_help")}</small>
        {grid}
        {confirm}
        <row><Button variant="primary" icon="save" onClick={() => {
          if(grid.rows.some(r => r.delete) && !confirm.checked) { Alert.wrn(T("warn_confirm_delete")); return; }
          commitWith(Core.saveInstruments(data, grid.rows), T("flash_instruments_saved"));
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
    unit: <Input value="pcs" />,
  };
  const add = (
    <Expander title={T("add_instrument_title")} icon="add_circle">
      <stack gap="sm">
        {formRow(T("col_name"), f.name)}
        {formRow(T("field_ticker_descr"), f.ticker)}
        {choose
          ? formRow(T("col_category"), f.category, f.bucket, f.currency)
          : formRow(T("col_bucket"), f.bucket, f.currency)}
        {formRow(T("field_opening_quantity"), f.qty, f.unit)}
        {formRow(T("field_unit_price"), f.price)}
        <row><Button variant="primary" icon="add" onClick={() => {
          const name = f.name.value.trim();
          if(!name) { Alert.wrn(T("warn_name_required")); return; }
          const asset = Core.normalize({ assets: [{
            id: Core.newId(), name, ticker: f.ticker.value,
            category: choose ? f.category.value : categories[0], bucket: f.bucket.value,
            currency: f.currency.value, opening_quantity: f.qty.value || 0, price: f.price.value || 0,
            unit: f.unit.value || "pcs",
            price_updated: Core.today(),
          }] }).assets[0];
          data.assets.push(asset);
          commitWith([asset.bucket].filter(b => Core.rebalance(data, b)), T("flash_instrument_added", { name }));
        }}>{T("btn_add")}</Button></row>
      </stack>
    </Expander>
  );

  return [instruments, add];
}

/** Everything that is not traded as equities: metals, bonds. */
const OtherAssetsView = (app) => {
  const categories = Object.keys(app.data.categories).filter(c => c !== "equities");
  const pos = Core.positions(app.data);
  return (
    <stack gap="md">
      {categories.flatMap(c => bucketsOf(app.data, c))
        .filter(b => pos.some(p => p.bucket === b))
        .map(b => <BucketPanel app={app} positions={pos} bucket={b} footer={targetEditor(app, b)} />)}
      {instrumentPanels(app, categories)}
    </stack>
  );
};
