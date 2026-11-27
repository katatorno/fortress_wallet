// .tests/rules.test.cjs
//
// The saves of the settings, cash, mortgage and transactions views (Settings.save,
// Cash.save, Mortgage.save, Transactions.record): everything is checked first, and a
// refusal names its reason and changes nothing. Also: an instrument takes the
// category of its bucket.
// Run: tonka test fortress_wallet   (or: node .tests/rules.test.cjs)

const { readFileSync } = require("node:fs");
const path = require("node:path");
const { APP, loadCore } = require("../tools/wallet.cjs");

const { Advice, Buckets, Cash, Instruments, Mortgage, Rules, Settings, Transactions, WalletFile } = loadCore();
const example = () => WalletFile.parse(readFileSync(path.join(APP, "data", "wallet.example.json"), "utf8"));

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n       " + detail}`);
}
const asset = (d, id) => d.assets.find(a => a.id === id);

/** The refusal's key of `fn` on a fresh example, or null when it saved; a refusal must change nothing. */
function refusal(fn, start = example) {
  const d = start();
  const before = JSON.stringify(d);
  try { fn(d); }
  catch(e) {
    if(!(e instanceof Rules.RuleError)) return `not a rule: ${e.message}`;
    return JSON.stringify(d) === before ? e.key : "data changed";
  }
  return null;
}

// ---------------------------------------------------------------- settings
{
  const cats = (d, change = {}) => Object.entries(d.categories).map(([c, cfg]) => ({ category: c, target_pct: cfg.target_pct, buy: cfg.buy, ...(change[c] || {}) }));
  const d = example();
  Settings.save(d, { settings: { emergency_target: "5000", stale_days: 7.6 }, categories: cats(d) });
  ok("settings are saved, as numbers", d.settings.emergency_target === 5000 && d.settings.stale_days === 8);
  ok("a negative amount is refused", refusal(d => Settings.save(d, { settings: { emergency_target: -1 } })) === "err_value_min");
  ok("a share above 100% is refused", refusal(d => Settings.save(d, { settings: { prepay_share_pct: 150 } })) === "err_value_range");
  ok("text where a number belongs is refused", refusal(d => Settings.save(d, { settings: { net_income: "abc" } })) === "err_value_number");
  ok("category targets must add up to 100%", refusal(d => Settings.save(d, { categories: cats(d, { bonds: { target_pct: 0 } }) }))
    === "err_category_sum");
  ok("a later refusal keeps the earlier values from being saved", refusal(d => Settings.save(d, {
    settings: { emergency_target: 1 }, categories: cats(d, { bonds: { target_pct: 0 } }) })) === "err_category_sum");
}

// ---------------------------------------------------------------- the bucket table
{
  const rows = (d, change = {}) => Object.entries(d.buckets).map(([b, cfg]) => ({
    old: b, name: b, category: cfg.category, share: cfg.target_pct_in_category ?? null, limit: cfg.max_pct_in_category ?? null,
    ...(change[b] || {}),
  }));
  const save = (d, list) => Settings.save(d, { buckets: list });

  const d = example();
  save(d, rows(d, { fortress: { name: "core" } }));
  ok("a renamed bucket takes its instruments along", "core" in d.buckets && !("fortress" in d.buckets)
    && asset(d, "webg").bucket === "core" && d.buckets.core.target_pct_in_category === 90);
  ok("a limit can be set and taken away", (() => {
    const e = example();
    save(e, rows(e, { sandbox: { limit: 10 } }));
    const set = e.buckets.sandbox.max_pct_in_category === 10;
    save(e, rows(e, { sandbox: { limit: null } }));
    return set && !("max_pct_in_category" in e.buckets.sandbox);
  })());
  ok("an empty new row is no bucket", (() => {
    const e = example();
    save(e, [...rows(e), { old: null, name: " ", category: "equities", share: null, limit: null }]);
    return Object.keys(e.buckets).join() === Object.keys(example().buckets).join();
  })());
  ok("buckets left out of the rows stay", (() => {
    const e = example();
    save(e, rows(e).filter(r => r.old !== "bonds"));
    return "bonds" in e.buckets;
  })());
  ok("two buckets of one name are refused", refusal(d => save(d, rows(d, { bonds: { name: "metals" } }))) === "err_bucket_duplicate");
  ok("a reserved name is refused", refusal(d => save(d, rows(d, { fortress: { name: "__proto__" } }))) === "err_name_reserved");
  ok("a bucket holding instruments is not removed", refusal(d => save(d, rows(d, { sandbox: { delete: true } }))) === "err_bucket_in_use");
  ok("nor moved to another category", refusal(d => save(d, rows(d, { sandbox: { category: "bonds" } }))) === "err_bucket_category_used");
  ok("shares that do not add up are refused", refusal(d => save(d, rows(d, { sandbox: { share: 20 } }))) === "err_share_sum");
  ok("a share above 100% is refused", refusal(d => save(d, rows(d, { sandbox: { share: 120 } }))) === "err_value_range");
  const e = example();
  save(e, [...rows(e, { bonds: { share: 100 } }), { old: null, name: "spare", category: "bonds", share: 0, limit: null }]);
  save(e, rows(e, { spare: { category: "metals" }, metals: { share: 100 }, bonds: { share: null } }));
  ok("an empty bucket may change category", e.buckets.spare.category === "metals");
  save(e, rows(e, { spare: { delete: true }, metals: { share: null } }));
  ok("and be removed", !("spare" in e.buckets) && !Buckets.badShares(e.buckets).length);
}

