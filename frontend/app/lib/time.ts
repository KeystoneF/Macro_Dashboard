// Every source hands back a different period string. FRED and Valet print
// YYYY-MM-DD, OECD prints YYYY-MM or YYYY-Qn, FMP's intraday bars print
// YYYY-MM-DDTHH:MM:SS, and Date parses only some of those the same way in
// every browser, so all of them go through here rather than through `new Date`.
export function toTime(period: string): number {
  const t = period.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (t) return Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +(t[6] ?? 0));

  const q = period.match(/^(\d{4})-Q(\d)$/);
  if (q) return Date.UTC(+q[1], (+q[2] - 1) * 3, 1);
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, 1);
  const d = period.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (d) return Date.UTC(+d[1], +d[2] - 1, +d[3]);
  return Date.UTC(+period.slice(0, 4), 0, 1);
}

export const isoAgo = (days: number) =>
  new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

export const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10);

// Jan 1 resolves to the previous year's last print at both sources, which is the
// baseline a year-to-date move is quoted against.
export const startOfYear = () => `${new Date().getFullYear()}-01-01`;

export const yearsAgo = (years: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
};

// At most seven labels, on whole years, whatever the window.
export function yearTicks(t0: number, t1: number): number[] {
  const y0 = new Date(t0).getUTCFullYear();
  const y1 = new Date(t1).getUTCFullYear();
  const step = Math.max(1, Math.ceil((y1 - y0) / 7));
  const out: number[] = [];
  for (let y = y0; y <= y1; y += step) out.push(Date.UTC(y, 0, 1));
  return out.filter((t) => t >= t0 && t <= t1);
}

// At most seven labels, on whole months.
export function monthTicks(t0: number, t1: number): number[] {
  const from = new Date(t0);
  const to = new Date(t1);
  const span =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  const step = Math.max(1, Math.ceil(span / 6));
  const out: number[] = [];
  for (let m = 0; m <= span; m += step) {
    const t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + m, 1);
    if (t >= t0 && t <= t1) out.push(t);
  }
  return out;
}

// Years, or months where the window is too short to carry three of them: a one
// year chart labelled on years gets a single tick.
export function timeTicks(t0: number, t1: number): { t: number; label: string }[] {
  const years = yearTicks(t0, t1);
  if (years.length >= 3) {
    return years.map((t) => ({ t, label: String(new Date(t).getUTCFullYear()) }));
  }
  return monthTicks(t0, t1).map((t) => ({ t, label: new Date(t).toISOString().slice(0, 7) }));
}

export type Obs = { d: string; v: number };

// Widest gap a readout will reach across. Beyond it the cursor is nowhere near
// an actual print and the panel says n/a instead.
const REACH_MS = 200 * 864e5;

// Parsed once per series rather than once per mousemove. The readout runs this
// for every line on the chart every time the cursor moves, and re-parsing
// 30,000 period strings at that rate was a large part of what made a 25 year
// window with five daily series stop responding.
const parsed = new WeakMap<Obs[], number[]>();

function timesOf(points: Obs[]): number[] {
  let times = parsed.get(points);
  if (!times) parsed.set(points, (times = points.map((p) => toTime(p.d))));
  return times;
}

// The nearest observation that exists, never an interpolated one. Every source
// is sorted ascending before it reaches the page, so this bisects rather than
// scanning.
export function nearest(points: Obs[], t: number): Obs | null {
  if (!points.length) return null;

  const times = timesOf(points);
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }

  // the bisect lands on the first print at or after the cursor, so its
  // neighbour on the left is the only other candidate
  const after = lo;
  const before = lo > 0 ? lo - 1 : 0;
  const at = Math.abs(times[after] - t) <= Math.abs(times[before] - t) ? after : before;

  return Math.abs(times[at] - t) > REACH_MS ? null : points[at];
}
