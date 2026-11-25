// scripts/Transactions.jsx
//
// Buy / sell / adjust, cash deposits and withdrawals, and both histories.
// Deleting a transaction undoes it: quantity = opening quantity + transactions.

const TransactionsView = (app) => {
  const { data, T, money } = app;
  const pos = Core.positions(data);
  const byId = Object.fromEntries(pos.map(p => [p.id, p]));

  // ---------------------------------------------------------- new transaction
  const first = pos[0];
  const priceLabel = <span>{T("field_unit_price_cur", { currency: first?.currency || "EUR" })}</span>;
  const price = <NumberInput value={first ? Number(first.price) : 0} min="0" step="any" />;
  const instrument = (
    <Select onChange={(id) => {
      price.value = Number(byId[id].price);
      priceLabel.textContent = T("field_unit_price_cur", { currency: byId[id].currency });
    }}>
      {options(pos.map(p => [p.id, `${p.name} (${p.currency})`]))}
    </Select>
  );
  const type = (
    <Toggle value="buy">
      {Core.TX_TYPES.map(t => <ToggleBtn value={t} label={Core.txLabel(data, t)} />)}
    </Toggle>
  );
  const date = <DatePicker format="%Y-%m-%d" value={Core.today()} />;
  const qty = <NumberInput step="any" />;
  const fee = <NumberInput value={0} min="0" step="0.01" />;
  const updatePrice = <Checkbox checked label={T("field_update_price")} />;
  const note = <Input />;

  const txPanel = (
    <Panel title={T("new_transaction_title")} icon="add_shopping_cart" flex="1">
      <stack gap="sm">
        {formRow(T("field_instrument"), instrument)}
        {formRow(T("field_type"), type)}
        {formRow(T("field_date"), date)}
        {formRow(T("field_quantity_tx"), qty)}
        {formRow(priceLabel, price)}
        {formRow(T("field_fee_eur"), fee)}
        {formRow("", updatePrice)}
        {formRow(T("field_note"), note)}
        <row><Button variant="primary" icon="add" onClick={() => {
          const aid = instrument.value;
          const q = qty.value;
          if(!aid) { Alert.wrn(T("warn_add_instrument_first")); return; }
          if(!q) { Alert.wrn(T("warn_quantity_zero")); return; }
          if(type.value !== "adjust" && q < 0) { Alert.wrn(T("warn_quantity_positive")); return; }
          Core.addTransaction(data, aid, type.value, q, price.value || 0, fee.value || 0,
            date.value, note.value, updatePrice.checked);
          app.commit(T("flash_transaction", { type: Core.txLabel(data, type.value), name: byId[aid].name, quantity: String(q) }));
        }}>{T("btn_add_transaction")}</Button></row>
      </stack>
    </Panel>
  );

  // ---------------------------------------------------------- cash deposit / withdrawal
  const account = <Select>{options(data.cash.map(c => [c.id, c.name]))}</Select>;
  const amount = <NumberInput step="0.01" />;
  const cDate = <DatePicker format="%Y-%m-%d" value={Core.today()} />;
  const cNote = <Input />;
  const cashPanel = (
    <Panel title={T("cash_op_title")} icon="payments" flex="1">
      <stack gap="sm">
        {formRow(T("col_account"), account)}
        {formRow(T("field_amount_signed"), amount)}
        {formRow(T("field_date"), cDate)}
        {formRow(T("field_note"), cNote)}
        <row><Button variant="primary" icon="save" onClick={() => {
          if(!amount.value) { Alert.wrn(T("warn_amount_zero")); return; }
          Core.addCash(data, account.value, amount.value, cNote.value, cDate.value);
          app.commit(T("flash_cash_op", { amount: money(amount.value, 2) }));
        }}>{T("btn_save")}</Button></row>
      </stack>
    </Panel>
  );

  // ---------------------------------------------------------- history
  let history;
  if(data.transactions.length) {
    const rows = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date)).map(t => ({
      ...t, instrument: byId[t.asset_id]?.name || t.asset_id, delete: false,
    }));
    const grid = (
      <EditGrid rows={rows} columns={[
        { key: "date", label: T("field_date"), type: "readonly", fmt: Core.dayMonthYear },
        { key: "instrument", label: T("field_instrument"), type: "readonly" },
        { key: "type", label: T("field_type"), type: "readonly", fmt: (v) => Core.txLabel(data, v) },
        { key: "quantity", label: T("col_quantity"), type: "readonly", align: "right", fmt: (v) => I18N.number(app.L, v, 4) },
        { key: "price", label: T("col_price"), type: "readonly", align: "right", fmt: (v) => I18N.number(app.L, v, 4) },
        { key: "fee", label: T("field_fee_eur"), type: "readonly", align: "right", fmt: (v) => money(v || 0, 2) },
        { key: "note", label: T("field_note"), type: "readonly" },
        { key: "delete", label: T("col_delete"), type: "check" },
      ]} />
    );
    history = (
      <stack gap="sm">
        {grid}
        <row><Button variant="danger" icon="delete" onClick={() => {
          const gone = new Set(grid.rows.filter(r => r.delete).map(r => r.id));
          if(!gone.size) return;
          data.transactions = data.transactions.filter(t => !gone.has(t.id));
          app.commit(T("flash_transactions_deleted", { count: gone.size }));
        }}>{T("btn_delete_transactions")}</Button></row>
      </stack>
    );
  }
  else history = <Empty icon="receipt_long" description={T("tx_empty")} />;

  const names = Object.fromEntries(data.cash.map(c => [c.id, c.name]));
  const cashLog = data.cash_log.length ? (
    <Panel title={T("cash_log_title")} icon="history">
      <Table columns={[T("field_date"), T("col_account"), T("col_amount"), T("field_note")]}
        rows={[...data.cash_log].reverse().map(c => [Core.dayMonthYear(c.date), names[c.account_id] || c.account_id, money(c.amount, 2), c.note || ""])} />
    </Panel>
  ) : null;

  return (
    <stack gap="md">
      <row gap="md" align="start">{txPanel}{cashPanel}</row>
      <Panel title={T("tx_history_title")} icon="receipt_long">{history}</Panel>
      {cashLog}
    </stack>
  );
};
