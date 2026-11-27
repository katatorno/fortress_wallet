// .tests/format.test.cjs
//
// The data file's format: its version, the migration of older files, and a record
// of every key the current version knows. A new or removed key fails here until
// WalletFile.FORMAT is raised, a migration added and SHAPE updated.
// Run: tonka test fortress_wallet   (or: node .tests/format.test.cjs)

const { readFileSync } = require("node:fs");
const path = require("node:path");
const { APP, loadCore } = require("../tools/wallet.cjs");

const { Buckets, Cash, Instruments, Mortgage, Plan, Transactions, Valuation, WalletFile, WalletHistory } = loadCore();
const text = readFileSync(path.join(APP, "data", "wallet.example.json"), "utf8");
const example = () => WalletFile.parse(text);

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond || !detail ? "" : "\n       " + detail}`);
}

// ---------------------------------------------------------------- the current format
const VERSION = 6;
const words = (s) => s.split(" ");
const SHAPE = {
  file: words("version settings categories buckets assets transactions cash cash_log house mortgage history strategy_notes "
    + "prices fx_history"),
  settings: words("language theme price_api_key fx emergency_target monthly_expenses net_income "
    + "prepay_share_pct min_prepayment alt_safe_yield_pct drift_alert_pp stale_days"),
  category: words("target_pct buy"),
  bucket: words("category target_pct_in_category max_pct_in_category"),
  asset: words("id name ticker price_symbol category bucket currency opening_quantity price target_in_bucket price_updated unit "
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

const HOW = "the format changed: raise WalletFile.FORMAT, add a migration, update SHAPE";
ok("this test describes the current version", WalletFile.FORMAT === VERSION, HOW);
ok("the example declares the current version", JSON.parse(text).version === VERSION);
// the example is public: a real key must never reach it
ok("the example carries no price service key", JSON.parse(text).settings.price_api_key === "");
{
  const raw = JSON.parse(text);
  ok("the example holds only known keys", !unknown(raw).length, `${unknown(raw).join(", ")} – ${HOW}`);
  const d = example();
  Cash.add(d, "emergency", 10);
  Transactions.add(d, "webg", "buy", 1, 13);
  Plan.apply(d, Plan.contribution(d, 5000));
  d.mortgage.events.push(Mortgage.nextPaymentEvent(d.mortgage));
  Instruments.save(d, d.assets.map(a => ({ ...a, delete: false })));
  Buckets.save(d, "equities", [{ old: "fortress", name: "fortress", share: 90 }, { old: "sandbox", name: "sandbox", share: 10 }]);
  WalletHistory.upsertSnapshot(d);
  ok("saving adds only known keys", !unknown(d).length, `${unknown(d).join(", ")} – ${HOW}`);
  const fresh = WalletFile.normalize({});
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
  const d = WalletFile.parse(JSON.stringify(old()));
  ok("a file without a version is brought to the current one", d.version === VERSION);
  ok("the automatic and fractional settings are dropped",
    Object.values(d.buckets).every(b => !("auto" in b)) && d.assets.every(a => !("fractional" in a)));
  ok("a manual bucket's unused share is dropped, its limit kept",
    !("target_pct_in_category" in d.buckets.hand) && d.buckets.hand.max_pct_in_category === 10);
  ok("the migrated shares add up", !Buckets.badShares(d.buckets).length);
  ok("quantities, prices and percentages stay", Valuation.summary(d).investments === 25 && d.assets[0].target_in_bucket === 100);
  const again = WalletFile.parse(WalletFile.serialize(d));
  ok("opening a migrated file changes nothing more", WalletFile.serialize(again) === WalletFile.serialize(d));
  ok("the version is written first", WalletFile.serialize(d).startsWith(`{\n  "version": ${VERSION},`));
  ok("an older file gets an empty place for the key", d.settings.price_api_key === "");
  ok("an older file follows the system's theme", d.settings.theme === "system");
  const dark = WalletFile.parse(JSON.stringify({ ...old(), version: 4, settings: { theme: "dark" } }));
  ok("a chosen theme survives opening and saving", WalletFile.parse(WalletFile.serialize(dark)).settings.theme === "dark");
  const keyed = WalletFile.parse(JSON.stringify({ ...old(), version: 2, settings: { price_api_key: "abc" } }));
  ok("a key survives opening and saving", WalletFile.parse(WalletFile.serialize(keyed)).settings.price_api_key === "abc");
  const five = old();
  five.version = 5;
  five.settings = { fx: { USD: 1.1 }, fx_yahoo: { USD: "EURUSD=X" }, salaries_per_year: 14, prepay_share_pct: 30 };
  five.assets[0].yahoo = "A.DE";
  const six = WalletFile.parse(JSON.stringify(five));
  ok("version 6 drops the Yahoo symbols and the salaries a year", !("yahoo" in six.assets[0])
    && !("fx_yahoo" in six.settings) && !("salaries_per_year" in six.settings));
  ok("and keeps everything else as it was", six.settings.fx.USD === 1.1 && six.settings.prepay_share_pct === 30
    && six.assets[0].target_in_bucket === 100 && six.buckets.hand.target_pct_in_category === 40);
  const current = { ...old(), version: VERSION };
  ok("a current file is not migrated again", "target_pct_in_category" in WalletFile.normalize(current).buckets.hand);
  for(const [name, version] of [["a newer", VERSION + 1], ["a broken", "two"], ["a zero", 0]]) {
    let refused = false;
    try { WalletFile.parse(JSON.stringify({ ...old(), version })); } catch(e) { refused = /version|format/i.test(e.message); }
    ok(`${name} version is refused`, refused);
  }
}

// ---------------------------------------------------------------- values the app cannot use
{
  /** The refusal's text for the example with one change made, or null when it opens. */
  function refusal(change) {
    const raw = JSON.parse(text);
    change(raw);
    try { WalletFile.parse(JSON.stringify(raw)); return null; }
    catch(e) { return e.message; }
  }
  const cases = [
    ["a price that is no number", (r) => { r.assets[0].price = "abc"; }, "assets[0].price"],
    ["a negative price", (r) => { r.assets[0].price = -5; }, "assets[0].price"],
    ["a quantity beyond any number", (r) => { r.assets[1].opening_quantity = "1e999"; }, "assets[1].opening_quantity"],
    ["an exchange rate of 0", (r) => { r.settings.fx.USD = 0; }, "settings.fx.USD"],
    ["an exchange rate that is text", (r) => { r.settings.fx.USD = "x"; }, "settings.fx.USD"],
    ["instruments that are no list", (r) => { r.assets = {}; }, "assets"],
    ["an instrument that is no object", (r) => { r.assets[0] = 7; }, "assets[0]"],
    ["a name that is an object", (r) => { r.assets[0].name = { nodeType: 1 }; }, "assets[0].name"],
    ["notes that are no text", (r) => { r.strategy_notes = 42; }, "strategy_notes"],
    ["an id used twice", (r) => { r.assets[1].id = r.assets[0].id; }, "assets[1].id"],
    ["an instrument named __proto__", (r) => { r.assets[0].id = "__proto__"; }, "assets[0].id"],
    ["a bucket named constructor", (r) => { r.buckets.constructor = { category: "equities" }; }, "buckets.constructor"],
    ["prices kept under __proto__", (r) => { r.prices = JSON.parse('{"__proto__": {}}'); }, "prices.__proto__"],
    ["a transaction without a date", (r) => { r.transactions = [{ id: "t", asset_id: "webg", type: "buy", quantity: 1, price: 1, date: "yesterday" }]; }, "transactions[0].date"],
    ["an unknown transaction type", (r) => { r.transactions = [{ id: "t", asset_id: "webg", type: "gift", quantity: 1, date: "2026-01-01" }]; }, "transactions[0].type"],
    ["a stored price that is no pair", (r) => { r.prices = { webg: { "2026-01-02": 13 } }; }, "prices.webg.2026-01-02"],
    ["a mortgage event of no kind", (r) => { r.mortgage.events = [{ date: "2027-01-01", type: "gift", amount: 1 }]; }, "mortgage.events[0].type"],
  ];
  for(const [name, change, where] of cases) {
    const message = refusal(change);
    ok(`${name} is refused, naming where`, !!message && message.includes(where), message || "opened");
  }
  const kept = JSON.parse(text);
  const original = JSON.stringify(kept);
  refusal((r) => { r.assets[0].price = "abc"; });
  ok("a refusal changes nothing it was given", JSON.stringify(kept) === original);
  ok("numbers written as text still open", refusal((r) => { r.assets[0].price = "13.5"; r.settings.fx.USD = "1.1"; }) === null);
  ok("a day of history without a value still opens", refusal((r) => {
    r.history = [{ date: "2026-01-01", investments: null, cash: 1, house_equity: 0, mortgage: 0, net_worth: null }];
  }) === null);
  ok("the refusal is in the wallet's language", /Popraw/.test(refusal((r) => { r.settings.language = "pl"; r.assets[0].price = "x"; })));
  let threw = false;
  try { WalletHistory.addPrice(example(), "__proto__", "2026-01-02", null, 1); } catch { threw = true; }
  ok("no price is kept under a reserved name", threw && !("2026-01-02" in {}));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
