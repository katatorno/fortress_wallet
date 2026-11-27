// .tests/rules.test.cjs
//
// The saves of the settings, cash, mortgage and transactions views (Settings.save,
// Cash.save, Mortgage.save, Transactions.record) and the changes of the loan
// (payments and prepayments booked and deleted): everything is checked first, and a
// refusal names its reason and changes nothing. Also: the numbers the loan's view
// shows, and that an instrument takes the category of its bucket.
// Run: tonka test fortress_wallet   (or: node .tests/rules.test.cjs)

const { readFileSync } = require("node:fs");
const path = require("node:path");
const { APP, loadCore } = require("../tools/wallet.cjs");

const { Advice, Buckets, Cash, Dates, Instruments, Mortgage, Rules, Settings, Transactions, WalletFile } = loadCore();
const example = () => WalletFile.parse(readFileSync(path.join(APP, "data", "wallet.example.json"), "utf8"));

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n       " + detail}`);
}
const asset = (d, id) => d.assets.find(a => a.id === id);

/** The refusal's key of `fn` on a fresh example, or null when it saved; a refusal must change nothing. */
function refusal(fn, start = example) {
  const d = start();
  const before = JSON.stringify(d);
  try { fn(d); }
  catch(e) {
    if(!(e instanceof Rules.RuleError)) return `not a rule: ${e.message}`;
    return JSON.stringify(d) === before ? e.key : "data changed";
  }
  return null;
}

// ---------------------------------------------------------------- settings
{
  const cats = (d, change = {}) => Object.entries(d.categories).map(([c, cfg]) => ({ category: c, target_pct: cfg.target_pct, buy: cfg.buy, ...(change[c] || {}) }));
  const d = example();
  Settings.save(d, { settings: { emergency_target: "5000", stale_days: 7.6 }, categories: cats(d) });
  ok("settings are saved, as numbers", d.settings.emergency_target === 5000 && d.settings.stale_days === 8);
  ok("a negative amount is refused", refusal(d => Settings.save(d, { settings: { emergency_target: -1 } })) === "err_value_min");
  ok("a share above 100% is refused", refusal(d => Settings.save(d, { settings: { prepay_share_pct: 150 } })) === "err_value_range");
  ok("text where a number belongs is refused", refusal(d => Settings.save(d, { settings: { net_income: "abc" } })) === "err_value_number");
  ok("category targets must add up to 100%", refusal(d => Settings.save(d, { categories: cats(d, { bonds: { target_pct: 0 } }) }))
    === "err_category_sum");
  ok("a later refusal keeps the earlier values from being saved", refusal(d => Settings.save(d, {
    settings: { emergency_target: 1 }, categories: cats(d, { bonds: { target_pct: 0 } }) })) === "err_category_sum");
}

// ---------------------------------------------------------------- the bucket table
{
  const rows = (d, change = {}) => Object.entries(d.buckets).map(([b, cfg]) => ({
    old: b, name: b, category: cfg.category, share: cfg.target_pct_in_category ?? null, limit: cfg.max_pct_in_category ?? null,
    ...(change[b] || {}),
  }));
  const save = (d, list) => Settings.save(d, { buckets: list });

  const d = example();
  save(d, rows(d, { fortress: { name: "core" } }));
  ok("a renamed bucket takes its instruments along", "core" in d.buckets && !("fortress" in d.buckets)
    && asset(d, "webg").bucket === "core" && d.buckets.core.target_pct_in_category === 90);
  ok("a limit can be set and taken away", (() => {
    const e = example();
    save(e, rows(e, { sandbox: { limit: 10 } }));
    const set = e.buckets.sandbox.max_pct_in_category === 10;
    save(e, rows(e, { sandbox: { limit: null } }));
    return set && !("max_pct_in_category" in e.buckets.sandbox);
  })());
  ok("an empty new row is no bucket", (() => {
    const e = example();
    save(e, [...rows(e), { old: null, name: " ", category: "equities", share: null, limit: null }]);
    return Object.keys(e.buckets).join() === Object.keys(example().buckets).join();
  })());
  ok("buckets left out of the rows stay", (() => {
    const e = example();
    save(e, rows(e).filter(r => r.old !== "bonds"));
    return "bonds" in e.buckets;
  })());
  ok("two buckets of one name are refused", refusal(d => save(d, rows(d, { bonds: { name: "metals" } }))) === "err_bucket_duplicate");
  ok("a reserved name is refused", refusal(d => save(d, rows(d, { fortress: { name: "__proto__" } }))) === "err_name_reserved");
  ok("a bucket holding instruments is not removed", refusal(d => save(d, rows(d, { sandbox: { delete: true } }))) === "err_bucket_in_use");
  ok("nor moved to another category", refusal(d => save(d, rows(d, { sandbox: { category: "bonds" } }))) === "err_bucket_category_used");
  ok("shares that do not add up are refused", refusal(d => save(d, rows(d, { sandbox: { share: 20 } }))) === "err_share_sum");
  ok("a share above 100% is refused", refusal(d => save(d, rows(d, { sandbox: { share: 120 } }))) === "err_value_range");
  const e = example();
  save(e, [...rows(e, { bonds: { share: 100 } }), { old: null, name: "spare", category: "bonds", share: 0, limit: null }]);
  save(e, rows(e, { spare: { category: "metals" }, metals: { share: 100 }, bonds: { share: null } }));
  ok("an empty bucket may change category", e.buckets.spare.category === "metals");
  save(e, rows(e, { spare: { delete: true }, metals: { share: null } }));
  ok("and be removed", !("spare" in e.buckets) && !Buckets.badShares(e.buckets).length);
}

