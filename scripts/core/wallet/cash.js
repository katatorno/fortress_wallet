// scripts/core/wallet/cash.js
//
// Cash accounts: their roles, their movements in the cash log (as they come, or
// checked as the form sends one), and the save of the cash table.

const Cash = (() => {
  const ROLES = ["emergency", "prepay", "home", "other"];

  const account = (data, role) => data.cash.find(c => c.role === role) || null;

  /** The account of an id; a refusal when there is none. */
  function _existing(data, id) {
    const acc = data.cash.find(c => c.id === id);
    if(!acc) throw new Rules.RuleError("err_value_choice", { field: Texts.tr(data, "col_account") });
    return acc;
  }

  function add(data, accountId, amount, note = "", on = null) {
    const acc = _existing(data, accountId);
    const date = Rules.date(data, on, "field_date") || Dates.today();
    acc.amount = Base.round2(Number(acc.amount) + Number(amount));
    data.cash_log.push({ id: Base.newId(), date, account_id: accountId, amount: Base.round2(Number(amount)), note });
  }

  /** Whether `add` of an amount on a balance gives numbers: in cents, one so large gives none. */
  const countable = (balance, amount) =>
    [Number(amount), Number(balance) + Number(amount)].every(x => Number.isFinite(Base.round2(x)));

  /**
   * A deposit or, below 0, a withdrawal from the form, checked: an amount which in cents
   * is not 0, and the account and the date as `add` checks them. Throws Rules.RuleError
   * and leaves the data as it was.
   * @param {{accountId:string, amount:any, date?:string, note?:string}} movement  an empty date is today
   */
  function record(data, { accountId, amount, date = null, note = "" }) {
    if(!Base.isNumeric(amount) || !Base.round2(Number(amount))) throw new Rules.RuleError("warn_amount_zero");
    if(!countable(data.cash.find(c => c.id === accountId)?.amount || 0, amount)) {
      throw new Rules.RuleError("err_value_number", { field: Texts.tr(data, "field_amount_signed") });
    }
    add(data, accountId, amount, note, date);
  }

  /**
   * The cash table: names, roles, currencies and balances. A changed balance goes
   * to the cash log as a correction with `note`.
   * @param {Array<{id:string, name:string, role:string, currency:string, amount:any}>} rows
   */
  function save(data, rows, note = "", on = null) {
    const date = Rules.date(data, on, "field_date");
    const currencies = Rates.currencies(data);
    const next = rows.map(r => {
      const acc = _existing(data, r.id);
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
      if(Math.abs(diff) > 0.001) add(data, r.acc.id, diff, note, date);
    }
  }

  return { ROLES, account, add, countable, record, save };
})();
