// tools/import-xtb.cjs
//
// Puts an XTB account export (.xlsx: closed positions, cash operations, open
// positions) into a wallet: a transaction per lot bought and sold, the account's
// cash with its log, the prices paid as price points and the broker's current
// prices. Running it again replaces what an earlier run brought in.
//
//   node tools/import-xtb.cjs <export.xlsx> <wallet.json> [--dry-run]

const { Core, open, save } = require("./wallet.cjs");
const { readXlsx } = require("./xlsx.cjs");

// XTB ticker → the instrument it is in the wallet, and its symbol at the price service
const KNOWN = {
  "WEBN.DE": { id: "webg", symbol: "WEBN.DEX" },
  "ZPRS.DE": { id: "wosc", symbol: "ZPRS.DEX" },
  "EMXC.DE": { id: "emxc", symbol: "EMXC.DEX" },
  "VWCG.DE": { id: "vwcg", symbol: "VWCG.DEX" },
  "CNYA.DE": { id: "cnya", symbol: "36BZ.DEX" },
  "2B77.DE": { id: "aging", symbol: "2B77.DEX" },
  "NKE.US": { id: "nke", symbol: "NKE" },
  "GPC.US": { id: "gpc", symbol: "GPC" },
  "GALP.PT": { id: "galp", symbol: "GALP.LIS" },
};
const BOND_FUNDS = ["LYQ2.DE"];

const serial = (x) => new Date(Math.round((Number(x) - 25569) * 864e5)).toISOString().slice(0, 10);
// the currency of a market, by the ticker's ending; a market not named here is
// refused rather than guessed (London, for one, quotes in pence)
const MARKETS = {
  US: "USD", PL: "PLN", CH: "CHF", DK: "DKK", SE: "SEK", NO: "NOK",
  DE: "EUR", FR: "EUR", NL: "EUR", BE: "EUR", PT: "EUR", ES: "EUR", IT: "EUR", FI: "EUR", IE: "EUR", AT: "EUR",
};
function currencyOf(ticker) {
  const market = String(ticker).split(".").pop();
  if(!Object.hasOwn(MARKETS, market)) throw new Error(`${ticker}: the market .${market} is not known; add its currency to MARKETS in tools/import-xtb.cjs`);
  return MARKETS[market];
}
const after = (rows, head) => rows.slice(rows.findIndex(r => r.A === head) + 1);
/** A new instrument's id from its ticker: letters and digits, never empty nor a reserved name. */
const idOf = (ticker) => {
  const id = String(ticker).toLowerCase().replace(/[^a-z0-9]/g, "");
  return !id || Core.isReserved(id) ? `x${id}` : id;
};

/** The export as plain records. */
function readExport(file) {
  const sheets = readXlsx(file);
  const openRows = after(sheets["Open Positions"], "Product");
  // a lot has a side; the summary row of a ticker has none (the sheet's two header rows are skipped)
  const lots = openRows.filter(r => r.E === "BUY" || r.E === "SELL").map(r => ({
    id: String(Number(r.B)), ticker: r.C, side: r.E, volume: Number(r.F), openPrice: Number(r.I), openDate: serial(r.J),
    price: Number(r.H),
  }));
  const names = Object.fromEntries(openRows.filter(r => !r.E && r.C && r.C !== "Ticker").map(r => [r.C, r.B]));
  const closed = after(sheets["Closed Positions"], "Instrument").filter(r => r.B).map((r, i) => ({
    id: `${Number(r.X)}-${i}`, name: r.A, ticker: r.B, side: r.D, volume: Number(r.E), openPrice: Number(r.F),
    openDate: serial(r.G), closePrice: Number(r.H), closeDate: serial(r.I), comment: r.Y || "",
  }));
  const cash = after(sheets["Cash Operations"], "Type").filter(r => r.A && r.A !== "Total").map(r => ({
    type: r.A, ticker: r.C || "", date: serial(r.E), amount: Number(r.F), id: String(Number(r.G)), comment: r.H || "",
  }));
  const report = sheets["Open Positions"].find(r => r.A === "Data as of report generated");
  for(const c of closed) names[c.ticker] ??= c.name;
  const odd = [...lots, ...closed].filter(l => l.side !== "BUY");
  if(odd.length) throw new Error(`Only bought positions are understood, found: ${[...new Set(odd.map(l => l.side))]}`);
  return { lots, closed, cash, names, date: serial(report.B) };
}

