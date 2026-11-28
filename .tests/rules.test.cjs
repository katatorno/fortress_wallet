// .tests/rules.test.cjs
//
// The saves of the settings, cash, mortgage and transactions views (Settings.save,
// Cash.save, Mortgage.save, Transactions.record), the changes of the loan (payments
// and prepayments booked and deleted), of the instruments (added, their table saved),
// transactions removed, a cash movement, a plan and exchange rates recorded: everything
// is checked first, a refusal names its reason and changes nothing, and what is accepted
// leaves a wallet which opens; the loan's schedule counts every event booked in full, a
// cash balance moves by what its log says, and a date is one the calendar has. Also: the
// numbers the loan's view shows, how an account's amount is written, and that an
// instrument takes the category of its bucket.
// Run: tonka test fortress_wallet   (or: node .tests/rules.test.cjs)

const { readFileSync } = require("node:fs");
const path = require("node:path");
const { APP, loadCore } = require("../tools/wallet.cjs");

const { Advice, Base, Buckets, Cash, Dates, I18N, Instruments, Mortgage, Plan, Rates, Rules, Settings, Texts, Transactions,
  WalletFile, run } = loadCore();
const example = () => WalletFile.parse(readFileSync(path.join(APP, "data", "wallet.example.json"), "utf8"));

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if(cond) pass++; else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n       " + detail}`);
}
const asset = (d, id) => d.assets.find(a => a.id === id);
/** Whether the wallet would open: nothing against it, after a change which was accepted. */
const opens = (d) => !WalletFile.check(d).length;

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
    refusal(d => Cash.save(d, rows(d, { [id]: { amount: 1, name: "Renamed" } }), "fix", "soon")) === "err_date");
  ok("a movement with a date that is none leaves the balance",
    refusal(d => Cash.add(d, id, 5, "", "soon")) === "err_date");
  ok("a movement on an account that is none is refused", refusal(d => Cash.add(d, "nope", 5)) === "err_value_choice");
  ok("a table's balance too large to be counted in cents is refused",
    refusal(d => Cash.save(d, rows(d, { home: { amount: 1e308 } }))) === "err_value_number");
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
  ok("a date that is none is refused", refusal(d => Mortgage.save(d, { ...house, deed_date: "soon" }, loan)) === "err_date");
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
  ok("a statement with a date that is none is refused", booked({ date: "soon" }) === "err_date");

  // -------------------------------------------------------------- a prepayment
  const prepay = (d, change) => Mortgage.bookPrepayment(d,
    { amount: 100, date: "2027-01-10", feePct: 1, mode: "reduce_term", fromPot: true, ...change });
  const why = (change, start = owing) => refusal(d => prepay(d, change), start);
  for(const [what, amount] of [["of 0", 0], ["below 0", -5], ["left empty", null], ["that is no number", "x"]]) {
    ok(`a prepayment ${what} is refused`, why({ amount }) === "warn_prepayment_amount");
  }
  ok("a prepayment with a date that is none is refused", why({ date: "soon" }) === "err_date");
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
    && why({ date: "2027-03-01", amount: 600 }, partly) === null && why({ date: "2027-02-28", amount: 600 }, partly) === null
    && why({ date: "2027-02-28", amount: 1000 }, partly) === "warn_event_cut");
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

  // -------------------------------------------------------------- every event counted in full
  /** Whether each event repays in the schedule what it records, to the cent. */
  const counted = (d) => {
    const { rows } = Mortgage.run(d.mortgage, [], false);
    const list = (items, key) => items.map(x => Base.round2(Number(x[key]))).sort().join();
    const recorded = (type) => events(d).filter(e => e.type === type);
    const shown = (type) => rows.filter(r => r.kind === type);
    return list(recorded("prepayment"), "amount") === list(shown("prepayment"), "prepayment")
      && list(recorded("payment"), "principal") === list(shown("payment"), "principal");
  };
  /** What a refusal says besides its key. */
  const said = (fn) => { try { fn(); return null; } catch(e) { return e.vars; } };
  /** 800 of the 1000 prepaid on 2027-01-10. */
  const early = () => {
    const d = owing();
    prepay(d, { amount: 800 });
    return d;
  };
  ok("a back-dated prepayment which would cut a later one is refused",
    why({ amount: 500, date: "2027-01-05" }, early) === "warn_event_cut");
  const later = said(() => prepay(early(), { amount: 500, date: "2027-01-05" }));
  ok("and the refusal names the day of the one it would cut", later?.date === "10.01.2027", JSON.stringify(later));
  {
    const d = early();
    prepay(d, { amount: 200, date: "2027-01-05" });
    ok("one which leaves the later one whole is booked", events(d).length === 2 && counted(d) && Mortgage.paidOff(d.mortgage));
  }
  ok("so is a payment of the statement refused which would cut a later prepayment",
    refusal(d => Mortgage.bookStatement(d, { date: "2027-01-05", principal: 300 }), early) === "warn_event_cut");
  ok("a capital part above the balance is refused", booked({ principal: 1000.01 }) === "warn_capital_over_balance"
    && booked({ amount: 1002.92, principal: 1000 }) === null);
  const over = said(() => Mortgage.bookStatement(owing(), { ...statement, principal: 5000 }));
  ok("and the refusal names the balance it meets", over?.balance === "€1,000.00", JSON.stringify(over));
  const after = (change) => refusal(d => Mortgage.bookStatement(d, { ...statement, ...change }), paid);
  ok("a loan paid off takes no payment of the statement", after({}) === "warn_mortgage_paid_off"
    && after({ principal: 0 }) === "warn_mortgage_paid_off" && after({ date: null }) === "warn_mortgage_paid_off");
  ok("one of a day before it was paid off, repaying nothing, is booked", after({ date: "2027-01-05", principal: 0 }) === null);
  {
    const d = owing(1000.005);
    d.mortgage.bank_payment = 2000;
    Mortgage.bookPayment(d); // it records 1000.01 of capital
    ok("a last payment rounded past a balance in parts of a cent is booked", events(d).length === 1 && Mortgage.paidOff(d.mortgage));
  }
  {
    const d = owing();
    while(!Mortgage.paidOff(d.mortgage)) Mortgage.bookPayment(d);
    ok("the payments of the schedule, to the last, are counted in full", events(d).length >= 12 && counted(d), events(d).length);
  }
  {
    let n = 7, taken = 0, whole = true, paidRight = true;
    const rnd = () => (n = n * 48271 % 2147483647) / 2147483647;
    const d = owing(1000, 100000);
    for(let i = 0; i < 600; i++) {
      const date = `2027-0${1 + Math.floor(rnd() * 9)}-1${Math.floor(rnd() * 10)}`, x = Math.round(rnd() * 30000) / 100;
      const op = Math.floor(rnd() * 4), held = pot(d);
      try {
        if(op === 0) Mortgage.bookPayment(d);
        else if(op === 1) Mortgage.bookStatement(d, { date, amount: x, principal: x });
        else if(op === 2) prepay(d, { date, amount: x });
        else Mortgage.deleteEvents(d, [events(d)[Math.floor(rnd() * events(d).length)]?.id]);
        taken++;
        if(op === 2) paidRight &&= d.cash_log.at(-1).amount === Base.round2(-Mortgage.prepaymentCost(x, 1).cost)
          && pot(d) === Base.round2(held + d.cash_log.at(-1).amount);
      }
      catch(e) { if(!(e instanceof Rules.RuleError)) throw e; }
      whole &&= counted(d);
    }
    ok("through 600 changes, taken or refused, every event is counted as recorded", whole && taken > 200 && opens(d), taken);
    ok("and the pot pays each prepayment's cost", paidRight);
  }
  /** A file in which the second prepayment is more than the first one left. */
  const cut = () => {
    const d = owing();
    const one = { type: "prepayment", fee_pct: 1, mode: "reduce_term" };
    events(d).push({ ...one, id: "a", date: "2027-01-10", amount: 800 }, { ...one, id: "b", date: "2027-01-12", amount: 500 });
    return WalletFile.parse(WalletFile.serialize(d));
  };
  const [, second] = Mortgage.run(cut().mortgage, [], false).rows;
  ok("a file whose schedule cuts an event opens and counts as before", second.prepayment === 200 && second.fee === 2);
  ok("it takes no change which leaves that so", why({ date: "2027-02-01" }, cut) === "warn_prepayment_over_balance"
    && refusal(d => Mortgage.bookStatement(d, { date: "2027-01-05", amount: 3 }), cut) === "warn_event_cut");
  {
    const d = cut();
    Mortgage.deleteEvents(d, ["b"]);
    prepay(d, { date: "2027-02-01" });
    ok("and takes changes again once that event is gone", events(d).length === 2 && counted(d));
  }

  // -------------------------------------------------------------- a pot in another currency
  const zloty = (held) => () => {
    const d = owing(2000, held);
    Cash.account(d, "prepay").currency = "PLN";
    return d;
  };
  {
    const d = zloty(5000)();
    prepay(d, { amount: 1000 });
    const move = d.cash_log.at(-1);
    ok("a pot in zloty pays the cost converted into zloty", move.amount === -4524.8 && pot(d) === 475.2
      && events(d)[0].amount === 1000 && opens(d), JSON.stringify(move));
  }
  ok("1500 zloty do not pay a prepayment of 1000 EUR", why({ amount: 1000 }, zloty(1500)) === "warn_pot_too_small");
  const short = said(() => prepay(zloty(1500)(), { amount: 1000 }));
  ok("and both are told in EUR", short?.pot === "€334.82" && short?.cost === "€1,010.00", JSON.stringify(short));
  ok("the cost to the grosz pays, a grosz less does not", why({ amount: 1000 }, zloty(4524.8)) === null
    && why({ amount: 1000 }, zloty(4524.79)) === "warn_pot_too_small");
  {
    const d = owing(2000);
    prepay(d, { amount: 100.5 }); // its cost, 101.505, ends in half a cent
    ok("the balance of the pot moves by just what the log says", d.cash_log.at(-1).amount === -101.51 && pot(d) === 4898.49,
      `${d.cash_log.at(-1).amount} ${pot(d)}`);
  }
  ok("a pot too large to be counted in cents is refused", why({}, () => owing(1000, 1e308)) === "err_value_number");
  ok("the pot is worth its balance in EUR", Math.abs(Mortgage.prepaymentPot(zloty(4480)()).eur - 1000) < 1e-9
    && Mortgage.prepaymentPot({ ...example(), cash: [] }) === null);

  // -------------------------------------------------------------- the preview
  const form = { amount: 100, date: "2027-01-10", feePct: 1, mode: "reduce_term" };
  const shown = (change, start = owing) => refusal(d => Mortgage.prepaymentEffect(d, { ...form, ...change }), start);
  for(const [what, change, start = owing] of [["of 0", { amount: 0 }], ["above the balance", { amount: 3000 }],
    ["with a fee above 100", { feePct: 101 }], ["with a mode that is none", { mode: "fast" }],
    ["with a date that is none", { date: "soon" }], ["which cuts a later event", { amount: 500, date: "2027-01-05" }, early],
    ["of a loan paid off", {}, paid]]) {
    const reason = said(() => Mortgage.prepaymentEffect(start(), { ...form, ...change }));
    const booking = said(() => prepay(start(), { ...change, fromPot: false }));
    ok(`a preview ${what} gives the reason booking it gives`, shown(change, start) !== null
      && shown(change, start) === why({ ...change, fromPot: false }, start) && JSON.stringify(reason) === JSON.stringify(booking),
      `${shown(change, start)} ${JSON.stringify(reason)}`);
  }
  ok("a preview does not look at the pot", shown({}, () => owing(1000, 0)) === null);

  // -------------------------------------------------------------- the parameters
  const params = (change) => (d) => Mortgage.save(d, { ...d.house }, { ...d.mortgage, ...change });
  ok("parameters under which a recorded prepayment would be cut are refused",
    refusal(params({ amount: 500 }), early) === "err_params_cut_event");
  const cutBy = said(() => params({ amount: 500 })(early()));
  ok("and the refusal names the day of that event", cutBy?.date === "10.01.2027", JSON.stringify(cutBy));
  ok("a loan which just holds it is saved", refusal(params({ amount: 800 }), early) === null);
  /** 1002 paid, its capital left to the rate: at 3.5% 999.08 of the 1000, at 0% more than there is. */
  const derived = () => {
    const d = owing();
    events(d).push({ id: "p", date: "2027-03-01", type: "payment", amount: 1002 });
    return d;
  };
  ok("so is a rate which would give a payment more capital than is left",
    refusal(params({ rate_pct: 0 }), derived) === "err_params_cut_event" && refusal(params({ rate_pct: 3.5 }), derived) === null);
  ok("a file which already cuts an event takes no parameters which leave it so",
    refusal(params({ term_months: 24 }), cut) === "err_params_cut_event");
  ok("it takes those which hold every event", refusal(params({ amount: 1300 }), cut) === null);
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
  ok("no effect without an amount above 0: refused as booking it is", [0, null].every(amount => refusal(d =>
    Mortgage.prepaymentEffect(d, { amount, feePct: 1.5, mode: "reduce_term" })) === "warn_prepayment_amount"));
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
  ok("a date that is none is refused", refusal(d => tx(d, { date: "soon" })) === "err_date");
  ok("a transaction without a date is today's", (() => {
    const e = example();
    tx(e, { date: null });
    return e.transactions.at(-1).date === Dates.today();
  })());
  ok("added as it comes, one of an unknown instrument is refused",
    refusal(d => Transactions.add(d, "nope", "buy", 1, 1)) === "warn_add_instrument_first");
  ok("and so is one with a date that is none",
    refusal(d => Transactions.add(d, "webg", "buy", 1, 1, 0, "soon")) === "err_date");
}