// ---------------------------------------------------------------- cash
{
  const rows = (d, change = {}) => d.cash.map(c => ({ ...c, ...(change[c.id] || {}) }));
  const d = example();
  const id = d.cash[0].id;
  const logged = d.cash_log.length;
  Cash.save(d, rows(d, { [id]: { amount: d.cash[0].amount + 25, name: "Renamed" } }), "fix", "2026-11-27");
  ok("a changed balance is logged as a correction", d.cash_log.length === logged + 1 && d.cash_log.at(-1).amount === 25
    && d.cash_log.at(-1).note === "fix" && d.cash[0].name === "Renamed");
  ok("an unknown role is refused", refusal(d => Cash.save(d, rows(d, { [id]: { role: "toys" } }))) === "err_value_choice");
  ok("a currency without a rate is refused", refusal(d => Cash.save(d, rows(d, { [id]: { currency: "XYZ" } }))) === "err_value_choice");
  ok("a balance that is no number is refused, the rows before it unsaved too",
    refusal(d => Cash.save(d, rows(d, { [d.cash[0].id]: { amount: 1 }, [d.cash.at(-1).id]: { amount: "x" } }))) === "err_value_number");
  ok("a date that is none refuses the table before any row is saved",
    refusal(d => Cash.save(d, rows(d, { [id]: { amount: 1, name: "Renamed" } }), "fix", "soon")) === "err_value_choice");
  ok("a movement with a date that is none leaves the balance",
    refusal(d => Cash.add(d, id, 5, "", "soon")) === "err_value_choice");
  ok("a movement on an account that is none is refused", refusal(d => Cash.add(d, "nope", 5)) === "err_value_choice");
}

// ---------------------------------------------------------------- mortgage
{
  const house = { purchase_price: 300000, value: 310000, deposit_paid: 500, deed_date: "2026-12-20" };
  const loan = { amount: 270000, rate_pct: 3.5, term_months: "419.6", first_payment_date: "2027-03-01", bank_payment: 0,
    prepayment_fee_pct: 1, default_mode: "reduce_term" };
  const d = example();
  Mortgage.save(d, house, loan);
  ok("the parameters are saved", d.house.value === 310000 && d.mortgage.term_months === 420 && d.mortgage.bank_payment === null
    && d.house.deed_date === "2026-12-20");
  ok("a negative rate is refused", refusal(d => Mortgage.save(d, house, { ...loan, rate_pct: -1 })) === "err_value_range");
  ok("no payments at all is refused", refusal(d => Mortgage.save(d, house, { ...loan, term_months: 0 })) === "err_value_range");
  ok("a negative price is refused", refusal(d => Mortgage.save(d, { ...house, value: -5 }, loan)) === "err_value_min");
  ok("a date that is none is refused", refusal(d => Mortgage.save(d, { ...house, deed_date: "soon" }, loan)) === "err_value_choice");
  ok("an unknown mode is refused", refusal(d => Mortgage.save(d, house, { ...loan, default_mode: "fast" })) === "err_value_choice");
}

