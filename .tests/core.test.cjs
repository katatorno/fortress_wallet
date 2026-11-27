// .tests/core.test.cjs
//
// The wallet logic of scripts/core as the page loads it (plain scripts, one global scope):
// the rules its modules keep, valuation in EUR, the contribution calculator, the
// mortgage with prepayments, recommendations in every language, the JSON file and the
// migration of old files.
// Run: tonka test fortress_wallet   (or: node .tests/core.test.cjs)

const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { APP, CORE_FILES, moduleName, loadCore } = require("../tools/wallet.cjs");

const loaded = loadCore();
const { Advice, Cash, Dates, Mortgage, Plan, Rules, Texts, Transactions, Valuation, WalletFile, I18N } = loaded;
const example = () => WalletFile.parse(readFileSync(path.join(APP, "data", "wallet.example.json"), "utf8"));

let pass = 0, fail = 0;
function ok(name, cond) {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}`);
}
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- the modules
{
  // the files of scripts/core the wallet logic is made of, and where each reaches
  const REACHES = {
    "base.js": [],
    "dates.js": ["Base"],
    "chart-math.js": ["Base", "Dates"],
    "wallet/texts.js": ["I18N"],
    "wallet/rules.js": ["Base", "Dates", "Texts"],
    "wallet/rates.js": ["Texts"],
    "wallet/cash.js": ["Base", "Dates", "Rules", "Texts"],
    "wallet/transactions.js": ["Base", "Dates", "Rules", "Texts"],
    "wallet/buckets.js": ["Base", "Texts", "Rules"],
    "wallet/mortgage.js": ["Base", "Dates", "Rules", "Texts"],
    "wallet/instruments.js": ["Dates", "Buckets", "Transactions"],
    "wallet/valuation.js": ["Dates", "Rates", "Cash", "Transactions", "Mortgage"],
    "wallet/plan.js": ["Base", "Dates", "Texts", "Valuation", "Cash"],
    "wallet/settings.js": ["Texts", "Rules", "Buckets"],
    "wallet/wallet-history.js": ["Base", "Dates", "Rates", "Transactions", "Valuation"],
    "wallet/advice.js": ["Base", "Dates", "Texts", "Mortgage", "Valuation"],
    // I18N: the language of a wallet that names none
    "wallet/wallet-file.js": ["Base", "Texts", "Cash", "Mortgage", "Transactions", "Valuation", "I18N"],
  };
  const files = CORE_FILES.filter(f => f !== "i18n.js");
  const names = CORE_FILES.map(moduleName);
  const text = (f) => readFileSync(path.join(APP, "scripts", "core", f), "utf8");
  /** A source without its comments and spreads; a "//" right after a letter or a colon (an address) stays. */
  const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map(line => line.replace(/(^|\s)\/\/.*$/, "$1")).join("\n").replaceAll("...", " ");
  const check = (name, wrong) => {
    ok(name, !wrong.length);
    if(wrong.length) console.log("       " + wrong.join("\n       "));
  };

  const alone = [];
  if([...files].sort().join() !== Object.keys(REACHES).sort().join()) alone.push("the list of this test names other files");
  for(const f of files) {
    const name = moduleName(f);
    // one declaration: whatever stands between its first and its last line is indented
    const lines = code(text(f)).split("\n").filter(line => line.trim());
    if(lines[0] !== `const ${name} = (() => {` || lines.at(-1) !== "})();" || lines.slice(1, -1).some(line => !/^\s/.test(line))) {
      alone.push(`${f}: more at the top level than \`const ${name} = (() => { … })();\``);
    }
    try {
      const empty = vm.createContext({});
      const globals = () => vm.runInContext("Object.getOwnPropertyNames(globalThis).join()", empty);
      const before = globals();
      vm.runInContext(text(f), empty, { filename: f });
      if(globals() !== before || vm.runInContext(`typeof ${name}`, empty) !== "object") alone.push(`${f}: not the one global ${name}`);
    }
    catch(e) { alone.push(`${f}: ${e.message}`); }
  }
  check("each module file loads alone and makes one global, named after it", alone);

  const astray = [];
  const reached = (f) => names.filter(n => n !== moduleName(f) && new RegExp(`(?<![\\w$.])${n}(?![\\w$])`).test(code(text(f))));
  const list = Object.fromEntries(Object.entries(REACHES).map(([f, to]) => [moduleName(f), to]));
  const cycle = (name, way = []) => way.includes(name) ? [...way, name].join(" → ")
    : (list[name] || []).map(next => cycle(next, [...way, name])).find(Boolean);
  const loop = Object.keys(list).map(name => cycle(name)).find(Boolean);
  if(loop) astray.push(`a cycle in the list: ${loop}`);
  const wallet = files.filter(f => f.startsWith("wallet/")).map(moduleName);
  for(const f of files) {
    const found = reached(f), allowed = REACHES[f] || [];
    astray.push(...found.filter(n => !allowed.includes(n)).map(n => `${f}: reaches ${n}`));
    if(!f.startsWith("wallet/")) {
      astray.push(...[...found, ...allowed].filter(n => wallet.includes(n)).map(n => `${f}: reaches into wallet/ (${n})`));
    }
  }
  check("modules reach only where the list lets them, without a cycle, the plain ones never into wallet/", astray);

  // the other way round: the list says what is, so it holds nothing a source does not take
  const unused = files.flatMap(f => {
    const found = reached(f);
    return (REACHES[f] || []).filter(n => !found.includes(n)).map(n => `${f}: lists ${n}, reaches it nowhere`);
  });
  check("every module the list names for a file is one its source reaches", unused);

  // the views run in no test: this is what catches a name no module gives
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (e.name === "ui" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]);
  const written = [...walk(path.join(APP, "scripts")), path.join(APP, "app.jsx"), ...walk(path.join(APP, "tools"))]
    .filter(f => /\.(jsx?|cjs)$/.test(f));
  const reference = new RegExp(`(?<![\\w$.])(${names.join("|")})\\??\\.([A-Za-z_$][\\w$]*)`, "g");
  const references = written.flatMap(f => [...code(readFileSync(f, "utf8")).matchAll(reference)]
    .map(([, module, key]) => ({ file: path.relative(APP, f), module, key })));
  const unknown = references.filter(r => !Object.hasOwn(loaded[r.module], r.key)).map(r => `${r.file}: ${r.module}.${r.key}`);
  const seen = (end) => references.some(r => r.file.endsWith(end));
  if(!seen(".jsx") || !seen(".cjs")) unknown.push("no reference found in the views or in the tools: the search misses them");
  check("every Module.name the app and the tools write is one the module gives", unknown);
}

