// scripts/core/wallet/mortgage.js
//
// The mortgage: annuity, the schedule with the payments and prepayments booked, its
// projection to the end, what prepaying is worth, and every change of the loan:
// booking and deleting payments and prepayments, and the save of the home and the
// loan's parameters.

const Mortgage = (() => {
  const MODES = ["reduce_term", "reduce_payment"];

  function annuity(balance, annualRatePct, months) {
    if(months <= 0) return balance;
    const i = annualRatePct / 1200;
    if(Math.abs(i) < 1e-12) return balance / months;
    return balance * i / (1 - Math.pow(1 + i, -months));
  }

  /** Annual rate (%) implied by loan amount, monthly payment and number of payments. */
  function impliedRate(amount, payment, months) {
    if(months <= 0 || payment * months <= amount) return 0;
    let lo = 0, hi = 30;
    for(let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2;
      if(annuity(amount, mid, months) < payment) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function firstPaymentDate(m) {
    const d = Dates.parse(m.first_payment_date);
    if(d) return d;
    return Dates.addMonths(Dates.today().slice(0, 8) + "01", 2);
  }

  function initialPayment(m) {
    if(!Base.isBlank(m.bank_payment) && Number(m.bank_payment) !== 0) return Number(m.bank_payment);
    return annuity(Number(m.amount), Number(m.rate_pct), Number(m.term_months));
  }

  const _row = (date, kind, payment, interest, principal, prepayment, fee, balance, actual, n) => ({
    date, kind, n, payment: Base.round2(payment), interest: Base.round2(interest), principal: Base.round2(principal),
    prepayment: Base.round2(prepayment), fee: Base.round2(fee), balance: Base.round2(balance), actual,
  });

  /** What a prepayment of `amount` costs at a fee of `feePct` %: the fee, and the amount with it. */
  function prepaymentCost(amount, feePct) {
    const fee = Number(amount) * Number(feePct) / 100;
    return { fee, cost: Number(amount) + fee };
  }

  /**
   * Books the recorded events (payments and prepayments), then projects to the end.
   * extraEvents: hypothetical prepayments ({date, amount, mode, fee_pct}) for simulations.
   * Row kinds: payment, prepayment, payment_plan, prepayment_plan.
   * @returns {{rows: object[], info: object}} throws Rules.RuleError for a payment
   *   which does not cover the interest, so the loan is never paid off
   */
  function run(m, extraEvents = [], project = true) {
    const rate = Number(m.rate_pct || 0);
    const i = rate / 1200;
    const term = Number(m.term_months || 0);
    const first = firstPaymentDate(m);
    const defaultFee = Number(m.prepayment_fee_pct || 0);
    const defaultMode = m.default_mode || "reduce_term";

    let bal = Number(m.amount || 0);
    let pay = initialPayment(m);
    let k = 0;
    let interestPaid = 0, feesPaid = 0, prepaid = 0;
    const rows = [];

    function prepay(amount, feePct, mode, nDone) {
      const amt = Math.min(Number(amount), bal);
      const { fee } = prepaymentCost(amt, feePct);
      bal = Base.round2(bal - amt);
      if(mode === "reduce_payment" && bal > 0) pay = annuity(bal, rate, Math.max(term - nDone, 1));
      return [amt, fee];
    }

    const events = [...(m.events || [])].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) || (a.type === "payment" ? 0 : 1) - (b.type === "payment" ? 0 : 1));
    for(const e of events) {
      const d = Dates.parse(e.date);
      if(e.type === "payment") {
        const interest = Base.isBlank(e.interest) ? Base.round2(bal * i) : Number(e.interest);
        let principal = Base.isBlank(e.principal) ? Number(e.amount) - interest : Number(e.principal);
        principal = Math.min(principal, bal);
        bal = Base.round2(bal - principal);
        k += 1;
        interestPaid += interest;
        rows.push(_row(d, "payment", Number(e.amount), interest, principal, 0, 0, bal, true, k));
      }
      else if(e.type === "prepayment") {
        const [amt, fee] = prepay(e.amount, e.fee_pct ?? defaultFee, e.mode || defaultMode, k);
        feesPaid += fee;
        prepaid += amt;
        rows.push(_row(d, "prepayment", 0, 0, 0, amt, fee, bal, true, k));
      }
    }

    const info = {
      balance: bal, payment: pay, paid_count: k, interest_paid: interestPaid,
      fees_paid: feesPaid, prepaid, next_due: Dates.addMonths(first, k), rate_pct: rate,
    };
    if(!project) return { rows, info };

    const extra = [...extraEvents].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let ei = 0, n = k, projInterest = 0, projFees = 0, projPrepaid = 0, guard = 0;
    while(bal > 0.005 && guard < term + 1200) {
      guard += 1;
      n += 1;
      const due = Dates.addMonths(first, n - 1);
      while(ei < extra.length && Dates.parse(extra[ei].date) < due) {
        const e = extra[ei++];
        if(bal <= 0.005) break;
        const [amt, fee] = prepay(e.amount, e.fee_pct ?? defaultFee, e.mode || defaultMode, n - 1);
        projFees += fee;
        projPrepaid += amt;
        rows.push(_row(Dates.parse(e.date), "prepayment_plan", 0, 0, 0, amt, fee, bal, false, n - 1));
      }
      if(bal <= 0.005) break;
      const interest = Base.round2(bal * i);
      let principal = pay - interest;
      if(principal <= 0) throw new Rules.RuleError("err_payment_too_low");
      if(n >= term || principal > bal) principal = bal;
      bal = Base.round2(bal - principal);
      projInterest += interest;
      rows.push(_row(due, "payment_plan", interest + principal, interest, principal, 0, 0, bal, false, n));
    }

    const last = [...rows].reverse().find(r => r.kind.startsWith("payment"));
    Object.assign(info, {
      end_date: last ? last.date : null,
      remaining_payments: bal <= 0.005 ? n - k : null,
      total_interest: interestPaid + projInterest,
      future_interest: projInterest,
      total_fees: feesPaid + projFees,
      total_prepaid: prepaid + projPrepaid,
    });
    return { rows, info };
  }

  function state(m) {
    if(!Number(m.amount)) return { balance: 0, payment: 0, paid_count: 0 };
    return run(m, [], false).info;
  }

  /** Schedule + comparison with a variant without any prepayments. */
  function report(m, extraEvents = []) {
    const { rows, info } = run(m, extraEvents);
    const base = run({ ...m, events: [] });
    Object.assign(info, {
      baseline_interest: base.info.total_interest,
      baseline_end: base.info.end_date,
      interest_saved: base.info.total_interest - info.total_interest,
    });
    info.net_saved = info.interest_saved - info.total_fees;
    return { rows, info, baseRows: base.rows };
  }

  function yearlyPrepayments(start, amount, mode, feePct, years = 60) {
    return Array.from({ length: years }, (_, y) => ({
      date: Dates.addMonths(start, 12 * y), amount, mode, fee_pct: feePct,
    }));
  }

  function prepaymentBreakEvenMonths(m) {
    const rate = Number(m.rate_pct || 0);
    if(rate <= 0) return null;
    return Number(m.prepayment_fee_pct || 0) / (rate / 12);
  }

  /**
   * Interest and principal of schedule rows summed by year, prepayments counted into
   * the principal.
   * @returns {Array<{year:string, interest:number, principal:number}>} oldest first
   */
  function yearlyTotals(rows) {
    const years = {};
    for(const r of rows) {
      const y = r.date.slice(0, 4);
      years[y] ??= { interest: 0, principal: 0 };
      years[y].interest += r.interest;
      years[y].principal += r.principal + r.prepayment;
    }
    return Object.keys(years).sort().map(year => ({ year, ...years[year] }));
  }

  /**
   * The payment in force on a day, among schedule rows: that of the first payment from
   * the day on. The last row, which settles what remains, counts only when no earlier
   * one is that late.
   */
  function paymentOn(rows, date) {
    const list = rows.filter(r => r.kind.startsWith("payment"));
    for(const r of list.slice(0, -1)) if(r.date >= date) return r.payment;
    return list.length ? list[list.length - 1].payment : 0;
  }

  /**
   * What a prepayment would change, as a preview: the interest saved, the fee, what is
   * gained net of it, and the end and the payment before and after.
   * @param {{amount:any, date?:string, feePct?:any, mode:string}} prepayment  an empty date is today
   * @returns {{saved:number, fee:number, net:number, end_date:string, old_end_date:string,
   *   payment:number, old_payment:number}|null} null without an amount above 0
   */
  function prepaymentEffect(data, { amount, date = null, feePct = 0, mode }) {
    if(!(Number(amount) > 0)) return null;
    const m = data.mortgage;
    const day = Rules.date(data, date, "field_date") || Dates.today();
    const event = { id: "preview", date: day, type: "prepayment", amount: Number(amount), fee_pct: feePct || 0, mode };
    const before = run(m).info, after = run({ ...m, events: [...m.events, event] }).info;
    const saved = before.future_interest - after.future_interest;
    const { fee } = prepaymentCost(amount, feePct || 0);
    return {
      saved, fee, net: saved - fee, end_date: after.end_date, old_end_date: before.end_date,
      payment: after.payment, old_payment: before.payment,
    };
  }

  /** Next payment to book, split into interest and principal according to the schedule. */
  function nextPaymentEvent(m) {
    const { info } = run(m, [], false);
    const interest = Base.round2(info.balance * Number(m.rate_pct) / 1200);
    const amount = Base.round2(Math.min(info.payment, info.balance + interest));
    return {
      id: Base.newId(), date: info.next_due, type: "payment", amount,
      interest, principal: Base.round2(amount - interest), note: "",
    };
  }

  // ---------------------------------------------------------------- changes of the loan
  // Each checks everything first and throws Rules.RuleError before changing anything.

  /** Whether the events recorded leave nothing to pay. */
  const paidOff = (m) => run(m, [], false).info.balance <= 0;

  /** The balance after the events recorded up to a day, those of that day included. */
  const _balanceOn = (m, day) =>
    run({ ...m, events: m.events.filter(e => Dates.parse(e.date) <= day) }, [], false).info.balance;

  /** Books the next payment of the schedule; refused once the loan is paid off. */
  function bookPayment(data) {
    const m = data.mortgage;
    if(paidOff(m)) throw new Rules.RuleError("warn_mortgage_paid_off");
    m.events.push(nextPaymentEvent(m));
  }

  /**
   * Books a payment as the bank statement gives it. An empty date is the day the next
   * payment is due, an empty amount or part counts as 0.
   * @param {{date?:string, amount?:any, interest?:any, principal?:any}} statement
   */
  function bookStatement(data, { date = null, amount = null, interest = null, principal = null }) {
    const m = data.mortgage;
    const day = Rules.date(data, date, "field_date") || run(m, [], false).info.next_due;
    const part = (v, key) => Base.isBlank(v) ? 0 : Rules.number(data, v, key, 0);
    m.events.push({ id: Base.newId(), date: day, type: "payment", amount: part(amount, "field_payment_eur"),
      interest: part(interest, "field_interest_part"), principal: part(principal, "field_principal_part"),
      note: Texts.tr(data, "note_from_statement") });
  }

  /**
   * Books a prepayment and, with `fromPot`, takes it with its fee from the prepayment
   * pot: both or neither. Refused above the balance of its day, and when the pot does
   * not hold the cost.
   * @param {{amount:any, date?:string, feePct?:any, mode:string, fromPot?:boolean}} prepayment
   *   an empty date is today, an empty fee 0
   */
  function bookPrepayment(data, { amount, date = null, feePct = null, mode, fromPot = false }) {
    const m = data.mortgage;
    if(!Base.isNumeric(amount) || Number(amount) <= 0) throw new Rules.RuleError("warn_prepayment_amount");
    const sum = Number(amount);
    const day = Rules.date(data, date, "field_date") || Dates.today();
    const percent = Base.isBlank(feePct) ? 0 : Rules.number(data, feePct, "field_fee_pct", 0, 100);
    if(!MODES.includes(mode)) throw new Rules.RuleError("err_value_choice", { field: Texts.tr(data, "field_mode") });
    const balance = _balanceOn(m, day);
    if(sum > balance + 1e-9) {
      throw new Rules.RuleError("warn_prepayment_over_balance", { balance: Texts.money(data, balance, 2) });
    }
    const { cost } = prepaymentCost(sum, percent);
    const pot = fromPot ? Cash.account(data, "prepay") : null;
    const held = Number(pot?.amount || 0);
    if(fromPot && (!pot || held + 1e-9 < cost)) {
      throw new Rules.RuleError("warn_pot_too_small", { pot: Texts.money(data, held, 2), cost: Texts.money(data, cost, 2) });
    }
    if(pot) Cash.add(data, pot.id, -cost, Texts.tr(data, "note_prepayment_with_fee"), day);
    m.events.push({ id: Base.newId(), date: day, type: "prepayment", amount: sum, fee_pct: percent, mode, note: "" });
  }

  /** Removes the recorded events of the ids given. */
  function deleteEvents(data, ids) {
    const gone = new Set(ids);
    data.mortgage.events = data.mortgage.events.filter(e => !gone.has(e.id));
  }

  /**
   * The home and mortgage parameters.
   * @param {{purchase_price, value, deposit_paid, deed_date}} house
   * @param {{amount, rate_pct, term_months, first_payment_date, bank_payment, prepayment_fee_pct, default_mode}} loan
   */
  function save(data, house, loan) {
    const h = {
      purchase_price: Rules.number(data, house.purchase_price ?? 0, "field_purchase_price", 0),
      value: Rules.number(data, house.value ?? 0, "field_house_value", 0),
      deposit_paid: Rules.number(data, house.deposit_paid ?? 0, "field_deposit", 0),
      deed_date: Rules.date(data, house.deed_date, "field_deed_date"),
    };
    if(!MODES.includes(loan.default_mode)) throw new Rules.RuleError("err_value_choice", { field: Texts.tr(data, "field_default_mode") });
    const bank = Base.isBlank(loan.bank_payment) ? 0 : Rules.number(data, loan.bank_payment, "field_bank_payment", 0);
    const m = {
      amount: Rules.number(data, loan.amount ?? 0, "field_loan_amount", 0),
      rate_pct: Rules.number(data, loan.rate_pct ?? 0, "field_rate", 0, 100),
      term_months: Math.round(Rules.number(data, loan.term_months, "field_term", 1, 1200)),
      first_payment_date: Rules.date(data, loan.first_payment_date, "field_first_payment"),
      bank_payment: bank || null,
      prepayment_fee_pct: Rules.number(data, loan.prepayment_fee_pct ?? 0, "field_prepayment_fee", 0, 100),
      default_mode: loan.default_mode,
    };
    Object.assign(data.house, h);
    Object.assign(data.mortgage, m);
  }

  return {
    MODES, annuity, impliedRate, firstPaymentDate, initialPayment, prepaymentCost, run, state,
    report, yearlyPrepayments, prepaymentBreakEvenMonths, yearlyTotals, paymentOn,
    prepaymentEffect, nextPaymentEvent, paidOff, bookPayment, bookStatement, bookPrepayment,
    deleteEvents, save,
  };
})();
