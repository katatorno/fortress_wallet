// scripts/core/wallet/rules.js
//
// The saves of the views check everything first and throw RuleError before changing
// anything. Here are that error and the checks of typed numbers they share.

const Rules = (() => {
  /** A save refused by a rule: `key` and `vars` are the message, and the data stays as it was. */
  class RuleError extends Error {
    constructor(key, vars = {}) { super(key); this.key = key; this.vars = vars; }
  }

  /** A number typed into a form, held between limits; `field` is the label's key. */
  function number(data, v, key, min = -Infinity, max = Infinity) {
    const field = Texts.tr(data, key);
    if(!Base.isNumeric(v)) throw new RuleError("err_value_number", { field });
    const x = Number(v);
    if(x < min || x > max) {
      throw max === Infinity ? new RuleError("err_value_min", { field, min: Texts.num(data, min, min % 1 ? 2 : 0) })
        : new RuleError("err_value_range", { field, min: Texts.num(data, min), max: Texts.num(data, max) });
    }
    return x;
  }

  /** A percentage typed into a table: empty, or a number from 0 to 100. */
  const percent = (v, field) => {
    if(Base.isBlank(v)) return null;
    if(!Base.isNumeric(v) || Number(v) < 0 || Number(v) > 100) throw new RuleError("err_value_range", { field, min: 0, max: 100 });
    return Number(v);
  };

  return { RuleError, number, percent };
})();
