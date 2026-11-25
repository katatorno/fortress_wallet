// .tests/translations.test.cjs
//
// locales/translations.toml: every key has every language, placeholders match the
// English text, and every key the code asks for exists.
// Run: tonka test fortress-wallet   (or: node .tests/translations.test.cjs)

const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP = path.join(__dirname, "..");
const ctx = vm.createContext({});
vm.runInContext(readFileSync(path.join(APP, "scripts", "core", "i18n.js"), "utf8"), ctx);
const I18N = vm.runInContext("I18N", ctx);
const strings = I18N.parseToml(readFileSync(path.join(APP, "locales", "translations.toml"), "utf8"));
I18N.use(strings);
const langs = Object.keys(strings[I18N.META] || {});

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n       " + detail}`);
}

ok("languages are listed", langs.length >= 3, JSON.stringify(langs));

const missing = [], mismatched = [];
for(const [key, entry] of Object.entries(strings)) {
  if(key === I18N.META) continue;
  for(const lang of langs) {
    if(typeof entry[lang] !== "string" || !entry[lang].trim()) missing.push(`${key}.${lang}`);
    const want = [...I18N.placeholders(entry.en || "")].sort().join(",");
    const got = [...I18N.placeholders(entry[lang] || "")].sort().join(",");
    if(entry[lang] && want !== got) mismatched.push(`${key}.${lang}: {${got}} vs en {${want}}`);
  }
}
ok("every key has every language", !missing.length, missing.join(", "));
ok("placeholders match English", !mismatched.length, mismatched.join("\n       "));

// keys the code asks for
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (e.name === "ui" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]);
}
const src = [...walk(path.join(APP, "scripts")), path.join(APP, "app.jsx")]
  .filter(f => /\.jsx?$/.test(f)).map(f => readFileSync(f, "utf8")).join("\n");
const used = new Set();
for(const re of [/\bT\(\s*"([a-z0-9_]+)"/g, /\btr\(data,\s*"([a-z0-9_]+)"/g, /I18N\.t\([^,()]+,\s*"([a-z0-9_]+)"/g,
  /\badd\("\w+",\s*"([a-z0-9_]+)",\s*"([a-z0-9_]+)"/g, /"((?:rec|err|flash|note|plan)_[a-z0-9_]+)"/g]) {
  for(const m of src.matchAll(re)) for(const k of m.slice(1)) if(k && !k.endsWith("_")) used.add(k); // "cat_" + id is built
}
// built from variables in the code
for(const p of ["cat_equities", "cat_metals", "cat_bonds", "role_emergency", "role_prepay", "role_home", "role_other",
  "mode_reduce_term", "mode_reduce_payment", "tx_buy", "tx_sell", "tx_adjust",
  "status_saved", "status_dirty", "status_saving", "status_error", "status_auth", "status_conflict",
  "plan_kind_cash", "plan_kind_buy", "plan_kind_unassigned", "plan_kind_rest",
  "file_local_help_write", "file_local_help_download", "flash_cache_on", "flash_cache_off",
  "event_payment", "event_prepayment", "source_drive", "source_local", "rec_prepay_wins", "rec_prepay_loses",
  "rec_drift_above_t", "rec_drift_below_t"]) used.add(p);
const unknown = [...used].filter(k => !(k in strings)).sort();
ok("the code asks only for existing keys", !unknown.length, unknown.join(", "));
const unused = Object.keys(strings).filter(k => k !== I18N.META && !used.has(k));
if(unused.length) console.log("  (info) keys not found in code:", unused.join(", "));

ok("number formats", I18N.money("en", 12345.6) === "€12,346" && I18N.money("pl", 12345.6) === "12 346 €"
  && I18N.money("pt", -1500.5, 2) === "-1 500,50 €");
ok("unknown language falls back to English", I18N.t("xx", "tab_dashboard") === strings.tab_dashboard.en);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