// ---------------------------------------------------------------- cash
{
  const rows = (d, change = {}) => d.cash.map(c => ({ ...c, ...(change[c.id] || {}) }));
  const d = example();
  const id = d.cash[0].id;
  const logged = d.cash_log.length;
  Cash.save(d, rows(d, { [id]: { amount: d.cash[0].amount + 25, name: "Renamed" } }), "fix", "2026-11-27");
  ok("a changed balance is logged as a correction", d.cash_log.length === logged + 1 && d.cash_log.at(-1).amount === 25
    && d.cash_log.at(-1).note === "fix" && d.cash[0].name === "Renamed");
  ok("an unknown role is refused", refusal(d => Cash.save(d, rows(d, { [id]: { role: "toys" } }))) === "err_value_choice");
  ok("a currency without a rate is refused", refusal(d => Cash.save(d, rows(d, { [id]: { currency: "XYZ" } }))) === "err_value_choice");
  ok("a balance that is no number is refused, the rows before it unsaved too",
    refusal(d => Cash.save(d, rows(d, { [d.cash[0].id]: { amount: 1 }, [d.cash.at(-1).id]: { amount: "x" } }))) === "err_value_number");
}

// ---------------------------------------------------------------- mortgage
{
  const house = { purchase_price: 300000, value: 310000, deposit_paid: 500, deed_date: "2026-12-20" };
  const loan = { amount: 270000, rate_pct: 3.5, term_months: "419.6", first_payment_date: "2027-03-01", bank_payment: 0,
    prepayment_fee_pct: 1, default_mode: "reduce_term" };
  const d = example();
  Mortgage.save(d, house, loan);
  ok("the parameters are saved", d.house.value === 310000 && d.mortgage.term_months === 420 && d.mortgage.bank_payment === null
    && d.house.deed_date === "2026-12-20");
  ok("a negative rate is refused", refusal(d => Mortgage.save(d, house, { ...loan, rate_pct: -1 })) === "err_value_range");
  ok("no payments at all is refused", refusal(d => Mortgage.save(d, house, { ...loan, term_months: 0 })) === "err_value_range");
  ok("a negative price is refused", refusal(d => Mortgage.save(d, { ...house, value: -5 }, loan)) === "err_value_min");
  ok("a date that is none is refused", refusal(d => Mortgage.save(d, { ...house, deed_date: "soon" }, loan)) === "err_value_choice");
  ok("an unknown mode is refused", refusal(d => Mortgage.save(d, house, { ...loan, default_mode: "fast" })) === "err_value_choice");
}

// ---------------------------------------------------------------- transactions
{
  const tx = (d, t) => Transactions.record(d, { assetId: "webg", type: "buy", quantity: 1, price: 13, date: "2026-11-20", ...t });
  const d = example();
  const held = Transactions.heldOn(d, "webg");
  tx(d, { quantity: 2, date: "2026-11-27" });
  ok("a purchase is recorded, its price the newest", Transactions.heldOn(d, "webg") === held + 2 && asset(d, "webg").price === 13);
  tx(d, { type: "sell", quantity: 1, date: "2026-11-21" });
  ok("a sale of what is held is recorded", Transactions.heldOn(d, "webg") === held + 1);
  ok("an unknown instrument is refused", refusal(d => tx(d, { assetId: "nope" })) === "warn_add_instrument_first");
  ok("a quantity of 0 is refused", refusal(d => tx(d, { quantity: 0 })) === "warn_quantity_zero");
  ok("a negative purchase is refused", refusal(d => tx(d, { quantity: -1 })) === "warn_quantity_positive");
  ok("an adjustment may be negative", refusal(d => tx(d, { type: "adjust", quantity: -1 })) === null);
  ok("a negative price is refused", refusal(d => tx(d, { price: -1 })) === "err_value_min");
  ok("selling more than held is refused", refusal(d => tx(d, { type: "sell", quantity: held + 1 })) === "warn_sell_more");
  ok("so is selling, the day before a purchase, what that purchase brings", refusal(
    d => tx(d, { type: "sell", quantity: held + 1, date: "2026-11-19" }),
    () => { const e = example(); tx(e, { quantity: 5, date: "2026-11-20" }); return e; }) === "warn_sell_more");
  ok("or a sale that a later sale would overdraw", refusal(d => {
    tx(d, { type: "sell", quantity: held, date: "2026-11-25" });
  }, () => { const e = example(); tx(e, { type: "sell", quantity: 1, date: "2026-11-26" }); return e; }) === "warn_sell_more");
}

// ---------------------------------------------------------------- category from the bucket
{
  const d = example();
  Instruments.save(d, d.assets.map(a => ({ ...a, delete: false, ...(a.id === "nke" ? { bucket: "metals", category: "equities" } : {}) })));
  ok("a moved instrument takes its new bucket's category", asset(d, "nke").category === "metals");
  const e = example();
  asset(e, "gpc").category = "bonds"; // as a file made before could have it
  const titles = Advice.recommendations(e, "2026-11-27").map(r => r.title);
  ok("an instrument in a bucket of another category is pointed out", titles.some(t => t.includes(asset(e, "gpc").name)
    && /another category/.test(t)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
