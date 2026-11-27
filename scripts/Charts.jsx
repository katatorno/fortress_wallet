// scripts/Charts.jsx
//
// Small charts, no library: horizontal bars with targets (HTML), and in SVG grouped
// and stacked bars, lines with a hover read-out, and a treemap. Colours come from CSS
// classes (`c1` `c2` `c3` for series, `cat-<id>` for categories), so light and dark
// themes both work. Every SVG mark has a native tooltip (<title>); line charts also
// follow the pointer.

const _SVG_W = 640;
const _SVG_NS = "http://www.w3.org/2000/svg";

/** Native SVG tooltip, made in the SVG namespace whatever the JSX runtime does with <title>. */
function svgTip(text) {
  const el = document.createElementNS(_SVG_NS, "title");
  el.textContent = text;
  return el;
}

/**
 * Draws a chart at the real width of its box, so text stays the same size on a phone
 * and on a wide screen; redraws when the box changes width.
 * @param {(width:number) => Element} draw
 */
function responsiveChart(draw) {
  const box = <div class="chart-box"></div>;
  let last = 0;
  function paint(w) {
    w = Math.max(300, Math.round(w || _SVG_W));
    if(Math.abs(w - last) < 8) return;
    last = w;
    box.replaceChildren(draw(w));
  }
  paint(_SVG_W);
  new ResizeObserver((entries) => paint(entries[0].contentRect.width)).observe(box);
  return box;
}