// ---------------------------------------------------------------- what a transaction does to the quantity
{
  const change = (type, quantity) => Transactions.change({ type, quantity });
  ok("a purchase adds", change("buy", 2) === 2 && change("buy", "2.5") === 2.5);
  ok("a sale takes away", change("sell", 2) === -2);
  ok("an adjustment adds its quantity, which may be below 0", change("adjust", 3) === 3 && change("adjust", -3) === -3);
}

// ---------------------------------------------------------------- a new instrument
{
  const fields = { name: " Platinum ", ticker: "XPT", bucket: "metals", currency: "USD", opening_quantity: "2", price: 31.5,
    unit: "oz" };
  const add = (d, change) => Instruments.add(d, { ...fields, ...change }, "2026-11-27");
  const why = (change) => refusal(d => add(d, change));
  {
    const d = example();
    const redone = add(d);
    const { id, ...rest } = d.assets.at(-1);
    ok("an instrument is added complete, in its bucket's category, at 0%", !!id && !redone.length
      && JSON.stringify(rest) === JSON.stringify({ name: "Platinum", ticker: "XPT", category: "metals", bucket: "metals",
        currency: "USD", opening_quantity: 2, price: 31.5, unit: "oz", price_updated: "2026-11-27", price_symbol: "",
        target_in_bucket: 0, alert_price: null }), JSON.stringify(rest));
    ok("the wallet with it opens", opens(d), WalletFile.check(d).join("; "));
  }
  {
    const d = example();
    add(d, { ticker: undefined, opening_quantity: null, price: null, unit: "", currency: "EUR" });
    const a = d.assets.at(-1);
    ok("empty numbers are 0, an empty unit pcs", a.opening_quantity === 0 && a.price === 0 && a.unit === "pcs"
      && a.ticker === "" && opens(d), JSON.stringify(a));
  }
  {
    const d = example();
    asset(d, "gold").target_in_bucket = 70;
    const redone = add(d);
    ok("a bucket whose targets do not add up is recalculated, and named", redone.join() === "metals"
      && Buckets.isWhole(Buckets.targetSum(d.assets, "metals")) && opens(d), redone.join());
  }
  for(const [what, name] of [["without a name", ""], ["with a name of spaces", "  "], ["with no name given", null]]) {
    ok(`an instrument ${what} is refused`, why({ name }) === "warn_name_required");
  }
  for(const [what, bucket] of [["without a bucket", ""], ["of a bucket that is none", "nope"],
    ["of a bucket named like an object's own part", "constructor"]]) {
    ok(`an instrument ${what} is refused`, why({ bucket }) === "warn_bucket_required");
  }
  ok("a currency the wallet has no rate for is refused", why({ currency: "GBP" }) === "err_value_choice");
  ok("a price of -5 is refused by the form", why({ price: -5 }) === "err_value_min");
  ok("so is an opening quantity below 0", why({ opening_quantity: -1 }) === "err_value_min");
  ok("a price that is no number is refused", why({ price: "x" }) === "err_value_number");
  ok("so is an opening quantity that is none", why({ opening_quantity: "x" }) === "err_value_number");
  ok("a new instrument with a date that is none is refused",
    refusal(d => Instruments.add(d, fields, "soon")) === "err_date");
  ok("the wallet's currencies are the euro and those with a rate", Rates.currencies(example()).join() === "EUR,USD,PLN");
  ok("a category's buckets come in their order", Buckets.of(example(), "equities").join() === "fortress,sandbox"
    && !Buckets.of(example(), "nope").length);
}