// ---------------------------------------------------------------- valuation
{
  const d = example();
  const s = Valuation.summary(d);
  const edo = d.assets.find(a => a.category === "bonds");
  ok("bonds valued in EUR through the PLN rate", near(s.categories.bonds, edo.opening_quantity * edo.price / d.settings.fx.PLN));
  const cash = d.cash.reduce((a, c) => a + c.amount, 0);
  ok("net worth = investments + cash + deposit before the deed", near(s.net_worth, s.investments + cash + d.house.deposit_paid));
  d.house.deed_date = "2026-12-20";
  const owned = Valuation.summary(d);
  ok("after the deed: home value minus mortgage", near(owned.house.equity, d.house.value - d.mortgage.amount));
}

// ---------------------------------------------------------------- calculator
{
  const a = Plan.waterfill({ a: 50, b: 0 }, { a: 50, b: 50 }, 20);
  ok("waterfill tops up the most underweight first", near(a.b, 20) && near(a.a, 0));
  const b = Plan.waterfill({ x: 3, y: 1, z: 9 }, { x: 1, y: 2, z: 3 }, 77);
  ok("waterfill hands out exactly the amount", near(b.x + b.y + b.z, 77, 1e-6));

  const d = example();
  const deficit = d.settings.emergency_target - Valuation.cashByRole(d).emergency;
  const p1 = Plan.contribution(d, deficit);
  ok("emergency fund comes first", p1.lines.length === 1 && p1.lines[0].kind === "cash" && near(p1.lines[0].eur, deficit));

  Cash.add(d, "emergency", d.settings.emergency_target);
  const p2 = Plan.contribution(d, 1000);
  const cash = p2.lines.filter(l => l.kind === "cash");
  const buys = p2.lines.filter(l => l.kind === "buy");
  ok("30% of the rest goes to the prepayment pot", cash.length === 1 && near(cash[0].eur, 300));
  ok("the bucket at 0% is left to pick by hand, the rest is bought", buys.every(l => d.assets.find(a => a.id === l.asset_id).bucket === "fortress"));
  const open = p2.lines.filter(l => l.kind === "unassigned");
  ok("purchases and the hand-picked amount add up to the rest",
    near([...buys, ...open].reduce((s, l) => s + l.eur, 0), 700, 0.02));
  const before = Transactions.quantities(d).cnya;
  Plan.apply(d, p2, "2026-11-25");
  ok("recording the plan adds transactions", Transactions.quantities(d).cnya >= before && d.transactions.length === buys.length);
}