// ---------------------------------------------------------------- the changes of the loan
{
  /** The example with a loan of `amount` over a year, nothing booked, and `saved` in the prepayment pot. */
  const owing = (amount = 1000, saved = 5000) => {
    const d = example();
    Object.assign(d.mortgage, { amount, rate_pct: 3.5, term_months: 12, first_payment_date: "2027-03-01", bank_payment: null,
      events: [] });
    d.cash.find(c => c.role === "prepay").amount = saved;
    return d;
  };
  const events = (d) => d.mortgage.events;
  const pot = (d) => Cash.account(d, "prepay").amount;
  const same = (a, b) => JSON.stringify({ ...a, id: 0 }) === JSON.stringify({ ...b, id: 0 });

  // -------------------------------------------------------------- a payment of the schedule
  {
    const d = owing();
    const due = Mortgage.nextPaymentEvent(d.mortgage);
    Mortgage.bookPayment(d);
    ok("the next payment of the schedule is booked as it stands", events(d).length === 1 && same(events(d)[0], due),
      JSON.stringify(events(d)));
  }
  const paid = () => {
    const d = owing();
    Mortgage.bookPrepayment(d, { amount: 1000, date: "2027-01-10", mode: "reduce_term" });
    return d;
  };
  ok("a loan paid off has no payment left to book", refusal(d => Mortgage.bookPayment(d), paid) === "warn_mortgage_paid_off");
  ok("nor has a wallet without a loan", refusal(d => Mortgage.bookPayment(d), () => owing(0)) === "warn_mortgage_paid_off");

  // -------------------------------------------------------------- a payment of the statement
  const statement = { date: "2027-03-02", amount: 85, interest: "2.9", principal: 82.1 };
  {
    const d = owing();
    Mortgage.bookStatement(d, statement);
    ok("a payment of the statement is booked as typed", same(events(d)[0], { id: 0, date: "2027-03-02", type: "payment",
      amount: 85, interest: 2.9, principal: 82.1, note: "from bank statement" }) && !d.cash_log.length, JSON.stringify(events(d)));
    Mortgage.bookStatement(d, { date: null, amount: null, interest: "" });
    const empty = events(d)[1];
    ok("an empty date is the day the next payment is due, an empty number 0", empty.date === "2027-04-01"
      && empty.amount === 0 && empty.interest === 0 && empty.principal === 0, JSON.stringify(empty));
  }
  const booked = (change) => refusal(d => Mortgage.bookStatement(d, { ...statement, ...change }), owing);
  for(const part of ["amount", "interest", "principal"]) {
    ok(`a negative ${part} on a statement is refused`, booked({ [part]: -1 }) === "err_value_min");
    ok(`so is one of the ${part} that is no number`, booked({ [part]: "x" }) === "err_value_number");
  }
  ok("a statement with a date that is none is refused", booked({ date: "soon" }) === "err_value_choice");

  // -------------------------------------------------------------- a prepayment
  const prepay = (d, change) => Mortgage.bookPrepayment(d,
    { amount: 100, date: "2027-01-10", feePct: 1, mode: "reduce_term", fromPot: true, ...change });
  const why = (change, start = owing) => refusal(d => prepay(d, change), start);
  for(const [what, amount] of [["of 0", 0], ["below 0", -5], ["left empty", null], ["that is no number", "x"]]) {
    ok(`a prepayment ${what} is refused`, why({ amount }) === "warn_prepayment_amount");
  }
  ok("a prepayment with a date that is none is refused", why({ date: "soon" }) === "err_value_choice");
  ok("a fee below 0 is refused", why({ feePct: -1 }) === "err_value_range");
  ok("a fee above 100 is refused", why({ feePct: 101 }) === "err_value_range");
  ok("a mode that is none is refused", why({ mode: "fast" }) === "err_value_choice");
  ok("3000 on a balance of 1000 is refused", why({ amount: 3000 }) === "warn_prepayment_over_balance");
  let balance = null;
  try { prepay(owing(), { amount: 3000 }); } catch(e) { balance = e.vars.balance; }
  ok("and the refusal names the balance", balance === "€1,000.00", balance);
  /** 1000 owed, 400 of it paid on 2027-03-01. */
  const partly = () => {
    const d = owing();
    Mortgage.bookStatement(d, { date: "2027-03-01", amount: 400, principal: 400 });
    return d;
  };
  ok("the balance counted is that of the day, the day's own events included",
    why({ date: "2027-03-01", amount: 600.01 }, partly) === "warn_prepayment_over_balance"
    && why({ date: "2027-03-01", amount: 600 }, partly) === null && why({ date: "2027-02-28", amount: 1000 }, partly) === null);
  ok("a pot short of the amount with its fee is refused", why({ amount: 1000 }, () => owing(1000, 1009.99)) === "warn_pot_too_small");
  ok("one holding just the cost pays it", why({ amount: 1000 }, () => owing(1000, 1010)) === null);
  ok("a balance written as text is read as a number", why({ amount: 1000 }, () => owing(1000, "1010")) === null);
  ok("taking from a pot that is none is refused", why({}, () => {
    const d = owing();
    d.cash = d.cash.filter(c => c.role !== "prepay");
    return d;
  }) === "warn_pot_too_small");
  {
    const d = owing(2000);
    prepay(d, { amount: 1000 });
    const move = d.cash_log.at(-1);
    ok("1000 from the pot at a fee of 1% takes 1010", pot(d) === 3990 && d.cash_log.length === 1 && move.amount === -1010
      && move.date === "2027-01-10" && move.note === "mortgage prepayment + fee", JSON.stringify(move));
    const [row] = Mortgage.run(d.mortgage, [], false).rows;
    ok("and the schedule counts the same: 1000 and a fee of 10", row.prepayment === 1000 && row.fee === 10
      && -move.amount === row.prepayment + row.fee, JSON.stringify(row));
    ok("the event is booked with it", events(d).length === 1 && same(events(d)[0],
      { id: 0, date: "2027-01-10", type: "prepayment", amount: 1000, fee_pct: 1, mode: "reduce_term", note: "" }));
    ok("the fee and the cost come from one place",
      JSON.stringify(Mortgage.prepaymentCost(1000, 1)) === JSON.stringify({ fee: 10, cost: 1010 }));
  }
  {
    const d = owing();
    prepay(d, { fromPot: false, date: null, feePct: null });
    ok("without the pot no money moves; an empty date is today, an empty fee 0", pot(d) === 5000 && !d.cash_log.length
      && events(d)[0].date === Dates.today() && events(d)[0].fee_pct === 0);
  }

  // -------------------------------------------------------------- deleting events
  {
    const d = owing();
    for(let i = 0; i < 3; i++) Mortgage.bookPayment(d);
    const [first, second, third] = events(d).map(e => e.id);
    Mortgage.deleteEvents(d, new Set([first, third]));
    ok("the events named are deleted, the others stay", events(d).map(e => e.id).join() === second);
    Mortgage.deleteEvents(d, ["nope"]);
    ok("an id that is none deletes nothing", events(d).length === 1);
  }
}