// ---------------------------------------------------------------- the instrument table
{
  const rows = (d, change = {}) => d.assets.map(a => ({ ...a, delete: false, ...(change[a.id] || {}) }));
  /** The first row's price changes too: a refusal further down must leave it as well. */
  const why = (change) => refusal(d => Instruments.save(d, rows(d, { webg: { price: 20 }, ...change })));
  for(const id of ["nope", "__proto__", undefined]) {
    ok(`a row of an instrument that is none (${id}) refuses the table`, refusal(d => Instruments.save(d,
      [...rows(d, { webg: { price: 20 } }), { ...rows(d)[1], id }])) === "err_value_choice");
  }
  ok("so does such a row marked for deletion", refusal(d => Instruments.save(d,
    [...rows(d), { id: "nope", delete: true }])) === "err_value_choice");
  ok("a row without a name is refused", why({ gold: { name: " " } }) === "warn_name_required");
  ok("so is a row whose name is no text", why({ gold: { name: NaN } }) === "warn_name_required"
    && why({ gold: { name: {} } }) === "warn_name_required");
  ok("a row of a bucket that is none is refused", why({ gold: { bucket: "nope" } }) === "warn_bucket_required");
  ok("a row in a currency without a rate is refused", why({ gold: { currency: "GBP" } }) === "err_value_choice");
  ok("a negative price in the table is refused", why({ gold: { price: -1 } }) === "err_value_min");
  ok("so is a price that is no number", why({ gold: { price: "x" } }) === "err_value_number");
  ok("a negative sell alert is refused", why({ gold: { alert_price: -1 } }) === "err_value_min");
  ok("so is a sell alert that is no number", why({ gold: { alert_price: "x" } }) === "err_value_number");
  ok("a table saved with a date that is none is refused",
    refusal(d => Instruments.save(d, rows(d), "soon")) === "err_date");
  let field = null;
  try { Instruments.save(example(), rows(example(), { gold: { price: -1 } })); } catch(e) { field = e.vars.field; }
  ok("a refused number names its row and column", field === `${asset(example(), "gold").name} · Price`, field);
  {
    const d = example();
    Instruments.save(d, rows(d, { gold: { alert_price: 5000, price: null }, silver: { alert_price: 0 },
      edo0134: { alert_price: null } }));
    ok("a sell alert is empty or a price, an empty price 0", asset(d, "gold").alert_price === 5000
      && asset(d, "gold").price === 0 && asset(d, "silver").alert_price === null && opens(d));
  }
  {
    const d = example();
    Instruments.save(d, rows(d, { gold: { delete: true, name: "", price: -1, bucket: "nope" } }));
    ok("what a row marked for deletion holds is not looked at", !asset(d, "gold") && opens(d));
  }
}

