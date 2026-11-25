// .tests/core.test.cjs
//
// The wallet logic of scripts/core as the page loads it (plain scripts, one global scope):
// valuation in EUR, the contribution calculator, the mortgage with prepayments,
// recommendations in every language, the JSON file and the migration of old files.
// Run: tonka test fortress-wallet   (or: node .tests/core.test.cjs)

const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP = path.join(__dirname, "..");
const ctx = vm.createContext({ console });
for(const f of ["i18n.js", "core.js"]) vm.runInContext(readFileSync(path.join(APP, "scripts", "core", f), "utf8"), ctx, { filename: f });
const run = (code) => vm.runInContext(code, ctx);
run(`I18N.use(I18N.parseToml(${JSON.stringify(readFileSync(path.join(APP, "locales", "translations.toml"), "utf8"))}))`);
const Core = run("Core");
const example = () => Core.parse(readFileSync(path.join(APP, "data", "wallet.example.json"), "utf8"));

let pass = 0, fail = 0;
function ok(name, cond) {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}`);
}
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- valuation
{
  const d = example();
  const s = Core.summary(d);
  const edo = d.assets.find(a => a.category === "bonds");
  ok("bonds valued in EUR through the PLN rate", near(s.categories.bonds, edo.opening_quantity * edo.price / d.settings.fx.PLN));
  const cash = d.cash.reduce((a, c) => a + c.amount, 0);
  ok("net worth = investments + cash + deposit before the deed", near(s.net_worth, s.investments + cash + d.house.deposit_paid));
  d.house.deed_date = "2026-12-20";
  const owned = Core.summary(d);
  ok("after the deed: home value minus mortgage", near(owned.house.equity, d.house.value - d.mortgage.amount));
}

// ---------------------------------------------------------------- calculator
{
  const a = Core.waterfill({ a: 50, b: 0 }, { a: 50, b: 50 }, 20);
  ok("waterfill tops up the most underweight first", near(a.b, 20) && near(a.a, 0));
  const b = Core.waterfill({ x: 3, y: 1, z: 9 }, { x: 1, y: 2, z: 3 }, 77);
  ok("waterfill hands out exactly the amount", near(b.x + b.y + b.z, 77, 1e-6));

  const d = example();
  const deficit = d.settings.emergency_target - Core.cashByRole(d).emergency;
  const p1 = Core.contributionPlan(d, deficit);
  ok("emergency fund comes first", p1.lines.length === 1 && p1.lines[0].kind === "cash" && near(p1.lines[0].eur, deficit));

  Core.addCash(d, "emergency", d.settings.emergency_target);
  const p2 = Core.contributionPlan(d, 1000);
  const cash = p2.lines.filter(l => l.kind === "cash");
  const buys = p2.lines.filter(l => l.kind === "buy");
  ok("30% of the rest goes to the prepayment pot", cash.length === 1 && near(cash[0].eur, 300));
  ok("purchases only in the automatic bucket", buys.every(l => d.assets.find(a => a.id === l.asset_id).bucket === "fortress"));
  ok("purchases add up to the rest", near(buys.reduce((s, l) => s + l.eur, 0), 700, 0.02));
  const before = Core.quantities(d).cnya;
  Core.applyPlan(d, p2, "2026-11-25");
  ok("recording the plan adds transactions", Core.quantities(d).cnya >= before && d.transactions.length === buys.length);
}

// ---------------------------------------------------------------- mortgage
{
  const m = { amount: 229500, rate_pct: 3.70, term_months: 444, first_payment_date: "2027-02-01",
    bank_payment: 950, prepayment_fee_pct: 1, default_mode: "reduce_term", events: [] };
  const base = Core.runMortgage(m).info;
  ok("schedule ends after 444 payments", base.end_date === Core.addMonths("2027-02-01", 443));
  ok("total interest in the expected range", base.total_interest > 180000 && base.total_interest < 200000);
  ok("implied rate from the payment", near(Core.impliedRate(229500, 950, 444), 3.70, 0.01));
  for(let i = 0; i < 12; i++) m.events.push(Core.nextPaymentEvent(m));
  const bal = Core.mortgageState(m).balance;
  ok("balance after 12 payments", bal > 226000 && bal < 227000);
  m.events.push({ id: "x", date: "2028-01-15", type: "prepayment", amount: 10000, fee_pct: 1, mode: "reduce_term" });
  const r = Core.mortgageReport(m).info;
  ok("prepayment fee 1%", near(r.total_fees, 100));
  ok("prepayment saves interest and ends earlier", r.interest_saved > 15000 && r.end_date < base.end_date);
  const m2 = JSON.parse(JSON.stringify(m));
  m2.events[m2.events.length - 1].mode = "reduce_payment";
  ok("lower-payment mode keeps the end, lowers the payment",
    Core.mortgageState(m2).payment < 950 && Core.runMortgage(m2).info.end_date === base.end_date);
  let threw = false;
  try { Core.runMortgage({ ...m, bank_payment: 1, events: [] }); } catch(e) { threw = e.key === "err_payment_too_low"; }
  ok("a payment below the interest is reported", threw);
}

// ---------------------------------------------------------------- recommendations
{
  const d = example();
  d.house.deed_date = "2026-12-20";
  const titles = () => Core.recommendations(d, "2026-11-25").map(r => r.title).join(" | ");
  ok("English recommendations", /Emergency fund/.test(titles()) && /Precious metals/.test(titles()) && /net income/.test(titles()));
  d.settings.language = "pl";
  ok("Polish recommendations", /Poduszka/.test(titles()) && /Kruszce/.test(titles()));
  d.settings.language = "pt";
  ok("Portuguese recommendations", /Fundo de emergência/.test(titles()) && /Metais preciosos/.test(titles()));
  d.settings.language = "en";
  d.assets.find(a => a.id === "gold").alert_price = 1;
  ok("sell alert fires at the threshold", /threshold/.test(titles()));
  ok("EDO maturity from the series name", Core.bondMaturity({ name: "EDO1033" }) === "2033-10-01");
}

// ---------------------------------------------------------------- file
{
  const d = example();
  d.strategy_notes = "line 1\nline \"2\"";
  const back = Core.parse(Core.serialize(d));
  ok("JSON round trip keeps the numbers", near(Core.summary(back).net_worth, Core.summary(d).net_worth, 1e-9));
  ok("JSON round trip keeps text", back.strategy_notes === d.strategy_notes);
  let bad = false;
  try { Core.parse("{ not json"); } catch(e) { bad = true; }
  ok("a broken file is refused", bad);
  const old = Core.normalize({
    categories: { akcje: { target_pct: 75, buy: true }, kruszce: { target_pct: 25, buy: false } },
    buckets: { forteca: { category: "akcje", auto: true, target_pct_in_category: 100 } },
    assets: [{ id: "x", name: "X", category: "akcje", bucket: "forteca", currency: "EUR", opening_quantity: 1, price: 10 }],
  });
  ok("old category ids are migrated", "equities" in old.categories && old.assets[0].category === "equities"
    && old.buckets.forteca.category === "equities");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
