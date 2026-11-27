// scripts/Buckets.jsx
//
// Buckets: each one's share of its category vs the plan with the editor of those
// shares, and each instrument vs its target inside a bucket with the editor of
// those targets.

/** The names of a category's buckets, in their order. */
const bucketsOf = (data, category) =>
  Object.keys(data.buckets).filter(b => data.buckets[b].category === category);

/** A total of percentages as text: "100%", "73,68%". */
const totalText = (data, sum) => Buckets.sumList(data, [{ name: "", sum }]).trim();

/**
 * Each bucket's share of the category vs its planned share.
 * @param {{app:object, positions:object[], category:string, title:string, footer?:Element}} props
 *   `footer` goes under the chart, inside the panel
 */
const BucketShares = ({ app, positions, category, title, footer }) => {
  const { data, T } = app;
  const names = bucketsOf(data, category);
  const values = names.map(b => positions.filter(p => p.bucket === b).reduce((a, p) => a + p.value_eur, 0));
  const total = values.reduce((a, b) => a + b, 0);
  const planned = names.map(b => Number(data.buckets[b].target_pct_in_category || 0));
  const sum = planned.reduce((a, b) => a + b, 0) || 1;
  return (
    <Panel title={title} icon="pie_chart">
      <stack gap="md">
        {names.length
          ? <TargetBars lang={app.L} currentName={T("legend_current")} targetName={T("legend_target")}
            total={total} rows={names.map((b, i) => ({
              label: b, value: total ? values[i] / total * 100 : 0, target: planned[i] / sum * 100, cls: catCls(category),
            }))} />
          : <Empty icon="shopping_basket" description={T("bucket_empty")} />}
        {footer || null}
      </stack>
    </Panel>
  );
};

/**
 * One bucket: its instruments vs their targets, or, where none has a target,
 * just what it is made of.
 * @param {{app:object, positions:object[], bucket:string, footer?:Element}} props
 *   `footer` goes under the chart, inside the panel
 */
const BucketPanel = ({ app, positions, bucket, footer }) => {
  const { data, T } = app;
  const all = positions.filter(p => p.bucket === bucket);
  const targeted = all.filter(p => Number(p.target_in_bucket || 0) > 0);
  const members = targeted.length ? targeted : all.filter(p => p.value_eur > 0);
  const total = members.reduce((a, p) => a + p.value_eur, 0);
  const tsum = targeted.reduce((a, p) => a + Number(p.target_in_bucket), 0);
  const cls = catCls(data.buckets[bucket].category);
  return (
    <Panel title={targeted.length ? T("chart_bucket", { bucket }) : T("chart_bucket_composition", { bucket })}
      icon="balance">
      <stack gap="md">
        {members.length
          ? <TargetBars lang={app.L} currentName={T("legend_current")} targetName={T("legend_target")}
            total={total} rows={members.map(p => ({
              label: p.name, value: total ? p.value_eur / total * 100 : 0,
              target: targeted.length ? Number(p.target_in_bucket) / tsum * 100 : null, cls,
            }))} />
          : <Empty icon="shopping_basket" description={T("bucket_empty")} />}
        {footer || null}
      </stack>
    </Panel>
  );
};

/**
 * The share of each instrument inside one bucket. Saving is possible only when
 * they add up to 100%, or are all 0%: then the instrument is picked by hand.
 * @param {object} app
 * @param {string} bucket
 * @returns {Element|null} null for a bucket without instruments
 */