// ---------------------------------------------------------------- what the loan's view shows
{
  const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;
  const d = example(); // 270 000 at 3.5% over 420 months from 2027-03-01
  const report = Mortgage.report(d.mortgage);
  const lowered = Mortgage.report(d.mortgage, Mortgage.yearlyPrepayments("2028-02-01", 5000, "reduce_payment", 1));
  const total = (years, key) => years.reduce((s, y) => s + y[key], 0);

  const years = Mortgage.yearlyTotals(report.rows);
  ok("a total for each year of the schedule, oldest first", years.length === 36 && years[0].year === "2027"
    && years.at(-1).year === "2062" && years.every((y, i) => !i || y.year > years[i - 1].year));
  ok("each year's interest and principal", near(years[0].interest, 7831.56) && near(years[0].principal, 3327.24)
    && near(years[1].interest, 9267.84) && near(years[1].principal, 4122.72), JSON.stringify(years.slice(0, 2)));
  ok("together they repay the loan and carry its interest", near(total(years, "principal"), 270000)
    && near(total(years, "interest"), report.info.total_interest));
  ok("prepayments count into the principal", near(total(Mortgage.yearlyTotals(lowered.rows), "principal"), 270000));

  const on = (rows, date) => Mortgage.paymentOn(rows, date);
  ok("the payment in force on a day", on(report.rows, "2020-01-01") === 1115.88 && on(report.rows, "2030-01-01") === 1115.88);
  ok("after the end, the last one", on(report.rows, "2099-01-01") === report.rows.at(-1).payment && on([], "2030-01-01") === 0);
  ok("lower after each prepayment which lowers it", on(lowered.rows, "2028-01-01") === 1115.88
    && on(lowered.rows, "2028-03-01") === 1094.91 && on(lowered.rows, "2032-02-01") === 1029.89);

  const before = JSON.stringify(d);
  const effect = (mode, amount = 10000) => Mortgage.prepaymentEffect(d, { amount, date: "2027-06-15", feePct: 1.5, mode });
  const term = effect("reduce_term"), less = effect("reduce_payment");
  ok("a prepayment shortening the term: interest saved, fee, gain and the new end", near(term.saved, 22603.2)
    && term.fee === 150 && near(term.net, 22453.2) && term.end_date === "2059-09-01" && term.old_end_date === "2062-02-01"
    && near(term.payment, term.old_payment), JSON.stringify(term));
  ok("one lowering the payment: the new payment, the same end", near(less.saved, 7361.94) && near(less.net, 7211.94)
    && near(less.payment, 1074.5556) && near(less.old_payment, 1115.8847) && less.end_date === less.old_end_date,
    JSON.stringify(less));
  ok("no effect without an amount above 0", effect("reduce_term", 0) === null && effect("reduce_term", null) === null);
  ok("a preview changes nothing", JSON.stringify(d) === before);
}

