// scripts/Mortgage.jsx
//
// Home and mortgage: parameters, booking payments, prepayments with a preview of
// their effect, the schedule charts and a yearly-prepayment simulator. Every change
// of the loan and every number of it comes from `Mortgage`.

const MortgageView = (app) => {
  const { data, T, money } = app;
  const h = data.house;
  const m = data.mortgage;
  const deed = Dates.parse(h.deed_date);
  const modeOptions = Mortgage.MODES.map(x => [x, Texts.modeLabel(data, x)]);
  const out = [];

  if(!deed) out.push(<Note level="info">{T("mortgage_planning_mode")}</Note>);
  if(!Number(m.amount)) out.push(<Note level="info">{T("mortgage_enter_amount")}</Note>);

  let report = null;
  try { report = Mortgage.report(m); }
  catch(e) {
    if(e instanceof Rules.RuleError) out.push(<Note level="err">{T(e.key, e.vars)}</Note>);
    else throw e;
  }
  const info = report?.info;

  /** Makes a change of the loan and commits it; a refusal is shown and nothing changes. */
  function change(make, message) {
    try { make(); }
    catch(e) {
      if(!(e instanceof Rules.RuleError)) throw e;
      const say = e.key.startsWith("warn_") ? Alert.wrn : Alert.err;
      say(T(e.key, e.vars));
      return;
    }
    app.commit(message);
  }

  // ---------------------------------------------------------- headline numbers
  if(info && Number(m.amount)) {
    out.push(
      <div class="metrics">
        <Metric label={T("mortgage_balance")} value={money(info.balance)} />
        <Metric label={T("current_payment")} value={money(info.payment, 2)} />
        <Metric label={T("payments_made")} value={String(info.paid_count)} />
        <Metric label={T("end_forecast")} value={Dates.monthYear(info.end_date)}
          help={T("end_without_prepayments", { date: Dates.monthYear(info.baseline_end) })} />
        <Metric label={T("future_interest")} value={money(info.future_interest)} />
        <Metric label={T("prepayment_gain")} value={money(info.net_saved)}
          help={T("prepayment_gain_help", { saved: money(info.interest_saved), fees: money(info.total_fees) })} />
      </div>
    );
  }

  // ---------------------------------------------------------- parameters
  const p = {
    purchase: <NumberInput value={Number(h.purchase_price)} min="0" step="1000" />,
    value: <NumberInput value={Number(h.value)} min="0" step="1000" title={T("field_house_value_help")} />,
    deposit: <NumberInput value={Number(h.deposit_paid)} min="0" step="500" />,
    signed: <Checkbox checked={!!deed} label={T("field_deed_signed")} />,
    deedDate: <DatePicker format="%Y-%m-%d" value={deed || Dates.today()} />,
    amount: <NumberInput value={Number(m.amount)} min="0" step="500" onChange={() => implied()} />,
    rate: <NumberInput value={Number(m.rate_pct)} min="0" step="0.001" />,
    term: <NumberInput value={Number(m.term_months)} min="1" step="12" onChange={() => implied()} />,
    first: <DatePicker format="%Y-%m-%d" value={Mortgage.firstPaymentDate(m)} />,
    bank: <NumberInput value={Number(m.bank_payment || 0)} min="0" step="0.01" onChange={() => implied()} />,
    fee: <NumberInput value={Number(m.prepayment_fee_pct)} min="0" step="0.01" />,
    mode: <Select value={m.default_mode || "reduce_term"}>{options(modeOptions)}</Select>,
  };
  const impliedNote = <small tone="note"></small>;
  function implied() {
    const pay = p.bank.value, amt = p.amount.value, term = p.term.value;
    impliedNote.textContent = pay && amt && term
      ? T("implied_rate", { payment: money(pay, 2), rate: I18N.number(app.L, Mortgage.impliedRate(amt, pay, term), 2) }) : "";
  }
  implied();
  out.push(
    <Expander title={T("mortgage_params_title")} icon="tune" open={!deed}>
      <stack gap="sm">
        {formRow(T("field_purchase_price"), p.purchase)}
        {formRow(T("field_house_value"), p.value)}
        {formNote(<small tone="note">{T("field_house_value_help")}</small>)}
        {formRow(T("field_deposit"), p.deposit)}
        {formRow(T("field_deed_date"), p.signed, p.deedDate)}
        <sep />
        {formRow(T("field_loan_amount"), p.amount)}
        {formRow(T("field_rate"), p.rate)}
        {formRow(T("field_term"), p.term)}
        {formRow(T("field_first_payment"), p.first)}
        {formRow(T("field_bank_payment"), p.bank)}
        {formNote(impliedNote)}
        {formRow(T("field_prepayment_fee"), p.fee)}
        {formRow(T("field_default_mode"), p.mode)}
        <row><Button variant="primary" icon="save" onClick={() => {
          try {
            Mortgage.save(data, {
              purchase_price: p.purchase.value, value: p.value.value, deposit_paid: p.deposit.value,
              deed_date: p.signed.checked ? (p.deedDate.value || Dates.today()) : null,
            }, {
              amount: p.amount.value, rate_pct: p.rate.value, term_months: p.term.value,
              first_payment_date: p.first.value || null, bank_payment: p.bank.value,
              prepayment_fee_pct: p.fee.value, default_mode: p.mode.value,
            });
          }
          catch(e) {
            if(!(e instanceof Rules.RuleError)) throw e;
            Alert.err(T(e.key, e.vars));
            return;
          }
          app.commit(T("flash_params_saved"));
        }}>{T("btn_save_params")}</Button></row>
      </stack>
    </Expander>
  );

  if(!info || !Number(m.amount)) return <stack gap="md">{out}</stack>;

  // ---------------------------------------------------------- payments
  const next = Mortgage.nextPaymentEvent(m);
  const s1 = {
    date: <DatePicker format="%Y-%m-%d" value={next.date} />,
    amount: <NumberInput value={next.amount} step="0.01" />,
    interest: <NumberInput value={next.interest} step="0.01" />,
    principal: <NumberInput value={next.principal} step="0.01" />,
  };
  out.push(
    <Panel title={T("payments_title")} icon="event_repeat">
      <stack gap="sm">
        <row gap="sm" align="center" justify="between">
          <span>{UI.markup(T("next_payment", {
            date: Dates.dayMonthYear(next.date), amount: money(next.amount, 2),
            interest: money(next.interest, 2), principal: money(next.principal, 2),
          }))}</span>
          <Button variant="primary" icon="check" disabled={Mortgage.paidOff(m)}
            onClick={() => change(() => Mortgage.bookPayment(data), T("flash_payment_booked"))}>{T("btn_book_payment")}</Button>
        </row>
        <Expander title={T("book_from_statement_title")} icon="receipt">
          <stack gap="sm">
            {formRow(T("field_date"), s1.date)}
            {formRow(T("field_payment_eur"), s1.amount)}
            {formRow(T("field_interest_part"), s1.interest)}
            {formRow(T("field_principal_part"), s1.principal)}
            <row><Button icon="check" onClick={() => change(() => Mortgage.bookStatement(data, {
              date: s1.date.value, amount: s1.amount.value, interest: s1.interest.value, principal: s1.principal.value,
            }), T("flash_payment_booked"))}>{T("btn_book")}</Button></row>
          </stack>
        </Expander>
      </stack>
    </Panel>
  );

  // ---------------------------------------------------------- prepayment
  const pot = Cash.account(data, "prepay");
  const pp = {
    amount: <NumberInput value={1000} min="0" step="100" onChange={() => preview()} />,
    date: <DatePicker format="%Y-%m-%d" value={Dates.today()} onChange={() => preview()} />,
    fee: <NumberInput value={Number(m.prepayment_fee_pct)} min="0" step="0.01" onChange={() => preview()} />,
    mode: <Toggle value={m.default_mode || "reduce_term"} onChange={() => preview()}>
      {modeOptions.map(([v, label]) => <ToggleBtn value={v} label={label} />)}
    </Toggle>,
    fromPot: <Checkbox label={pot ? T("take_from_pot", { amount: money(pot.amount) }) : T("take_from_pot_none")}
      checked={!!pot && pot.amount >= 1000} disabled={!pot} />,
  };
  const effect = <span></span>;
  /** The fields of the prepayment form, as `Mortgage` takes them. */
  const prepayment = () => ({ amount: pp.amount.value, date: pp.date.value, feePct: pp.fee.value, mode: pp.mode.value });
  function preview() {
    const mode = pp.mode.value;
    const gain = Mortgage.prepaymentEffect(data, prepayment());
    if(!gain) { effect.textContent = ""; return; }
    const what = mode === "reduce_term"
      ? T("effect_term", { new: Dates.monthYear(gain.end_date), old: Dates.monthYear(gain.old_end_date) })
      : T("effect_payment", { new: money(gain.payment, 2), old: money(gain.old_payment, 2) });
    effect.replaceChildren(...UI.markup(T("prepayment_effect", { effect: what, saved: money(gain.saved), fee: money(gain.fee, 2), net: money(gain.net) })));
  }
  preview();
  out.push(
    <Panel title={T("prepayment_title")} icon="trending_down">
      <stack gap="sm">
        {formRow(T("field_prepayment_amount"), pp.amount)}
        {formRow(T("field_date"), pp.date)}
        {formRow(T("field_fee_pct"), pp.fee)}
        {formRow(T("field_mode"), pp.mode)}
        {formNote(effect)}
        {formRow("", pp.fromPot)}
        <row><Button variant="primary" icon="check" onClick={() => {
          const form = { ...prepayment(), fromPot: pp.fromPot.checked };
          change(() => Mortgage.bookPrepayment(data, form), T("flash_prepayment_booked", { amount: money(form.amount) }));
        }}>{T("btn_book_prepayment")}</Button></row>
      </stack>
    </Panel>
  );

  // ---------------------------------------------------------- recorded events
  if(m.events.length) {
    const grid = (
      <EditGrid rows={[...m.events].sort((a, b) => b.date.localeCompare(a.date)).map(e => ({ ...e, delete: false }))} columns={[
        { key: "date", label: T("field_date"), type: "readonly", fmt: Dates.dayMonthYear },
        { key: "type", label: T("field_type"), type: "readonly", fmt: (v) => T(v === "payment" ? "event_payment" : "event_prepayment") },
        { key: "amount", label: T("col_amount_eur"), type: "readonly", align: "right", fmt: (v) => money(v, 2) },
        { key: "interest", label: T("field_interest_part"), type: "readonly", align: "right", fmt: (v) => v == null ? "" : money(v, 2) },
        { key: "principal", label: T("field_principal_part"), type: "readonly", align: "right", fmt: (v) => v == null ? "" : money(v, 2) },
        { key: "fee_pct", label: T("field_fee_pct"), type: "readonly", align: "right", fmt: (v) => v == null ? "" : I18N.percent(app.L, v, 2) },
        { key: "mode", label: T("field_mode"), type: "readonly", fmt: (v) => v ? Texts.modeLabel(data, v) : "" },
        { key: "delete", label: T("col_delete"), type: "check" },
      ]} />
    );
    out.push(
      <Expander title={T("events_title", { count: m.events.length })} icon="list">
        <stack gap="sm">
          {grid}
          <row><Button variant="danger" icon="delete" onClick={() => {
            const gone = new Set(grid.rows.filter(r => r.delete).map(r => r.id));
            if(!gone.size) return;
            change(() => Mortgage.deleteEvents(data, gone), T("flash_events_deleted", { count: gone.size }));
          }}>{T("btn_delete_events")}</Button></row>
        </stack>
      </Expander>
    );
  }

  // ---------------------------------------------------------- charts
  const pays = report.rows.filter(r => r.kind.startsWith("payment"));
  const years = Mortgage.yearlyTotals(report.rows);
  out.push(
    <row gap="md" align="stretch">
      <Panel title={T("chart_balance")} icon="show_chart" flex="1">
        <LineChart lang={app.L} marker={Dates.today()} series={[
          { name: T("legend_no_prepayments"), cls: "cn", dash: true, points: report.baseRows.map(r => [r.date, r.balance]) },
          { name: T("legend_your_mortgage"), cls: "c1", points: pays.map(r => [r.date, r.balance]) },
        ]} />
      </Panel>
      <Panel title={T("chart_yearly")} icon="bar_chart" flex="1">
        <StackedBars lang={app.L} xs={years.map(y => y.year)} series={[
          { name: T("legend_principal"), cls: "c1", values: years.map(y => y.principal) },
          { name: T("legend_interest"), cls: "c2", values: years.map(y => y.interest) },
        ]} />
      </Panel>
    </row>
  );

  // ---------------------------------------------------------- simulator
  const sim = {
    amount: <NumberInput value={3000} min="0" step="500" onChange={() => simulate()} />,
    start: <DatePicker format="%Y-%m-%d" value={Dates.addMonths(Mortgage.firstPaymentDate(m), 11)} onChange={() => simulate()} />,
    fee: <NumberInput value={Number(m.prepayment_fee_pct)} min="0" step="0.01" onChange={() => simulate()} />,
  };
  const simOut = <stack gap="sm"></stack>;
  function simulate() {
    const amt = sim.amount.value || 0;
    const start = sim.start.value || Dates.today();
    if(amt <= 0) { simOut.replaceChildren(); return; }
    const rows = [[T("sim_no_prepayments"), Dates.monthYear(info.baseline_end), money(Mortgage.initialPayment(m), 2),
      money(0), money(info.baseline_interest), money(0), money(0), money(0)]];
    const curves = [];
    for(const [mode, cls] of [["reduce_term", "c1"], ["reduce_payment", "c2"]]) {
      const r = Mortgage.report(m, Mortgage.yearlyPrepayments(start, amt, mode, sim.fee.value || 0));
      rows.push([Texts.modeLabel(data, mode), Dates.monthYear(r.info.end_date), money(Mortgage.paymentOn(r.rows, Dates.addMonths(start, 48)), 2),
        money(r.info.total_prepaid), money(r.info.total_interest), money(r.info.interest_saved), money(r.info.total_fees), money(r.info.net_saved)]);
      curves.push({ name: Texts.modeLabel(data, mode), cls, points: r.rows.filter(x => x.kind.startsWith("payment")).map(x => [x.date, x.balance]) });
    }
    const be = Mortgage.prepaymentBreakEvenMonths(m);
    simOut.replaceChildren(
      <Table columns={[T("sim_col_variant"), T("sim_col_end"), T("sim_col_payment5"), T("sim_col_prepaid"),
        T("sim_col_interest"), T("sim_col_saved"), T("sim_col_fees"), T("sim_col_net")]} rows={rows} />,
      <strong>{T("chart_sim", { amount: money(amt) })}</strong>,
      <LineChart lang={app.L} series={[
        { name: T("legend_no_prepayments"), cls: "cn", dash: true, points: report.baseRows.map(r => [r.date, r.balance]) },
        ...curves,
      ]} />,
      be ? <small tone="note">{T("sim_caption", { fee: I18N.number(app.L, m.prepayment_fee_pct, 2), months: I18N.number(app.L, be, 1) })}</small> : null,
    );
  }
  simulate();
  out.push(
    <Panel title={T("sim_title")} icon="science">
      <stack gap="sm">
        {formRow(T("sim_amount"), sim.amount)}
        {formRow(T("sim_first"), sim.start)}
        {formRow(T("field_fee_pct"), sim.fee)}
        {simOut}
      </stack>
    </Panel>
  );

  return <stack gap="md">{out}</stack>;
};
