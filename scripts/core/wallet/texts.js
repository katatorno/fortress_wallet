// scripts/core/wallet/texts.js
//
// Texts and numbers in the wallet's language, and the names there of categories,
// roles, repayment modes and transaction types.

const Texts = (() => {
  const lang = (data) => data?.settings?.language || I18N.DEFAULT;
  const tr = (data, key, vars) => I18N.t(lang(data), key, vars);
  const money = (data, x, dec = 0) => I18N.money(lang(data), x, dec);
  const num = (data, x, dec = 0) => I18N.number(lang(data), x, dec);

  function categoryLabel(data, cat) {
    const text = tr(data, "cat_" + cat);
    return text === "cat_" + cat ? cat : text;
  }
  const roleLabel = (data, role) => tr(data, "role_" + role);
  const modeLabel = (data, mode) => tr(data, "mode_" + mode);
  const txLabel = (data, tx) => tr(data, "tx_" + tx);

  return { lang, tr, money, num, categoryLabel, roleLabel, modeLabel, txLabel };
})();
