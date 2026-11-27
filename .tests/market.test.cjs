// .tests/market.test.cjs
//
// The market view's rules, which every save goes through: percentages inside a
// bucket (100% or all 0%), bucket shares (100%), moving and deleting instruments,
// the "what to buy" calculator and no sell alerts for equities.
// Run: tonka test fortress_wallet   (or: node .tests/market.test.cjs)

const { readFileSync } = require("node:fs");
const path = require("node:path");
const { APP, loadCore } = require("../tools/wallet.cjs");

const { Advice, Base, Buckets, Instruments, Plan, Rates, Rules, Texts, Valuation, WalletFile } = loadCore();
const example = () => WalletFile.parse(readFileSync(path.join(APP, "data", "wallet.example.json"), "utf8"));

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond || !detail ? "" : "\n       " + detail}`);
}
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

const asset = (d, id) => d.assets.find(a => a.id === id);
const sum = (d, bucket) => Buckets.targetSum(d.assets, bucket);
/** Percentages for every instrument of a bucket: the given ones, 0 for the others. */
const targets = (d, bucket, given) => Object.fromEntries(
  d.assets.filter(a => a.bucket === bucket).map(a => [a.id, given[a.id] || 0]));
/** What the market view's calculator proposes: equities only, no cash set aside. */
const buyPlan = (d, amount) => Plan.contribution(
  { ...d, categories: { equities: d.categories.equities } }, amount, false, 0);
const line = (plan, id) => plan.lines.find(l => l.asset_id === id);
const total = (lines) => lines.reduce((s, l) => s + l.eur, 0);

// ---------------------------------------------------------------- the example
{
  const d = example();
  ok("the example adds up everywhere", !Buckets.badTargets(d.buckets, d.assets).length && !Buckets.badShares(d.buckets).length);
  ok("its aggressive bucket is all at 0%", d.assets.filter(a => a.bucket === "sandbox").every(a => a.target_in_bucket === 0));
  ok("its buckets are 90% and 10%",
    d.buckets.fortress.target_pct_in_category === 90 && d.buckets.sandbox.target_pct_in_category === 10);
}

// ---------------------------------------------------------------- percentages inside a bucket
{
  /** Tries to save; true when accepted. A refusal must leave the wallet untouched. */
  function save(given) {
    const d = example();
    const before = JSON.stringify(d);
    try { Buckets.saveTargets(d, "sandbox", targets(d, "sandbox", given)); }
    catch(e) {
      if(!(e instanceof Rules.RuleError) || e.key !== "targets_wrong") throw e;
      if(JSON.stringify(d) !== before) throw new Error("a refused save changed the data");
      return false;
    }
    return true;
  }
  ok("exactly 100% is saved", save({ nke: 90, gpc: 10 }));
  ok("one instrument at 100% is saved", save({ nke: 100 }));
  ok("all at 0% is saved", save({}));
  ok("thirds that give 100% are saved", save({ nke: 33.33, gpc: 33.33, galp: 33.34 }));
  ok("above 100% is refused", !save({ nke: 90, gpc: 20 }));
  ok("a single value above 100% is refused", !save({ nke: 101 }));
  ok("barely above 100% is refused", !save({ nke: 90, gpc: 10.01 }));
  ok("below 100% is refused", !save({ nke: 50, gpc: 40 }));
  ok("barely below 100% is refused", !save({ nke: 99.99 }));
  ok("a single percent is refused", !save({ nke: 1 }));
  ok("a negative value is refused", !save({ nke: -1 }));
  ok("a negative value making up 100% is refused", !save({ nke: 101, gpc: -1 }));
  ok("negative values cancelling to 0% are refused", !save({ nke: 1, gpc: -1 }));

  const d = example();
  Buckets.saveTargets(d, "sandbox", targets(d, "sandbox", { nke: 90, gpc: 10 }));
  ok("saved values land on the instruments", asset(d, "nke").target_in_bucket === 90 && asset(d, "gpc").target_in_bucket === 10);
  ok("other buckets stay as they were", sum(d, "fortress") === 100 && asset(d, "webg").target_in_bucket === 70);
  ok("a typed value is held between 0 and 100",
    Base.clamp(-1, 0, 100) === 0 && Base.clamp(150, 0, 100) === 100 && Base.clamp(42.5, 0, 100) === 42.5);
  ok("a column without limits keeps the value", Base.clamp(-5) === -5);
}

// ---------------------------------------------------------------- bucket shares
{
  const row = (old, name, share, extra = {}) => ({ old, name, share, ...extra });
  const pair = (a, b) => [row("fortress", "fortress", a), row("sandbox", "sandbox", b)];
  /** The refusal's key, or null when saved. A refusal must leave the wallet untouched. */
  function refused(rows) {
    const d = example();
    const before = JSON.stringify(d);
    try { Buckets.save(d, "equities", rows); }
    catch(e) { return JSON.stringify(d) === before ? e.key : "data changed"; }
    return null;
  }
  ok("shares of 100% are saved", refused(pair(90, 10)) === null);
  ok("one bucket may take it all", refused(pair(100, 0)) === null);
  ok("shares above 100% are refused", refused(pair(90, 20)) === "err_share_sum");
  ok("shares below 100% are refused", refused(pair(80, 10)) === "err_share_sum");
  ok("shares all at 0% are refused", refused(pair(0, 0)) === "err_share_sum");
  ok("a negative share is refused", refused(pair(110, -10)) === "err_value_range");
  ok("a name is used once, also across categories",
    refused([row("fortress", "metals", 90), row("sandbox", "sandbox", 10)]) === "err_bucket_duplicate");
  ok("a bucket needs a name", refused([row("fortress", "", 90), row("sandbox", "sandbox", 10)]) === "err_bucket_name");
  ok("a bucket with instruments cannot be removed",
    refused([row("fortress", "fortress", 100), row("sandbox", "sandbox", 0, { delete: true })]) === "err_bucket_in_use");

  const d = example();
  Buckets.save(d, "equities", [row("fortress", "fortress", 70), row("sandbox", "bold", 20), row(null, "new", 10)]);
  ok("rename, add and keep the other categories",
    Object.keys(d.buckets).join() === "fortress,bold,metals,bonds,new" && d.buckets.new.target_pct_in_category === 10);
  ok("a renamed bucket keeps its instruments", asset(d, "nke").bucket === "bold" && !d.assets.some(a => a.bucket === "sandbox"));
  d.buckets.bold.target_pct_in_category = 90;
  ok("the settings check finds shares that do not add up",
    Buckets.badShares(d.buckets).map(c => c.name).join() === "equities");
}

// ---------------------------------------------------------------- one save of the buckets, from both views
{
  const row = (old, name, share) => ({ old, name, share });
  /** The rows the settings table gives for the buckets named. */
  const table = (d, names) => names.map(b => ({ old: b, name: b, category: d.buckets[b].category,
    share: d.buckets[b].target_pct_in_category ?? null, limit: d.buckets[b].max_pct_in_category ?? null }));
  const names = (d) => Object.keys(d.buckets).join();

  let d = example();
  d.buckets.sandbox.max_pct_in_category = 10;
  Buckets.save(d, "equities", [row("fortress", "fortress", 80), row("sandbox", "bold", 20)]);
  ok("a bucket keeps its limit through the market editor, under a new name too",
    d.buckets.bold.max_pct_in_category === 10 && !("max_pct_in_category" in d.buckets.fortress));

  /** The example with a second bucket of metals between the two of equities. */
  const mixed = () => {
    const e = example();
    const { fortress, sandbox, metals, bonds } = e.buckets;
    e.buckets = { fortress, coins: { category: "metals", target_pct_in_category: 0 }, sandbox,
      metals: { ...metals, target_pct_in_category: 100 }, bonds };
    return e;
  };
  d = mixed();
  Buckets.save(d, "metals", [row("coins", "silver coins", 40), row("metals", "metals", 60), row(null, "bars", 0)]);
  ok("saving one category leaves the order of the others, the new bucket last",
    names(d) === "fortress,silver coins,sandbox,metals,bonds,bars", names(d));
  d = mixed();
  Buckets.apply(d, Buckets.plan(d, table(d, ["bonds", "sandbox", "fortress"])));
  ok("so do rows of the settings table given alone, in any order", names(d) === "fortress,coins,sandbox,metals,bonds", names(d));

  d = example();
  d.categories.cash = { target_pct: 0, buy: false };
  Buckets.save(d, "cash", [row(null, "reserve", 0)]);
  ok("the first bucket of a category may start with a share of 0", d.buckets.reserve?.category === "cash"
    && d.buckets.reserve.target_pct_in_category === 0 && !Buckets.badShares(d.buckets).length);

  d = example();
  d.buckets.metals.target_pct_in_category = 50;
  d.buckets.coins = { category: "metals", target_pct_in_category: 10 };
  Buckets.save(d, "equities", [row("fortress", "fortress", 60), row("sandbox", "sandbox", 40)]);
  ok("shares wrong in another category do not stop a save of this one", d.buckets.sandbox.target_pct_in_category === 40);
}

// ---------------------------------------------------------------- the instrument table
{
  const rows = (d, change) => d.assets.map(a => ({ ...a, delete: false, ...(change[a.id] || {}) }));

  let d = example();
  let redone = Instruments.save(d, rows(d, { webg: { price: 14 } }), "2026-11-27");
  ok("a new price is saved and dated", asset(d, "webg").price === 14 && asset(d, "webg").price_updated === "2026-11-27");
  ok("a price change leaves the percentages alone", !redone.length && asset(d, "webg").target_in_bucket === 70);

  d = example();
  redone = Instruments.save(d, rows(d, { cnya: { bucket: "sandbox" } }));
  ok("a moved instrument changes bucket and starts at 0%",
    asset(d, "cnya").bucket === "sandbox" && asset(d, "cnya").target_in_bucket === 0);
  ok("the bucket it left is scaled to 100%", redone.join() === "fortress" && near(sum(d, "fortress"), 100, 1e-9)
    && near(asset(d, "webg").target_in_bucket, 73.68));
  ok("a bucket at 0% stays at 0%", sum(d, "sandbox") === 0);

  d = example();
  Buckets.saveTargets(d, "sandbox", targets(d, "sandbox", { nke: 60, gpc: 40 }));
  Instruments.save(d, rows(d, { nke: { bucket: "fortress" } }));
  ok("moving between buckets with percentages keeps both at 100%",
    near(sum(d, "fortress"), 100, 1e-9) && near(sum(d, "sandbox"), 100, 1e-9) && asset(d, "nke").target_in_bucket === 0);

  d = example();
  d.transactions.push({ id: "t", date: "2026-11-01", asset_id: "cnya", type: "buy", quantity: 1, price: 4, fee: 0 });
  Instruments.save(d, rows(d, { cnya: { delete: true } }));
  ok("a deleted instrument takes its transactions along", !asset(d, "cnya") && !d.transactions.length);
  ok("after a deletion the bucket is back at 100%", near(sum(d, "fortress"), 100, 1e-9));
  ok("nothing is ever left out of balance", !Buckets.badTargets(d.buckets, d.assets).length);
}

// ---------------------------------------------------------------- what to buy
{
  let d = example();
  let plan = buyPlan(d, 500);
  ok("the whole amount is accounted for", near(total(plan.lines), 500, 0.02));
  ok("a bucket at 0% shows its amount to pick by hand",
    plan.lines.some(l => l.kind === "unassigned" && l.bucket === "sandbox" && l.eur > 0));
  ok("metals and bonds are never bought here", plan.lines.filter(l => l.asset_id)
    .every(l => asset(d, l.asset_id).category === "equities"));

  Buckets.saveTargets(d, "sandbox", targets(d, "sandbox", { nke: 90, aging: 10 }));
  plan = buyPlan(d, 500);
  ok("instruments appear as soon as they get a percentage",
    line(plan, "nke")?.kind === "buy" && !!line(plan, "aging"));
  ok("instruments at 0% are not listed", !line(plan, "gpc") && !line(plan, "galp"));
  ok("nothing is left to pick by hand", !plan.lines.some(l => l.kind === "unassigned"));
  ok("the amount still adds up", near(total(plan.lines), 500, 0.02));

  // one unit of Genuine Parts costs more than its half of the bucket's money
  Buckets.saveTargets(d, "sandbox", targets(d, "sandbox", { nke: 50, gpc: 50 }));
  plan = buyPlan(d, 500);
  const gpc = line(plan, "gpc");
  ok("a part of a unit is bought when a whole one costs more", gpc?.kind === "buy" && gpc.units > 0 && gpc.units < 1);
  ok("units times price give the amount",
    near(gpc.units * Rates.toEur(d, gpc.price, gpc.currency), gpc.eur, 1e-9));
  ok("nothing is left over", plan.lines.every(l => l.kind === "buy") && near(total(plan.lines), 500, 0.02));

  d = example();
  asset(d, "emxc").opening_quantity = 1000;
  ok("an instrument above its share is listed as not now", line(buyPlan(d, 500), "emxc")?.kind === "skip");
  asset(d, "webg").price = 0;
  ok("an instrument without a price is listed", line(buyPlan(d, 500), "webg")?.kind === "skip");
  ok("and the amount still adds up", near(total(buyPlan(d, 500).lines), 500, 0.02));

  d = example();
  ok("no amount, nothing to buy", !buyPlan(d, 0).lines.length);
  Plan.apply(d, buyPlan(d, 500), "2026-11-27");
  ok("recording adds one transaction per purchase",
    d.transactions.length === buyPlan(example(), 500).lines.filter(l => l.kind === "buy").length);
  ok("recording leaves the cash alone", near(Valuation.summary(d).cash_total, Valuation.summary(example()).cash_total, 1e-9));
}

// ---------------------------------------------------------------- a bucket that waits
{
  // equities: 2155 in fortress against 200 in sandbox, which should hold 20%
  const d = example();
  d.buckets.fortress.target_pct_in_category = 80;
  d.buckets.sandbox.target_pct_in_category = 20;
  const held = Valuation.bucketValues(d);
  const from = held.fortress / 0.8 - held.fortress - held.sandbox;
  const toFortress = (amount) => total(buyPlan(d, amount).lines.filter(l => l.kind === "buy"));

  const plan = buyPlan(d, from / 2);
  const webg = line(plan, "webg");
  ok("its instruments say the bucket gets nothing", webg.kind === "skip" && /fortress/.test(webg.label));
  ok("a note explains it and names the amount", plan.notes.some(n => /fortress/.test(n) && /80%/.test(n)
    && n.includes(Texts.money(d, from))));
  ok("below that amount it gets nothing", toFortress(from - 1) === 0);
  ok("above that amount it is bought again", toFortress(from + 10) > 0);
  ok("then there is no note about it", !buyPlan(d, from + 10).notes.some(n => /fortress/.test(n)));
}

// ---------------------------------------------------------------- sell alerts
{
  const d = example();
  const alerts = () => Advice.recommendations(d, "2026-11-27").filter(r => /threshold/.test(r.title));
  asset(d, "nke").alert_price = 1;
  ok("equities never raise a sell alert", !alerts().length);
  asset(d, "gold").alert_price = 1;
  ok("metals still do", alerts().length === 1 && /Gold/.test(alerts()[0].title + alerts()[0].text));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
