// scripts/Widgets.jsx
//
// Small building blocks shared by the views: a headline number, an editable
// table, a collapsible section and a coloured note.

/** Category id → chart colour class (fixed order: blue, orange, aqua). */
const CAT_CLS = { equities: "c1", metals: "c2", bonds: "c3" };
const catCls = (c) => CAT_CLS[c] || "cn";

/** One headline number. */
const Metric = ({ label, value, help }) => (
  <Panel compact class="metric">
    <stack gap="xs">
      <small tone="meta">{label}{help ? <Icon name="info" size="sm" title={help} /> : null}</small>
      <strong class="metric-value">{value}</strong>
    </stack>
  </Panel>
);

/** Collapsible section (native <details>). */
const Expander = ({ title, icon, open, children }) => {
  const el = (
    <details class="expander">
      <summary><inline gap="xs">{icon ? <Icon name={icon} /> : null}<span>{title}</span></inline></summary>
      <div class="expander-body">{children}</div>
    </details>
  );
  el.open = !!open;
  return el;
};

/** A hint in the colour of its level: warn / info / ok. */
const Note = ({ level = "info", title, children }) => {
  const color = { warn: "wrn", info: "inf", ok: "ok", err: "err" }[level] || "inf";
  const icon = { warn: "warning", info: "info", ok: "check_circle", err: "error" }[level] || "info";
  return (
    <Panel inline stripe color={color} icon={icon} class="note">
      <stack gap="xs">
        {title ? <strong>{title}</strong> : null}
        {children ? <span>{children}</span> : null}
      </stack>
    </Panel>
  );
};

/**
 * Editable table. Each row is edited as a draft copy; read the result from `.rows`.
 * Column types: text | number | select | check | readonly.
 *
 * @param {object} props
 * @param {Array<{key:string, label:string, type?:string, options?:Array<[string,string]>,
 *   step?:string, fmt?:(v:any, row:object)=>string, width?:string, help?:string}>} props.columns
 * @param {object[]} props.rows
 * @param {() => object} [props.newRow]  when given, an "add row" button appends one
 * @param {string} [props.addLabel]
 */
const EditGrid = ({ columns, rows, newRow, addLabel = "+" }) => {
  const drafts = rows.map(r => ({ ...r }));
  const body = <tbody></tbody>;

  function cell(col, draft) {
    const v = draft[col.key];
    const type = col.type || "text";
    if(type === "readonly") {
      return <td class="cell-ro" text={col.align}>{col.fmt ? col.fmt(v, draft) : (v ?? "")}</td>;
    }
    if(type === "check") {
      const box = <input type="checkbox" class="cell-check" />;
      box.checked = !!v;
      box.addEventListener("change", () => { draft[col.key] = box.checked; });
      return <td class="cell-center">{box}</td>;
    }
    if(type === "select") {
      const sel = <select class="cell-input">{(col.options || []).map(([value, label]) => <option value={value}>{label}</option>)}</select>;
      sel.value = v ?? "";
      sel.addEventListener("change", () => { draft[col.key] = sel.value; });
      return <td>{sel}</td>;
    }
    const input = <input class={["cell-input", type === "number" && "cell-num"]}
      type={type === "number" ? "number" : "text"} step={col.step || "any"} />;
    input.value = v ?? "";
    if(col.width) input.style.width = col.width;
    input.addEventListener("input", () => {
      draft[col.key] = type === "number" ? (input.value === "" ? null : Number(input.value)) : input.value;
    });
    return <td>{input}</td>;
  }

  function render() {
    body.replaceChildren(...drafts.map(d => <tr>{columns.map(c => cell(c, d))}</tr>));
  }
  render();

  const el = (
    <stack gap="sm">
      <div class="table edit-grid">
        <table>
          <thead><tr>{columns.map(c => <th title={c.help}>{c.label}</th>)}</tr></thead>
          {body}
        </table>
      </div>
      {newRow ? <row><Button size="sm" variant="ghost" icon="add" onClick={() => { drafts.push(newRow()); render(); }}>{addLabel}</Button></row> : null}
    </stack>
  );
  el.rows = drafts;
  return el;
};

/** `<option>`s from [value, label] pairs. */
const options = (pairs) => pairs.map(([value, label]) => <option value={value}>{label}</option>);

/** A native range slider with its value shown beside it. */
const Slider = ({ min = 0, max = 100, step = 1, value, suffix = "", onChange }) => {
  const input = <input type="range" min={min} max={max} step={step} class="slider" />;
  input.value = value;
  const out = <strong class="slider-value">{value + suffix}</strong>;
  input.addEventListener("input", () => {
    out.textContent = input.value + suffix;
    onChange?.(Number(input.value));
  });
  const el = <inline gap="sm" class="slider-wrap">{input}{out}</inline>;
  Object.defineProperty(el, "value", { get: () => Number(input.value) });
  return el;
};
