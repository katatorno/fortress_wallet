// .tests/history.test.cjs
//
// Stored prices, the net-worth history built from them, and the import of a
// broker's export (made-up records, never a real account).
// Run: tonka test fortress_wallet   (or: node .tests/history.test.cjs)

const { Core } = require("../tools/wallet.cjs");
const { importInto } = require("../tools/import-xtb.cjs");

let pass = 0, fail = 0;
function ok(name, cond) {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}`);
}
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

const wallet = () => Core.normalize({
  version: Core.FORMAT,
  settings: { fx: { USD: 2 } },
  categories: { equities: { target_pct: 100, buy: true } },
  buckets: { core: { category: "equities", target_pct_in_category: 100 } },
  assets: [{ id: "webg", name: "World", category: "equities", bucket: "core", currency: "EUR", price: 99 }],
  cash: [{ id: "safe", name: "Safe", amount: 100 }],
});

// ---------------------------------------------------------------- stored prices
{
  const d = wallet();
  const day = () => d.prices.webg["2026-01-02"];
  Core.addPrice(d, "webg", "2026-01-02", null, 10, true);
  Core.addPrice(d, "webg", "2026-01-02", null, 11, true);
  ok("a filling price keeps what is there", day()[1] === 10);
  Core.addPrice(d, "webg", "2026-01-02", null, 12);
  ok("a market close replaces a price paid", day()[1] === 12);
  Core.addPrice(d, "webg", "2026-01-02", 12.5, 13);
  Core.addPrice(d, "webg", "2026-01-02", null, 14);
  ok("a day with an opening is not replaced by one without", day()[0] === 12.5 && day()[1] === 13);
}

// ---------------------------------------------------------------- the history
{
  const d = wallet();
  d.transactions.push({ id: "a", date: "2026-01-05", asset_id: "webg", type: "buy", quantity: 2, price: 10, fee: 0 },
    { id: "b", date: "2026-01-09", asset_id: "webg", type: "sell", quantity: 1, price: 30, fee: 0 });
  d.cash_log.push({ id: "c", date: "2026-01-07", account_id: "safe", amount: 40, note: "" });
  for(const [date, close] of [["2026-01-05", 10], ["2026-01-07", 20], ["2026-01-09", 30]]) Core.addPrice(d, "webg", date, null, close);
  ok("a day per stored price", Core.rebuildHistory(d, "2026-01-01", "2026-12-31") === 3 && d.history.length === 3);
  const on = (date) => d.history.find(h => h.date === date);
  ok("quantity and price as they were that day",
    on("2026-01-05").investments === 20 && on("2026-01-07").investments === 40 && on("2026-01-09").investments === 30);
  ok("cash as it was before a later entry", on("2026-01-05").cash === 60 && on("2026-01-07").cash === 100);
  ok("the wallet itself stays untouched", d.assets[0].price === 99 && d.cash[0].amount === 100);
  Core.rebuildHistory(d, "2026-01-01", "2026-12-31");
  ok("building again adds nothing", d.history.length === 3);

  d.assets[0].currency = "USD";
  d.fx_history = { "2026-01-05": { USD: 1 }, "2026-01-08": { USD: 4 } };
  Core.rebuildHistory(d, "2026-01-01", "2026-12-31");
  ok("each day at the last known rate", on("2026-01-07").investments === 40 && near(on("2026-01-09").investments, 7.5));
}

// ---------------------------------------------------------------- put in vs worth
{
  const d = wallet();
  const move = (id, date, type, quantity, price, fee = 0) =>
    d.transactions.push({ id, date, asset_id: "webg", type, quantity, price, fee });
  move("a", "2026-01-05", "buy", 2, 10, 1);
  move("b", "2026-01-07", "buy", 2, 20);
  move("c", "2026-01-09", "sell", 1, 50);
  Core.addPrice(d, "webg", "2026-01-05", null, 10);
  Core.addPrice(d, "webg", "2026-01-09", null, 30);
  d.assets[0].price = 40;
  const days = Core.portfolioHistory(d, "equities", "2026-01-12");
  const on = (date) => days.find(x => x.date === date);
  ok("it starts with the first purchase and ends today", days[0].date === "2026-01-05" && days.at(-1).date === "2026-01-12");
  ok("invested is cost with fees", on("2026-01-05").invested === 21 && on("2026-01-07").invested === 61);
  ok("a day without a price uses the last one", on("2026-01-07").value === 40);
  ok("a sale takes its share of the cost out", on("2026-01-09").invested === 45.75 && on("2026-01-09").value === 90);
  ok("today at the current price", days.at(-1).value === 120 && days.at(-1).invested === 45.75);
  move("d", "2026-01-10", "sell", 3, 50);
  ok("everything sold leaves nothing invested", Core.portfolioHistory(d, "equities", "2026-01-12").at(-1).invested === 0);
  d.assets[0].currency = "USD";
  d.fx_history = { "2026-01-05": { USD: 4 } };
  ok("cost at the rate of the day it was paid", Core.portfolioHistory(d, "equities", "2026-01-12")[0].invested === 6);
  ok("another category has no history", !Core.portfolioHistory(d, "metals").length);
}

// ---------------------------------------------------------------- the import
{
  const d = wallet();
  const x = {
    date: "2026-03-01",
    names: { "WEBN.DE": "World", "OLD.US": "Old Co" },
    lots: [{ id: "1", ticker: "WEBN.DE", side: "BUY", volume: 3, openPrice: 10, openDate: "2026-01-05", price: 12 }],
    closed: [{ id: "2-0", ticker: "OLD.US", side: "BUY", volume: 5, openPrice: 20, openDate: "2026-01-06",
      closePrice: 25, closeDate: "2026-02-01", comment: "STC Transfer IN" }],
    cash: [{ id: "9", type: "Deposit", ticker: "", date: "2026-01-04", amount: 100, comment: "" },
      { id: "10", type: "Stock purchase", ticker: "WEBN.DE", date: "2026-01-05", amount: -30, comment: "" }],
  };
  importInto(d, x);
  const q = Core.quantities(d);
  ok("quantities match the broker", q.webg === 3 && q.oldus === 0);
  const old = d.assets.find(a => a.id === "oldus");
  ok("a sold instrument is added, in its currency", old.currency === "USD" && old.price === 25);
  ok("it counts as sold out", Core.soldOut(d, old) && !Core.soldOut(d, d.assets[0]));
  ok("the broker's price is the current one", d.assets[0].price === 12 && d.assets[0].price_updated === "2026-03-01");
  ok("a transferred share's old cost is no price point", !d.prices.oldus["2026-01-06"] && d.prices.oldus["2026-02-01"][1] === 25);
  ok("the account's cash is the sum of its operations", d.cash.find(c => c.id === "xtb").amount === 70);
  const once = Core.serialize(d);
  importInto(d, x);
  ok("importing again changes nothing", Core.serialize(d) === once);
  Core.rebuildHistory(d, "2026-01-04", "2026-12-31");
  ok("other money is left alone", d.cash.find(c => c.id === "safe").amount === 100
    && d.history.every(h => h.cash >= 100));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
