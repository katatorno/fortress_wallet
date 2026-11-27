// scripts/core/base.js
//
// Small helpers that know nothing of the wallet: rounding and limits, what counts as
// blank or as a number, names a key may not have, defaults and new ids.

const Base = (() => {
  const round2 = (x) => Math.round((x + Math.sign(x) * 1e-9) * 100) / 100;
  const newId = () => Math.random().toString(16).slice(2, 10).padEnd(8, "0");
  const setDefault = (obj, key, value) => {
    if(!Object.hasOwn(obj, key) || obj[key] === undefined) obj[key] = value;
    return obj[key];
  };
  /** Names a key or an id may not have: they reach the objects' own machinery. */
  const RESERVED = ["__proto__", "constructor", "prototype"];
  const isReserved = (name) => RESERVED.includes(String(name));
  const isBlank = (v) => v === null || v === undefined || v === "";
  /** A number, or text that reads as one. */
  const isNumeric = (v) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) && Number.isFinite(Number(v));
  /** `x` held between the limits that are given. */
  const clamp = (x, min = -Infinity, max = Infinity) => Math.min(max, Math.max(min, x));

  return { round2, clamp, isBlank, isNumeric, isReserved, setDefault, newId };
})();