/** Nice upper bound for an axis. */
function _niceMax(v) {
  if(!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for(const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if(m * p >= v) return m * p;
  return 10 * p;
}

/** 123456 → "123k €" for axis labels. */
function _compactMoney(lang, v) {
  const a = Math.abs(v);
  if(a >= 1e6) return I18N.number(lang, v / 1e6, 1) + "M €";
  if(a >= 1e3) return I18N.number(lang, v / 1e3, 0) + "k €";
  return I18N.number(lang, v, 0) + " €";
}

/** Cuts a label to about `px` pixels of 12px text. */
const _fit = (text, px) => {
  const max = Math.max(3, Math.floor(px / 6.6));
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
};

const _ts = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };

/** Legend: a swatch and a name per series; `shape` "bar" | "line" | "dash" | "diamond". */
const ChartLegend = ({ items }) => (
  <row gap="md" class="chart-legend">
    {items.map(it => (
      <inline gap="xs">
        <svg viewBox="0 0 14 14" width="14" height="14" class="chart-swatch">
          {it.shape === "diamond" ? <path d="M7 1 L13 7 L7 13 L1 7 Z" class="chart-target" />
            : it.shape === "line" || it.shape === "dash"
              ? <line x1="1" y1="7" x2="13" y2="7" class={["chart-line", "s-" + it.cls, it.shape === "dash" && "chart-dash"]} />
              : <rect x="1" y="2" width="12" height="10" rx="2" class={it.cls} />}
        </svg>
        <span tone="meta">{it.name}</span>
      </inline>
    ))}
  </row>
);

/**
 * Horizontal bars: the current share drawn over a taller, paler bar for the target,
 * with the numbers written above: share, target, difference and its worth.
 * Plain HTML, so the numbers wrap on a narrow screen.
 * @param {{rows: Array<{label:string, value:number, target:number|null, cls:string}>, total:number,
 *   lang:string, currentName:string, targetName:string}} props
 *   `value` and `target` are percentages of `total` (EUR); a row whose target is
 *   null shows its share and worth only
 */
const TargetBars = ({ rows, total, lang, currentName, targetName }) => {
  const max = Math.max(10, ...rows.map(r => Math.max(r.value, r.target || 0)));
  const planned = rows.some(r => r.target != null);
  const width = (v) => ({ width: v / max * 100 + "%" });
  // one decimal, dropped for whole numbers: 75% but 67.7%
  const share = (v) => I18N.percent(lang, v, Math.round(v * 10) % 10 ? 1 : 0);

  function gap(r) {
    const diff = Math.round((r.value - r.target) * 10) / 10;
    if(!diff) return <span>{I18N.t(lang, "bar_on_target")}</span>;
    const pp = (diff > 0 ? "+" : "−") + I18N.number(lang, Math.abs(diff), 1);
    const eur = (r.value - r.target) / 100 * total;
    const amount = I18N.money(lang, Math.abs(eur));
    return [
      <span>{I18N.t(lang, "bar_diff", { diff: pp })}</span>,
      Math.abs(eur) >= 0.5
        ? <span>{eur > 0 ? I18N.t(lang, "bar_surplus", { amount }) : I18N.t(lang, "bar_missing", { amount })}</span>
        : null,
    ];
  }

  return (
    <stack gap="sm">
      <ChartLegend items={[{ name: currentName, cls: rows[0]?.cls || "c1" },
        ...(planned ? [{ name: targetName, cls: [rows[0]?.cls || "c1", "pale"] }] : [])]} />
      {rows.map(r => (
        <div class="tbar">
          <div class="tbar-head">
            <span class="tbar-label">{r.label}</span>
            <span class="tbar-nums">
              {r.target == null
                ? [<strong>{share(r.value)}</strong>, <span>{I18N.money(lang, r.value / 100 * total)}</span>]
                : [<span><strong>{share(r.value)}</strong> {I18N.t(lang, "bar_of_target", { target: share(r.target) })}</span>, gap(r)]}
            </span>
          </div>
          <div class={["tbar-plot", r.cls]}>
            {r.target == null ? null : <div class="tbar-target" style={width(r.target)}></div>}
            {r.value > 0 ? <div class="tbar-current" style={width(r.value)}></div> : null}
          </div>
        </div>
      ))}
    </stack>
  );
};

/**
 * Vertical grouped bars (e.g. before/after) with optional target diamonds.
 * @param {{cats:string[], series:Array<{name:string, values:number[], cls:string}>,
 *   targets?:number[], targetName?:string, lang:string, suffix?:string}} props
 */
const GroupedBars = (props) => responsiveChart((W) => _GroupedBars(props, W));
const _GroupedBars = ({ cats, series, targets, targetName, lang, suffix = "%" }, W) => {
  const h = 240, left = 44, bottom = 28, top = 10, right = 8;
  const all = series.flatMap(s => s.values).concat(targets || []);
  const max = _niceMax(Math.max(...all, 1));
  const y = (v) => top + (1 - v / max) * (h - top - bottom);
  const groupW = (W - left - right) / cats.length;
  const barW = Math.min(46, (groupW - 24) / series.length);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  const fmt = (v) => suffix === "%" ? I18N.percent(lang, v) : _compactMoney(lang, v);
  return (
    <stack gap="sm">
      <ChartLegend items={[...series.map(s => ({ name: s.name, cls: s.cls })),
        ...(targets ? [{ name: targetName, shape: "diamond" }] : [])]} />
      <svg viewBox={`0 0 ${W} ${h}`} class="chart" role="img">
        {ticks.map(t => <g>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} class="chart-grid" />
          <text x={left - 6} y={y(t) + 4} text-anchor="end" class="chart-axis">{fmt(t)}</text>
        </g>)}
        {cats.map((c, ci) => {
          const gx = left + ci * groupW + (groupW - barW * series.length - 4 * (series.length - 1)) / 2;
          return (
            <g>
              {series.map((s, si) => (
                <rect x={gx + si * (barW + 4)} y={y(s.values[ci])} width={barW}
                  height={Math.max(1, y(0) - y(s.values[ci]))} rx="4" class={s.cls}>
                  {svgTip(`${c} · ${s.name}: ${fmt(s.values[ci])}`)}
                </rect>
              ))}
              {targets ? <path d={`M${left + ci * groupW + groupW / 2} ${y(targets[ci]) - 8} l7 8 l-7 8 l-7 -8 Z`} class="chart-target">
                {svgTip(`${c} · ${targetName}: ${fmt(targets[ci])}`)}
              </path> : null}
              <text x={left + ci * groupW + groupW / 2} y={h - 8} text-anchor="middle" class="chart-label">{c}</text>
            </g>
          );
        })}
      </svg>
    </stack>
  );
};

/**
 * Stacked vertical bars per x (years), e.g. principal + interest.
 * @param {{xs:(string|number)[], series:Array<{name:string, values:number[], cls:string}>, lang:string}} props
 */