// ---------------------------------------------------------------- removing transactions
{
  /** The example with the transactions given as [id, day of November, type, quantity, instrument] and 0 of it before. */
  const traded = (...list) => () => {
    const d = example();
    asset(d, "galp").opening_quantity = 0;
    for(const [id, day, type, quantity, assetId = "galp"] of list) {
      d.transactions.push({ id, date: `2026-11-${day}`, asset_id: assetId, type, quantity, price: 20, fee: 0 });
    }
    return d;
  };
  const why = (ids, start) => refusal(d => Transactions.remove(d, ids), start);
  const sold = traded(["buy", "01", "buy", 5], ["sell", "10", "sell", 4], ["more", "20", "buy", 9], ["other", "05", "buy", 1, "webg"]);
  ok("a purchase a later sale needs is not removed, though more is bought after it",
    why(["buy"], sold) === "warn_delete_oversells");
  let named = null;
  try { Transactions.remove(sold(), ["buy"]); } catch(e) { named = e.vars.name; }
  ok("and the refusal names the instrument", named === asset(example(), "galp").name, named);
  ok("one instrument refused holds the whole removal back", why(["other", "buy"], sold) === "warn_delete_oversells");
  {
    const d = sold();
    Transactions.remove(d, new Set(["buy", "sell"]));
    ok("the purchase goes together with that sale", d.transactions.map(t => t.id).join() === "more,other"
      && Transactions.heldOn(d, "galp") === 9 && opens(d));
  }
  ok("the sale alone goes", why(["sell"], sold) === null);
  ok("so does a purchase nothing draws on", why(["other", "more"], sold) === null);
  ok("a positive adjustment a sale needs is not removed",
    why(["adj"], traded(["adj", "01", "adjust", 2], ["sell", "10", "sell", 2])) === "warn_delete_oversells");
  ok("a negative one is", why(["adj"], traded(["buy", "01", "buy", 2], ["adj", "10", "adjust", -2])) === null);
  ok("only the end of a day counts", why(["early"],
    traded(["early", "01", "buy", 1], ["sell", "20", "sell", 2], ["buy", "20", "buy", 2])) === null);
  ok("fractions which add up to 0 are not below it", why(["early"],
    traded(["early", "01", "buy", 1], ["a", "02", "buy", 0.3], ["b", "03", "sell", 0.1], ["c", "04", "sell", 0.2])) === null);
  ok("a removal which corrects a quantity below 0 passes", why(["sell"], traded(["sell", "10", "sell", 6])) === null);
  const short = traded(["sell", "01", "sell", 1], ["buy", "05", "buy", 5], ["last", "10", "buy", 1]);
  ok("a day already below 0 which the removal does not lower does not stop it", why(["last"], short) === null);
  ok("a quantity already below 0 is not taken lower",
    why(["buy"], traded(["buy", "01", "buy", 1], ["sell", "05", "sell", 3])) === "warn_delete_oversells");
  {
    const d = traded(["lost", "01", "sell", 3, "gone"], ["buy", "02", "buy", 1])();
    const price = asset(d, "galp").price;
    Transactions.remove(d, ["nope"]);
    ok("an id that is none removes nothing", d.transactions.length === 2);
    Transactions.remove(d, ["lost", "buy"]);
    ok("a transaction of an instrument that is gone goes too, and no price changes",
      !d.transactions.length && asset(d, "galp").price === price && opens(d));
  }
}

