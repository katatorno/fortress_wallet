// scripts/core/wallet/rates.js
//
// Exchange rates, in units of currency per 1 EUR (USD: 1.0943, PLN: 4.48): what counts
// as one, their save, the currencies they give the wallet, and an amount from a
// currency into EUR and back.

const Rates = (() => {
  /** The wallet's currencies: the euro, and those with a rate. */
  const currencies = (data) => ["EUR", ...Object.keys(data.settings.fx)];

  /** Whether a value is an exchange rate: a number above 0, one written as text too. */
  const isRate = (v) => Base.isNumeric(v) && Number(v) > 0;

  function of(data, currency) {
    if(currency === "EUR") return 1;
    const rate = data.settings.fx[currency];
    if(!rate) throw new Error(Texts.tr(data, "err_fx_missing", { currency }));
    return Number(rate);
  }

  const toEur = (data, amount, currency) => Number(amount) / of(data, currency);

  /** An amount in EUR as an amount of a currency. */
  const fromEur = (data, amount, currency) => Number(amount) * of(data, currency);

  /**
   * Saves exchange rates, each of a currency the wallet has a rate for. All are checked
   * before any is written; throws Rules.RuleError, which names the currency, and leaves
   * the data as it was.
   * @param {Object<string, any>} rates  currency → units per 1 EUR
   */
  function save(data, rates) {
    const checked = Object.entries(rates).map(([currency, rate]) => {
      if(!Object.hasOwn(data.settings.fx, currency)) {
        throw new Rules.RuleError("err_value_choice", { field: `${currency} · ${Texts.tr(data, "col_currency")}` });
      }
      if(!isRate(rate)) throw new Rules.RuleError("err_rate", { currency });
      return [currency, Number(rate)];
    });
    for(const [currency, rate] of checked) data.settings.fx[currency] = rate;
  }

  return { currencies, isRate, of, toEur, fromEur, save };
})();