const StackedBars = (props) => responsiveChart((W) => _StackedBars(props, W));
const _StackedBars = ({ xs, series, lang }, W) => {
  const h = 240, left = 52, bottom = 26, top = 10, right = 8;
  const totals = xs.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const max = _niceMax(Math.max(...totals, 1));
  const y = (v) => top + (1 - v / max) * (h - top - bottom);
  const step = (W - left - right) / Math.max(1, xs.length);
  const barW = Math.max(2, step - 2);
  const every = Math.ceil(xs.length / 10);
  return (
    <stack gap="sm">
      <ChartLegend items={series.map(s => ({ name: s.name, cls: s.cls }))} />
      <svg viewBox={`0 0 ${W} ${h}`} class="chart" role="img">
        {[0, 0.5, 1].map(f => <g>
          <line x1={left} x2={W - right} y1={y(f * max)} y2={y(f * max)} class="chart-grid" />
          <text x={left - 6} y={y(f * max) + 4} text-anchor="end" class="chart-axis">{_compactMoney(lang, f * max)}</text>
        </g>)}
        {xs.map((xv, i) => {
          let acc = 0;
          const tip = `${xv}: ` + series.map(s => `${s.name} ${I18N.money(lang, s.values[i] || 0)}`).join(" · ");
          return (
            <g>
              {svgTip(tip)}
              {series.map(s => {
                const v = s.values[i] || 0;
                const el = <rect x={left + i * step + 1} y={y(acc + v)} width={barW}
                  height={Math.max(0, y(acc) - y(acc + v) - (acc ? 1 : 0))} class={s.cls} />;
                acc += v;
                return el;
              })}
              {i % every === 0 ? <text x={left + i * step + step / 2} y={h - 8} text-anchor="middle" class="chart-axis">{xv}</text> : null}
            </g>
          );
        })}
      </svg>
    </stack>
  );
};

/**
 * Lines over time with a crosshair read-out that follows the pointer.
 * @param {{series:Array<{name:string, cls:string, dash?:boolean, points:Array<[string, number]>}>,
 *   lang:string, marker?:string, height?:number, markers?:boolean}} props
 *   points are [isoDate, value]; `marker` an ISO date drawn as a dotted line (today)
 */
