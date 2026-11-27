// scripts/core/wallet/rates.js
//
// Exchange rates, in units of currency per 1 EUR (USD: 1.0943, PLN: 4.48), and an
// amount in EUR.

const Rates = (() => {
  function of(data, currency) {
    if(currency === "EUR") return 1;
    const rate = data.settings.fx[currency];
    if(!rate) throw new Error(Texts.tr(data, "err_fx_missing", { currency }));
    return Number(rate);
  }

  const toEur = (data, amount, currency) => Number(amount) / of(data, currency);

  return { of, toEur };
})();
