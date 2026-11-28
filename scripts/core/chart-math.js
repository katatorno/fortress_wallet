// scripts/core/chart-math.js
//
// The numbers behind the charts: the ranges of a history chart, the points a range
// shows, and the limits of an axis, from zero or close around the values.

const ChartMath = (() => {
  /** How far back a history chart looks. */
  const RANGES = ["all", "year", "quarter", "month", "week"];

  /** The first day of a range ending on `to`; null for the whole history. */
  function rangeStart(range, to = Dates.today()) {
    const months = { year: 12, quarter: 3, month: 1 }[range];
    if(months) return Dates.addMonths(to, -months);
    if(range !== "week") return null;
    const [y, m, d] = to.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);
  }

  /**
   * The points of a series from `from` on. The value that stood on the first day
   * opens the line, carried from the last point before it.
   * @param {Array<[string, number]>} points  by date, oldest first
   */
  function clipPoints(points, from) {
    if(!from) return points;
    const inside = points.filter(p => p[0] >= from);
    const before = points.filter(p => p[0] < from).pop();
    return before && inside[0]?.[0] !== from ? [[from, before[1]], ...inside] : inside;
  }

  /** A round upper limit of an axis which starts at zero; 1 for nothing above it. */
  function niceMax(v) {
    if(!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for(const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if(m * p >= v) return m * p;
    return 10 * p;
  }

  /** An axis close around the values: round limits and four or so even steps. */
  function axisRange(min, max) {
    const raw = (max - min) / 4 || Math.max(Math.abs(max) / 100, 1);
    const unit = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * unit).find(s => s >= raw);
    const lo = Math.floor(min / step) * step;
    const hi = Math.max(Math.ceil(max / step) * step, lo + step);
    const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => Base.round2(lo + i * step));
    return { lo, hi, step, ticks };
  }

  return { RANGES, rangeStart, clipPoints, niceMax, axisRange };
})();
