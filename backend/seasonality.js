// Monthly percent change from month-end closes, by calendar year.

const MONTHS = 12;

// last close of each calendar month, keyed YYYY-MM
function monthEnds(points) {
  const ends = new Map();
  for (const p of points) if (p.d && p.v != null) ends.set(p.d.slice(0, 7), { d: p.d, v: p.v });
  return ends;
}

const key = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

// Four places, not the one a cell shows: the summary rows are computed from
// these and rounding first shifts a stat by a digit.
const round = (v) => Number(v.toFixed(4));

const change = (from, to) => round((to / from - 1) * 100);

// a month needs the close that ended it and the one that ended the month before
function monthChange(ends, year, month) {
  const now = ends.get(key(year, month));
  const before = month === 1 ? ends.get(key(year - 1, MONTHS)) : ends.get(key(year, month - 1));
  return now && before && before.v ? change(before.v, now.v) : null;
}

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;

function median(v) {
  const s = [...v].sort((a, b) => a - b);
  const mid = s.length / 2;
  return s.length % 2 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2;
}

// Sample standard deviation, matching what a spreadsheet's STDEV returns.
function stdev(v) {
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

// Down a column of years.
function statistics(column) {
  const v = column.filter((x) => x != null);
  if (!v.length) return { n: 0, average: null, median: null, positive: null, size: null, stdev: null, best: null, worst: null };

  const sd = stdev(v);
  return {
    n: v.length,
    average: round(mean(v)),
    median: round(median(v)),
    positive: round((v.filter((x) => x > 0).length / v.length) * 100),
    size: round(mean(v.map(Math.abs))),
    stdev: sd === null ? null : round(sd),
    best: round(Math.max(...v)),
    worst: round(Math.min(...v)),
  };
}

const pick = (stats, name) => stats.map((s) => s[name]);

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// stat name, and how an export labels its row
const STATS = [
  ['average', 'average'],
  ['median', 'median'],
  ['positive', 'percent_positive'],
  ['size', 'average_move_size'],
  ['stdev', 'standard_deviation'],
  ['best', 'best'],
  ['worst', 'worst'],
];

// `points` is ascending daily closes, `years` the number of year rows wanted.
function seasonality(points, years) {
  if (!points.length) return null;

  const ends = monthEnds(points);
  const latest = points[points.length - 1];
  const latestMonth = latest.d.slice(0, 7);
  const lastYear = Number(latest.d.slice(0, 4));
  const firstYear = lastYear - years + 1;

  const rows = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    const months = [];
    for (let m = 1; m <= MONTHS; m += 1) months.push(monthChange(ends, year, m));

    // The running year closes on its latest month rather than on December.
    const end = ends.get(key(year, MONTHS)) || (year === lastYear ? ends.get(latestMonth) : null);
    const start = ends.get(key(year - 1, MONTHS));

    const done = months.filter((v) => v != null);
    rows.push({
      year,
      months,
      change: end && start && start.v ? change(start.v, end.v) : null,
      best: done.length ? round(Math.max(...done)) : null,
      worst: done.length ? round(Math.min(...done)) : null,
    });
  }

  // leading years with no prints at all go, so a fund younger than the window
  // starts at its first print. A year inside the span stays, prints or not.
  while (rows.length && rows[0].months.every((v) => v == null) && rows[0].change == null) rows.shift();

  const byMonth = [];
  for (let m = 0; m < MONTHS; m += 1) byMonth.push(statistics(rows.map((r) => r.months[m])));
  const byYear = statistics(rows.map((r) => r.change));

  const summary = { n: { months: pick(byMonth, 'n'), year: byYear.n } };
  for (const [name] of STATS) summary[name] = { months: pick(byMonth, name), year: byYear[name] };

  return {
    rows,
    summary,
    from: points[0].d,
    through: latest.d,
    // the month still trading, which closes against the last print rather than
    // against a month end
    partial: latestMonth === new Date().toISOString().slice(0, 7) ? latestMonth : null,
  };
}

module.exports = { seasonality, MONTHS, MONTH_KEYS, STATS };
