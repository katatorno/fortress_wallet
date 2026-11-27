// tools/fetch-prices.cjs
//
// Downloads price history into a wallet and rebuilds its net-worth history:
// Alpha Vantage (the key from the wallet) for instruments and metals, Frankfurter
// (ECB) for exchange rates. Answers are kept for the day in data/price-cache/, so
// running it again costs no requests. It stops at the service's limit and keeps
// what it has.
//
//   node tools/fetch-prices.cjs <wallet.json> [--daily] [--since=YYYY-MM-DD]
//
// Without --daily: weekly closes, the whole history, one request an instrument.
// With --daily: openings and closes of the last 100 sessions, one request more each.

const fs = require("node:fs");
const path = require("node:path");
const { Base, Dates, Valuation, WalletFile, WalletHistory, open, save } = require("./wallet.cjs");

const CACHE = path.join(__dirname, "..", "data", "price-cache");
const PAUSE_MS = 13000; // the free key allows only a few requests a minute
const METALS = { XAU: "GOLD", XAG: "SILVER" };

/**
 * The cache file of one answer: the day and the parameters, each cut down to
 * letters, digits, dots, dashes and underscores, so that a symbol from the wallet
 * never leads out of the cache folder.
 */
function cachePath(params, day = Dates.today(), dir = CACHE) {
  const part = (v) => String(v).replace(/[^A-Za-z0-9._-]/g, "_");
  const file = path.join(dir, `${part(day)}_${Object.values(params).map(part).join("_")}.json`);
  const inside = path.relative(dir, file);
  if(!inside || inside.startsWith("..") || path.isAbsolute(inside) || inside.includes(path.sep)) {
    throw new Error(`Not a cache name: ${JSON.stringify(params)}`);
  }
  return file;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith("--"));
  if(!file) { console.log("node tools/fetch-prices.cjs <wallet.json> [--daily] [--since=YYYY-MM-DD]"); process.exit(1); }
  const daily = args.includes("--daily");

  const data = open(file);
  const key = data.settings.price_api_key;
  if(!key) { console.log("the wallet has no settings.price_api_key"); process.exit(1); }
  const since = args.find(a => a.startsWith("--since="))?.slice(8)
    ?? data.transactions.map(t => t.date).sort()[0] ?? Dates.addMonths(Dates.today(), -12);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(since)) { console.log(`--since takes a date YYYY-MM-DD, not ${since}`); process.exit(1); }
  const hide = (s) => String(s).split(key).join("***");

  let requests = 0, limited = false;
  /** The service's answer for these parameters, from today's cache or asked now; null when refused. */
  async function ask(params, field) {
    const cached = cachePath(params);
    if(fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, "utf8"));
    if(limited) return null;
    if(requests) await new Promise(r => setTimeout(r, PAUSE_MS));
    requests++;
    const res = await fetch("https://www.alphavantage.co/query?" + new URLSearchParams({ ...params, apikey: key }),
      { signal: AbortSignal.timeout(30000) });
    const body = await res.json();
    if(!body[field]) {
      const message = hide(body.Information || body.Note || body["Error Message"] || `HTTP ${res.status}`);
      console.log(`  ${params.symbol}: ${message.slice(0, 160)}`);
      if(/rate limit|requests per day/i.test(message)) limited = true;
      return null;
    }
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(cached, hide(JSON.stringify(body)));
    return body;
  }

  /** Newest close of a series applied as the instrument's price, when it is newer. */
  function current(asset, date, close) {
    if(!asset.price_updated || date > asset.price_updated) { asset.price = close; asset.price_updated = date; }
  }

  /** How far the prices paid in the transactions lie from the closes of those days or weeks, in %. */
  function deviation(asset, series) {
    const dates = Object.keys(series).sort();
    const off = data.transactions.filter(t => t.asset_id === asset.id && t.note === "XTB" && t.price >= 0.01).map(t => {
      const d = dates.find(x => x >= t.date);
      return d ? Math.abs(t.price / series[d] - 1) * 100 : null;
    }).filter(x => x !== null).sort((a, b) => a - b);
    // one or two trades prove nothing: shares brought over from a broker carry an old cost
    return off.length >= 3 ? off[Math.floor(off.length / 2)] : null;
  }

  try {
    const held = Valuation.positions(data);
    const wanted = held.filter(p => p.quantity > 1e-6).map(p => data.assets.find(a => a.id === p.id));
    for(const asset of wanted) {
      const metal = asset.category === "metals" && Object.hasOwn(METALS, asset.ticker) && METALS[asset.ticker];
      if(metal) {
        // one price a day for metals, the whole history in one request
        const body = await ask({ function: "GOLD_SILVER_HISTORY", symbol: metal, interval: "daily" }, "data");
        if(!body) continue;
        asset.price_symbol = metal;
        const rows = body.data.filter(r => r.date >= since).sort((a, b) => a.date.localeCompare(b.date));
        for(const r of rows) WalletHistory.addPrice(data, asset.id, r.date, null, Base.round2(Number(r.price)));
        const last = rows.at(-1);
        if(last) current(asset, last.date, Base.round2(Number(last.price)));
        console.log(`  ${asset.name}: ${rows.length} days, newest ${last?.date}`);
        continue;
      }
      if(!asset.price_symbol) { console.log(`  ${asset.name}: no price symbol, price stays manual`); continue; }
      const kinds = [["TIME_SERIES_WEEKLY", "Weekly Time Series", false]];
      if(daily) kinds.push(["TIME_SERIES_DAILY", "Time Series (Daily)", true]);
      for(const [fn, field, isDaily] of kinds) {
        const body = await ask({ function: fn, symbol: asset.price_symbol }, field);
        if(!body) continue;
        const rows = Object.entries(body[field]).filter(([d]) => d >= since).sort(([a], [b]) => a.localeCompare(b));
        const off = deviation(asset, Object.fromEntries(rows.map(([d, v]) => [d, Number(v["4. close"])])));
        if(off !== null && off > 8) {
          console.log(`  ${asset.name}: ${asset.price_symbol} differs from the prices paid by ${off.toFixed(1)}% – not used`);
          continue;
        }
        // a week's opening belongs to its first day, so a weekly row keeps the close only
        for(const [d, v] of rows) WalletHistory.addPrice(data, asset.id, d, isDaily ? Number(v["1. open"]) : null, Number(v["4. close"]));
        const last = rows.at(-1);
        if(last) current(asset, last[0], Number(last[1]["4. close"]));
        console.log(`  ${asset.name}: ${rows.length} ${isDaily ? "days" : "weeks"}, newest ${last?.[0]}`
          + (off === null ? "" : `, typical gap to prices paid ${off.toFixed(1)}%`));
      }
    }

    // exchange rates for the same period, for the currencies named by a code
    const currencies = Object.keys(data.settings.fx).filter(c => /^[A-Z]{3}$/.test(c));
    const query = new URLSearchParams({ base: "EUR", symbols: currencies.join(",") });
    const res = await fetch(`https://api.frankfurter.dev/v1/${since}..?${query}`, { signal: AbortSignal.timeout(30000) });
    if(res.ok) {
      const { rates } = await res.json();
      Object.assign(data.fx_history, rates);
      const newest = Object.keys(rates).sort().at(-1);
      if(newest) Object.assign(data.settings.fx, rates[newest]);
      console.log(`  exchange rates: ${Object.keys(rates).length} dates, newest ${newest}`);
    }
    else console.log(`  exchange rates: HTTP ${res.status}`);

    const days = WalletHistory.rebuild(data, since);
    WalletHistory.upsertSnapshot(data);
    WalletFile.parse(WalletFile.serialize(data)); // the result must open
    const backup = save(file, data);
    console.log(`requests used now: ${requests}${limited ? " (limit reached, run again tomorrow)" : ""}`);
    console.log(`history: ${days} days rebuilt since ${since}; previous version kept in ${backup}`);
  }
  catch(e) { console.log("ERROR", hide(e.message)); process.exit(1); }
}

if(require.main === module) main();

module.exports = { cachePath };
