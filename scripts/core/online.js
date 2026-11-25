// scripts/core/online.js
//
// Exchange rates from the European Central Bank through the Frankfurter API:
// free, no key, CORS open, so the browser can ask it directly.
// (Stock and metal prices have no such free source a browser may call; they are
// entered by hand in Holdings & prices.)

const Online = (() => {
  const FX_URL = "https://api.frankfurter.dev/v1/latest";

  /**
   * Updates `settings.fx` for every currency the wallet uses.
   * @returns {Promise<{updated:string[], date:string}>}
   */
  async function fetchFx(data) {
    const currencies = Object.keys(data.settings.fx || {});
    if(!currencies.length) return { updated: [], date: Core.today() };
    const res = await fetch(`${FX_URL}?base=EUR&symbols=${currencies.join(",")}`);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const updated = [];
    for(const cur of currencies) {
      const rate = Number(body.rates?.[cur]);
      if(rate > 0) {
        data.settings.fx[cur] = rate;
        updated.push(`EUR/${cur}`);
      }
    }
    return { updated, date: body.date || Core.today() };
  }

  return { fetchFx };
})();