// ---------------------------------------------------------------- transactions
{
  const tx = (d, t) => Transactions.record(d, { assetId: "webg", type: "buy", quantity: 1, price: 13, date: "2026-11-20", ...t });
  const d = example();
  const held = Transactions.heldOn(d, "webg");
  tx(d, { quantity: 2, date: "2026-11-27" });
  ok("a purchase is recorded, its price the newest", Transactions.heldOn(d, "webg") === held + 2 && asset(d, "webg").price === 13);
  tx(d, { type: "sell", quantity: 1, date: "2026-11-21" });
  ok("a sale of what is held is recorded", Transactions.heldOn(d, "webg") === held + 1);
  ok("an unknown instrument is refused", refusal(d => tx(d, { assetId: "nope" })) === "warn_add_instrument_first");
  ok("a quantity of 0 is refused", refusal(d => tx(d, { quantity: 0 })) === "warn_quantity_zero");
  ok("a negative purchase is refused", refusal(d => tx(d, { quantity: -1 })) === "warn_quantity_positive");
  ok("an adjustment may be negative", refusal(d => tx(d, { type: "adjust", quantity: -1 })) === null);
  ok("a negative price is refused", refusal(d => tx(d, { price: -1 })) === "err_value_min");
  ok("selling more than held is refused", refusal(d => tx(d, { type: "sell", quantity: held + 1 })) === "warn_sell_more");
  ok("so is selling, the day before a purchase, what that purchase brings", refusal(
    d => tx(d, { type: "sell", quantity: held + 1, date: "2026-11-19" }),
    () => { const e = example(); tx(e, { quantity: 5, date: "2026-11-20" }); return e; }) === "warn_sell_more");
  ok("or a sale that a later sale would overdraw", refusal(d => {
    tx(d, { type: "sell", quantity: held, date: "2026-11-25" });
  }, () => { const e = example(); tx(e, { type: "sell", quantity: 1, date: "2026-11-26" }); return e; }) === "warn_sell_more");
  ok("a date that is none is refused", refusal(d => tx(d, { date: "soon" })) === "err_value_choice");
  ok("a transaction without a date is today's", (() => {
    const e = example();
    tx(e, { date: null });
    return e.transactions.at(-1).date === Dates.today();
  })());
  ok("added as it comes, one of an unknown instrument is refused",
    refusal(d => Transactions.add(d, "nope", "buy", 1, 1)) === "warn_add_instrument_first");
  ok("and so is one with a date that is none",
    refusal(d => Transactions.add(d, "webg", "buy", 1, 1, 0, "soon")) === "err_value_choice");
}

// ---------------------------------------------------------------- what a transaction does to the quantity
{
  const change = (type, quantity) => Transactions.change({ type, quantity });
  ok("a purchase adds", change("buy", 2) === 2 && change("buy", "2.5") === 2.5);
  ok("a sale takes away", change("sell", 2) === -2);
  ok("an adjustment adds its quantity, which may be below 0", change("adjust", 3) === 3 && change("adjust", -3) === -3);
}

// ---------------------------------------------------------------- category from the bucket
{
  const d = example();
  Instruments.save(d, d.assets.map(a => ({ ...a, delete: false, ...(a.id === "nke" ? { bucket: "metals", category: "equities" } : {}) })));
  ok("a moved instrument takes its new bucket's category", asset(d, "nke").category === "metals");
  const e = example();
  asset(e, "gpc").category = "bonds"; // as a file made before could have it
  const titles = Advice.recommendations(e, "2026-11-27").map(r => r.title);
  ok("an instrument in a bucket of another category is pointed out", titles.some(t => t.includes(asset(e, "gpc").name)
    && /another category/.test(t)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
