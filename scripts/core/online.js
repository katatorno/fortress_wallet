// scripts/core/online.js
//
// Exchange rates from the European Central Bank through the Frankfurter API:
// free, no key, CORS open, so the browser can ask it directly, and only when you
// click. It is sent the three-letter codes of the wallet's currencies and nothing
// else of the wallet; a name that is not such a code is not sent. (Prices of
// stocks and metals have no free source a browser may call: they are entered in
// the market view, or filled in from your computer by tools/fetch-prices.cjs.)

const Online = (() => {
  const FX_URL = "https://api.frankfurter.dev/v1/latest";
  const CODE = /^[A-Z]{3}$/;

  /**
   * Updates `settings.fx` for every currency the wallet uses with the rates of the
   * answer which are rates (`Rates.isRate`). They go into `data` only while it is still
   * the open wallet: one put in its place meanwhile gets nothing, nor does `data`.
   * @param {object} data
   * @param {() => object} [current]  the open wallet, asked once the answer is in
   * @returns {Promise<{updated:string[], skipped:string[], date:string, replaced?:boolean}>}
   */
  async function fetchFx(data, current = () => data) {
    const names = Object.keys(data.settings.fx || {});
    const currencies = names.filter(c => CODE.test(c) && c !== "EUR");
    const skipped = names.filter(c => !currencies.includes(c));
    if(!currencies.length) return { updated: [], skipped, date: Dates.today() };
    const query = new URLSearchParams({ base: "EUR", symbols: currencies.join(",") });
    const res = await fetch(`${FX_URL}?${query}`);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body?.date) ? body.date : Dates.today();
    if(current() !== data) return { updated: [], skipped, date, replaced: true };
    const taken = currencies.map(c => [c, body?.rates?.[c]]).filter(([, rate]) => Rates.isRate(rate));
    Rates.save(data, Object.fromEntries(taken));
    return { updated: taken.map(([c]) => `EUR/${c}`), skipped, date };
  }

  return { fetchFx };
})();