// ---------------------------------------------------------------- mortgage
{
  const m = { amount: 229500, rate_pct: 3.70, term_months: 444, first_payment_date: "2027-02-01",
    bank_payment: 950, prepayment_fee_pct: 1, default_mode: "reduce_term", events: [] };
  const base = Mortgage.run(m).info;
  ok("schedule ends after 444 payments", base.end_date === Dates.addMonths("2027-02-01", 443));
  ok("total interest in the expected range", base.total_interest > 180000 && base.total_interest < 200000);
  ok("implied rate from the payment", near(Mortgage.impliedRate(229500, 950, 444), 3.70, 0.01));
  for(let i = 0; i < 12; i++) m.events.push(Mortgage.nextPaymentEvent(m));
  const bal = Mortgage.state(m).balance;
  ok("balance after 12 payments", bal > 226000 && bal < 227000);
  m.events.push({ id: "x", date: "2028-01-15", type: "prepayment", amount: 10000, fee_pct: 1, mode: "reduce_term" });
  const r = Mortgage.report(m).info;
  ok("prepayment fee 1%", near(r.total_fees, 100));
  ok("prepayment saves interest and ends earlier", r.interest_saved > 15000 && r.end_date < base.end_date);
  const m2 = JSON.parse(JSON.stringify(m));
  m2.events[m2.events.length - 1].mode = "reduce_payment";
  ok("lower-payment mode keeps the end, lowers the payment",
    Mortgage.state(m2).payment < 950 && Mortgage.run(m2).info.end_date === base.end_date);
  const st2 = Mortgage.state(m2);
  ok("the lower payment spreads the balance over the payments left",
    near(st2.payment, Mortgage.annuity(st2.balance, 3.70, 444 - st2.paid_count), 0.005));
  let threw = false, thrown = null;
  try { Mortgage.run({ ...m, bank_payment: 1, events: [] }); } catch(e) { thrown = e; threw = e.key === "err_payment_too_low"; }
  ok("a payment below the interest is reported", threw);
  ok("as a refusal like any other, a RuleError", thrown instanceof Rules.RuleError);
}

