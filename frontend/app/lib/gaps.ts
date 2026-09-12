import { toTime, type Obs } from './time';

// Break lines at missing observations.
// Recurring long gaps, such as weekends, count as part of the cadence.
const DAY = 864e5;
const MIN_RECURRENCE = 2;
const RECURRENCE_SHARE = 0.05;
const GAP_FACTOR = 1.8;

function stepsBetween(points: Obs[]): number[] {
  const times = points.map((p) => toTime(p.d));
  const out: number[] = [];
  for (let i = 1; i < times.length; i++) out.push(times[i] - times[i - 1]);
  return out;
}

// The stride this series treats as uninterrupted.
export function normalStep(points: Obs[]): number {
  if (points.length < 2) return 0;

  const steps = stepsBetween(points);
  // whole days, so a 30 and a 31 day month stay distinct but every weekend
  // lands in the same bucket
  const days = steps.map((ms) => Math.round(ms / DAY));

  const counts = new Map<number, number>();
  for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);

  const enough = Math.max(MIN_RECURRENCE, Math.ceil(days.length * RECURRENCE_SHARE));
  let recurring = 0;
  for (const [step, count] of counts) if (count >= enough && step > recurring) recurring = step;
  if (recurring) return recurring * DAY;

  // nothing repeats, which is a short or irregular series. The median is the
  // safe read: with three or more steps it still ignores a single long one.
  const sorted = [...steps].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

// Cache splits by array identity so hover updates do not reparse the series.
const splits = new WeakMap<Obs[], Map<number, Obs[][]>>();

export function segments(points: Obs[], factor = GAP_FACTOR): Obs[][] {
  let byFactor = splits.get(points);
  if (!byFactor) splits.set(points, (byFactor = new Map()));

  const held = byFactor.get(factor);
  if (held) return held;

  const found = split(points, factor);
  byFactor.set(factor, found);
  return found;
}

function split(points: Obs[], factor: number): Obs[][] {
  if (points.length < 2) return points.length ? [points] : [];

  const normal = normalStep(points);
  // a series with no usable stride is drawn whole rather than chopped on a
  // threshold that means nothing
  if (!normal) return [points];

  const limit = normal * factor;
  const steps = stepsBetween(points);
  const out: Obs[][] = [];
  let run: Obs[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    if (steps[i - 1] > limit) {
      out.push(run);
      run = [points[i]];
    } else {
      run.push(points[i]);
    }
  }
  out.push(run);
  return out;
}

// Breaks, not runs. Used to say in the panel copy that the line is interrupted,
// so a reader does not take the gap for a rendering fault.
export const breakCount = (points: Obs[]) => Math.max(0, segments(points).length - 1);
