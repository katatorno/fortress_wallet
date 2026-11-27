// scripts/Cash.jsx
//
// The cash accounts: names, roles, currencies and balances. A changed balance is
// written to the cash log as a manual correction.

const CashView = (app) => {
  const { data, T } = app;
  const currencies = ["EUR", ...Object.keys(data.settings.fx)];
  const cashGrid = (
    <EditGrid rows={data.cash} columns={[
      { key: "name", label: T("col_account"), width: "14rem" },
      { key: "role", label: T("col_role"), type: "select", options: Core.ROLES.map(r => [r, Core.roleLabel(data, r)]) },
      { key: "currency", label: T("col_currency"), type: "select", options: currencies.map(c => [c, c]) },
      { key: "amount", label: T("col_amount"), type: "number", step: "0.01", width: "8rem" },
    ]} />
  );
  return (
    <Panel title={T("cash_title")} icon="savings">
      <stack gap="sm">
        {cashGrid}
        <row><Button variant="primary" icon="save" onClick={() => {
          try { Core.saveCash(data, cashGrid.rows, T("note_manual_correction")); }
          catch(e) {
            if(!(e instanceof Core.RuleError)) throw e;
            Alert.err(T(e.key, e.vars));
            return;
          }
          app.commit(T("flash_cash_saved"));
        }}>{T("btn_save_cash")}</Button></row>
      </stack>
    </Panel>
  );
};