// ---------------------------------------------------------------- a cash movement of the form
{
  const movement = { accountId: "emergency", amount: 25.5, date: "2026-11-20", note: "gift" };
  const why = (change) => refusal(d => Cash.record(d, { ...movement, ...change }));
  {
    const d = example();
    const held = Cash.account(d, "emergency").amount;
    Cash.record(d, movement);
    const { id, ...entry } = d.cash_log.at(-1);
    ok("a deposit is booked on its account and in the log", !!id && Cash.account(d, "emergency").amount === held + 25.5
      && JSON.stringify(entry) === JSON.stringify({ date: "2026-11-20", account_id: "emergency", amount: 25.5, note: "gift" })
      && opens(d), JSON.stringify(entry));
    Cash.record(d, { accountId: "emergency", amount: "-25.5" });
    ok("a withdrawal, without a date today's", Cash.account(d, "emergency").amount === held
      && d.cash_log.at(-1).amount === -25.5 && d.cash_log.at(-1).date === Dates.today() && opens(d));
  }
  for(const [what, amount] of [["of 0", 0], ["of a written 0", "0"], ["left empty", null], ["that is no number", "x"],
    ["beyond any number", Infinity]]) {
    ok(`a cash movement ${what} is refused`, why({ amount }) === "warn_amount_zero");
  }
  ok("so is one too large to be counted in cents", why({ amount: 1e308 }) === "err_value_number");
  ok("a movement of less than half a cent is refused like 0",
    why({ amount: 0.004 }) === "warn_amount_zero" && why({ amount: "-0.004" }) === "warn_amount_zero");
  {
    const d = example();
    Cash.record(d, { ...movement, amount: -0.005 });
    ok("one of half a cent is a cent", d.cash_log.at(-1).amount === -0.01 && opens(d), d.cash_log.at(-1).amount);
  }
  ok("a cash movement on an account that is none is refused", why({ accountId: "nope" }) === "err_value_choice");

  /** Whether a change moves every balance by just what it logs on that account. */
  const follows = (d, change) => {
    const before = new Map(d.cash.map(c => [c.id, Number(c.amount)])), logged = d.cash_log.length;
    change(d);
    return d.cash.every(c => {
      const sum = d.cash_log.slice(logged).filter(l => l.account_id === c.id).reduce((s, l) => s + l.amount, 0);
      return Math.abs(Number(c.amount) - before.get(c.id) - sum) < 1e-9;
    });
  };
  {
    const d = example();
    const one = follows(d, x => Cash.record(x, { accountId: "home", amount: -100.505 }));
    ok("a movement is rounded to cents once, the balance moved by what the log says", one
      && d.cash_log.at(-1).amount === -100.51 && Cash.account(d, "home").amount === 29.49,
    `${d.cash_log.at(-1).amount} ${Cash.account(d, "home").amount}`);
  }
  {
    const d = example();
    Cash.account(d, "home").amount = 130.005;
    const one = follows(d, x => Cash.record(x, { accountId: "home", amount: -100.505 }));
    ok("so is a balance a file gives in parts of a cent", one && Cash.account(d, "home").amount === 29.495,
      Cash.account(d, "home").amount);
  }
  {
    const d = example();
    const cash = () => JSON.stringify([d.cash, d.cash_log]);
    const before = cash();
    const moved = Cash.add(d, "home", 0.004);
    Cash.save(d, d.cash.map(c => ({ ...c, amount: c.amount + 0.002 })));
    Mortgage.bookPrepayment(d, { amount: 0.004, mode: "reduce_term", fromPot: true });
    ok("a movement which in cents is nothing changes no balance and logs nothing", moved === 0 && cash() === before
      && opens(d), cash());
  }
  {
    let n = 11, taken = 0, all = true;
    const rnd = () => (n = n * 48271 % 2147483647) / 2147483647;
    const d = example();
    Object.assign(Cash.account(d, "prepay"), { currency: "PLN", amount: 100000 });
    Cash.account(d, "emergency").currency = "USD";
    for(let i = 0; i < 400; i++) {
      const x = Math.round(rnd() * 200000 - 90000) / 1000, id = ["emergency", "prepay", "home"][Math.floor(rnd() * 3)];
      all &&= follows(d, y => {
        try {
          if(i % 4 === 0) Cash.record(y, { accountId: id, amount: x });
          else if(i % 4 === 1) Cash.save(y, y.cash.map(c => ({ ...c, amount: Number(c.amount) + (c.id === id ? x : 0) })));
          else if(i % 4 === 2) Plan.apply(y, { lines: [{ kind: "cash", account_id: id, eur: Math.abs(x) }] });
          else Mortgage.bookPrepayment(y, { amount: Math.abs(x) + 1, date: "2027-01-10", feePct: 1, mode: "reduce_term", fromPot: true });
          taken++;
        }
        catch(e) { if(!(e instanceof Rules.RuleError)) throw e; }
      });
    }
    ok("through 400 movements of every kind each balance moves by what the log says", all && taken > 300 && opens(d), taken);
    ok("an account's amount is written with its currency", Texts.amount(d, -1234.5, "PLN") === "-1,234.50 PLN"
      && Texts.amount(d, -1234.5, "EUR") === Texts.money(d, -1234.5, 2) && Texts.amount(d, 5) === "€5.00"
      && Texts.amount(d, NaN, "PLN") === "–", Texts.amount(d, -1234.5, "PLN"));
  }
  ok("so is one with a date that is none", why({ date: "soon" }) === "err_date");
}