// ---------------------------------------------------------------- recommendations
{
  const d = example();
  d.house.deed_date = "2026-12-20";
  const titles = () => Advice.recommendations(d, "2026-11-25").map(r => r.title).join(" | ");
  ok("English recommendations", /Emergency fund/.test(titles()) && /Precious metals/.test(titles()) && /net income/.test(titles()));
  d.settings.language = "pl";
  ok("Polish recommendations", /Poduszka/.test(titles()) && /Kruszce/.test(titles()));
  d.settings.language = "pt";
  ok("Portuguese recommendations", /Fundo de emergência/.test(titles()) && /Metais preciosos/.test(titles()));
  d.settings.language = "en";
  d.assets.find(a => a.id === "gold").alert_price = 1;
  ok("sell alert fires at the threshold", /threshold/.test(titles()));
  ok("EDO maturity from the series name", Advice.bondMaturity({ name: "EDO1033" }) === "2033-10-01");
}
{
  // one wallet per hint, every other hint kept quiet
  const wallet = (assets, categories) => WalletFile.normalize({
    version: WalletFile.FORMAT,
    settings: { emergency_target: 0, drift_alert_pp: 2, stale_days: 14 },
    categories, buckets: { b: { category: "equities", target_pct_in_category: 100 }, o: { category: "bonds" } },
    assets: assets.map(a => ({ currency: "EUR", unit: "pcs", price_updated: "2026-11-20", ...a })),
  });
  const titles = (d, on = "2026-11-25") => Advice.recommendations(d, on).map(r => r.title);
  const t = (key, vars) => I18N.t("en", key, vars);
  /** Whether a title is the text of `key`, the placeholders not given standing for anything. */
  const has = (list, key, vars) => {
    const re = new RegExp("^" + t(key, vars).replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\w+\}/g, ".*") + "$");
    return list.some(x => re.test(x));
  };
  const both = { equities: { target_pct: 50, buy: true }, bonds: { target_pct: 50, buy: true } };
  const d = wallet([{ id: "e", name: "E", category: "equities", bucket: "b", opening_quantity: 1, price: 100 }], both);
  ok("a category above its target is said to be above", has(titles(d), "rec_drift_above_t", { name: Texts.categoryLabel(d, "equities") })
    && !has(titles(d), "rec_drift_below_t", { name: Texts.categoryLabel(d, "equities") }));
  ok("one below its target is said to be below", has(titles(d), "rec_drift_below_t", { name: Texts.categoryLabel(d, "bonds") }));

  const old = wallet([{ id: "e", name: "E", category: "equities", bucket: "b", opening_quantity: 1, price: 1, price_updated: "2026-10-01" }], both);
  ok("a price older than the limit is named", titles(old).includes(t("rec_stale_t", { count: 1 })));
  ok("a fresh price is not", !titles(d).includes(t("rec_stale_t", { count: 1 })));

  const bond = wallet([{ id: "x", name: "EDO0127", category: "bonds", bucket: "o", opening_quantity: 1, price: 100 }], both);
  ok("a bond due within a year is announced", has(titles(bond), "rec_bond_t", { name: "EDO0127", date: "01.2027" }));
  ok("not earlier than a year before", !has(titles(bond, "2025-06-01"), "rec_bond_t", { name: "EDO0127" }));
}

// ---------------------------------------------------------------- file
{
  const d = example();
  d.strategy_notes = "line 1\nline \"2\"";
  const back = WalletFile.parse(WalletFile.serialize(d));
  ok("JSON round trip keeps the numbers", near(Valuation.summary(back).net_worth, Valuation.summary(d).net_worth, 1e-9));
  ok("JSON round trip keeps text", back.strategy_notes === d.strategy_notes);
  let bad = false;
  try { WalletFile.parse("{ not json"); } catch(e) { bad = true; }
  ok("a broken file is refused", bad);
  const old = WalletFile.normalize({
    categories: { akcje: { target_pct: 75, buy: true }, kruszce: { target_pct: 25, buy: false } },
    buckets: { forteca: { category: "akcje", auto: true, target_pct_in_category: 100 } },
    assets: [{ id: "x", name: "X", category: "akcje", bucket: "forteca", currency: "EUR", opening_quantity: 1, price: 10 }],
  });
  ok("old category ids are migrated", "equities" in old.categories && old.assets[0].category === "equities"
    && old.buckets.forteca.category === "equities");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
