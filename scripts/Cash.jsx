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
};