// ---------------------------------------------------------------- recording a plan
{
  ok("a plan recorded with a date that is none is refused",
    refusal(d => Plan.apply(d, Plan.contribution(d, 5000), "soon")) === "err_date");
  const d = example();
  Plan.apply(d, Plan.contribution(d, 5000), "2026-11-20");
  ok("a plan is recorded on its date", d.transactions.length > 0 && d.cash_log.length > 0
    && [...d.transactions, ...d.cash_log].every(x => x.date === "2026-11-20") && opens(d));
  const e = example();
  Plan.apply(e, Plan.contribution(e, 5000), "");
  ok("without a date it is today's", e.transactions.every(t => t.date === Dates.today()) && opens(e));

  /** A plan of the example as it was, applied to a wallet which has changed since. */
  const stale = (change) => {
    const plan = Plan.contribution(example(), 100000);
    return refusal(d => Plan.apply(d, plan), () => { const d = example(); change(d); return d; });
  };
  ok("a plan whose account has gone is refused, the movements before it unbooked",
    stale(d => { d.cash = d.cash.filter(c => c.role !== "prepay"); }) === "err_value_choice");
  ok("so is one whose instrument has gone", stale(d => { d.assets = d.assets.filter(a => a.id !== "webg"); }) === "err_value_choice");
  ok("a plan of an amount beyond counting is refused",
    refusal(d => Plan.apply(d, Plan.contribution(d, 1e308))) === "err_value_number");
  const lines = (...list) => refusal(d => Plan.apply(d, { lines: [{ kind: "cash", account_id: "home", eur: 5 }, ...list] }));
  const buy = { kind: "buy", asset_id: "webg", eur: 10, units: 1, price: 10 };
  for(const [what, line] of [["an amount that is none", { kind: "cash", account_id: "home", eur: "x" }],
    ["units beyond any number", { ...buy, units: Infinity }], ["units no number can round", { ...buy, units: 1e308 }],
    ["a price that is none", { ...buy, price: NaN }], ["a price below 0", { ...buy, price: -1 }]]) {
    ok(`a plan with ${what} is refused whole`, lines(line) === "err_value_number");
  }
  ok("two movements which only together overflow an account are refused",
    lines(...[1, 2].map(() => ({ kind: "cash", account_id: "home", eur: 1e306 }))) === "err_value_number");
  ok("a cash line without an account is passed over, as before",
    lines({ kind: "cash", account_id: null, eur: 5 }, buy) === null);

  /** The example with the home account kept in zloty. */
  const zloty = () => {
    const d = example();
    Cash.account(d, "home").currency = "PLN";
    return d;
  };
  {
    const z = zloty();
    const held = Cash.account(z, "home").amount;
    Plan.apply(z, { lines: [{ kind: "cash", account_id: "home", eur: 821.43 }] }, "2026-11-20");
    ok("a plan's euros go into a zloty account in zloty, the log telling what the balance gained",
      z.cash_log.at(-1).amount === 3680.01 && Cash.account(z, "home").amount === Base.round2(held + 3680.01) && opens(z),
      JSON.stringify(z.cash_log.at(-1)));
  }
  const large = (d) => Plan.apply(d, { lines: [{ kind: "cash", account_id: "home", eur: 1e306 }] });
  ok("the balances of a plan are counted in each account's currency",
    refusal(large, zloty) === "err_value_number" && refusal(large) === null);
}

