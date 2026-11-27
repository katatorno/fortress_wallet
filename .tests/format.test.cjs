// .tests/format.test.cjs
//
// The data file's format: its version, the migration of older files, and a record
// of every key the current version knows. A new or removed key fails here until
// Core.FORMAT is raised, a migration added and SHAPE updated.
// Run: tonka test fortress_wallet   (or: node .tests/format.test.cjs)

const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP = path.join(__dirname, "..");
const ctx = vm.createContext({ console });
for(const f of ["i18n.js", "core.js"]) vm.runInContext(readFileSync(path.join(APP, "scripts", "core", f), "utf8"), ctx, { filename: f });
const run = (code) => vm.runInContext(code, ctx);
run(`I18N.use(I18N.parseToml(${JSON.stringify(readFileSync(path.join(APP, "locales", "translations.toml"), "utf8"))}))`);
const Core = run("Core");
const text = readFileSync(path.join(APP, "data", "wallet.example.json"), "utf8");
const example = () => Core.parse(text);

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond || !detail ? "" : "\n       " + detail}`);
}

// ---------------------------------------------------------------- the current format
const VERSION = 3;
const words = (s) => s.split(" ");
const SHAPE = {
  file: words("version settings categories buckets assets transactions cash cash_log house mortgage history strategy_notes"),
  settings: words("language price_api_key fx fx_yahoo emergency_target monthly_expenses net_income salaries_per_year "
    + "prepay_share_pct min_prepayment alt_safe_yield_pct drift_alert_pp stale_days"),
  category: words("target_pct buy"),
  bucket: words("category target_pct_in_category max_pct_in_category"),
  asset: words("id name ticker yahoo category bucket currency opening_quantity price target_in_bucket price_updated unit "
    + "alert_price maturity"),
  transaction: words("id date asset_id type quantity price fee note"),
  cash: words("id name role currency amount"),
  cash_log: words("id date account_id amount note"),
  house: words("purchase_price value deposit_paid deed_date"),
  mortgage: words("amount rate_pct term_months first_payment_date bank_payment prepayment_fee_pct default_mode events"),
  event: words("id date type amount interest principal fee_pct mode note"),
  snapshot: words("date investments cash house_equity mortgage net_worth cat_equities cat_metals cat_bonds"),
};

/** Every key of the wallet that its part of the format does not know. */
function unknown(d) {
  const parts = [
    ["file", [d]], ["settings", [d.settings]], ["category", Object.values(d.categories)],
    ["bucket", Object.values(d.buckets)], ["asset", d.assets], ["transaction", d.transactions], ["cash", d.cash],
    ["cash_log", d.cash_log], ["house", [d.house]], ["mortgage", [d.mortgage]], ["event", d.mortgage.events],
    ["snapshot", d.history],
  ];
  return [...new Set(parts.flatMap(([part, items]) =>
    items.flatMap(item => Object.keys(item).filter(k => !SHAPE[part].includes(k)).map(k => `${part}.${k}`))))];
}

const HOW = "the format changed: raise Core.FORMAT, add a migration, update SHAPE";
ok("this test describes the current version", Core.FORMAT === VERSION, HOW);
ok("the example declares the current version", JSON.parse(text).version === VERSION);
// the example is public: a real key must never reach it
ok("the example carries no price service key", JSON.parse(text).settings.price_api_key === "");
{
  const raw = JSON.parse(text);
  ok("the example holds only known keys", !unknown(raw).length, `${unknown(raw).join(", ")} – ${HOW}`);
  const d = example();
  Core.addCash(d, "emergency", 10);
  Core.addTransaction(d, "webg", "buy", 1, 13);
  Core.applyPlan(d, Core.contributionPlan(d, 5000));
  d.mortgage.events.push(Core.nextPaymentEvent(d.mortgage));
  Core.saveInstruments(d, d.assets.map(a => ({ ...a, delete: false })));
  Core.saveBuckets(d, "equities", [{ old: "fortress", name: "fortress", share: 90 }, { old: "sandbox", name: "sandbox", share: 10 }]);
  Core.upsertSnapshot(d);
  ok("saving adds only known keys", !unknown(d).length, `${unknown(d).join(", ")} – ${HOW}`);
  const fresh = Core.normalize({});
  ok("a new wallet holds only known keys", !unknown(fresh).length, `${unknown(fresh).join(", ")} – ${HOW}`);
  const missing = SHAPE.asset.filter(k => k !== "maturity" && d.assets.some(a => !(k in a)));
  ok("every instrument has every key of the format", !missing.length, missing.join(", "));
}

// ---------------------------------------------------------------- older and newer files
{
  const old = () => ({
    categories: { equities: { target_pct: 100, buy: true } },
    buckets: {
      core: { category: "equities", auto: true, target_pct_in_category: 100 },
      hand: { category: "equities", auto: false, target_pct_in_category: 40, max_pct_in_category: 10 },
    },
    assets: [
      { id: "a", name: "A", category: "equities", bucket: "core", currency: "EUR", opening_quantity: 2, price: 10,
        target_in_bucket: 100, fractional: false },
      { id: "b", name: "B", category: "equities", bucket: "hand", currency: "EUR", opening_quantity: 1, price: 5,
        target_in_bucket: 0, fractional: true },
    ],
  });
  const d = Core.parse(JSON.stringify(old()));
  ok("a file without a version is brought to the current one", d.version === VERSION);
  ok("the automatic and fractional settings are dropped",
    Object.values(d.buckets).every(b => !("auto" in b)) && d.assets.every(a => !("fractional" in a)));
  ok("a manual bucket's unused share is dropped, its limit kept",
    !("target_pct_in_category" in d.buckets.hand) && d.buckets.hand.max_pct_in_category === 10);
  ok("the migrated shares add up", !Core.badShares(d.buckets).length);
  ok("quantities, prices and percentages stay", Core.summary(d).investments === 25 && d.assets[0].target_in_bucket === 100);
  const again = Core.parse(Core.serialize(d));
  ok("opening a migrated file changes nothing more", Core.serialize(again) === Core.serialize(d));
  ok("the version is written first", Core.serialize(d).startsWith(`{\n  "version": ${VERSION},`));
  ok("an older file gets an empty place for the key", d.settings.price_api_key === "");
  const keyed = Core.parse(JSON.stringify({ ...old(), version: 2, settings: { price_api_key: "abc" } }));
  ok("a key survives opening and saving", Core.parse(Core.serialize(keyed)).settings.price_api_key === "abc");
  const current = { ...old(), version: VERSION };
  ok("a current file is not migrated again", "target_pct_in_category" in Core.normalize(current).buckets.hand);
  for(const [name, version] of [["a newer", VERSION + 1], ["a broken", "two"], ["a zero", 0]]) {
    let refused = false;
    try { Core.parse(JSON.stringify({ ...old(), version })); } catch(e) { refused = /version|format/i.test(e.message); }
    ok(`${name} version is refused`, refused);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
