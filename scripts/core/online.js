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
   * Updates `settings.fx` for every currency the wallet uses.
   * @returns {Promise<{updated:string[], skipped:string[], date:string}>}
   */
  async function fetchFx(data) {
    const names = Object.keys(data.settings.fx || {});
    const currencies = names.filter(c => CODE.test(c) && c !== "EUR");
    const skipped = names.filter(c => !currencies.includes(c));
    if(!currencies.length) return { updated: [], skipped, date: Core.today() };
    const query = new URLSearchParams({ base: "EUR", symbols: currencies.join(",") });
    const res = await fetch(`${FX_URL}?${query}`);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const updated = [];
    for(const cur of currencies) {
      const rate = Number(body?.rates?.[cur]);
      if(Number.isFinite(rate) && rate > 0) {
        data.settings.fx[cur] = rate;
        updated.push(`EUR/${cur}`);
      }
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body?.date) ? body.date : Core.today();
    return { updated, skipped, date };
  }

  return { fetchFx };
})();
