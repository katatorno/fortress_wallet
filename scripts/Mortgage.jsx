// scripts/Mortgage.jsx
//
// Home and mortgage: parameters, booking payments, prepayments with a preview of
// their effect, the schedule charts and a yearly-prepayment simulator.

const MortgageView = (app) => {
  const { data, T, money } = app;
  const h = data.house;
  const m = data.mortgage;
  const deed = Core.parseDate(h.deed_date);
  const modeOptions = Core.MODES.map(x => [x, Core.modeLabel(data, x)]);
  const out = [];

  if(!deed) out.push(<Note level="info">{T("mortgage_planning_mode")}</Note>);
  if(!Number(m.amount)) out.push(<Note level="info">{T("mortgage_enter_amount")}</Note>);

  let report = null;
  try { report = Core.mortgageReport(m); }
  catch(e) {
    if(e instanceof Core.MortgageError) out.push(<Note level="err">{T(e.key)}</Note>);
    else throw e;
  }
  const info = report?.info;

  // ---------------------------------------------------------- headline numbers
  if(info && Number(m.amount)) {
    out.push(
      <div class="metrics">
        <Metric label={T("mortgage_balance")} value={money(info.balance)} />
        <Metric label={T("current_payment")} value={money(info.payment, 2)} />
        <Metric label={T("payments_made")} value={String(info.paid_count)} />
        <Metric label={T("end_forecast")} value={Core.monthYear(info.end_date)}
          help={T("end_without_prepayments", { date: Core.monthYear(info.baseline_end) })} />
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
    deedDate: <DatePicker format="%Y-%m-%d" value={deed || Core.today()} />,
    amount: <NumberInput value={Number(m.amount)} min="0" step="500" onChange={() => implied()} />,
    rate: <NumberInput value={Number(m.rate_pct)} min="0" step="0.001" />,
    term: <NumberInput value={Number(m.term_months)} min="1" step="12" onChange={() => implied()} />,
    first: <DatePicker format="%Y-%m-%d" value={Core.firstPaymentDate(m)} />,
    bank: <NumberInput value={Number(m.bank_payment || 0)} min="0" step="0.01" onChange={() => implied()} />,
    fee: <NumberInput value={Number(m.prepayment_fee_pct)} min="0" step="0.01" />,
    mode: <Select value={m.default_mode || "reduce_term"}>{options(modeOptions)}</Select>,
  };
  const impliedNote = <small tone="note"></small>;
  function implied() {
    const pay = p.bank.value, amt = p.amount.value, term = p.term.value;
    impliedNote.textContent = pay && amt && term
      ? T("implied_rate", { payment: money(pay, 2), rate: I18N.number(app.L, Core.impliedRate(amt, pay, term), 2) }) : "";
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
            Core.saveMortgage(data, {
              purchase_price: p.purchase.value, value: p.value.value, deposit_paid: p.deposit.value,
              deed_date: p.signed.checked ? (p.deedDate.value || Core.today()) : null,
            }, {
              amount: p.amount.value, rate_pct: p.rate.value, term_months: p.term.value,
              first_payment_date: p.first.value || null, bank_payment: p.bank.value,
              prepayment_fee_pct: p.fee.value, default_mode: p.mode.value,
            });
          }
          catch(e) {
            if(!(e instanceof Core.RuleError)) throw e;
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
  const next = Core.nextPaymentEvent(m);
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
            date: Core.dayMonthYear(next.date), amount: money(next.amount, 2),
            interest: money(next.interest, 2), principal: money(next.principal, 2),
          }))}</span>
          <Button variant="primary" icon="check" disabled={info.balance <= 0} onClick={() => {
            m.events.push(next);
            app.commit(T("flash_payment_booked"));
          }}>{T("btn_book_payment")}</Button>
        </row>
        <Expander title={T("book_from_statement_title")} icon="receipt">
          <stack gap="sm">
            {formRow(T("field_date"), s1.date)}
            {formRow(T("field_payment_eur"), s1.amount)}
            {formRow(T("field_interest_part"), s1.interest)}
            {formRow(T("field_principal_part"), s1.principal)}
            <row><Button icon="check" onClick={() => {
              m.events.push({ id: Core.newId(), date: s1.date.value || next.date, type: "payment",
                amount: s1.amount.value || 0, interest: s1.interest.value || 0, principal: s1.principal.value || 0,
                note: T("note_from_statement") });
              app.commit(T("flash_payment_booked"));
            }}>{T("btn_book")}</Button></row>
          </stack>
        </Expander>
      </stack>
    </Panel>
  );

  // ---------------------------------------------------------- prepayment
  const pot = Core.cashAccount(data, "prepay");
  const pp = {
    amount: <NumberInput value={1000} min="0" step="100" onChange={() => preview()} />,
    date: <DatePicker format="%Y-%m-%d" value={Core.today()} onChange={() => preview()} />,
    fee: <NumberInput value={Number(m.prepayment_fee_pct)} min="0" step="0.01" onChange={() => preview()} />,
    mode: <Toggle value={m.default_mode || "reduce_term"} onChange={() => preview()}>
      {modeOptions.map(([v, label]) => <ToggleBtn value={v} label={label} />)}
    </Toggle>,
    fromPot: <Checkbox label={pot ? T("take_from_pot", { amount: money(pot.amount) }) : T("take_from_pot_none")}
      checked={!!pot && pot.amount >= 1000} disabled={!pot} />,
  };
  const effect = <span></span>;
  function preview() {
    const amt = pp.amount.value || 0;
    if(amt <= 0) { effect.textContent = ""; return; }
    const ev = { id: "preview", date: pp.date.value || Core.today(), type: "prepayment", amount: amt, fee_pct: pp.fee.value || 0, mode: pp.mode.value };
    const after = Core.mortgageReport({ ...m, events: [...m.events, ev] }).info;
    const saved = info.future_interest - after.future_interest;
    const feeEur = amt * (pp.fee.value || 0) / 100;
    const what = pp.mode.value === "reduce_term"
      ? T("effect_term", { new: Core.monthYear(after.end_date), old: Core.monthYear(info.end_date) })
      : T("effect_payment", { new: money(after.payment, 2), old: money(info.payment, 2) });
    effect.replaceChildren(...UI.markup(T("prepayment_effect", { effect: what, saved: money(saved), fee: money(feeEur, 2), net: money(saved - feeEur) })));
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
          const amt = pp.amount.value || 0;
          if(amt <= 0) return;
          const feePct = pp.fee.value || 0;
          const cost = amt * (1 + feePct / 100);
          if(pp.fromPot.checked && pot && pot.amount + 1e-9 < cost) {
            Alert.wrn(T("warn_pot_too_small", { pot: money(pot.amount, 2), cost: money(cost, 2) }));
            return;
          }
          const date = pp.date.value || Core.today();
          m.events.push({ id: Core.newId(), date, type: "prepayment", amount: amt, fee_pct: feePct, mode: pp.mode.value, note: "" });
          if(pp.fromPot.checked && pot) Core.addCash(data, pot.id, -cost, T("note_prepayment_with_fee"), date);
          app.commit(T("flash_prepayment_booked", { amount: money(amt) }));
        }}>{T("btn_book_prepayment")}</Button></row>
      </stack>
    </Panel>
  );

  // ---------------------------------------------------------- recorded events
  if(m.events.length) {
    const grid = (
      <EditGrid rows={[...m.events].sort((a, b) => b.date.localeCompare(a.date)).map(e => ({ ...e, delete: false }))} columns={[
        { key: "date", label: T("field_date"), type: "readonly", fmt: Core.dayMonthYear },
        { key: "type", label: T("field_type"), type: "readonly", fmt: (v) => T(v === "payment" ? "event_payment" : "event_prepayment") },
        { key: "amount", label: T("col_amount_eur"), type: "readonly", align: "right", fmt: (v) => money(v, 2) },
        { key: "interest", label: T("field_interest_part"), type: "readonly", align: "right", fmt: (v) => v == null ? "" : money(v, 2) },
        { key: "principal", label: T("field_principal_part"), type: "readonly", align: "right", fmt: (v) => v == null ? "" : money(v, 2) },
        { key: "fee_pct", label: T("field_fee_pct"), type: "readonly", align: "right", fmt: (v) => v == null ? "" : I18N.percent(app.L, v, 2) },
        { key: "mode", label: T("field_mode"), type: "readonly", fmt: (v) => v ? Core.modeLabel(data, v) : "" },
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
            m.events = m.events.filter(e => !gone.has(e.id));
            app.commit(T("flash_events_deleted", { count: gone.size }));
          }}>{T("btn_delete_events")}</Button></row>
        </stack>
      </Expander>
    );
  }

  // ---------------------------------------------------------- charts
  const pays = report.rows.filter(r => r.kind.startsWith("payment"));
  const years = {};
  for(const r of report.rows) {
    const y = r.date.slice(0, 4);
    years[y] ??= { interest: 0, principal: 0 };
    years[y].interest += r.interest;
    years[y].principal += r.principal + r.prepayment;
  }
  const yearKeys = Object.keys(years).sort();
  out.push(
    <row gap="md" align="stretch">
      <Panel title={T("chart_balance")} icon="show_chart" flex="1">
        <LineChart lang={app.L} marker={Core.today()} series={[
          { name: T("legend_no_prepayments"), cls: "cn", dash: true, points: report.baseRows.map(r => [r.date, r.balance]) },
          { name: T("legend_your_mortgage"), cls: "c1", points: pays.map(r => [r.date, r.balance]) },
        ]} />
      </Panel>
      <Panel title={T("chart_yearly")} icon="bar_chart" flex="1">
        <StackedBars lang={app.L} xs={yearKeys} series={[
          { name: T("legend_principal"), cls: "c1", values: yearKeys.map(y => years[y].principal) },
          { name: T("legend_interest"), cls: "c2", values: yearKeys.map(y => years[y].interest) },
        ]} />
      </Panel>
    </row>
  );

  // ---------------------------------------------------------- simulator
  const sim = {
    amount: <NumberInput value={3000} min="0" step="500" onChange={() => simulate()} />,
    start: <DatePicker format="%Y-%m-%d" value={Core.addMonths(Core.firstPaymentDate(m), 11)} onChange={() => simulate()} />,
    fee: <NumberInput value={Number(m.prepayment_fee_pct)} min="0" step="0.01" onChange={() => simulate()} />,
  };
  const simOut = <stack gap="sm"></stack>;
  function paymentAt(rows, when) {
    const list = rows.filter(r => r.kind.startsWith("payment"));
    for(const r of list.slice(0, -1)) if(r.date >= when) return r.payment;
    return list.length ? list[list.length - 1].payment : 0;
  }
  function simulate() {
    const amt = sim.amount.value || 0;
    const start = sim.start.value || Core.today();
    if(amt <= 0) { simOut.replaceChildren(); return; }
    const rows = [[T("sim_no_prepayments"), Core.monthYear(info.baseline_end), money(Core.initialPayment(m), 2),
      money(0), money(info.baseline_interest), money(0), money(0), money(0)]];
    const curves = [];
    for(const [mode, cls] of [["reduce_term", "c1"], ["reduce_payment", "c2"]]) {
      const r = Core.mortgageReport(m, Core.yearlyPrepayments(start, amt, mode, sim.fee.value || 0));
      rows.push([Core.modeLabel(data, mode), Core.monthYear(r.info.end_date), money(paymentAt(r.rows, Core.addMonths(start, 48)), 2),
        money(r.info.total_prepaid), money(r.info.total_interest), money(r.info.interest_saved), money(r.info.total_fees), money(r.info.net_saved)]);
      curves.push({ name: Core.modeLabel(data, mode), cls, points: r.rows.filter(x => x.kind.startsWith("payment")).map(x => [x.date, x.balance]) });
    }
    const be = Core.prepaymentBreakEvenMonths(m);
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
