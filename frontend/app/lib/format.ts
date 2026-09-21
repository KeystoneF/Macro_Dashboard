import { COLOR, RGB } from '../theme';

// Shared market-board formatting.

export const fmtPrice = (v: number | null | undefined, decimals: number) =>
  v == null
    ? 'n/a'
    : v.toLocaleString('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const fmtPct = (v: number | null | undefined) =>
  v == null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

export const pctColor = (v: number | null | undefined) =>
  v == null ? COLOR.dim : v < 0 ? COLOR.bad : COLOR.good;

// A wash rather than the heatmap's solid fill: a table cell carries a figure,
// and the figure has to stay readable on top of it. Saturates at `clamp`.
export function pctWash(v: number | null | undefined, clamp: number, depth = 0.3) {
  if (v == null) return undefined;
  const [r, g, b] = v < 0 ? RGB.bad : RGB.good;
  return `rgba(${r},${g},${b},${((Math.min(Math.abs(v), clamp) / clamp) * depth).toFixed(3)})`;
}

// Age of the provider's quote, not the latest request.
export const minutesBehind = (quotedAt: string | null) =>
  quotedAt == null ? null : Math.floor((Date.now() - Date.parse(quotedAt)) / 60_000);

export function age(quotedAt: string | null): string {
  const mins = minutesBehind(quotedAt);
  if (mins == null) return 'n/a';
  if (mins < 1) return 'now';
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
}
