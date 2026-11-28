// scripts/core/wallet/texts.js
//
// Texts, numbers and amounts of money in the wallet's language, and the names there of
// categories, roles, repayment modes and transaction types.

const Texts = (() => {
  const lang = (data) => data?.settings?.language || I18N.DEFAULT;
  const tr = (data, key, vars) => I18N.t(lang(data), key, vars);
  const money = (data, x, dec = 0) => I18N.money(lang(data), x, dec);
  const num = (data, x, dec = 0) => I18N.number(lang(data), x, dec);

  /** An amount in a currency, as a cash account holds it: euros as `money`, others with their code. */
  function amount(data, x, currency = "EUR", dec = 2) {
    if(currency === "EUR") return money(data, x, dec);
    const text = num(data, x, dec);
    return text === "–" ? text : `${text} ${currency}`;
  }

  function categoryLabel(data, cat) {
    const text = tr(data, "cat_" + cat);
    return text === "cat_" + cat ? cat : text;
  }
  const roleLabel = (data, role) => tr(data, "role_" + role);
  const modeLabel = (data, mode) => tr(data, "mode_" + mode);
  const txLabel = (data, tx) => tr(data, "tx_" + tx);

  return { lang, tr, money, num, amount, categoryLabel, roleLabel, modeLabel, txLabel };
})();