function importInto(data, x) {
  data.transactions = data.transactions.filter(t => !t.id.startsWith("xtb-"));
  data.cash_log = data.cash_log.filter(l => !l.id.startsWith("xtb-"));
  // shares brought over from another broker carry their old cost, a gift its token price:
  // neither says what the instrument was worth that day
  const marketPrice = (lot, price) => !/Transfer/i.test(lot.comment || "") && price >= 0.01;

  const tickers = [...new Set([...x.lots, ...x.closed].map(l => l.ticker))];
  const report = [];
  for(const ticker of tickers) {
    const known = KNOWN[ticker];
    const id = known?.id ?? data.assets.find(a => a.ticker === ticker)?.id ?? idOf(ticker);
    let asset = data.assets.find(a => a.id === id);
    const held = x.lots.filter(l => l.ticker === ticker);
    const gone = x.closed.filter(l => l.ticker === ticker);
    if(!asset) {
      const bond = BOND_FUNDS.includes(ticker);
      const category = bond ? "bonds" : "equities";
      const buckets = Object.keys(data.buckets).filter(b => data.buckets[b].category === category);
      asset = Core.normalize({ assets: [{ id, name: x.names[ticker], category, bucket: buckets[buckets.length - 1],
        currency: currencyOf(ticker) }] }).assets[0];
      data.assets.push(asset);
    }
    if(asset.currency !== currencyOf(ticker)) throw new Error(`${ticker}: the wallet has it in ${asset.currency}`);
    const before = Core.quantities(data)[id];
    Object.assign(asset, { ticker, opening_quantity: 0, price_symbol: asset.price_symbol || known?.symbol || "" });

    const trade = (lotId, type, date, quantity, price, note) =>
      data.transactions.push({ id: `xtb-${lotId}-${type}`, date, asset_id: id, type, quantity, price, fee: 0, note });
    for(const l of held) {
      trade(l.id, "buy", l.openDate, l.volume, l.openPrice, "XTB");
      if(marketPrice(l, l.openPrice)) Core.addPrice(data, id, l.openDate, null, l.openPrice, true);
    }
    for(const l of gone) {
      trade(l.id, "buy", l.openDate, l.volume, l.openPrice, /Transfer/i.test(l.comment) ? "XTB transfer" : "XTB");
      trade(l.id, "sell", l.closeDate, l.volume, l.closePrice, "XTB");
      if(marketPrice(l, l.openPrice)) Core.addPrice(data, id, l.openDate, null, l.openPrice, true);
      Core.addPrice(data, id, l.closeDate, null, l.closePrice, true);
    }
    if(held.length) {
      asset.price = held[0].price;
      asset.price_updated = x.date;
      Core.addPrice(data, id, x.date, null, held[0].price, true);
    }
    else {
      const last = [...gone].sort((a, b) => a.closeDate.localeCompare(b.closeDate)).at(-1);
      asset.price = last.closePrice;
      asset.price_updated = last.closeDate;
    }
    const now = Core.quantities(data)[id];
    const expected = held.reduce((s, l) => s + l.volume, 0);
    if(Math.abs(now - expected) > 1e-6) throw new Error(`${ticker}: ${now} after import, the export holds ${expected}`);
    report.push({ ticker, id, before, now: Math.round(now * 1e4) / 1e4, price: asset.price });
  }

  // the account's money
  let account = data.cash.find(c => c.id === "xtb");
  if(!account) {
    account = { id: "xtb", name: "XTB", role: "other", currency: "EUR", amount: 0 };
    data.cash.push(account);
  }
  for(const c of x.cash) {
    data.cash_log.push({ id: `xtb-${c.id}`, date: c.date, account_id: "xtb", amount: c.amount,
      note: c.ticker ? `${c.type}: ${c.ticker}` : c.type });
  }
  data.cash_log.sort((a, b) => a.date.localeCompare(b.date));
  account.amount = Core.round2(x.cash.reduce((s, c) => s + c.amount, 0));
  data.transactions.sort((a, b) => a.date.localeCompare(b.date));
  const first = [...x.cash.map(c => c.date), ...data.transactions.map(t => t.date)].sort()[0];
  return { report, first, cash: account.amount };
}

if(require.main === module) {
  const [source, target] = process.argv.slice(2).filter(a => !a.startsWith("--"));
  if(!source || !target) { console.log("node tools/import-xtb.cjs <export.xlsx> <wallet.json> [--dry-run]"); process.exit(1); }
  const x = readExport(source);
  const data = open(target);
  const done = importInto(data, x);
  Core.parse(Core.serialize(data)); // the result must open
  console.log("ticker     | id     | quantity before → now | price");
  for(const r of done.report) {
    if(r.now || r.before) console.log(`${r.ticker.padEnd(10)} | ${r.id.padEnd(6)} | ${+r.before.toFixed(4)} → ${r.now} | ${r.price}`);
  }
  console.log(`sold out: ${done.report.filter(r => !r.now).map(r => r.ticker).join(", ")}`);
  console.log(`transactions ${data.transactions.length}, cash operations ${x.cash.length}, XTB cash ${done.cash}, since ${done.first}`);
  if(process.argv.includes("--dry-run")) console.log("dry run: nothing written");
  else console.log(`written, previous version kept in ${save(target, data)}`);
}

module.exports = { readExport, importInto, currencyOf };
