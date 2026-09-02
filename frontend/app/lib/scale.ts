// Axis domain that lands on round numbers. Dividing the raw data range into four
// gives ticks like 3.63 and 4.56, which are unreadable on a rate chart.
export function niceScale(min: number, max: number, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }

  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);

  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  // accumulate off the index, not by adding step repeatedly, or 0.1 steps drift
  for (let i = 0; lo + i * step <= hi + step / 1e6; i++) ticks.push(lo + i * step);

  return { lo, hi, ticks, step };
}

// Decimals needed to show the step without trailing noise: 0.25 needs 2, 5 needs 0.
export const tickDigits = (step: number) =>
  Math.max(0, Math.min(4, -Math.floor(Math.log10(step))));

// Two axes on one chart need the same number of intervals or their gridlines
// cross each other and the plot reads as broken. Both keep their own round
// step; the shorter one is extended, alternately at the top and the bottom, so
// the data stays roughly centred rather than sinking to the floor.
export function alignTickCount(
  a: { lo: number; hi: number; ticks: number[]; step?: number },
  b: { lo: number; hi: number; ticks: number[]; step?: number },
) {
  const grow = (s: typeof a, target: number) => {
    const step = s.step ?? 1;
    let top = true;
    while (s.ticks.length < target) {
      if (top) {
        s.hi += step;
        s.ticks.push(s.hi);
      } else {
        s.lo -= step;
        s.ticks.unshift(s.lo);
      }
      top = !top;
    }
  };

  const target = Math.max(a.ticks.length, b.ticks.length);
  grow(a, target);
  grow(b, target);
}
