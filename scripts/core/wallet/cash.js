// scripts/core/wallet/cash.js
//
// Cash accounts: their roles, their movements in the cash log, and the save of the
// cash table.

const Cash = (() => {
  const ROLES = ["emergency", "prepay", "home", "other"];

  const account = (data, role) => data.cash.find(c => c.role === role) || null;

  function add(data, accountId, amount, note = "", on = null) {
    const acc = data.cash.find(c => c.id === accountId);
    if(!acc) throw new Error(`No cash account ${accountId}`);
    acc.amount = Base.round2(Number(acc.amount) + Number(amount));
    data.cash_log.push({ id: Base.newId(), date: Dates.parse(on) || Dates.today(), account_id: accountId, amount: Base.round2(Number(amount)), note });
  }

  /**
   * The cash table: names, roles, currencies and balances. A changed balance goes
   * to the cash log as a correction with `note`.
   * @param {Array<{id:string, name:string, role:string, currency:string, amount:any}>} rows
   */
  function save(data, rows, note = "", on = null) {
    const currencies = ["EUR", ...Object.keys(data.settings.fx)];
    const next = rows.map(r => {
      const acc = data.cash.find(c => c.id === r.id);
      if(!acc) throw new Error(`No cash account ${r.id}`);
      const name = String(r.name ?? "").trim();
      const field = (key) => `${name || acc.id} · ${Texts.tr(data, key)}`;
      if(!ROLES.includes(r.role)) throw new Rules.RuleError("err_value_choice", { field: field("col_role") });
      if(!currencies.includes(r.currency)) throw new Rules.RuleError("err_value_choice", { field: field("col_currency") });
      if(!Base.isNumeric(r.amount ?? 0)) throw new Rules.RuleError("err_value_number", { field: field("col_amount") });
      return { acc, name, role: r.role, currency: r.currency, amount: Number(r.amount ?? 0) };
    });
    for(const r of next) {
      const diff = r.amount - Number(r.acc.amount);
      Object.assign(r.acc, { name: r.name, role: r.role, currency: r.currency });
      if(Math.abs(diff) > 0.001) add(data, r.acc.id, diff, note, on);
    }
  }

  return { ROLES, account, add, save };
})();