const LineChart = (props) => responsiveChart((W) => _LineChart(props, W));
const _LineChart = ({ series, lang, marker, height = 260, markers }, W) => {
  const h = height, left = 56, bottom = 26, top = 12, right = 12;
  const pts = series.flatMap(s => s.points);
  if(!pts.length) return <Empty icon="show_chart" />;
  const xs = pts.map(p => _ts(p[0]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 86400000);
  const max = _niceMax(Math.max(...pts.map(p => p[1]), 1));
  const X = (t) => left + (t - x0) / (x1 - x0) * (W - left - right);
  const Y = (v) => top + (1 - v / max) * (h - top - bottom);
  const path = (points) => points.map((p, i) => `${i ? "L" : "M"}${X(_ts(p[0])).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(" ");
  // ticks: days for a couple of months, then months, then years
  const y0 = new Date(x0).getUTCFullYear(), y1 = new Date(x1).getUTCFullYear();
  const span = y1 - y0;
  const yearStep = span > 30 ? 5 : span > 12 ? 2 : 1;
  const years = [];
  for(let y = y0 + 1; y <= y1; y++) if((y - y0) % yearStep === 0) years.push(y);
  const spanDays = (x1 - x0) / 86400000;
  const showDays = spanDays <= 62;
  const byMonth = !showDays && spanDays <= 900;
  const months = [];
  if(byMonth) {
    // as many labels as fit, about one per 70 pixels
    const every = Math.max(1, Math.ceil(spanDays / 30.4 / ((W - left - right) / 70)));
    const first = new Date(x0);
    for(let m = first.getUTCMonth() + 1; Date.UTC(y0, m, 1) <= x1; m += every) months.push(Date.UTC(y0, m, 1));
  }
  const monthLabel = (t) => Core.monthYear(new Date(t).toISOString().slice(0, 10));

  const cursor = <line y1={top} y2={h - bottom} class="chart-cursor" visibility="hidden" />;
  const dots = series.map(s => <circle r="4" class={["chart-dot", "s-" + s.cls]} visibility="hidden" />);
  const tip = <div class="chart-tip" hidden></div>;
  const svg = (
    <svg viewBox={`0 0 ${W} ${h}`} class="chart" role="img">
      {[0, 0.25, 0.5, 0.75, 1].map(f => <g>
        <line x1={left} x2={W - right} y1={Y(f * max)} y2={Y(f * max)} class="chart-grid" />
        <text x={left - 6} y={Y(f * max) + 4} text-anchor="end" class="chart-axis">{_compactMoney(lang, f * max)}</text>
      </g>)}
      {showDays
        ? series[0].points.filter((p, i, all) => i % Math.ceil(all.length / 8) === 0)
          .map(p => <text x={X(_ts(p[0]))} y={h - 8} text-anchor="middle" class="chart-axis">{Core.dayMonthYear(p[0]).slice(0, 5)}</text>)
        : byMonth
          ? months.map(t => <text x={X(t)} y={h - 8} text-anchor="middle" class="chart-axis">{monthLabel(t)}</text>)
          : years.map(y => <text x={X(Date.UTC(y, 0, 1))} y={h - 8} text-anchor="middle" class="chart-axis">{y}</text>)}
      {marker && _ts(marker) >= x0 && _ts(marker) <= x1
        ? <line x1={X(_ts(marker))} x2={X(_ts(marker))} y1={top} y2={h - bottom} class="chart-marker" /> : null}
      {series.map(s => <path d={path(s.points)} class={["chart-line", "s-" + s.cls, s.dash && "chart-dash"]} />)}
      {markers ? series.map(s => s.points.map(p => <circle cx={X(_ts(p[0]))} cy={Y(p[1])} r="4" class={["chart-dot", "s-" + s.cls]} />)) : null}
      {cursor}
      {dots}
      <rect x={left} y={top} width={W - left - right} height={h - top - bottom} class="chart-hit" />
    </svg>
  );

  // nearest point of each series to the pointer
  function nearest(points, t) {
    let best = null, bd = Infinity;
    for(const p of points) {
      const d = Math.abs(_ts(p[0]) - t);
      if(d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function move(e) {
    const box = svg.getBoundingClientRect();
    if(!box.width) return;
    const sx = (e.clientX - box.left) / box.width * W;
    const t = x0 + (sx - left) / (W - left - right) * (x1 - x0);
    const hits = series.map(s => nearest(s.points, t));
    const ref = hits.find(Boolean);
    if(!ref) return;
    const cx = X(_ts(ref[0]));
    cursor.setAttribute("x1", cx);
    cursor.setAttribute("x2", cx);
    cursor.setAttribute("visibility", "visible");
    hits.forEach((p, i) => {
      if(!p) return;
      dots[i].setAttribute("cx", X(_ts(p[0])));
      dots[i].setAttribute("cy", Y(p[1]));
      dots[i].setAttribute("visibility", "visible");
    });
    tip.replaceChildren(
      <strong>{showDays || byMonth ? Core.dayMonthYear(ref[0]) : Core.monthYear(ref[0])}</strong>,
      ...series.map((s, i) => hits[i] ? <inline gap="xs"><span class={["chart-key", s.cls]}></span>{s.name}: <b>{I18N.money(lang, hits[i][1])}</b></inline> : null).filter(Boolean),
    );
    tip.hidden = false;
    const px = cx / W * box.width;
    tip.style.left = Math.min(Math.max(px + 12, 0), box.width - 180) + "px";
  }
  function leave() {
    cursor.setAttribute("visibility", "hidden");
    dots.forEach(d => d.setAttribute("visibility", "hidden"));
    tip.hidden = true;
  }
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerleave", leave);

  return (
    <stack gap="sm">
      <ChartLegend items={series.map(s => ({ name: s.name, cls: s.cls, shape: s.dash ? "dash" : "line" }))} />
      <div class="chart-wrap">{svg}{tip}</div>
    </stack>
  );
};

/**
 * Treemap, slice and dice: a column per group (category) as wide as its value,
 * its items stacked inside it as tall as theirs.
 * @param {{groups:Array<{label:string, cls:string, items:Array<{label:string, value:number}>}>, lang:string}} props
 */
const Treemap = (props) => responsiveChart((W) => _Treemap(props, W));
const _Treemap = ({ groups, lang }, W) => {
  const H = 300, gap = 3;
  const live = groups.map(g => ({ ...g, items: g.items.filter(i => i.value > 0) }))
    .map(g => ({ ...g, value: g.items.reduce((a, i) => a + i.value, 0) }))
    .filter(g => g.value > 0);
  const total = live.reduce((a, g) => a + g.value, 0);
  if(!total) return <Empty icon="grid_view" />;
  let gx = 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="chart chart-treemap" role="img">
      {live.map(g => {
        const gw = g.value / total * W;
        const x = gx;
        gx += gw;
        let iy = 0;
        return (
          <g>
            {g.items.sort((a, b) => b.value - a.value).map(it => {
              const ih = it.value / g.value * H;
              const y = iy;
              iy += ih;
              const w = Math.max(0, gw - gap), hh = Math.max(0, ih - gap);
              const share = it.value / total * 100;
              const fits = w > 70 && hh > 30;
              return (
                <g>
                  {svgTip(`${g.label} · ${it.label}: ${I18N.money(lang, it.value)} (${I18N.percent(lang, share)})`)}
                  <rect x={x} y={y} width={w} height={hh} rx="4" class={[g.cls, "chart-tile"]} />
                  {fits ? <text x={x + 8} y={y + 18} class="chart-tile-label">{_fit(it.label, w - 16)}</text> : null}
                  {fits && hh > 46 && w > 130 ? <text x={x + 8} y={y + 34} class="chart-tile-value">{`${I18N.money(lang, it.value)} · ${I18N.percent(lang, share)}`}</text> : null}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
};