// ---------------------------------------------------------------- exchange rates
{
  const why = (rates) => refusal(d => Rates.save(d, rates));
  {
    const d = example();
    Rates.save(d, { USD: 1.2, PLN: "4.3" });
    ok("rates are saved as numbers, one written as text too", d.settings.fx.USD === 1.2 && d.settings.fx.PLN === 4.3 && opens(d));
  }
  for(const [what, rate] of [["of 0", 0], ["below 0", -1], ["that is text", "x"], ["left empty", ""], ["of no value", null],
    ["that is missing", undefined], ["that is yes", true], ["beyond any number", Infinity]]) {
    ok(`a rate ${what} is refused, the one before it unsaved too`, why({ USD: 1.5, PLN: rate }) === "err_rate");
  }
  let named = null;
  try { Rates.save(example(), { PLN: 0 }); } catch(e) { named = e.vars.currency; }
  ok("and the refusal names the currency", named === "PLN", named);
  ok("a currency the wallet has no rate for is refused", why({ USD: 1.5, GBP: 0.8 }) === "err_value_choice"
    && why(JSON.parse('{"__proto__": 2}')) === "err_value_choice");
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok("an amount goes from EUR into a currency and back", near(Rates.fromEur(example(), 100, "PLN"), 448)
    && near(Rates.toEur(example(), 448, "PLN"), 100) && Rates.fromEur(example(), 5, "EUR") === 5);
}

