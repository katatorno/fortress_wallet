// scripts/Instruments.jsx
//
// The instrument table and the add form, used by the market view for equities and
// by the view of everything else (metals, bonds). Prices are edited here, and an
// instrument is moved to another bucket here; quantities change through
// transactions. Targets are set in the bucket itself and recalculated to 100% when
// its instruments change. An instrument's category is its bucket's: choosing the
// bucket chooses the category. Every change of an instrument is `Instruments`'.

/**
 * @param {object} app
 * @param {string[]} categories  whose instruments are listed and can be added
 * @returns {Element[]} the table panel and the add form
 */
function instrumentPanels(app, categories) {
  const { data, T, money } = app;
  const currencies = Rates.currencies(data);
  const bucketNames = categories.flatMap(c => Buckets.of(data, c));
  // listed bucket by bucket, in the buckets' order
  const pos = Valuation.positions(data).filter(p => categories.includes(p.category) && !Instruments.soldOut(data, p))
    .sort((a, b) => bucketNames.indexOf(a.bucket) - bucketNames.indexOf(b.bucket));
  // with buckets of several categories each one says its category
  const several = categories.length > 1;
  const bucketOptions = bucketNames.map(b => [b, several ? `${b} (${Texts.categoryLabel(data, data.buckets[b].category)})` : b]);
  const alerts = !categories.includes("equities"); // equities are only bought: no sell alerts

  /**
   * Makes a change of the instruments, commits it and says in which buckets the
   * percentages were recalculated; a refusal is shown and nothing changes.
   */
  function change(make, message) {
    let redone;
    try { redone = make(); }
    catch(e) {
      if(!(e instanceof Rules.RuleError)) throw e;
      const say = e.key.startsWith("warn_") ? Alert.wrn : Alert.err;
      say(T(e.key, e.vars));
      return;
    }
    app.commit(redone.length ? `${message} ${T("flash_rebalanced", { buckets: redone.join(", ") })}` : message);
  }

  // ---------------------------------------------------------- instruments
  const grid = (
    <EditGrid rows={pos.map(p => ({ ...p, delete: false }))} columns={[
      { key: "name", label: T("col_name"), width: "11rem" },
      { key: "bucket", label: T("col_bucket"), type: "select", options: bucketOptions },
      { key: "ticker", label: T("col_ticker"), width: "7rem" },
      { key: "currency", label: T("col_currency"), type: "select", options: currencies.map(c => [c, c]) },
      { key: "quantity", label: T("col_quantity"), type: "readonly", align: "right", fmt: (v) => I18N.number(app.L, v, 4) },
      { key: "unit", label: T("col_unit"), width: "3.5rem" },
      { key: "price", label: T("col_price"), type: "number", step: "0.0001", min: 0, width: "6.5rem" },
      { key: "value_eur", label: T("col_value_eur"), type: "readonly", align: "right", fmt: (v) => money(v, 2) },
      ...(alerts ? [{ key: "alert_price", label: T("col_alert"), type: "number", width: "6rem" }] : []),
      { key: "price_updated", label: T("col_price_date"), type: "readonly", fmt: (v) => v ? Dates.dayMonthYear(v) : "–" },
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
          change(() => Instruments.save(data, grid.rows), T("flash_instruments_saved"));
        }}>{T("btn_save_instruments")}</Button></row>
      </stack>
    </Panel>
  );

  // ---------------------------------------------------------- add instrument
  const f = {
    name: <Input />, ticker: <Input />,
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
        {formRow(T("col_bucket"), f.bucket, f.currency)}
        {formRow(T("field_opening_quantity"), f.qty, f.unit)}
        {formRow(T("field_unit_price"), f.price)}
        <row><Button variant="primary" icon="add" onClick={() => change(() => Instruments.add(data, {
          name: f.name.value, ticker: f.ticker.value, bucket: f.bucket.value, currency: f.currency.value,
          opening_quantity: f.qty.value, price: f.price.value, unit: f.unit.value,
        }), T("flash_instrument_added", { name: f.name.value.trim() }))}>{T("btn_add")}</Button></row>
      </stack>
    </Expander>
  );

  return [instruments, add];
}

/** Everything that is not traded as equities: metals, bonds. */
const OtherAssetsView = (app) => {
  const categories = Object.keys(app.data.categories).filter(c => c !== "equities");
  const pos = Valuation.positions(app.data);
  return (
    <stack gap="md">
      {categories.flatMap(c => Buckets.of(app.data, c))
        .filter(b => pos.some(p => p.bucket === b))
        .map(b => <BucketPanel app={app} positions={pos} bucket={b} footer={targetEditor(app, b)} />)}
      {instrumentPanels(app, categories)}
    </stack>
  );
};