function targetEditor(app, bucket) {
  const { data, T, money } = app;
  const members = Valuation.positions(data).filter(p => p.bucket === bucket && !Instruments.soldOut(data, p));
  if(!members.length) return null;
  const grid = (
    <EditGrid rows={members.map(p => ({
      id: p.id, name: p.name, value: p.value_eur, target: Number(p.target_in_bucket || 0),
    }))} columns={[
      { key: "name", label: T("col_name"), type: "readonly" },
      { key: "value", label: T("col_value_eur"), type: "readonly", align: "right", fmt: (v) => money(v, 2) },
      { key: "target", label: T("col_target_in_bucket"), type: "number", min: 0, max: 100, width: "6rem" },
    ]} />
  );
  const drafted = (rows) => rows.map(r => ({ bucket, target_in_bucket: Number(r.target || 0) }));
  const adds = (rows) => !Buckets.badTargets(data.buckets, drafted(rows), [bucket]).length;
  const save = (
    <Button variant="primary" icon="save" onClick={() => {
      const targets = Object.fromEntries(grid.rows.map(r => [r.id, r.target]));
      try { Buckets.saveTargets(data, bucket, targets); }
      catch(e) {
        if(!(e instanceof Rules.RuleError)) throw e;
        Alert.err(T(e.key, e.vars));
        return;
      }
      app.commit(T("flash_targets_saved", { bucket }));
    }}>{T("btn_save_targets")}</Button>
  );
  const total = liveNote(grid, (rows) => {
    save.disabled = !adds(rows);
    if(rows.every(r => !Number(r.target || 0))) return T("targets_none");
    const sum = totalText(data, Buckets.targetSum(drafted(rows), bucket));
    return save.disabled ? T("targets_wrong", { sum }) : T("sum_ok", { sum });
  });
  // fills the fields only: nothing changes until it is saved
  const clear = (
    <Button variant="ghost" icon="restart_alt" onClick={() => {
      for(const input of grid.querySelectorAll("input[type=number]")) {
        input.value = 0;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }}>{T("btn_clear_targets")}</Button>
  );
  return <stack gap="sm"><strong>{T("targets_title")}</strong>{grid}{total}<row gap="sm">{save}{clear}</row></stack>;
}

/**
 * The editor of a category's buckets: names and shares in a table, and the form
 * adding one (a new bucket starts at 0%). It stands under the shares chart.
 * @param {object} app
 * @param {string} category
 * @returns {Element}
 */
function bucketEditor(app, category) {
  const { data, T, money } = app;
  const pos = Valuation.positions(data);
  const rows = () => bucketsOf(data, category).map(b => {
    const members = pos.filter(p => p.bucket === b && !Instruments.soldOut(data, p));
    return {
      old: b, name: b, share: Number(data.buckets[b].target_pct_in_category || 0),
      count: members.length,
      value: members.reduce((a, p) => a + p.value_eur, 0), delete: false,
    };
  });
  function save(list, message) {
    try { Buckets.save(data, category, list); }
    catch(e) {
      if(!(e instanceof Rules.RuleError)) throw e;
      Alert.err(T(e.key, e.vars));
      return;
    }
    app.commit(message);
  }

  const grid = (
    <EditGrid rows={rows()} columns={[
      { key: "name", label: T("col_bucket"), width: "11rem" },
      { key: "share", label: T("col_share_pct"), type: "number", min: 0, max: 100, width: "6rem" },
      { key: "count", label: T("col_instrument_count"), type: "readonly", align: "right" },
      { key: "value", label: T("col_value_eur"), type: "readonly", align: "right", fmt: (v) => money(v, 2) },
      { key: "delete", label: T("col_delete"), type: "check" },
    ]} />
  );
  const saveTable = (
    <Button variant="primary" icon="save"
      onClick={() => save(grid.rows, T("flash_buckets_saved"))}>{T("btn_save_buckets")}</Button>
  );
  const total = liveNote(grid, (list) => {
    const kept = list.filter(r => !r.delete);
    const value = kept.reduce((a, r) => a + Number(r.share || 0), 0);
    // the rule the save holds the shares to
    saveTable.disabled = !!Buckets.badShares(kept.map(r => ({ category, target_pct_in_category: r.share }))).length;
    const sum = totalText(data, value);
    return saveTable.disabled ? T("sum_wrong", { sum }) : T("sum_ok", { sum });
  });
  const f = { name: <Input /> };
  const add = (
    <Expander title={T("add_bucket_title")} icon="add_circle">
      <stack gap="sm">
        {formRow(T("col_name"), f.name)}
        <row><Button variant="primary" icon="add" onClick={() => {
          const name = f.name.value.trim();
          if(!name) { Alert.wrn(T("err_bucket_name")); return; }
          save([...rows(), { old: null, name, share: 0 }], T("flash_bucket_added", { name }));
        }}>{T("btn_add")}</Button></row>
      </stack>
    </Expander>
  );
  return (
    <stack gap="sm">
      <strong>{T("buckets_title")}</strong>
      {grid}
      {total}
      <row>{saveTable}</row>
      {add}
    </stack>
  );
}