// ---------------------------------------------------------------- dates of the calendar
{
  ok("a date is one the calendar has, a time after it allowed",
    ["2026-01-02", "2028-02-29", "2026-12-31", "2026-01-02T10:00", "0099-12-31"].every(v => Dates.isDate(v))
    && ["2026-13-45", "2026-02-30", "2027-02-29", "2026-00-10", "2026-11-00", "2026-04-31", "26-01-02", "soon", ""]
      .every(v => !Dates.isDate(v)));
  ok("reading one takes the day and drops the time", Dates.parse("2026-01-02T10:00") === "2026-01-02"
    && run("Dates.parse(new Date(2026, 0, 2))") === "2026-01-02" && Dates.parse("") === null);
  ok("what is no day is not read, a broken Date neither", ['"2026-02-30"', 'new Date("soon")'].every(v => {
    try { run(`Dates.parse(${v})`); return false; } catch { return true; }
  }));
  const loan = (d) => ({ amount: 270000, term_months: 420, default_mode: "reduce_term", ...d.mortgage });
  const forms = {
    "a cash movement": (d, date) => Cash.record(d, { accountId: "home", amount: 5, date }),
    "the cash table": (d, date) => Cash.save(d, d.cash.map(c => ({ ...c })), "", date),
    "a transaction": (d, date) => Transactions.record(d, { assetId: "webg", type: "buy", quantity: 1, date }),
    "a new instrument": (d, date) => Instruments.add(d, { name: "New", bucket: "metals", currency: "EUR" }, date),
    "the instrument table": (d, date) => Instruments.save(d, d.assets.map(a => ({ ...a })), date),
    "the date of the deed": (d, date) => Mortgage.save(d, { ...d.house, deed_date: date }, loan(d)),
    "the date of the first payment": (d, date) => Mortgage.save(d, d.house, { ...loan(d), first_payment_date: date }),
    "a payment of the statement": (d, date) => Mortgage.bookStatement(d, { date, amount: 5 }),
    "a prepayment": (d, date) => Mortgage.bookPrepayment(d, { amount: 5, date, mode: "reduce_term" }),
    "the preview of a prepayment": (d, date) => Mortgage.prepaymentEffect(d, { amount: 5, date, mode: "reduce_term" }),
    "a plan": (d, date) => Plan.apply(d, Plan.contribution(d, 100), date),
  };
  for(const [what, fn] of Object.entries(forms)) {
    ok(`${what}: a date the calendar does not have is refused`,
      ["2026-13-45", "2026-02-30"].every(date => refusal(d => fn(d, date)) === "err_date"));
  }
  const text = (lang, key) => I18N.t(lang, key, { field: "X" });
  ok("the refusal of a date has a text of its own in every language", ["en", "pl", "pt"].every(l =>
    text(l, "err_date").startsWith("X: ") && text(l, "err_date") !== text(l, "err_value_choice")));
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
