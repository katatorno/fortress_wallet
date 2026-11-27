// .tests/online.test.cjs
//
// The exchange rates (scripts/core/online.js) with the service stood in for: what
// is sent (the currency codes only), and what of the answer is taken.
// Run: tonka test fortress_wallet   (or: node .tests/online.test.cjs)

const { loadCore } = require("../tools/wallet.cjs");

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n       " + detail}`);
}

/** The rates code with a service answering `answer`; `asked` collects the addresses. */
function service(answer, status = 200) {
  const asked = [];
  const fetch = async (url, opts) => { asked.push({ url, opts }); return { ok: status === 200, status, json: async () => answer }; };
  const { run, Dates, WalletFile } = loadCore(["online.js"], { fetch });
  return { Online: run("Online"), Dates, WalletFile, asked };
}
const wallet = (WalletFile, fx) => WalletFile.normalize({ version: WalletFile.FORMAT, settings: { fx } });

(async () => {
  {
    const { Online, WalletFile, asked } = service({ date: "2026-11-27", rates: { USD: 1.1, PLN: 0 } });
    const d = wallet(WalletFile, { USD: 1, PLN: 4.3, "X&a=b": 2, "my savings": 3 });
    const before = JSON.stringify({ ...d, settings: { ...d.settings, fx: null } });
    const res = await Online.fetchFx(d);
    const url = new URL(asked[0].url);
    ok("one request to the rate service", asked.length === 1 && url.origin === "https://api.frankfurter.dev");
    ok("it carries the currency codes and nothing else", url.searchParams.get("symbols") === "USD,PLN"
      && [...url.searchParams.keys()].join() === "base,symbols", asked[0].url);
    ok("no options that would send more", asked[0].opts === undefined);
    ok("a name that is no code is not sent, and is named", res.skipped.join() === "X&a=b,my savings");
    ok("a sound rate is taken", d.settings.fx.USD === 1.1 && res.updated.join() === "EUR/USD");
    ok("a zero rate is not", d.settings.fx.PLN === 4.3);
    ok("nothing else of the wallet changes", JSON.stringify({ ...d, settings: { ...d.settings, fx: null } }) === before);
    ok("the answer's date is used", res.date === "2026-11-27");
  }
  {
    const { Online, Dates, WalletFile } = service({ rates: { USD: "abc" }, date: "<b>" });
    const d = wallet(WalletFile, { USD: 1 });
    const res = await Online.fetchFx(d);
    ok("a rate that is no number is not taken, nor a date that is none", d.settings.fx.USD === 1 && res.date === Dates.today());
  }
  {
    const { Online, WalletFile } = service({}, 503);
    let message = "";
    try { await Online.fetchFx(wallet(WalletFile, { USD: 1 })); } catch(e) { message = e.message; }
    ok("a refusal is reported", message === "HTTP 503");
  }
  {
    const { Online, WalletFile, asked } = service({});
    await Online.fetchFx(wallet(WalletFile, {}));
    ok("a wallet in euros asks nothing", !asked.length);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(e); process.exit(1); });
