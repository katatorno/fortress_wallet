// scripts/core/wallet/mortgage.js
//
// The mortgage: annuity, the schedule with the payments and prepayments booked, its
// projection to the end, what prepaying is worth, and the save of the home and the
// loan's parameters.

const Mortgage = (() => {
  const MODES = ["reduce_term", "reduce_payment"];

  class MortgageError extends Error {
    constructor(key) { super(key); this.key = key; }
  }

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

  /**
   * Books the recorded events (payments and prepayments), then projects to the end.
   * extraEvents: hypothetical prepayments ({date, amount, mode, fee_pct}) for simulations.
   * Row kinds: payment, prepayment, payment_plan, prepayment_plan.
   * @returns {{rows: object[], info: object}}
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
      const fee = amt * Number(feePct) / 100;
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
      if(principal <= 0) throw new MortgageError("err_payment_too_low");
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

  /**
   * The home and mortgage parameters.
   * @param {{purchase_price, value, deposit_paid, deed_date}} house
   * @param {{amount, rate_pct, term_months, first_payment_date, bank_payment, prepayment_fee_pct, default_mode}} loan
   */
  function save(data, house, loan) {
    const date = (v, key) => {
      if(Base.isBlank(v)) return null;
      try { return Dates.parse(v); }
      catch { throw new Rules.RuleError("err_value_choice", { field: Texts.tr(data, key) }); }
    };
    const h = {
      purchase_price: Rules.number(data, house.purchase_price ?? 0, "field_purchase_price", 0),
      value: Rules.number(data, house.value ?? 0, "field_house_value", 0),
      deposit_paid: Rules.number(data, house.deposit_paid ?? 0, "field_deposit", 0),
      deed_date: date(house.deed_date, "field_deed_date"),
    };
    if(!MODES.includes(loan.default_mode)) throw new Rules.RuleError("err_value_choice", { field: Texts.tr(data, "field_default_mode") });
    const bank = Base.isBlank(loan.bank_payment) ? 0 : Rules.number(data, loan.bank_payment, "field_bank_payment", 0);
    const m = {
      amount: Rules.number(data, loan.amount ?? 0, "field_loan_amount", 0),
      rate_pct: Rules.number(data, loan.rate_pct ?? 0, "field_rate", 0, 100),
      term_months: Math.round(Rules.number(data, loan.term_months, "field_term", 1, 1200)),
      first_payment_date: date(loan.first_payment_date, "field_first_payment"),
      bank_payment: bank || null,
      prepayment_fee_pct: Rules.number(data, loan.prepayment_fee_pct ?? 0, "field_prepayment_fee", 0, 100),
      default_mode: loan.default_mode,
    };
    Object.assign(data.house, h);
    Object.assign(data.mortgage, m);
  }

  return {
    MODES, MortgageError, annuity, impliedRate, firstPaymentDate, initialPayment, run, state,
    report, yearlyPrepayments, prepaymentBreakEvenMonths, nextPaymentEvent, save,
  };
})();
